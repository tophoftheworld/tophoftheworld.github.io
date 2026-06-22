import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { rasterizeStroke } from '../draw/rasterize.js';
import { refreshInkLocal } from '../objects/world-objects.js';
import { rotationZ } from '../physics/world.js';
const INK_RENDER_ORDER = 8;

/**
 * @param {{ x: number, y: number }[]} xyPoints
 * @param {number} brushWorld
 * @param {number} planeZ
 * @param {number} opacity
 */
function buildInkMesh(xyPoints, brushWorld, planeZ, opacity = 1) {
  const { canvas, width, height, offsetX, offsetY } = rasterizeStroke(xyPoints, brushWorld);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const cx = offsetX + width * 0.5;
  const cy = offsetY + height * 0.5;
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    alphaTest: 0.05,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = INK_RENDER_ORDER;
  mesh.position.set(cx, cy, planeZ);
  return mesh;
}

/**
 * @param {import('../objects/world-objects.js').WorldObject} obj
 */
function createInkMeshFromObject(obj) {
  if (!obj.strokeCanvas || !obj.render) return null;
  const { width, height } = obj.render;
  const tex = new THREE.CanvasTexture(obj.strokeCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = INK_RENDER_ORDER;
  return mesh;
}

/**
 * @param {THREE.Scene} scene
 */
export function createInkLayer(scene) {
  const group = new THREE.Group();
  group.name = 'ink';
  group.renderOrder = INK_RENDER_ORDER;
  scene.add(group);

  /** @type {THREE.Mesh | null} */
  let previewMesh = null;
  let previewPlaneZ = 0;

  function clearPreview() {
    if (!previewMesh) return;
    group.remove(previewMesh);
    previewMesh.geometry.dispose();
    previewMesh.material.map?.dispose();
    previewMesh.material.dispose();
    previewMesh = null;
  }

  /**
   * @param {{ x: number, y: number }[]} xyPoints
   * @param {number} brushWorld
   * @param {number} planeZ
   */
  function setPreviewStroke(xyPoints, brushWorld, planeZ) {
    clearPreview();
    if (xyPoints.length < 2) return;
    previewPlaneZ = planeZ;
    previewMesh = buildInkMesh(xyPoints, brushWorld, planeZ, 0.55);
    group.add(previewMesh);
  }

  /**
   * @param {import('../objects/world-objects.js').WorldObject} obj
   */
  function attachInkToObject(obj) {
    if (!obj.rigidBody) return;
    const mesh = createInkMeshFromObject(obj);
    if (!mesh) return;

    const root = new THREE.Group();
    root.name = `ink-${obj.id}`;
    root.renderOrder = INK_RENDER_ORDER;
    root.add(mesh);
    group.add(root);

    obj.inkRoot = root;
    obj.inkMesh = mesh;
    refreshInkLocal(obj);
    syncInkMesh(obj);
  }

  /**
   * @param {import('../objects/world-objects.js').WorldObject} obj
   */
  function syncInkMesh(obj) {
    const body = obj.rigidBody;
    const root = obj.inkRoot;
    const mesh = obj.inkMesh;
    if (!body || !root || !mesh || !obj.inkLocal) return;

    const t = body.translation();
    const angle = rotationZ(body.rotation());
    const w = obj.render?.width ?? 1;
    const h = obj.render?.height ?? 1;

    root.position.set(t.x, t.y, t.z);
    root.rotation.set(0, 0, angle);
    mesh.position.set(obj.inkLocal.x + w * 0.5, obj.inkLocal.y + h * 0.5, obj.inkLocal.z);
  }

  return {
    group,
    setPreviewStroke,
    clearPreview,
    attachInkToObject,
    syncInkMesh,
    get previewPlaneZ() {
      return previewPlaneZ;
    },
  };
}
