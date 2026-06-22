import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

/**
 * Chicory / ALTTP-style rig: mostly top-down, slight tilt from "south" (+Z).
 * World X = left/right on screen, world Z = up/down on screen (W walks into the map).
 */
/** Visible world height (~44u tall); ~3× wider than the previous 8.5 close-up. */
const FRUSTUM_HALF_H = 25;
/** Height above look-at (lower = closer rig; ortho size is still FRUSTUM_HALF_H). */
const CAM_HEIGHT = 14;
/** Camera sits south of hero on +Z, looking north. */
const CAM_BACK_Z = 5;

const LOOK_AT = new THREE.Vector3();
const POS = new THREE.Vector3();

/**
 * @param {number} width
 * @param {number} height
 */
export function createFollowCamera(width, height) {
  const aspect = width / Math.max(1, height);
  const camera = new THREE.OrthographicCamera(
    (-FRUSTUM_HALF_H * aspect) / 2,
    (FRUSTUM_HALF_H * aspect) / 2,
    FRUSTUM_HALF_H / 2,
    -FRUSTUM_HALF_H / 2,
    0.1,
    250,
  );

  function resize(w, h) {
    const a = w / Math.max(1, h);
    camera.left = (-FRUSTUM_HALF_H * a) / 2;
    camera.right = (FRUSTUM_HALF_H * a) / 2;
    camera.top = FRUSTUM_HALF_H / 2;
    camera.bottom = -FRUSTUM_HALF_H / 2;
    camera.updateProjectionMatrix();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  function follow(x, y, z) {
    LOOK_AT.set(x, y, z);
    POS.set(x, y + CAM_HEIGHT, z + CAM_BACK_Z);
    camera.position.copy(POS);
    camera.lookAt(LOOK_AT);
  }

  return { camera, resize, follow };
}
