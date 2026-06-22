/**
 * Shared level definition — render meshes and Rapier colliders use the same boxes.
 * Scale: 1 unit ≈ 100 px from legacy 2D maps.
 */

/** @typedef {{ kind: string, center: [number, number, number], half: [number, number, number] }} LevelSolid */

const W = 56;
const D = 56;
const MID_X = W * 0.5;
const MID_Z = D * 0.5;

/** @type {LevelSolid[]} */
export const LEVEL_SOLIDS = [
  {
    kind: 'ground',
    center: [MID_X, -0.3, MID_Z],
    half: [MID_X, 0.3, MID_Z],
  },
  { kind: 'platform', center: [10, 1.1, 12], half: [1.1, 0.09, 1.2] },
  { kind: 'platform', center: [18, 2.3, 22], half: [0.9, 0.09, 1.0] },
  { kind: 'platform', center: [28, 1.7, 32], half: [1.3, 0.09, 1.2] },
  { kind: 'platform', center: [38, 2.9, 42], half: [1.0, 0.09, 1.0] },
  { kind: 'platform', center: [44, 1.4, 24], half: [1.0, 0.09, 1.1] },
  { kind: 'platform', center: [22, 2.1, 46], half: [1.1, 0.09, 1.0] },
];

export const LEVEL = {
  worldW: W,
  worldD: D,
  /** Capsule center at spawn (feet near y = 0). */
  spawn: { x: 8, y: 1.2, z: 28 },
  inner: {
    minX: 2,
    maxX: W - 2,
    minZ: 2,
    maxZ: D - 2,
  },
  solids: LEVEL_SOLIDS,
};
