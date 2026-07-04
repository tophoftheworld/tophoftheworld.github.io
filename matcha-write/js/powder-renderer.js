/**
 * Matcha powder surface renderer — prototype + textured compositing with edge FX.
 */
(function (global) {
  const POWDER_ALPHA = 1;
  const MATCHA_BASE = { r: 90, g: 143, b: 60 };
  const MATCHA_DARK = { r: 58, g: 98, b: 38 };
  const MATCHA_LIGHT = { r: 118, g: 168, b: 82 };

  const MIN_SEGMENT = 4;
  const BRUSH_SCALE = 0.8;
  const FROST_BLUR_PX = 4;
  const FROST_TINT = "rgba(255,255,255,0.16)";
  const FROST_SCALE = 0.5;
  const FROST_MIN_INTERVAL_MS = 50;

  function hash2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function fbm(x, y, octaves = 4) {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      v += amp * smoothNoise(x * freq, y * freq);
      amp *= 0.5;
      freq *= 2.1;
    }
    return v;
  }

  function createPowderTexture(size = 512) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x * 0.035, y * 0.035, 5);
        const grain = hash2(x * 0.7, y * 0.7);
        const clump = fbm(x * 0.012 + 40, y * 0.012 + 40, 3);
        const t = n * 0.55 + grain * 0.25 + clump * 0.2;
        const r = Math.round(MATCHA_DARK.r + t * (MATCHA_LIGHT.r - MATCHA_DARK.r));
        const g = Math.round(MATCHA_DARK.g + t * (MATCHA_LIGHT.g - MATCHA_DARK.g));
        const b = Math.round(MATCHA_DARK.b + t * (MATCHA_LIGHT.b - MATCHA_DARK.b));
        const i = (y * size + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = Math.round(POWDER_ALPHA * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function drawVideoCover(ctx, video, width, height) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.max(width / vw, height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;

    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, dx, dy, dw, dh);
    ctx.restore();
  }

  function PowderRenderer(stage, revealCanvas, powderCanvas, opts = {}) {
    this.stage = stage;
    this.revealCanvas = revealCanvas;
    this.powderCanvas = powderCanvas;
    this.video = opts.video || null;
    this.realistic = opts.realistic !== false;
    this.width = 1;
    this.height = 1;

    this.powderTexture = createPowderTexture();
    this.powderPattern = null;

    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");

    this.frostBuffer = document.createElement("canvas");
    this.frostCtx = this.frostBuffer.getContext("2d");

    this.revealCtx = revealCanvas.getContext("2d");
    this.powderCtx = powderCanvas.getContext("2d");

    this._hasCarving = false;
    this._frostDirty = false;
    this._lastFrostAt = 0;
  }

  PowderRenderer.prototype.syncSize = function () {
    const size = HandsRuntime.resizeCanvasToStage(this.revealCanvas, this.stage);
    HandsRuntime.resizeCanvasToStage(this.powderCanvas, this.stage);

    this.width = size.width;
    this.height = size.height;

    const dpr = window.devicePixelRatio || 1;
    this.maskCanvas.width = Math.floor(this.width * dpr);
    this.maskCanvas.height = Math.floor(this.height * dpr);
    this.maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.frostBuffer.width = Math.max(1, Math.floor(this.width * FROST_SCALE));
    this.frostBuffer.height = Math.max(1, Math.floor(this.height * FROST_SCALE));

    this.powderPattern = this.powderCtx.createPattern(this.powderTexture, "repeat");

    this.reset();
    return size;
  };

  PowderRenderer.prototype.reset = function () {
    const { width, height, maskCtx, revealCtx, powderCtx } = this;

    this._hasCarving = false;
    this._frostDirty = false;
    this._lastFrostAt = 0;

    maskCtx.clearRect(0, 0, width, height);
    revealCtx.clearRect(0, 0, width, height);

    powderCtx.clearRect(0, 0, width, height);
    if (this.realistic) {
      powderCtx.fillStyle = this.powderPattern;
    } else {
      powderCtx.fillStyle = `rgba(${MATCHA_BASE.r}, ${MATCHA_BASE.g}, ${MATCHA_BASE.b}, ${POWDER_ALPHA})`;
    }
    powderCtx.fillRect(0, 0, width, height);
  };

  PowderRenderer.prototype.markFrostDirty = function () {
    this._frostDirty = true;
  };

  PowderRenderer.prototype.needsFrostUpdate = function () {
    return this._hasCarving;
  };

  PowderRenderer.prototype.refreshFrost = function (video, now = performance.now()) {
    const { width, height, revealCtx, frostCtx, frostBuffer } = this;
    if (!this._hasCarving || !video || !video.videoWidth) {
      revealCtx.clearRect(0, 0, width, height);
      return;
    }

    const due = this._frostDirty || now - this._lastFrostAt >= FROST_MIN_INTERVAL_MS;
    if (!due) return;

    this._frostDirty = false;
    this._lastFrostAt = now;

    const fw = frostBuffer.width;
    const fh = frostBuffer.height;
    frostCtx.clearRect(0, 0, fw, fh);
    frostCtx.filter = `blur(${FROST_BLUR_PX * FROST_SCALE}px) saturate(0.95)`;
    drawVideoCover(frostCtx, video, fw, fh);
    frostCtx.filter = "none";

    revealCtx.clearRect(0, 0, width, height);
    revealCtx.drawImage(frostBuffer, 0, 0, fw, fh, 0, 0, width, height);

    revealCtx.globalCompositeOperation = "destination-in";
    revealCtx.drawImage(this.maskCanvas, 0, 0, width, height);

    revealCtx.globalCompositeOperation = "source-atop";
    revealCtx.fillStyle = FROST_TINT;
    revealCtx.fillRect(0, 0, width, height);
    revealCtx.globalCompositeOperation = "source-over";
  };

  PowderRenderer.prototype._bboxForPoint = function (x, y, r) {
    const pad = r + 10;
    return {
      x0: Math.max(0, x - pad),
      y0: Math.max(0, y - pad),
      x1: Math.min(this.width, x + pad),
      y1: Math.min(this.height, y + pad),
    };
  };

  PowderRenderer.prototype._bboxForSegment = function (x0, y0, x1, y1, r) {
    const pad = r + 10;
    return {
      x0: Math.max(0, Math.min(x0, x1) - pad),
      y0: Math.max(0, Math.min(y0, y1) - pad),
      x1: Math.min(this.width, Math.max(x0, x1) + pad),
      y1: Math.min(this.height, Math.max(y0, y1) + pad),
    };
  };

  PowderRenderer.prototype._refreshPowderRegion = function (bbox) {
    const { powderCtx } = this;
    const bw = bbox.x1 - bbox.x0;
    const bh = bbox.y1 - bbox.y0;
    if (bw <= 0 || bh <= 0) return;

    powderCtx.save();
    powderCtx.beginPath();
    powderCtx.rect(bbox.x0, bbox.y0, bw, bh);
    powderCtx.clip();
    powderCtx.globalCompositeOperation = "source-over";
    if (this.realistic) {
      powderCtx.fillStyle = this.powderPattern;
    } else {
      powderCtx.fillStyle = `rgba(${MATCHA_BASE.r}, ${MATCHA_BASE.g}, ${MATCHA_BASE.b}, ${POWDER_ALPHA})`;
    }
    powderCtx.fillRect(bbox.x0, bbox.y0, bw, bh);
    powderCtx.globalCompositeOperation = "destination-out";
    powderCtx.drawImage(this.maskCanvas, bbox.x0, bbox.y0, bw, bh, bbox.x0, bbox.y0, bw, bh);
    powderCtx.restore();
  };

  PowderRenderer.prototype._repaintRegionWithEdges = function (bbox, dirX, dirY) {
    if (!this.realistic) return;
    this._refreshPowderRegion(bbox);
    this._applyEdgeFX(bbox, dirX, dirY);
    this.markFrostDirty();
  };

  PowderRenderer.prototype._applyEdgeFX = function (bbox, dirX, dirY) {
    if (!bbox) return;
    const { maskCtx, powderCtx } = this;
    const dpr = this.maskCanvas.width / this.width;
    const hasDir = Math.abs(dirX) > 0.001 || Math.abs(dirY) > 0.001;

    const x0 = Math.max(0, Math.floor(bbox.x0 * dpr));
    const y0 = Math.max(0, Math.floor(bbox.y0 * dpr));
    const x1 = Math.min(this.maskCanvas.width, Math.ceil(bbox.x1 * dpr));
    const y1 = Math.min(this.maskCanvas.height, Math.ceil(bbox.y1 * dpr));
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw < 2 || rh < 2) return;

    const maskData = maskCtx.getImageData(x0, y0, rw, rh);
    const md = maskData.data;
    const w = rw;

    powderCtx.save();
    const cssX0 = bbox.x0;
    const cssY0 = bbox.y0;

    for (let py = 1; py < rh - 1; py++) {
      for (let px = 1; px < rw - 1; px++) {
        const i = (py * w + px) * 4;
        const alpha = md[i + 3] / 255;
        if (alpha < 0.05) continue;

        const l = md[(py * w + (px - 1)) * 4 + 3];
        const r = md[(py * w + (px + 1)) * 4 + 3];
        const u = md[((py - 1) * w + px) * 4 + 3];
        const d = md[((py + 1) * w + px) * 4 + 3];

        const gx = (r - l) / 255;
        const gy = (d - u) / 255;
        const grad = Math.hypot(gx, gy);
        if (grad < 0.08) continue;

        const nx = -gx / grad;
        const ny = -gy / grad;
        const sx = cssX0 + px / dpr;
        const sy = cssY0 + py / dpr;
        const edge = Math.min(1, grad * 2.5);

        let lead = 0;
        let trail = 0;
        let side = 1;
        if (hasDir) {
          const align = nx * dirX + ny * dirY;
          lead = Math.max(0, align);
          trail = Math.max(0, -align);
          side = Math.max(0, 1 - lead - trail);
        }

        powderCtx.globalAlpha = edge * (0.12 + trail * 0.2 + side * 0.28);
        powderCtx.fillStyle = `rgba(${MATCHA_DARK.r}, ${MATCHA_DARK.g}, ${MATCHA_DARK.b}, 0.75)`;
        powderCtx.beginPath();
        powderCtx.arc(sx + nx * 1.6, sy + ny * 1.6, 1.4 + side * 0.4, 0, Math.PI * 2);
        powderCtx.fill();

        if (lead > 0.1) {
          const pile = edge * (0.22 + lead * 0.72);
          const out = 2.2 + lead * 5.5;
          const ridgeR = 1.5 + lead * 3.8;

          powderCtx.globalAlpha = pile;
          powderCtx.fillStyle = `rgba(${MATCHA_LIGHT.r}, ${MATCHA_LIGHT.g}, ${MATCHA_LIGHT.b}, 0.85)`;
          powderCtx.beginPath();
          powderCtx.arc(
            sx - nx * out + dirX * (1.2 + lead * 2),
            sy - ny * out + dirY * (1.2 + lead * 2),
            ridgeR,
            0,
            Math.PI * 2
          );
          powderCtx.fill();

          if (lead > 0.38) {
            powderCtx.globalAlpha = pile * 0.75;
            powderCtx.beginPath();
            powderCtx.arc(
              sx - nx * (out + 2.8) + dirX * (2.5 + lead * 3),
              sy - ny * (out + 2.8) + dirY * (2.5 + lead * 3),
              ridgeR * 0.82,
              0,
              Math.PI * 2
            );
            powderCtx.fill();
          }

          if (lead > 0.55 && hash2(sx, sy) > 0.55) {
            powderCtx.globalAlpha = pile * 0.5;
            powderCtx.fillStyle = `rgba(${MATCHA_BASE.r}, ${MATCHA_BASE.g}, ${MATCHA_BASE.b}, 0.7)`;
            powderCtx.beginPath();
            powderCtx.arc(
              sx - nx * (out + 1.2) + dirX * (3.5 + lead * 2),
              sy - ny * (out + 1.2) + dirY * (3.5 + lead * 2),
              1 + lead * 1.6,
              0,
              Math.PI * 2
            );
            powderCtx.fill();
          }
        } else if (!hasDir) {
          powderCtx.globalAlpha = edge * 0.28;
          powderCtx.fillStyle = `rgba(${MATCHA_LIGHT.r}, ${MATCHA_LIGHT.g}, ${MATCHA_LIGHT.b}, 0.8)`;
          powderCtx.beginPath();
          powderCtx.arc(sx - nx * 2.5, sy - ny * 2.5, 1.8, 0, Math.PI * 2);
          powderCtx.fill();
        }
      }
    }
    powderCtx.restore();
  };

  PowderRenderer.prototype._softCircle = function (ctx, x, y, radius, mode) {
    const r = Math.max(2, radius);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (mode === "mask") {
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.55, "rgba(0,0,0,0.85)");
      g.addColorStop(0.85, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0)");
    } else if (mode === "erase") {
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.72, "rgba(0,0,0,1)");
      g.addColorStop(0.92, "rgba(0,0,0,0.5)");
      g.addColorStop(1, "rgba(0,0,0,0)");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  PowderRenderer.prototype._carveMaskPoint = function (x, y, radius, dirX, dirY) {
    this.maskCtx.globalCompositeOperation = "source-over";
    this._softCircle(this.maskCtx, x, y, radius, "mask");

    if (dirX || dirY) {
      const leadX = x + dirX * radius * 0.22;
      const leadY = y + dirY * radius * 0.22;
      this._softCircle(this.maskCtx, leadX, leadY, radius * 0.92, "mask");
    }

    this._hasCarving = true;
  };

  PowderRenderer.prototype.carvePoint = function (x, y, radius) {
    this._carveMaskPoint(x, y, radius);
    if (this.realistic) {
      this._repaintRegionWithEdges(this._bboxForPoint(x, y, radius), 0, 0);
    } else {
      this.markFrostDirty();
    }
  };

  PowderRenderer.prototype.carveSegment = function (x0, y0, x1, y1, radius) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const segBbox = this._bboxForSegment(x0, y0, x1, y1, radius);
    const dirX = len > 0.001 ? dx / len : 0;
    const dirY = len > 0.001 ? dy / len : 0;

    if (len < MIN_SEGMENT) {
      this._carveMaskPoint(x1, y1, radius, dirX, dirY);
      this._repaintRegionWithEdges(segBbox, dirX, dirY);
      return;
    }

    const steps = Math.ceil(len / (MIN_SEGMENT * 0.75));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this._carveMaskPoint(x0 + dx * t, y0 + dy * t, radius, dirX, dirY);
    }
    this._repaintRegionWithEdges(segBbox, dirX, dirY);
  };

  PowderRenderer.prototype.brushRadius = function (hand, canvasWidth) {
    const palm = HandsRuntime.palmScale(hand);
    const strength = HandsRuntime.pinchStrength(hand);
    const base = palm * canvasWidth * 0.14 * BRUSH_SCALE;
    return base * (0.55 + 0.45 * strength);
  };

  global.PowderRenderer = PowderRenderer;
})(window);
