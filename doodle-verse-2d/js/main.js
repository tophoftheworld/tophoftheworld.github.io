import { createCamera } from './camera.js';
import { createLevel, drawBackground } from './world.js';
import { createPlayer } from './player.js';
import { buildStrokeComposite, rasterizeStroke } from './draw-spawn.js';
import { cropAvatarLayers, drawAvatarDollGuide } from './avatar-doll.js';
import {
  LOCAL_PLAYER_ID,
  registerDrawnObject,
  removeWorldObject,
  pickWorldObjectAt,
  serializeState,
  applyRemoteObjectUpsert,
  getStrokeRasterCornerWorld,
} from './objects.js';
import { applyWorldObjectPhysics } from './physics-toggles.js';
import { getCompositeBounds } from './bounds.js';

const Matter = window.Matter;
const { Engine, Runner } = Matter;

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

const avatarOverlay = document.getElementById('avatar-overlay');
const avatarCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('avatar-canvas'));
const avatarDollGuide = /** @type {HTMLCanvasElement} */ (document.getElementById('avatar-doll-guide'));
const avatarCtx = /** @type {CanvasRenderingContext2D} */ (
  avatarCanvas.getContext('2d', { willReadFrequently: true })
);
const avatarGuideCtx = /** @type {CanvasRenderingContext2D | null} */ (
  avatarDollGuide ? avatarDollGuide.getContext('2d') : null
);
const avatarBrushHidden = /** @type {HTMLInputElement | null} */ (document.getElementById('avatar-brush'));
const avatarBrushSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('avatar-brush-slider'));
const avatarBrushReadout = document.getElementById('avatar-brush-readout');
const AVATAR_BRUSH_MIN = 2;
const AVATAR_BRUSH_MAX = 30;
/** Snap / tick values at 0%, 25%, 50%, 75%, 100% of [min,max] — native ticks span the full track. */
const AVATAR_BRUSH_SNAPS = [2, 9, 16, 23, 30];
const AVATAR_BRUSH_SNAP_RADIUS = 2.5;
const btnAvatarClear = document.getElementById('avatar-clear');
const btnAvatarUndo = document.getElementById('avatar-undo');
const btnAvatarRedo = document.getElementById('avatar-redo');
const btnAvatarEnter = document.getElementById('avatar-enter');
const avatarColorInput = /** @type {HTMLInputElement | null} */ (document.getElementById('avatar-color'));
const btnAvatarModeDraw = document.getElementById('avatar-mode-draw');
const btnAvatarModeErase = document.getElementById('avatar-mode-erase');
const avatarSwatchesEl = document.getElementById('avatar-swatches');

let avatarColor = '#14213d';
/** @type {'draw' | 'erase'} */
let avatarTool = 'draw';

function clampBrushPx(v) {
  return Math.min(AVATAR_BRUSH_MAX, Math.max(AVATAR_BRUSH_MIN, Math.round(v)));
}

function maybeSnapBrushPx(v) {
  v = clampBrushPx(v);
  let match = /** @type {number | null} */ (null);
  let bestD = Infinity;
  for (const s of AVATAR_BRUSH_SNAPS) {
    const d = Math.abs(v - s);
    if (d < bestD) {
      bestD = d;
      match = s;
    } else if (d === bestD) {
      match = null;
    }
  }
  if (match == null || bestD > AVATAR_BRUSH_SNAP_RADIUS) return v;
  return match;
}

function readSliderBrushPx() {
  if (!avatarBrushSlider) return 9;
  const v = avatarBrushSlider.valueAsNumber;
  if (!Number.isFinite(v)) return 9;
  return clampBrushPx(v);
}

function syncBrushSliderInput() {
  if (!avatarBrushSlider) return;
  const w = readSliderBrushPx();
  if (avatarBrushHidden) avatarBrushHidden.value = String(w);
  if (avatarBrushReadout) avatarBrushReadout.textContent = `${w} px`;
  avatarBrushSlider.setAttribute('aria-valuetext', `${w} pixels`);
}

