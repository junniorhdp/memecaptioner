"""Almacenamiento local en disco: data/videos/<id>.mp4 y data/frames/<id>/frame_XX.jpg."""
from __future__ import annotations

import re
import shutil
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
