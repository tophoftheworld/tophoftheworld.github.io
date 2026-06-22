/** Stroke colliders in world X/Y (upright) / Z depth via Rapier body translation. */
import {
  RAPIER,
  COLLIDER_HALF_Z,
  collisionGroups,
  CollisionGroup,
} from './physics/rapier-world.js';

const COLLISION_EVENTS = RAPIER.ActiveEvents.COLLISION_EVENTS;
import { rigidBodyBottomY } from './coords.js';

const FILTER_DOODLE = CollisionGroup.FLOOR | CollisionGroup.DOODLE | CollisionGroup.HERO;

/**
 * @param {{ x: number, y: number }[]} points
 * @param {number} minDist
 */
function simplifyPath(points, minDist) {
  if (points.length <= 2) return points.slice();
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
 * @param {{ x: number, y: number }[]} points
 * @param {number} thickness
 */
export function buildStrokeRibbon(points, thickness) {
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

const MIN_RIBBON_AREA = 24;
const DOODLE_DENSITY = 0.0015;

/**
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 */
export function strokePaddedBBox(worldPoints, brush) {
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
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

/**
 * @param {{ x: number, y: number }[]} ribbon
 * @param {number} hz
 * @returns {Float32Array}
 */
function extrudedHullPoints(ribbon, hz) {
  const pts = [];
  for (const v of ribbon) {
    pts.push(v.x, v.y, -hz);
    pts.push(v.x, v.y, hz);
  }
  return new Float32Array(pts);
}

/**
 * @param {import('@dimforge/rapier3d-compat').World} world
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 */
function buildBBoxCollider(world, worldPoints, brush) {
  console.warn('[doodle] convex hull fallback: axis-aligned box collider');
  const { minX, minY, maxX, maxY } = strokePaddedBBox(worldPoints, brush);
  const w = Math.max(maxX - minX, 8);
  const h = Math.max(maxY - minY, 8);
  const cx = minX + w * 0.5;
  const desc = RAPIER.ColliderDesc.cuboid(w * 0.5, h * 0.5, COLLIDER_HALF_Z)
    .setTranslation(0, h * 0.5, 0)
    .setFriction(0.55)
    .setRestitution(0)
    .setDensity(DOODLE_DENSITY);
  return { desc, minY, cx };
}

/**
 * @param {import('@dimforge/rapier3d-compat').World} world
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 */
function buildHullCollider(world, worldPoints, brush) {
  if (worldPoints.length < 2) return null;

  const simplifyDist = Math.max(4, brush * 0.4);
  const points = simplifyPath(worldPoints, simplifyDist);
  if (points.length < 2) return buildBBoxCollider(world, worldPoints, brush);

  const ribbon = buildStrokeRibbon(points, brush);
  if (!ribbon || ribbon.length < 3) return buildBBoxCollider(world, worldPoints, brush);

  let area = 0;
  for (let i = 0; i < ribbon.length; i++) {
    const a = ribbon[i];
    const b = ribbon[(i + 1) % ribbon.length];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area * 0.5);
  if (area < MIN_RIBBON_AREA) return buildBBoxCollider(world, worldPoints, brush);

  const tryHull = (ribbonVerts) => {
    let hullMinY = Infinity;
    let hullCx = 0;
    for (const v of ribbonVerts) {
      hullMinY = Math.min(hullMinY, v.y);
      hullCx += v.x;
    }
    hullCx /= ribbonVerts.length;
    const flat = extrudedHullPoints(
      ribbonVerts.map((v) => ({ x: v.x - hullCx, y: v.y - hullMinY })),
      COLLIDER_HALF_Z,
    );
    const hull = RAPIER.ColliderDesc.convexHull(flat);
    if (!hull) return null;
    hull.setFriction(0.55).setRestitution(0).setDensity(DOODLE_DENSITY);
    return { desc: hull, minY: hullMinY, cx: hullCx };
  };

  const first = tryHull(ribbon);
  if (first) return first;

  const coarse = simplifyPath(worldPoints, Math.max(8, brush * 0.75));
  const ribbon2 = buildStrokeRibbon(coarse, brush);
  if (ribbon2 && ribbon2.length >= 3) {
    const second = tryHull(ribbon2);
    if (second) return second;
  }

  return buildBBoxCollider(world, worldPoints, brush);
}

const DOODLE_MASS_BASE = 0.5;
const DOODLE_MASS_PER_PX2 = 0.00015;

/**
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 */
export function estimateDoodleMass(worldPoints, brush) {
  const { minX, minY, maxX, maxY } = strokePaddedBBox(worldPoints, brush);
  const area = Math.max(64, (maxX - minX) * (maxY - minY));
  return DOODLE_MASS_BASE + area * DOODLE_MASS_PER_PX2;
}

/**
 * @param {import('@dimforge/rapier3d-compat').World} world
 * @param {{ x: number, y: number }[]} worldPoints
 * @param {number} brush
 * @param {{ planeZ: number, spawnLift?: number, spawnY?: number, dynamic?: boolean }} opts
 */
export function createDoodleStrokeBody(world, worldPoints, brush, opts) {
  const hull = buildHullCollider(world, worldPoints, brush);
  if (!hull) return null;

  const { cx } = hull;
  const { minY: strokeMinY } = strokePaddedBBox(worldPoints, brush);
  const spawnLift = opts.spawnLift ?? opts.spawnY ?? 0;
  const y = strokeMinY + spawnLift;
  const z = opts.planeZ ?? 0;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(cx, y, z)
    .setLinearDamping(0.02)
    .setAngularDamping(0.85)
    .enabledRotations(true, false, false);

  if (!opts.dynamic) {
    bodyDesc.setBodyType(RAPIER.RigidBodyType.Fixed);
  }

  const body = world.createRigidBody(bodyDesc);
  const colDesc = hull.desc;
  colDesc.setCollisionGroups(collisionGroups(CollisionGroup.DOODLE, FILTER_DOODLE));
  colDesc.setActiveEvents(COLLISION_EVENTS);
  const collider = world.createCollider(colDesc, body);

  if (opts.dynamic && spawnLift <= 0.01) {
    const bottom = rigidBodyBottomY(body);
    const dy = -bottom;
    if (Math.abs(dy) > 0.001) {
      const t = body.translation();
      body.setTranslation({ x: t.x, y: t.y + dy, z: t.z }, true);
    }
  }

  return { body, collider, anchorX: cx, anchorY: strokeMinY, mass: estimateDoodleMass(worldPoints, brush) };
}

/**
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
  ctx.imageSmoothingEnabled = false;
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