function syncBrushSliderChange() {
  if (!avatarBrushSlider) return;
  const w = maybeSnapBrushPx(readSliderBrushPx());
  avatarBrushSlider.value = String(w);
  if (avatarBrushHidden) avatarBrushHidden.value = String(w);
  if (avatarBrushReadout) avatarBrushReadout.textContent = `${w} px`;
  avatarBrushSlider.setAttribute('aria-valuetext', `${w} pixels`);
}

function getAvatarBrushWidth() {
  if (avatarBrushSlider) return readSliderBrushPx();
  if (avatarBrushHidden && avatarBrushHidden.value !== '') {
    const v = Number(avatarBrushHidden.value);
    if (Number.isFinite(v) && v > 0) return clampBrushPx(v);
  }
  return 9;
}

/**
 * @param {string} c
 */
function normalizeHex(c) {
  const s = (c || '').trim().toLowerCase();
  if (!s.startsWith('#')) return s;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s;
}

function syncSwatchAria() {
  if (!avatarSwatchesEl) return;
  const target = normalizeHex(avatarColor);
  for (const el of avatarSwatchesEl.querySelectorAll('.avatar-swatch')) {
    const btn = /** @type {HTMLButtonElement} */ (el);
    const c = normalizeHex(btn.dataset.color || '');
    btn.setAttribute('aria-pressed', c === target ? 'true' : 'false');
  }
}

/**
 * @param {string} hex
 */
function setAvatarColor(hex) {
  const n = normalizeHex(hex);
  avatarColor = n.startsWith('#') && n.length === 7 ? n : '#14213d';
  if (avatarColorInput) {
    try {
      avatarColorInput.value = avatarColor;
    } catch {
      /* invalid for color input */
    }
  }
  syncSwatchAria();
}

/**
 * @param {'draw' | 'erase'} tool
 */
function setAvatarTool(tool) {
  avatarTool = tool;
  if (btnAvatarModeDraw && btnAvatarModeErase) {
    btnAvatarModeDraw.classList.toggle('is-active', tool === 'draw');
    btnAvatarModeErase.classList.toggle('is-active', tool === 'erase');
    btnAvatarModeDraw.setAttribute('aria-pressed', tool === 'draw' ? 'true' : 'false');
    btnAvatarModeErase.setAttribute('aria-pressed', tool === 'erase' ? 'true' : 'false');
  }
  avatarCanvas.classList.toggle('tools-erase', tool === 'erase');
}

/** Full composite drawing (persists across refresh). Clear removes this key. */
const AVATAR_STORAGE_KEY = 'doodle-verse-2d-avatar-v1';

const inspector = document.getElementById('inspector');
const inspectorOwner = document.getElementById('inspector-owner');
const togGravity = /** @type {HTMLInputElement} */ (document.getElementById('tog-gravity'));
const togCollision = /** @type {HTMLInputElement} */ (document.getElementById('tog-collision'));
const btnDelete = /** @type {HTMLButtonElement} */ (document.getElementById('btn-delete'));
const btnInspectorClose = document.getElementById('inspector-close');

const nextBrushEl = /** @type {HTMLInputElement} */ (document.getElementById('next-brush'));
const nextTogGravity = /** @type {HTMLInputElement} */ (document.getElementById('next-tog-gravity'));
const nextTogCollision = /** @type {HTMLInputElement} */ (document.getElementById('next-tog-collision'));
const togDebugPhysics = /** @type {HTMLInputElement} */ (document.getElementById('tog-debug-physics'));

let gameStarted = false;

/** @type {import('./objects.js').WorldObject[]} */
const worldObjects = [];
/** @type {import('./objects.js').WorldObject | null} */
let selectedObject = null;

let engine;
let runner;
let level;
/** @type {ReturnType<typeof createPlayer> | null} */
let player = null;
const camera = createCamera({ width: 800, height: 450 });

/** Screen px: drag farther than this to start a world stroke (else pointerup = select click) */
const DRAG_THRESHOLD_PX = 8;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.resize(w, h);
}
window.addEventListener('resize', resize);

