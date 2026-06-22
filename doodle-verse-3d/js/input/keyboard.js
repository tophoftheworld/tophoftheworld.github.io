/**
 * WASD + Shift + Space keyboard state.
 */
import { WALK_SPEED, RUN_SPEED } from '../physics/hero.js';

const keys = new Set();

/** @type {(() => void) | null} */
let onJump = null;

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
    if (down) {
      if (code === 'Space' && !keys.has('Space') && onJump) onJump();
      keys.add(code);
    } else {
      keys.delete(code);
    }
  }
}

/**
 * @param {(planar: { vx: number, vz: number, run: boolean }) => void} fn
 * @param {() => void} jumpFn
 */
export function bindKeyboard(planarFn, jumpFn) {
  onJump = jumpFn;

  function onKeyDown(e) {
    trackKey(e, true);
    planarFn(readPlanarInput());
  }
  function onKeyUp(e) {
    trackKey(e, false);
    planarFn(readPlanarInput());
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    onJump = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    keys.clear();
  };
}

/** Screen-oriented walk: W/S = world ±Z (into/out of map), A/D = world ±X. */
export function readPlanarInput() {
  let ix = 0;
  let iz = 0;
  if (keys.has('KeyA')) ix -= 1;
  if (keys.has('KeyD')) ix += 1;
  if (keys.has('KeyW')) iz -= 1;
  if (keys.has('KeyS')) iz += 1;

  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const len = Math.hypot(ix, iz);
  if (len < 1e-6) return { vx: 0, vz: 0, run };

  const cap = run ? RUN_SPEED : WALK_SPEED;
  return { vx: (ix / len) * cap, vz: (iz / len) * cap, run };
}
