const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const minimapCanvas = document.getElementById("minimapCanvas");
const minimapCtx = minimapCanvas.getContext("2d");
const statusEl = document.getElementById("status");
const roleEl = document.getElementById("role");
const holdEl = document.getElementById("hold");
const playersEl = document.getElementById("players");
const kingEl = document.getElementById("king");
const bestEl = document.getElementById("best");
const toolEl = document.getElementById("tool");

const storedId = sessionStorage.getItem("onevsallPlayerId");
const myId = storedId || crypto.randomUUID();
sessionStorage.setItem("onevsallPlayerId", myId);

const keys = new Set();
const state = {
  kingId: null,
  holdMs: 0,
  bestHoldMs: 0,
  players: {},
  bullets: [],
  blocks: [],
  turrets: [],
  radius: 10,
  arenaWidth: 2400,
  arenaHeight: 1400,
};

const camera = {
  x: 0,
  y: 0,
};

let socket = null;
let lastFeed = "";
let lastFeedAt = 0;
let mouseScreen = { x: canvas.width / 2, y: canvas.height / 2 };
let previousSnapshot = null;
let latestSnapshot = null;
const RENDER_LAG_MS = 70;
const GRID_SIZE = 26;
const CAMERA_FOLLOW_BASE = 0.55;
const CAMERA_FOLLOW_RECOVER = 0.82;
const CAMERA_SNAP_EPSILON = 0.8;

let selectedTool = "weapon";
let isPainting = false;
const queuedCells = new Set();
let lastPaintSentAt = 0;
const PAINT_SEND_MS = 70;
const paintAnchor = { cellX: 0, cellY: 0 };

function formatMs(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function wsUrl() {
  if (location.protocol === "file:") return "ws://localhost:8080/ws";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function viewWidth() {
  return canvas.width;
}

function viewHeight() {
  return canvas.height;
}

function screenToWorld(point) {
  clampCameraToBounds();
  return { x: point.x + camera.x, y: point.y + camera.y };
}

function worldToScreen(point) {
  clampCameraToBounds();
  return { x: point.x - camera.x, y: point.y - camera.y };
}

function cameraBounds() {
  return {
    maxX: Math.max(0, state.arenaWidth - viewWidth()),
    maxY: Math.max(0, state.arenaHeight - viewHeight()),
  };
}

function clampCameraToBounds() {
  const { maxX, maxY } = cameraBounds();
  camera.x = clamp(camera.x, 0, maxX);
  camera.y = clamp(camera.y, 0, maxY);
}

function updateCamera(localPlayer) {
  if (!localPlayer) return;
  const { maxX, maxY } = cameraBounds();
  const targetX = clamp(localPlayer.x - viewWidth() / 2, 0, maxX);
  const targetY = clamp(localPlayer.y - viewHeight() / 2, 0, maxY);
  const deltaX = targetX - camera.x;
  const deltaY = targetY - camera.y;
  const leavingEdgeX = (camera.x <= CAMERA_SNAP_EPSILON && targetX > camera.x) || (camera.x >= maxX - CAMERA_SNAP_EPSILON && targetX < camera.x);
  const leavingEdgeY = (camera.y <= CAMERA_SNAP_EPSILON && targetY > camera.y) || (camera.y >= maxY - CAMERA_SNAP_EPSILON && targetY < camera.y);
  const followX = leavingEdgeX ? CAMERA_FOLLOW_RECOVER : CAMERA_FOLLOW_BASE;
  const followY = leavingEdgeY ? CAMERA_FOLLOW_RECOVER : CAMERA_FOLLOW_BASE;

  camera.x += deltaX * followX;
  camera.y += deltaY * followY;

  if (Math.abs(targetX - camera.x) < CAMERA_SNAP_EPSILON) camera.x = targetX;
  if (Math.abs(targetY - camera.y) < CAMERA_SNAP_EPSILON) camera.y = targetY;
  clampCameraToBounds();
}

function connect() {
  socket = new WebSocket(wsUrl());
  statusEl.textContent = "connecting...";

  socket.addEventListener("open", () => {
    statusEl.textContent = "online";
    socket.send(JSON.stringify({ type: "hello", playerId: myId }));
  });

  socket.addEventListener("close", () => {
    statusEl.textContent = "offline (reconnecting...)";
    setTimeout(connect, 1000);
  });

  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "state") {
      previousSnapshot = latestSnapshot;
      latestSnapshot = {
        receivedAt: performance.now(),
        players: msg.players || {},
        bullets: msg.bullets || [],
        blocks: msg.blocks || [],
        turrets: msg.turrets || [],
      };

      state.kingId = msg.kingId;
      state.holdMs = msg.holdMs || 0;
      state.bestHoldMs = msg.bestHoldMs || 0;
      state.players = msg.players || {};
      state.bullets = msg.bullets || [];
      state.blocks = msg.blocks || [];
      state.turrets = msg.turrets || [];
      state.radius = msg.arena?.radius || 10;
      state.arenaWidth = msg.arena?.width || state.arenaWidth;
      state.arenaHeight = msg.arena?.height || state.arenaHeight;
      return;
    }

    if (msg.type !== "event") return;
    if (msg.kind === "player_killed") {
      const killer = msg.killerId ? msg.killerId.slice(0, 6) : "map";
      const victim = msg.victimId.slice(0, 6);
      lastFeed = `${killer} killed ${victim}`;
    } else if (msg.kind === "king_killed") {
      lastFeed = `${msg.killerId.slice(0, 6)} killed the king`;
    } else if (msg.kind === "new_king") {
      lastFeed = `${msg.kingId.slice(0, 6)} is the new king`;
    } else if (msg.kind === "block_destroyed") {
      const by = msg.byId ? msg.byId.slice(0, 6) : "unknown";
      lastFeed = `${by} destroyed a block`;
    } else if (msg.kind === "block_placed") {
      lastFeed = `${msg.byId.slice(0, 6)} placed a block`;
    } else if (msg.kind === "turret_placed") {
      lastFeed = `${msg.byId.slice(0, 6)} placed a turret`;
    } else if (msg.kind === "turret_destroyed") {
      const by = msg.byId ? msg.byId.slice(0, 6) : "unknown";
      lastFeed = `${by} destroyed a turret`;
    } else if (msg.kind === "bot_added") {
      lastFeed = `${msg.byId.slice(0, 6)} added ${msg.botId.slice(0, 6)}`;
    } else if (msg.kind === "bot_removed") {
      lastFeed = `${msg.byId.slice(0, 6)} removed ${msg.botId.slice(0, 6)}`;
    } else {
      return;
    }
    lastFeedAt = performance.now();
  });
}

