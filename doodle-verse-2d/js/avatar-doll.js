/** Avatar canvas pixel size (must match HTML canvas width/height). */
export const AVATAR_W = 360;
export const AVATAR_H = 480;

/** @deprecated use AVATAR_W for square legacy checks */
export const AVATAR_DOLL_SIZE = AVATAR_W;

/**
 * T-pose mannequin: tall, lean regions for easier drawing (1.5× legacy 240×320 layout).
 * armL/armR y raised ~21px vs uniform scale to match raised shoulders in player.js.
 * @type {Record<'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR', { x: number, y: number, w: number, h: number }>}
 */
export const DOLL_PIXEL_RECTS = {
  head: { x: 131, y: 9, w: 99, h: 84 },
  torso: { x: 131, y: 99, w: 99, h: 162 },
  armL: { x: 9, y: 129, w: 144, h: 39 },
  armR: { x: 207, y: 129, w: 144, h: 39 },
  legL: { x: 129, y: 267, w: 51, h: 192 },
  legR: { x: 180, y: 267, w: 51, h: 192 },
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
export function drawAvatarDollGuide(ctx, w, h) {
  const sx = w / AVATAR_W;
  const sy = h / AVATAR_H;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.strokeStyle = 'rgba(80, 90, 110, 0.85)';
  ctx.fillStyle = 'rgba(230, 233, 240, 0.35)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  for (const key of Object.keys(DOLL_PIXEL_RECTS)) {
    const r = DOLL_PIXEL_RECTS[/** @type {keyof typeof DOLL_PIXEL_RECTS} */ (key)];
    roundRect(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} rw
 * @param {number} rh
 * @param {number} r
 */
function roundRect(ctx, x, y, rw, rh, r) {
  const rr = Math.min(r, rw / 2, rh / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + rw, y, x + rw, y + rh, rr);
  ctx.arcTo(x + rw, y + rh, x, y + rh, rr);
  ctx.arcTo(x, y + rh, x, y, rr);
  ctx.arcTo(x, y, x + rw, y, rr);
  ctx.closePath();
}

/**
 * @param {HTMLCanvasElement | HTMLImageElement} source
 * @returns {Record<keyof typeof DOLL_PIXEL_RECTS, HTMLCanvasElement>}
 */
export function cropAvatarLayers(source) {
  /** @type {Record<string, HTMLCanvasElement>} */
  const out = {};
  for (const key of Object.keys(DOLL_PIXEL_RECTS)) {
    const r = DOLL_PIXEL_RECTS[/** @type {keyof typeof DOLL_PIXEL_RECTS} */ (key)];
    const c = document.createElement('canvas');
    c.width = Math.max(1, r.w);
    c.height = Math.max(1, r.h);
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    out[key] = c;
  }
  return /** @type {Record<keyof typeof DOLL_PIXEL_RECTS, HTMLCanvasElement>} */ (out);
}
