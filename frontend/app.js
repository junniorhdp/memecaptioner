// MemeCaptioner — frontend en JS vanilla (sin build). Habla con la API de /api.
"use strict";

/* =====================================================================
   1. Configuración
   ===================================================================== */

const CAPTION_COUNT = 6;
const DEFAULT_TONE = "mixto";

// Color de cada ángulo (texto brillante; el fondo se deriva en CSS con baja opacidad).
const ANGLES = {
  panas:     { label: "Amigos",    color: "#c4b5fd" }, // violeta claro
  cotidiano: { label: "Cotidiano", color: "#6ee7b7" }, // esmeralda
  absurdo:   { label: "Absurdo",   color: "#fda4af" }, // rosa
  negro:     { label: "Negro",     color: "#d4d4d8" }, // gris
  shitpost:  { label: "Shitpost",  color: "#fcd34d" }, // amarillo/naranja
};
const ANGLE_FALLBACK = { label: "", color: "#a78bfa" };

// Duraciones (ms) que el JS espera; deben coincidir con styles.css.
const MS = { viewLeave: 200, cardLeave: 180, cardStagger: 60, noticeOut: 160, toast: 1800, copied: 1500 };

const ICONS = {
  limit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>',
  copy: '<svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  check: '<svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.8 15.9 9 18.75l-.8-2.85a4.5 4.5 0 0 0-3.1-3.09L2.25 12l2.85-.81a4.5 4.5 0 0 0 3.1-3.1L9 5.25l.8 2.84a4.5 4.5 0 0 0 3.1 3.1l2.85.81-2.85.81a4.5 4.5 0 0 0-3.1 3.09ZM18.26 8.72 18 9.75l-.26-1.03a3.38 3.38 0 0 0-2.45-2.46L14.25 6l1.04-.26a3.38 3.38 0 0 0 2.45-2.45L18 2.25l.26 1.04a3.38 3.38 0 0 0 2.46 2.45L21.75 6l-1.03.26a3.38 3.38 0 0 0-2.46 2.46Z"/></svg>',
  toastOk: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  toastErr: '<path d="M6 6l12 12M18 6 6 18"/>',
};

/* =====================================================================
   2. Referencias al DOM
   ===================================================================== */

const $ = (id) => {
  const node = document.getElementById(id);
  if (!node) console.error(`[MemeCaptioner] Falta el elemento #${id} en index.html`);
  return node;
};

const el = {
  modelBadge: $("model-badge"), modelBadgeText: $("model-badge-text"),
  notice: $("notice"), noticeIcon: $("notice-icon"), noticeTitle: $("notice-title"),
  noticeText: $("notice-text"), noticeClose: $("notice-close"),
  fileInput: $("file-input"),
  uploadView: $("upload-view"), dropzone: $("dropzone"), dropIdle: $("dropzone-idle"),
  dropLoading: $("dropzone-loading"), uploadFilename: $("upload-filename"),
  workspaceView: $("workspace-view"), player: $("player"), fileName: $("file-name"),
  fileDuration: $("file-duration"), changeVideo: $("change-video"),
  controls: $("controls"), toneChips: $("tone-chips"), toneDesc: $("tone-desc"),
  extraContext: $("extra-context"), generateBtn: $("generate-btn"), generateIcon: $("generate-icon"),
  generateSpinner: $("generate-spinner"), generateLabel: $("generate-label"), modKey: $("mod-key"),
  cards: $("cards"), resultMeta: $("result-meta"), sceneSummary: $("scene-summary"), modelName: $("model-name"),
  toast: $("toast"), toastIcon: $("toast-icon"), toastText: $("toast-text"),
};

/* =====================================================================
   3. Estado
   ===================================================================== */

const state = {
  videoId: null,
  tone: DEFAULT_TONE,
  tones: [],          // [{id, label, description}] desde /api/tones
  uploading: false,
  generating: false,
  lastResult: null,   // última respuesta buena (se conserva si falla una regeneración)
  cardsMode: "empty", // "empty" | "loading" | "result"
  view: "upload",     // "upload" | "workspace"
};

/* =====================================================================
   4. Utilidades
   ===================================================================== */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** Reinicia una animación CSS de clase `cls` en `node`. */
function replayClass(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth; // fuerza reflow para que la animación vuelva a empezar
  node.classList.add(cls);
}

/** Quita la clase de animación al terminar (si no, `fill-mode: both` bloquea el hover). */
function clearOnAnimationEnd(node, cls) {
  node.addEventListener("animationend", () => node.classList.remove(cls), { once: true });
}

