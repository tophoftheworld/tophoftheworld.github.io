const canvas = document.getElementById("editorCanvas");
const ctx = canvas.getContext("2d");
const saveBtn = document.getElementById("saveBtn");
const reloadBtn = document.getElementById("reloadBtn");
const modeLabel = document.getElementById("modeLabel");
const saveStatus = document.getElementById("saveStatus");

const GRID_SIZE = 26;
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1400;

const camera = { x: 0, y: 0, zoom: 1 };
let mode = "permanent";
let painting = false;
let panning = false;
let lastMouse = { x: 0, y: 0 };

const permanent = new Set();
const damageable = new Set();

function setStatus(text) {
  saveStatus.textContent = text;
}

function key(cx, cy) {
  return `${cx}:${cy}`;
}

function parseKey(k) {
  const [cx, cy] = k.split(":").map(Number);
  return { cx, cy };
}

function screenToWorld(x, y) {
  return { x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y };
}

function toCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

function worldToCell(x, y) {
  return { cx: Math.floor(x / GRID_SIZE), cy: Math.floor(y / GRID_SIZE) };
}

function paintCell(cx, cy) {
  if (cx < 0 || cy < 0 || cx >= Math.floor(WORLD_WIDTH / GRID_SIZE) || cy >= Math.floor(WORLD_HEIGHT / GRID_SIZE)) return;
  const k = key(cx, cy);
  if (mode === "permanent") {
    permanent.add(k);
    damageable.delete(k);
  } else if (mode === "damageable") {
    damageable.add(k);
    permanent.delete(k);
  } else {
    permanent.delete(k);
    damageable.delete(k);
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  ctx.strokeStyle = "rgba(70, 80, 95, 0.25)";
  for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_WIDTH, y);
    ctx.stroke();
  }

  for (const k of permanent) {
    const { cx, cy } = parseKey(k);
    ctx.fillStyle = "#c8c8c8";
    ctx.fillRect(cx * GRID_SIZE + 1, cy * GRID_SIZE + 1, GRID_SIZE - 2, GRID_SIZE - 2);
  }
  for (const k of damageable) {
    const { cx, cy } = parseKey(k);
    ctx.fillStyle = "#67b4ff";
    ctx.fillRect(cx * GRID_SIZE + 1, cy * GRID_SIZE + 1, GRID_SIZE - 2, GRID_SIZE - 2);
  }

  ctx.restore();
  requestAnimationFrame(draw);
}

canvas.addEventListener("mousedown", (e) => {
  const point = toCanvasPoint(e.clientX, e.clientY);
  lastMouse = point;
  if (e.button === 1 || e.button === 2) {
    panning = true;
    return;
  }
  if (e.button === 0) {
    painting = true;
    const world = screenToWorld(point.x, point.y);
    const cell = worldToCell(world.x, world.y);
    paintCell(cell.cx, cell.cy);
  }
});

canvas.addEventListener("mousemove", (e) => {
  const point = toCanvasPoint(e.clientX, e.clientY);
  const dx = point.x - lastMouse.x;
  const dy = point.y - lastMouse.y;
  lastMouse = point;

  if (panning) {
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    return;
  }
  if (!painting) return;
  const world = screenToWorld(point.x, point.y);
  const cell = worldToCell(world.x, world.y);
  paintCell(cell.cx, cell.cy);
});

canvas.addEventListener("mouseup", () => {
  painting = false;
  panning = false;
});
canvas.addEventListener("mouseleave", () => {
  painting = false;
  panning = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const point = toCanvasPoint(e.clientX, e.clientY);
  const mx = point.x;
  const my = point.y;
  const before = screenToWorld(mx, my);
  camera.zoom = Math.max(0.3, Math.min(3, camera.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  const after = screenToWorld(mx, my);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
});

for (const btn of document.querySelectorAll("button[data-mode]")) {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    modeLabel.textContent = `mode: ${mode}`;
  });
}

function applyMap(json) {
  permanent.clear();
  damageable.clear();
  for (const b of json.permanentBlocks || []) permanent.add(key(b.cellX, b.cellY));
  for (const b of json.damageableBlocks || []) damageable.add(key(b.cellX, b.cellY));
}

function serializeMap() {
  return {
    gridSize: GRID_SIZE,
    permanentBlocks: Array.from(permanent).map((k) => {
      const { cx, cy } = parseKey(k);
      return { cellX: cx, cellY: cy };
    }),
    damageableBlocks: Array.from(damageable).map((k) => {
      const { cx, cy } = parseKey(k);
      return { cellX: cx, cellY: cy, hp: 100 };
    }),
  };
}

async function loadMap() {
  setStatus("loading...");
  try {
    const response = await fetch("/api/map");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    applyMap(json);
    setStatus("loaded");
  } catch (error) {
    setStatus(`load failed: ${error.message}`);
  }
}

async function saveMap() {
  setStatus("saving...");
  try {
    const response = await fetch("/api/map", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeMap()),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setStatus("saved");
  } catch (error) {
    setStatus(`save failed: ${error.message}`);
  }
}

saveBtn.addEventListener("click", () => {
  saveMap();
});

reloadBtn.addEventListener("click", () => {
  loadMap();
});

draw();
loadMap();