/** @type {{ x: number, y: number } | null} */
let avatarLast = null;

/** In-world sprite: snapshot of avatar canvas (transparent background; no white fill while drawing). */
let avatarGameCanvas = /** @type {HTMLCanvasElement | null} */ (null);

function persistAvatarDrawing() {
  try {
    const payload = JSON.stringify({
      w: avatarCanvas.width,
      h: avatarCanvas.height,
      png: avatarCanvas.toDataURL('image/png'),
    });
    localStorage.setItem(AVATAR_STORAGE_KEY, payload);
  } catch {
    /* quota / private mode */
  }
}

/** @returns {Promise<boolean>} true if pixels were restored from storage */
function loadAvatarFromStorage() {
  return new Promise((resolve) => {
    try {
      const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
      if (!raw) {
        resolve(false);
        return;
      }
      const parsed = JSON.parse(raw);
      const png = typeof parsed === 'string' ? parsed : parsed.png;
      if (!png || typeof png !== 'string') {
        resolve(false);
        return;
      }
      const img = new Image();
      img.onload = () => {
        avatarCtx.globalCompositeOperation = 'source-over';
        avatarCtx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
        avatarCtx.drawImage(img, 0, 0, avatarCanvas.width, avatarCanvas.height);
        avatarCtx.globalCompositeOperation = 'source-over';
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = png;
    } catch {
      resolve(false);
    }
  });
}

function clearAvatarDrawing() {
  avatarCtx.globalCompositeOperation = 'source-over';
  avatarCtx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
  avatarLast = null;
  try {
    localStorage.removeItem(AVATAR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function redrawAvatarDollGuide() {
  if (!avatarDollGuide || !avatarGuideCtx) return;
  avatarGuideCtx.clearRect(0, 0, avatarDollGuide.width, avatarDollGuide.height);
  drawAvatarDollGuide(avatarGuideCtx, avatarDollGuide.width, avatarDollGuide.height);
}

async function bootstrapAvatarUi() {
  avatarCtx.globalCompositeOperation = 'source-over';
  avatarCtx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
  redrawAvatarDollGuide();
  await loadAvatarFromStorage();
  avatarCtx.globalCompositeOperation = 'source-over';
}

void bootstrapAvatarUi().then(() => {
  /* One full-canvas snapshot after guide + optional storage restore; first stroke skips duplicate push. */
  const blank = captureAvatarPixels();
  if (blank) {
    undoStack.push(blank);
    trimUndoStack();
    redoStack.length = 0;
  }
  syncUndoRedoButtons();
});

if (avatarSwatchesEl) {
  avatarSwatchesEl.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    const sw = t.closest('.avatar-swatch');
    if (!sw || !(sw instanceof HTMLButtonElement)) return;
    const col = sw.dataset.color;
    if (col) setAvatarColor(col);
  });
}
if (avatarColorInput) {
  avatarColorInput.addEventListener('input', () => {
    setAvatarColor(avatarColorInput.value);
  });
}
if (avatarBrushSlider) {
  avatarBrushSlider.addEventListener('input', () => syncBrushSliderInput());
  avatarBrushSlider.addEventListener('change', () => syncBrushSliderChange());
}
btnAvatarModeDraw?.addEventListener('click', () => setAvatarTool('draw'));
btnAvatarModeErase?.addEventListener('click', () => setAvatarTool('erase'));
setAvatarTool('draw');
setAvatarColor('#14213d');
syncBrushSliderInput();
syncBrushSliderChange();

/** Near-white “paper” left from old sessions; only fully opaque light neutrals (avoids dark line halos). */
function buildAvatarGameCanvas() {
  const w = avatarCanvas.width;
  const h = avatarCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d', { willReadFrequently: true });
  if (!g) return avatarCanvas;
  g.drawImage(avatarCanvas, 0, 0);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const gv = d[i + 1];
    const b = d[i + 2];
    const a = d[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, gv, b);
    const min = Math.min(r, gv, b);
    if (max >= 252 && min >= 248 && max - min <= 6) {
      d[i + 3] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

let avatarPainting = false;

/** Initial blank for first undo is the pointerdown snapshot on the first paint gesture (post-bootstrap). */
const AVATAR_UNDO_MAX = 40;
/** @type {ImageData[]} */
const undoStack = [];
/** @type {ImageData[]} */
const redoStack = [];
/** @type {ImageData | null} */
let gestureUndoSnap = null;
let avatarGestureDrew = false;

function isAvatarOverlayVisible() {
  return avatarOverlay && !avatarOverlay.classList.contains('hidden');
}

/** @returns {ImageData | null} */
function captureAvatarPixels() {
  try {
    return avatarCtx.getImageData(0, 0, avatarCanvas.width, avatarCanvas.height);
  } catch {
    return null;
  }
}

/**
 * @param {ImageData | null} data
 */
function applyAvatarPixels(data) {
  if (!data) return;
  avatarCtx.globalCompositeOperation = 'source-over';
  avatarCtx.putImageData(data, 0, 0);
}

function trimUndoStack() {
  while (undoStack.length > AVATAR_UNDO_MAX) undoStack.shift();
}

/**
 * @param {ImageData | null} a
 * @param {ImageData | null} b
 */
function avatarImageDataEqual(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  const da = a.data;
  const db = b.data;
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
  return true;
}

function avatarUndoParentEqualsCanvas() {
  if (undoStack.length === 0) return false;
  const top = undoStack[undoStack.length - 1];
  const cur = captureAvatarPixels();
  return avatarImageDataEqual(top, cur);
}

function syncUndoRedoButtons() {
  if (btnAvatarUndo) btnAvatarUndo.disabled = undoStack.length === 0 || avatarUndoParentEqualsCanvas();
  if (btnAvatarRedo) btnAvatarRedo.disabled = redoStack.length === 0;
}

function avatarUndo() {
  if (undoStack.length === 0) return false;
  const prev = undoStack.pop();
  if (!prev) return false;
  const cur = captureAvatarPixels();
  applyAvatarPixels(prev);
  if (cur) redoStack.push(cur);
  persistAvatarDrawing();
  syncUndoRedoButtons();
  return true;
}

function avatarRedo() {
  if (redoStack.length === 0) return false;
  const next = redoStack.pop();
  if (!next) return false;
  const cur = captureAvatarPixels();
  applyAvatarPixels(next);
  if (cur) undoStack.push(cur);
  trimUndoStack();
  persistAvatarDrawing();
  syncUndoRedoButtons();
  return true;
}

/**
 * @param {KeyboardEvent} ev
 */
function onAvatarOverlayKeyDown(ev) {
  if (!isAvatarOverlayVisible()) return;
  const t = ev.target;
  if (t instanceof HTMLElement) {
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || (tag === 'INPUT' && t instanceof HTMLInputElement && t.type === 'text')) return;
  }
  const mod = ev.ctrlKey || ev.metaKey;
  if (!mod) return;
  const k = ev.key.toLowerCase();
  const wantsUndo = k === 'z' && !ev.shiftKey;
  const wantsRedo =
    (k === 'z' && ev.shiftKey) || (k === 'y' && ev.ctrlKey && !ev.metaKey);
  if (!wantsUndo && !wantsRedo) return;
  let handled = false;
  if (wantsUndo) handled = avatarUndo();
  else handled = avatarRedo();
  if (handled) {
    ev.preventDefault();
    ev.stopPropagation();
  }
}

function avatarLocalFromEvent(e) {
  const rect = avatarCanvas.getBoundingClientRect();
  const scaleX = avatarCanvas.width / rect.width;
  const scaleY = avatarCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

avatarCanvas.addEventListener('pointerdown', (e) => {
  avatarPainting = true;
  avatarLast = avatarLocalFromEvent(e);
  gestureUndoSnap = captureAvatarPixels();
  avatarGestureDrew = false;
  avatarCanvas.setPointerCapture(e.pointerId);
});
avatarCanvas.addEventListener('pointermove', (e) => {
  if (!avatarPainting || !avatarLast) return;
  avatarGestureDrew = true;
  const p = avatarLocalFromEvent(e);
  const lw = getAvatarBrushWidth();
  if (avatarTool === 'erase') {
    avatarCtx.globalCompositeOperation = 'destination-out';
    avatarCtx.strokeStyle = '#000000';
  } else {
    avatarCtx.globalCompositeOperation = 'source-over';
    avatarCtx.strokeStyle = avatarColor;
  }
  avatarCtx.lineWidth = lw;
  avatarCtx.lineCap = 'round';
  avatarCtx.lineJoin = 'round';
  avatarCtx.beginPath();
  avatarCtx.moveTo(avatarLast.x, avatarLast.y);
  avatarCtx.lineTo(p.x, p.y);
  avatarCtx.stroke();
  avatarLast = p;
});
function endAvatarPaint(e) {
  const snap = gestureUndoSnap;
  const drew = avatarGestureDrew;
  gestureUndoSnap = null;
  avatarGestureDrew = false;
  avatarPainting = false;
  avatarLast = null;
  avatarCtx.globalCompositeOperation = 'source-over';
  try {
    avatarCanvas.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  if (drew && snap) {
    const top = undoStack.length ? undoStack[undoStack.length - 1] : null;
    if (!top || !avatarImageDataEqual(snap, top)) {
      undoStack.push(snap);
      trimUndoStack();
    }
    redoStack.length = 0;
  }
  syncUndoRedoButtons();
  persistAvatarDrawing();
}
avatarCanvas.addEventListener('pointerup', endAvatarPaint);
avatarCanvas.addEventListener('pointercancel', endAvatarPaint);

window.addEventListener('pagehide', () => {
  persistAvatarDrawing();
});

btnAvatarUndo?.addEventListener('click', () => {
  avatarUndo();
});
btnAvatarRedo?.addEventListener('click', () => {
  avatarRedo();
});

btnAvatarClear?.addEventListener('click', () => {
  redoStack.length = 0;
  const before = captureAvatarPixels();
  if (before) {
    const top = undoStack.length ? undoStack[undoStack.length - 1] : null;
    if (!top || !avatarImageDataEqual(before, top)) {
      undoStack.push(before);
      trimUndoStack();
    }
  }
  clearAvatarDrawing();
  syncUndoRedoButtons();
});

btnAvatarEnter?.addEventListener('click', () => {
  persistAvatarDrawing();
  avatarGameCanvas = buildAvatarGameCanvas();
  avatarOverlay.classList.add('hidden');
  gameStarted = true;
  if (!engine) bootstrapPhysics();
});

window.addEventListener('keydown', onAvatarOverlayKeyDown);

function bootstrapPhysics() {
  engine = Engine.create({
    enableSleeping: false,
  });
  // Matter 0.20 applies engine.gravity in Engine.update (see Engine.create: world.gravity aliases it).
  engine.gravity.x = 0;
  engine.gravity.y = 0.9;
  if (typeof engine.gravity.scale !== 'number' || engine.gravity.scale === 0) {
    engine.gravity.scale = 0.001;
  }
  if (engine.world.gravity !== engine.gravity) {
    engine.world.gravity = engine.gravity;
  }

  level = createLevel(Matter, engine);
  const ink = avatarGameCanvas || avatarCanvas;
  const layers = cropAvatarLayers(ink);
  player = createPlayer(Matter, engine, level.spawn, layers);

  runner = Runner.create();
  Runner.run(runner, engine);
}

/** True after drag passes threshold; world stroke points accumulate */
let strokeDragging = false;
/** @type {{ x: number, y: number }[]} */
let currentStroke = [];
/** @type {number | null} */
let paintPointerId = null;
let downScreenX = 0;
let downScreenY = 0;
let downWorldX = 0;
let downWorldY = 0;

function worldFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return camera.screenToWorld(sx, sy);
}

function appendWorldStrokePoint(w) {
  if (!currentStroke.length) {
    currentStroke.push({ x: w.x, y: w.y });
    return;
  }
  const last = currentStroke[currentStroke.length - 1];
  const dx = w.x - last.x;
  const dy = w.y - last.y;
  if (dx * dx + dy * dy > 4) currentStroke.push({ x: w.x, y: w.y });
}

function worldPolylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    s += Math.sqrt(dx * dx + dy * dy);
  }
  return s;
}

function getNextBrush() {
  const v = Number(nextBrushEl?.value);
  return Number.isFinite(v) ? Math.max(6, Math.min(28, v)) : 14;
}

function readNextDoodleFlags() {
  return {
    gravity: nextTogGravity?.checked ?? true,
    collision: nextTogCollision?.checked ?? true,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!gameStarted || e.button !== 0) return;
  downScreenX = e.clientX;
  downScreenY = e.clientY;
  const w = worldFromEvent(e);
  downWorldX = w.x;
  downWorldY = w.y;
  strokeDragging = false;
  currentStroke = [];
  paintPointerId = e.pointerId;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!gameStarted || paintPointerId == null || e.pointerId !== paintPointerId) return;
  if (!(e.buttons & 1)) return;

  if (!strokeDragging) {
    const dx = e.clientX - downScreenX;
    const dy = e.clientY - downScreenY;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    strokeDragging = true;
    currentStroke = [{ x: downWorldX, y: downWorldY }];
  }

  appendWorldStrokePoint(worldFromEvent(e));
});

