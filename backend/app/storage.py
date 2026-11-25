"""Almacenamiento local en disco: data/videos/<id>.mp4, data/frames/<id>/frame_XX.jpg
y data/renders/<id>_<formato>_<encaje>_<sufijo>.mp4."""
from __future__ import annotations

import re
import shutil
import time
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import settings

_ID_RE = re.compile(r"^[a-f0-9]{32}$")
CHUNK = 1024 * 1024


class UploadTooLarge(Exception):
    pass


def ensure_dirs() -> None:
    settings.videos_dir.mkdir(parents=True, exist_ok=True)
    settings.frames_dir.mkdir(parents=True, exist_ok=True)
    settings.renders_dir.mkdir(parents=True, exist_ok=True)


RENDER_TTL_S = 60 * 60  # los renders se borran tras 1 hora (ya se descargaron)


def render_path(video_id: str, fmt: str, variant: str) -> Path:
    return settings.renders_dir / f"{video_id}_{fmt}_{variant}_{uuid.uuid4().hex[:8]}.mp4"


def temp_overlay_path() -> Path:
    return settings.renders_dir / f"overlay_{uuid.uuid4().hex}.png"


def cleanup_renders(max_age_s: int = RENDER_TTL_S) -> None:
    """Borra renders y overlays temporales antiguos (no se borra el .gitkeep)."""
    limit = time.time() - max_age_s
    for p in settings.renders_dir.glob("*"):
        if p.suffix in (".mp4", ".png") and p.stat().st_mtime < limit:
            p.unlink(missing_ok=True)


def new_id() -> str:
    return uuid.uuid4().hex


def is_valid_id(video_id: str) -> bool:
    return bool(_ID_RE.match(video_id))


def video_path(video_id: str) -> Path:
    return settings.videos_dir / f"{video_id}.mp4"


def frames_path(video_id: str) -> Path:
    return settings.frames_dir / video_id


def list_frames(video_id: str) -> list[Path]:
    return sorted(frames_path(video_id).glob("frame_*.jpg"))


async def save_upload(file: UploadFile, dest: Path) -> int:
    """Guarda en streaming y corta si supera el límite. Devuelve bytes escritos."""
    limit = settings.max_upload_mb * 1024 * 1024
    written = 0
    with dest.open("wb") as fh:
        while chunk := await file.read(CHUNK):
            written += len(chunk)
            if written > limit:
                fh.close()
                dest.unlink(missing_ok=True)
                raise UploadTooLarge()
            fh.write(chunk)
    return written


def delete_video(video_id: str) -> None:
    video_path(video_id).unlink(missing_ok=True)
    shutil.rmtree(frames_path(video_id), ignore_errors=True)
    for p in settings.renders_dir.glob(f"{video_id}_*.mp4"):
        p.unlink(missing_ok=True)
