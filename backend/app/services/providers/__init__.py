"""Proveedores de visión. `get_provider()` devuelve el configurado en PROVIDER.

Los SDKs se importan solo al elegir el proveedor, así no hace falta tener
instalados los de los proveedores que no usas.
"""
from __future__ import annotations

from app.config import settings
from app.services.providers.base import (
    Provider,
    ProviderBlocked,
    ProviderError,
    ProviderOverloaded,
    ProviderRateLimited,
)

PROVIDERS = ("gemini", "ollama", "anthropic")

_cache: dict[str, Provider] = {}


def get_provider(name: str | None = None) -> Provider:
    name = (name or settings.provider).strip().lower()
    if name in _cache:
        return _cache[name]

    if name == "gemini":
        from app.services.providers.gemini import GeminiProvider

        provider: Provider = GeminiProvider(
            settings.gemini_api_key, settings.gemini_model, settings.gemini_fallback_model
        )
    elif name == "ollama":
        from app.services.providers.ollama import OllamaProvider

        provider = OllamaProvider(settings.ollama_url, settings.ollama_model)
    elif name == "anthropic":
        from app.services.providers.anthropic import AnthropicProvider

        provider = AnthropicProvider(settings.anthropic_api_key, settings.vision_model)
    else:
        raise ProviderError(f"PROVIDER='{name}' no es válido. Usa uno de: {', '.join(PROVIDERS)}.")

    _cache[name] = provider
    return provider


__all__ = ["PROVIDERS", "Provider", "ProviderBlocked", "ProviderError", "ProviderOverloaded", "ProviderRateLimited", "get_provider"]
