import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { HERO_FOOT_OFFSET } from '../physics/hero.js';

/**
 * @param {THREE.Scene} scene
 * @param {HTMLCanvasElement} spriteCanvas
 */
export function createHeroBillboard(scene, spriteCanvas) {
  const tex = new THREE.CanvasTexture(spriteCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.NearestFilter;

  const aspect = spriteCanvas.width / Math.max(1, spriteCanvas.height);
  const height = 1.35;
  const width = height * aspect;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const geo = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height * 0.5;
  const root = new THREE.Group();
  root.add(mesh);
  scene.add(root);

  let facingSign = 1;

  /**
   * @param {import('@dimforge/rapier3d-compat').RigidBody} body
   * @param {THREE.Camera} camera
   * @param {number} vx
   */
  function sync(body, camera, vx) {
    const t = body.translation();
    root.position.set(t.x, t.y - HERO_FOOT_OFFSET, t.z);

    root.lookAt(camera.position);

    if (vx > 0.2) facingSign = 1;
    else if (vx < -0.2) facingSign = -1;
    mesh.scale.x = Math.abs(mesh.scale.x) * facingSign;
  }

  return { root, sync, texture: tex };
}
