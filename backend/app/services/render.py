"""Render final para TikTok/IG a partir del estado del editor.

Composición (de abajo arriba), todo al tamaño final del formato (W x H):
  1. Fondo: el mismo video cubriendo el lienzo y desenfocado ("blur"), o negro ("black").
  2. El video escalado y colocado según el editor: su centro en (video.x, video.y) y su
     tamaño = encaje "contain" del video en el lienzo x video.scale.
  3. Las capas (PNG transparentes de W x H) en orden. Si una capa tiene start/end, solo
     se muestra en ese intervalo: overlay con enable='between(t,start,end)' (Fase 2).

FFmpeg corre como subproceso vigilado desde el event loop: si el cliente cancela la
petición (se desconecta) o se supera el timeout, el proceso se mata al momento.
"""
from __future__ import annotations

import asyncio
import json
import struct
import subprocess
import tempfile
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

FORMATS: dict[str, tuple[int, int]] = {
    "9x16": (1080, 1920),
    "4x5": (1080, 1350),
    "1x1": (1080, 1080),
}
BACKGROUNDS = ("blur", "black")
MAX_LAYERS = 20
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class RenderError(Exception):
    """Error al renderizar que se puede mostrar al usuario."""


class RenderCancelled(Exception):
    """El cliente canceló la petición; FFmpeg ya se mató."""


@dataclass(frozen=True)
class VideoTransform:
    x: float          # centro, en px del lienzo final
    y: float
    scale: float = 1.0


@dataclass(frozen=True)
class LayerInput:
    path: Path
    start: float | None = None
    end: float | None = None


@dataclass(frozen=True)
class SourceInfo:
    width: int        # dimensiones tal como se ven (ya aplicada la rotación del móvil)
    height: int
    duration: float


def _even(n: float) -> int:
    """H.264 + yuv420p exigen dimensiones pares."""
    return max(2, int(round(n)) // 2 * 2)


def png_size(data: bytes) -> tuple[int, int] | None:
    """Ancho y alto leídos de la cabecera IHDR, o None si no es un PNG válido."""
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE) or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


def contain_size(src_w: int, src_h: int, canvas_w: int, canvas_h: int) -> tuple[float, float]:
    """Tamaño del video encajado completo dentro del lienzo (mismo cálculo que el editor)."""
    s = min(canvas_w / src_w, canvas_h / src_h)
    return src_w * s, src_h * s


def default_transform(fmt: str) -> VideoTransform:
    w, h = FORMATS[fmt]
    return VideoTransform(x=w / 2, y=h / 2, scale=1.0)


def probe_source(video: Path) -> SourceInfo:
    """Dimensiones visibles (considera la rotación de videos de móvil) y duración."""
    cmd = [
        settings.ffprobe_bin, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate:format=duration",
        "-of", "json", str(video),
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30).stdout
        data = json.loads(out)
        stream = data["streams"][0]
        w, h = int(stream["width"]), int(stream["height"])
        rotation = 0.0
        for sd in stream.get("side_data_list", []) or []:
            if "rotation" in sd:
                rotation = float(sd["rotation"])
        if not rotation and "rotate" in (stream.get("tags") or {}):
            rotation = float(stream["tags"]["rotate"])
        if round(abs(rotation)) % 180 == 90:
            w, h = h, w
        duration = float(data.get("format", {}).get("duration") or 0)
    except FileNotFoundError as e:
        raise RenderError(f"No se encontró '{cmd[0]}'. ¿Está FFmpeg instalado y en el PATH?") from e
    except (subprocess.SubprocessError, KeyError, IndexError, ValueError, json.JSONDecodeError) as e:
        raise RenderError("No se pudo leer el video original.") from e
    return SourceInfo(width=w, height=h, duration=duration)


def _enable(layer: LayerInput) -> str:
    """Expresión enable de FFmpeg para una capa con tiempos (vacía si dura todo el video)."""
    if layer.start is None and layer.end is None:
        return ""
    start = layer.start if layer.start is not None else 0
    end = f"{layer.end:.3f}" if layer.end is not None else "1e9"
    return f":enable='between(t,{start:.3f},{end})'"


