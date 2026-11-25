"""Endpoints HTTP. Solo orquestan: la lógica vive en services/ y storage."""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app import storage
from app.config import settings
from app.schemas import CaptionRequest, CaptionResponse, ToneInfo, VideoUploaded
from app.services.captioner import (
    CaptionBlocked,
    CaptionError,
    CaptionOverloaded,
    CaptionRateLimited,
    generate_captions,
)
from app.services.providers import ProviderError, get_provider
from app.services.tones import TONES
from app.services.video import VideoError, process_video

router = APIRouter(prefix="/api")

ALLOWED_TYPES = {"video/mp4", "application/octet-stream"}


def _frame_urls(video_id: str) -> list[str]:
    return [f"/media/frames/{video_id}/{p.name}" for p in storage.list_frames(video_id)]


def _require_video(video_id: str) -> None:
    if not storage.is_valid_id(video_id) or not storage.video_path(video_id).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video no encontrado.")


@router.get("/health")
async def health() -> dict:
    try:
        provider = get_provider()
    except ProviderError as e:
        return {"ok": False, "provider": settings.provider, "model": None, "api_key": False, "detail": str(e)}
    return {"ok": True, "provider": provider.name, "model": provider.model, "api_key": provider.configured}


@router.get("/tones", response_model=list[ToneInfo])
async def list_tones() -> list[ToneInfo]:
    return list(TONES.values())


@router.post("/videos", response_model=VideoUploaded, status_code=status.HTTP_201_CREATED)
async def upload_video(file: UploadFile = File(...)) -> VideoUploaded:
    if not (file.filename or "").lower().endswith(".mp4") or file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Solo se aceptan archivos .mp4.")

    video_id = storage.new_id()
    dest = storage.video_path(video_id)
    try:
        await storage.save_upload(file, dest)
        duration, _ = await process_video(dest, storage.frames_path(video_id))
    except storage.UploadTooLarge:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Máximo {settings.max_upload_mb} MB."
        )
    except VideoError as e:
        storage.delete_video(video_id)
        raise HTTPException(422, str(e))
    finally:
        await file.close()

    return VideoUploaded(
        video_id=video_id,
        video_url=f"/media/videos/{video_id}.mp4",
        duration_s=round(duration, 2),
        frame_urls=_frame_urls(video_id),
    )


@router.post("/videos/{video_id}/captions", response_model=CaptionResponse)
async def create_captions(video_id: str, body: CaptionRequest) -> CaptionResponse:
    """Genera (o regenera) captions. Reutiliza los frames ya extraídos."""
    _require_video(video_id)
    frames = storage.list_frames(video_id)
    if not frames:
        raise HTTPException(status.HTTP_409_CONFLICT, "El video no tiene frames extraídos.")
    try:
        summary, captions, model = await generate_captions(frames, body.tone, body.extra_context)
    except CaptionRateLimited as e:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(e))
    except CaptionOverloaded as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except CaptionBlocked as e:
        raise HTTPException(422, str(e))
    except CaptionError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return CaptionResponse(
        video_id=video_id, tone=body.tone, model=model, scene_summary=summary, captions=captions
    )


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_video(video_id: str) -> None:
    _require_video(video_id)
    storage.delete_video(video_id)