function formatDuration(s) {
  const total = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/* =====================================================================
   5. API
   ===================================================================== */

class ApiError extends Error {
  /** isValidation: `detail` venía como lista (error de validación de FastAPI). */
  constructor(status, message, isValidation = false) {
    super(message);
    this.status = status;
    this.isValidation = isValidation;
  }
}

/** Convierte el campo `detail` de FastAPI (texto o lista de validación) en un mensaje legible. */
function detailToMessage(detail) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body").join(".") : "";
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join(" · ");
  }
  return null;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError(0, "No se pudo conectar con el servidor. ¿Está corriendo uvicorn?");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  if (!res.ok) {
    const msg = detailToMessage(data && data.detail) || `Error inesperado del servidor (HTTP ${res.status}).`;
    throw new ApiError(res.status, msg, Array.isArray(data && data.detail));
  }
  return data;
}

/* =====================================================================
   6. Avisos
   ===================================================================== */

let noticeToken = 0;

/**
 * Ámbar ("limit") para 429, 503 y bloqueo por filtros; rojo ("error") para lo demás.
 * opts.captions = true cuando el error viene de generar captions: ahí un 422 con
 * `detail` en texto significa "bloqueado por filtros" (en la subida, 422 = error de FFmpeg).
 */
function showNotice(err, opts = {}) {
  noticeToken++;
  const status = err instanceof ApiError ? err.status : 0;
  const isBlocked = Boolean(opts.captions) && status === 422 && !err.isValidation;
  const kind = status === 429 || status === 503 || isBlocked ? "limit" : "error";
  const title =
    status === 429 ? "Límite de uso alcanzado"
    : status === 503 ? "Servicio saturado"
    : isBlocked ? "Respuesta bloqueada"
    : "Algo salió mal";

  el.notice.className = `notice notice--${kind}`;
  el.noticeIcon.innerHTML = ICONS[kind];
  el.noticeTitle.textContent = title;
  el.noticeText.textContent = err.message || "Error desconocido.";
  el.notice.hidden = false;
  replayClass(el.notice, "notice-in");
}

async function clearNotice() {
  if (el.notice.hidden) return;
  const token = ++noticeToken;
  el.notice.classList.remove("notice-in");
  el.notice.classList.add("notice-out");
  await wait(MS.noticeOut);
  if (token !== noticeToken) return; // se mostró otro aviso mientras se iba
  el.notice.hidden = true;
  el.notice.classList.remove("notice-out");
}

el.noticeClose.addEventListener("click", clearNotice);

/* =====================================================================
   7. Toast
   ===================================================================== */

let toastTimer = null;

function showToast(message, { error = false } = {}) {
  el.toastIcon.innerHTML = error ? ICONS.toastErr : ICONS.toastOk;
  el.toast.classList.toggle("is-error", error);
  el.toastText.textContent = message;
  el.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), MS.toast);
}

/* =====================================================================
   8. Vistas (sin video ↔ con video)
   ===================================================================== */

let viewToken = 0;

async function showView(name) {
  if (state.view === name) return;
  const token = ++viewToken;
  const from = name === "workspace" ? el.uploadView : el.workspaceView;
  const to = name === "workspace" ? el.workspaceView : el.uploadView;
  state.view = name;

  if (!from.hidden) {
    from.classList.remove("view-enter");
    from.classList.add("view-leave");
    await wait(MS.viewLeave);
    if (token !== viewToken) return;
    from.hidden = true;
    from.classList.remove("view-leave");
  }
  to.hidden = false;
  replayClass(to, "view-enter");
  clearOnAnimationEnd(to, "view-enter");
  if (name === "workspace") revealActiveChip({ smooth: false }); // el carrusel ya tiene medidas
}

/* =====================================================================
   9. Estado del servidor (badge del modelo)
   ===================================================================== */

async function loadHealth() {
  try {
    const h = await api("/api/health");
    if (!h.ok) {
      el.modelBadge.dataset.status = "error";
      el.modelBadgeText.textContent = h.detail || "Proveedor no válido";
      return;
    }
    el.modelBadge.dataset.status = h.api_key ? "ok" : "warn";
    el.modelBadgeText.textContent = h.api_key ? h.model : `${h.model} · sin API key`;
    el.modelBadge.title = `Proveedor: ${h.provider} · Modelo: ${h.model}`;
  } catch {
    el.modelBadge.dataset.status = "error";
    el.modelBadgeText.textContent = "Sin conexión";
  }
}

