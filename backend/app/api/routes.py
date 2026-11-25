"""Endpoints HTTP. Solo orquestan: la lógica vive en services/ y storage."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import ValidationError

from app import storage
from app.config import settings
from app.schemas import CaptionRequest, CaptionResponse, RenderSpec, ToneInfo, VideoUploaded
from app.services.captioner import (
    CaptionBlocked,
    CaptionError,
    CaptionOverloaded,
    CaptionRateLimited,
    generate_captions,
)
from app.services.providers import ProviderError, get_provider
from app.services.tones import TONES
from app.services import render as renderer
from app.services.video import VideoError, process_video

MAX_LAYER_BYTES = 8 * 1024 * 1024  # cada capa es un PNG casi todo transparente: suele pesar < 1 MB

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
    request: Request,
    video_id: str,
    spec: str = Form(..., description="JSON: {format, background, video: {x, y, scale}, layers: [{id, start, end}]}"),
    layers: list[UploadFile] | None = File(None, description="Un PNG transparente por capa, en el mismo orden que spec.layers"),
) -> Response:
    """Renderiza el video con las capas del editor y lo devuelve como descarga.

    Si el cliente cancela (cierra el editor o aborta la descarga), FFmpeg se mata al momento.
    """
    _require_video(video_id)
    files = layers or []
    try:
        try:
            cfg = RenderSpec.model_validate_json(spec)
        except ValidationError as e:
            first = e.errors()[0]
            where = ".".join(str(p) for p in first.get("loc", ()))
            raise HTTPException(422, f"Configuración de render no válida ({where}): {first.get('msg', '')}")

        width, height = renderer.FORMATS[cfg.format]
        if cfg.video and not (-10 * width <= cfg.video.x <= 11 * width and -10 * height <= cfg.video.y <= 11 * height):
            raise HTTPException(422, "La posición del video está fuera de rango.")
        if len(files) != len(cfg.layers):
            raise HTTPException(422, f"Llegaron {len(files)} imágenes de capa pero la configuración describe {len(cfg.layers)}.")

        payloads: list[bytes] = []
        for i, f in enumerate(files, start=1):
            data = await f.read(MAX_LAYER_BYTES + 1)
            if len(data) > MAX_LAYER_BYTES:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    f"La capa {i} pesa demasiado (máximo {MAX_LAYER_BYTES // (1024 * 1024)} MB).",
                )
            size = renderer.png_size(data)
            if f.content_type not in ("image/png", "application/octet-stream") or size is None:
                raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"La capa {i} debe enviarse como imagen PNG.")
            if size != (width, height):
                raise HTTPException(
                    422, f"La capa {i} debe medir {width}x{height} px para {cfg.format} (llegó {size[0]}x{size[1]})."
                )
            payloads.append(data)
    finally:
        for f in files:
            await f.close()

    storage.cleanup_renders()
    out = storage.render_path(video_id, cfg.format, cfg.background)
    tmp_paths = [storage.temp_overlay_path() for _ in payloads]
    try:
        for path, data in zip(tmp_paths, payloads):
            path.write_bytes(data)
        layer_inputs = [
            renderer.LayerInput(path=path, start=spec_layer.start, end=spec_layer.end)
            for path, spec_layer in zip(tmp_paths, cfg.layers)
        ]
        transform = renderer.VideoTransform(**cfg.video.model_dump()) if cfg.video else None
        await renderer.render(
            storage.video_path(video_id), out, cfg.format, cfg.background, transform, layer_inputs,
            is_cancelled=request.is_disconnected,
        )
    except renderer.RenderCancelled:
        return Response(status_code=499)  # el cliente ya no escucha; FFmpeg ya se mató
    except renderer.RenderError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))
    finally:
        for path in tmp_paths:
            path.unlink(missing_ok=True)

    filename = f"memecaptioner_{cfg.format}_{datetime.now():%Y-%m-%d_%H%M}.mp4"
    return FileResponse(out, media_type="video/mp4", filename=filename)


@router.delete("/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_video(video_id: str) -> None:
    _require_video(video_id)
    storage.delete_video(video_id)
