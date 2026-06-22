import { drawAvatarDollGuide } from './avatar-doll.js';

/** Full composite drawing (fork-specific key). */
export const AVATAR_STORAGE_KEY = 'doodle-verse-2d-2_5d-avatar-v1';

/**
 * @param {{ onEnterWorld: (spriteCanvas: HTMLCanvasElement) => void }} opts
 */
export async function mountAvatarStudio({ onEnterWorld }) {
  const avatarOverlay = document.getElementById('avatar-overlay');
  const avatarCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('avatar-canvas'));
  const avatarDollGuide = /** @type {HTMLCanvasElement | null} */ (document.getElementById('avatar-doll-guide'));
  const planeHint = document.getElementById('plane-hint');

  if (!avatarOverlay || !avatarCanvas) {
    onEnterWorld(fallbackSpriteCanvas());
    return;
  }

  const avatarCtx = /** @type {CanvasRenderingContext2D} */ (
    avatarCanvas.getContext('2d', { willReadFrequently: true })
  );
  const avatarGuideCtx = avatarDollGuide ? avatarDollGuide.getContext('2d') : null;
  const avatarBrushHidden = /** @type {HTMLInputElement | null} */ (document.getElementById('avatar-brush'));
  const avatarBrushSlider = /** @type {HTMLInputElement | null} */ (document.getElementById('avatar-brush-slider'));
  const avatarBrushReadout = document.getElementById('avatar-brush-readout');
  const AVATAR_BRUSH_MIN = 2;
  const AVATAR_BRUSH_MAX = 30;
  /** Snap / tick values at 0%, 25%, 50%, 75%, 100% of [min,max] so native range ticks span the full track. */
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

  /** On release: if exactly one preset is closest and within radius, nudge to it; ties keep your px. */
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

  /** While dragging — continuous px, no magnetic jump. */
  function syncBrushSliderInput() {
    if (!avatarBrushSlider) return;
    const w = readSliderBrushPx();
    if (avatarBrushHidden) avatarBrushHidden.value = String(w);
    if (avatarBrushReadout) avatarBrushReadout.textContent = `${w} px`;
    avatarBrushSlider.setAttribute('aria-valuetext', `${w} pixels`);
  }

  /** Pointer / touch release — snap only when near a preset. */
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

  const AVATAR_UNDO_MAX = 40;
  /** @type {ImageData[]} */
  const undoStack = [];
  /** @type {ImageData[]} */
  const redoStack = [];
  /** @type {ImageData | null} */
  let gestureUndoSnap = null;
  let avatarGestureDrew = false;

  /** @type {{ x: number, y: number } | null} */
  let avatarLast = null;
  let avatarPainting = false;

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

  /** @returns {Promise<boolean>} */
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

  /** Near-white “paper” from old sessions → transparent (matches legacy main). */
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

  function avatarLocalFromEvent(e) {
    const rect = avatarCanvas.getBoundingClientRect();
    const scaleX = avatarCanvas.width / rect.width;
    const scaleY = avatarCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  async function bootstrapAvatarUi() {
    avatarCtx.globalCompositeOperation = 'source-over';
    avatarCtx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
    redrawAvatarDollGuide();
    await loadAvatarFromStorage();
    avatarCtx.globalCompositeOperation = 'source-over';
  }

  await bootstrapAvatarUi();
  avatarOverlay.classList.remove('hidden');
  planeHint?.classList.add('hidden');

  {
    /* One full-canvas snapshot after guide + optional storage restore; first stroke skips duplicate push. */
    const blank = captureAvatarPixels();
    if (blank) {
      undoStack.push(blank);
      trimUndoStack();
      redoStack.length = 0;
    }
  }
  syncUndoRedoButtons();

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
    const sprite = buildAvatarGameCanvas();
    avatarOverlay.classList.add('hidden');
    planeHint?.classList.remove('hidden');
    onEnterWorld(sprite);
  });

  window.addEventListener('keydown', onAvatarOverlayKeyDown);
}

/** @returns {HTMLCanvasElement} */
function fallbackSpriteCanvas() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#e9c46a';
    g.beginPath();
    g.arc(32, 32, 20, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
