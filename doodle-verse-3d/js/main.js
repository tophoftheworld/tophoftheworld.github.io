import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { mountAvatarStudio } from './avatar-studio.js';
import { LEVEL } from './data/level.js';
import { initPhysicsWorld } from './physics/world.js';
import {
  createHero,
  applyHeroInput,
  stepHeroPhysics,
  getHeroBody,
  HERO_FOOT_OFFSET,
  WALK_SPEED,
  RUN_SPEED,
} from './physics/hero.js';
import {
  processPhysicsCollisions,
  postPhysicsStep,
  stepDoodlePhysics,
} from './physics/doodle-physics.js';
import { createScene } from './render/scene.js';
import { createFollowCamera } from './render/camera.js';
import { buildWorldMeshes } from './render/world.js';
import { createHeroPuppetVisual } from './render/hero-puppet.js';
import { createHeroShadow } from './render/hero-shadow.js';
import { createInkLayer } from './render/ink.js';
import { createDebugOverlay } from './render/debug-overlay.js';
import { bindKeyboard, readPlanarInput } from './input/keyboard.js';
import { bindStrokePaint } from './input/paint.js';
import { createFlyCamera } from './input/fly-camera.js';
import { rasterizeStroke } from './draw/rasterize.js';
import { computeStrokePlacement, worldToScreen } from './coords.js';
import { registerDrawnObject, landDoodleObject, refreshInkLocal } from './objects/world-objects.js';

const WALK_ANIM_SLOW = 0.75;
const WALK_STRIDES_PER_SEC = 2.4 * 1.2 * WALK_ANIM_SLOW;
const WALK_PHASE_OMEGA = WALK_STRIDES_PER_SEC * Math.PI * 2;

const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();

let teardownGame = /** @type {null | (() => void)} */ (null);

/**
 * @param {number} vx
 * @param {number} vz
 * @param {THREE.Camera} camera
 * @param {number} prev
 */
function cameraRelativeFacing(vx, vz, camera, prev) {
  const speed = Math.hypot(vx, vz);
  if (speed < 0.2) return prev;

  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _right.y = 0;
  if (_right.lengthSq() > 1e-8) _right.normalize();

  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _fwd.y = 0;
  if (_fwd.lengthSq() > 1e-8) _fwd.normalize();

  const sr = vx * _right.x + vz * _right.z;
  const sf = vx * _fwd.x + vz * _fwd.z;
  if (Math.abs(sr) >= Math.abs(sf)) return sr >= 0 ? 1 : -1;
  return sf >= 0 ? -1 : 1;
}

function syncGravityCollisionHud() {
  const grav = /** @type {HTMLInputElement | null} */ (document.getElementById('next-tog-gravity'));
  const col = /** @type {HTMLInputElement | null} */ (document.getElementById('next-tog-collision'));
  if (!grav || !col) return;
  if (grav.checked) {
    col.checked = true;
    col.disabled = true;
  } else {
    col.disabled = false;
  }
}

/**
 * @param {HTMLCanvasElement} spriteCanvas
 */
