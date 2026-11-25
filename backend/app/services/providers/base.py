"""Interfaz común de los proveedores de visión.

Cada proveedor recibe los frames + prompts y devuelve el JSON crudo:
    {"scene_summary": str, "captions": [{"angle": str, "text": str}, ...]}
La validación (ángulos, vacíos, cantidad) la hace captioner.py, no el proveedor.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from app.schemas import Angle


class ProviderError(Exception):
    """Error del proveedor con un mensaje en español apto para mostrar al usuario."""


class ProviderRateLimited(ProviderError):
    """El proveedor rechazó la petición por límite de uso (HTTP 429)."""


class ProviderBlocked(ProviderError):
    """El proveedor bloqueó la respuesta por sus filtros de seguridad."""


class ProviderOverloaded(ProviderError):
    """El proveedor está saturado (HTTP 503) incluso tras reintentar."""


# JSON Schema de la salida. Lo usan los tres proveedores (tool de Claude,
# response_schema de Gemini y "format" de Ollama).
OUTPUT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "scene_summary": {
            "type": "string",
            "description": "Una frase describiendo qué pasa en el video.",
        },
        "captions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "angle": {"type": "string", "enum": [a.value for a in Angle]},
                    "text": {"type": "string"},
                },
                "required": ["angle", "text"],
            },
        },
    },
    "required": ["scene_summary", "captions"],
}


class Provider(ABC):
    name: str
    model: str

    @property
    @abstractmethod
    def configured(self) -> bool:
        """True si tiene lo necesario (API key, etc.) para funcionar."""

    @abstractmethod
    async def generate(self, frames: list[Path], system: str, user_text: str) -> dict:
        """Devuelve {"scene_summary": str, "captions": [{"angle", "text"}], "model": str}.

        "model" es opcional: el modelo que respondió de verdad (útil si hubo respaldo);
        si falta, se usa `self.model`.

        Lanza ProviderError con un mensaje en español si algo falla.
        """
