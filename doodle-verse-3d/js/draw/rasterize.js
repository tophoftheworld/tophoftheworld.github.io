/** World units → canvas pixels for ink on XY sheet. */
export const INK_PX_PER_UNIT = 48;

/**
 * Rasterize stroke into a canvas sized to bbox of worldPoints (expanded by brush).
 * Points are world X and Y on the vertical sheet.
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush brush radius in world units
 */
export function rasterizeStroke(worldPoints, brush) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of worldPoints) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = brush;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const wWorld = Math.max(0.02, maxX - minX);
  const hWorld = Math.max(0.02, maxY - minY);
  const wPx = Math.max(1, Math.ceil(wWorld * INK_PX_PER_UNIT));
  const hPx = Math.max(1, Math.ceil(hWorld * INK_PX_PER_UNIT));

  const c = document.createElement('canvas');
  c.width = wPx;
  c.height = hPx;
  const ctx = c.getContext('2d');
  if (!ctx) {
    return { canvas: c, width: wWorld, height: hWorld, offsetX: minX, offsetY: minY };
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = Math.max(1, brush * INK_PX_PER_UNIT);
  ctx.beginPath();
  for (let i = 0; i < worldPoints.length; i++) {
    const p = worldPoints[i];
    const lx = (p.x - minX) * INK_PX_PER_UNIT;
    const ly = (p.y - minY) * INK_PX_PER_UNIT;
    if (i === 0) ctx.moveTo(lx, ly);
    else ctx.lineTo(lx, ly);
  }
  ctx.stroke();
  return { canvas: c, width: wWorld, height: hWorld, offsetX: minX, offsetY: minY };
}