function finishWorldStroke() {
  if (currentStroke.length < 2) {
    currentStroke = [];
    return;
  }
  const brush = getNextBrush();
  const composite = buildStrokeComposite(Matter, currentStroke, brush);
  const { canvas: sc, width, height } = rasterizeStroke(currentStroke, brush);
  const obj = registerDrawnObject(Matter, engine, {
    composite,
    strokeCanvas: sc,
    render: { width, height },
    worldPoints: currentStroke.slice(),
    brush,
    initialFlags: readNextDoodleFlags(),
  });
  if (obj) worldObjects.push(obj);
  currentStroke = [];
}

function tryPickDoodle(wx, wy) {
  const hit = pickWorldObjectAt(worldObjects, Matter, wx, wy);
  if (hit && hit.ownerPlayerId === LOCAL_PLAYER_ID) {
    selectObject(hit);
    return true;
  }
  return false;
}

function endPaintInteraction(e) {
  if (!gameStarted || paintPointerId == null || e.pointerId !== paintPointerId) return;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }

  const upW = worldFromEvent(e);

  if (strokeDragging && currentStroke.length >= 2) {
    appendWorldStrokePoint(upW);
    if (worldPolylineLength(currentStroke) >= 10) {
      finishWorldStroke();
    } else {
      if (!tryPickDoodle(downWorldX, downWorldY) && !tryPickDoodle(upW.x, upW.y)) {
        clearSelection();
      }
    }
  } else {
    if (!tryPickDoodle(downWorldX, downWorldY) && !tryPickDoodle(upW.x, upW.y)) {
      clearSelection();
    }
  }

  strokeDragging = false;
  currentStroke = [];
  paintPointerId = null;
}