function currentInput() {
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const up = keys.has("ArrowUp") || keys.has("KeyW");
  const down = keys.has("ArrowDown") || keys.has("KeyS");

  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  const dy = (down ? 1 : 0) - (up ? 1 : 0);
  const len = Math.hypot(dx, dy);
  if (!len) return { dx: 0, dy: 0 };
  return { dx: dx / len, dy: dy / len };
}

setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "input", ...currentInput() }));
}, 50);

function toCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

function pointToCell(worldPoint) {
  return {
    cellX: Math.floor(worldPoint.x / GRID_SIZE),
    cellY: Math.floor(worldPoint.y / GRID_SIZE),
  };
}

function cellKey(cellX, cellY) {
  return `${cellX}:${cellY}`;
}

function flushPaint(force = false) {
  if (!queuedCells.size) return;
  const now = performance.now();
  if (!force && now - lastPaintSentAt < PAINT_SEND_MS) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const cells = Array.from(queuedCells).map((key) => {
    const [cellX, cellY] = key.split(":").map(Number);
    return { cellX, cellY };
  });
  queuedCells.clear();
  socket.send(JSON.stringify({ type: "paint_blocks", cells }));
  lastPaintSentAt = now;
}

function enqueuePaintLine(fromCell, toCell) {
  const dx = toCell.cellX - fromCell.cellX;
  const dy = toCell.cellY - fromCell.cellY;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i += 1) {
    const cellX = Math.round(fromCell.cellX + (dx * i) / steps);
    const cellY = Math.round(fromCell.cellY + (dy * i) / steps);
    queuedCells.add(cellKey(cellX, cellY));
  }
}

canvas.addEventListener("mousemove", (event) => {
  mouseScreen = toCanvasPoint(event.clientX, event.clientY);
  if (!isPainting) return;
  const worldMouse = screenToWorld(mouseScreen);
  const currentCell = pointToCell(worldMouse);
  const fromCell = { cellX: paintAnchor.cellX, cellY: paintAnchor.cellY };
  enqueuePaintLine(fromCell, currentCell);
  paintAnchor.cellX = currentCell.cellX;
  paintAnchor.cellY = currentCell.cellY;
  flushPaint(false);
});

canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const screenPoint = toCanvasPoint(event.clientX, event.clientY);
  const worldPoint = screenToWorld(screenPoint);
  const myRole = state.players[myId]?.role;
  const tool = myRole === "king" ? selectedTool : "weapon";

  if (tool === "weapon") {
    socket.send(JSON.stringify({ type: "shoot", aimX: worldPoint.x, aimY: worldPoint.y }));
    return;
  }
  if (tool === "turret") {
    socket.send(JSON.stringify({ type: "place_turret", x: worldPoint.x, y: worldPoint.y }));
    return;
  }
  if (tool === "block") {
    const start = pointToCell(worldPoint);
    paintAnchor.cellX = start.cellX;
    paintAnchor.cellY = start.cellY;
    isPainting = true;
    queuedCells.add(cellKey(start.cellX, start.cellY));
    flushPaint(false);
  }
});

