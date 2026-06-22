import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  colliderOutlineWorld,
  colliderWorldBoundsXZ,
  colliderWorldMinY,
  strokeLocalToWorld,
} from '../coords.js';
import { rotationZ } from '../physics/world.js';
import { HERO_RADIUS, HERO_HALF_HEIGHT } from '../physics/hero.js';

const GREEN = 0x3cffb4;
const CYAN = 0x44ddff;
const ORANGE = 0xff8833;
const MAGENTA = 0xff44cc;
const PLANE_TINT = 0x88aaff;
const WHITE = 0xffffff;
const YELLOW = 0xffee44;
const BOTTOM_CYAN = 0x44ffff;

/**
 * @param {THREE.Scene} scene
 * @param {HTMLElement} container
 */
export function createDebugOverlay(scene, container) {
  const root = new THREE.Group();
  root.name = 'debug-overlay';
  scene.add(root);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.zIndex = '30';
  container.appendChild(labelRenderer.domElement);

  /** @type {THREE.Object3D[]} */
  const physicsLines = [];
  /** @type {THREE.Line[]} */
  const coordLines = [];
  /** @type {CSS2DObject[]} */
  const labels = [];
  /** @type {THREE.Mesh[]} */
  const markers = [];
  /** @type {THREE.Mesh | null} */
  let heroCapsule = null;
  /** @type {THREE.Mesh | null} */
  let liveStrokePlane = null;

  function disposeObject(obj) {
    root.remove(obj);
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    } else if (obj instanceof THREE.Line || obj instanceof THREE.LineLoop) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  }

  function clearMarkers() {
    for (const m of markers) disposeObject(m);
    markers.length = 0;
  }

  function clearExtra() {
    clearMarkers();
    if (liveStrokePlane) {
      disposeObject(liveStrokePlane);
      liveStrokePlane = null;
    }
  }

  function clearPhysics() {
    for (const line of physicsLines) disposeObject(line);
    physicsLines.length = 0;
    if (heroCapsule) {
      root.remove(heroCapsule);
      heroCapsule.geometry.dispose();
      heroCapsule.material.dispose();
      heroCapsule = null;
    }
  }

  function clearCoords() {
    for (const line of coordLines) {
      root.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }
    coordLines.length = 0;
    for (const lbl of labels) {
      root.remove(lbl);
    }
    labels.length = 0;
  }

  /**
   * @param {import('@dimforge/rapier3d-compat').Collider} collider
   * @param {number} color
   */
  function addColliderOutline(collider, color) {
    const verts = colliderOutlineWorld(collider);
    if (verts.length < 2) return;
    const positions = new Float32Array(verts.length * 3);
    for (let i = 0; i < verts.length; i++) {
      positions[i * 3] = verts[i].x;
      positions[i * 3 + 1] = verts[i].y;
      positions[i * 3 + 2] = verts[i].z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const loop = new THREE.LineLoop(geo, mat);
    root.add(loop);
    physicsLines.push(loop);

    const b = colliderWorldBoundsXZ(collider);
    if (b.width > 0 && b.height > 0) {
      const y = colliderWorldMinY(collider);
      const boxGeo = new THREE.BufferGeometry();
      const x0 = b.minX;
      const z0 = b.minZ;
      const x1 = b.minX + b.width;
      const z1 = b.minZ + b.height;
      const pts = new Float32Array([
        x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0,
      ]);
      boxGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const boxMat = new THREE.LineDashedMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        dashSize: 0.25,
        gapSize: 0.15,
      });
      const boxLine = new THREE.Line(boxGeo, boxMat);
      boxLine.computeLineDistances();
      root.add(boxLine);
      physicsLines.push(boxLine);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} text
   */
  function addLabel(x, y, z, text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.color = '#fff';
    el.style.fontSize = '11px';
    el.style.fontFamily = 'system-ui, sans-serif';
    el.style.textShadow = '0 1px 2px rgba(0,0,0,0.7)';
    el.style.whiteSpace = 'nowrap';
    const lbl = new CSS2DObject(el);
    lbl.position.set(x, y, z);
    root.add(lbl);
    labels.push(lbl);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} color
   * @param {number} size
   */
  function addMarker(x, y, z, color, size = 0.12) {
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 50;
    root.add(mesh);
    markers.push(mesh);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} len
   */
  function addAxes(x, y, z, len = 0.45) {
    const addAxis = (dx, dy, dz, color) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([x, y, z, x + dx, y + dy, z + dz], 3),
      );
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 49;
      root.add(line);
      physicsLines.push(line);
    };
    addAxis(len, 0, 0, 0xff4444);
    addAxis(0, len, 0, 0x44ff44);
    addAxis(0, 0, len, 0x4444ff);
  }

  /**
   * @param {import('../objects/world-objects.js').WorldObject} o
   */
  function addInkBounds(o) {
    const body = o.rigidBody;
    if (!body || !o.inkLocal || !o.render) return;
    const t = body.translation();
    const angle = rotationZ(body.rotation());
    const w = o.render.width;
    const h = o.render.height;
    const lx0 = o.inkLocal.x;
    const ly0 = o.inkLocal.y;
    const p0 = strokeLocalToWorld(t, angle, lx0, ly0);
    const p1 = strokeLocalToWorld(t, angle, lx0 + w, ly0);
    const p2 = strokeLocalToWorld(t, angle, lx0 + w, ly0 + h);
    const p3 = strokeLocalToWorld(t, angle, lx0, ly0 + h);
    const pts = new Float32Array([
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: MAGENTA,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const loop = new THREE.LineLoop(geo, mat);
    loop.renderOrder = 48;
    root.add(loop);
    physicsLines.push(loop);
  }

  /**
   * @param {number} planeZ
   * @param {number} cx
   * @param {number} cy
   * @param {number} half
   */
  function addStrokePlane(planeZ, cx, cy, half) {
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: PLANE_TINT,
      transparent: true,
      opacity: 0.12,
      wireframe: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, planeZ);
    mesh.renderOrder = 1;
    root.add(mesh);
    markers.push(mesh);
    return mesh;
  }

  /**
   * @param {{ x: number, y: number }[]} points
   * @param {number} planeZ
   */
  function addStrokeDots(points, planeZ) {
    for (const p of points) {
      addMarker(p.x, p.y, planeZ, ORANGE, 0.08);
    }
  }

  function addCoordLine(x, y, z) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([x, 0.01, z, x, y, z], 3),
    );
    const mat = new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    root.add(line);
    coordLines.push(line);
  }

  /**
   * @param {{
   *   camera: THREE.Camera,
   *   viewport: { width: number, height: number },
   *   heroBody: import('@dimforge/rapier3d-compat').RigidBody | null,
   *   worldObjects: import('../objects/world-objects.js').WorldObject[],
   *   showPhysics: boolean,
   *   showCoords: boolean,
   *   showInkBounds?: boolean,
   *   showStrokePlane?: boolean,
   *   showBodyAxes?: boolean,
   *   showAnchors?: boolean,
   *   showStrokePoints?: boolean,
   *   activeStrokePlaneZ?: number | null,
   *   isPainting?: boolean,
   *   previewStrokePoints?: { x: number, y: number }[],
   * }} ctx
   */
  function update(ctx) {
    clearPhysics();
    clearCoords();
    clearExtra();

    if (ctx.showStrokePlane) {
      const half = 28;
      if (ctx.isPainting && ctx.activeStrokePlaneZ != null) {
        let cx = 28;
        let cy = 8;
        if (ctx.heroBody) {
          const ht = ctx.heroBody.translation();
          cx = ht.x;
          cy = ht.y;
        }
        liveStrokePlane = addStrokePlane(ctx.activeStrokePlaneZ, cx, cy, half);
        if (ctx.previewStrokePoints?.length) {
          addStrokeDots(ctx.previewStrokePoints, ctx.activeStrokePlaneZ);
        }
      }
      for (const o of ctx.worldObjects) {
        if (o.planeZ != null) {
          const body = o.rigidBody;
          const cx = body ? body.translation().x : 28;
          const cy = body ? body.translation().y : 8;
          addStrokePlane(o.planeZ, cx, cy, half);
        }
      }
    }

    if (ctx.showPhysics && ctx.heroBody) {
      const t = ctx.heroBody.translation();
      const capGeo = new THREE.CapsuleGeometry(HERO_RADIUS, HERO_HALF_HEIGHT * 2, 6, 10);
      const capMat = new THREE.MeshBasicMaterial({
        color: CYAN,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      });
      heroCapsule = new THREE.Mesh(capGeo, capMat);
      heroCapsule.position.set(t.x, t.y, t.z);
      heroCapsule.rotation.set(0, 0, 0);
      root.add(heroCapsule);

      for (const o of ctx.worldObjects) {
        const body = o.rigidBody;
        if (!body) continue;
        for (let i = 0; i < body.numColliders(); i++) {
          addColliderOutline(body.collider(i), GREEN);
        }
      }
    }

    for (const o of ctx.worldObjects) {
      const body = o.rigidBody;
      if (!body) continue;
      if (ctx.showInkBounds) addInkBounds(o);
      if (ctx.showBodyAxes) {
        const t = body.translation();
        addAxes(t.x, t.y, t.z);
      }
      if (ctx.showAnchors && o.position) {
        addMarker(o.position.x, o.position.y, o.planeZ ?? 0, WHITE, 0.14);
        const t = body.translation();
        addMarker(t.x, t.y, t.z, YELLOW, 0.12);
        for (let i = 0; i < body.numColliders(); i++) {
          const col = body.collider(i);
          const by = colliderWorldMinY(col);
          const bx = body.translation().x;
          const bz = body.translation().z;
          addMarker(bx, by, bz, BOTTOM_CYAN, 0.1);
        }
      }
      if (ctx.showStrokePoints && o.spawnPoints?.length && o.planeZ != null) {
        addStrokeDots(o.spawnPoints, o.planeZ);
      }
    }

    if (ctx.showBodyAxes && ctx.heroBody) {
      const t = ctx.heroBody.translation();
      addAxes(t.x, t.y, t.z, 0.55);
    }

    if (ctx.showCoords) {
      if (ctx.heroBody) {
        const t = ctx.heroBody.translation();
        addCoordLine(t.x, t.y, t.z);
        addLabel(t.x, t.y + 0.35, t.z, `hero X${t.x.toFixed(1)} Z${t.z.toFixed(1)} Y${t.y.toFixed(1)}`);
      }
      for (const o of ctx.worldObjects) {
        const body = o.rigidBody;
        if (!body) continue;
        const t = body.translation();
        addCoordLine(t.x, t.y, t.z);
        addLabel(t.x, t.y + 0.2, t.z, `X${t.x.toFixed(1)} Z${t.z.toFixed(1)} Y${t.y.toFixed(1)}`);
      }
    }

    labelRenderer.setSize(ctx.viewport.width, ctx.viewport.height);
    labelRenderer.render(scene, ctx.camera);
  }

  function dispose() {
    clearPhysics();
    clearCoords();
    clearExtra();
    scene.remove(root);
    labelRenderer.domElement.remove();
  }

  return { update, dispose, labelRenderer };
}
