"""Proveedor Ollama local vía HTTP (/api/chat) con salida estructurada ("format")."""
from __future__ import annotations

import base64
import json
from pathlib import Path

import httpx

from app.services.providers.base import OUTPUT_SCHEMA, Provider, ProviderError

TIMEOUT_S = 300  # los modelos de visión locales pueden ser lentos


class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self, base_url: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    @property
    def configured(self) -> bool:
        return True  # no necesita API key

    async def generate(self, frames: list[Path], system: str, user_text: str) -> dict:
        images = [base64.standard_b64encode(f.read_bytes()).decode() for f in frames]
        payload = {
            "model": self.model,
            "stream": False,
            "format": OUTPUT_SCHEMA,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"Te paso {len(frames)} frames en orden cronológico.\n\n{user_text}",
                    "images": images,
                },
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)
        except httpx.ConnectError as e:
            raise ProviderError(
                f"No se pudo conectar con Ollama en {self.base_url}. ¿Está corriendo `ollama serve`?"
            ) from e
        except httpx.TimeoutException as e:
            raise ProviderError("Ollama tardó demasiado en responder.") from e

        if resp.status_code == 404:
            raise ProviderError(
                f"El modelo '{self.model}' no está en Ollama. Ejecuta `ollama pull {self.model}`."
            )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error", resp.text)
            except ValueError:
                detail = resp.text
            raise ProviderError(f"Error de Ollama ({resp.status_code}): {str(detail)[:300]}")

        try:
            return json.loads(resp.json()["message"]["content"])
        except (KeyError, ValueError) as e:
            raise ProviderError("Ollama devolvió una respuesta inválida. Intenta regenerar.") from e
