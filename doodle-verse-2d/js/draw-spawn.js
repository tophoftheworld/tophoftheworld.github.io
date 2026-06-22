/**
 * @param {{ x: number, y: number }[]} points
 * @param {number} minDist
 */
function simplifyPath(points, minDist) {
  if (points.length <= 2) {
    return points.slice();
  }
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy >= minDist * minDist) {
      out.push(p);
      last = p;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Closed polygon: thick stroke outline in world space.
 * @param {{ x: number, y: number }[]} points
 * @param {number} thickness
 */
function buildStrokeRibbon(points, thickness) {
  const half = thickness * 0.5;
  const left = [];
  const right = [];

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) {
      dx = 1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }

    const nx = -dy;
    const ny = dx;
    left.push({ x: points[i].x + nx * half, y: points[i].y + ny * half });
    right.push({ x: points[i].x - nx * half, y: points[i].y - ny * half });
  }

  return left.concat(right.reverse());
}

const MIN_RIBBON_AREA = 80;

/**
 * Single axis-aligned rectangle from stroke bbox (+ brush pad).
 * @param {import('matter-js')} Matter
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 */
function buildBBoxComposite(Matter, worldPoints, brush) {
  const { Bodies, Composite } = Matter;

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

  let w = maxX - minX;
  let h = maxY - minY;
  w = Math.max(w, 8);
  h = Math.max(h, 8);
  const cx = minX + w * 0.5;
  const cy = minY + h * 0.5;

  const box = Bodies.rectangle(cx, cy, w, h, {
    friction: 0.45,
    frictionStatic: 0.55,
    density: 0.002,
    restitution: 0.06,
    label: 'doodlePart',
  });

  return Composite.create({ bodies: [box] });
}

/**
 * Build Matter composite from world-space polyline: ribbon polygon via fromVertices, else bbox box.
 * @param {import('matter-js')} Matter
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 */
export function buildStrokeComposite(Matter, worldPoints, brush) {
  const { Bodies, Composite, Vertices } = Matter;

  if (worldPoints.length < 2) {
    return Composite.create({ bodies: [] });
  }

  const simplifyDist = Math.max(6, brush * 0.55);
  const points = simplifyPath(worldPoints, simplifyDist);
  if (points.length < 2) {
    return buildBBoxComposite(Matter, worldPoints, brush);
  }

  const ribbon = buildStrokeRibbon(points, brush);
  if (!ribbon || ribbon.length < 3) {
    return buildBBoxComposite(Matter, worldPoints, brush);
  }

  const area = Math.abs(Vertices.area(ribbon));
  if (area < MIN_RIBBON_AREA) {
    return buildBBoxComposite(Matter, worldPoints, brush);
  }

  const centroid = Vertices.centre(ribbon);
  const localVertices = ribbon.map((v) => ({
    x: v.x - centroid.x,
    y: v.y - centroid.y,
  }));

  const strokeBody = Bodies.fromVertices(
    centroid.x,
    centroid.y,
    [localVertices],
    {
      friction: 0.6,
      frictionStatic: 0.9,
      density: 0.0012,
      restitution: 0.04,
      frictionAir: 0.01,
      label: 'doodlePart',
    },
    true,
  );

  if (!strokeBody) {
    return buildBBoxComposite(Matter, worldPoints, brush);
  }

  if (strokeBody.type === 'composite' && Array.isArray(strokeBody.bodies)) {
    for (const b of strokeBody.bodies) {
      b.label = 'doodlePart';
    }
    return strokeBody;
  }

  strokeBody.label = 'doodlePart';
  return Composite.create({ bodies: [strokeBody] });
}

/**
 * Rasterize stroke into a canvas sized to bbox of worldPoints (expanded by brush).
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
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
  const w = Math.max(1, Math.ceil(maxX - minX));
  const h = Math.max(1, Math.ceil(maxY - minY));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return { canvas: c, width: w, height: h };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = brush;
  ctx.beginPath();
  for (let i = 0; i < worldPoints.length; i++) {
    const p = worldPoints[i];
    const lx = p.x - minX;
    const ly = p.y - minY;
    if (i === 0) ctx.moveTo(lx, ly);
    else ctx.lineTo(lx, ly);
  }
  ctx.stroke();
  return { canvas: c, width: w, height: h, offsetX: minX, offsetY: minY };
}
