"""Generación de captions: prompt, plan de ángulos y validación.

La llamada al modelo la hace el proveedor elegido en PROVIDER (ver
services/providers/). Todos devuelven el mismo JSON crudo y aquí se valida.
"""
from __future__ import annotations

from pathlib import Path

from app.config import settings
from app.schemas import Angle, Caption, Tone
from app.services.providers import (
    ProviderBlocked,
    ProviderError,
    ProviderOverloaded,
    ProviderRateLimited,
    get_provider,
)
from app.services.tones import ANGLE_GUIDE, FREE_FORMAT_TONES, angle_plan


class CaptionError(Exception):
    """Error al generar captions que se puede mostrar al usuario."""


class CaptionRateLimited(CaptionError):
    """El proveedor alcanzó su límite de uso; la API responde 429."""


class CaptionBlocked(CaptionError):
    """El proveedor bloqueó la respuesta por filtros de seguridad; la API responde 422."""


class CaptionOverloaded(CaptionError):
    """El proveedor sigue saturado tras reintentar; la API responde 503."""


SYSTEM_PROMPT = """Eres un creador de memes en español con muy buen timing cómico.
Recibes frames de un video corto en orden cronológico y escribes captions tipo meme en español.

Reglas:
- Basa cada caption en lo que REALMENTE pasa en los frames (acción, expresiones, objetos, giro final).
- Español neutro que entienda cualquier hispanohablante. Nada de jerga regional de ningún país
  (ej.: pibes, wey, tío, parce, chamo, causa). El humor sale de la situación, no de las palabras.
- Cortas: idealmente menos de 15 palabras.
- Varía los formatos. Opciones: "POV: ...", "Nadie: / Yo: ...", diálogo corto entre dos personas,
  "Mi ___ cuando ___", texto de arriba / texto de abajo, frase suelta, "Yo cuando...", "Cuando...".
- Obligatorio: entre las 6 debe haber al menos 1 caption con formato "POV: ..." y al menos 1
  diálogo corto entre dos personas (cada intervención en su propia línea, separadas con \\n,
  por ejemplo: "Mamá: ¿Ya hiciste la tarea?\\nYo: ..."). Respeta igualmente el ángulo pedido
  para cada posición. Excepción: esta regla NO aplica cuando el tono pedido es "negro" o
  "shitpost" (el shitpost suele ser una frase suelta); en esos tonos usa el formato que funcione mejor.
- Como máximo 2 de las 6 captions pueden empezar con las mismas palabras ("Yo cuando", "Cuando",
  "POV", "Mi", etc.). Antes de responder, revisa los comienzos y reescribe las que se repitan de más.
- En diálogos, "Nadie: / Yo:" y texto de arriba/abajo, separa cada parte con un salto de línea real
  (\\n) dentro del texto, por ejemplo: "Nadie:\\nYo a las 3 AM: ...".
- Las 6 deben ser claramente distintas entre sí (no reformules la misma idea).
- Sin hashtags, sin emojis salvo que sumen mucho, sin explicar el chiste.
- Nada ofensivo hacia grupos de personas ni contenido sexual.
- Permitido: estrés, cansancio, ansiedad cotidiana, pesimismo existencial y autodesprecio
  exagerado ("mi última neurona", "yo a las 3 a.m. repasando mis errores").
- Prohibido: burlarse de diagnósticos o enfermedades concretas, o de las personas que las tienen.
- La muerte propia se trata como algo inevitable, absurdo o burocrático (funeral, testamento,
  el universo sin enterarse), nunca como deseo, plan o método de morir.
- Prohibido, en cualquier tono (incluido el humor negro): chistes sobre suicidio o autolesiones,
  sobre tragedias reales, o que ataquen a grupos de personas (etnia, religión, género,
  orientación sexual, discapacidad, nacionalidad). En humor negro, la víctima es la vida o uno mismo."""


def _build_user_text(tone: Tone, plan: list[Angle], extra_context: str | None) -> str:
    lines = [f'Tono pedido: "{tone.value}".']
    if tone in FREE_FORMAT_TONES:
        lines.append("En este tono NO es obligatorio incluir POV ni diálogo.")
    else:
        lines.append("Recuerda: al menos 1 POV y al menos 1 diálogo (con \\n) entre las captions.")
    lines.append(f"Genera exactamente {len(plan)} captions, en este orden de ángulos:")
    for i, angle in enumerate(plan, 1):
        lines.append(f"{i}. [{angle.value}] {ANGLE_GUIDE[angle]}")
    if extra_context:
        lines.append(f"\nContexto extra del usuario: {extra_context}")
    lines.append(
        '\nResponde solo con JSON: {"scene_summary": "...", '
        '"captions": [{"angle": "<ángulo de esa posición>", "text": "..."}]}.'
    )
    return "\n".join(lines)


def _validate(raw: dict, plan: list[Angle]) -> tuple[str, list[Caption]]:
    if not isinstance(raw, dict):
        raise CaptionError("El modelo devolvió una respuesta con formato inesperado. Intenta regenerar.")
    items = raw.get("captions") or []
    if not isinstance(items, list):
        items = []

    captions: list[Caption] = []
    for i, item in enumerate(items[: settings.caption_count]):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        try:
            angle = Angle(item.get("angle"))
        except ValueError:
            angle = plan[i] if i < len(plan) else Angle.cotidiano
        captions.append(Caption(id=len(captions) + 1, angle=angle, text=text))

    if not captions:
        raise CaptionError("El modelo devolvió una respuesta vacía. Intenta regenerar.")
    return str(raw.get("scene_summary", "")).strip(), captions


async def generate_captions(
    frames: list[Path], tone: Tone, extra_context: str | None = None
) -> tuple[str, list[Caption], str]:
    """Devuelve (scene_summary, captions, modelo que respondió)."""
    plan = angle_plan(tone, settings.caption_count)
    try:
        provider = get_provider()
        raw = await provider.generate(frames, SYSTEM_PROMPT, _build_user_text(tone, plan, extra_context))
    except ProviderRateLimited as e:
        raise CaptionRateLimited(str(e)) from e
    except ProviderOverloaded as e:
        raise CaptionOverloaded(str(e)) from e
    except ProviderBlocked as e:
        raise CaptionBlocked(str(e)) from e
    except ProviderError as e:
        raise CaptionError(str(e)) from e
    summary, captions = _validate(raw, plan)
    model = raw.get("model") if isinstance(raw, dict) else None
    return summary, captions, str(model or provider.model)
