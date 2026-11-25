"""Endpoints HTTP. Solo orquestan: la lógica vive en services/ y storage."""
from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

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
from app.services.render import FITS, FORMATS, MAX_BAND_RATIO, RenderError, png_size, render_video_async
from app.services.video import VideoError, probe_duration, process_video

MAX_OVERLAY_BYTES = 8 * 1024 * 1024  # el PNG del texto (casi todo transparente) suele pesar < 1 MB

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


@router.post("/videos/{video_id}/render")
async def render_video(
    video_id: str,
    overlay: UploadFile = File(..., description="PNG transparente del tamaño exacto del formato"),
    fmt: str = Form(..., alias="format", description="9x16 | 4x5 | 1x1"),
    fit: str = Form("blur", description="blur | crop"),
    band_height: int = Form(0, description="Alto en px de la franja superior (estilo Banda TikTok); 0 = sin franja"),
) -> FileResponse:
    """Renderiza el video en formato vertical/cuadrado con el texto encima y lo devuelve como descarga."""
    _require_video(video_id)
    try:
        if fmt not in FORMATS:
            raise HTTPException(422, "Formato no válido. Usa 9x16, 4x5 o 1x1.")
        if fit not in FITS:
            raise HTTPException(422, "Encaje no válido. Usa blur (fondo difuminado) o crop (recortar).")
        width, height = FORMATS[fmt]
        if not 0 <= band_height <= int(height * MAX_BAND_RATIO):
            raise HTTPException(422, f"La franja debe medir entre 0 y {int(height * MAX_BAND_RATIO)} px.")

        data = await overlay.read(MAX_OVERLAY_BYTES + 1)
        if len(data) > MAX_OVERLAY_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"La imagen del texto pesa demasiado (máximo {MAX_OVERLAY_BYTES // (1024 * 1024)} MB).",
            )
        size = png_size(data)
        if overlay.content_type not in ("image/png", "application/octet-stream") or size is None:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "El texto debe enviarse como imagen PNG.")
        if size != (width, height):
            raise HTTPException(
                422, f"La imagen del texto debe medir {width}x{height} px para {fmt} (llegó {size[0]}x{size[1]})."
            )
    finally:
        await overlay.close()

    storage.cleanup_renders()
    video = storage.video_path(video_id)
    tmp_png = storage.temp_overlay_path()
    out = storage.render_path(video_id, fmt, fit)
    try:
        tmp_png.write_bytes(data)
        duration = await asyncio.to_thread(probe_duration, video)
        await render_video_async(video, tmp_png, out, fmt, fit, band_height, duration)
    except VideoError as e:
        raise HTTPException(422, str(e))
    except RenderError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))
    finally:
        tmp_png.unlink(missing_ok=True)

    filename = f"memecaptioner_{fmt}_{datetime.now():%Y-%m-%d_%H%M}.mp4"
    return FileResponse(out, media_type="video/mp4", filename=filename)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_video(video_id: str) -> None:
    _require_video(video_id)
    storage.delete_video(video_id)
