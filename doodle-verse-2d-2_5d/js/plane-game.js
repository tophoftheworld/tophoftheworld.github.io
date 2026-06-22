import { createCamera } from './camera.js';
import { createLevel, drawWorldTurf, drawArenaStatic, drawBackgroundVignette } from './world.js';
import { mountAvatarStudio } from './avatar-studio.js';
import { cropAvatarLayers, getDollAttachmentPoints, AVATAR_H, DOLL_PIXEL_RECTS } from './avatar-doll.js';
import { rasterizeStroke } from './draw-spawn.js';
import { registerDrawnObject, landDoodleObject, refreshInkLocal } from './objects.js';
import {
  stepDoodlePhysics,
  bindDoodleHeroCollisions,
  isDoodleAirborne,
  processPhysicsCollisions,
} from './doodle-physics.js';
import {
  canvasToWorldOnPlane,
  worldToCanvas,
  worldToScreen,
  worldSortKey,
  strokeLocalToWorld,
  computeStrokePlacement,
  colliderOutlineCanvas,
  colliderWorldBoundsXZ,
} from './coords.js';
import {
  createHeroBody,
  stepPhysics,
  rotationX,
} from './physics/rapier-world.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

function syncCanvasSize() {
  const w = Math.max(320, window.innerWidth | 0);
  const h = Math.max(240, window.innerHeight | 0);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
syncCanvasSize();
window.addEventListener('resize', syncCanvasSize);

/** World-to-screen scale (larger = more zoomed in). */
const VIEW_ZOOM = 3;

const HERO_R = 16;

/** Cancel prior plane session if `startPlaneGame` runs again (e.g. dev hot reload). */
let teardownPlaneGame = /** @type {null | (() => void)} */ (null);

const STROKE_MIN_LENGTH_WORLD = 10;
const PAINT_DRAG_THRESHOLD_PX = 8;

/**
 * @param {HTMLCanvasElement} c
 * @param {PointerEvent} e
 */
function canvasCoordsFromPointer(c, e) {
  const rect = c.getBoundingClientRect();
  const scaleX = c.width / Math.max(1, rect.width);
  const scaleY = c.height / Math.max(1, rect.height);
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

/** Upward launch speed (Rapier dynamic hero ~30+ kg — impulse was too weak). */
const JUMP_VY = 22;

/**
 * @param {{ x: number, y: number }[]} pts
 */
function worldPolylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    s += Math.sqrt(dx * dx + dy * dy);
  }
  return s;
}

/**
 * Fraction of sprite height from top through the last row with visible ink (0..1].
 * Positions the sprite so its bottom-most opaque pixels sit on the shadow center.
 * @param {HTMLCanvasElement} sprite
 */
function measureFootAnchorFraction(sprite) {
  const h = sprite.height;
  const w = sprite.width;
  const g = sprite.getContext('2d');
  if (!g || h < 2 || w < 2) return 1;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  let maxY = -1;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 14) {
        maxY = y;
        break;
      }
    }
    if (maxY >= 0) break;
  }
  if (maxY < 0) return 1;
  return (maxY + 1) / h;
}

/** Lowest local Y of procedural feet (thighs vertical, max swing). */
const PROCEDURAL_FEET_LOCAL_Y = 6;

/** Foot ellipse shadow: 20% smaller than 18×7, alpha 30% lower than 0.28. */
const HERO_GROUND_SHADOW_RX = 18 * 0.8;
const HERO_GROUND_SHADOW_RY = 7 * 0.8;
const HERO_GROUND_SHADOW_ALPHA = 0.28 * 0.7;
const HERO_GROUND_SHADOW_FILL = `rgba(25, 35, 30, ${HERO_GROUND_SHADOW_ALPHA})`;
/** Foot height at jump apex for opacity falloff. */
const HERO_JUMP_SHADOW_REF = 26;

/**
 * Hero foot shadow — fixed size; opacity only (solid on ground, softer in air).
 * @param {number} jumpLift foot height above floor (≥ 0)
 */