async function startGame(spriteCanvas) {
  teardownGame?.();

  const overlay = document.getElementById('avatar-overlay');
  const hint = document.getElementById('plane-hint');
  const hud = document.getElementById('hud');
  const root = document.getElementById('game-root');
  const brushInput = /** @type {HTMLInputElement | null} */ (document.getElementById('next-brush'));
  const gravEl = /** @type {HTMLInputElement | null} */ (document.getElementById('next-tog-gravity'));
  const colEl = /** @type {HTMLInputElement | null} */ (document.getElementById('next-tog-collision'));
  if (!root) return;

  overlay?.classList.add('hidden');
  hint?.classList.remove('hidden');
  hud?.classList.remove('hidden');
  gravEl?.addEventListener('change', syncGravityCollisionHud);
  syncGravityCollisionHud();

  await initPhysicsWorld();
  createHero(LEVEL.spawn.x, LEVEL.spawn.y, LEVEL.spawn.z);

  const { scene, renderer, domElement, resize: resizeRenderer } = createScene(root);
  let { width, height } = resizeRenderer();
  const { camera, resize: resizeCamera, follow } = createFollowCamera(width, height);
  buildWorldMeshes(scene);
  const heroVisual = createHeroPuppetVisual(scene, spriteCanvas);
  const heroShadow = createHeroShadow(scene);
  const ink = createInkLayer(scene);
  const debugOverlay = createDebugOverlay(scene, root);
  const flyCam = createFlyCamera(width, height);
  const detachFlyPointer = flyCam.attachPointer(domElement);

  /** @type {import('./objects/world-objects.js').WorldObject[]} */
  const worldObjects = [];
  let strokePlaneZ = LEVEL.spawn.z;
  let isPainting = false;
  /** @type {{ x: number, y: number }[]} */
  let previewStrokePoints = [];

  let planar = { vx: 0, vz: 0, run: false };
  let jumpQueued = false;
  let walkPhase = 0;
  let idlePhase = 0;
  let animWalkBlend = 0;
  let facingSign = 1;
  let rafId = 0;
  let stopped = false;
  let lastT = performance.now();

  const unbindKeys = bindKeyboard(
    (p) => {
      planar = p;
    },
    () => {
      jumpQueued = true;
    },
  );

  function finishWorldStroke(points, brushWorld) {
    if (points.length < 2) return;
    const body = getHeroBody();
    if (!body) return;

    const brushCollider = brushInput ? Number(brushInput.value) : 14;
    const gravityOn = gravEl ? gravEl.checked : true;
    const ht = body.translation();
    const viewport = { width, height };
    const footScreen = worldToScreen(ht.x, ht.y - HERO_FOOT_OFFSET, ht.z, camera, viewport);
    const placement = computeStrokePlacement(
      points,
      brushCollider,
      camera,
      viewport,
      strokePlaneZ,
      ht,
      footScreen.y,
      gravityOn,
    );

    const placed = placement.worldPoints;
    const raster = rasterizeStroke(placed, brushWorld);
    const obj = registerDrawnObject({
      strokeCanvas: raster.canvas,
      render: { width: raster.width, height: raster.height, offsetX: raster.offsetX, offsetY: raster.offsetY },
      worldPoints: placed,
      brush: brushCollider,
      brushWorld,
      initialFlags: {
        gravity: gravityOn,
        collision: gravityOn ? true : (colEl ? colEl.checked : true),
      },
      placement: {
        anchorX: placement.anchorX,
        planeZ: placement.planeZ,
        spawnLift: placement.spawnLift,
        fallActive: placement.fallActive,
      },
    });
    if (obj) {
      worldObjects.push(obj);
      ink.attachInkToObject(obj);
    }
  }

  const flyToggle = /** @type {HTMLInputElement | null} */ (
    document.getElementById('tog-debug-fly')
  );
  flyToggle?.addEventListener('change', () => {
    const on = !!flyToggle.checked;
    flyCam.setActive(on);
    if (hint) {
      hint.textContent = on
        ? 'Fly cam: WASD move · Space/Ctrl up/down · mouse drag look · drawing disabled'
        : 'WASD move · Shift run · Space jump · drag on stroke plane to draw';
    }
  });

  const unbindPaint = bindStrokePaint({
    domElement,
    camera,
    getStrokePlaneZ: () => strokePlaneZ,
    isEnabled: () => !flyCam.isActive(),
    getBrush: () => {
      const v = brushInput ? Number(brushInput.value) : 14;
      return v / 48;
    },
    onStrokeBegin: () => {
      isPainting = true;
      previewStrokePoints = [];
      const body = getHeroBody();
      if (body) strokePlaneZ = body.translation().z;
    },
    onStrokeUpdate: (points, brushWorld) => {
      previewStrokePoints = points;
      ink.setPreviewStroke(points, brushWorld, strokePlaneZ);
    },
    onStrokeEnd: (points, brush) => {
      isPainting = false;
      previewStrokePoints = [];
      ink.clearPreview();
      finishWorldStroke(points, brush);
    },
    onStrokeCancel: () => {
      isPainting = false;
      previewStrokePoints = [];
      ink.clearPreview();
    },
  });

  function onResize() {
    const size = resizeRenderer();
    width = size.width;
    height = size.height;
    resizeCamera(width, height);
    flyCam.resize(width, height);
  }
  window.addEventListener('resize', onResize);

  function frame(now) {
    if (stopped) return;
    rafId = requestAnimationFrame(frame);

    const dt = Math.min(0.05, Math.max(0.008, (now - lastT) * 0.001));
    lastT = now;

    const flyActive = flyCam.isActive();
    flyCam.update(dt);

    const cap = planar.run ? RUN_SPEED : WALK_SPEED;
    let vx = planar.vx;
    let vz = planar.vz;
    const len = Math.hypot(vx, vz);
    if (len > cap + 0.01) {
      vx = (vx / len) * cap;
      vz = (vz / len) * cap;
    }

    if (!flyActive) {
      applyHeroInput({ vx, vz, jump: jumpQueued, nowMs: now });
      jumpQueued = false;
      stepHeroPhysics(dt, now);
    } else {
      jumpQueued = false;
    }

    const body = getHeroBody();
    if (body) {
      processPhysicsCollisions(body, () => worldObjects, landDoodleObject);
      postPhysicsStep(worldObjects);

      for (const o of worldObjects) {
        stepDoodlePhysics(o, dt);
        refreshInkLocal(o);
        ink.syncInkMesh(o);
      }

      const planarSpeed = Math.hypot(vx, vz);
      const speedT = planarSpeed / WALK_SPEED;
      animWalkBlend = Math.min(1, Math.max(0, (speedT - 0.06) / 0.28));

      if (planarSpeed > 0.5) {
        const runT = Math.min(
          1,
          Math.max(0, (planarSpeed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)),
        );
        const cadence = 1 + runT * 0.35;
        walkPhase += dt * WALK_PHASE_OMEGA * cadence;
      } else {
        walkPhase *= Math.exp(-dt * 8);
        if (Math.abs(walkPhase) < 0.07) walkPhase = 0;
      }

      idlePhase += dt * 1.05;
      facingSign = cameraRelativeFacing(vx, vz, camera, facingSign);

      const t = body.translation();
      if (!flyActive) {
        follow(t.x, t.y, t.z);
      }
      heroVisual.sync(body, flyActive ? flyCam.camera : camera, vx, vz, {
        walkPhase,
        animWalkBlend,
        idlePhase,
        facingSign,
      });
      heroShadow.sync(body);
    }

    const renderCamera = flyActive ? flyCam.camera : camera;
    const showPhysics = !!document.getElementById('tog-debug-physics')?.checked;
    const showCoords = !!document.getElementById('tog-debug-coords')?.checked;

    renderer.render(scene, renderCamera);
    debugOverlay.update({
      camera: renderCamera,
      viewport: { width, height },
      heroBody: body,
      worldObjects,
      showPhysics,
      showCoords,
      showInkBounds: !!document.getElementById('tog-debug-ink')?.checked,
      showStrokePlane: !!document.getElementById('tog-debug-plane')?.checked,
      showBodyAxes: !!document.getElementById('tog-debug-axes')?.checked,
      showAnchors: !!document.getElementById('tog-debug-anchors')?.checked,
      showStrokePoints: !!document.getElementById('tog-debug-points')?.checked,
      activeStrokePlaneZ: strokePlaneZ,
      isPainting,
      previewStrokePoints,
    });
  }

  function teardown() {
    stopped = true;
    cancelAnimationFrame(rafId);
    unbindKeys();
    unbindPaint();
    detachFlyPointer();
    flyCam.dispose();
    gravEl?.removeEventListener('change', syncGravityCollisionHud);
    window.removeEventListener('resize', onResize);
    debugOverlay.dispose();
    root.replaceChildren();
    hud?.classList.add('hidden');
    hint?.classList.add('hidden');
    if (teardownGame === teardown) teardownGame = null;
  }

  teardownGame = teardown;
  rafId = requestAnimationFrame(frame);
}

void mountAvatarStudio({ onEnterWorld: startGame });