def build_filter(
    fmt: str, background: str, src: SourceInfo, video: VideoTransform, layers: list[LayerInput]
) -> str:
    """Grafo de -filter_complex. Entrada 0 = video; entradas 1..N = capas PNG. Salida [out]."""
    w, h = FORMATS[fmt]
    base_w, base_h = contain_size(src.width, src.height, w, h)
    vw, vh = _even(base_w * video.scale), _even(base_h * video.scale)
    vx, vy = round(video.x - vw / 2), round(video.y - vh / 2)

    parts = ["[0:v]fps=30,split=2[bgsrc][fgsrc]"]
    if background == "blur":
        # El desenfoque se hace a 1/4 de resolución (mucho más rápido) y luego se reescala.
        bw, bh = _even(w / 4), _even(h / 4)
        parts.append(
            f"[bgsrc]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},"
            f"boxblur=10:2,scale={w}:{h},setsar=1[bg]"
        )
    else:
        parts.append(f"[bgsrc]scale={w}:{h},setsar=1,drawbox=c=black:t=fill[bg]")
    parts.append(f"[fgsrc]scale={vw}:{vh},setsar=1[fg]")
    parts.append(f"[bg][fg]overlay=x={vx}:y={vy}[v0]")

    for i, layer in enumerate(layers, start=1):
        parts.append(f"[v{i - 1}][{i}:v]overlay=0:0:format=auto{_enable(layer)}[v{i}]")
    parts.append(f"[v{len(layers)}]format=yuv420p[out]")
    return ";".join(parts)


def build_command(video: Path, layers: list[LayerInput], out: Path, filter_graph: str) -> list[str]:
    cmd = [settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(video)]
    for layer in layers:
        cmd += ["-i", str(layer.path)]
    cmd += [
        "-filter_complex", filter_graph,
        "-map", "[out]",
        "-map", "0:a?",            # el "?" evita fallar si el video no tiene audio
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        str(out),
    ]
    return cmd


def timeout_for(duration_s: float) -> int:
    # Holgado: ~4x la duración + margen fijo, con tope de 10 min.
    return int(min(600, 90 + duration_s * 4))


def _kill(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


async def run_ffmpeg(
    cmd: list[str], out: Path, timeout_s: int, is_cancelled: Callable[[], Awaitable[bool]] | None = None
) -> Path:
    """Lanza FFmpeg y lo vigila sin bloquear el event loop. Lo mata si se cancela o tarda demasiado."""
    with tempfile.TemporaryFile() as err:  # stderr a archivo: un PIPE lleno podría bloquear FFmpeg
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err)
        except FileNotFoundError as e:
            raise RenderError(f"No se encontró '{cmd[0]}'. ¿Está FFmpeg instalado y en el PATH?") from e

        deadline = time.monotonic() + timeout_s
        try:
            while proc.poll() is None:
                if is_cancelled is not None and await is_cancelled():
                    _kill(proc)
                    raise RenderCancelled()
                if time.monotonic() > deadline:
                    _kill(proc)
                    raise RenderError("El render tardó demasiado. Prueba con un video más corto.")
                await asyncio.sleep(0.25)
        except BaseException:
            # Cancelación, timeout o cualquier otra excepción (incluida CancelledError): no dejar FFmpeg vivo.
            _kill(proc)
            out.unlink(missing_ok=True)
            raise

        if proc.returncode != 0:
            err.seek(0)
            detail = err.read().decode("utf-8", "replace").strip()[-300:]
            out.unlink(missing_ok=True)
            raise RenderError(f"FFmpeg no pudo renderizar el video: {detail}")

    if not out.exists() or out.stat().st_size == 0:
        raise RenderError("FFmpeg no generó el archivo de salida.")
    return out


async def render(
    video: Path,
    out: Path,
    fmt: str,
    background: str,
    transform: VideoTransform | None,
    layers: list[LayerInput],
    is_cancelled: Callable[[], Awaitable[bool]] | None = None,
) -> Path:
    if fmt not in FORMATS:
        raise RenderError("Formato no válido.")
    if background not in BACKGROUNDS:
        raise RenderError("Fondo no válido.")
    if len(layers) > MAX_LAYERS:
        raise RenderError(f"Máximo {MAX_LAYERS} capas.")
    src = await asyncio.to_thread(probe_source, video)
    graph = build_filter(fmt, background, src, transform or default_transform(fmt), layers)
    cmd = build_command(video, layers, out, graph)
    return await run_ffmpeg(cmd, out, timeout_for(src.duration), is_cancelled)
