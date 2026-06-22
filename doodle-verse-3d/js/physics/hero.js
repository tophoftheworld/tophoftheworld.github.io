/**
 * Hero capsule — WASD on XZ, physics jump on Y.
 */
import {
  RAPIER,
  getPhysicsWorld,
  stepPhysics,
  collisionGroups,
  CollisionGroup,
  FILTER_HERO,
} from './world.js';
import { LEVEL } from '../data/level.js';

/** Match puppet `worldH` (2.4) — capsule height = 2×halfHeight + 2×radius. */
export const HERO_RADIUS = 0.32;
export const HERO_HALF_HEIGHT = 0.88;
export const HERO_FOOT_OFFSET = HERO_RADIUS + HERO_HALF_HEIGHT;

export const WALK_SPEED = 6;
export const RUN_SPEED = 12;
export const JUMP_VY = 9;

const GROUND_RAY_LEN = 0.12;
const GROUNDED_VY_MAX = 2.5;
const COYOTE_MS = 80;

/** @type {import('@dimforge/rapier3d-compat').RigidBody | null} */
let heroBody = null;

/** @type {import('@dimforge/rapier3d-compat').Collider | null} */
let heroCollider = null;

let coyoteUntil = 0;
let lastGrounded = false;

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function createHero(x, y, z) {
  const world = getPhysicsWorld();
  if (!world) throw new Error('Physics world not initialized');

  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setLinearDamping(0.05)
    .setAngularDamping(1)
    .enabledRotations(false, false, false);

  heroBody = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.capsule(HERO_HALF_HEIGHT, HERO_RADIUS)
    .setFriction(0.4)
    .setRestitution(0)
    .setDensity(1);
  col.setCollisionGroups(collisionGroups(CollisionGroup.HERO, FILTER_HERO));
  col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  heroCollider = world.createCollider(col, heroBody);
  heroBody.userData = { kind: 'hero' };
  return heroBody;
}

export function getHeroBody() {
  return heroBody;
}

export function getHeroCollider() {
  return heroCollider;
}

/**
 * @param {number} nowMs
 */
function rayGrounded(nowMs) {
  const world = getPhysicsWorld();
  const body = heroBody;
  if (!world || !body) return false;

  const t = body.translation();
  const origin = { x: t.x, y: t.y - HERO_FOOT_OFFSET + 0.02, z: t.z };
  const dir = { x: 0, y: -1, z: 0 };
  const ray = new RAPIER.Ray(origin, dir);
  const hit = world.castRay(
    ray,
    GROUND_RAY_LEN,
    true,
    undefined,
    undefined,
    heroCollider ?? undefined,
    body,
  );

  if (!hit) return false;
  const vy = body.linvel().y;
  return vy <= GROUNDED_VY_MAX;
}

/**
 * @param {number} nowMs
 */
export function isHeroGrounded(nowMs) {
  const grounded = rayGrounded(nowMs);
  if (grounded) {
    coyoteUntil = nowMs + COYOTE_MS;
    lastGrounded = true;
    return true;
  }
  if (lastGrounded && nowMs <= coyoteUntil) return true;
  lastGrounded = false;
  return false;
}

/**
 * @param {{ vx: number, vz: number, jump: boolean, nowMs: number }} input
 */
export function applyHeroInput({ vx, vz, jump, nowMs }) {
  const body = heroBody;
  if (!body) return;

  const lv = body.linvel();
  let vy = lv.y;

  if (jump && isHeroGrounded(nowMs)) {
    vy = JUMP_VY;
  }

  body.setLinvel({ x: vx, y: vy, z: vz }, true);
}

export function clampHeroToArena() {
  const body = heroBody;
  if (!body) return;

  const t = body.translation();
  const { inner } = LEVEL;
  const pad = HERO_RADIUS + 0.05;
  const x = Math.min(inner.maxX - pad, Math.max(inner.minX + pad, t.x));
  const z = Math.min(inner.maxZ - pad, Math.max(inner.minZ + pad, t.z));
  if (Math.abs(x - t.x) > 0.001 || Math.abs(z - t.z) > 0.001) {
    body.setTranslation({ x, y: t.y, z }, true);
    const lv = body.linvel();
    body.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
  }
}

export function postHeroPhysicsStep(nowMs) {
  const body = heroBody;
  if (!body) return;

  const lv = body.linvel();
  if (isHeroGrounded(nowMs) && lv.y < 0) {
    body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
  }
}

/**
 * @param {number} dtSec
 * @param {number} nowMs
 */
export function stepHeroPhysics(dtSec, nowMs) {
  stepPhysics(dtSec);
  clampHeroToArena();
  postHeroPhysicsStep(nowMs);
}
