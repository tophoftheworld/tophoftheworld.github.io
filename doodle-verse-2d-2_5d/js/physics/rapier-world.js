/**
 * Rapier 3D physics — world X/Z map, Y up, floor at y = 0.
 * @see ../../COORDINATES.md
 */
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';
import { rigidBodyBottomY } from '../coords.js';

export { RAPIER };

export const COLLIDER_HALF_Z = 12;
const GRAVITY_Y = -22;
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
const FILTER_HERO = CollisionGroup.FLOOR | CollisionGroup.DOODLE;
const FILTER_MAP = 0;

/** @type {import('@dimforge/rapier3d-compat').World | null} */
let world = null;

/** @type {import('@dimforge/rapier3d-compat').EventQueue | null} */
let eventQueue = null;

/** @type {import('@dimforge/rapier3d-compat').RigidBody | null} */
let floorBody = null;

let initPromise = null;

export function getPhysicsWorld() {
  return world;
}

export function getEventQueue() {
  return eventQueue;
}

export function getFloorBody() {
  return floorBody;
}

/** @returns {Promise<import('@dimforge/rapier3d-compat').World>} */
export function initPhysicsWorld() {
  if (world) return Promise.resolve(world);
  if (!initPromise) {
    initPromise = (async () => {
      await RAPIER.init();
      world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
      eventQueue = new RAPIER.EventQueue(true);
      return world;
    })();
  }
  return initPromise;
}

/**
 * @param {number} worldW
 * @param {number} worldH
 */
export function createArenaFloor(worldW, worldH) {
  if (!world) throw new Error('Physics world not initialized');
  const halfX = worldW * 0.5 + 80;
  const halfZ = worldH * 0.5 + 80;
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(worldW * 0.5, -0.25, worldH * 0.5);
  floorBody = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.cuboid(halfX, 0.25, halfZ)
    .setFriction(0.92)
    .setRestitution(0);
  col.setCollisionGroups(collisionGroups(CollisionGroup.FLOOR, FILTER_FLOOR));
  col.setActiveEvents(COLLISION_EVENTS);
  world.createCollider(col, floorBody);
}

/**
 * @param {number} x
 * @param {number} z
 * @param {number} halfX
 * @param {number} halfY
 * @param {number} halfZ
 */
export function createMapStaticBox(x, y, z, halfX, halfY, halfZ) {
  if (!world) throw new Error('Physics world not initialized');
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  const col = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ).setFriction(0.95);
  col.setCollisionGroups(collisionGroups(CollisionGroup.MAP, FILTER_MAP));
  world.createCollider(col, body);
  return body;
}

/**
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 */
export function createMapPropCylinder(x, y, z, radius, halfHeight) {
  if (!world) throw new Error('Physics world not initialized');
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  const col = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setFriction(0.9);
  col.setCollisionGroups(collisionGroups(CollisionGroup.MAP, FILTER_MAP));
  world.createCollider(col, body);
  return body;
}

/**
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 */
export function createHeroBody(x, z, radius) {
  if (!world) throw new Error('Physics world not initialized');
  const y = radius;
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.04)
    .setAngularDamping(0.9)
    .enabledRotations(false, false, false);
  const body = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.ball(radius)
    .setFriction(0.35)
    .setRestitution(0)
    .setDensity(0.001);
  col.setCollisionGroups(collisionGroups(CollisionGroup.HERO, FILTER_HERO));
  col.setActiveEvents(COLLISION_EVENTS);
  world.createCollider(col, body);
  body.userData = { kind: 'hero' };
  return body;
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
    const c = body.collider(i);
    c.setSensor(sensor);
  }
}

/**
 * @param {import('@dimforge/rapier3d-compat').RigidBody} body
 */
export function zeroLinVel(body) {
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
}

/**
 * @param {import('@dimforge/rapier3d-compat').RigidBody} body
 */
export function zeroAngVel(body) {
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/** @param {import('@dimforge/rapier3d-compat').Rotation} q */
export function rotationX(q) {
  const sin = 2 * (q.w * q.x + q.y * q.z);
  const cos = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(sin, cos);
}

/** @param {import('@dimforge/rapier3d-compat').RigidBody} body */
export function bodyBottomY(body) {
  return rigidBodyBottomY(body);
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
