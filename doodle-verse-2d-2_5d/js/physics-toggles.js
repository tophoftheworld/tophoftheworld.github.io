/**
 * Doodle physics from HUD flags (Rapier 3D).
 * @see ../COORDINATES.md
 */
import { setBodyDynamic } from './physics/rapier-world.js';

/**
 * @param {import('@dimforge/rapier3d-compat').RigidBody} body
 * @param {import('./objects.js').WorldObject} obj
 */
export function applyWorldObjectPhysics(body, obj) {
  const { flags } = obj;
  const gravityOn = flags.gravity ?? true;
  const collisionOn = gravityOn ? true : (flags.collision ?? true);
  if (gravityOn) {
    flags.collision = true;
  }
  setBodyDynamic(body, gravityOn, !collisionOn);
}
