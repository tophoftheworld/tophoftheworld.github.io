import {
  FilesetResolver,
  ImageSegmenter,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs";

const VISION_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

const MATCHA = { r: 94, g: 146, b: 41 };
const UBE = { r: 138, g: 64, b: 184 };

const MULTICLASS_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const SELFIE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.tflite";

const video = document.getElementById("camera");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

let vision = null;
let segmenter = null;
let poseLandmarker = null;
let useSkinClasses = false;
let running = false;
let swapped = false;
let swapBlend = 0;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(a, b, t) {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

function colorForPerson(index, t) {
  const ubeAmount = index % 2 === 0 ? t : 1 - t;
  return lerpColor(MATCHA, UBE, ubeAmount);
}

function skinScore(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (y < 35 || y > 245) return 0;
  const dCr = (cr - 150) / 28;
  const dCb = (cb - 110) / 22;
  if (r < 45 && g < 35 && b < 30) return 0;
  return Math.max(0, 1 - (dCr * dCr + dCb * dCb));
}

function tintPixel(r, g, b, target, amount) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const ty = 0.299 * target.r + 0.587 * target.g + 0.114 * target.b;
  const scale = y / Math.max(ty, 1);
  return [
    r + (target.r * scale - r) * amount,
    g + (target.g * scale - g) * amount,
    b + (target.b * scale - b) * amount,
  ];
}

async function getVision() {
  if (!vision) {
    vision = await FilesetResolver.forVisionTasks(VISION_WASM);
  }
  return vision;
}

async function createSegmenter(modelAssetPath, delegate) {
  return ImageSegmenter.createFromOptions(await getVision(), {
    baseOptions: { modelAssetPath, delegate },
    runningMode: "VIDEO",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}

async function loadSegmenter() {
  const attempts = [
    { model: MULTICLASS_MODEL, delegate: "GPU", skinClasses: true },
    { model: MULTICLASS_MODEL, delegate: "CPU", skinClasses: true },
    { model: SELFIE_MODEL, delegate: "GPU", skinClasses: false },
    { model: SELFIE_MODEL, delegate: "CPU", skinClasses: false },
  ];

  for (const attempt of attempts) {
    try {
      segmenter = await createSegmenter(attempt.model, attempt.delegate);
      useSkinClasses = attempt.skinClasses;
      return;
    } catch (err) {
      console.warn("Segmenter load failed", attempt, err);
    }
  }

  throw new Error("Could not load person detection.");
}

async function loadPose() {
  for (const delegate of ["GPU", "CPU"]) {
    try {
      poseLandmarker = await PoseLandmarker.createFromOptions(await getVision(), {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        runningMode: "VIDEO",
        numPoses: 4,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
      });
      return;
    } catch (err) {
      console.warn("Pose load failed", delegate, err);
    }
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

function setSwapped(next) {
  swapped = next;
}

function skinAmount(masks, pixels, index) {
  if (useSkinClasses) {
    const body = masks[2]?.[index] || 0;
    const face = masks[3]?.[index] || 0;
    return Math.min(1, body + face);
  }
  const person = masks.length > 1 ? masks[1][index] : masks[0][index];
  const p = index * 4;
  return person * skinScore(pixels[p], pixels[p + 1], pixels[p + 2]);
}

function personPresence(masks, index) {
  if (useSkinClasses) {
    let sum = 0;
    for (let c = 1; c <= 5; c++) sum += masks[c]?.[index] || 0;
    return Math.min(1, sum);
  }
  return masks.length > 1 ? masks[1][index] : masks[0][index];
}

function copyMasks(result) {
  const raw = result.confidenceMasks || [];
  const copied = raw.map((mask) => new Float32Array(mask.getAsFloat32Array()));
  for (const mask of raw) mask.close();
  return copied;
}

function peopleFromPoses(poseResult, width, height) {
  if (!poseResult?.landmarks?.length) return [];
  const people = [];
  const seedKeys = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
  for (const landmarks of poseResult.landmarks) {
    const seeds = [];
    let x = 0;
    let y = 0;
    let n = 0;
    for (const key of seedKeys) {
      const point = landmarks[key];
      if (!point || (point.visibility ?? 1) < 0.35) continue;
      const sx = point.x * width;
      const sy = point.y * height;
      seeds.push({ x: sx, y: sy });
      if (key === 0 || key === 11 || key === 12 || key === 23 || key === 24) {
        x += sx;
        y += sy;
        n += 1;
      }
    }
    if (!seeds.length) continue;
    people.push({
      x: n ? x / n : seeds[0].x,
      y: n ? y / n : seeds[0].y,
      seeds,
    });
  }
  return people;
}

function peopleFromBlobs(presence, width, height) {
  const step = 4;
  const mw = Math.ceil(width / step);
  const mh = Math.ceil(height / step);
  const labels = new Int32Array(mw * mh);
  const parent = [0];
  let next = 0;
  const threshold = 0.4;

  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };

  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const src =
        Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step);
      if (presence[src] < threshold) continue;
      const i = y * mw + x;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - mw] : 0;
      if (left && up) {
        labels[i] = left;
        unite(left, up);
      } else if (left) {
        labels[i] = left;
      } else if (up) {
        labels[i] = up;
      } else {
        next += 1;
        parent[next] = next;
        labels[i] = next;
      }
    }
  }

  const sx = new Float64Array(next + 1);
  const sy = new Float64Array(next + 1);
  const count = new Float64Array(next + 1);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x;
      if (!labels[i]) continue;
      const root = find(labels[i]);
      sx[root] += x * step;
      sy[root] += y * step;
      count[root] += 1;
    }
  }

  const minArea = mw * mh * 0.012;
  const people = [];
  for (let id = 1; id <= next; id++) {
    if (parent[id] !== id || count[id] < minArea) continue;
    const cx = sx[id] / count[id];
    const cy = sy[id] / count[id];
    people.push({
      x: cx,
      y: cy,
      area: count[id],
      seeds: [{ x: cx, y: cy }],
    });
  }
  people.sort((a, b) => b.area - a.area);
  return people.slice(0, 4);
}