function drawHeroGroundShadowEllipse(jumpLift) {
  const t = Math.min(1, Math.max(0, jumpLift / HERO_JUMP_SHADOW_REF));
  const a = HERO_GROUND_SHADOW_ALPHA * (1 - t * 0.48);
  ctx.fillStyle = `rgba(25, 35, 30, ${a})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, HERO_GROUND_SHADOW_RX, HERO_GROUND_SHADOW_RY, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * @param {HTMLCanvasElement} heroAvatarSprite
 */
async function startPlaneGame(heroAvatarSprite) {
  const heroFootFrac = measureFootAnchorFraction(heroAvatarSprite);
  /** Full stride / HUD “walk” — run (Shift) is faster on top of this. */
  const GROUND_WALK_SPEED = 96;
  const GROUND_RUN_SPEED = 192;
  /** Leg cycles per second at WASD walk (−25% vs 1.2 Hz base). */
  const WALK_ANIM_SLOW = 0.75;
  const WALK_STRIDES_PER_SEC = 2.4 * 1.2 * WALK_ANIM_SLOW;
  const WALK_PHASE_OMEGA = WALK_STRIDES_PER_SEC * Math.PI * 2;

  const heroLayers = cropAvatarLayers(heroAvatarSprite);
  const dollAttach = getDollAttachmentPoints();
  const useAvatarPuppet = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'].every(
    (k) => heroLayers[k] && heroLayers[k].width >= 4 && heroLayers[k].height >= 4,
  );

  const level = await createLevel();

  const heroBody = createHeroBody(level.spawn.x, level.spawn.y, HERO_R);

  const camera = createCamera({
    width: canvas.width / VIEW_ZOOM,
    height: canvas.height / VIEW_ZOOM,
  });

  teardownPlaneGame?.();

  document.getElementById('hud')?.classList.remove('hidden');

  const nextTogGravity = /** @type {HTMLInputElement | null} */ (
    document.getElementById('next-tog-gravity')
  );
  const nextTogCollision = /** @type {HTMLInputElement | null} */ (
    document.getElementById('next-tog-collision')
  );

  function syncGravityCollisionHud() {
    if (!nextTogGravity || !nextTogCollision) return;
    if (nextTogGravity.checked) {
      nextTogCollision.checked = true;
      nextTogCollision.disabled = true;
    } else {
      nextTogCollision.disabled = false;
    }
  }
  nextTogGravity.addEventListener('change', syncGravityCollisionHud);
  syncGravityCollisionHud();

  /** @type {import('./objects.js').WorldObject[]} */
  const worldObjects = [];

  const unbindHeroCollisions = bindDoodleHeroCollisions();

  let strokeDragging = false;
  /** Depth slice (world Z) for the active stroke — follows hero while painting. */
  let strokePlaneZ = heroBody.translation().z;
  /** @type {{ x: number, y: number }[]} */
  let currentStroke = [];
  /** @type {number | null} */
  let paintPointerId = null;
  let downScreenX = 0;
  let downScreenY = 0;
  let downWorldX = 0;
  let downWorldY = 0;

  function getPlaneBrush() {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById('next-brush'));
    const v = el ? Number(el.value) : 14;
    return Number.isFinite(v) ? Math.max(6, Math.min(28, v)) : 14;
  }

  function strokeFromPointer(e) {
    const cc = canvasCoordsFromPointer(canvas, e);
    return canvasToWorldOnPlane(cc, camera, VIEW_ZOOM, strokePlaneZ);
  }

  function appendWorldStrokePoint(w) {
    if (!currentStroke.length) {
      currentStroke.push({ x: w.x, y: w.y });
      return;
    }
    const last = currentStroke[currentStroke.length - 1];
    const dx = w.x - last.x;
    const dy = w.y - last.y;
    if (dx * dx + dy * dy > 4) currentStroke.push({ x: w.x, y: w.y });
  }

  function finishWorldStroke() {
    if (currentStroke.length < 2) {
      currentStroke = [];
      return;
    }
    const brush = getPlaneBrush();
    const gravEl = /** @type {HTMLInputElement | null} */ (document.getElementById('next-tog-gravity'));
    const colEl = /** @type {HTMLInputElement | null} */ (document.getElementById('next-tog-collision'));
    const gravityOn = gravEl ? gravEl.checked : true;
    const ht = heroBody.translation();
    const footScreen = worldToScreen(ht.x, ht.y - HERO_R, ht.z, camera, VIEW_ZOOM);
    const placement = computeStrokePlacement(
      currentStroke,
      brush,
      camera,
      VIEW_ZOOM,
      strokePlaneZ,
      ht,
      footScreen.y,
      gravityOn,
    );
    const placed = placement.worldPoints;
    const raster = rasterizeStroke(placed, brush);
    const obj = registerDrawnObject({
      strokeCanvas: raster.canvas,
      render: { width: raster.width, height: raster.height },
      worldPoints: placed.slice(),
      brush,
      initialFlags: {
        gravity: gravityOn,
        collision: gravityOn ? true : (colEl ? colEl.checked : true),
      },
      placement: {
        anchorX: placement.anchorX,
        planeZ: placement.planeZ,
        spawnLift: placement.spawnLift,
        spawnY: placement.spawnY,
        fallActive: placement.fallActive,
      },
    });
    if (obj) worldObjects.push(obj);
    currentStroke = [];
  }

  function onPaintPointerDown(e) {
    if (e.button !== 0) return;
    downScreenX = e.clientX;
    downScreenY = e.clientY;
    strokePlaneZ = heroBody.translation().z;
    const w = strokeFromPointer(e);
    downWorldX = w.x;
    downWorldY = w.y;
    strokeDragging = false;
    currentStroke = [];
    paintPointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPaintPointerMove(e) {
    if (paintPointerId == null || e.pointerId !== paintPointerId) return;
    if (!(e.buttons & 1)) return;

    if (!strokeDragging) {
      const dx = e.clientX - downScreenX;
      const dy = e.clientY - downScreenY;
      if (dx * dx + dy * dy < PAINT_DRAG_THRESHOLD_PX * PAINT_DRAG_THRESHOLD_PX) return;
      strokeDragging = true;
      currentStroke = [{ x: downWorldX, y: downWorldY }];
    }
    appendWorldStrokePoint(strokeFromPointer(e));
  }

  function onPaintPointerUp(e) {
    if (paintPointerId == null || e.pointerId !== paintPointerId) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (strokeDragging && currentStroke.length >= 2) {
      appendWorldStrokePoint(strokeFromPointer(e));
      if (worldPolylineLength(currentStroke) >= STROKE_MIN_LENGTH_WORLD) {
        finishWorldStroke();
      }
    }

    strokeDragging = false;
    currentStroke = [];
    paintPointerId = null;
  }

  function onPaintLostCapture() {
    strokeDragging = false;
    currentStroke = [];
    paintPointerId = null;
  }

  canvas.addEventListener('pointerdown', onPaintPointerDown);
  canvas.addEventListener('pointermove', onPaintPointerMove);
  canvas.addEventListener('pointerup', onPaintPointerUp);
  canvas.addEventListener('pointercancel', onPaintPointerUp);
  canvas.addEventListener('lostpointercapture', onPaintLostCapture);

  const keys = new Set();
  function trackKey(e, down) {
    const code = e.code;
    if (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
      if (down) keys.add(code);
      else keys.delete(code);
    }
  }
  function onKeyDown(e) {
    trackKey(e, true);
    if (e.code === 'Space' && !e.repeat) tryStartJump();
  }
  function onKeyUp(e) {
    trackKey(e, false);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  let lastT = performance.now();

  /** Walk cycle (rad); drives limb swing while moving. */
  let walkPhase = 0;
  /** Slow phase for idle breathing / micro-sway (always advances). */
  let idlePhase = 0;
  /** 0 = idle, 1 = full walk (smoothstep from planar speed). */
  let animWalkBlend = 0;

  /** 1 = face right, −1 = face left (mirrored draw). */
  let facingSign = 1;

  /** Horizontal doll arm strips: negative L / positive R swings hands down from T-pose (canvas +y down). */
  const PUPPET_ARM_HANG_L = -1.05;
  const PUPPET_ARM_HANG_R = 1.05;
  /** Procedural vertical arm rects: tiny inward tilt only (geometry differs from puppet crops). */
  const PROC_ARM_RELAX_L = 0.08;
  const PROC_ARM_RELAX_R = -0.08;
  function heroIsGrounded() {
    const y = heroBody.translation().y;
    const vy = heroBody.linvel().y;
    return y <= HERO_R + 0.45 && vy <= 1.25;
  }

  function tryStartJump() {
    if (!heroIsGrounded()) return;
    const lv = heroBody.linvel();
    heroBody.setLinvel({ x: lv.x, y: JUMP_VY, z: lv.z }, true);
  }

  let heroVelX = 0;
  let heroVelZ = 0;

  function applyHeroInputVelocity() {
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const cap = run ? GROUND_RUN_SPEED : GROUND_WALK_SPEED;
    let ix = 0;
    let iz = 0;
    if (keys.has('KeyA')) ix -= 1;
    if (keys.has('KeyD')) ix += 1;
    if (keys.has('KeyW')) iz -= 1;
    if (keys.has('KeyS')) iz += 1;

    const len = Math.hypot(ix, iz);
    if (len > 1e-6) {
      heroVelX = (ix / len) * cap;
      heroVelZ = (iz / len) * cap;
    } else {
      heroVelX = 0;
      heroVelZ = 0;
    }

    const lv = heroBody.linvel();
    heroBody.setLinvel({ x: heroVelX, y: lv.y, z: heroVelZ }, true);
  }

  function clampHeroToArena() {
    const t = heroBody.translation();
    const pad = 2;
    const { inner } = level;
    const x = Math.min(inner.maxX - HERO_R - pad, Math.max(inner.minX + HERO_R + pad, t.x));
    const z = Math.min(inner.maxY - HERO_R - pad, Math.max(inner.minY + HERO_R + pad, t.z));
    if (Math.abs(x - t.x) > 0.01 || Math.abs(z - t.z) > 0.01) {
      heroBody.setTranslation({ x, y: t.y, z }, true);
      const lv = heroBody.linvel();
      heroBody.setLinvel({ x: 0, y: lv.y, z: 0 }, true);
    }
  }

  function clampHeroGround() {
    const t = heroBody.translation();
    const lv = heroBody.linvel();
    if (heroIsGrounded() || t.y < HERO_R - 0.02) {
      if (Math.abs(t.y - HERO_R) > 0.01 || lv.y < -0.05) {
        heroBody.setTranslation({ x: t.x, y: HERO_R, z: t.z }, true);
        heroBody.setLinvel({ x: lv.x, y: Math.max(0, lv.y), z: lv.z }, true);
      }
    }
  }

  /** Map-space foot + jump lift from hero body translation. */
  function heroDrawPose() {
    const t = heroBody.translation();
    const shadow = worldToCanvas(t.x, 0, t.z);
    const foot = worldToCanvas(t.x, t.y - HERO_R, t.z);
    const jumpLift = shadow.y - foot.y;
    return { cx: t.x, shadowY: shadow.y, footY: foot.y, jumpLift };
  }

  const OUTLINE = '#1a2332';
  const OUTLINE_W = 2.25;

  function outlineRect(x, y, w, h) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeRect(x, y, w, h);
  }

  function drawGroundStamp(cx, footY, kind) {
    ctx.save();
    ctx.translate(cx, footY);
    if (kind === 'house' || kind === 'fence') {
      ctx.fillStyle = 'rgba(120, 98, 78, 0.35)';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 14, 2, 10 + i * 2, 5, 0.15 * i, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(90, 110, 82, 0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 1, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTree(cx, footY, scale) {
    const s = scale;
    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(20, 28, 22, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 26, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5c4033';
    ctx.fillRect(-7, -52, 14, 56);
    outlineRect(-7, -52, 14, 56);

    ctx.fillStyle = '#2d6a4f';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    for (const [ox, oy, rr] of [
      [0, -58, 22],
      [-18, -48, 16],
      [18, -48, 16],
      [-10, -68, 14],
      [12, -66, 15],
    ]) {
      ctx.beginPath();
      ctx.arc(ox, oy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHouse(cx, footY, scale, variant) {
    const s = scale;
    const roofHue = variant % 2 === 0 ? '#c94c4c' : '#b56576';
    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(20, 28, 22, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 48, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    const w = 56;
    const h = 42;
    ctx.fillStyle = '#d4a574';
    ctx.fillRect(-w * 0.5, -h, w, h);
    outlineRect(-w * 0.5, -h, w, h);

    ctx.fillStyle = '#264653';
    ctx.fillRect(8, -h + 10, 14, 22);
    outlineRect(8, -h + 10, 14, 22);

    ctx.fillStyle = roofHue;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5 - 8, -h);
    ctx.lineTo(0, -h - 28);
    ctx.lineTo(w * 0.5 + 8, -h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(-w * 0.5 + 10 + i * 9, -h - 18 + (i % 2) * 3, 2, 2);
    }
    ctx.restore();
  }

  function drawFenceCluster(cx, footY, scale) {
    const s = scale;
    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(s, s);
    const span = 72;
    const posts = 5;
    for (let i = 0; i < posts; i++) {
      const px = -span * 0.5 + (i / (posts - 1)) * span;
      ctx.fillStyle = '#6b5038';
      ctx.fillRect(px - 3, -28, 6, 30);
      outlineRect(px - 3, -28, 6, 30);
    }
    ctx.strokeStyle = '#4a3628';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-span * 0.5, -22);
    ctx.lineTo(span * 0.5, -22);
    ctx.moveTo(-span * 0.5, -12);
    ctx.lineTo(span * 0.5, -12);
    ctx.stroke();
    ctx.restore();
  }

  function drawStone(cx, footY, scale) {
    const s = scale;
    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(25, 35, 30, 0.25)';
    ctx.beginPath();
    ctx.ellipse(4, 5, 22, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#8a9094';
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-8, -14);
    ctx.lineTo(10, -18);
    ctx.lineTo(22, -6);
    ctx.lineTo(16, 4);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.stroke();
    ctx.restore();
  }

  function drawHeroUpright(cx, footY, jumpZ, phase) {
    const s = Math.sin(phase);
    const w = animWalkBlend;
    const ib = idlePhase;

    const legWalk = 0.5 * w * s;
    const legIdle = 0.02 * Math.sin(ib * 0.88) * (0.35 + 0.65 * (1 - w));
    const leftLegA = legWalk + legIdle;
    const rightLegA = -legWalk - legIdle;

    const armWalk = 0.44 * w;
    const armIdle = 0.042 * Math.sin(ib * 1.02) * (0.25 + 0.75 * (1 - w));
    const leftArmA = PROC_ARM_RELAX_L + -armWalk * s + armIdle;
    const rightArmA = PROC_ARM_RELAX_R + armWalk * s - armIdle * 0.92;

    const hipY = -8;
    const hipLX = -5.5;
    const hipRX = 5.5;
    /** Below torso top (−34); same 1.5× drop vs prior −31 as doll shoulder (22→33). */
    const shoulderY = -29;
    const shoulderLX = -12;
    const shoulderRX = 12;

    const breathe = 0.45 * Math.sin(ib * 1.18) * (1 - w * 0.9);

    ctx.save();
    ctx.translate(cx, footY);
    if (facingSign < 0) ctx.scale(-1, 1);

    drawHeroGroundShadowEllipse(jumpZ);

    ctx.translate(0, -jumpZ);
    ctx.translate(0, -PROCEDURAL_FEET_LOCAL_Y);

    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;

    /**
     * @param {number} hx
     * @param {number} hy
     * @param {number} angle
     */
    function drawThigh(hx, hy, angle) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(angle);
      ctx.fillStyle = '#264653';
      ctx.fillRect(-4, 0, 8, 15);
      outlineRect(-4, 0, 8, 15);
      ctx.restore();
    }

    /**
     * @param {number} sx
     * @param {number} sy
     * @param {number} angle
     */
    function drawUpperArm(sx, sy, angle) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle);
      ctx.fillStyle = '#2a9d8f';
      ctx.fillRect(-3, 0, 6, 18);
      outlineRect(-3, 0, 6, 18);
      ctx.restore();
    }

    if (s >= 0) {
      drawThigh(hipRX, hipY, rightLegA);
      drawUpperArm(shoulderLX, shoulderY, leftArmA);
    } else {
      drawThigh(hipLX, hipY, leftLegA);
      drawUpperArm(shoulderRX, shoulderY, rightArmA);
    }

    ctx.fillStyle = '#1a3d4a';
    ctx.fillRect(-11, hipY - 3, 22, 11);
    outlineRect(-11, hipY - 3, 22, 11);

    ctx.fillStyle = '#f4a261';
    ctx.fillRect(-10, -34, 20, 24);
    outlineRect(-10, -34, 20, 24);

    ctx.save();
    ctx.translate(0, breathe);
    ctx.fillStyle = '#e07a5f';
    ctx.beginPath();
    ctx.ellipse(0, -42, 13, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (s >= 0) {
      drawThigh(hipLX, hipY, leftLegA);
      drawUpperArm(shoulderRX, shoulderY, rightArmA);
    } else {
      drawThigh(hipRX, hipY, rightLegA);
      drawUpperArm(shoulderLX, shoulderY, leftArmA);
    }

    ctx.restore();
  }

  /** Display height of full doll in world px (matches prior single-sprite target). */
  const AVATAR_DISPLAY_H = 58;
  const worldPerDoll = AVATAR_DISPLAY_H / AVATAR_H;

  /**
   * @param {number} cx
   * @param {number} footY
   * @param {number} jumpZ
   * @param {number} phase
   * @param {ReturnType<typeof cropAvatarLayers>} layers
   */
  function drawHeroAvatarPuppet(cx, footY, jumpZ, phase, layers) {
    const s = Math.sin(phase);
    const w = animWalkBlend;
    const ib = idlePhase;

    const legWalk = 0.5 * w * s;
    const legIdle = 0.018 * Math.sin(ib * 0.9) * (0.35 + 0.65 * (1 - w));
    const leftLegA = legWalk + legIdle;
    const rightLegA = -legWalk - legIdle;

    const armWalk = 0.44 * w;
    const armIdle = 0.05 * Math.sin(ib * 1.04) * (0.25 + 0.75 * (1 - w));
    const leftArmA = PUPPET_ARM_HANG_L + -armWalk * s + armIdle;
    const rightArmA = PUPPET_ARM_HANG_R + armWalk * s - armIdle * 0.93;

    const headBobWalk = 0.95 * Math.sin(phase * 2) * w;
    const headBobIdle = 0.32 * Math.sin(ib * 1.16) * (0.2 + 0.8 * (1 - w));
    const headBob = headBobWalk + headBobIdle;

    const headTiltWalk = 0.028 * Math.sin(phase * 2) * w;
    const headTiltIdle = 0.016 * Math.sin(ib * 0.95) * (1 - w * 0.55);
    const headTilt = headTiltWalk + headTiltIdle;

    const torsoBreathe = 0.38 * Math.sin(ib * 1.12) * (1 - w * 0.88);

    const { feetDoll, neckDoll, hipLDoll, hipRDoll, shoulderLDoll, shoulderRDoll } = dollAttach;
    const { head, torso, armL, armR, legL, legR } = DOLL_PIXEL_RECTS;

    const hipLpx = hipLDoll.x - legL.x;
    const hipLpy = hipLDoll.y - legL.y;
    const hipRpx = hipRDoll.x - legR.x;
    const hipRpy = hipRDoll.y - legR.y;
    const shLpx = shoulderLDoll.x - armL.x;
    const shLpy = shoulderLDoll.y - armL.y;
    const shRpx = shoulderRDoll.x - armR.x;
    const shRpy = shoulderRDoll.y - armR.y;
    const neckLx = neckDoll.x - head.x;
    const neckLy = neckDoll.y - head.y;

    const S = worldPerDoll;
    const fx = feetDoll.x;
    const fy = feetDoll.y;

    /** Offset from feet origin in world px (ctx already at foot − jump). */
    function dollDelta(dx, dy) {
      return { x: (dx - fx) * S, y: (dy - fy) * S };
    }

    function drawLegPivot(hipDoll, legCanvas, angle, pivotLocalX, pivotLocalY) {
      const p = dollDelta(hipDoll.x, hipDoll.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.scale(S, S);
      ctx.drawImage(legCanvas, -pivotLocalX, -pivotLocalY, legCanvas.width, legCanvas.height);
      ctx.restore();
    }

    function drawArmPivot(shoulderDoll, armCanvas, angle, pivotLocalX, pivotLocalY) {
      const p = dollDelta(shoulderDoll.x, shoulderDoll.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.scale(S, S);
      ctx.drawImage(armCanvas, -pivotLocalX, -pivotLocalY, armCanvas.width, armCanvas.height);
      ctx.restore();
    }

    function drawTorso() {
      const o = dollDelta(torso.x, torso.y + torsoBreathe);
      ctx.drawImage(layers.torso, 0, 0, torso.w, torso.h, o.x, o.y, torso.w * S, torso.h * S);
    }

    function drawHead() {
      const neck = dollDelta(neckDoll.x, neckDoll.y);
      ctx.save();
      ctx.translate(neck.x, neck.y);
      ctx.rotate(headTilt);
      ctx.translate(0, -headBob);
      ctx.scale(S, S);
      ctx.drawImage(layers.head, -neckLx, -neckLy, head.w, head.h);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, footY);
    if (facingSign < 0) ctx.scale(-1, 1);

    drawHeroGroundShadowEllipse(jumpZ);

    ctx.translate(0, -jumpZ);

    if (s >= 0) {
      drawLegPivot(hipRDoll, layers.legR, rightLegA, hipRpx, hipRpy);
      drawArmPivot(shoulderLDoll, layers.armL, leftArmA, shLpx, shLpy);
    } else {
      drawLegPivot(hipLDoll, layers.legL, leftLegA, hipLpx, hipLpy);
      drawArmPivot(shoulderRDoll, layers.armR, rightArmA, shRpx, shRpy);
    }

    drawTorso();

    if (s >= 0) {
      drawLegPivot(hipLDoll, layers.legL, leftLegA, hipLpx, hipLpy);
      drawArmPivot(shoulderRDoll, layers.armR, rightArmA, shRpx, shRpy);
    } else {
      drawLegPivot(hipRDoll, layers.legR, rightLegA, hipRpx, hipRpy);
      drawArmPivot(shoulderLDoll, layers.armL, leftArmA, shLpx, shLpy);
    }

    drawHead();

    ctx.restore();
  }

  /**
   * Single composite fallback when puppet crops are unusable.
   * @param {HTMLCanvasElement} sprite
   */
  function drawHeroAvatarSprite(cx, footY, jumpZ, _phase, sprite) {
    ctx.save();
    ctx.translate(cx, footY);
    if (facingSign < 0) ctx.scale(-1, 1);

    drawHeroGroundShadowEllipse(jumpZ);

    ctx.translate(0, -jumpZ);

    const w = sprite.width;
    const h = sprite.height;
    const targetH = 58;
    const sc = targetH / Math.max(1, h);
    const dw = w * sc;
    const dh = h * sc;
    const dy = -heroFootFrac * dh;
    ctx.drawImage(sprite, -dw * 0.5, dy, dw, dh);
    ctx.restore();
  }

  const PROP_KINDS = ['tree', 'house', 'fence', 'stone'];

  function propKind(i) {
    return PROP_KINDS[i % PROP_KINDS.length];
  }

  function drawPropUpright(prop, i) {
    const foot = worldToCanvas(prop.x, 0, prop.z);
    const cx = foot.x;
    const footY = foot.y;
    const r = prop.r ?? 22;
    const scale = 0.85 + (r / 40) * 0.35;
    const kind = propKind(i);

    drawGroundStamp(cx, footY, kind);

    if (kind === 'tree') drawTree(cx, footY, scale);
    else if (kind === 'house') drawHouse(cx, footY, scale, i);
    else if (kind === 'fence') drawFenceCluster(cx, footY, scale);
    else drawStone(cx, footY, scale);
  }

  function drawHero(cx, footY, jumpZ, phase) {
    if (heroAvatarSprite && heroAvatarSprite.width > 0) {
      if (useAvatarPuppet) {
        drawHeroAvatarPuppet(cx, footY, jumpZ, phase, heroLayers);
      } else {
        drawHeroAvatarSprite(cx, footY, jumpZ, phase, heroAvatarSprite);
      }
    } else {
      drawHeroUpright(cx, footY, jumpZ, phase);
    }
  }

  function drawWorldDoodle(o) {
    const body = o.rigidBody;
    if (!o.strokeCanvas || !o.render || !body || !o.inkLocal) return;

    const t = body.translation();
    const angle = rotationX(body.rotation());
    const w = o.render.width;
    const h = o.render.height;
    const lx0 = o.inkLocal.x;
    const ly0 = o.inkLocal.y;

    const p0 = strokeLocalToWorld(t, angle, lx0, ly0);
    const p1 = strokeLocalToWorld(t, angle, lx0 + w, ly0);
    const p3 = strokeLocalToWorld(t, angle, lx0, ly0 + h);

    const c0 = worldToCanvas(p0.x, p0.y, p0.z);
    const c1 = worldToCanvas(p1.x, p1.y, p1.z);
    const c3 = worldToCanvas(p3.x, p3.y, p3.z);

    const a = (c1.x - c0.x) / w;
    const b = (c1.y - c0.y) / w;
    const c = (c3.x - c0.x) / h;
    const d = (c3.y - c0.y) / h;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(a, b, c, d, c0.x, c0.y);
    ctx.drawImage(o.strokeCanvas, 0, 0, o.strokeCanvas.width, o.strokeCanvas.height, 0, 0, w, h);
    ctx.restore();
  }

  function doodleSortZ(o) {
    const body = o.rigidBody;
    if (!body) return o.groundZ ?? 0;
    const t = body.translation();
    return worldSortKey(t.y, t.z);
  }

  function coordsDebugEnabled() {
    return /** @type {HTMLInputElement | null} */ (
      document.getElementById('tog-debug-coords')
    )?.checked;
  }

  /**
   * @param {import('./objects.js').WorldObject} o
   */
  function doodleShadowRadii(o) {
    const w = o.render?.width ?? 48;
    return {
      rx: Math.max(10, w * 0.2),
      ry: Math.max(4, w * 0.075),
    };
  }

  /**
   * XZ floor contact shadow at groundZ (Y = 0 anchor).
   * @param {import('./objects.js').WorldObject} o
   */
  function drawDoodleGroundShadow(o) {
    const t = o.rigidBody?.translation();
    if (!t) return;
    const shadow = worldToCanvas(t.x, 0, t.z);
    const { rx, ry } = doodleShadowRadii(o);
    ctx.fillStyle = HERO_GROUND_SHADOW_FILL;
    ctx.beginPath();
    ctx.ellipse(shadow.x, shadow.y + 3, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * @param {import('./objects.js').WorldObject} o
   */
  function drawDoodleCoordOverlays(o) {
    const body = o.rigidBody;
    if (!body) return;

    const t = body.translation();
    const floor = worldToCanvas(t.x, 0, t.z);
    const ink = worldToCanvas(t.x, t.y, t.z);

    if (t.y > 0.5) {
      ctx.strokeStyle = 'rgba(255, 140, 40, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(floor.x, floor.y);
      ctx.lineTo(ink.x, ink.y);
      ctx.stroke();
    }

    const label = `X:${t.x.toFixed(0)}  Z:${t.z.toFixed(0)}  Y:${t.y.toFixed(0)}`;
    const fontPx = 12 / VIEW_ZOOM;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const tx = ink.x + 6;
    const ty = ink.y - 8;
    ctx.lineWidth = 3 / VIEW_ZOOM;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fillText(label, tx, ty);
  }

  function drawCoordDebugLegend() {
    const fontPx = 11 / VIEW_ZOOM;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const x = camera.x + 10;
    const y = camera.y + 12;
    const text = 'Shadow = XZ floor · Orange = world Y height';
    ctx.lineWidth = 2.5 / VIEW_ZOOM;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(text, x, y);
  }

  function drawAllCoordDebug() {
    if (!coordsDebugEnabled()) return;
    for (const o of worldObjects) drawDoodleCoordOverlays(o);
    drawCoordDebugLegend();
  }

  function drawPlanePhysicsDebug() {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById('tog-debug-physics'));
    if (!el?.checked) return;

    for (const o of worldObjects) {
      const body = o.rigidBody;
      if (!body) continue;
      for (let i = 0; i < body.numColliders(); i++) {
        const col = body.collider(i);
        const outline = colliderOutlineCanvas(col);
        if (outline.length >= 3) {
          ctx.strokeStyle = 'rgba(60, 255, 180, 0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(outline[0].x, outline[0].y);
          for (let k = 1; k < outline.length; k++) {
            ctx.lineTo(outline[k].x, outline[k].y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        const b = colliderWorldBoundsXZ(col);
        if (b.width > 0 && b.height > 0) {
          const t = body.translation();
          const tl = worldToCanvas(b.minX, t.y, b.minZ);
          const br = worldToCanvas(b.minX + b.width, t.y, b.minZ + b.height);
          ctx.strokeStyle = 'rgba(60, 255, 180, 0.28)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
          ctx.setLineDash([]);
        }
      }
    }
  }

  function postPhysicsStep() {
    for (const o of worldObjects) {
      if (o.fallActive && !isDoodleAirborne(o)) {
        landDoodleObject(o);
      }
    }
  }

  function applyAllDoodlePhysics(dtMs) {
    const dtSec = dtMs * 0.001;
    for (const o of worldObjects) {
      stepDoodlePhysics(o, dtSec);
      if (o.rigidBody) refreshInkLocal(o);
    }
  }

  function drawYSortedWorld() {
    /** @type {{ sortY: number, draw: () => void }[]} */
    const layers = [];

    for (let i = 0; i < level.props.length; i++) {
      const prop = level.props[i];
      const sortY = worldSortKey(0, prop.z) + (prop.r ?? 22);
      layers.push({
        sortY,
        draw: () => drawPropUpright(prop, i),
      });
    }

    for (const o of worldObjects) {
      if (coordsDebugEnabled()) {
        const t = o.rigidBody?.translation();
        const sortY = t ? worldSortKey(0, t.z) - 0.01 : (o.groundZ ?? 0) - 0.01;
        layers.push({
          sortY,
          draw: () => drawDoodleGroundShadow(o),
        });
      }
      layers.push({
        sortY: doodleSortZ(o),
        draw: () => drawWorldDoodle(o),
      });
    }

    const pose = heroDrawPose();
    const ht = heroBody.translation();
    layers.push({
      sortY: worldSortKey(ht.y - HERO_R, ht.z),
      draw: () => drawHero(pose.cx, pose.footY, pose.jumpLift, walkPhase),
    });

    layers.sort((a, b) => a.sortY - b.sortY);
    for (const L of layers) L.draw();
  }

  let rafStopped = false;
  let rafId = 0;

  function frame(now) {
    if (rafStopped) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(40, Math.max(8, now - lastT));
    lastT = now;

    applyHeroInputVelocity();

    stepPhysics(dt * 0.001);
    processPhysicsCollisions(heroBody, () => worldObjects, (obj) => {
      landDoodleObject(obj);
    });
    postPhysicsStep();
    applyAllDoodlePhysics(dt);
    clampHeroGround();
    clampHeroToArena();

    const planarSpeed = Math.hypot(heroVelX, heroVelZ);
    const speedT = planarSpeed / GROUND_WALK_SPEED;
    animWalkBlend = Math.min(1, Math.max(0, (speedT - 0.06) / 0.28));

    const dtSec = dt * 0.001;
    if (planarSpeed > 0.5) {
      const runT = Math.min(
        1,
        Math.max(0, (planarSpeed - GROUND_WALK_SPEED) / (GROUND_RUN_SPEED - GROUND_WALK_SPEED)),
      );
      const cadence = 1 + runT * 0.35;
      walkPhase += dtSec * WALK_PHASE_OMEGA * cadence;
    } else {
      walkPhase *= Math.exp(-dtSec * 8);
      if (Math.abs(walkPhase) < 0.07) walkPhase = 0;
    }

    idlePhase += dt * 0.00105;

    if (keys.has('KeyD') && !keys.has('KeyA')) facingSign = 1;
    else if (keys.has('KeyA') && !keys.has('KeyD')) facingSign = -1;

    syncCanvasSize();
    camera.resize(canvas.width / VIEW_ZOOM, canvas.height / VIEW_ZOOM);
    const ht = heroBody.translation();
    camera.follow(ht.x, ht.z, level.bounds, 0.14);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackgroundVignette(ctx, { view: { width: canvas.width, height: canvas.height } });

    ctx.save();
    ctx.setTransform(VIEW_ZOOM, 0, 0, VIEW_ZOOM, -camera.x * VIEW_ZOOM, -camera.y * VIEW_ZOOM);
    drawWorldTurf(ctx, level, camera);
    drawArenaStatic(ctx);
    drawYSortedWorld();
    drawPlanePhysicsDebug();
    drawAllCoordDebug();
    if (strokeDragging && currentStroke.length >= 2) {
      ctx.strokeStyle = 'rgba(20, 20, 46, 0.85)';
      ctx.lineWidth = getPlaneBrush();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < currentStroke.length; i++) {
        const p = currentStroke[i];
        const c = worldToCanvas(p.x, p.y, strokePlaneZ);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function teardown() {
    unbindHeroCollisions();
    rafStopped = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('pointerdown', onPaintPointerDown);
    canvas.removeEventListener('pointermove', onPaintPointerMove);
    canvas.removeEventListener('pointerup', onPaintPointerUp);
    canvas.removeEventListener('pointercancel', onPaintPointerUp);
    canvas.removeEventListener('lostpointercapture', onPaintLostCapture);
    if (teardownPlaneGame === teardown) teardownPlaneGame = null;
  }
  teardownPlaneGame = teardown;

  rafId = requestAnimationFrame(frame);
}

void mountAvatarStudio({ onEnterWorld: startPlaneGame });
