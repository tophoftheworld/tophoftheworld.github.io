/**
 * Doodle Verse 3D coords — Rapier (x, y, z), Y up, stroke on XY plane at plane Z.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const _v = new THREE.Vector3();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {THREE.Camera} camera
 * @param {{ width: number, height: number }} viewport
 */
export function worldToScreen(x, y, z, camera, viewport) {
  _v.set(x, y, z).project(camera);
  return {
    x: (_v.x * 0.5 + 0.5) * viewport.width,
    y: (-_v.y * 0.5 + 0.5) * viewport.height,
  };
}

/**
 * @param {{ width: number, height: number }} viewport
 * @param {THREE.OrthographicCamera} camera
 */
export function pixelsPerWorldUnit(viewport, camera) {
  return viewport.height / (camera.top - camera.bottom);
}

/**
 * Raycast NDC → world (x, y) on vertical plane z = planeZ.
 * @param {THREE.Raycaster} raycaster
 * @param {THREE.Vector2} ndc
 * @param {number} planeZ
 */
export function raycastToStrokePlane(raycaster, ndc, planeZ) {
  _plane.setComponents(0, 0, 1, -planeZ);
  raycaster.setFromCamera(ndc, raycaster.camera);
  if (!raycaster.ray.intersectPlane(_plane, _hit)) return null;
  return { x: _hit.x, y: _hit.y };
}

/**
 * @param {{ x: number, y: number }[]} strokeXY
 */
export function strokeBottomWorldY(strokeXY) {
  let minY = Infinity;
  for (const p of strokeXY) {
    minY = Math.min(minY, p.y);
  }
  return minY;
}

/**
 * @param {{ x: number, y: number }[]} strokeXY
 */
export function strokeGroundAnchor(strokeXY) {
  const bottomY = strokeBottomWorldY(strokeXY);
  let best = strokeXY[0];
  let bestDist = Infinity;
  for (const p of strokeXY) {
    const d = Math.abs(p.y - bottomY);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return { anchorX: best.x, bottomY };
}

/**
 * Lowest stroke point on screen (max screen Y = toward bottom of viewport).
 * @param {{ x: number, y: number }[]} strokeXY
 * @param {number} planeZ
 */
export function strokeBottomScreenY(strokeXY, planeZ, camera, viewport) {
  let maxSy = -Infinity;
  for (const p of strokeXY) {
    const s = worldToScreen(p.x, p.y, planeZ, camera, viewport);
    maxSy = Math.max(maxSy, s.y);
  }
  return maxSy;
}

/**
 * @param {{ x: number, y: number }[]} strokeXY
 * @param {number} brush
 * @param {THREE.Camera} camera
 * @param {{ width: number, height: number }} viewport
 * @param {number} planeZ depth while painting
 * @param {{ x: number, y: number, z: number }} playerPos
 * @param {number} playerFootScreenY
 * @param {boolean} gravityOn
 */
export function computeStrokePlacement(
  strokeXY,
  brush,
  camera,
  viewport,
  planeZ,
  playerPos,
  playerFootScreenY,
  gravityOn,
) {
  void brush;
  const { anchorX, bottomY } = strokeGroundAnchor(strokeXY);
  const strokeBottomScreen = strokeBottomScreenY(strokeXY, planeZ, camera, viewport);
  const abovePlayer = strokeBottomScreen < playerFootScreenY - 0.5;

  let spawnLift = 0;
  let fallActive = false;
  let bodyZ = planeZ;

  if (gravityOn && abovePlayer) {
    bodyZ = playerPos.z;
    const ppu = pixelsPerWorldUnit(viewport, camera);
    spawnLift = Math.max(0.25, (playerFootScreenY - strokeBottomScreen) / ppu);
    fallActive = true;
  }

  return {
    worldPoints: strokeXY.map((p) => ({ x: p.x, y: p.y })),
    anchorX,
    planeZ: bodyZ,
    spawnLift,
    fallActive,
    bottomY,
  };
}

/**
 * @param {{ x: number, y: number, z: number }} t body translation
 * @param {number} angleZ rotation around world Z (rad)
 * @param {number} lx local X on sheet
 * @param {number} ly local Y on sheet
 */
export function strokeLocalToWorld(t, angleZ, lx, ly) {
  const cos = Math.cos(angleZ);
  const sin = Math.sin(angleZ);
  return {
    x: t.x + lx * cos - ly * sin,
    y: t.y + lx * sin + ly * cos,
    z: t.z,
  };
}

/**
 * @param {{ x: number, y: number, z: number, w: number }} q
 */
function quatRotatePoint(q, x, y, z) {
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

/** @param {import('@dimforge/rapier3d-compat').Collider} collider */
function colliderWorldOrigin(collider) {
  const body = collider.parent();
  const bt = body ? body.translation() : { x: 0, y: 0, z: 0 };
  const t = collider.translation();
  return { x: bt.x + t.x, y: bt.y + t.y, z: bt.z + t.z };
}

/** @param {import('@dimforge/rapier3d-compat').Collider} collider */
export function colliderWorldMinY(collider) {
  const o = colliderWorldOrigin(collider);
  const r = collider.rotation();
  const verts = collider.vertices();
  if (verts && verts.length >= 3) {
    let minY = Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const p = quatRotatePoint(r, verts[i], verts[i + 1], verts[i + 2]);
      minY = Math.min(minY, o.y + p.y);
    }
    return minY;
  }
  const he = collider.halfExtents();
  if (he) {
    const hx = he.x;
    const hy = he.y;
    const hz = he.z;
    const corners = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [-hx, hy, -hz],
      [hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [-hx, hy, hz],
      [hx, hy, hz],
    ];
    let minY = Infinity;
    for (const [lx, ly, lz] of corners) {
      const p = quatRotatePoint(r, lx, ly, lz);
      minY = Math.min(minY, o.y + p.y);
    }
    return minY;
  }
  return o.y;
}

/** @param {import('@dimforge/rapier3d-compat').Collider} collider */
export function colliderWorldBoundsXZ(collider) {
  const o = colliderWorldOrigin(collider);
  const r = collider.rotation();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const grow = (x, z) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };

  const verts = collider.vertices();
  if (verts && verts.length >= 3) {
    for (let i = 0; i < verts.length; i += 3) {
      const p = quatRotatePoint(r, verts[i], verts[i + 1], verts[i + 2]);
      grow(o.x + p.x, o.z + p.z);
    }
  } else {
    const he = collider.halfExtents();
    if (he) {
      grow(o.x - he.x, o.z - he.z);
      grow(o.x + he.x, o.z + he.z);
    } else {
      grow(o.x, o.z);
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: o.x, minZ: o.z, width: 0, height: 0 };
  }
  return { minX, minZ, width: maxX - minX, height: maxZ - minZ };
}

