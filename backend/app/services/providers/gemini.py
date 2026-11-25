"""Proveedor Google Gemini (SDK google-genai) con salida JSON estructurada.

Ante un 503 (modelo saturado) se reintenta UNA vez con GEMINI_FALLBACK_MODEL.
Ante un 429 (límite gratuito) nunca se reintenta.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from google import genai
from google.genai import errors, types

from app.services.providers.base import (
    OUTPUT_SCHEMA,
    Provider,
    ProviderBlocked,
    ProviderError,
    ProviderOverloaded,
    ProviderRateLimited,
)

log = logging.getLogger(__name__)

RATE_LIMIT_MSG = "Llegaste al límite gratuito de Gemini, espera un momento o intenta mañana"
OVERLOADED_MSG = "Gemini está saturado en este momento, intenta de nuevo en unos segundos"
BLOCKED_MSG = "Gemini bloqueó esta respuesta por sus filtros. Intenta regenerar o cambia de tono"

# finish_reason que significan "cortado por filtros" (no por longitud u otros motivos).
_BLOCK_FINISH_REASONS = {
    types.FinishReason.SAFETY,
    types.FinishReason.BLOCKLIST,
    types.FinishReason.PROHIBITED_CONTENT,
    types.FinishReason.SPII,
    types.FinishReason.IMAGE_SAFETY,
    types.FinishReason.IMAGE_PROHIBITED_CONTENT,
    types.FinishReason.MODEL_ARMOR,
}


# Filtros de seguridad: solo bloquea lo de probabilidad ALTA en las categorías de TEXTO
# (el humor negro dispara falsos positivos con el umbral por defecto). Las categorías de
# imagen, CIVIC_INTEGRITY y JAILBREAK se quedan con el valor por defecto de Gemini.
SAFETY_SETTINGS = [
    types.SafetySetting(category=cat, threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH)
    for cat in (
        types.HarmCategory.HARM_CATEGORY_HARASSMENT,
        types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    )
]


def _blocked_reason(response: types.GenerateContentResponse) -> str | None:
    """Devuelve el motivo si Gemini bloqueó la petición o la respuesta; si no, None."""
    feedback = response.prompt_feedback
    if feedback and feedback.block_reason:
        return f"prompt bloqueado: {feedback.block_reason}"
    candidates = response.candidates or []
    if not candidates:
        return "respuesta sin candidatos"  # Gemini no devuelve candidatos cuando bloquea
    reason = candidates[0].finish_reason
    if reason in _BLOCK_FINISH_REASONS:
        return f"finish_reason={reason}"
    return None


class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, fallback_model: str = "") -> None:
        self.api_key = api_key
        self.model = model
        self.fallback_model = fallback_model if fallback_model and fallback_model != model else ""
        self._client: genai.Client | None = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _get_client(self) -> genai.Client:
        if not self.api_key:
            raise ProviderError("Falta GEMINI_API_KEY en el archivo .env.")
        if self._client is None:
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    async def _call(self, model: str, contents: list, config: types.GenerateContentConfig) -> dict:
        try:
            response = await self._get_client().aio.models.generate_content(
                model=model, contents=contents, config=config
            )
        except errors.APIError as e:
            if e.code == 503:
                raise ProviderOverloaded(OVERLOADED_MSG) from e
            if e.code == 429:
                raise ProviderRateLimited(RATE_LIMIT_MSG) from e
            if e.code in (401, 403) or "API key not valid" in (e.message or ""):
                raise ProviderError("La GEMINI_API_KEY no es válida.") from e
            if e.code == 404:
                raise ProviderError(f"Gemini no encontró el modelo '{model}'. Revisa la configuración.") from e
            raise ProviderError(f"Error de Gemini ({e.code}): {e.message}") from e

        blocked = _blocked_reason(response)
        if blocked:
            log.warning("Gemini bloqueó la respuesta (%s, modelo %s)", blocked, model)
            raise ProviderBlocked(BLOCKED_MSG)
        if not response.text:
            raise ProviderError("Gemini devolvió una respuesta vacía. Intenta regenerar.")
        try:
            data = json.loads(response.text)
        except json.JSONDecodeError as e:
            raise ProviderError("Gemini devolvió un JSON inválido. Intenta regenerar.") from e
        if isinstance(data, dict):
            data["model"] = model
        return data

    async def generate(self, frames: list[Path], system: str, user_text: str) -> dict:
        contents: list = []
        for i, frame in enumerate(frames, 1):
            contents.append(f"Frame {i}/{len(frames)}:")
            contents.append(types.Part.from_bytes(data=frame.read_bytes(), mime_type="image/jpeg"))
        contents.append(user_text)

        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=OUTPUT_SCHEMA,
            safety_settings=SAFETY_SETTINGS,
        )
        try:
            return await self._call(self.model, contents, config)
        except ProviderOverloaded:
            if not self.fallback_model:
                raise
            log.warning("Gemini 503 con %s; reintentando con %s", self.model, self.fallback_model)
            return await self._call(self.fallback_model, contents, config)
