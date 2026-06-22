/**
 * Doodle physics — floor at y = 0, settle rotation around Z only.
 */
import { rigidBodyBottomY, snapRigidBodyBottomToY0 } from '../coords.js';
import { applyWorldObjectPhysics } from './physics-toggles.js';
import {
  rotationZ,
  drainCollisions,
  getCollider,
  isFloorCollider,
} from './world.js';
import { getPhysicsWorld } from './world.js';

/** @typedef {import('../objects/world-objects.js').WorldObject} WorldObject */

const FLOOR_EPS = 0.35;
const SETTLE_VY_EPS = 1.2;
const BUMP_VY_THRESHOLD = 1.1;
const BUMP_IMPULSE_BASE = 8;
const BUMP_IMPULSE_CAP = 18;
const PLANAR_ANG_DAMP = 0.9;
const PLANAR_TORQUE_GAIN = 2.8;
const PLANAR_ANG_MAX = 0.16;
const SNAP_ANGLE = 0.04;
const SNAP_OMEGA = 0.025;
const BUMP_SPIN_DAMP = 0.4;

function wrapToPi(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function nearestRestAngle(angle, rest) {
  const d0 = wrapToPi(angle - rest);
  const d1 = wrapToPi(angle - (rest + Math.PI));
  return Math.abs(d0) <= Math.abs(d1) ? rest : rest + Math.PI;
}

function zeroAngVel(body) {
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/**
 * @param {WorldObject} obj
 */
export function isDoodleAirborne(obj) {
  const body = obj.rigidBody;
  if (!body) return !!(obj.fallActive ?? false);
  return rigidBodyBottomY(body) > FLOOR_EPS;
}

/**
 * @param {WorldObject} obj
 */
export function settleDoodleOnFloor(obj) {
  const body = obj.rigidBody;
  if (!body) return;
  snapRigidBodyBottomToY0(body);
  const lv = body.linvel();
  body.setLinvel({ x: lv.x, y: Math.min(0, lv.y), z: lv.z }, true);
  zeroAngVel(body);
  obj.fallActive = false;
}

/**
 * @param {WorldObject} obj
 * @param {number} dtSec
 */
function applyPlanarSettlingTorque(obj, dtSec) {
  const body = obj.rigidBody;
  if (!body || obj.planarRestAngle == null) return;

  const angle = rotationZ(body.rotation());
  const target = nearestRestAngle(angle, obj.planarRestAngle);
  const delta = wrapToPi(angle - target);
  const av = body.angvel();
  let wz = av.z * PLANAR_ANG_DAMP + -delta * PLANAR_TORQUE_GAIN * dtSec;
  wz = Math.max(-PLANAR_ANG_MAX, Math.min(PLANAR_ANG_MAX, wz));

  if (Math.abs(delta) < SNAP_ANGLE && Math.abs(wz) < SNAP_OMEGA) {
    zeroAngVel(body);
    return;
  }

  body.setAngvel({ x: 0, y: 0, z: wz }, true);
}

/**
 * @param {WorldObject} obj
 * @param {number} [dtSec]
 */
export function stepDoodlePhysics(obj, dtSec = 1 / 60) {
  if (!obj.flags.gravity || !obj.rigidBody) return;
  if (isDoodleAirborne(obj)) return;

  const body = obj.rigidBody;
  const bottom = rigidBodyBottomY(body);
  const vy = body.linvel().y;

  if (bottom <= FLOOR_EPS && vy <= SETTLE_VY_EPS) {
    const lv = body.linvel();
    body.setLinvel({ x: lv.x * 0.85, y: lv.y, z: lv.z * 0.85 }, true);
    if (obj.fallActive) settleDoodleOnFloor(obj);
    applyPlanarSettlingTorque(obj, dtSec);
  } else if (bottom < -0.5) {
    settleDoodleOnFloor(obj);
    obj.fallActive = false;
  }
}

/**
 * @param {WorldObject[]} worldObjects
 * @param {string} id
 */
function worldObjectById(worldObjects, id) {
  return worldObjects.find((o) => o.id === id) ?? null;
}

/**
 * @param {import('@dimforge/rapier3d-compat').RigidBody} heroBody
 * @param {() => WorldObject[]} getWorldObjects
 * @param {(obj: WorldObject) => void} onLand
 */
export function processPhysicsCollisions(heroBody, getWorldObjects, onLand) {
  if (!getPhysicsWorld()) return;

  drainCollisions((handle1, handle2, started) => {
    const c1 = getCollider(handle1);
    const c2 = getCollider(handle2);
    if (!c1 || !c2) return;

    const b1 = c1.parent();
    const b2 = c2.parent();
    if (!b1 || !b2) return;

    const floorHit =
      (isFloorCollider(c1) && b2.userData?.kind === 'doodle') ||
      (isFloorCollider(c2) && b1.userData?.kind === 'doodle');
    if (floorHit && started) {
      const doodleBody = isFloorCollider(c1) ? b2 : b1;
      const id = doodleBody.userData?.worldObjectId;
      if (id) {
        const obj = worldObjectById(getWorldObjects(), id);
        if (obj) onLand(obj);
      }
    }

    let hero = null;
    let otherBody = null;
    if (b1 === heroBody) {
      hero = b1;
      otherBody = b2;
    } else if (b2 === heroBody) {
      hero = b2;
      otherBody = b1;
    } else {
      return;
    }

    if (!started) return;
    const id = otherBody.userData?.worldObjectId;
    if (!id) return;
    const obj = worldObjectById(getWorldObjects(), id);
    if (!obj?.flags.gravity || !obj.rigidBody) return;

    const heroVy = hero.linvel().y;
    const doodleVy = obj.rigidBody.linvel().y;
    const upBump = heroVy > BUMP_VY_THRESHOLD || doodleVy > BUMP_VY_THRESHOLD;

    if (upBump) {
      const impulse = Math.min(
        BUMP_IMPULSE_CAP,
        BUMP_IMPULSE_BASE + Math.abs(heroVy) * 0.02 + Math.abs(doodleVy) * 0.02,
      );
      const lv = obj.rigidBody.linvel();
      obj.rigidBody.setLinvel({ x: lv.x, y: Math.max(lv.y, impulse), z: lv.z }, true);
      obj.fallActive = true;
      applyWorldObjectPhysics(obj.rigidBody, obj);
    } else {
      const av = obj.rigidBody.angvel();
      obj.rigidBody.setAngvel({ x: av.x * BUMP_SPIN_DAMP, y: av.y, z: av.z * BUMP_SPIN_DAMP }, true);
    }
  });
}

/**
 * @param {WorldObject[]} worldObjects
 */
export function postPhysicsStep(worldObjects) {
  for (const o of worldObjects) {
    if (o.fallActive && !isDoodleAirborne(o)) {
      settleDoodleOnFloor(o);
      if (o.rigidBody) applyWorldObjectPhysics(o.rigidBody, o);
    }
  }
}
