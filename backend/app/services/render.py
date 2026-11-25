"""Render final para TikTok/IG: video encajado en el lienzo del formato + PNG con el texto.

Composición (de abajo arriba):
  1. Zona de video (ancho W, alto H - franja):
     - "crop": el video escalado para cubrir la zona y recortado.
     - "blur": fondo = el mismo video cubriendo la zona, desenfocado; encima el video
       completo (sin recortar) centrado.
  2. Si hay franja (estilo "Banda TikTok"), la zona de video se coloca debajo de ella;
     el hueco de arriba queda blanco (el PNG dibuja la franja y su texto).
  3. El PNG transparente del tamaño exacto del lienzo, encima de todo.
"""
from __future__ import annotations

import asyncio
import struct
import subprocess
from pathlib import Path

from app.config import settings

FORMATS: dict[str, tuple[int, int]] = {
    "9x16": (1080, 1920),
    "4x5": (1080, 1350),
    "1x1": (1080, 1080),
}
FITS = ("blur", "crop")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_BAND_RATIO = 0.6  # la franja no puede ocupar más del 60 % del alto


class RenderError(Exception):
    """Error al renderizar que se puede mostrar al usuario."""


def _even(n: float) -> int:
    """H.264 + yuv420p exigen dimensiones pares."""
    return max(2, int(n) // 2 * 2)


def png_size(data: bytes) -> tuple[int, int] | None:
    """Ancho y alto leídos de la cabecera IHDR, o None si no es un PNG válido."""
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


def build_filter(fmt: str, fit: str, band: int) -> str:
    """Grafo de -filter_complex. Entrada 0 = video, entrada 1 = PNG. Salida [out]."""
    w, h = FORMATS[fmt]
    band = _even(band) if band > 0 else 0
    area_h = h - band

    if fit == "crop":
        video = (
            f"[0:v]fps=30,scale={w}:{area_h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{area_h},setsar=1[vid]"
        )
    else:
        # El desenfoque se hace a 1/4 de resolución (mucho más rápido) y luego se reescala.
        bw, bh = _even(w / 4), _even(area_h / 4)
        video = (
            f"[0:v]fps=30,split=2[bgsrc][fgsrc];"
            f"[bgsrc]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},"
            f"boxblur=10:2,scale={w}:{area_h},setsar=1[bg];"
            f"[fgsrc]scale={w}:{area_h}:force_original_aspect_ratio=decrease,setsar=1[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[vid]"
        )

    base = f"[vid]pad={w}:{h}:0:{band}:color=white[base]" if band else "[vid]null[base]"
    out = "[base][1:v]overlay=0:0:format=auto,format=yuv420p[out]"
    return ";".join([video, base, out])


def build_command(video: Path, overlay: Path, out: Path, fmt: str, fit: str, band: int) -> list[str]:
    return [
        settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(video),
        "-i", str(overlay),
        "-filter_complex", build_filter(fmt, fit, band),
        "-map", "[out]",
        "-map", "0:a?",            # el "?" evita fallar si el video no tiene audio
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        str(out),
    ]


def _timeout_for(duration_s: float) -> int:
    # Holgado: ~4x la duración + margen fijo, con tope de 10 min.
    return int(min(600, 90 + duration_s * 4))


def render_video(
    video: Path, overlay: Path, out: Path, fmt: str, fit: str, band: int, duration_s: float
) -> Path:
    if fmt not in FORMATS:
        raise RenderError("Formato no válido.")
    if fit not in FITS:
        raise RenderError("Encaje no válido.")

    cmd = build_command(video, overlay, out, fmt, fit, band)
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=_timeout_for(duration_s))
    except FileNotFoundError as e:
        raise RenderError(f"No se encontró '{cmd[0]}'. ¿Está FFmpeg instalado y en el PATH?") from e
    except subprocess.TimeoutExpired as e:
        out.unlink(missing_ok=True)
        raise RenderError("El render tardó demasiado. Prueba con un video más corto.") from e
    except subprocess.CalledProcessError as e:
        out.unlink(missing_ok=True)
        raise RenderError(f"FFmpeg no pudo renderizar el video: {e.stderr.strip()[-300:]}") from e

    if not out.exists() or out.stat().st_size == 0:
        raise RenderError("FFmpeg no generó el archivo de salida.")
    return out


async def render_video_async(
    video: Path, overlay: Path, out: Path, fmt: str, fit: str, band: int, duration_s: float
) -> Path:
    """FFmpeg corre en un hilo para no bloquear el event loop."""
    return await asyncio.to_thread(render_video, video, overlay, out, fmt, fit, band, duration_s)