canvas.addEventListener("mouseup", (event) => {
  if (event.button !== 0) return;
  if (!isPainting) return;
  isPainting = false;
  flushPaint(true);
});

canvas.addEventListener("mouseleave", () => {
  if (!isPainting) return;
  isPainting = false;
  flushPaint(true);
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Digit1") selectedTool = "weapon";
  if (event.code === "Digit2") selectedTool = "block";
  if (event.code === "Digit3") selectedTool = "turret";
  if (
    (event.code === "Equal" || event.code === "NumpadAdd") &&
    socket &&
    socket.readyState === WebSocket.OPEN &&
    state.players[myId]?.role === "king"
  ) {
    socket.send(JSON.stringify({ type: "add_bot" }));
  }
  if (
    (event.code === "Minus" || event.code === "NumpadSubtract") &&
    socket &&
    socket.readyState === WebSocket.OPEN &&
    state.players[myId]?.role === "king"
  ) {
    socket.send(JSON.stringify({ type: "remove_bot" }));
  }
  keys.add(event.code);
  if (
    event.code === "KeyE" &&
    socket &&
    socket.readyState === WebSocket.OPEN &&
    state.players[myId]?.role === "king" &&
    selectedTool === "block"
  ) {
    const worldMouse = screenToWorld(mouseScreen);
    socket.send(JSON.stringify({ type: "place_block", x: worldMouse.x, y: worldMouse.y }));
  }
});

document.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

function drawPlayer(id, player) {
  const screen = worldToScreen({ x: player.x, y: player.y });
  if (screen.x < -40 || screen.y < -40 || screen.x > canvas.width + 40 || screen.y > canvas.height + 40) return;

  const isMe = id === myId;
  const isKing = player.role === "king";
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, state.radius, 0, Math.PI * 2);
  ctx.fillStyle = isKing ? "#f7d46c" : "#ff6b6b";
  ctx.fill();

  if (isMe) {
    ctx.strokeStyle = "#f5f7ff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#d9e0ea";
  ctx.font = "12px sans-serif";
  ctx.fillText(id.slice(0, 6), screen.x + state.radius + 4, screen.y - state.radius - 4);

  const hpWidth = 28;
  const hpRatio = Math.max(0, Math.min(1, player.hp / Math.max(1, player.maxHp || 100)));
  ctx.fillStyle = "#27313d";
  ctx.fillRect(screen.x - hpWidth / 2, screen.y + state.radius + 4, hpWidth, 4);
  ctx.fillStyle = hpRatio > 0.4 ? "#79e089" : "#ff9e66";
  ctx.fillRect(screen.x - hpWidth / 2, screen.y + state.radius + 4, hpWidth * hpRatio, 4);
}

function interpolatedEntities(nowMs) {
  if (!latestSnapshot) {
    return { players: state.players, bullets: state.bullets, blocks: state.blocks, turrets: state.turrets };
  }
  if (!previousSnapshot) {
    return {
      players: latestSnapshot.players,
      bullets: latestSnapshot.bullets,
      blocks: latestSnapshot.blocks,
      turrets: latestSnapshot.turrets,
    };
  }

  const latestTime = latestSnapshot.receivedAt;
  const previousTime = previousSnapshot.receivedAt;
  const span = Math.max(1, latestTime - previousTime);
  const t = Math.max(0, Math.min(1, (nowMs - RENDER_LAG_MS - previousTime) / span));

  const players = {};
  const allPlayerIds = new Set([...Object.keys(previousSnapshot.players), ...Object.keys(latestSnapshot.players)]);
  for (const id of allPlayerIds) {
    const from = previousSnapshot.players[id];
    const to = latestSnapshot.players[id];
    if (!from && to) {
      players[id] = { ...to };
      continue;
    }
    if (from && !to) continue;
    players[id] = {
      role: to.role,
      hp: to.hp,
      maxHp: to.maxHp,
      isBot: to.isBot,
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }
  return {
    players,
    bullets: latestSnapshot.bullets.map((bullet) => ({ ...bullet })),
    blocks: latestSnapshot.blocks.map((block) => ({ ...block })),
    turrets: latestSnapshot.turrets.map((turret) => ({ ...turret })),
  };
}

function drawMinimap(entities) {
  const mw = minimapCanvas.width;
  const mh = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, mw, mh);
  minimapCtx.fillStyle = "#101722";
  minimapCtx.fillRect(0, 0, mw, mh);
  minimapCtx.strokeStyle = "#3d4b5f";
  minimapCtx.strokeRect(0.5, 0.5, mw - 1, mh - 1);

  const sx = mw / state.arenaWidth;
  const sy = mh / state.arenaHeight;

  for (const block of entities.blocks) {
    minimapCtx.fillStyle = block.indestructible ? "rgba(220, 220, 220, 0.9)" : "rgba(100, 180, 255, 0.75)";
    minimapCtx.fillRect(block.x * sx - 1.5, block.y * sy - 1.5, 3, 3);
  }

  minimapCtx.fillStyle = "rgba(233, 169, 255, 0.85)";
  for (const turret of entities.turrets) {
    minimapCtx.fillRect(turret.x * sx - 2, turret.y * sy - 2, 4, 4);
  }

  if (state.kingId && entities.players[state.kingId]) {
    const king = entities.players[state.kingId];
    minimapCtx.beginPath();
    minimapCtx.arc(king.x * sx, king.y * sy, 3, 0, Math.PI * 2);
    minimapCtx.fillStyle = "#f7d46c";
    minimapCtx.fill();
  }

  minimapCtx.strokeStyle = "#9cc9ff";
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(camera.x * sx, camera.y * sy, viewWidth() * sx, viewHeight() * sy);
}

