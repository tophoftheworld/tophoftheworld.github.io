import { FaceLandmarker, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54,
  103, 67, 109,
];

const SMILE_THRESHOLD = 0.45;
const SMOOTHING = 0.25;
const GREEN_FILL = "rgba(40, 220, 90, 0.55)";

const stage = document.getElementById("stage");
const video = document.getElementById("webcam");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const loadingEl = document.getElementById("loading");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

let faceLandmarker = null;
let displaySize = { width: 0, height: 0 };
let smoothedSmile = 0;

function setStatus(state, label) {
  statusEl.dataset.state = state;
  statusEl.textContent = label;
}

function showError(message) {
  loadingEl.classList.add("hidden");
  errorEl.hidden = false;
  errorEl.textContent = message;
  setStatus("error", "Error");
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  displaySize = { width: rect.width, height: rect.height };
}

function getBlendshapeScore(blendshapes, name) {
  if (!blendshapes?.length) return 0;
  const categories = blendshapes[0].categories;
  const match = categories.find((c) => c.categoryName === name);
  return match?.score ?? 0;
}

function buildFaceOvalPath(landmarks, width, height) {
  const path = new Path2D();
  const first = landmarks[FACE_OVAL[0]];
  path.moveTo(first.x * width, first.y * height);
  for (let i = 1; i < FACE_OVAL.length; i++) {
    const lm = landmarks[FACE_OVAL[i]];
    path.lineTo(lm.x * width, lm.y * height);
  }
  path.closePath();
  return path;
}

function drawMirroredFrame() {
  const { width, height } = displaySize;
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-width, 0);
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
}

function applyGreenFaceMask(landmarks) {
  const { width, height } = displaySize;
  const path = buildFaceOvalPath(landmarks, width, height);

  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-width, 0);
  ctx.clip(path);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = GREEN_FILL;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function renderLoop() {
  if (!faceLandmarker || video.readyState < 2) {
    requestAnimationFrame(renderLoop);
    return;
  }

  const results = faceLandmarker.detectForVideo(video, performance.now());
  const landmarks = results.faceLandmarks?.[0];
  const blendshapes = results.faceBlendshapes;

  const left = getBlendshapeScore(blendshapes, "mouthSmileLeft");
  const right = getBlendshapeScore(blendshapes, "mouthSmileRight");
  const rawSmile = (left + right) / 2;
  smoothedSmile += (rawSmile - smoothedSmile) * SMOOTHING;
  const isSmiling = smoothedSmile > SMILE_THRESHOLD;

  drawMirroredFrame();
  if (landmarks && isSmiling) {
    applyGreenFaceMask(landmarks);
  }

  setStatus(isSmiling ? "smiling" : "neutral", isSmiling ? "Smiling" : "Neutral");

  requestAnimationFrame(renderLoop);
}

async function initCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 1280, height: 720 },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

async function initFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    outputFaceBlendshapes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

async function main() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showError("Camera access is not supported in this browser.");
    return;
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  try {
    await Promise.all([initFaceLandmarker(), initCamera()]);
    loadingEl.classList.add("hidden");
    setStatus("neutral", "Neutral");
    renderLoop();
  } catch (err) {
    const denied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
    showError(
      denied
        ? "Camera permission was denied. Allow camera access and reload the page."
        : `Could not start: ${err?.message || "unknown error"}`,
    );
  }
}

main();
