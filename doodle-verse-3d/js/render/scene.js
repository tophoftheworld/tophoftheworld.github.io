import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { buildFloor } from './floor.js';

const SKY = 0xf4f4f2;

/**
 * @param {HTMLElement} container
 */
export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 55, 110);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xe8e8e6, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.35);
  sun.position.set(10, 32, 14);
  scene.add(sun);

  buildFloor(scene);

  function resize() {
    const w = Math.max(320, container.clientWidth | 0);
    const h = Math.max(240, container.clientHeight | 0);
    renderer.setSize(w, h, false);
    return { width: w, height: h };
  }

  resize();

  return { scene, renderer, domElement: renderer.domElement, resize };
}
