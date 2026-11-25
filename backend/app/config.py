"""Configuración central. Todo sale de variables de entorno (.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # python-dotenv es opcional
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

ROOT_DIR = Path(__file__).resolve().parents[2]  # .../memecaptioner


@dataclass(frozen=True)
class Settings:
    # Proveedor de visión: gemini | ollama | anthropic
    provider: str = field(default_factory=lambda: os.getenv("PROVIDER", "gemini").strip().lower())

    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"))
    # Se usa UNA vez si el principal responde 503 (saturado). Vacío = sin respaldo.
    gemini_fallback_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")
    )

    ollama_url: str = field(default_factory=lambda: os.getenv("OLLAMA_URL", "http://localhost:11434"))
    ollama_model: str = field(default_factory=lambda: os.getenv("OLLAMA_MODEL", "qwen2.5vl:7b"))

    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    vision_model: str = field(default_factory=lambda: os.getenv("VISION_MODEL", "claude-sonnet-5-5"))  # modelo de Claude

    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", ROOT_DIR / "data")))
    frontend_dir: Path = ROOT_DIR / "frontend"

    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "100")))
    max_duration_s: float = field(default_factory=lambda: float(os.getenv("MAX_DURATION_S", "180")))
    frame_count: int = field(default_factory=lambda: int(os.getenv("FRAME_COUNT", "5")))
    frame_width: int = field(default_factory=lambda: int(os.getenv("FRAME_WIDTH", "768")))
    caption_count: int = field(default_factory=lambda: int(os.getenv("CAPTION_COUNT", "6")))

    ffmpeg_bin: str = field(default_factory=lambda: os.getenv("FFMPEG_BIN", "ffmpeg"))
    ffprobe_bin: str = field(default_factory=lambda: os.getenv("FFPROBE_BIN", "ffprobe"))

    @property
    def videos_dir(self) -> Path:
        return self.data_dir / "videos"

    @property
    def frames_dir(self) -> Path:
        return self.data_dir / "frames"

    @property
    def renders_dir(self) -> Path:
        return self.data_dir / "renders"


settings = Settings()
