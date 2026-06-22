import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { LEVEL_SOLIDS } from '../data/level.js';

/**
 * @param {THREE.Scene} scene
 */
export function buildWorldMeshes(scene) {
  const group = new THREE.Group();
  group.name = 'level';

  const platTop = new THREE.MeshStandardMaterial({ color: 0xececea, roughness: 0.9 });
  const platSide = new THREE.MeshStandardMaterial({ color: 0xd4d4d2, roughness: 0.92 });

  for (const solid of LEVEL_SOLIDS) {
    if (solid.kind === 'ground') continue;

    const [cx, cy, cz] = solid.center;
    const [hx, hy, hz] = solid.half;
    const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    const mesh = new THREE.Mesh(geo, platTop);
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;

    const skirt = new THREE.Mesh(geo, platSide);
    skirt.position.copy(mesh.position);
    skirt.position.y -= 0.05;
    group.add(skirt);
    group.add(mesh);
  }

  scene.add(group);
  return group;
}