function sortOnScreen(people) {
  people.sort((a, b) => b.x - a.x);
  return people;
}

function resolvePeople(poseResult, presence, width, height) {
  const fromPose = peopleFromPoses(poseResult, width, height);
  const fromBlobs = peopleFromBlobs(presence, width, height);
  const chosen =
    fromBlobs.length > fromPose.length && fromBlobs.length >= 2
      ? fromBlobs
      : fromPose.length
        ? fromPose
        : fromBlobs;
  if (!chosen.length) {
    return [{ x: width * 0.5, y: height * 0.5, seeds: [{ x: width * 0.5, y: height * 0.5 }] }];
  }
  return sortOnScreen(chosen);
}

function labelPeople(presence, people, width, height) {
  const step = 4;
  const mw = Math.ceil(width / step);
  const mh = Math.ceil(height / step);
  const threshold = 0.35;
  const labels = new Int32Array(mw * mh);
  const dist = new Float32Array(mw * mh);
  dist.fill(1e9);
  const queue = [];
  let head = 0;

  const onPerson = (mx, my) => {
    const sx = Math.min(width - 1, mx * step);
    const sy = Math.min(height - 1, my * step);
    return presence[sy * width + sx] >= threshold;
  };

  const seedFrom = (px, py) => {
    let mx = Math.max(0, Math.min(mw - 1, Math.round(px / step)));
    let my = Math.max(0, Math.min(mh - 1, Math.round(py / step)));
    if (onPerson(mx, my)) return my * mw + mx;
    const maxR = 12;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = mx + dx;
          const y = my + dy;
          if (x < 0 || y < 0 || x >= mw || y >= mh) continue;
          if (onPerson(x, y)) return y * mw + x;
        }
      }
    }
    return -1;
  };

  for (let i = 0; i < people.length; i++) {
    const seeds = people[i].seeds || [{ x: people[i].x, y: people[i].y }];
    for (const seed of seeds) {
      const idx = seedFrom(seed.x, seed.y);
      if (idx < 0) continue;
      if (dist[idx] <= 0) continue;
      labels[idx] = i + 1;
      dist[idx] = 0;
      queue.push(idx);
    }
  }

  while (head < queue.length) {
    const i = queue[head++];
    const x = i % mw;
    const y = (i / mw) | 0;
    const nextDist = dist[i] + 1;
    const lab = labels[i];
    if (x > 0) {
      const n = i - 1;
      if (onPerson(x - 1, y) && nextDist < dist[n]) {
        dist[n] = nextDist;
        labels[n] = lab;
        queue.push(n);
      }
    }
    if (x < mw - 1) {
      const n = i + 1;
      if (onPerson(x + 1, y) && nextDist < dist[n]) {
        dist[n] = nextDist;
        labels[n] = lab;
        queue.push(n);
      }
    }
    if (y > 0) {
      const n = i - mw;
      if (onPerson(x, y - 1) && nextDist < dist[n]) {
        dist[n] = nextDist;
        labels[n] = lab;
        queue.push(n);
      }
    }
    if (y < mh - 1) {
      const n = i + mw;
      if (onPerson(x, y + 1) && nextDist < dist[n]) {
        dist[n] = nextDist;
        labels[n] = lab;
        queue.push(n);
      }
    }
  }

  return { labels, mw, mh, step };
}

