import {
  initPhysicsWorld,
  createArenaFloor,
  createMapStaticBox,
  createMapPropCylinder,
} from './physics/rapier-world.js';

/** @param {number} worldW @param {number} worldH @param {{ minX: number, minY: number, maxX: number, maxY: number }} inner */
function buildArenaPhysics(worldW, worldH, inner) {
  createArenaFloor(worldW, worldH);
  const wallT = 56;
  const wallH = 48;
  const yMid = (inner.minY + inner.maxY) * 0.5;
  createMapStaticBox(
    worldW * 0.5,
    wallH * 0.5,
    inner.minY - wallT * 0.5,
    worldW * 0.5 + wallT * 2,
    wallH * 0.5,
    wallT * 0.5,
  );
  createMapStaticBox(
    worldW * 0.5,
    wallH * 0.5,
    inner.maxY + wallT * 0.5,
    worldW * 0.5 + wallT * 2,
    wallH * 0.5,
    wallT * 0.5,
  );
  createMapStaticBox(
    inner.minX - wallT * 0.5,
    wallH * 0.5,
    yMid,
    wallT * 0.5,
    wallH * 0.5,
    worldH * 0.5,
  );
  createMapStaticBox(
    inner.maxX + wallT * 0.5,
    wallH * 0.5,
    yMid,
    wallT * 0.5,
    wallH * 0.5,
    worldH * 0.5,
  );
}

export async function createLevel() {
  const worldW = 3000;
  const worldH = 2400;
  const margin = 72;
  const inner = {
    minX: margin,
    minY: margin,
    maxX: worldW - margin,
    maxY: worldH - margin,
  };

  await initPhysicsWorld();
  buildArenaPhysics(worldW, worldH, inner);

  const propSeeds = [
    [420, 520],
    [720, 380],
    [1180, 620],
    [1500, 340],
    [1900, 900],
    [2200, 480],
    [2600, 720],
    [980, 1180],
    [1400, 1500],
    [2100, 1400],
    [520, 1700],
    [1750, 1900],
    [2450, 1650],
    [1100, 2000],
    [600, 900],
    [2300, 1180],
  ];

  const props = propSeeds.map(([px, pz], i) => {
    const r = 22 + (i % 4) * 4;
    return {
      x: px,
      z: pz,
      r,
      halfH: 20,
    };
  });

  for (const p of props) {
    createMapPropCylinder(p.x, p.halfH, p.z, p.r, p.halfH);
  }

  const spawn = {
    x: (inner.minX + inner.maxX) * 0.5,
    y: (inner.minY + inner.maxY) * 0.5,
  };

  return {
    worldW,
    worldH,
    inner,
    strokePlaneY: spawn.y + 140,
    spawn,
    bounds: { minX: 0, minY: 0, maxX: worldW, maxY: worldH },
    props,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Awaited<ReturnType<typeof createLevel>>} level
 * @param {ReturnType<import('./camera.js').createCamera>} camera
 */
export function drawWorldTurf(ctx, level, camera) {
  const { view } = camera;
  const vw = view.width;
  const vh = view.height;

  const tile = 48;
  const gx0 = Math.floor(camera.x / tile) * tile - tile;
  const gy0 = Math.floor(camera.y / tile) * tile - tile;
  const gx1 = camera.x + vw + tile * 2;
  const gy1 = camera.y + vh + tile * 2;

  for (let x = gx0; x < gx1; x += tile) {
    for (let y = gy0; y < gy1; y += tile) {
      const ix = ((x / tile) | 0) % 2;
      const iy = ((y / tile) | 0) % 2;
      const t = (ix + iy) % 2;
      ctx.fillStyle = t ? '#7daf6e' : '#72a366';
      ctx.fillRect(x, y, tile + 0.5, tile + 0.5);
    }
  }

  ctx.strokeStyle = 'rgba(45, 90, 48, 0.12)';
  ctx.lineWidth = 1;
  for (let x = gx0; x < gx1; x += tile * 3) {
    ctx.beginPath();
    ctx.moveTo(x, gy0);
    ctx.lineTo(x, gy1);
    ctx.stroke();
  }
  for (let y = gy0; y < gy1; y += tile * 3) {
    ctx.beginPath();
    ctx.moveTo(gx0, y);
    ctx.lineTo(gx1, y);
    ctx.stroke();
  }

  const inset = 0;
  ctx.strokeStyle = 'rgba(34, 60, 40, 0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(
    level.inner.minX + inset,
    level.inner.minY + inset,
    level.inner.maxX - level.inner.minX - inset * 2,
    level.inner.maxY - level.inner.minY - inset * 2,
  );
}

/** @param {CanvasRenderingContext2D} ctx */
export function drawArenaStatic(ctx) {
  void ctx;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import('./camera.js').createCamera>} camera
 */
export function drawBackgroundVignette(ctx, camera) {
  const { view } = camera;
  const vw = view.width;
  const vh = view.height;
  const vg = ctx.createRadialGradient(
    vw * 0.5,
    vh * 0.5,
    Math.min(vw, vh) * 0.25,
    vw * 0.5,
    vh * 0.5,
    Math.max(vw, vh) * 0.72,
  );
  vg.addColorStop(0, 'rgba(15, 40, 22, 0)');
  vg.addColorStop(1, 'rgba(12, 28, 18, 0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, vw, vh);
}
