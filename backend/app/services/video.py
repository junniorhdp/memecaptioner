"""Todo lo relacionado con FFmpeg: duración y extracción de frames."""
from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path

from app.config import settings


class VideoError(Exception):
    """Error de procesamiento de video que se puede mostrar al usuario."""


def _run(cmd: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)
    except FileNotFoundError as e:
        raise VideoError(f"No se encontró '{cmd[0]}'. ¿Está FFmpeg instalado y en el PATH?") from e
    except subprocess.TimeoutExpired as e:
        raise VideoError("FFmpeg tardó demasiado procesando el video.") from e
    except subprocess.CalledProcessError as e:
        raise VideoError(f"FFmpeg falló: {e.stderr.strip()[-300:]}") from e


def probe_duration(video_path: Path) -> float:
    out = _run([
        settings.ffprobe_bin, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "format=duration",
        "-of", "json", str(video_path),
    ])
    try:
        duration = float(json.loads(out.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as e:
        raise VideoError("El archivo no parece un video válido.") from e
    if duration <= 0:
        raise VideoError("El video tiene duración 0.")
    return duration


def frame_timestamps(duration: float, count: int) -> list[float]:
    """Puntos equidistantes evitando el primer y último instante (suelen ser negros)."""
    step = duration / (count + 1)
    return [round(step * (i + 1), 3) for i in range(count)]


def extract_frames(video_path: Path, out_dir: Path, duration: float) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Path] = []
    for i, ts in enumerate(frame_timestamps(duration, settings.frame_count)):
        target = out_dir / f"frame_{i + 1:02d}.jpg"
        _run([
            settings.ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", str(ts),             # seek antes de -i = rápido
            "-i", str(video_path),
            "-frames:v", "1",
            "-vf", f"scale={settings.frame_width}:-2",
            "-q:v", "3",
            str(target),
        ])
        if not target.exists():
            raise VideoError(f"No se pudo extraer el frame en {ts}s.")
        frames.append(target)
    return frames


async def process_video(video_path: Path, frames_dir: Path) -> tuple[float, list[Path]]:
    """Versión async (FFmpeg corre en un hilo para no bloquear el event loop)."""
    duration = await asyncio.to_thread(probe_duration, video_path)
    if duration > settings.max_duration_s:
        raise VideoError(f"El video dura {duration:.0f}s; el máximo es {settings.max_duration_s:.0f}s.")
    frames = await asyncio.to_thread(extract_frames, video_path, frames_dir, duration)
    return duration, frames