function personLabelAt(x, y, labeled) {
  const mx = Math.max(0, Math.min(labeled.mw - 1, (x / labeled.step) | 0));
  const my = Math.max(0, Math.min(labeled.mh - 1, (y / labeled.step) | 0));
  const direct = labeled.labels[my * labeled.mw + mx];
  if (direct) return direct - 1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const lx = mx + dx;
      const ly = my + dy;
      if (lx < 0 || ly < 0 || lx >= labeled.mw || ly >= labeled.mh) continue;
      const lab = labeled.labels[ly * labeled.mw + lx];
      if (lab) return lab - 1;
    }
  }
  return -1;
}

function render(segResult, poseResult) {
  const masks = copyMasks(segResult);
  swapBlend += ((swapped ? 1 : 0) - swapBlend) * 0.22;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  const width = canvas.width;
  const height = canvas.height;
  const count = width * height;
  if (!masks[0] || masks[0].length !== count) {
    ctx.putImageData(frame, 0, 0);
    return;
  }

  const presence = new Float32Array(count);
  for (let i = 0; i < count; i++) presence[i] = personPresence(masks, i);
  const people = resolvePeople(poseResult, presence, width, height);
  const labeled = labelPeople(presence, people, width, height);
  const colors = people.map((_, i) => colorForPerson(i, swapBlend));

  for (let i = 0; i < count; i++) {
    let amount = skinAmount(masks, pixels, i);
    amount = Math.min(1, amount * 1.25);
    if (amount < 0.05) continue;

    const x = i % width;
    const y = (i / width) | 0;
    const person = personLabelAt(x, y, labeled);
    if (person < 0) continue;
    const p = i * 4;
    const tinted = tintPixel(
      pixels[p],
      pixels[p + 1],
      pixels[p + 2],
      colors[person],
      amount
    );
    pixels[p] = tinted[0];
    pixels[p + 1] = tinted[1];
    pixels[p + 2] = tinted[2];
  }

  ctx.putImageData(frame, 0, 0);
}

function loop() {
  if (!running) return;
  if (video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }
  const now = performance.now();
  let poses = null;
  if (poseLandmarker) {
    poses = poseLandmarker.detectForVideo(video, now);
  }
  segmenter.segmentForVideo(video, now, (result) => {
    render(result, poses);
    requestAnimationFrame(loop);
  });
}

async function start() {
  if (running) return;
  await startCamera();
  await loadSegmenter();
  await loadPose();
  setSwapped(false);
  running = true;
  loop();
}

window.addEventListener("keydown", (event) => {
  if (event.code !== "Space" && event.key !== " ") return;
  event.preventDefault();
  if (running) setSwapped(!swapped);
});

start().catch((err) => {
  console.error(err);
});
