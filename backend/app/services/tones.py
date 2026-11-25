"""Definición de tonos/ángulos y cómo se reparten las captions."""
from __future__ import annotations

from app.schemas import Angle, Tone, ToneInfo

ANGLE_GUIDE: dict[Angle, str] = {
    Angle.panas: (
        "Humor entre amigos: complicidad, planes, lealtad y traiciones del grupo "
        "('cuando tu mejor amigo...', 'yo y mis amigos...'). Sin jerga regional."
    ),
    Angle.cotidiano: (
        "Humor cotidiano y relatable: trabajo, estudio, familia, lunes, la mamá, el jefe, "
        "situaciones con las que cualquiera se identifica ('yo cuando...', 'nadie: / yo:')."
    ),
    Angle.absurdo: (
        "Humor absurdo/surrealista: giros inesperados, lógica rota, exageración extrema, "
        "pero que siga conectado con lo que se ve en el video."
    ),
    Angle.negro: (
        "Humor negro lo más oscuro posible dentro de las reglas: la muerte (la propia, funerales, "
        "testamentos), nihilismo, el vacío existencial, la indiferencia del universo, la vida como "
        "castigo, la desgracia extrema, envejecer, la pobreza y el trabajo como pequeñas muertes "
        "diarias. Debe dar risa e incomodar un poco a la vez. Directo y seco, sin suavizar el remate."
    ),
    Angle.shitpost: (
        "Shitpost: humor de internet sin lógica, non sequitur, intencionalmente de bajo esfuerzo "
        "o irónico. Frases cortas y secas ('no hay contexto', 'mood', 'este es el video'). "
        "Puede ir en minúsculas y sin puntuación si queda más gracioso."
    ),
}

TONES: dict[Tone, ToneInfo] = {
    Tone.mixto: ToneInfo(id=Tone.mixto, label="Mixto", description="2 de amigos, cotidiano y absurdo"),
    Tone.panas: ToneInfo(id=Tone.panas, label="Amigos", description="Complicidad entre amigos"),
    Tone.cotidiano: ToneInfo(id=Tone.cotidiano, label="Cotidiano", description="Relatable del día a día"),
    Tone.absurdo: ToneInfo(id=Tone.absurdo, label="Absurdo", description="Surrealista e inesperado"),
    Tone.negro: ToneInfo(id=Tone.negro, label="Negro", description="Desgracia, mala suerte y fatalismo"),
    Tone.shitpost: ToneInfo(id=Tone.shitpost, label="Shitpost", description="Sin lógica, seco e irónico"),
    Tone.caotico: ToneInfo(id=Tone.caotico, label="Caótico", description="2 de absurdo, negro y shitpost"),
}

# Tonos que mezclan ángulos: se reparten en ciclo (con 6 captions = 2 de cada uno).
MIXED_TONES: dict[Tone, list[Angle]] = {
    Tone.mixto: [Angle.panas, Angle.cotidiano, Angle.absurdo],
    Tone.caotico: [Angle.absurdo, Angle.negro, Angle.shitpost],
}

# Tonos a los que NO se les exige al menos 1 POV y 1 diálogo.
FREE_FORMAT_TONES: set[Tone] = {Tone.negro, Tone.shitpost}


def angle_plan(tone: Tone, total: int) -> list[Angle]:
    """Devuelve qué ángulo debe tener cada caption (en orden)."""
    angles = MIXED_TONES.get(tone)
    if angles:
        return [angles[i % len(angles)] for i in range(total)]
    return [Angle(tone.value)] * total
