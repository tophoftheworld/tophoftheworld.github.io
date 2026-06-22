import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { raycastToStrokePlane } from '../coords.js';

const DRAG_PX = 8;

/**
 * Paint on vertical XY sheet at fixed Z (set on pointer down).
 * @param {{
 *   domElement: HTMLElement,
 *   camera: THREE.Camera,
 *   getStrokePlaneZ: () => number,
 *   getBrush: () => number,
 *   onStrokeBegin?: () => void,
 *   onStrokeUpdate: (points: { x: number, y: number }[], brush: number) => void,
 *   onStrokeEnd: (points: { x: number, y: number }[], brush: number) => void,
 *   onStrokeCancel: () => void,
 *   isEnabled?: () => boolean,
 * }} opts
 */
export function bindStrokePaint(opts) {
  const {
    domElement,
    camera,
    getStrokePlaneZ,
    getBrush,
    onStrokeBegin,
    onStrokeUpdate,
    onStrokeEnd,
    onStrokeCancel,
    isEnabled = () => true,
  } = opts;
  const raycaster = new THREE.Raycaster();
  raycaster.camera = camera;
  const ndc = new THREE.Vector2();

  let painting = false;
  let pointerId = -1;
  let downX = 0;
  let downY = 0;
  let planeZ = 0;
  /** @type {{ x: number, y: number }[]} */
  let stroke = [];

  function emitPreview() {
    if (stroke.length >= 2) onStrokeUpdate(stroke, getBrush());
    else onStrokeCancel();
  }

  /**
   * @param {PointerEvent} e
   */
  function clientToPlane(e) {
    const rect = domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ndc.set(x, y);
    return raycastToStrokePlane(raycaster, ndc, planeZ);
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e) {
    if (!isEnabled()) return;
    if (e.button !== 0) return;
    if (painting) return;
    painting = true;
    pointerId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
    planeZ = getStrokePlaneZ();
    stroke = [];
    onStrokeBegin?.();
    const p = clientToPlane(e);
    if (p) stroke.push(p);
    onStrokeCancel();
    domElement.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e) {
    if (!isEnabled()) return;
    if (!painting || e.pointerId !== pointerId) return;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (dist < DRAG_PX && stroke.length < 2) return;
    const p = clientToPlane(e);
    if (!p) return;
    const last = stroke[stroke.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.04) return;
    stroke.push(p);
    emitPreview();
    e.preventDefault();
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerUp(e) {
    if (!painting || e.pointerId !== pointerId) return;
    painting = false;
    try {
      domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (dist >= DRAG_PX && stroke.length >= 2) {
      onStrokeEnd(stroke, getBrush());
    } else {
      onStrokeCancel();
    }
    stroke = [];
    pointerId = -1;
    e.preventDefault();
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);

  return () => {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointermove', onPointerMove);
    domElement.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointercancel', onPointerUp);
    onStrokeCancel();
  };
}

/** @deprecated use bindStrokePaint */
export const bindFloorPaint = bindStrokePaint;
