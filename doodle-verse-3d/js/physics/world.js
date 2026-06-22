/**
 * Rapier 3D world — static arena from level data + collision groups.
 */
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';
import { LEVEL, LEVEL_SOLIDS } from '../data/level.js';

export { RAPIER };

export const GRAVITY_Y = -24;
/** Half-thickness of doodle slab along world Z (XY sheet extruded ±Z). */
export const COLLIDER_HALF_Z = 0.35;

const COLLISION_EVENTS = RAPIER.ActiveEvents.COLLISION_EVENTS;

export const CollisionGroup = {
  FLOOR: 0x0001,
  DOODLE: 0x0002,
  HERO: 0x0004,
  MAP: 0x0008,
};

/** @param {number} membership @param {number} filter */
export function collisionGroups(membership, filter) {
  return (membership << 16) | filter;
}

const FILTER_FLOOR = CollisionGroup.DOODLE | CollisionGroup.HERO;
const FILTER_DOODLE = CollisionGroup.FLOOR | CollisionGroup.DOODLE | CollisionGroup.HERO;
export const FILTER_HERO = CollisionGroup.FLOOR | CollisionGroup.DOODLE;
const FILTER_MAP = 0;

/** @type {import('@dimforge/rapier3d-compat').World | null} */
let world = null;

/** @type {import('@dimforge/rapier3d-compat').EventQueue | null} */
let eventQueue = null;

let initPromise = null;

export function getPhysicsWorld() {
  return world;
}

export function getEventQueue() {
  return eventQueue;
}

/**
 * @param {import('@dimforge/rapier3d-compat').RigidBody} body
 * @param {import('@dimforge/rapier3d-compat').Collider} collider
 * @param {string} worldObjectId
 */
export function tagDoodleCollider(body, collider, worldObjectId) {
  body.userData = { kind: 'doodle', worldObjectId };
  collider.userData = { kind: 'doodle', worldObjectId };
}

/**
 * @param {import('@dimforge/rapier3d-compat').RigidBody} body
 * @param {boolean} dynamic
 * @param {boolean} sensor
 */
export function setBodyDynamic(body, dynamic, sensor = false) {
  if (!world) return;
  body.setBodyType(dynamic ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.Fixed, true);
  for (let i = 0; i < body.numColliders(); i++) {
    body.collider(i).setSensor(sensor);
  }
}

/** @param {import('@dimforge/rapier3d-compat').Rotation} q */
export function rotationZ(q) {
  const sin = 2 * (q.w * q.z + q.x * q.y);
  const cos = 1 - 2 * (q.y * q.y + q.z * q.z);
  return Math.atan2(sin, cos);
}

function tagLevelCollider(col, kind) {
  col.setCollisionGroups(
    collisionGroups(
      kind === 'floor' ? CollisionGroup.FLOOR : CollisionGroup.MAP,
      kind === 'floor' ? FILTER_FLOOR : FILTER_MAP,
    ),
  );
  col.setActiveEvents(COLLISION_EVENTS);
}

function buildBoundaryWalls() {
  if (!world) return;
  const { worldW, worldD, inner } = LEVEL;
  const wallT = 2;
  const wallH = 12;
  const yMid = wallH * 0.5;

  const walls = [
    [worldW * 0.5, yMid, inner.minZ - wallT * 0.5, worldW * 0.5, wallH * 0.5, wallT * 0.5],
    [worldW * 0.5, yMid, inner.maxZ + wallT * 0.5, worldW * 0.5, wallH * 0.5, wallT * 0.5],
    [inner.minX - wallT * 0.5, yMid, worldD * 0.5, wallT * 0.5, wallH * 0.5, worldD * 0.5],
    [inner.maxX + wallT * 0.5, yMid, worldD * 0.5, wallT * 0.5, wallH * 0.5, worldD * 0.5],
  ];

  for (const [x, y, z, hx, hy, hz] of walls) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    body.userData = { kind: 'map' };
    const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9).setRestitution(0);
    tagLevelCollider(col, 'map');
    world.createCollider(col, body);
  }
}

/** @returns {Promise<import('@dimforge/rapier3d-compat').World>} */
export function initPhysicsWorld() {
  if (world) return Promise.resolve(world);
  if (!initPromise) {
    initPromise = (async () => {
      await RAPIER.init();
      world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
      eventQueue = new RAPIER.EventQueue(true);

      for (const solid of LEVEL_SOLIDS) {
        const [cx, cy, cz] = solid.center;
        const [hx, hy, hz] = solid.half;
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz),
        );
        body.userData = { kind: solid.kind === 'ground' ? 'floor' : 'map' };
        const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setFriction(0.92)
          .setRestitution(0);
        tagLevelCollider(col, solid.kind === 'ground' ? 'floor' : 'map');
        world.createCollider(col, body);
      }
      buildBoundaryWalls();
      return world;
    })();
  }
  return initPromise;
}

/**
 * @param {number} dtSec
 */
export function stepPhysics(dtSec) {
  if (!world || !eventQueue) return;
  world.timestep = Math.min(0.033, Math.max(1 / 240, dtSec));
  world.step(eventQueue);
}

/**
 * @param {(handle1: number, handle2: number, started: boolean) => void} fn
 */
export function drainCollisions(fn) {
  if (!eventQueue) return;
  eventQueue.drainCollisionEvents(fn);
}

/**
 * @param {number} handle
 */
export function getCollider(handle) {
  if (!world) return null;
  return world.getCollider(handle);
}

/**
 * @param {number} handle
 */
export function colliderParentBody(handle) {
  return getCollider(handle)?.parent() ?? null;
}

/** @param {import('@dimforge/rapier3d-compat').Collider} collider */
export function isFloorCollider(collider) {
  const body = collider.parent();
  if (body?.userData?.kind === 'floor') return true;
  const groups = collider.collisionGroups();
  const membership = groups >>> 16;
  return (membership & CollisionGroup.FLOOR) !== 0;
}