/**
 * @param {import('@dimforge/rapier3d-compat').Collider} collider
 * @returns {THREE.Vector3[]}
 */
export function colliderOutlineWorld(collider) {
  const o = colliderWorldOrigin(collider);
  const r = collider.rotation();
  const out = [];

  const verts = collider.vertices();
  if (verts && verts.length >= 3) {
    for (let i = 0; i < verts.length; i += 3) {
      const p = quatRotatePoint(r, verts[i], verts[i + 1], verts[i + 2]);
      out.push(new THREE.Vector3(o.x + p.x, o.y + p.y, o.z + p.z));
    }
    return out;
  }

  const he = collider.halfExtents();
  if (he) {
    const hx = he.x;
    const hy = he.y;
    const hz = he.z;
    const corners = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [-hx, hy, -hz],
      [hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [-hx, hy, hz],
      [hx, hy, hz],
    ];
    for (const [lx, ly, lz] of corners) {
      const p = quatRotatePoint(r, lx, ly, lz);
      out.push(new THREE.Vector3(o.x + p.x, o.y + p.y, o.z + p.z));
    }
    return out;
  }

  out.push(new THREE.Vector3(o.x, o.y, o.z));
  return out;
}

/** @param {import('@dimforge/rapier3d-compat').RigidBody} body */
export function rigidBodyBottomY(body) {
  let minY = Infinity;
  for (let i = 0; i < body.numColliders(); i++) {
    minY = Math.min(minY, colliderWorldMinY(body.collider(i)));
  }
  const t = body.translation();
  return Number.isFinite(minY) ? minY : t.y;
}

/** @param {import('@dimforge/rapier3d-compat').RigidBody} body */
export function snapRigidBodyBottomToY0(body) {
  const t = body.translation();
  const rawBottom = rigidBodyBottomY(body);
  let bottom = rawBottom;
  const usedBodyAnchor =
    body.userData?.kind === 'doodle' && Math.abs(bottom - t.y) > 1.5;
  if (usedBodyAnchor) {
    bottom = t.y;
  }
  const dy = -bottom;
  if (Math.abs(dy) > 0.0005) {
    body.setTranslation({ x: t.x, y: t.y + dy, z: t.z }, true);
    return dy;
  }
  return 0;
}

function yExtentAtAngle(points, angle) {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const ly = p.x * sin + p.y * cos;
    minY = Math.min(minY, ly);
    maxY = Math.max(maxY, ly);
  }
  return maxY - minY;
}

/** @param {{ x: number, y: number }[]} worldPoints */
export function computePlanarRestAngle(worldPoints) {
  if (worldPoints.length < 2) return 0;
  const first = worldPoints[0];
  const last = worldPoints[worldPoints.length - 1];
  const axis = Math.atan2(last.y - first.y, last.x - first.x);
  let best = axis;
  let bestSpan = Infinity;
  for (let k = 0; k < 4; k++) {
    const a = axis + (k * Math.PI) / 2;
    const span = yExtentAtAngle(worldPoints, a);
    if (span < bestSpan) {
      bestSpan = span;
      best = a;
    }
  }
  return best;
}
