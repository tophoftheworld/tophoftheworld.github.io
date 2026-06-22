/**
 * Full-screen 360° viewer with one toggle: present location ↔ climate-affected view.
 * Drop your equirectangular images into ./images/ (see PANORAMA_PATHS below).
 */

/** @type {{ present: string; future: string }} */
const PANORAMA_PATHS = {
  present: 'images/present.jpg',
  future: 'images/future.jpg',
};

const SCENE = {
  present: 'present',
  future: 'future',
};

const COPY = {
  present: 'See future',
  future: 'See today',
};

/** @type {ReturnType<typeof window.pannellum.viewer> | null} */
let viewer = null;
let activeScene = SCENE.present;

const toggleBtn = document.getElementById('toggle-btn');
const loadError = document.getElementById('load-error');

function setError(message) {
  loadError.hidden = !message;
  loadError.textContent = message || '';
}

function updateToggleUi() {
  const isFuture = activeScene === SCENE.future;
  toggleBtn.textContent = isFuture ? COPY.future : COPY.present;
  toggleBtn.setAttribute('aria-pressed', String(isFuture));
  toggleBtn.classList.toggle('is-future', isFuture);
}

function getViewState() {
  if (!viewer) return null;
  return {
    pitch: viewer.getPitch(),
    yaw: viewer.getYaw(),
    hfov: viewer.getHfov(),
  };
}

function applyViewState(state) {
  if (!viewer || !state) return;
  viewer.setPitch(state.pitch);
  viewer.setYaw(state.yaw);
  viewer.setHfov(state.hfov);
}

function initViewer() {
  if (typeof window.pannellum === 'undefined') {
    setError('360° viewer failed to load. Check your connection and reload.');
    return;
  }

  viewer = window.pannellum.viewer('viewer', {
    default: {
      firstScene: SCENE.present,
      sceneFadeDuration: 400,
    },
    scenes: {
      [SCENE.present]: {
        type: 'equirectangular',
        panorama: PANORAMA_PATHS.present,
        pitch: 0,
        yaw: 0,
        hfov: 100,
      },
      [SCENE.future]: {
        type: 'equirectangular',
        panorama: PANORAMA_PATHS.future,
        pitch: 0,
        yaw: 0,
        hfov: 100,
      },
    },
    autoLoad: true,
    compass: false,
    showFullscreenCtrl: true,
    showZoomCtrl: true,
    keyboardZoom: true,
    mouseZoom: true,
    minHfov: 40,
    maxHfov: 120,
  });

  viewer.on('load', () => {
    setError('');
    toggleBtn.disabled = false;
  });

  viewer.on('error', (msg) => {
    const file =
      activeScene === SCENE.present ? PANORAMA_PATHS.present : PANORAMA_PATHS.future;
    setError(
      `Could not load ${file}. Add your 360° image there (equirectangular 2:1 JPEG or PNG). ${msg || ''}`.trim()
    );
    toggleBtn.disabled = false;
  });

  window.addEventListener('resize', () => viewer?.resize());
}

async function switchScene(nextScene) {
  if (!viewer || nextScene === activeScene) return;

  const view = getViewState();
  toggleBtn.disabled = true;

  try {
    viewer.loadScene(nextScene, view?.pitch, view?.yaw, view?.hfov);
    activeScene = nextScene;
    updateToggleUi();
    requestAnimationFrame(() => applyViewState(view));
  } finally {
    toggleBtn.disabled = false;
  }
}

toggleBtn.addEventListener('click', () => {
  const next = activeScene === SCENE.present ? SCENE.future : SCENE.present;
  switchScene(next);
});

initViewer();
updateToggleUi();
