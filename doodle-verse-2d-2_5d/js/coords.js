/**
 * Plane-mode 2.5D — Rapier (x,y,z) is world space; canvas is orthographic projection.
 * @see ../COORDINATES.md
 */

/**
 * World (x,y,z) → map plane coords used before camera pan/zoom.
 * screenX ∝ x, screenY ∝ z − y (Y lifts up on screen).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function worldToCanvas(x, y, z) {
  return { x, y: z - y };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ x: number, y: number }} camera
 * @param {number} viewZoom
 */
export function worldToScreen(x, y, z, camera, viewZoom) {
  const c = worldToCanvas(x, y, z);
  return {
    x: (c.x - camera.x) * viewZoom,
    y: (c.y - camera.y) * viewZoom,
  };
}

/**
 * Depth sort key (larger = drawn later / in front on map).
 * @param {number} y
 * @param {number} z
 */
export function worldSortKey(y, z) {
  return z - y * 0.35;
}

/**
 * Stroke-local (lx, ly) in body frame → world (X-rotation only).
 * @param {{ x: number, y: number, z: number }} t body translation
 * @param {number} angle rotation around world X (rad)
 * @param {number} lx
 * @param {number} ly
 */
export function strokeLocalToWorld(t, angle, lx, ly) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: t.x + lx,
    y: t.y + ly * cos,
    z: t.z + ly * sin,
  };
}

/**
 * Pointer on canvas → world (x, y) on vertical plane at fixed Z.
 * @param {{ x: number, y: number }} canvasPos
 * @param {{ x: number, y: number }} camera
 * @param {number} viewZoom
 * @param {number} planeZ
 */
export function canvasToWorldOnPlane(canvasPos, camera, viewZoom, planeZ) {
  const mapY = camera.y + canvasPos.y / viewZoom;
  const y = planeZ - mapY;
  const x = camera.x + canvasPos.x / viewZoom;
  return { x, y };
}

/** @deprecated Use canvasToWorldOnPlane */
export function canvasToStrokePlaneXY(canvasPos, camera, viewZoom, planeZ) {
  return canvasToWorldOnPlane(canvasPos, camera, viewZoom, planeZ);
}

/**
 * @param {{ x: number, y: number }} canvasPos
 * @param {{ x: number, y: number }} camera
 * @param {number} viewZoom
 */
export function canvasToWorldGround(canvasPos, camera, viewZoom) {
  const x = camera.x + canvasPos.x / viewZoom;
  const z = camera.y + canvasPos.y / viewZoom;
  return { x, z };
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
 * @param {{ x: number, y: number }[]} strokeXY
 * @param {number} planeZ
 * @param {{ x: number, y: number }} camera
 * @param {number} viewZoom
 */
export function strokeBottomScreenY(strokeXY, planeZ, camera, viewZoom) {
  const bottomY = strokeBottomWorldY(strokeXY);
  const foot = worldToScreen(0, 0, planeZ, camera, viewZoom);
  return foot.y - bottomY * viewZoom;
}

/**
 * @param {{ x: number, y: number }[]} strokeXY
 * @param {number} brush
 * @param {{ x: number, y: number }} camera
 * @param {number} viewZoom
 * @param {number} planeZ depth slice while painting
 * @param {{ x: number, y: number, z: number }} playerPos hero body translation
 * @param {number} playerFootScreenY
 * @param {boolean} gravityOn
 */
export function computeStrokePlacement(
  strokeXY,
  brush,
  camera,
  viewZoom,
  planeZ,
  playerPos,
  playerFootScreenY,
  gravityOn,
) {
  void brush;
  const { anchorX, bottomY } = strokeGroundAnchor(strokeXY);
  const strokeBottomScreen = strokeBottomScreenY(strokeXY, planeZ, camera, viewZoom);
  const abovePlayer = strokeBottomScreen < playerFootScreenY - 0.5;

  /** Extra Y above stroke bottom (world units), not absolute body Y. */
  let spawnLift = 0;
  let fallActive = false;
  let bodyZ = planeZ;

  if (gravityOn && abovePlayer) {
    bodyZ = playerPos.z;
    spawnLift = Math.max(12, (playerFootScreenY - strokeBottomScreen) / viewZoom);
    fallActive = true;
  }

  return {
    worldPoints: strokeXY.map((p) => ({ x: p.x, y: p.y })),
    anchorX,
    planeZ: bodyZ,
    spawnLift,
    spawnY: spawnLift,
    fallActive,
    bottomY,
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
export function colliderWorldMinY(collider) {
  const t = collider.translation();
  const r = collider.rotation();
  const verts = collider.vertices();
  if (verts && verts.length >= 3) {
    let minY = Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const p = quatRotatePoint(r, verts[i], verts[i + 1], verts[i + 2]);
      minY = Math.min(minY, t.y + p.y);
    }
    return minY;
  }
  const rad = collider.radius();
  if (Number.isFinite(rad) && rad > 0) {
    return t.y - rad;
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
      minY = Math.min(minY, t.y + p.y);
    }
    return minY;
  }
  return t.y;
}

/** @param {import('@dimforge/rapier3d-compat').Collider} collider */
export function colliderWorldBoundsXZ(collider) {
  const t = collider.translation();
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
      grow(t.x + p.x, t.z + p.z);
    }
  } else {
    const rad = collider.radius();
    if (Number.isFinite(rad) && rad > 0) {
      grow(t.x - rad, t.z - rad);
      grow(t.x + rad, t.z + rad);
    } else {
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
          grow(t.x + p.x, t.z + p.z);
        }
      } else {
        grow(t.x, t.z);
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: t.x, minZ: t.z, width: 0, height: 0 };
  }
  return { minX, minZ, width: maxX - minX, height: maxZ - minZ };
}

/**
 * Collider vertices projected to map/canvas plane (orthographic).
 * @param {import('@dimforge/rapier3d-compat').Collider} collider
 * @returns {{ x: number, y: number }[]}
 */
export function colliderOutlineCanvas(collider) {
  const t = collider.translation();
  const r = collider.rotation();
  const out = [];

  const pushWorld = (wx, wy, wz) => {
    const c = worldToCanvas(wx, wy, wz);
    out.push(c);
  };

  const verts = collider.vertices();
  if (verts && verts.length >= 3) {
    for (let i = 0; i < verts.length; i += 3) {
      const p = quatRotatePoint(r, verts[i], verts[i + 1], verts[i + 2]);
      pushWorld(t.x + p.x, t.y + p.y, t.z + p.z);
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
      pushWorld(t.x + p.x, t.y + p.y, t.z + p.z);
    }
    return out;
  }

  const rad = collider.radius();
  if (Number.isFinite(rad) && rad > 0) {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pushWorld(t.x + Math.cos(a) * rad, t.y, t.z + Math.sin(a) * rad);
    }
    return out;
  }

  pushWorld(t.x, t.y, t.z);
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
  const bottom = rigidBodyBottomY(body);
  const dy = -bottom;
  if (Math.abs(dy) > 0.0005) {
    const t = body.translation();
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
