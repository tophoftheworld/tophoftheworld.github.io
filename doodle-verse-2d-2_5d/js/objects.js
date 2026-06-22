import { applyWorldObjectPhysics } from './physics-toggles.js';
import { computePlanarRestAngle, snapRigidBodyBottomToY0, strokeLocalToWorld } from './coords.js';
import { createDoodleStrokeBody, estimateDoodleMass } from './draw-spawn.js';
import { getPhysicsWorld, tagDoodleCollider } from './physics/rapier-world.js';
import { settleDoodleOnFloor } from './doodle-physics.js';
import { rotationX } from './physics/rapier-world.js';

export const LOCAL_PLAYER_ID = 'local';

/**
 * @typedef {Object} WorldObjectFlags
 * @property {boolean} gravity
 * @property {boolean} collision
 */

/**
 * @typedef {Object} WorldObject
 * @property {string} id
 * @property {string} ownerPlayerId
 * @property {string} createdAt
 * @property {{ x: number, y: number }} position raster top-left in stroke plane
 * @property {{ points: { x: number, y: number }[], brush: number }} stroke
 * @property {{ width: number, height: number } | null} render
 * @property {WorldObjectFlags} flags
 * @property {import('@dimforge/rapier3d-compat').RigidBody | null} rigidBody
 * @property {HTMLCanvasElement | null} strokeCanvas
 * @property {{ x: number, y: number } | null} [inkLocal]
 * @property {number} [groundX]
 * @property {number} [groundZ]
 * @property {boolean} [fallActive]
 * @property {number} [planarRestAngle]
 * @property {number} [pushMass]
 */

function newId() {
  return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {WorldObject} obj */
export function serializeWorldObject(obj) {
  return {
    id: obj.id,
    ownerPlayerId: obj.ownerPlayerId,
    createdAt: obj.createdAt,
    position: { ...obj.position },
    stroke: {
      brush: obj.stroke.brush,
      points: obj.stroke.points.map((p) => ({ ...p })),
    },
    render: obj.render ? { ...obj.render } : null,
    flags: { ...obj.flags },
  };
}

export function serializeState(worldObjects, heroBody) {
  const t = heroBody.translation();
  const r = heroBody.rotation();
  return {
    version: 2,
    localPlayerId: LOCAL_PLAYER_ID,
    player: {
      x: t.x,
      y: t.y,
      z: t.z,
      angle: rotationX(r),
    },
    objects: worldObjects.map(serializeWorldObject),
  };
}

export function applyRemoteObjectUpsert(worldObjects, payload) {
  void worldObjects;
  void payload;
  return null;
}

/**
 * @param {WorldObject} obj
 */
export function refreshInkLocal(obj) {
  const body = obj.rigidBody;
  if (!body) return;
  const t = body.translation();
  const angle = rotationX(body.rotation());
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = obj.position.x - t.x;
  const dy = obj.position.y - t.y;
  obj.inkLocal = {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

/**
 * @param {{
 *   strokeCanvas: HTMLCanvasElement,
 *   render: { width: number, height: number },
 *   worldPoints: { x: number, y: number }[],
 *   brush: number,
 *   initialFlags?: Partial<WorldObjectFlags>,
 *   placement?: {
 *     anchorX: number,
 *     planeZ: number,
 *     spawnLift?: number,
 *     spawnY?: number,
 *     fallActive?: boolean,
 *   },
 * }} d
 */
export function registerDrawnObject(d) {
  const world = getPhysicsWorld();
  if (!world) return null;

  const pts = d.worldPoints;
  if (pts.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = d.brush;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const rel = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  const gravityOn = d.initialFlags?.gravity ?? true;
  const spawnLift = d.placement?.spawnLift ?? d.placement?.spawnY ?? 0;

  const built = createDoodleStrokeBody(world, pts, d.brush, {
    planeZ: d.placement?.planeZ ?? 0,
    spawnLift,
    dynamic: gravityOn,
  });
  if (!built) return null;

  /** @type {WorldObject} */
  const obj = {
    id: newId(),
    ownerPlayerId: LOCAL_PLAYER_ID,
    createdAt: new Date().toISOString(),
    position: { x: minX, y: minY },
    stroke: { points: rel, brush: d.brush },
    render: { ...d.render },
    flags: {
      gravity: gravityOn,
      collision: gravityOn ? true : (d.initialFlags?.collision ?? true),
    },
    rigidBody: built.body,
    strokeCanvas: d.strokeCanvas,
    inkLocal: null,
    groundX: d.placement?.anchorX ?? built.anchorX,
    groundZ: d.placement?.planeZ ?? built.body.translation().z,
    fallActive: d.placement?.fallActive ?? spawnLift > 0.01,
    planarRestAngle: 0,
    pushMass: estimateDoodleMass(pts, d.brush),
  };

  if (obj.flags.gravity) {
    obj.flags.collision = true;
    obj.planarRestAngle = computePlanarRestAngle(pts);
  }

  tagDoodleCollider(built.body, built.collider, obj.id);
  built.body.userData = { kind: 'doodle', worldObjectId: obj.id };

  if (spawnLift <= 0.01 && gravityOn) {
    settleDoodleOnFloor(obj);
  }

  refreshInkLocal(obj);
  applyWorldObjectPhysics(obj.rigidBody, obj);
  return obj;
}

/** @param {WorldObject} obj */
export function landDoodleObject(obj) {
  if (!obj.rigidBody) return;
  snapRigidBodyBottomToY0(obj.rigidBody);
  settleDoodleOnFloor(obj);
  applyWorldObjectPhysics(obj.rigidBody, obj);
  refreshInkLocal(obj);
}

/** @param {WorldObject} obj */
export function removeWorldObject(obj) {
  const world = getPhysicsWorld();
  if (!world || !obj.rigidBody) return;
  world.removeRigidBody(obj.rigidBody);
  obj.rigidBody = null;
  obj.strokeCanvas = null;
}

function distSqPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) {
    const qx = px - x1;
    const qy = py - y1;
    return qx * qx + qy * qy;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = px - (x1 + t * dx);
  const qy = py - (y1 + t * dy);
  return qx * qx + qy * qy;
}

/**
 * @param {WorldObject} o
 * @param {number} relX
 * @param {number} relY
 */
export function strokePointToWorld(o, relX, relY) {
  const body = o.rigidBody;
  if (!body || !o.inkLocal) {
    return { x: o.position.x + relX, y: o.position.y + relY };
  }
  const angle = rotationX(body.rotation());
  const t = body.translation();
  const w = strokeLocalToWorld(t, angle, o.inkLocal.x + relX, o.inkLocal.y + relY);
  return { x: w.x, y: w.y };
}

/**
 * @param {WorldObject[]} list
 * @param {number} wx
 * @param {number} wy
 */
export function pickWorldObjectAt(list, wx, wy) {
  const extraTol = 14;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    const pts = o.stroke.points;
    if (pts.length < 2) continue;
    const half = o.stroke.brush * 0.5 + extraTol;
    const r2 = half * half;
    for (let j = 0; j < pts.length - 1; j++) {
      const p1 = strokePointToWorld(o, pts[j].x, pts[j].y);
      const p2 = strokePointToWorld(o, pts[j + 1].x, pts[j + 1].y);
      if (distSqPointToSegment(wx, wy, p1.x, p1.y, p2.x, p2.y) <= r2) {
        return o;
      }
    }
  }
  return null;
}