/* =====================================================================
   10. Tonos (chips)
   ===================================================================== */

async function loadTones() {
  try {
    state.tones = await api("/api/tones");
  } catch (err) {
    state.tones = [{ id: DEFAULT_TONE, label: "Mixto", description: "" }];
    showNotice(new ApiError(err.status, `No se pudieron cargar los tonos: ${err.message}`));
  }
  if (!state.tones.some((t) => t.id === state.tone)) state.tone = state.tones[0] ? state.tones[0].id : DEFAULT_TONE;
  renderChips();
}

function renderChips() {
  el.toneChips.innerHTML = "";
  for (const t of state.tones) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("role", "radio");
    chip.dataset.tone = t.id;
    chip.textContent = t.label;
    if (t.description) chip.title = t.description;
    chip.addEventListener("click", () => selectTone(t.id));
    el.toneChips.appendChild(chip);
  }
  syncChips();
  revealActiveChip({ smooth: false });
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Activa el desvanecido de los bordes si hay chips fuera de la vista (solo en móvil). */
function updateChipFades() {
  const box = el.toneChips;
  const max = box.scrollWidth - box.clientWidth;
  box.classList.toggle("fade-left", max > 4 && box.scrollLeft > 4);
  box.classList.toggle("fade-right", max > 4 && box.scrollLeft < max - 4);
}

/**
 * Desplaza solo el carrusel de chips (nunca la página) para que se vea el chip activo.
 * No hace nada si el carrusel está oculto o no tiene scroll (escritorio).
 */
function revealActiveChip({ smooth = true } = {}) {
  const box = el.toneChips;
  const chip = box.querySelector('.chip[aria-checked="true"]');
  if (chip && box.scrollWidth > box.clientWidth && box.clientWidth > 0) {
    const b = box.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const pad = 44; // deja ver el chip fuera de la zona desvanecida
    let delta = 0;
    if (c.left < b.left + pad) delta = c.left - b.left - pad;
    else if (c.right > b.right - pad) delta = c.right - b.right + pad;
    if (delta) box.scrollBy({ left: delta, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  }
  updateChipFades();
}

el.toneChips.addEventListener("scroll", updateChipFades, { passive: true });
window.addEventListener("resize", () => revealActiveChip({ smooth: false }));

function syncChips() {
  for (const chip of el.toneChips.querySelectorAll(".chip[data-tone]")) {
    const active = chip.dataset.tone === state.tone;
    chip.setAttribute("aria-checked", String(active));
    chip.tabIndex = active ? 0 : -1; // roving tabindex: Tab entra al chip activo
    chip.disabled = state.generating;
  }
  const tone = state.tones.find((t) => t.id === state.tone);
  el.toneDesc.textContent = tone ? tone.description : "";
}

function selectTone(id, { focus = false } = {}) {
  if (state.generating) return;
  state.tone = id;
  syncChips();
  const chip = el.toneChips.querySelector(`.chip[data-tone="${CSS.escape(id)}"]`);
  if (chip && focus) chip.focus({ preventScroll: true });
  revealActiveChip();
}

// Flechas / Inicio / Fin dentro del grupo de chips (patrón radiogroup).
el.toneChips.addEventListener("keydown", (e) => {
  const ids = state.tones.map((t) => t.id);
  const i = ids.indexOf(state.tone);
  if (i < 0 || !ids.length) return;
  let next = null;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = ids[(i + 1) % ids.length];
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = ids[(i - 1 + ids.length) % ids.length];
  else if (e.key === "Home") next = ids[0];
  else if (e.key === "End") next = ids[ids.length - 1];
  if (next) {
    e.preventDefault();
    selectTone(next, { focus: true });
  }
});

/* =====================================================================
   11. Subida de video
   ===================================================================== */

function isMp4(file) {
  return file && /\.mp4$/i.test(file.name) && (!file.type || file.type === "video/mp4");
}

function setUploading(on, filename = "") {
  state.uploading = on;
  el.changeVideo.disabled = on || state.generating;
  el.dropIdle.hidden = on;
  el.dropLoading.hidden = !on;
  el.uploadFilename.textContent = on ? filename : "";
  el.dropzone.classList.toggle("is-busy", on);
  el.dropzone.setAttribute("aria-busy", String(on));
}

async function uploadFile(file) {
  if (state.uploading || state.generating || !file) return;
  if (!isMp4(file)) {
    showNotice(new ApiError(415, "Solo se aceptan archivos .mp4."));
    return;
  }
  clearNotice();
  setUploading(true, file.name);
  el.player.pause();
  await showView("upload");

  const form = new FormData();
  form.append("file", file);
  try {
    const data = await api("/api/videos", { method: "POST", body: form });
    state.videoId = data.video_id;
    state.lastResult = null;
    el.player.src = data.video_url;
    el.fileName.textContent = file.name;
    el.fileName.title = file.name;
    el.fileDuration.textContent = `Duración ${formatDuration(data.duration_s)}`;
    renderEmpty();
    setGenerating(false); // deja el botón en "Generar"
    await showView("workspace");
  } catch (err) {
    showNotice(err);
    if (state.videoId) await showView("workspace"); // había un video antes: se vuelve a él
  } finally {
    setUploading(false);
    el.fileInput.value = "";
  }
}

function openFilePicker() {
  if (state.uploading || state.generating) return;
  el.fileInput.click();
}

el.dropzone.addEventListener("click", openFilePicker);
el.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openFilePicker();
  }
});
el.changeVideo.addEventListener("click", openFilePicker);
el.fileInput.addEventListener("change", () => uploadFile(el.fileInput.files[0]));

