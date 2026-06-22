import { applyWorldObjectPhysics } from '../physics/physics-toggles.js';
import { computePlanarRestAngle } from '../coords.js';
import { rotationZ } from '../physics/world.js';
import { createDoodleStrokeBody } from '../draw/doodle-spawn.js';
import { getPhysicsWorld, tagDoodleCollider } from '../physics/world.js';
import { settleDoodleOnFloor } from '../physics/doodle-physics.js';

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
 * @property {{ x: number, y: number }} position
 * @property {{ points: { x: number, y: number }[], brush: number }} stroke
 * @property {{ width: number, height: number } | null} render
 * @property {WorldObjectFlags} flags
 * @property {import('@dimforge/rapier3d-compat').RigidBody | null} rigidBody
 * @property {HTMLCanvasElement | null} strokeCanvas
 * @property {{ x: number, y: number, z: number } | null} [inkLocal]
 * @property {number} [groundX]
 * @property {number} [planeZ]
 * @property {boolean} [fallActive]
 * @property {number} [planarRestAngle]
 * @property {import('three').Group | null} [inkRoot]
 * @property {import('three').Mesh | null} [inkMesh]
 * @property {{ x: number, y: number }[]} [spawnPoints]
 */

function newId() {
  return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {WorldObject} obj
 */
export function refreshInkLocal(obj) {
  const body = obj.rigidBody;
  if (!body) return;
  const t = body.translation();
  const angle = rotationZ(body.rotation());
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = obj.position.x - t.x;
  const dy = obj.position.y - t.y;
  obj.inkLocal = {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
    z: 0,
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
 *     fallActive?: boolean,
 *   },
 * }} d
 */
export function registerDrawnObject(d) {
  const world = getPhysicsWorld();
  if (!world) return null;

  const pts = d.worldPoints;
  if (pts.length < 2) return null;

  const gravityOn = d.initialFlags?.gravity ?? true;
  const spawnLift = d.placement?.spawnLift ?? 0;

  const brushWorld = d.brushWorld ?? d.brush / 48;
  const built = createDoodleStrokeBody(world, pts, brushWorld, {
    planeZ: d.placement?.planeZ ?? 0,
    spawnLift,
    dynamic: gravityOn,
  });
  if (!built) return null;

  const originX = d.render?.offsetX ?? 0;
  const originY = d.render?.offsetY ?? 0;
  const rel = pts.map((p) => ({ x: p.x - originX, y: p.y - originY }));

  /** @type {WorldObject} */
  const obj = {
    id: newId(),
    ownerPlayerId: LOCAL_PLAYER_ID,
    createdAt: new Date().toISOString(),
    position: { x: originX, y: originY },
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
    planeZ: d.placement?.planeZ ?? 0,
    fallActive: d.placement?.fallActive ?? spawnLift > 0.01,
    planarRestAngle: 0,
    inkRoot: null,
    inkMesh: null,
    spawnPoints: pts.map((p) => ({ x: p.x, y: p.y })),
  };

  if (obj.flags.gravity) {
    obj.flags.collision = true;
    obj.planarRestAngle = computePlanarRestAngle(pts);
  }

  tagDoodleCollider(built.body, built.collider, obj.id);

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
  settleDoodleOnFloor(obj);
  applyWorldObjectPhysics(obj.rigidBody, obj);
  refreshInkLocal(obj);
}

/** @param {WorldObject} obj */
export function removeWorldObject(obj) {
  const world = getPhysicsWorld();
  if (world && obj.rigidBody) {
    world.removeRigidBody(obj.rigidBody);
  }
  obj.rigidBody = null;
  obj.strokeCanvas = null;
}
