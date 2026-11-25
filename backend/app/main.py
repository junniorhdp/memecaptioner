"""Punto de entrada: `uvicorn app.main:app --reload` desde la carpeta backend/."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import storage
from app.api.routes import router
from app.config import settings

storage.ensure_dirs()

app = FastAPI(title="MemeCaptioner", version="0.1.0")
app.include_router(router)

# Archivos generados (video para el <video> y frames para depurar)
app.mount("/media/videos", StaticFiles(directory=settings.videos_dir), name="videos")
app.mount("/media/frames", StaticFiles(directory=settings.frames_dir), name="frames")

# Frontend estático (index.html, app.js). Va al final para no tapar /api.
app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