function render() {
  const now = performance.now();
  const entities = interpolatedEntities(now);
  const playerEntries = Object.entries(entities.players);
  const me = entities.players[myId];
  updateCamera(me);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#26303d";
  ctx.lineWidth = 2;
  ctx.strokeRect(-camera.x + 1, -camera.y + 1, state.arenaWidth - 2, state.arenaHeight - 2);

  for (const block of entities.blocks) {
    const screen = worldToScreen({ x: block.x, y: block.y });
    const size = block.size || GRID_SIZE;
    if (screen.x < -size || screen.y < -size || screen.x > canvas.width + size || screen.y > canvas.height + size) continue;
    const hpRatio = Math.max(0, Math.min(1, block.hp / Math.max(1, block.maxHp || 100)));
    if (block.indestructible) {
      ctx.fillStyle = "rgba(190, 190, 190, 0.9)";
      ctx.strokeStyle = "#f0f0f0";
    } else {
      ctx.fillStyle = `rgba(100, 180, 255, ${0.35 + 0.45 * hpRatio})`;
      ctx.strokeStyle = "#8dc4ff";
    }
    ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
    ctx.strokeRect(screen.x - size / 2, screen.y - size / 2, size, size);
  }

  for (const turret of entities.turrets) {
    const screen = worldToScreen({ x: turret.x, y: turret.y });
    const size = turret.size || GRID_SIZE;
    if (screen.x < -size || screen.y < -size || screen.x > canvas.width + size || screen.y > canvas.height + size) continue;
    const hpRatio = Math.max(0, Math.min(1, turret.hp / Math.max(1, turret.maxHp || 100)));
    ctx.fillStyle = `rgba(243, 164, 255, ${0.35 + 0.45 * hpRatio})`;
    ctx.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
    ctx.strokeStyle = "#e9a9ff";
    ctx.strokeRect(screen.x - size / 2, screen.y - size / 2, size, size);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe0ff";
    ctx.fill();
  }

  for (const bullet of entities.bullets) {
    const screen = worldToScreen({ x: bullet.x, y: bullet.y });
    if (screen.x < -10 || screen.y < -10 || screen.x > canvas.width + 10 || screen.y > canvas.height + 10) continue;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd56b";
    ctx.fill();
  }

  for (const [id, player] of playerEntries) {
    drawPlayer(id, player);
  }

  const myRole = state.players[myId]?.role || "-";
  roleEl.textContent = `role: ${myRole}`;
  kingEl.textContent = `king: ${state.kingId ? state.kingId.slice(0, 8) : "-"}`;
  holdEl.textContent = `hold: ${formatMs(state.holdMs)}`;
  bestEl.textContent = `best: ${formatMs(state.bestHoldMs)}`;
  playersEl.textContent = `players: ${playerEntries.length}`;
  toolEl.textContent = `tool: ${myRole === "king" ? selectedTool : "weapon"}`;

  if (me) {
    const meScreen = worldToScreen({ x: me.x, y: me.y });
    ctx.beginPath();
    ctx.moveTo(meScreen.x, meScreen.y);
    ctx.lineTo(mouseScreen.x, mouseScreen.y);
    ctx.strokeStyle = "rgba(156, 201, 255, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (now - lastFeedAt < 1800 && lastFeed) {
    ctx.fillStyle = "#9cc9ff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(lastFeed, 20, canvas.height - 24);
  }

  drawMinimap(entities);
  requestAnimationFrame(render);
}

connect();
requestAnimationFrame(render);