// Arrastrar y soltar: contador para que el resaltado no parpadee al pasar sobre los hijos.
let dragDepth = 0;
el.dropzone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (state.uploading) return;
  dragDepth++;
  el.dropzone.classList.add("is-dragover");
});
el.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = state.uploading ? "none" : "copy";
});
el.dropzone.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropzone.classList.remove("is-dragover");
});
el.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropzone.classList.remove("is-dragover");
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length > 1) {
    showNotice(new ApiError(400, "Sube un solo video a la vez."));
    return;
  }
  uploadFile(files && files[0]);
});
// Evita que el navegador abra el archivo si se suelta fuera de la zona.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

/* =====================================================================
   12. Generar captions
   ===================================================================== */

function setGenerating(on) {
  state.generating = on;
  el.generateBtn.disabled = on;
  el.extraContext.disabled = on;
  el.changeVideo.disabled = on || state.uploading;
  // toggleAttribute (no .hidden): el ícono es un <svg> y SVGElement no tiene la propiedad `hidden`.
  el.generateIcon.toggleAttribute("hidden", on);
  el.generateSpinner.toggleAttribute("hidden", !on);
  el.generateLabel.textContent = on ? "Generando…" : state.lastResult ? "Regenerar" : "Generar";
  el.cards.setAttribute("aria-busy", String(on));
  syncChips();
}

