"""Modelos de entrada/salida de la API."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


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
