# MemeCaptioner

Herramienta web local: subes un .mp4 → FFmpeg extrae 5 frames equidistantes → un modelo con visión devuelve 6 captions tipo meme en español.

![MemeCaptioner: video a la izquierda y 6 captions generadas con el tono Caótico a la derecha](screenshots/02-escritorio-tarjetas.jpg)

Más capturas en [`screenshots/`](screenshots/) (estado vacío y vista móvil).

Proveedores de visión (variable `PROVIDER` en `.env`):

| `PROVIDER` | Qué necesita | Modelo por defecto |
|---|---|---|
| `gemini` (por defecto) | `GEMINI_API_KEY` (gratis en https://aistudio.google.com/apikey) | `GEMINI_MODEL=gemini-3.5-flash-lite`, respaldo ante 503: `GEMINI_FALLBACK_MODEL=gemini-2.5-flash` (otra generación, para que no se sature a la vez que el principal) |
| `ollama` | Ollama corriendo en local + `ollama pull <modelo>` con visión | `OLLAMA_MODEL=qwen2.5vl:7b`, `OLLAMA_URL=http://localhost:11434` |
| `anthropic` | `ANTHROPIC_API_KEY` | `VISION_MODEL=claude-sonnet-5-5` |

El nivel gratuito de Gemini tiene un límite de peticiones bajo: si se agota, la API responde 429 con *"Llegaste al límite gratuito de Gemini, espera un momento o intenta mañana"*.

## Estructura

```
memecaptioner/
├── .env.example
├── .gitignore
├── README.md
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # crea la app, monta /api, /media y el frontend
│       ├── config.py          # Settings desde .env
│       ├── schemas.py         # modelos Pydantic (Tone, Angle, Caption...)
│       ├── storage.py         # disco: data/videos y data/frames, ids, límites
│       ├── api/
│       │   └── routes.py      # endpoints (solo orquestan)
│       └── services/
│           ├── video.py       # ffprobe + ffmpeg (frames)
│           ├── captioner.py   # prompt, plan de ángulos y validación
│           ├── tones.py       # tonos, ángulos y reparto de captions
│           └── providers/     # un archivo por proveedor de visión
│               ├── __init__.py    # get_provider() según PROVIDER
│               ├── base.py        # interfaz Provider + JSON schema de salida
│               ├── gemini.py      # google-genai, salida JSON con response_schema
│               ├── ollama.py      # HTTP a /api/chat con "format"
│               └── anthropic.py   # Claude con tool use forzado
├── frontend/                  # sin build: Tailwind por CDN + JS vanilla
│   ├── index.html
│   ├── styles.css             # tema oscuro, animaciones, componentes
│   └── app.js                 # lógica de la interfaz (subida, tonos, captions, atajos)
├── screenshots/               # capturas para el README
└── data/
    ├── videos/                # <id>.mp4
    └── frames/                # <id>/frame_01.jpg ...
```

## Arrancar

Requisitos: Python 3.11+ y FFmpeg en el PATH (`ffmpeg -version`).

```bash
cp .env.example .env          # y pon tu GEMINI_API_KEY (o cambia PROVIDER)
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --reload-dir app
```

`--reload-dir app` hace que solo se vigile el código: sin él, el reloader vigila también `.venv/` (reinicios sin motivo) y en carpetas de OneDrive puede no detectar los cambios. Si cambias el `.env`, reinicia a mano.

Abre http://127.0.0.1:8000/docs para probar la API.

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | Estado, `provider`, `model` y si el proveedor tiene API key |
| GET | `/api/tones` | Lista de tonos para el selector |
| POST | `/api/videos` | `multipart` con `file` (.mp4). Guarda, extrae frames. Devuelve `video_id`, `video_url`, `duration_s`, `frame_urls` |
| POST | `/api/videos/{id}/captions` | Body `{"tone": "mixto\|panas\|cotidiano\|absurdo\|negro\|shitpost\|caotico", "extra_context": "opcional"}`. Devuelve `model` (el que respondió), `scene_summary` + 6 `captions` `{id, angle, text}`. Llamarlo otra vez = regenerar (reutiliza los frames) |
| DELETE | `/api/videos/{id}` | Borra video y frames |

Ángulos (`angle` de cada caption): `panas` (se muestra como «Amigos»), `cotidiano`, `absurdo`, `negro` y `shitpost`.

| Tono | Reparto de las 6 captions |
|---|---|
| `mixto` | 2 panas, 2 cotidiano, 2 absurdo |
| `caotico` | 2 absurdo, 2 negro, 2 shitpost |
| `panas`, `cotidiano`, `absurdo`, `negro`, `shitpost` | las 6 de ese ángulo |

En todos los tonos salvo `negro` y `shitpost` se pide al menos 1 POV y 1 diálogo.

Errores: 415 (no es .mp4), 413 (muy pesado), 422 (FFmpeg / duración en la subida; en captions, Gemini bloqueó la respuesta por sus filtros), 404, 429 (límite gratuito de Gemini agotado), 502 (falló el proveedor de visión), 503 (Gemini saturado: el principal y el de respaldo). Todos con `{"detail": "mensaje en español"}`.
