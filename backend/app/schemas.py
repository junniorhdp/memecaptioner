"""Modelos de entrada/salida de la API."""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Angle(str, Enum):
    panas = "panas"
    cotidiano = "cotidiano"
    absurdo = "absurdo"
    negro = "negro"
    shitpost = "shitpost"


class Tone(str, Enum):
    mixto = "mixto"          # 2 de panas, cotidiano y absurdo
    panas = "panas"
    cotidiano = "cotidiano"
    absurdo = "absurdo"
    negro = "negro"
    shitpost = "shitpost"
    caotico = "caotico"      # 2 de absurdo, negro y shitpost


class VideoUploaded(BaseModel):
    video_id: str
    video_url: str
    duration_s: float
    frame_urls: list[str]


class CaptionRequest(BaseModel):
    tone: Tone = Tone.mixto
    extra_context: str | None = Field(
        default=None, max_length=300, description="Pista opcional del usuario (ej. 'es mi perro')."
    )


class Caption(BaseModel):
    id: int
    angle: Angle
    text: str


class CaptionResponse(BaseModel):
    video_id: str
    tone: Tone
    model: str  # modelo que generó las captions (puede ser el de respaldo)
    scene_summary: str
    captions: list[Caption]


class ToneInfo(BaseModel):
    id: Tone
    label: str
    description: str


# ---------- Render (editor "Usar en video") ----------

class RenderLayerSpec(BaseModel):
    """Una capa ya rasterizada (PNG). start/end en segundos; None = todo el video (Fase 2)."""
    id: str = Field(max_length=64)
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _check_range(self) -> "RenderLayerSpec":
        if self.start is not None and self.end is not None and self.start >= self.end:
            raise ValueError("start debe ser menor que end")
        return self


class VideoTransformSpec(BaseModel):
    """Centro del video en px del lienzo final y escala relativa al encaje "contain" en el lienzo."""
    x: float
    y: float
    scale: float = Field(default=1.0, ge=0.1, le=5.0)


class RenderSpec(BaseModel):
    format: Literal["9x16", "4x5", "1x1"]
    background: Literal["blur", "black"] = "blur"
    video: VideoTransformSpec | None = None  # None = centrado y escala 1
    layers: list[RenderLayerSpec] = Field(default_factory=list, max_length=20)