async function generate() {
  if (state.generating || state.uploading || !state.videoId) return; // evita dobles clics
  clearNotice();
  setGenerating(true);
  await fadeOutCards();
  renderSkeletons();

  const extra = el.extraContext.value.trim();
  try {
    const data = await api(`/api/videos/${state.videoId}/captions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone: state.tone, extra_context: extra || null }),
    });
    state.lastResult = data;
    renderResult(data);
  } catch (err) {
    showNotice(err, { captions: true });
    if (state.lastResult) renderResult(state.lastResult);
    else renderEmpty();
  } finally {
    setGenerating(false);
  }
}

el.controls.addEventListener("submit", (e) => {
  e.preventDefault();
  generate();
});

/* =====================================================================
   13. Render de tarjetas
   ===================================================================== */

/** Desvanece las tarjetas actuales (solo si hay resultados) antes de reemplazarlas. */
async function fadeOutCards() {
  el.resultMeta.hidden = true;
  if (state.cardsMode !== "result") return;
  for (const card of el.cards.children) {
    card.classList.remove("card-enter");
    card.classList.add("card-leave");
  }
  await wait(MS.cardLeave);
}

function renderEmpty() {
  state.cardsMode = "empty";
  el.resultMeta.hidden = true;
  el.cards.innerHTML = "";
  const box = document.createElement("div");
  box.className = "empty-state card-enter";
  box.innerHTML = `
    <span class="empty-state__icon">${ICONS.sparkles}</span>
    <p class="empty-state__title">Elige un tono y presiona «Generar»</p>
    <p class="text-muted text-sm">Las 6 captions aparecerán aquí.</p>`;
  clearOnAnimationEnd(box, "card-enter");
  el.cards.appendChild(box);
}

function renderSkeletons() {
  state.cardsMode = "loading";
  el.cards.innerHTML = "";
  for (let i = 0; i < CAPTION_COUNT; i++) {
    const card = document.createElement("div");
    card.className = "card card--skeleton";
    card.setAttribute("aria-hidden", "true");
    card.innerHTML = `
      <div class="card__head">
        <span class="skeleton" style="width:84px;height:22px;border-radius:999px"></span>
        <span class="skeleton" style="width:22px;height:20px;border-radius:6px"></span>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:9px">
        <span class="skeleton" style="height:15px;width:100%"></span>
        <span class="skeleton" style="height:15px;width:88%"></span>
        <span class="skeleton" style="height:15px;width:62%"></span>
      </div>
      <span class="skeleton" style="width:92px;height:32px;border-radius:12px"></span>`;
    el.cards.appendChild(card);
  }
}

function renderResult(data) {
  state.cardsMode = "result";
  el.cards.innerHTML = "";
  data.captions.forEach((caption, i) => el.cards.appendChild(buildCard(caption, i)));

  el.sceneSummary.textContent = data.scene_summary || "—";
  el.modelName.textContent = data.model || "—";
  el.resultMeta.style.setProperty("--delay", `${data.captions.length * MS.cardStagger}ms`);
  el.resultMeta.hidden = false;
  replayClass(el.resultMeta, "card-enter");
  clearOnAnimationEnd(el.resultMeta, "card-enter");
}

function buildCard(caption, index) {
  const angle = ANGLES[caption.angle] || { ...ANGLE_FALLBACK, label: caption.angle };
  const n = index + 1;

  const card = document.createElement("article");
  card.className = "card card-enter";
  card.style.setProperty("--angle", angle.color);
  card.style.setProperty("--delay", `${index * MS.cardStagger}ms`);
  card.setAttribute("aria-label", `Caption ${n}, ángulo ${angle.label}`);
  clearOnAnimationEnd(card, "card-enter");

  const head = document.createElement("div");
  head.className = "card__head";

  const badge = document.createElement("span");
  badge.className = "angle-badge";
  badge.textContent = angle.label;

  const num = document.createElement("kbd");
  num.className = "card__num";
  num.textContent = String(n);
  num.title = `Tecla ${n} para copiar`;

  head.append(badge, num);

  const text = document.createElement("p");
  text.className = "caption-text";
  text.textContent = caption.text; // textContent: el texto del modelo nunca se interpreta como HTML

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-copy";
  btn.dataset.index = String(index);
  btn.title = `Copiar (tecla ${n})`;
  btn.innerHTML = `${ICONS.copy}${ICONS.check}<span class="btn-copy__label">Copiar</span>`;
  btn.addEventListener("click", () => copyCaption(index));

  card.append(head, text, btn);
  return card;
}

/* =====================================================================
   14. Copiar
   ===================================================================== */

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Respaldo para navegadores sin acceso al portapapeles.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

async function copyCaption(index) {
  if (state.cardsMode !== "result" || !state.lastResult) return;
  const caption = state.lastResult.captions[index];
  if (!caption) return;
  const btn = el.cards.querySelector(`.btn-copy[data-index="${index}"]`);

  const ok = await writeClipboard(caption.text);
  showToast(ok ? "¡Copiado!" : "No se pudo copiar", { error: !ok });
  if (!btn) return;

  const label = btn.querySelector(".btn-copy__label");
  if (ok) {
    btn.classList.add("is-copied");
    replayClass(btn, "pop");
    clearOnAnimationEnd(btn, "pop");
    label.textContent = "Copiado";
  }
  clearTimeout(btn._timer);
  btn._timer = setTimeout(() => {
    btn.classList.remove("is-copied");
    label.textContent = "Copiar";
  }, MS.copied);
}

/* =====================================================================
   15. Atajos de teclado
   ===================================================================== */

document.addEventListener("keydown", (e) => {
  // Ctrl/⌘ + Enter: generar o regenerar (también desde el campo de contexto).
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    if (state.view === "workspace") {
      e.preventDefault();
      generate();
    }
    return;
  }

  // Esc: cerrar el aviso.
  if (e.key === "Escape" && !el.notice.hidden) {
    clearNotice();
    return;
  }

  // 1–6: copiar la caption correspondiente (no mientras se escribe).
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
  if (/^[1-9]$/.test(e.key)) {
    const index = Number(e.key) - 1;
    if (index < CAPTION_COUNT && state.cardsMode === "result") {
      e.preventDefault();
      copyCaption(index);
    }
  }
});

/* =====================================================================
   16. Inicio
   ===================================================================== */

el.modKey.textContent = isMac ? "⌘" : "Ctrl";
setGenerating(false);
loadHealth();
loadTones();
