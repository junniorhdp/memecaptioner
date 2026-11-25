"""Proveedor Anthropic (Claude) usando tool use forzado para obtener JSON."""
from __future__ import annotations

import base64
from pathlib import Path

from anthropic import APIError, AsyncAnthropic

from app.services.providers.base import OUTPUT_SCHEMA, Provider, ProviderError

TOOL = {
    "name": "entregar_captions",
    "description": "Entrega el resumen de la escena y las captions generadas.",
    "input_schema": OUTPUT_SCHEMA,
}


def _image_block(path: Path) -> dict:
    data = base64.standard_b64encode(path.read_bytes()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}}


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model
        self._client: AsyncAnthropic | None = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _get_client(self) -> AsyncAnthropic:
        if not self.api_key:
            raise ProviderError("Falta ANTHROPIC_API_KEY en el archivo .env.")
        if self._client is None:
            self._client = AsyncAnthropic(api_key=self.api_key)
        return self._client

    async def generate(self, frames: list[Path], system: str, user_text: str) -> dict:
        content: list[dict] = []
        for i, frame in enumerate(frames, 1):
            content.append({"type": "text", "text": f"Frame {i}/{len(frames)}:"})
            content.append(_image_block(frame))
        content.append({"type": "text", "text": f"{user_text}\n\nUsa la herramienta {TOOL['name']} para responder."})

        try:
            response = await self._get_client().messages.create(
                model=self.model,
                max_tokens=1500,
                system=system,
                tools=[TOOL],
                tool_choice={"type": "tool", "name": TOOL["name"]},
                messages=[{"role": "user", "content": content}],
            )
        except APIError as e:
            raise ProviderError(f"Error de la API de visión: {e.message}") from e

        tool_use = next((b for b in response.content if b.type == "tool_use"), None)
        if tool_use is None:
            raise ProviderError("El modelo no devolvió captions.")
        return dict(tool_use.input)
