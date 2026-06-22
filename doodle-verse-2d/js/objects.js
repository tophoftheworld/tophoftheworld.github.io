import { applyWorldObjectPhysics } from './physics-toggles.js';

export const LOCAL_PLAYER_ID = 'local';

/**
 * @typedef {Object} WorldObjectFlags
 * @property {boolean} gravity
 * @property {boolean} collision
 */

/**
 * @typedef {Object} WorldObject
 * @property {string} id
 * @property {string} ownerPlayerId
 * @property {string} createdAt
 * @property {{ x: number, y: number }} position
 * @property {{ points: { x: number, y: number }[], brush: number }} stroke
 * @property {{ width: number, height: number } | null} render
 * @property {WorldObjectFlags} flags
 * @property {import('matter-js').IComposite} composite
 * @property {HTMLCanvasElement | null} strokeCanvas
 * @property {import('matter-js').IBody | null} [visualAnchorBody]
 * @property {{ x: number, y: number } | null} [rasterOffsetLocal]
 */

function newId() {
  return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {WorldObject} obj */
export function serializeWorldObject(obj) {
  return {
    id: obj.id,
    ownerPlayerId: obj.ownerPlayerId,
    createdAt: obj.createdAt,
    position: { ...obj.position },
    stroke: {
      brush: obj.stroke.brush,
      points: obj.stroke.points.map((p) => ({ ...p })),
    },
    render: obj.render ? { ...obj.render } : null,
    flags: { ...obj.flags },
  };
}

export function serializeState(worldObjects, playerBody) {
  return {
    version: 1,
    localPlayerId: LOCAL_PLAYER_ID,
    player: {
      x: playerBody.position.x,
      y: playerBody.position.y,
      angle: playerBody.angle,
    },
    objects: worldObjects.map(serializeWorldObject),
  };
}

/**
 * @param {WorldObject[]} worldObjects
 * @param {any} payload
 * @param {import('matter-js')} Matter
 * @param {import('matter-js').IEngine} engine
 * @returns {WorldObject | null}
 */
export function applyRemoteObjectUpsert(worldObjects, payload, Matter, engine) {
  void worldObjects;
  void payload;
  void Matter;
  void engine;
  return null;
}

/**
 * @param {import('matter-js')} Matter
 * @param {import('matter-js').IEngine} engine
 * @param {{
 *   composite: import('matter-js').IComposite,
 *   strokeCanvas: HTMLCanvasElement,
 *   render: { width: number, height: number },
 *   worldPoints: { x: number, y: number }[],
 *   brush: number,
 *   initialFlags?: Partial<WorldObjectFlags>,
 * }} d
 */
export function registerDrawnObject(Matter, engine, d) {
  const pts = d.worldPoints;
  if (pts.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = d.brush;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const rel = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));

  /** @type {WorldObject} */
  const obj = {
    id: newId(),
    ownerPlayerId: LOCAL_PLAYER_ID,
    createdAt: new Date().toISOString(),
    position: { x: minX, y: minY },
    stroke: { points: rel, brush: d.brush },
    render: { ...d.render },
    flags: {
      gravity: d.initialFlags?.gravity ?? true,
      collision: d.initialFlags?.collision ?? true,
    },
    composite: d.composite,
    strokeCanvas: d.strokeCanvas,
    visualAnchorBody: null,
    rasterOffsetLocal: null,
  };

  Matter.Composite.add(engine.world, obj.composite);
  applyWorldObjectPhysics(Matter, obj);
  for (const b of Matter.Composite.allBodies(obj.composite)) {
    b.plugin = b.plugin || {};
    b.plugin.worldObjectId = obj.id;
  }

  const bodies = Matter.Composite.allBodies(obj.composite);
  const anchorBody =
    bodies.find((b) => b.label === 'doodlePart') ?? bodies[0] ?? null;
  if (anchorBody) {
    const { Vector } = Matter;
    const worldAnchor = { x: minX, y: minY };
    const dr = Vector.sub(worldAnchor, anchorBody.position);
    obj.visualAnchorBody = anchorBody;
    obj.rasterOffsetLocal = Vector.rotate(dr, -anchorBody.angle);
  }

  Matter.Composite.setModified(engine.world, true, true, false);
  return obj;
}

/**
 * @param {import('matter-js')} Matter
 * @param {import('matter-js').IEngine} engine
 * @param {WorldObject} obj
 */
export function removeWorldObject(Matter, engine, obj) {
  Matter.Composite.remove(engine.world, obj.composite);
  obj.strokeCanvas = null;
}

function distSqPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) {
    const qx = px - x1;
    const qy = py - y1;
    return qx * qx + qy * qy;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = px - (x1 + t * dx);
  const qy = py - (y1 + t * dy);
  return qx * qx + qy * qy;
}

/**
 * World position of raster top-left (canvas 0,0) following physics body.
 * @param {WorldObject} o
 * @param {import('matter-js')} Matter
 */
export function getStrokeRasterCornerWorld(o, Matter) {
  const { Vector } = Matter;
  const body = o.visualAnchorBody;
  if (!body || !o.rasterOffsetLocal) {
    return { x: o.position.x, y: o.position.y };
  }
  return Vector.add(body.position, Vector.rotate(o.rasterOffsetLocal, body.angle));
}

/**
 * World position of a point in stroke canvas space (relative to spawn raster top-left).
 * @param {WorldObject} o
 * @param {import('matter-js')} Matter
 * @param {number} relX
 * @param {number} relY
 */
export function strokePointToWorld(o, Matter, relX, relY) {
  const { Vector } = Matter;
  const body = o.visualAnchorBody;
  if (!body || !o.rasterOffsetLocal) {
    return { x: o.position.x + relX, y: o.position.y + relY };
  }
  const local = {
    x: o.rasterOffsetLocal.x + relX,
    y: o.rasterOffsetLocal.y + relY,
  };
  return Vector.add(body.position, Vector.rotate(local, body.angle));
}

/**
 * Prefer stroke polyline hit (reliable for thin physics); fall back to Matter.Query.point.
 * @param {WorldObject[]} list
 * @param {import('matter-js')} Matter
 * @param {number} wx
 * @param {number} wy
 */
export function pickWorldObjectAt(list, Matter, wx, wy) {
  const extraTol = 14;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    const pts = o.stroke.points;
    if (pts.length < 2) continue;
    const half = o.stroke.brush * 0.5 + extraTol;
    const r2 = half * half;
    for (let j = 0; j < pts.length - 1; j++) {
      const p1 = strokePointToWorld(o, Matter, pts[j].x, pts[j].y);
      const p2 = strokePointToWorld(o, Matter, pts[j + 1].x, pts[j + 1].y);
      if (distSqPointToSegment(wx, wy, p1.x, p1.y, p2.x, p2.y) <= r2) {
        return o;
      }
    }
  }

  const bodies = [];
  for (const o of list) {
    bodies.push(...Matter.Composite.allBodies(o.composite));
  }
  const hits = Matter.Query.point(bodies, { x: wx, y: wy });
  if (!hits.length) return null;
  const id = hits[0].plugin?.worldObjectId;
  if (!id) return null;
  return list.find((o) => o.id === id) ?? null;
}
