// MemeCaptioner — editor de video estilo CapCut/TikTok (Fase 1) sobre Konva.js.
// Depende de app.js (state, el, showToast, ApiError, detailToMessage, wait, replayClass).
//
// El editor trabaja sobre un documento JSON (ver makeDoc / newTextLayer):
//   { format, background, video: {x, y, scale}, layers: [...] }
// - Coordenadas en px del lienzo FINAL (1080 de ancho); el Stage de Konva solo se escala para verse.
// - Cada capa se exporta como PNG del tamaño final con el mismo motor (Konva) que la vista previa.
// - start/end de cada capa quedan en null en la Fase 1 (= todo el video); el backend ya los admite.
"use strict";

const Editor = (() => {
  /* ===================================================================
     1. Configuración
     =================================================================== */

  const FORMATS = {
    "9x16": { w: 1080, h: 1920, label: "9:16" },
    "4x5":  { w: 1080, h: 1350, label: "4:5" },
    "1x1":  { w: 1080, h: 1080, label: "1:1" },
  };

  // Zona que tapa la interfaz de TikTok en 9:16 (px del lienzo 1080×1920).
  // ÚNICO lugar donde ajustar estos valores: los usan el sombreado, las guías y los presets.
  const TIKTOK_SAFE = { top: 160, right: 170, bottom: 440 };

  const EDGE_MARGIN = 60;   // guías magnéticas a los márgenes del lienzo
  const SNAP_PX = 8;        // distancia de enganche, en px de pantalla
  const HISTORY_LIMIT = 80;
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5;

  const FONTS = [
    { family: "Anton", label: "Anton", weights: ["400"] },
    { family: "Inter", label: "Inter", weights: ["400", "600", "700", "800"] },
    { family: "Bricolage Grotesque", label: "Bricolage Grotesque", weights: ["500", "600", "700", "800"] },
    { family: "Caveat", label: "Caveat (manuscrita)", weights: ["400", "600", "700"] },
    { family: "Pixelify Sans", label: "Pixelify Sans (pixel)", weights: ["400", "600", "700"] },
  ];
  const WEIGHT_LABELS = { 400: "Normal", 500: "Medio", 600: "Semi", 700: "Negrita", 800: "Extra" };
  const PALETTE = [
    { color: "#ffffff", name: "Blanco" },
    { color: "#000000", name: "Negro" },
    { color: "#8b5cf6", name: "Morado" },
    { color: "#facc15", name: "Amarillo" },
    { color: "#ef4444", name: "Rojo" },
  ];
  const UI = { accent: "#a78bfa", accentStrong: "#8b5cf6", guide: "#c084fc", danger: "rgba(244, 63, 94, 0.22)" };

  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    eye: ICON('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: ICON('<path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    up: ICON('<path d="m6 15 6-6 6 6"/>'),
    down: ICON('<path d="m6 9 6 6 6-6"/>'),
    copy: ICON('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    trash: ICON('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  };

  /* ===================================================================
     2. Referencias al DOM
     =================================================================== */

  const byId = (id) => document.getElementById(id);
  const dom = {
    root: byId("editor"), backdrop: byId("editor-backdrop"), panel: byId("editor-panel"), close: byId("editor-close"),
    undo: byId("ed-undo"), redo: byId("ed-redo"), addText: byId("ed-add-text"), safe: byId("ed-safe"), format: byId("ed-format"),
    area: byId("ed-canvas-area"), frame: byId("ed-frame"), stage: byId("ed-stage"), bgVideo: byId("ed-bgvideo"), inline: byId("ed-inline"),
    play: byId("ed-play"), playIconPause: byId("ed-play-icon-pause"), playIconPlay: byId("ed-play-icon-play"),
    zoom: byId("ed-zoom"), zoomValue: byId("ed-zoom-value"), centerVideo: byId("ed-center-video"), bgMode: byId("ed-bgmode"),
    sheet: byId("ed-sheet"), sheetHandle: byId("ed-sheet-handle"), presets: byId("ed-presets"), layers: byId("ed-layers"),
    styleEmpty: byId("ed-style-empty"), styleFields: byId("ed-style-fields"),
    font: byId("ed-font"), weight: byId("ed-weight"), size: byId("ed-size"), sizeValue: byId("ed-size-value"),
    fill: byId("ed-fill"), stroke: byId("ed-stroke"), strokeWidth: byId("ed-stroke-width"), strokeWidthValue: byId("ed-stroke-width-value"),
    bgOn: byId("ed-bg-on"), bgFields: byId("ed-bg-fields"), bg: byId("ed-bg"),
    bgOpacity: byId("ed-bg-opacity"), bgOpacityValue: byId("ed-bg-opacity-value"),
    bgRadius: byId("ed-bg-radius"), bgRadiusValue: byId("ed-bg-radius-value"),
    bgPadding: byId("ed-bg-padding"), bgPaddingValue: byId("ed-bg-padding-value"),
    shadow: byId("ed-shadow"), align: byId("ed-align"), rectFill: byId("ed-rect-fill"),
    opacity: byId("ed-opacity"), opacityValue: byId("ed-opacity-value"),
    error: byId("ed-error"), errorText: byId("ed-error-text"), progress: byId("ed-progress"), progressText: byId("ed-progress-text"),
    cancel: byId("ed-cancel"), download: byId("ed-download"), downloadIcon: byId("ed-download-icon"),
    downloadSpinner: byId("ed-download-spinner"), downloadLabel: byId("ed-download-label"),
  };

  // Video principal (fuente del Konva.Image). Va en el DOM pero invisible: así Chrome lo decodifica siempre.
  const fgVideo = document.createElement("video");
  Object.assign(fgVideo, { muted: true, loop: true, playsInline: true, preload: "auto" });
  fgVideo.setAttribute("aria-hidden", "true");
  fgVideo.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px";
  document.body.appendChild(fgVideo);

  /* ===================================================================
     3. Documento, historial y utilidades
     =================================================================== */

  let doc = makeDoc("9x16");
  let selectedId = null;
  const history = { past: [], future: [], lastTag: null, lastTime: 0 };
  let txBefore = null;          // cambio "en curso" (sliders, color picker): un solo paso de historial
  let safeVisible = false;
  let initialized = false;
  let k = 1;                    // escala de pantalla del Stage
  let returnFocus = null;
  let render = { abort: null, tick: null, busy: false };
  let fontsReady = null;

  const uid = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const even = (n) => Math.max(2, Math.ceil(n / 2) * 2);
  const fmt = () => FORMATS[doc.format];
  const fontString = (family) => `"${family}", sans-serif`;
  const isMobile = () => window.matchMedia("(max-width: 899px)").matches;
  const hexToRgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  function makeDoc(format) {
    const { w, h } = FORMATS[format];
    return { format, background: "blur", video: { x: w / 2, y: h / 2, scale: 1 }, layers: [] };
  }

  function newTextLayer(over = {}) {
    const { w, h } = fmt();
    return {
      id: uid(), type: "text", text: "Texto",
      x: 140, y: h / 2 - 60, rotation: 0, width: w - 280,
      fontFamily: "Inter", fontWeight: "700", fontSize: 80, lineHeight: 1.15,
      fill: "#ffffff", stroke: "#000000", strokeWidth: 0,
      bg: null, bgOpacity: 1, bgRadius: 16, bgPadding: 20,
      shadow: true, opacity: 1, align: "center", hidden: false,
      start: null, end: null,
      ...over,
    };
  }

  function newBandLayer(height) {
    return { id: uid(), type: "rect", role: "band", x: 0, y: 0, rotation: 0, width: fmt().w, height, fill: "#ffffff", opacity: 1, hidden: false, start: null, end: null };
  }

  const snapshot = () => JSON.stringify(doc);
  const layerById = (id) => doc.layers.find((l) => l.id === id) || null;
  const selectedLayer = () => (selectedId ? layerById(selectedId) : null);

  function pushHistory(before, tag = null) {
    if (before === snapshot()) return;
    const now = Date.now();
    // Cambios seguidos del mismo tipo (flechas, rueda) se agrupan en un solo paso.
    if (!(tag && tag === history.lastTag && now - history.lastTime < 700)) {
      history.past.push(before);
      if (history.past.length > HISTORY_LIMIT) history.past.shift();
    }
    history.future = [];
    history.lastTag = tag;
    history.lastTime = now;
    syncHistoryButtons();
  }

  function beginChange() { if (txBefore === null) txBefore = snapshot(); }
  function endChange() { if (txBefore !== null) { pushHistory(txBefore); txBefore = null; } }

  /** Aplica fn al documento como un paso de historial (o agrupado por tag). */
  function mutate(fn, tag = null) {
    const before = snapshot();
    fn();
    pushHistory(before, tag);
    refresh();
  }

  function undo() {
    endChange();
    if (!history.past.length) return;
    history.future.push(snapshot());
    doc = JSON.parse(history.past.pop());
    history.lastTag = null;
    afterDocReplaced();
  }

  function redo() {
    endChange();
    if (!history.future.length) return;
    history.past.push(snapshot());
    doc = JSON.parse(history.future.pop());
    history.lastTag = null;
    afterDocReplaced();
  }

  function afterDocReplaced() {
    if (selectedId && !layerById(selectedId)) selectedId = null;
    fitStage();
    refresh();
    syncHistoryButtons();
  }

  function syncHistoryButtons() {
    dom.undo.disabled = !history.past.length;
    dom.redo.disabled = !history.future.length;
  }

  /* ===================================================================
     4. Konva: escenario, video y nodos de capa
     =================================================================== */

  let stage, videoLayer, contentLayer, uiLayer, videoNode, transformer, guidesGroup, safeGroup, videoAnim;

  function initStage() {
    stage = new Konva.Stage({ container: dom.stage, width: 300, height: 500 });
    videoLayer = new Konva.Layer();
    contentLayer = new Konva.Layer();
    uiLayer = new Konva.Layer({ listening: false });
    stage.add(videoLayer, contentLayer, uiLayer);

    videoNode = new Konva.Image({ image: fgVideo, name: "video", draggable: true });
    videoLayer.add(videoNode);
    videoAnim = new Konva.Animation(() => {}, videoLayer);

    transformer = new Konva.Transformer({
      borderStroke: UI.accent, borderStrokeWidth: 1.5,
      anchorStroke: UI.accentStrong, anchorFill: "#ffffff", anchorSize: 11, anchorCornerRadius: 6,
      rotateAnchorOffset: 34, rotationSnaps: [0, 90, 180, 270], rotationSnapTolerance: 6,
      ignoreStroke: true,
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 24 || Math.abs(newBox.height) < 16 ? oldBox : newBox),
    });
    contentLayer.add(transformer);

    guidesGroup = new Konva.Group();
    safeGroup = new Konva.Group({ visible: false });
    uiLayer.add(safeGroup, guidesGroup);

    bindVideoNode();
    bindStageEvents();
    new ResizeObserver(() => { if (isOpen()) fitStage(); }).observe(dom.area);
  }

  /** Ajusta el Stage al espacio disponible manteniendo el tamaño lógico del formato. */
  function fitStage() {
    if (!stage) return;
    const { w, h } = fmt();
    const pad = 24;
    const aw = Math.max(80, dom.area.clientWidth - pad);
    const ah = Math.max(80, dom.area.clientHeight - pad);
    k = Math.min(aw / w, ah / h);
    const cw = Math.round(w * k);
    const ch = Math.round(h * k);
    dom.frame.style.width = `${cw}px`;
    dom.frame.style.height = `${ch}px`;
    dom.frame.style.setProperty("--blur", `${Math.max(4, 40 * k).toFixed(1)}px`);
    stage.size({ width: cw, height: ch });
    stage.scale({ x: k, y: k });
    drawSafeZone();
    if (inlineEdit) finishInlineEdit(true);
    stage.batchDraw();
  }

  /* ---------- Video ---------- */

  function containSize() {
    const { w, h } = fmt();
    const vw = fgVideo.videoWidth || 16;
    const vh = fgVideo.videoHeight || 9;
    const s = Math.min(w / vw, h / vh);
    return { w: vw * s, h: vh * s };
  }

  function updateVideoNode() {
    if (!videoNode) return;
    const base = containSize();
    const v = doc.video;
    videoNode.setAttrs({
      width: base.w, height: base.h, offsetX: base.w / 2, offsetY: base.h / 2,
      x: v.x, y: v.y, scaleX: v.scale, scaleY: v.scale,
    });
    dom.frame.dataset.bg = doc.background;
    dom.zoom.value = String(Math.round(v.scale * 100));
    dom.zoomValue.textContent = `${Math.round(v.scale * 100)}%`;
    videoLayer.batchDraw();
  }

  function setVideoScale(scale, tag = "video-zoom") {
    mutate(() => { doc.video.scale = clamp(scale, MIN_SCALE, MAX_SCALE); }, tag);
  }

  function bindVideoNode() {
    let before = null;
    videoNode.on("dragstart", () => { before = snapshot(); select(null); });
    videoNode.on("dragmove", () => snapNode(videoNode));
    videoNode.on("dragend", () => {
      clearGuides();
      doc.video.x = videoNode.x();
      doc.video.y = videoNode.y();
      pushHistory(before);
      refresh();
    });
    videoNode.on("mouseenter", () => { stage.container().style.cursor = "move"; });
    videoNode.on("mouseleave", () => { stage.container().style.cursor = ""; });
  }

  /* ---------- Nodos de capa (los mismos para vista previa y exportación) ---------- */

  /**
   * Construye el nodo Konva de una capa. El texto "abraza" su contenido: el ancho guardado
   * es el máximo (donde se parten las líneas) y la caja se ajusta a la línea más larga,
   * centrada/alineada dentro de ese ancho. _hugShift guarda ese desplazamiento.
   */
  function buildNode(L) {
    if (L.type === "rect") {
      return new Konva.Rect({
        id: L.id, name: "layer", x: L.x, y: L.y, width: L.width, height: L.height,
        rotation: L.rotation, fill: L.fill, opacity: L.opacity, visible: !L.hidden,
      });
    }
    const pad = L.bg ? L.bgPadding : 0;
    const text = new Konva.Text({
      text: L.text.length ? L.text : " ",
      width: L.width, padding: pad, wrap: "word",
      fontFamily: fontString(L.fontFamily), fontStyle: String(L.fontWeight), fontSize: L.fontSize,
      lineHeight: L.lineHeight, align: L.align, fill: L.fill,
      stroke: L.strokeWidth > 0 ? L.stroke : null, strokeWidth: L.strokeWidth,
      fillAfterStrokeEnabled: true, lineJoin: "round",
    });
    const longest = Math.max(1, ...text.textArr.map((t) => t.width));
    // +2 px de holgura: con el ancho exacto, el redondeo de Konva puede partir la línea más larga.
    const hugW = Math.min(L.width, Math.ceil(longest) + 2 * pad + L.strokeWidth + 2);
    const shift = L.align === "center" ? (L.width - hugW) / 2 : L.align === "right" ? L.width - hugW : 0;
    text.width(hugW);

    const shadow = L.shadow ? { shadowColor: "#000000", shadowBlur: L.fontSize * 0.18, shadowOffsetY: L.fontSize * 0.04, shadowOpacity: 0.55 } : {};
    const tag = new Konva.Tag({
      fill: L.bg ? hexToRgba(L.bg, L.bgOpacity) : null,
      cornerRadius: L.bg ? L.bgRadius : 0,
      ...(L.bg ? shadow : {}),
    });
    if (!L.bg) text.setAttrs(shadow);

    const r = (L.rotation * Math.PI) / 180;
    const label = new Konva.Label({
      id: L.id, name: "layer",
      x: L.x + Math.cos(r) * shift, y: L.y + Math.sin(r) * shift,
      rotation: L.rotation, opacity: L.opacity, visible: !L.hidden,
    });
    label.add(tag, text);
    label.setAttr("_hugShift", shift);
    return label;
  }

  /** Reconstruye las capas desde el documento y re-engancha la selección. */
  function renderLayers() {
    if (!contentLayer) return;
    contentLayer.find(".layer").forEach((n) => n.destroy());
    for (const L of doc.layers) {
      const node = buildNode(L);
      bindLayerNode(node, L.id);
      node.draggable(!L.hidden);
      node.listening(!L.hidden);
      contentLayer.add(node);
    }
    transformer.moveToTop();
    attachTransformer();
    contentLayer.batchDraw();
  }

  function refresh() {
    updateVideoNode();
    renderLayers();
    renderLayerList();
    syncPanel();
    syncToolbar();
  }

  /* ===================================================================
     5. Guías magnéticas y zona segura
     =================================================================== */

  function snapStops() {
    const { w, h } = fmt();
    const v = [0, EDGE_MARGIN, w / 2, w - EDGE_MARGIN, w];
    const hz = [0, EDGE_MARGIN, h / 2, h - EDGE_MARGIN, h];
    if (safeVisible && doc.format === "9x16") {
      v.push(w - TIKTOK_SAFE.right);
      hz.push(TIKTOK_SAFE.top, h - TIKTOK_SAFE.bottom);
    }
    return { v, h: hz };
  }

  /** Engancha bordes y centro del nodo a las guías cercanas y dibuja las líneas moradas. */
  function snapNode(node) {
    const box = node.getClientRect({ relativeTo: stage, skipShadow: true, skipStroke: true });
    const stops = snapStops();
    const tol = SNAP_PX / k;
    const best = (edges, targets) => {
      let found = null;
      for (const e of edges) for (const t of targets) {
        const d = t - e;
        if (Math.abs(d) <= tol && (!found || Math.abs(d) < Math.abs(found.d))) found = { d, at: t };
      }
      return found;
    };
    const vx = best([box.x, box.x + box.width / 2, box.x + box.width], stops.v);
    const hy = best([box.y, box.y + box.height / 2, box.y + box.height], stops.h);
    if (vx) node.x(node.x() + vx.d);
    if (hy) node.y(node.y() + hy.d);

    guidesGroup.destroyChildren();
    const { w, h } = fmt();
    const line = (points) => new Konva.Line({ points, stroke: UI.guide, strokeWidth: 2 / k, dash: [10 / k, 6 / k] });
    if (vx) guidesGroup.add(line([vx.at, 0, vx.at, h]));
    if (hy) guidesGroup.add(line([0, hy.at, w, hy.at]));
    uiLayer.batchDraw();
  }

  function clearGuides() {
    guidesGroup.destroyChildren();
    uiLayer.batchDraw();
  }

  function drawSafeZone() {
    if (!safeGroup) return;
    safeGroup.destroyChildren();
    const show = safeVisible && doc.format === "9x16";
    safeGroup.visible(show);
    if (show) {
      const { w, h } = fmt();
      const { top, right, bottom } = TIKTOK_SAFE;
      const zone = (x, y, zw, zh, text) => {
        safeGroup.add(new Konva.Rect({ x, y, width: zw, height: zh, fill: UI.danger, stroke: "rgba(251, 113, 133, 0.75)", strokeWidth: 2 / k, dash: [8 / k, 6 / k] }));
        safeGroup.add(new Konva.Text({ x: x + 14, y: y + 12, width: Math.max(10, zw - 28), text, fontFamily: fontString("Inter"), fontStyle: "600", fontSize: 26, fill: "rgba(255,255,255,0.85)", wrap: "word" }));
      };
      zone(0, 0, w, top, "Pestañas de TikTok");
      zone(w - right, top, right, h - top - bottom, "Botones");
      zone(0, h - bottom, w, bottom, "Usuario y descripción");
    }
    uiLayer.batchDraw();
  }

  /* ===================================================================
     6. Selección, arrastre y transformaciones
     =================================================================== */

  function attachTransformer() {
    const L = selectedLayer();
    const node = L && !L.hidden ? contentLayer.findOne(`#${L.id}`) : null;
    if (!node) { transformer.nodes([]); return; }
    const isText = L.type === "text";
    transformer.setAttrs({
      enabledAnchors: isText
        ? ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]
        : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"],
      keepRatio: isText,
      rotateEnabled: true,
    });
    transformer.nodes([node]);
  }

  function select(id) {
    if (inlineEdit && inlineEdit.id !== id) finishInlineEdit(true);
    selectedId = id && layerById(id) ? id : null;
    if (!contentLayer) return;
    attachTransformer();
    contentLayer.batchDraw();
    renderLayerList();
    syncPanel();
  }

  let lastAnchor = null;

  function bindLayerNode(node, id) {
    let before = null;
    node.on("mousedown touchstart", () => { if (selectedId !== id) select(id); });
    node.on("dragstart", () => { before = snapshot(); });
    node.on("dragmove", () => snapNode(node));
    node.on("dragend", () => {
      clearGuides();
      const L = layerById(id);
      if (!L) return;
      storeNodePosition(node, L);
      pushHistory(before);
      refresh();
    });
    node.on("transformstart", () => { before = snapshot(); lastAnchor = transformer.getActiveAnchor(); });
    node.on("transform", () => {
      const L = layerById(id);
      if (!L || L.type !== "text") return;
      // Asas laterales: cambian el ancho (re-parte líneas) sin estirar la letra.
      if (lastAnchor === "middle-left" || lastAnchor === "middle-right") {
        const text = node.getText();
        text.width(Math.max(40, text.width() * node.scaleX()));
        node.scale({ x: 1, y: 1 });
      }
    });
    node.on("transformend", () => {
      const L = layerById(id);
      if (!L) return;
      finalizeTransform(node, L, lastAnchor);
      pushHistory(before);
      refresh();
    });
    node.on("dblclick dbltap", () => startInlineEdit(id));
  }

  /** Guarda en el documento la posición de un nodo (deshace el desplazamiento del "abrazo"). */
  function storeNodePosition(node, L) {
    if (L.type !== "text") { L.x = node.x(); L.y = node.y(); return; }
    const shift = node.getAttr("_hugShift") || 0;
    const r = (node.rotation() * Math.PI) / 180;
    L.x = node.x() - Math.cos(r) * shift;
    L.y = node.y() - Math.sin(r) * shift;
  }

  /** Convierte la escala visual del Transformer (o del pellizco) en propiedades reales de la capa. */
  function finalizeTransform(node, L, anchor) {
    L.rotation = Math.round(node.rotation() * 100) / 100;
    if (L.type === "rect") {
      L.width = Math.max(8, L.width * node.scaleX());
      L.height = Math.max(8, L.height * node.scaleY());
      L.x = node.x();
      L.y = node.y();
      return;
    }
    const r = (L.rotation * Math.PI) / 180;
    if (anchor === "middle-left" || anchor === "middle-right") {
      L.width = Math.max(40, node.getText().width());
      L.x = node.x();
      L.y = node.y();
      return;
    }
    const s = node.scaleX();
    const shift = (node.getAttr("_hugShift") || 0) * s;
    L.fontSize = clamp(L.fontSize * s, 8, 600);
    L.width = Math.max(40, L.width * s);
    L.strokeWidth *= s;
    L.bgPadding *= s;
    L.bgRadius *= s;
    L.x = node.x() - Math.cos(r) * shift;
    L.y = node.y() - Math.sin(r) * shift;
  }

  function bindStageEvents() {
    stage.on("click tap", (e) => {
      if (e.target === stage || e.target === videoNode) select(null);
    });

    // Rueda: zoom del video (centrado en su posición actual).
    stage.on("wheel", (e) => {
      e.evt.preventDefault();
      const factor = e.evt.deltaY < 0 ? 1.06 : 1 / 1.06;
      setVideoScale(doc.video.scale * factor, "video-wheel");
    });

    // Gestos táctiles con dos dedos: escalar/rotar la capa seleccionada o, si no hay, zoom del video.
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const angle = (t) => (Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180) / Math.PI;
    stage.on("touchstart", (e) => {
      const t = e.evt.touches;
      if (t.length !== 2) return;
      e.evt.preventDefault();
      // Durante el pellizco nada se arrastra: si Konva empezara un drag, se quedaría con los touchmove.
      [videoNode, ...contentLayer.find(".layer")].forEach((n) => {
        if (n.isDragging()) n.stopDrag();
        n.draggable(false);
      });
      const L = selectedLayer();
      const node = L && !L.hidden ? contentLayer.findOne(`#${L.id}`) : null;
      const box = node ? node.getClientRect({ relativeTo: stage }) : null;
      pinch = {
        node, L, before: snapshot(), d0: dist(t), a0: angle(t),
        scale0: doc.video.scale, rot0: node ? node.rotation() : 0,
        center: box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null,
      };
    });
    stage.on("touchmove", (e) => {
      const t = e.evt.touches;
      if (!pinch || t.length !== 2) return;
      e.evt.preventDefault();
      const ratio = dist(t) / pinch.d0;
      if (!pinch.node) {
        doc.video.scale = clamp(pinch.scale0 * ratio, MIN_SCALE, MAX_SCALE);
        updateVideoNode();
        return;
      }
      const n = pinch.node;
      n.scale({ x: ratio, y: ratio });
      n.rotation(pinch.rot0 + angle(t) - pinch.a0);
      const box = n.getClientRect({ relativeTo: stage });   // mantiene el centro bajo los dedos
      n.x(n.x() + pinch.center.x - (box.x + box.width / 2));
      n.y(n.y() + pinch.center.y - (box.y + box.height / 2));
      contentLayer.batchDraw();
    });
    stage.on("touchend touchcancel", (e) => {
      if (!pinch || e.evt.touches.length >= 2) return;
      if (pinch.node && pinch.L) finalizeTransform(pinch.node, pinch.L, "corner");
      pushHistory(pinch.before);
      pinch = null;
      videoNode.draggable(true);
      refresh();   // reconstruye las capas (vuelven a ser arrastrables)
    });
  }

  /* ===================================================================
     7. Edición de texto in situ (doble clic)
     =================================================================== */

  let inlineEdit = null; // { id, before }

  function startInlineEdit(id) {
    const L = layerById(id);
    if (!L || L.type !== "text" || L.hidden) return;
    if (inlineEdit) finishInlineEdit(true);
    select(id);
    const node = contentLayer.findOne(`#${id}`);
    if (!node) return;
    inlineEdit = { id, before: snapshot() };
    node.hide();
    transformer.nodes([]);
    contentLayer.batchDraw();

    const pad = L.bg ? L.bgPadding : 0;
    const ta = dom.inline;
    Object.assign(ta.style, {
      left: `${L.x * k}px`, top: `${L.y * k}px`, width: `${L.width * k}px`,
      fontFamily: fontString(L.fontFamily), fontWeight: String(L.fontWeight),
      fontSize: `${L.fontSize * k}px`, lineHeight: String(L.lineHeight), textAlign: L.align,
      color: L.fill, padding: `${pad * k}px`, transform: `rotate(${L.rotation}deg)`,
      webkitTextStroke: L.strokeWidth > 0 ? `${(L.strokeWidth * k) / 2}px ${L.stroke}` : "",
    });
    ta.value = L.text;
    ta.hidden = false;
    autoGrow();
    ta.focus();
    ta.select();
  }

  function autoGrow() {
    dom.inline.style.height = "auto";
    dom.inline.style.height = `${dom.inline.scrollHeight + 2}px`;
  }

  function finishInlineEdit(commit) {
    if (!inlineEdit) return;
    const { id, before } = inlineEdit;
    inlineEdit = null;
    dom.inline.hidden = true;
    const L = layerById(id);
    if (L && commit) {
      L.text = dom.inline.value.replace(/\r/g, "");
      pushHistory(before);
    }
    refresh();
  }

  dom.inline.addEventListener("input", autoGrow);
  dom.inline.addEventListener("blur", () => finishInlineEdit(true));
  dom.inline.addEventListener("keydown", (e) => {
    e.stopPropagation(); // los atajos del editor no aplican mientras se escribe
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      finishInlineEdit(true);
    }
  });

  /* ===================================================================
     8. Panel de estilo
     =================================================================== */

  function colorField(container, { apply }) {
    container.innerHTML = "";
    const swatches = PALETTE.map(({ color, name }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ed-swatch";
      b.style.setProperty("--swatch", color);
      b.dataset.color = color;
      b.title = name;
      b.setAttribute("aria-label", name);
      b.addEventListener("click", () => { beginChange(); apply(color); endChange(); });
      container.appendChild(b);
      return b;
    });
    const custom = document.createElement("label");
    custom.className = "ed-custom-color";
    custom.title = "Color personalizado";
    const input = document.createElement("input");
    input.type = "color";
    input.setAttribute("aria-label", "Color personalizado");
    input.addEventListener("input", () => { beginChange(); apply(input.value); });
    input.addEventListener("change", endChange);
    custom.appendChild(input);
    container.appendChild(custom);
    return {
      set(value) {
        const v = (value || "").toLowerCase();
        let matched = false;
        swatches.forEach((b) => {
          const on = b.dataset.color === v;
          matched = matched || on;
          b.setAttribute("aria-pressed", String(on));
        });
        custom.setAttribute("aria-pressed", String(!matched && !!v));
        if (/^#[0-9a-f]{6}$/.test(v)) input.value = v;
      },
    };
  }

  /** Cambia la capa seleccionada. live=true: dentro de un gesto (slider/picker), sin cerrar el paso de historial. */
  function editSelected(fn, { live = false } = {}) {
    const L = selectedLayer();
    if (!L) return;
    beginChange();
    fn(L);
    if (!live) endChange();
    renderLayers();
    renderLayerList();
    syncPanel();
  }

  function bindRange(input, apply) {
    input.addEventListener("input", () => editSelected((L) => apply(L, Number(input.value)), { live: true }));
    input.addEventListener("change", endChange);
  }

  const colors = {};

  function buildPanel() {
    dom.font.innerHTML = FONTS.map((f) => `<option value="${f.family}">${f.label}</option>`).join("");
    dom.font.addEventListener("change", () => editSelected((L) => {
      L.fontFamily = dom.font.value;
      const weights = FONTS.find((f) => f.family === L.fontFamily).weights;
      if (!weights.includes(String(L.fontWeight))) {
        L.fontWeight = weights.reduce((a, b) => (Math.abs(b - L.fontWeight) < Math.abs(a - L.fontWeight) ? b : a));
      }
      loadFont(L.fontFamily, L.fontWeight).then(() => { if (isOpen()) renderLayers(); });
    }));
    dom.weight.addEventListener("change", () => editSelected((L) => {
      L.fontWeight = dom.weight.value;
      loadFont(L.fontFamily, L.fontWeight).then(() => { if (isOpen()) renderLayers(); });
    }));

    bindRange(dom.size, (L, v) => { L.fontSize = v; });
    bindRange(dom.strokeWidth, (L, v) => { L.strokeWidth = v; });
    bindRange(dom.bgOpacity, (L, v) => { L.bgOpacity = v / 100; });
    bindRange(dom.bgRadius, (L, v) => { L.bgRadius = v; });
    bindRange(dom.bgPadding, (L, v) => { L.bgPadding = v; });
    bindRange(dom.opacity, (L, v) => { L.opacity = v / 100; });

    colors.fill = colorField(dom.fill, { apply: (c) => editSelected((L) => { L.fill = c; }, { live: true }) });
    colors.stroke = colorField(dom.stroke, {
      apply: (c) => editSelected((L) => { L.stroke = c; if (!L.strokeWidth) L.strokeWidth = 10; }, { live: true }),
    });
    colors.bg = colorField(dom.bg, { apply: (c) => editSelected((L) => { L.bg = c; }, { live: true }) });
    colors.rect = colorField(dom.rectFill, { apply: (c) => editSelected((L) => { L.fill = c; }, { live: true }) });

    dom.bgOn.addEventListener("change", () => editSelected((L) => {
      if (dom.bgOn.checked) {
        L.bg = L.bgLast || "#000000";
      } else {
        L.bgLast = L.bg;   // se recuerda el color para volver a activarlo
        L.bg = null;
      }
    }));
    dom.shadow.addEventListener("change", () => editSelected((L) => { L.shadow = dom.shadow.checked; }));

    buildChoiceGroup(dom.align, [
      { value: "left", label: "Izquierda" }, { value: "center", label: "Centro" }, { value: "right", label: "Derecha" },
    ], (v) => editSelected((L) => { L.align = v; }));
  }

  function setRange(input, out, value, text) {
    input.value = String(Math.round(value));
    out.textContent = text;
  }

  function syncPanel() {
    const L = selectedLayer();
    dom.styleEmpty.hidden = !!L;
    dom.styleFields.hidden = !L;
    if (!L) return;
    for (const f of dom.styleFields.querySelectorAll("[data-for]")) f.hidden = f.dataset.for !== L.type;

    setRange(dom.opacity, dom.opacityValue, L.opacity * 100, `${Math.round(L.opacity * 100)}%`);
    if (L.type === "rect") { colors.rect.set(L.fill); return; }

    dom.font.value = L.fontFamily;
    const weights = FONTS.find((f) => f.family === L.fontFamily)?.weights || ["400"];
    dom.weight.innerHTML = weights.map((w) => `<option value="${w}">${WEIGHT_LABELS[w] || w}</option>`).join("");
    dom.weight.value = String(L.fontWeight);
    dom.weight.disabled = weights.length < 2;
    setRange(dom.size, dom.sizeValue, L.fontSize, `${Math.round(L.fontSize)} px`);
    setRange(dom.strokeWidth, dom.strokeWidthValue, L.strokeWidth, L.strokeWidth ? `${Math.round(L.strokeWidth)} px` : "Sin borde");
    colors.fill.set(L.fill);
    colors.stroke.set(L.stroke);
    dom.bgOn.checked = !!L.bg;
    dom.bgFields.classList.toggle("is-off", !L.bg);
    colors.bg.set(L.bg || L.bgLast || "#000000");
    setRange(dom.bgOpacity, dom.bgOpacityValue, L.bgOpacity * 100, `${Math.round(L.bgOpacity * 100)}%`);
    setRange(dom.bgRadius, dom.bgRadiusValue, L.bgRadius, `${Math.round(L.bgRadius)} px`);
    setRange(dom.bgPadding, dom.bgPaddingValue, L.bgPadding, `${Math.round(L.bgPadding)} px`);
    dom.shadow.checked = !!L.shadow;
    syncChoiceGroup(dom.align, L.align);
  }

  /* ---------- Grupos de opciones tipo radio (formato, fondo, alineación) ---------- */

  function buildChoiceGroup(container, options, onSelect) {
    container.innerHTML = "";
    for (const o of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("role", "radio");
      b.dataset.value = o.value;
      b.textContent = o.label;
      if (o.title) b.title = o.title;
      b.addEventListener("click", () => { if (!b.disabled) onSelect(o.value); });
      container.appendChild(b);
    }
    container.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      const buttons = [...container.querySelectorAll(".chip:not(:disabled)")];
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      const next = buttons[(i + step + buttons.length) % buttons.length];
      next.focus();
      onSelect(next.dataset.value);
    });
  }

  function syncChoiceGroup(container, value, disabled = false) {
    for (const b of container.querySelectorAll(".chip")) {
      const on = b.dataset.value === value;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      b.disabled = disabled;
    }
  }

  function syncToolbar() {
    syncChoiceGroup(dom.format, doc.format, render.busy);
    syncChoiceGroup(dom.bgMode, doc.background, render.busy);
    const tiktok = doc.format === "9x16";
    dom.safe.disabled = !tiktok;
    dom.safe.title = tiktok ? "Sombrea las zonas que tapa la interfaz de TikTok" : "La zona segura de TikTok aplica al formato 9:16";
    dom.safe.setAttribute("aria-pressed", String(safeVisible && tiktok));
    syncHistoryButtons();
  }

  /* ===================================================================
     9. Lista de capas
     =================================================================== */

  function layerName(L) {
    if (L.type === "rect") return L.role === "band" ? "Franja" : "Rectángulo";
    const t = L.text.replace(/\s+/g, " ").trim();
    return t ? (t.length > 30 ? `${t.slice(0, 30)}…` : t) : "Texto vacío";
  }

  function renderLayerList() {
    const ul = dom.layers;
    ul.innerHTML = "";
    if (!doc.layers.length) {
      ul.innerHTML = '<li class="ed-layers__empty">No hay capas. Usa «+ Texto».</li>';
      return;
    }
    const n = doc.layers.length;
    [...doc.layers].reverse().forEach((L) => {
      const index = doc.layers.indexOf(L);
      const li = document.createElement("li");
      li.className = `ed-layer${L.id === selectedId ? " is-selected" : ""}${L.hidden ? " is-hidden" : ""}`;
      li.dataset.id = L.id;

      const name = document.createElement("button");
      name.type = "button";
      name.className = "ed-layer__name";
      name.setAttribute("aria-pressed", String(L.id === selectedId));
      name.innerHTML = `<span class="ed-layer__type" aria-hidden="true">${L.type === "text" ? "T" : "▭"}</span><span></span>`;
      name.lastChild.textContent = layerName(L);
      name.addEventListener("click", () => select(L.id));
      name.addEventListener("dblclick", () => startInlineEdit(L.id));

      const btn = (icon, label, fn, disabled = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ed-layer__btn";
        b.innerHTML = icon;
        b.title = label;
        b.setAttribute("aria-label", `${label}: ${layerName(L)}`);
        b.disabled = disabled;
        b.addEventListener("click", fn);
        return b;
      };
      li.append(
        name,
        btn(L.hidden ? ICONS.eyeOff : ICONS.eye, L.hidden ? "Mostrar" : "Ocultar", () => mutate(() => { L.hidden = !L.hidden; })),
        btn(ICONS.up, "Subir", () => moveLayer(L.id, 1), index === n - 1),
        btn(ICONS.down, "Bajar", () => moveLayer(L.id, -1), index === 0),
        btn(ICONS.copy, "Duplicar", () => duplicateLayer(L.id)),
        btn(ICONS.trash, "Borrar", () => deleteLayer(L.id)),
      );
      ul.appendChild(li);
    });
  }

  function moveLayer(id, dir) {
    const i = doc.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= doc.layers.length) return;
    mutate(() => { [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; });
  }

  function duplicateLayer(id) {
    const L = layerById(id);
    if (!L) return;
    const copy = { ...JSON.parse(JSON.stringify(L)), id: uid(), x: L.x + 30, y: L.y + 30, role: undefined };
    mutate(() => {
      doc.layers.splice(doc.layers.indexOf(L) + 1, 0, copy);
      selectedId = copy.id;
    });
  }

  function deleteLayer(id) {
    if (!layerById(id)) return;
    mutate(() => {
      doc.layers = doc.layers.filter((l) => l.id !== id);
      if (selectedId === id) selectedId = null;
    });
  }

  function addTextLayer() {
    const L = newTextLayer({ text: "Escribe aquí" });
    mutate(() => { doc.layers.push(L); selectedId = L.id; });
  }

  /* ===================================================================
     10. Presets
     =================================================================== */

  /** Caja útil para colocar texto: en 9:16 evita la zona de TikTok. */
  function safeBox() {
    const { w, h } = fmt();
    if (doc.format === "9x16") {
      return { left: 70, right: w - TIKTOK_SAFE.right, top: TIKTOK_SAFE.top + 20, bottom: h - TIKTOK_SAFE.bottom };
    }
    return { left: 70, right: w - 70, top: 70, bottom: h - 70 };
  }

  function measureHeight(L) {
    const node = buildNode(L);
    const height = node.getText().height();
    node.destroy();
    return height;
  }

  const PRESETS = {
    classic: {
      label: "Clásico meme",
      sample: { text: "MEME", css: "font-family: Anton, Impact, sans-serif; color: #fff; -webkit-text-stroke: 1.5px #000; letter-spacing: .02em" },
      apply(L) {
        const sb = safeBox();
        Object.assign(L, {
          fontFamily: "Anton", fontWeight: "400", fontSize: 96, lineHeight: 1.08,
          fill: "#ffffff", stroke: "#000000", strokeWidth: 16,
          bg: null, shadow: false, align: "center", rotation: 0, opacity: 1,
          x: sb.left, y: sb.top, width: sb.right - sb.left,
        });
      },
    },
    banda: {
      label: "Banda TikTok",
      sample: { text: "Banda", css: "background: #fff; color: #0b0b0f; font-family: Inter, sans-serif; font-weight: 700; font-size: 13px; padding: 6px 10px; border-radius: 4px" },
      apply(L) {
        const { w, h } = fmt();
        Object.assign(L, {
          fontFamily: "Inter", fontWeight: "700", fontSize: 64, lineHeight: 1.2,
          fill: "#0b0b0f", stroke: "#000000", strokeWidth: 0,
          bg: null, shadow: false, align: "center", rotation: 0, opacity: 1,
          x: 60, width: w - 120,
        });
        const padTop = doc.format === "9x16" ? TIKTOK_SAFE.top - 10 : 56;
        L.y = padTop;
        const bandH = clamp(even(padTop + measureHeight(L) + 56), 120, Math.floor(h * 0.6));
        let band = doc.layers.find((l) => l.role === "band");
        if (!band) {
          band = newBandLayer(bandH);
          doc.layers.unshift(band);   // la franja va al fondo, debajo del texto
        }
        Object.assign(band, { x: 0, y: 0, width: w, height: bandH, rotation: 0, hidden: false });
        // El video pasa a ocupar el espacio de debajo de la franja.
        const vw = fgVideo.videoWidth || 16;
        const vh = fgVideo.videoHeight || 9;
        const base = Math.min(w / vw, h / vh);
        const below = Math.min(w / vw, (h - bandH) / vh);
        doc.video = { x: w / 2, y: bandH + (h - bandH) / 2, scale: clamp(below / base, MIN_SCALE, MAX_SCALE) };
      },
    },
    subtitle: {
      label: "Subtítulo",
      sample: { text: "Subtítulo", css: "background: rgba(0,0,0,.65); color: #fff; font-family: Inter, sans-serif; font-weight: 600; font-size: 12px; padding: 5px 9px; border-radius: 6px" },
      apply(L) {
        const sb = safeBox();
        Object.assign(L, {
          fontFamily: "Inter", fontWeight: "600", fontSize: 52, lineHeight: 1.25,
          fill: "#ffffff", stroke: "#000000", strokeWidth: 0,
          bg: "#000000", bgOpacity: 0.62, bgRadius: 16, bgPadding: 22,
          shadow: false, align: "center", rotation: 0, opacity: 1,
          x: sb.left, width: sb.right - sb.left,
        });
        L.y = sb.bottom - measureHeight(L);
      },
    },
  };

  function applyPreset(key) {
    mutate(() => {
      let L = selectedLayer();
      if (!L || L.type !== "text") {
        L = newTextLayer({ text: "Texto" });
        doc.layers.push(L);
        selectedId = L.id;
      }
      PRESETS[key].apply(L);
    });
    loadFontsFor(doc.layers).then(() => { if (isOpen()) renderLayers(); });
  }

  function buildPresets() {
    dom.presets.innerHTML = "";
    for (const [key, p] of Object.entries(PRESETS)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ed-preset";
      b.title = `Aplicar «${p.label}» a la capa seleccionada`;
      b.innerHTML = `<span class="ed-preset__sample"><span style="${p.sample.css}">${p.sample.text}</span></span><span>${p.label}</span>`;
      b.addEventListener("click", () => applyPreset(key));
      dom.presets.appendChild(b);
    }
  }

  /* ===================================================================
     11. Fuentes
     =================================================================== */

  function loadFont(family, weight) {
    return document.fonts.load(`${weight} 48px "${family}"`).catch(() => {});
  }

  function loadFontsFor(layers) {
    return Promise.all(layers.filter((l) => l.type === "text").map((l) => loadFont(l.fontFamily, l.fontWeight)));
  }

  function loadAllFonts() {
    if (!fontsReady) {
      fontsReady = Promise.all(FONTS.flatMap((f) => f.weights.map((w) => loadFont(f.family, w))));
    }
    return fontsReady;
  }

  /* ===================================================================
     12. Formato, fondo, reproducción, zona segura
     =================================================================== */

  function setFormat(format) {
    if (format === doc.format || render.busy) return;
    const oldH = fmt().h;
    mutate(() => {
      const ratio = FORMATS[format].h / oldH;
      doc.format = format;
      doc.video.y *= ratio;
      for (const L of doc.layers) {
        if (L.role === "band") continue;   // la franja se queda pegada arriba
        L.y *= ratio;
      }
    });
    fitStage();
    refresh();
  }

  function syncPlayButton() {
    const playing = !fgVideo.paused;
    dom.playIconPause.toggleAttribute("hidden", !playing);
    dom.playIconPlay.toggleAttribute("hidden", playing);
    dom.play.setAttribute("aria-label", playing ? "Pausar video" : "Reproducir video");
  }

  fgVideo.addEventListener("play", () => { videoAnim?.start(); dom.bgVideo.play().catch(() => {}); syncPlayButton(); });
  fgVideo.addEventListener("pause", () => { videoAnim?.stop(); dom.bgVideo.pause(); syncPlayButton(); videoLayer?.batchDraw(); });
  fgVideo.addEventListener("seeked", () => videoLayer?.batchDraw());
  fgVideo.addEventListener("timeupdate", () => {
    if (Math.abs(dom.bgVideo.currentTime - fgVideo.currentTime) > 0.25) dom.bgVideo.currentTime = fgVideo.currentTime;
  });

  /* ===================================================================
     13. Exportar: un PNG por capa + JSON → /render
     =================================================================== */

  async function rasterizeLayer(L) {
    const { w, h } = fmt();
    const container = document.createElement("div");
    const st = new Konva.Stage({ container, width: w, height: h });
    const layer = new Konva.Layer();
    st.add(layer);
    layer.add(buildNode({ ...L, hidden: false }));
    layer.draw();
    const canvas = st.toCanvas({ pixelRatio: 1 });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    st.destroy();
    if (!blob) throw new Error("No se pudo generar la imagen de una capa.");
    return blob;
  }

  function renderFilename(format) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `memecaptioner_${format}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.mp4`;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function showError(message) {
    dom.errorText.textContent = message;
    dom.error.hidden = false;
    replayClass(dom.error, "notice-in");
  }

  function setBusy(on) {
    render.busy = on;
    dom.download.disabled = on;
    dom.downloadIcon.toggleAttribute("hidden", on);
    dom.downloadSpinner.toggleAttribute("hidden", !on);
    dom.downloadLabel.textContent = on ? "Renderizando…" : "Descargar video";
    dom.progress.hidden = !on;
    syncToolbar();
    clearInterval(render.tick);
    if (on) {
      const t0 = Date.now();
      const tick = () => { dom.progressText.textContent = `Renderizando… ${Math.floor((Date.now() - t0) / 1000)} s`; };
      tick();
      render.tick = setInterval(tick, 1000);
    }
  }

  /** Rasteriza las capas visibles, envía PNGs + JSON a /render y devuelve el MP4 (Blob). */
  async function requestRender(signal) {
    const visible = doc.layers.filter((l) => !l.hidden);
    const checkAbort = () => { if (signal.aborted) throw new DOMException("Render cancelado", "AbortError"); };
    await loadFontsFor(visible);
    const blobs = [];
    for (const L of visible) {
      checkAbort();                          // cancelar también corta durante la rasterización
      blobs.push(await rasterizeLayer(L));   // mismo motor que la vista previa
    }
    checkAbort();

    const spec = {
      format: doc.format,
      background: doc.background,
      video: { x: doc.video.x, y: doc.video.y, scale: doc.video.scale },
      layers: visible.map((l) => ({ id: l.id, start: l.start, end: l.end })),
    };
    const form = new FormData();
    form.append("spec", JSON.stringify(spec));
    blobs.forEach((b, i) => form.append("layers", b, `capa_${i + 1}.png`));

    let res;
    try {
      res = await fetch(`/api/videos/${state.videoId}/render`, { method: "POST", body: form, signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new ApiError(0, "No se pudo conectar con el servidor. ¿Está corriendo uvicorn?");
    }
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch { /* sin JSON */ }
      throw new ApiError(res.status, detailToMessage(data && data.detail) || `Error al renderizar (HTTP ${res.status}).`);
    }
    return res.blob();
  }

  async function download() {
    if (render.busy || !state.videoId) return;
    finishInlineEdit(true);
    endChange();
    dom.error.hidden = true;
    const format = doc.format;
    render.abort = new AbortController();
    setBusy(true);
    try {
      const video = await requestRender(render.abort.signal);
      saveBlob(video, renderFilename(format));
      showToast("Video descargado");
    } catch (err) {
      if (err.name !== "AbortError") showError(err.message || "No se pudo renderizar el video.");
    } finally {
      render.abort = null;
      setBusy(false);
      if (isOpen() && !dom.panel.contains(document.activeElement)) dom.download.focus({ preventScroll: true });
    }
  }

  /** Cancela el render: aborta la petición y el servidor mata FFmpeg al detectar la desconexión. */
  function cancelRender() {
    if (!render.abort) return;
    render.abort.abort();
    dom.downloadLabel.textContent = "Cancelando…";
    dom.progressText.textContent = "Cancelando…";
  }

  /* ===================================================================
     14. Hoja inferior (móvil)
     =================================================================== */

  function setSheetOpen(open) {
    dom.sheet.classList.toggle("is-open", open);
    dom.sheetHandle.setAttribute("aria-expanded", String(open));
  }

  function bindSheet() {
    let drag = null;
    let suppressClick = false;
    dom.sheetHandle.addEventListener("pointerdown", (e) => {
      if (!isMobile()) return;
      const peek = parseFloat(getComputedStyle(dom.sheet).getPropertyValue("--sheet-peek")) || 104;
      drag = { y0: e.clientY, open: dom.sheet.classList.contains("is-open"), max: dom.sheet.offsetHeight - peek, moved: false, t: 0 };
      dom.sheetHandle.setPointerCapture(e.pointerId);
    });
    dom.sheetHandle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y0;
      if (!drag.moved && Math.abs(dy) > 6) { drag.moved = true; dom.sheet.classList.add("is-dragging"); }
      if (!drag.moved) return;
      drag.t = clamp((drag.open ? 0 : drag.max) + dy, 0, drag.max);
      dom.sheet.style.transform = `translateY(${drag.t}px)`;
    });
    const end = () => {
      if (!drag) return;
      if (drag.moved) {
        // Arrastre: se queda abierta o cerrada según dónde se soltó; el "click" que sigue se ignora.
        dom.sheet.classList.remove("is-dragging");
        dom.sheet.style.transform = "";
        setSheetOpen(drag.t < drag.max / 2);
        suppressClick = true;
      }
      drag = null;
    };
    dom.sheetHandle.addEventListener("pointerup", end);
    dom.sheetHandle.addEventListener("pointercancel", end);
    // Toque simple, clic o Enter/Espacio con teclado: abre o cierra.
    dom.sheetHandle.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      if (isMobile()) setSheetOpen(!dom.sheet.classList.contains("is-open"));
    });
  }

  /* ===================================================================
     15. Teclado
     =================================================================== */

  function isTyping(t) {
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  }

  function handleKey(e) {
    if (inlineEdit) return; // el textarea in situ maneja sus teclas
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (e.key === "Tab") {
      const focusables = [...dom.panel.querySelectorAll("button, select, textarea, input, [tabindex]:not([tabindex='-1'])")]
        .filter((n) => !n.disabled && n.tabIndex >= 0 && n.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!dom.panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (isTyping(e.target)) { e.target.blur(); return; }
      if (selectedId) { select(null); return; }
      close();
      return;
    }
    if (isTyping(e.target)) return;   // en los campos del panel, teclas normales

    if (mod && key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && key === "y") { e.preventDefault(); redo(); return; }
    if (mod && key === "d" && selectedId) { e.preventDefault(); duplicateLayer(selectedId); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteLayer(selectedId); return; }

    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && selectedId && !e.target.closest?.("[role='radiogroup']")) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = arrows[e.key];
      const L = selectedLayer();
      mutate(() => { L.x += dx * step; L.y += dy * step; }, "nudge");
    }
  }

  /* ===================================================================
     16. Abrir / cerrar
     =================================================================== */

  function isOpen() {
    return !dom.root.hidden;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    initStage();
    buildPanel();
    buildPresets();
    buildChoiceGroup(dom.format, Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label, title: `${f.w}×${f.h}` })), setFormat);
    buildChoiceGroup(dom.bgMode, [{ value: "blur", label: "Difuminado" }, { value: "black", label: "Negro" }],
      (v) => mutate(() => { doc.background = v; }));
    bindSheet();

    dom.undo.addEventListener("click", undo);
    dom.redo.addEventListener("click", redo);
    dom.addText.addEventListener("click", addTextLayer);
    dom.safe.addEventListener("click", () => { safeVisible = !safeVisible; drawSafeZone(); syncToolbar(); });
    dom.play.addEventListener("click", () => (fgVideo.paused ? fgVideo.play().catch(() => {}) : fgVideo.pause()));
    dom.zoom.addEventListener("input", () => {
      beginChange();
      doc.video.scale = clamp(Number(dom.zoom.value) / 100, MIN_SCALE, MAX_SCALE);
      updateVideoNode();
    });
    dom.zoom.addEventListener("change", endChange);
    dom.centerVideo.addEventListener("click", () => mutate(() => { const { w, h } = fmt(); doc.video = { x: w / 2, y: h / 2, scale: 1 }; }));
    dom.download.addEventListener("click", download);
    dom.cancel.addEventListener("click", cancelRender);
    dom.close.addEventListener("click", close);
    dom.backdrop.addEventListener("click", close);
    document.fonts.addEventListener?.("loadingdone", () => { if (isOpen()) renderLayers(); });
  }

  async function open(index, trigger) {
    const caption = state.lastResult && state.lastResult.captions[index];
    const src = state.videoUrl || el.player.getAttribute("src");
    if (!caption || !src || typeof Konva === "undefined") {
      if (typeof Konva === "undefined") showToast("No se pudo cargar el editor (Konva). Revisa tu conexión.", { error: true });
      return;
    }
    returnFocus = trigger || null;
    el.player.pause();

    dom.root.classList.remove("is-closing");
    dom.root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    init();
    setSheetOpen(false);
    dom.error.hidden = true;

    if (fgVideo.getAttribute("src") !== src) {
      fgVideo.src = src;
      dom.bgVideo.src = src;
    }
    if (fgVideo.readyState < 1) await new Promise((r) => fgVideo.addEventListener("loadedmetadata", r, { once: true }));

    // Documento nuevo: una capa con la caption y el preset "Clásico meme" arriba.
    doc = makeDoc("9x16");
    const L = newTextLayer({ text: caption.text });
    PRESETS.classic.apply(L);
    doc.layers.push(L);
    selectedId = L.id;
    history.past = [];
    history.future = [];
    txBefore = null;

    fitStage();
    refresh();
    fgVideo.play().catch(() => {});
    dom.download.focus({ preventScroll: true });
    await loadAllFonts();
    if (isOpen()) renderLayers();
  }

  async function close() {
    if (!isOpen() || dom.root.classList.contains("is-closing")) return;
    finishInlineEdit(true);
    endChange();
    cancelRender();
    dom.root.classList.add("is-closing");
    fgVideo.pause();
    await wait(180);
    dom.root.hidden = true;
    dom.root.classList.remove("is-closing");
    document.documentElement.style.overflow = "";
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }

  // API pública (app.js usa open/isOpen/handleKey; el resto ayuda a depurar y a las pruebas).
  return {
    open, close, isOpen, handleKey,
    getDoc: () => JSON.parse(snapshot()),
    getSelectedId: () => selectedId,
    select, undo, redo, applyPreset, addTextLayer, setFormat,
    _debug: () => ({ stage, k, video: fgVideo, history: { past: history.past.length, future: history.future.length } }),
    _requestRender: () => requestRender(new AbortController().signal),
    _setDoc: (d) => { doc = JSON.parse(JSON.stringify(d)); afterDocReplaced(); },
    TIKTOK_SAFE,
  };
})();
