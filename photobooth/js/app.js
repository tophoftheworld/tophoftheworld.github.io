import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA6ikBMsQACcUpn4Jff7PQFeWLN8wv18EE",
  authDomain: "matchanese-attendance.firebaseapp.com",
  projectId: "matchanese-attendance",
  storageBucket: "matchanese-attendance.firebasestorage.app",
  messagingSenderId: "339591618451",
  appId: "1:339591618451:web:23f9d95833ee5010bbd266",
  measurementId: "G-YEK4GML6SJ",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const storage = getStorage(app);

const COUNT_FROM = 3;
const FRAME_RATIO = 9 / 16;

const kiosk = document.getElementById("kiosk");
const cam = document.getElementById("cam");
const shutter = document.getElementById("shutter");
const countEl = document.getElementById("count");
const flash = document.getElementById("flash");
const bottomBar = document.getElementById("bottomBar");
const result = document.getElementById("result");
const preview = document.getElementById("preview");
const qrEl = document.getElementById("qr");
const qrHint = document.getElementById("qrHint");
const againBtn = document.getElementById("again");
const err = document.getElementById("err");

let stream = null;
let busy = false;
let previewUrl = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showErr(msg) {
  err.hidden = false;
  err.textContent = msg;
  shutter.disabled = true;
}

function coverSource(vw, vh, tw, th) {
  const videoRatio = vw / vh;
  const targetRatio = tw / th;
  if (videoRatio > targetRatio) {
    const sh = vh;
    const sw = vh * targetRatio;
    return { sx: (vw - sw) / 2, sy: 0, sw, sh };
  }
  const sw = vw;
  const sh = vw / targetRatio;
  return { sx: 0, sy: (vh - sh) / 2, sw, sh };
}

async function tick(n) {
  countEl.hidden = false;
  countEl.textContent = String(n);
  await sleep(850);
}

function hideCount() {
  countEl.hidden = true;
}

function bang() {
  flash.classList.remove("go");
  void flash.offsetWidth;
  flash.classList.add("go");
}

function snap() {
  const vw = cam.videoWidth;
  const vh = cam.videoHeight;
  if (!vw || !vh) return null;

  const elW = kiosk.clientWidth;
  const elH = kiosk.clientHeight;
  const src = coverSource(vw, vh, elW, elH);

  const out = document.createElement("canvas");
  out.width = 1080;
  out.height = Math.round(1080 / FRAME_RATIO);
  const ctx = out.getContext("2d");
  // Mirror to match selfie expectation (preview stays unmirrored for brightness)
  ctx.translate(out.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(cam, src.sx, src.sy, src.sw, src.sh, 0, 0, out.width, out.height);
  return out;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/jpeg",
      0.92
    );
  });
}

function clearQr() {
  qrEl.innerHTML = "";
  qrEl.hidden = true;
}

function renderQr(url) {
  clearQr();
  const QR = window.QRCode;
  if (!QR) {
    qrHint.textContent = "QR library missing";
    return;
  }
  qrEl.hidden = false;
  new QR(qrEl, {
    text: url,
    width: 176,
    height: 176,
    colorDark: "#111111",
    colorLight: "#ffffff",
    correctLevel: QR.CorrectLevel.M,
  });
}

async function uploadPhoto(blob) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storageRef = ref(storage, `photobooth/${id}.jpg`);
  await uploadBytes(storageRef, blob, {
    contentType: "image/jpeg",
    cacheControl: "public,max-age=31536000",
  });
  return getDownloadURL(storageRef);
}

function setPreview(src) {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  if (typeof src === "string") {
    preview.src = src;
  } else {
    previewUrl = URL.createObjectURL(src);
    preview.src = previewUrl;
  }
}

function openResult(dataUrl) {
  setPreview(dataUrl);
  clearQr();
  qrHint.textContent = "Uploading…";
  bottomBar.hidden = true;
  result.hidden = false;
}

function closeResult() {
  result.hidden = true;
  bottomBar.hidden = false;
  clearQr();
  qrHint.textContent = "";
  preview.removeAttribute("src");
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  shutter.disabled = !stream;
}

async function bootCam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showErr("Camera not supported. Use Chrome/Edge on HTTPS or localhost.");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    cam.srcObject = stream;
    await cam.play();
    err.hidden = true;
    shutter.disabled = false;
  } catch (e) {
    console.error(e);
    showErr("Allow camera access, then reload.");
  }
}

async function run() {
  if (busy || !stream) return;
  busy = true;
  shutter.disabled = true;

  for (let n = COUNT_FROM; n >= 1; n--) {
    await tick(n);
  }
  hideCount();
  bang();
  await sleep(40);

  const frame = snap();
  if (!frame) {
    showErr("Camera not ready. Reload and try again.");
    busy = false;
    return;
  }

  openResult(frame.toDataURL("image/jpeg", 0.92));

  try {
    const blob = await canvasToBlob(frame);
    const url = await uploadPhoto(blob);
    renderQr(url);
    qrHint.textContent = "Scan to save";
  } catch (e) {
    console.error(e);
    qrHint.textContent = "Upload failed — try Again";
  }

  busy = false;
}

shutter.addEventListener("click", run);
againBtn.addEventListener("click", closeResult);
window.addEventListener("beforeunload", () => {
  stream?.getTracks().forEach((t) => t.stop());
});

bootCam();
