import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import {
  cropAvatarLayers,
  DOLL_PIXEL_RECTS,
  getDollAttachmentPoints,
} from '../avatar-doll.js';
import { HERO_FOOT_OFFSET } from '../physics/hero.js';

const PUPPET_ARM_HANG_L = -1.05;
const PUPPET_ARM_HANG_R = 1.05;

/** 2× puppet atlas — sharp when billboard is ~2.4u tall on screen. */
const PUP_W = 256;
const PUP_H = 340;
const FOOT_PAD = 8;
/** Room above head for walk bob / tilt (canvas space). */
const TOP_PAD = 28;

/**
 * @param {HTMLCanvasElement} spriteCanvas
 */
export function createHeroPuppetVisual(scene, spriteCanvas) {
  const layers = cropAvatarLayers(spriteCanvas);
  const dollAttach = getDollAttachmentPoints();
  const usePuppet = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'].every(
    (k) => layers[k]?.width > 0,
  );

  const { feetDoll } = dollAttach;
  const { head } = DOLL_PIXEL_RECTS;
  const dollSpanY = feetDoll.y - head.y;
  const puppetScale = (PUP_H - FOOT_PAD - TOP_PAD) / Math.max(1, dollSpanY);

  const puppetCanvas = document.createElement('canvas');
  puppetCanvas.width = PUP_W;
  puppetCanvas.height = PUP_H;
  const ctx = puppetCanvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
  }

  const tex = new THREE.CanvasTexture(puppetCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;

  const aspect = PUP_W / PUP_H;
  const worldH = 2.4;
  const worldW = worldH * aspect;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const geo = new THREE.PlaneGeometry(worldW, worldH);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = worldH * 0.5;
  const root = new THREE.Group();
  root.add(mesh);
  scene.add(root);

  let facingSign = 1;

  /**
   * @param {number} phase
   * @param {number} animWalkBlend
   * @param {number} idlePhase
   * @param {number} jumpLiftPx
   */
  function drawPuppetFrame(phase, animWalkBlend, idlePhase, jumpLiftPx) {
    if (!ctx) return;
    ctx.clearRect(0, 0, PUP_W, PUP_H);
    if (!usePuppet) {
      const targetH = PUP_H - FOOT_PAD * 2;
      const sc = targetH / Math.max(1, spriteCanvas.height);
      const dw = spriteCanvas.width * sc;
      const dh = spriteCanvas.height * sc;
      ctx.save();
      ctx.translate(PUP_W * 0.5, PUP_H - FOOT_PAD - jumpLiftPx);
      if (facingSign < 0) ctx.scale(-1, 1);
      ctx.drawImage(spriteCanvas, -dw * 0.5, -dh, dw, dh);
      ctx.restore();
      return;
    }

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

    const { neckDoll, hipLDoll, hipRDoll, shoulderLDoll, shoulderRDoll } = dollAttach;
    const { torso, armL, armR, legL, legR } = DOLL_PIXEL_RECTS;

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

    const S = puppetScale;
    const fx = feetDoll.x;
    const fy = feetDoll.y;

    const cx = PUP_W * 0.5;
    const footY = PUP_H - FOOT_PAD;

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
    ctx.translate(0, -jumpLiftPx);

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
   * @param {import('@dimforge/rapier3d-compat').RigidBody} body
   * @param {THREE.Camera} camera
   * @param {number} vx
   * @param {number} vz
   * @param {{
   *   walkPhase: number,
   *   animWalkBlend: number,
   *   idlePhase: number,
   *   facingSign: number,
   * }} anim
   */
  function sync(body, camera, vx, vz, anim) {
    const t = body.translation();
    root.position.set(t.x, t.y - HERO_FOOT_OFFSET, t.z);
    root.lookAt(camera.position);

    facingSign = anim.facingSign;

    // Billboard root already follows physics Y — no extra canvas jump (that clipped the head).
    drawPuppetFrame(anim.walkPhase, anim.animWalkBlend, anim.idlePhase, 0);
    tex.needsUpdate = true;

    mesh.scale.x = Math.abs(mesh.scale.x) * (facingSign < 0 ? -1 : 1);
  }

  return { root, sync, texture: tex };
}
