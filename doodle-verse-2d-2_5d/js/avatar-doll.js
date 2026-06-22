/** Avatar canvas pixel size (must match HTML canvas width/height). */
export const AVATAR_W = 360;
export const AVATAR_H = 480;

/** @deprecated use AVATAR_W for square legacy checks */
export const AVATAR_DOLL_SIZE = AVATAR_W;

/**
 * T-pose mannequin: tall, lean regions for easier drawing (1.5× legacy 240×320 layout).
 * armL/armR: inner edges stop short of the torso bbox (1px gap) so layer rects do not overlap the body crop;
 * arm tops match torso.y (top-aligned with body).
 * @type {Record<'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR', { x: number, y: number, w: number, h: number }>}
 */
export const DOLL_PIXEL_RECTS = {
  head: { x: 131, y: 9, w: 99, h: 84 },
  torso: { x: 131, y: 99, w: 99, h: 162 },
  /** Inner edge x+w = torso.x − 1; y = torso.y (top-aligned with body). */
  armL: { x: 9, y: 99, w: 121, h: 39 },
  /** Inner edge x = torso.x + torso.w + 1; y = torso.y. */
  armR: { x: 231, y: 99, w: 120, h: 39 },
  legL: { x: 129, y: 267, w: 51, h: 192 },
  legR: { x: 180, y: 267, w: 51, h: 192 },
};

/**
 * Full-doll (360×480) attachment points for 2D puppet draw — derived from {@link DOLL_PIXEL_RECTS}.
 * @returns {{
 *   feetDoll: { x: number, y: number },
 *   rootDoll: { x: number, y: number },
 *   neckDoll: { x: number, y: number },
 *   hipLDoll: { x: number, y: number },
 *   hipRDoll: { x: number, y: number },
 *   shoulderLDoll: { x: number, y: number },
 *   shoulderRDoll: { x: number, y: number },
 * }} Shoulders: slightly below torso top, horizontally **outside** the torso bbox so pivots sit on the sides.
 */
export function getDollAttachmentPoints() {
  const { head, torso, armL, armR, legL, legR } = DOLL_PIXEL_RECTS;
  const feetY = legL.y + legL.h;
  const feetX = (legL.x + legL.w * 0.5 + legR.x + legR.w * 0.5) * 0.5;
  const rootDoll = { x: torso.x + torso.w * 0.5, y: torso.y + torso.h };
  const neckDoll = { x: head.x + head.w * 0.5, y: head.y + head.h };
  const hipLDoll = { x: legL.x + legL.w * 0.5, y: legL.y };
  const hipRDoll = { x: legR.x + legR.w * 0.5, y: legR.y };
  /**
   * Y: between torso top and arm-strip top; +33 is prior +22 lowered by 50% more (22×1.5).
   * X: past torso left/right — torso.x / +w are the crop edges; opaque art often sits inset,
   * so without a horizontal outset the pivot still reads “inside” the body.
   */
  const shoulderY = torso.y + 33;
  const shoulderOutX = 12;
  const shoulderLDoll = { x: torso.x - shoulderOutX, y: shoulderY };
  const shoulderRDoll = { x: torso.x + torso.w + shoulderOutX, y: shoulderY };
  return {
    feetDoll: { x: feetX, y: feetY },
    rootDoll,
    neckDoll,
    hipLDoll,
    hipRDoll,
    shoulderLDoll,
    shoulderRDoll,
  };
}

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
