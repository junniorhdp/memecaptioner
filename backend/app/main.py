"""Punto de entrada: `uvicorn app.main:app --reload` desde la carpeta backend/."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import storage
from app.api.routes import router
from app.config import settings

storage.ensure_dirs()


class FrontendFiles(StaticFiles):
    """Sirve el frontend con "Cache-Control: no-cache": el navegador revalida (ETag → 304 si no cambió)
    en vez de usar una copia vieja de app.js / editor.js / styles.css tras actualizar el código."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response

app = FastAPI(title="MemeCaptioner", version="0.1.0")
app.include_router(router)

# Archivos generados (video para el <video> y frames para depurar)
app.mount("/media/videos", StaticFiles(directory=settings.videos_dir), name="videos")
app.mount("/media/frames", StaticFiles(directory=settings.frames_dir), name="frames")

# Frontend estático (index.html, app.js). Va al final para no tapar /api.
app.mount("/", FrontendFiles(directory=settings.frontend_dir, html=True), name="frontend")
