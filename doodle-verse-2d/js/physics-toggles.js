/**
 * Doodle physics from HUD flags only (default Matter collision layers).
 * Gravity off → static (fixed in world; no per-frame gravity cancel).
 * Collision off → sensor (overlap without blocking).
 *
 * @param {import('matter-js')} Matter
 * @param {import('./objects.js').WorldObject} obj
 */
export function applyWorldObjectPhysics(Matter, obj) {
  const { Body, Composite, Sleeping } = Matter;
  const { flags } = obj;
  const bodies = Composite.allBodies(obj.composite);

  const gravityOn = flags.gravity ?? true;
  const collisionOn = flags.collision ?? true;

  for (const b of bodies) {
    Body.setStatic(b, !gravityOn);
    b.isSensor = !collisionOn;
    b.plugin = b.plugin || {};
    b.plugin.footSolid = collisionOn;

    if (gravityOn && Sleeping && typeof Sleeping.set === 'function') {
      Sleeping.set(b, false);
    }
  }
}
