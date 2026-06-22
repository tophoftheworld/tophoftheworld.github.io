import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { LEVEL } from '../data/level.js';

/**
 * @param {number} sizeWorld
 * @param {number} cellUnits
 */
function makeGridTexture(sizeWorld, cellUnits = 1) {
  const cells = Math.ceil(sizeWorld / cellUnits);
  const px = Math.min(1024, cells * 8);
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  ctx.fillStyle = '#fafaf8';
  ctx.fillRect(0, 0, px, px);

  const step = px / cells;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= cells; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, px);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(px, p);
    ctx.stroke();
  }

  for (let i = 0; i < 18; i++) {
    const rx = Math.random() * px;
    const ry = Math.random() * px;
    const rw = 12 + Math.random() * 28;
    const rh = 12 + Math.random() * 28;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.018)';
    ctx.fillRect(rx, ry, rw, rh);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(sizeWorld / cellUnits, sizeWorld / cellUnits);
  return tex;
}

/**
 * @param {THREE.Scene} scene
 */
export function buildFloor(scene) {
  const size = Math.max(LEVEL.worldW, LEVEL.worldD) + 8;
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshStandardMaterial({
    map: makeGridTexture(size),
    color: 0xffffff,
    roughness: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(LEVEL.worldW * 0.5, 0, LEVEL.worldD * 0.5);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
