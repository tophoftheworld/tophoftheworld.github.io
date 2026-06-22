import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { HERO_FOOT_OFFSET } from '../physics/hero.js';

const SHADOW_RX = 0.22;
const SHADOW_RZ = 0.1;
const SHADOW_BASE_ALPHA = 0.22;
const JUMP_REF = 2.0;

/**
 * @param {THREE.Scene} scene
 */
export function createHeroShadow(scene) {
  const geo = new THREE.CircleGeometry(1, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x19231e,
    transparent: true,
    opacity: SHADOW_BASE_ALPHA,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(SHADOW_RX, SHADOW_RZ, 1);
  mesh.position.y = 0.015;
  scene.add(mesh);

  /**
   * @param {import('@dimforge/rapier3d-compat').RigidBody} body
   */
  function sync(body) {
    const t = body.translation();
    mesh.position.x = t.x;
    mesh.position.z = t.z;
    const jump = Math.max(0, t.y - HERO_FOOT_OFFSET);
    const fade = Math.min(1, jump / JUMP_REF);
    mat.opacity = SHADOW_BASE_ALPHA * (1 - fade * 0.48);
  }

  return { mesh, sync };
}