canvas.addEventListener('pointerup', endPaintInteraction);
canvas.addEventListener('pointercancel', endPaintInteraction);

canvas.addEventListener('lostpointercapture', () => {
  strokeDragging = false;
  currentStroke = [];
  paintPointerId = null;
});

function selectObject(obj) {
  selectedObject = obj;
  inspector.classList.remove('hidden');
  inspectorOwner.textContent = `Owner: ${obj.ownerPlayerId}`;
  syncInspectorFromSelection();
}

function clearSelection() {
  selectedObject = null;
  inspector.classList.add('hidden');
}

function syncInspectorFromSelection() {
  const o = selectedObject;
  if (!o) return;
  togGravity.checked = o.flags.gravity;
  togCollision.checked = o.flags.collision;
  btnDelete.disabled = o.ownerPlayerId !== LOCAL_PLAYER_ID;
}

function onToggle() {
  if (!selectedObject) return;
  const o = selectedObject;
  o.flags.gravity = togGravity.checked;
  o.flags.collision = togCollision.checked;
  applyWorldObjectPhysics(Matter, o);
  syncInspectorFromSelection();
}

togGravity.addEventListener('change', onToggle);
togCollision.addEventListener('change', onToggle);

btnDelete.addEventListener('click', () => {
  if (!selectedObject || selectedObject.ownerPlayerId !== LOCAL_PLAYER_ID) return;
  removeWorldObject(Matter, engine, selectedObject);
  const i = worldObjects.indexOf(selectedObject);
  if (i >= 0) worldObjects.splice(i, 1);
  clearSelection();
});

