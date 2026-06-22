/**
 * Debug perspective fly camera — WASD move, Space/Ctrl up/down, mouse drag look.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const MOVE_SPEED = 14;
const LOOK_SENS = 0.003;

/**
 * @param {number} width
 * @param {number} height
 */
export function createFlyCamera(width, height) {
  const camera = new THREE.PerspectiveCamera(60, width / Math.max(1, height), 0.1, 400);
  camera.position.set(28, 16, 44);

  let active = false;
  let yaw = -0.6;
  let pitch = -0.35;
  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  function applyRotation() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }
  applyRotation();

  function onKeyDown(e) {
    if (!active) return;
    const code = e.code;
    if (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'Space' ||
      code === 'ControlLeft' ||
      code === 'ControlRight' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown'
    ) {
      e.preventDefault();
      keys.add(code);
    }
  }

  function onKeyUp(e) {
    if (!active) return;
    keys.delete(e.code);
  }

  function onPointerDown(e) {
    if (!active || e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!active || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw -= dx * LOOK_SENS;
    pitch -= dy * LOOK_SENS;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
    applyRotation();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.button === 0) dragging = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  /**
   * @param {HTMLElement} el
   */
  function attachPointer(el) {
    el.addEventListener('pointerdown', onPointerDown);
    return () => el.removeEventListener('pointerdown', onPointerDown);
  }

  /**
   * @param {number} dtSec
   */
  function update(dtSec) {
    if (!active) return;

    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, _up).normalize();
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);

    let mx = 0;
    let my = 0;
    let mz = 0;
    if (keys.has('KeyW')) mz -= 1;
    if (keys.has('KeyS')) mz += 1;
    if (keys.has('KeyA')) mx -= 1;
    if (keys.has('KeyD')) mx += 1;
    if (keys.has('Space') || keys.has('ArrowUp')) my += 1;
    if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('ArrowDown')) my -= 1;
    if (keys.has('ArrowLeft')) yaw += 1.8 * dtSec;
    if (keys.has('ArrowRight')) yaw -= 1.8 * dtSec;

    const len = Math.hypot(mx, my, mz);
    if (len > 0.01) {
      mx /= len;
      my /= len;
      mz /= len;
    }

    const speed = MOVE_SPEED * dtSec;
    camera.position.addScaledVector(_right, mx * speed);
    camera.position.y += my * speed;
    camera.position.addScaledVector(_fwd, mz * speed);
    applyRotation();
  }

  /**
   * @param {number} w
   * @param {number} h
   */
  function resize(w, h) {
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  /**
   * @param {boolean} on
   */
  function setActive(on) {
    active = on;
    if (!on) {
      keys.clear();
      dragging = false;
    }
  }

  function isActive() {
    return active;
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    keys.clear();
  }

  return {
    camera,
    update,
    resize,
    setActive,
    isActive,
    dispose,
    attachPointer,
  };
}