btnInspectorClose.addEventListener('click', clearSelection);

function drawWorldObject(o) {
  if (!o.strokeCanvas || !o.render) return;
  const corner = getStrokeRasterCornerWorld(o, Matter);
  const body = o.visualAnchorBody;
  ctx.save();
  ctx.translate(corner.x, corner.y);
  if (body && o.rasterOffsetLocal) {
    ctx.rotate(body.angle);
  }
  ctx.drawImage(o.strokeCanvas, 0, 0, o.render.width, o.render.height);
  ctx.restore();
}

function drawPreviewStroke() {
  if (currentStroke.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(20, 20, 46, 0.85)';
  ctx.lineWidth = getNextBrush();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < currentStroke.length; i++) {
    const p = currentStroke[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} c */
function drawBodyPhysicsDebug(c, body) {
  const parts = body.parts && body.parts.length ? body.parts : [body];
  const isStatic = body.isStatic;
  const isSensor = body.isSensor;
  const hullColor = isStatic
    ? 'rgba(255, 80, 200, 0.92)'
    : isSensor
      ? 'rgba(255, 220, 60, 0.9)'
      : 'rgba(60, 255, 180, 0.9)';
  c.strokeStyle = hullColor;
  c.lineWidth = 2;
  for (const part of parts) {
    const v = part.vertices;
    if (!v || v.length < 2) continue;
    c.beginPath();
    c.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) c.lineTo(v[i].x, v[i].y);
    c.closePath();
    c.stroke();
  }
  const b = body.bounds;
  c.setLineDash([5, 4]);
  c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  c.lineWidth = 1;
  c.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
  c.setLineDash([]);
}

function drawDoodlesPhysicsDebug() {
  if (!togDebugPhysics?.checked) return;
  for (const o of worldObjects) {
    for (const body of Matter.Composite.allBodies(o.composite)) {
      drawBodyPhysicsDebug(ctx, body);
    }
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (!ctx) return;
  if (!level) {
    ctx.fillStyle = '#d4e2f2';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    return;
  }

  if (gameStarted && player) {
    player.update();
    camera.follow(player.position.x, player.position.y, level.bounds, 0.14);
  }

  drawBackground(ctx, level, camera);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  ctx.fillStyle = 'rgba(45, 106, 79, 0.42)';
  for (const p of level.bodies.platforms) {
    const { min, max } = p.bounds;
    ctx.fillRect(min.x, min.y, max.x - min.x, max.y - min.y);
  }
  const g = level.bodies.ground.bounds;
  ctx.fillStyle = 'rgba(100, 116, 139, 0.92)';
  ctx.fillRect(g.min.x, g.min.y, g.max.x - g.min.x, g.max.y - g.min.y);

  for (const o of worldObjects) {
    drawWorldObject(o);
  }

  if (strokeDragging && currentStroke.length) drawPreviewStroke();

  if (gameStarted && player) {
    player.draw(ctx);
    if (togDebugPhysics?.checked) {
      for (const b of player.ragBodies) {
        drawBodyPhysicsDebug(ctx, b);
      }
    }
  }

  drawDoodlesPhysicsDebug();

  if (selectedObject) {
    const o = selectedObject;
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.95)';
    ctx.lineWidth = 2;
    const b = getCompositeBounds(Matter, o.composite);
    ctx.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
  }

  ctx.restore();
}

void applyRemoteObjectUpsert;

resize();
loop();

window.__doodleVerse = {
  serializeState: () => (player ? serializeState(worldObjects, player.body) : null),
};
