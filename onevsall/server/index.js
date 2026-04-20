const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const BASE_PORT = Number(process.env.PORT || 8080);
const MAX_PORT_RETRIES = 20;
const TICK_MS = 16;
const ARENA_WIDTH = 2400;
const ARENA_HEIGHT = 1400;
const PLAYER_RADIUS = 10;
const MOVE_SPEED = 190;

const SHOOT_COOLDOWN_MS = 180;
const BULLET_SPEED = 560;
const BULLET_RADIUS = 4;
const BULLET_TTL_MS = 1600;
const BULLET_DAMAGE = 25;

const PLAYER_MAX_HP = 100;
const KING_MAX_HP = PLAYER_MAX_HP * 3;
const RESPAWN_INVULN_MS = 550;
const KING_PROMOTE_INVULN_MS = 250;
const SPAWN_INSET = 40;
const RESPAWN_SAMPLES = 28;

const GRID_SIZE = 26;
const BLOCK_SIZE = GRID_SIZE;
const BLOCK_MAX_HP = 100;
const BLOCK_PLACE_COOLDOWN_MS = 120;
const PAINT_BATCH_LIMIT = 140;
const TURRET_SIZE = GRID_SIZE;
const TURRET_MAX_HP = 100;
const TURRET_RANGE = 240;
const TURRET_FIRE_COOLDOWN_MS = 420;
const TURRET_DAMAGE = 12;
const TURRET_PLACEMENT_COOLDOWN_MS = 220;
const DEFAULT_MAP_FILE = path.resolve(__dirname, "../maps/default-map.json");
const BOT_FIRE_RANGE = 320;
const BOT_OBSTRUCTION_LANE_PADDING = 8;
const BOT_KING_STANDOFF = PLAYER_RADIUS * 2;
const BOT_NAV_INF = 1e15;

const WEB_ROOT = path.resolve(__dirname, "..");
const clients = new Map();
const bullets = [];
const blocks = [];
const turrets = [];

let kingId = null;
let kingSince = Date.now();
let bestHoldMs = 0;
let nextBulletId = 1;
let nextBlockId = 1;
let nextTurretId = 1;
let nextBotId = 1;

function sanitizeMapPayload(input) {
  const maxCellX = Math.floor((ARENA_WIDTH - 1) / GRID_SIZE);
  const maxCellY = Math.floor((ARENA_HEIGHT - 1) / GRID_SIZE);
  const source = input && typeof input === "object" ? input : {};
  const permanentBlocks = Array.isArray(source.permanentBlocks) ? source.permanentBlocks : [];
  const damageableBlocks = Array.isArray(source.damageableBlocks) ? source.damageableBlocks : [];
  const seen = new Set();

  const sanitizedPermanent = [];
  for (const block of permanentBlocks) {
    const cellX = clampInt(Number(block?.cellX), 0, maxCellX);
    const cellY = clampInt(Number(block?.cellY), 0, maxCellY);
    if (!Number.isFinite(cellX) || !Number.isFinite(cellY)) continue;
    const key = `${cellX}:${cellY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sanitizedPermanent.push({ cellX, cellY });
  }

  const sanitizedDamageable = [];
  for (const block of damageableBlocks) {
    const cellX = clampInt(Number(block?.cellX), 0, maxCellX);
    const cellY = clampInt(Number(block?.cellY), 0, maxCellY);
    if (!Number.isFinite(cellX) || !Number.isFinite(cellY)) continue;
    const key = `${cellX}:${cellY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hpRaw = Number(block?.hp);
    const hp = Number.isFinite(hpRaw) ? clampInt(hpRaw, 1, BLOCK_MAX_HP) : BLOCK_MAX_HP;
    sanitizedDamageable.push({ cellX, cellY, hp });
  }

  return {
    gridSize: GRID_SIZE,
    permanentBlocks: sanitizedPermanent,
    damageableBlocks: sanitizedDamageable,
  };
}

function loadDefaultMap() {
  try {
    if (!fs.existsSync(DEFAULT_MAP_FILE)) return;
    const raw = fs.readFileSync(DEFAULT_MAP_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const permanent = Array.isArray(parsed.permanentBlocks) ? parsed.permanentBlocks : [];
    const damageable = Array.isArray(parsed.damageableBlocks) ? parsed.damageableBlocks : [];
    const all = [
      ...permanent.map((b) => ({ ...b, indestructible: true, kind: "permanent" })),
      ...damageable.map((b) => ({ ...b, indestructible: false, kind: "damageable", hp: b.hp })),
    ];
    for (const block of all) {
      const cellX = clampInt(Number(block.cellX), 0, Math.floor((ARENA_WIDTH - 1) / GRID_SIZE));
      const cellY = clampInt(Number(block.cellY), 0, Math.floor((ARENA_HEIGHT - 1) / GRID_SIZE));
      if (!Number.isFinite(cellX) || !Number.isFinite(cellY)) continue;
      if (blocks.some((b) => b.cellX === cellX && b.cellY === cellY)) continue;
      const world = cellToWorld(cellX, cellY);
      blocks.push({
        id: nextBlockId++,
        cellX,
        cellY,
        x: world.x,
        y: world.y,
        size: BLOCK_SIZE,
        hp: block.indestructible ? Number.MAX_SAFE_INTEGER : block.hp || BLOCK_MAX_HP,
        maxHp: block.indestructible ? Number.MAX_SAFE_INTEGER : block.hp || BLOCK_MAX_HP,
        ownerId: "map",
        indestructible: !!block.indestructible,
        kind: block.kind,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed loading default map:", err.message);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomSpawnPoint() {
  return {
    x: SPAWN_INSET + Math.random() * (ARENA_WIDTH - SPAWN_INSET * 2),
    y: SPAWN_INSET + Math.random() * (ARENA_HEIGHT - SPAWN_INSET * 2),
  };
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function worldToCell(x, y) {
  const cellX = clampInt(Math.floor(Number(x) / GRID_SIZE), 0, Math.floor((ARENA_WIDTH - 1) / GRID_SIZE));
  const cellY = clampInt(Math.floor(Number(y) / GRID_SIZE), 0, Math.floor((ARENA_HEIGHT - 1) / GRID_SIZE));
  return { cellX, cellY };
}

function cellToWorld(cellX, cellY) {
  return {
    x: cellX * GRID_SIZE + GRID_SIZE / 2,
    y: cellY * GRID_SIZE + GRID_SIZE / 2,
  };
}

function cellKey(cellX, cellY) {
  return `${cellX}:${cellY}`;
}

function normalizeInput(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (!length) return { dx: 0, dy: 0 };
  if (length <= 1) return { dx, dy };
  return { dx: dx / length, dy: dy / length };
}

function findPlayerById(id) {
  return Array.from(clients.values()).find((player) => player.id === id) || null;
}

function sendEvent(event) {
  const payload = JSON.stringify({ type: "event", ...event });
  for (const { socket } of clients.values()) {
    if (socket && socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function pointInsideAabb(x, y, radius, box) {
  const closestX = clamp(x, box.left, box.right);
  const closestY = clamp(y, box.top, box.bottom);
  return Math.hypot(x - closestX, y - closestY) <= radius;
}

function spawnPointIsSafe(spawnX, spawnY, player) {
  const radius = PLAYER_RADIUS;
  for (const block of blocks) {
    if (pointInsideAabb(spawnX, spawnY, radius, toAabb(block.x, block.y, block.size))) return false;
  }
  for (const turret of turrets) {
    if (pointInsideAabb(spawnX, spawnY, radius, toAabb(turret.x, turret.y, turret.size))) return false;
  }
  for (const other of clients.values()) {
    if (other === player) continue;
    if (Math.hypot(other.x - spawnX, other.y - spawnY) < PLAYER_RADIUS * 2) return false;
  }
  return true;
}

function findSafeSpawnPoint(player) {
  for (let i = 0; i < RESPAWN_SAMPLES; i += 1) {
    const candidate = randomSpawnPoint();
    if (spawnPointIsSafe(candidate.x, candidate.y, player)) return candidate;
  }
  return null;
}

function applySpawn(player) {
  const safePoint = findSafeSpawnPoint(player);
  const point = safePoint || randomSpawnPoint();
  player.x = point.x;
  player.y = point.y;
}

function resetPlayerCombat(player, now) {
  player.hp = player.maxHp;
  player.invulnerableUntil = now + RESPAWN_INVULN_MS;
  player.input = { dx: 0, dy: 0 };
}

function updateBestHold(now) {
  if (!kingId) return;
  bestHoldMs = Math.max(bestHoldMs, now - kingSince);
}

function promoteToKing(playerId, reason = "promotion", stayInPlace = false) {
  const now = Date.now();
  const nextKing = findPlayerById(playerId);
  if (!nextKing) return;

  if (kingId && kingId !== nextKing.id) {
    updateBestHold(now);
    const oldKing = findPlayerById(kingId);
    if (oldKing) {
      oldKing.role = "sieger";
      oldKing.maxHp = PLAYER_MAX_HP;
      oldKing.hp = Math.min(oldKing.hp, oldKing.maxHp);
    }
  }

  kingId = nextKing.id;
  kingSince = now;
  nextKing.role = "king";
  nextKing.maxHp = KING_MAX_HP;
  nextKing.hp = KING_MAX_HP;
  nextKing.invulnerableUntil = now + (stayInPlace ? KING_PROMOTE_INVULN_MS : RESPAWN_INVULN_MS);
  if (!stayInPlace) applySpawn(nextKing);

  sendEvent({ kind: "new_king", kingId: nextKing.id, reason });
}

function ensureKingExists() {
  if (kingId && findPlayerById(kingId)) return;
  const players = Array.from(clients.values());
  if (!players.length) {
    kingId = null;
    return;
  }
  players.sort((a, b) => a.joinedAt - b.joinedAt);
  promoteToKing(players[0].id, "fallback");
}

function respawnAsSieger(player, now) {
  player.role = "sieger";
  player.maxHp = PLAYER_MAX_HP;
  applySpawn(player);
  resetPlayerCombat(player, now);
}

function handleDeath(victim, killerId, now) {
  if (!victim) return;
  const killer = killerId ? findPlayerById(killerId) : null;

  sendEvent({
    kind: "player_killed",
    victimId: victim.id,
    killerId: killer ? killer.id : null,
    wasKing: victim.id === kingId,
  });

  if (victim.id === kingId && killer && killer.id !== victim.id) {
    sendEvent({ kind: "king_killed", killerId: killer.id, oldKingId: victim.id });
    promoteToKing(killer.id, "king_killed", true);
  }

  respawnAsSieger(victim, now);
}

function makeStatePayload() {
  const now = Date.now();
  const players = {};
  for (const player of clients.values()) {
    players[player.id] = {
      x: Number(player.x.toFixed(1)),
      y: Number(player.y.toFixed(1)),
      role: player.role,
      hp: player.hp,
      maxHp: player.maxHp,
      invulnerable: now < player.invulnerableUntil,
      isBot: !!player.isBot,
    };
  }

  return {
    type: "state",
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT, radius: PLAYER_RADIUS },
    kingId,
    holdMs: kingId ? now - kingSince : 0,
    bestHoldMs,
    serverTime: now,
    bullets: bullets.map((bullet) => ({
      id: bullet.id,
      x: Number(bullet.x.toFixed(1)),
      y: Number(bullet.y.toFixed(1)),
    })),
    blocks: blocks.map((block) => ({
      id: block.id,
      cellX: block.cellX,
      cellY: block.cellY,
      x: Number(block.x.toFixed(1)),
      y: Number(block.y.toFixed(1)),
      size: block.size,
      hp: block.hp,
      maxHp: block.maxHp,
      ownerId: block.ownerId,
      indestructible: !!block.indestructible,
      kind: block.kind || "damageable",
    })),
    turrets: turrets.map((turret) => ({
      id: turret.id,
      cellX: turret.cellX,
      cellY: turret.cellY,
      x: Number(turret.x.toFixed(1)),
      y: Number(turret.y.toFixed(1)),
      size: turret.size,
      hp: turret.hp,
      maxHp: turret.maxHp,
      ownerId: turret.ownerId,
    })),
    players,
  };
}

function broadcastState() {
  const payload = JSON.stringify(makeStatePayload());
  for (const { socket } of clients.values()) {
    if (socket && socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function spawnBullet(owner, aimX, aimY) {
  const dx = Number(aimX) - owner.x;
  const dy = Number(aimY) - owner.y;
  const norm = normalizeInput(dx, dy);
  if (!norm.dx && !norm.dy) return;

  bullets.push({
    id: nextBulletId,
    ownerId: owner.id,
    x: owner.x + norm.dx * (PLAYER_RADIUS + BULLET_RADIUS + 2),
    y: owner.y + norm.dy * (PLAYER_RADIUS + BULLET_RADIUS + 2),
    vx: norm.dx * BULLET_SPEED,
    vy: norm.dy * BULLET_SPEED,
    damage: BULLET_DAMAGE,
    source: "player",
    bornAt: Date.now(),
  });
  nextBulletId += 1;
}

function playerCanPlaceBlock(player) {
  return !!player && player.id === kingId;
}

function findBlockAtCell(cellX, cellY) {
  return blocks.find((b) => b.cellX === cellX && b.cellY === cellY) || null;
}

function findTurretAtCell(cellX, cellY) {
  return turrets.find((t) => t.cellX === cellX && t.cellY === cellY) || null;
}

function isCellBlockedByPlayer(cellX, cellY) {
  const world = cellToWorld(cellX, cellY);
  for (const p of clients.values()) {
    if (Math.hypot(p.x - world.x, p.y - world.y) < PLAYER_RADIUS + GRID_SIZE * 0.45) {
      return true;
    }
  }
  return false;
}

function canPlaceAtCell(cellX, cellY) {
  if (cellX < 0 || cellY < 0) return false;
  if (cellX > Math.floor((ARENA_WIDTH - 1) / GRID_SIZE)) return false;
  if (cellY > Math.floor((ARENA_HEIGHT - 1) / GRID_SIZE)) return false;
  if (findBlockAtCell(cellX, cellY) || findTurretAtCell(cellX, cellY)) return false;
  if (isCellBlockedByPlayer(cellX, cellY)) return false;
  return true;
}

function placeBlockAtCell(player, cellX, cellY, now) {
  if (!playerCanPlaceBlock(player)) return false;
  if (!canPlaceAtCell(cellX, cellY)) return false;
  const world = cellToWorld(cellX, cellY);

  const block = {
    id: nextBlockId,
    cellX,
    cellY,
    x: world.x,
    y: world.y,
    size: BLOCK_SIZE,
    hp: BLOCK_MAX_HP,
    maxHp: BLOCK_MAX_HP,
    ownerId: player.id,
    indestructible: false,
    kind: "damageable",
  };
  nextBlockId += 1;
  blocks.push(block);
  player.lastBlockAt = now;
  sendEvent({ kind: "block_placed", byId: player.id, blockId: block.id });
  return true;
}

function placeBlock(player, x, y, now) {
  if (!playerCanPlaceBlock(player)) return;
  if (now - player.lastBlockAt < BLOCK_PLACE_COOLDOWN_MS) return;
  const { cellX, cellY } = worldToCell(x, y);
  placeBlockAtCell(player, cellX, cellY, now);
}

function paintBlocks(player, cells, now) {
  if (!playerCanPlaceBlock(player)) return;
  if (!Array.isArray(cells) || !cells.length) return;
  if (now - player.lastBlockAt < BLOCK_PLACE_COOLDOWN_MS) return;

  const seen = new Set();
  let placed = 0;
  for (const cell of cells.slice(0, PAINT_BATCH_LIMIT)) {
    const cx = Number(cell.cellX);
    const cy = Number(cell.cellY);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    const cellX = clampInt(cx, 0, Math.floor((ARENA_WIDTH - 1) / GRID_SIZE));
    const cellY = clampInt(cy, 0, Math.floor((ARENA_HEIGHT - 1) / GRID_SIZE));
    const key = cellKey(cellX, cellY);
    if (seen.has(key)) continue;
    seen.add(key);
    if (placeBlockAtCell(player, cellX, cellY, now)) {
      placed += 1;
    }
  }
  if (placed > 0) {
    player.lastBlockAt = now;
  }
}

function placeTurret(player, x, y, now) {
  if (!player || player.id !== kingId) return;
  if (now - player.lastTurretAt < TURRET_PLACEMENT_COOLDOWN_MS) return;
  const { cellX, cellY } = worldToCell(x, y);
  if (!canPlaceAtCell(cellX, cellY)) return;
  const world = cellToWorld(cellX, cellY);
  const turret = {
    id: nextTurretId,
    ownerId: player.id,
    cellX,
    cellY,
    x: world.x,
    y: world.y,
    size: TURRET_SIZE,
    hp: TURRET_MAX_HP,
    maxHp: TURRET_MAX_HP,
    range: TURRET_RANGE,
    lastShotAt: 0,
  };
  nextTurretId += 1;
  turrets.push(turret);
  player.lastTurretAt = now;
  sendEvent({ kind: "turret_placed", byId: player.id, turretId: turret.id });
}

function spawnTurretBullet(turret, target, now) {
  const dir = normalizeInput(target.x - turret.x, target.y - turret.y);
  bullets.push({
    id: nextBulletId,
    ownerId: turret.ownerId,
    x: turret.x + dir.dx * (TURRET_SIZE / 2),
    y: turret.y + dir.dy * (TURRET_SIZE / 2),
    vx: dir.dx * BULLET_SPEED * 0.9,
    vy: dir.dy * BULLET_SPEED * 0.9,
    damage: TURRET_DAMAGE,
    source: "turret",
    bornAt: now,
  });
  nextBulletId += 1;
}

function toAabb(x, y, size) {
  const half = size / 2;
  return {
    left: x - half,
    right: x + half,
    top: y - half,
    bottom: y + half,
  };
}

function getSolidBlockBounds() {
  return blocks.map((block) => toAabb(block.x, block.y, block.size));
}

function getCollisionSolidsForPlayer(player) {
  const solids = [];
  for (const block of blocks) {
    // Damageable blocks are walls for bots too.
    solids.push(toAabb(block.x, block.y, block.size));
  }
  if (player.isBot) {
    for (const turret of turrets) {
      solids.push(toAabb(turret.x, turret.y, turret.size));
    }
  }
  return solids;
}

function navGridSize() {
  return {
    cols: Math.floor((ARENA_WIDTH - 1) / GRID_SIZE) + 1,
    rows: Math.floor((ARENA_HEIGHT - 1) / GRID_SIZE) + 1,
  };
}

function navCellIndex(cellX, cellY, cols) {
  return cellY * cols + cellX;
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent].cost <= heap[i].cost) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}

function heapPop(heap) {
  if (!heap.length) return null;
  const top = heap[0];
  const last = heap.pop();
  if (!heap.length) return top;
  heap[0] = last;
  let i = 0;
  for (;;) {
    const left = i * 2 + 1;
    const right = left + 1;
    let smallest = i;
    if (left < heap.length && heap[left].cost < heap[smallest].cost) smallest = left;
    if (right < heap.length && heap[right].cost < heap[smallest].cost) smallest = right;
    if (smallest === i) break;
    [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
    i = smallest;
  }
  return top;
}

function buildBotNavigationField(king) {
  const { cols, rows } = navGridSize();
  const size = cols * rows;
  const permanent = new Uint8Array(size);
  const damageableHp = new Int32Array(size);
  const turretHp = new Int32Array(size);
  const traversalCost = new Float64Array(size);

  for (const block of blocks) {
    const index = navCellIndex(block.cellX, block.cellY, cols);
    if (block.indestructible) {
      permanent[index] = 1;
    } else {
      damageableHp[index] = Math.max(damageableHp[index], block.hp || BLOCK_MAX_HP);
    }
  }
  for (const turret of turrets) {
    const index = navCellIndex(turret.cellX, turret.cellY, cols);
    turretHp[index] = Math.max(turretHp[index], turret.hp || TURRET_MAX_HP);
  }

  for (let i = 0; i < size; i += 1) {
    if (permanent[i]) {
      traversalCost[i] = BOT_NAV_INF;
      continue;
    }
    const blockPenalty = damageableHp[i] > 0 ? 6 + Math.ceil(damageableHp[i] / BULLET_DAMAGE) * 2 : 0;
    const turretPenalty = turretHp[i] > 0 ? 8 + Math.ceil(turretHp[i] / BULLET_DAMAGE) * 3 : 0;
    traversalCost[i] = 1 + blockPenalty + turretPenalty;
  }

  const kingCell = worldToCell(king.x, king.y);
  const kingCellIndex = navCellIndex(kingCell.cellX, kingCell.cellY, cols);
  permanent[kingCellIndex] = 0;
  traversalCost[kingCellIndex] = 1;

  const dist = new Float64Array(size);
  dist.fill(BOT_NAV_INF);
  const heap = [];
  dist[kingCellIndex] = 0;
  heapPush(heap, { index: kingCellIndex, cost: 0 });

  while (heap.length) {
    const current = heapPop(heap);
    if (!current) break;
    const index = current.index;
    if (current.cost !== dist[index]) continue;
    const cellX = index % cols;
    const cellY = Math.floor(index / cols);

    const neighbors = [];
    if (cellX > 0) neighbors.push(index - 1);
    if (cellX < cols - 1) neighbors.push(index + 1);
    if (cellY > 0) neighbors.push(index - cols);
    if (cellY < rows - 1) neighbors.push(index + cols);

    for (const ni of neighbors) {
      if (permanent[ni]) continue;
      const nextDist = current.cost + traversalCost[ni];
      if (nextDist >= dist[ni]) continue;
      dist[ni] = nextDist;
      heapPush(heap, { index: ni, cost: nextDist });
    }
  }

  return { cols, rows, permanent, dist };
}

function botRingAnchor(botId, kingX, kingY) {
  let hash = 0;
  for (let i = 0; i < botId.length; i += 1) {
    hash = (hash * 31 + botId.charCodeAt(i)) >>> 0;
  }
  const angle = (hash % 360) * (Math.PI / 180);
  return {
    x: kingX + Math.cos(angle) * BOT_KING_STANDOFF,
    y: kingY + Math.sin(angle) * BOT_KING_STANDOFF,
  };
}

function chooseBotStepTarget(bot, king, nav) {
  const botCell = worldToCell(bot.x, bot.y);
  const { cols, permanent, dist } = nav;
  const currentIndex = navCellIndex(botCell.cellX, botCell.cellY, cols);
  let bestIndex = currentIndex;
  let bestDist = dist[currentIndex];

  const neighbors = [];
  if (botCell.cellX > 0) neighbors.push({ cellX: botCell.cellX - 1, cellY: botCell.cellY });
  if (botCell.cellX < cols - 1) neighbors.push({ cellX: botCell.cellX + 1, cellY: botCell.cellY });
  if (botCell.cellY > 0) neighbors.push({ cellX: botCell.cellX, cellY: botCell.cellY - 1 });
  if (botCell.cellY < nav.rows - 1) neighbors.push({ cellX: botCell.cellX, cellY: botCell.cellY + 1 });

  for (const n of neighbors) {
    const ni = navCellIndex(n.cellX, n.cellY, cols);
    if (permanent[ni]) continue;
    const nd = dist[ni];
    if (!Number.isFinite(nd) || nd >= BOT_NAV_INF) continue;
    if (!Number.isFinite(bestDist) || bestDist >= BOT_NAV_INF || nd < bestDist) {
      bestDist = nd;
      bestIndex = ni;
    }
  }

  if (!Number.isFinite(bestDist) || bestDist >= BOT_NAV_INF || bestIndex === currentIndex) {
    return { x: king.x, y: king.y };
  }
  const targetCellX = bestIndex % cols;
  const targetCellY = Math.floor(bestIndex / cols);
  return cellToWorld(targetCellX, targetCellY);
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 0.0001) return Math.hypot(px - ax, py - ay);
  const t = clamp((apx * abx + apy * aby) / abLenSq, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function projectedBotStep(bot, inputDir) {
  return {
    x: bot.x + inputDir.dx * GRID_SIZE * 2.6,
    y: bot.y + inputDir.dy * GRID_SIZE * 2.6,
  };
}

function obstructionAtStepTarget(stepTarget) {
  const stepCell = worldToCell(stepTarget.x, stepTarget.y);
  const block = findBlockAtCell(stepCell.cellX, stepCell.cellY);
  if (block && !block.indestructible) return { priority: 0, x: block.x, y: block.y, range: 0 };
  const turret = findTurretAtCell(stepCell.cellX, stepCell.cellY);
  if (turret) return { priority: 1, x: turret.x, y: turret.y, range: 0 };
  return null;
}

function findBotObstructionTarget(bot, inputDir, projectedStep) {
  if (!inputDir.dx && !inputDir.dy) return null;
  const candidates = [];
  for (const block of blocks) {
    if (block.indestructible) continue;
    const to = normalizeInput(block.x - bot.x, block.y - bot.y);
    const facing = inputDir.dx * to.dx + inputDir.dy * to.dy;
    if (facing < 0.45) continue;
    const range = Math.hypot(block.x - bot.x, block.y - bot.y);
    if (range > BOT_FIRE_RANGE) continue;
    const laneDist = pointToSegmentDistance(block.x, block.y, bot.x, bot.y, projectedStep.x, projectedStep.y);
    if (laneDist > block.size * 0.5 + BOT_OBSTRUCTION_LANE_PADDING) continue;
    candidates.push({ priority: 0, range, x: block.x, y: block.y });
  }

  for (const turret of turrets) {
    const to = normalizeInput(turret.x - bot.x, turret.y - bot.y);
    const facing = inputDir.dx * to.dx + inputDir.dy * to.dy;
    if (facing < 0.3) continue;
    const range = Math.hypot(turret.x - bot.x, turret.y - bot.y);
    if (range > BOT_FIRE_RANGE) continue;
    const laneDist = pointToSegmentDistance(turret.x, turret.y, bot.x, bot.y, projectedStep.x, projectedStep.y);
    if (laneDist > turret.size * 0.5 + BOT_OBSTRUCTION_LANE_PADDING + 3) continue;
    candidates.push({ priority: 1, range, x: turret.x, y: turret.y });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.priority - b.priority || a.range - b.range);
  return candidates[0];
}

function resolvePlayerCollision(player, nextX, nextY, solids) {
  let x = clamp(nextX, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS);
  let y = clamp(nextY, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS);
  for (const box of solids) {
    const overlapsX = x + PLAYER_RADIUS > box.left && x - PLAYER_RADIUS < box.right;
    const overlapsY = y + PLAYER_RADIUS > box.top && y - PLAYER_RADIUS < box.bottom;
    if (!(overlapsX && overlapsY)) continue;

    const pushLeft = Math.abs(x + PLAYER_RADIUS - box.left);
    const pushRight = Math.abs(box.right - (x - PLAYER_RADIUS));
    const pushUp = Math.abs(y + PLAYER_RADIUS - box.top);
    const pushDown = Math.abs(box.bottom - (y - PLAYER_RADIUS));
    const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown);

    if (minPush === pushLeft) x = box.left - PLAYER_RADIUS;
    else if (minPush === pushRight) x = box.right + PLAYER_RADIUS;
    else if (minPush === pushUp) y = box.top - PLAYER_RADIUS;
    else y = box.bottom + PLAYER_RADIUS;

    x = clamp(x, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS);
    y = clamp(y, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS);
  }
  return { x, y };
}

function addBot(controllerId) {
  const id = `bot-${nextBotId}`;
  nextBotId += 1;
  const bot = {
    id,
    socket: null,
    isBot: true,
    controllerId,
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    input: { dx: 0, dy: 0 },
    role: "sieger",
    joinedAt: Date.now(),
    lastShotAt: 0,
    lastBlockAt: 0,
    lastTurretAt: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    invulnerableUntil: 0,
  };
  applySpawn(bot);
  resetPlayerCombat(bot, Date.now());
  clients.set(`bot:${id}`, bot);
  sendEvent({ kind: "bot_added", botId: id, byId: controllerId });
}

function removeBot(controllerId) {
  const bots = Array.from(clients.entries())
    .map(([key, p]) => ({ key, p }))
    .filter(({ p }) => p.isBot)
    .sort((a, b) => b.p.joinedAt - a.p.joinedAt);
  if (!bots.length) return;
  const victim = bots[0];
  const wasKing = victim.p.id === kingId;
  clients.delete(victim.key);
  sendEvent({ kind: "bot_removed", botId: victim.p.id, byId: controllerId });
  if (wasKing) ensureKingExists();
}

function tickBots(now) {
  const king = kingId ? findPlayerById(kingId) : null;
  const nav = king ? buildBotNavigationField(king) : null;
  for (const bot of clients.values()) {
    if (!bot.isBot) continue;
    if (!king || bot.id === king.id) {
      bot.input = { dx: 0, dy: 0 };
      continue;
    }
    const distanceToKing = Math.hypot(king.x - bot.x, king.y - bot.y);
    const stepTarget = chooseBotStepTarget(bot, king, nav);
    let desiredMove;
    if (distanceToKing <= BOT_KING_STANDOFF) {
      desiredMove = { dx: 0, dy: 0 };
    } else {
      // Always follow weighted path target so bots prefer true shortest route
      // (open path first, then break-through path) instead of hugging king LOS.
      desiredMove = normalizeInput(stepTarget.x - bot.x, stepTarget.y - bot.y);
    }
    bot.input = desiredMove;

    if (now - bot.lastShotAt >= SHOOT_COOLDOWN_MS) {
      const directStepObstruction = obstructionAtStepTarget(stepTarget);
      if (directStepObstruction && Math.hypot(directStepObstruction.x - bot.x, directStepObstruction.y - bot.y) <= BOT_FIRE_RANGE) {
        bot.lastShotAt = now;
        spawnBullet(bot, directStepObstruction.x, directStepObstruction.y);
        continue;
      }
      const projectedStep = projectedBotStep(bot, desiredMove);
      const obstruction = findBotObstructionTarget(bot, desiredMove, projectedStep);
      if (obstruction) {
        bot.lastShotAt = now;
        spawnBullet(bot, obstruction.x, obstruction.y);
        continue;
      }

      const distance = Math.hypot(king.x - bot.x, king.y - bot.y);
      if (distance < BOT_FIRE_RANGE) {
        bot.lastShotAt = now;
        spawnBullet(bot, king.x, king.y);
      }
    }
  }
}

function tickTurrets(now) {
  for (const turret of turrets) {
    if (now - turret.lastShotAt < TURRET_FIRE_COOLDOWN_MS) continue;
    let nearest = null;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (const p of clients.values()) {
      if (p.role === "king") continue;
      if (now < p.invulnerableUntil) continue;
      const dist = Math.hypot(p.x - turret.x, p.y - turret.y);
      if (dist > turret.range) continue;
      if (!hasLineOfSight(turret.x, turret.y, p.x, p.y)) continue;
      if (dist < nearestDist) {
        nearest = p;
        nearestDist = dist;
      }
    }
    if (!nearest) continue;
    turret.lastShotAt = now;
    spawnTurretBullet(turret, nearest, now);
  }
}

function hasLineOfSight(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(4, GRID_SIZE / 2);
  const count = Math.max(1, Math.ceil(steps));
  for (let i = 1; i < count; i += 1) {
    const t = i / count;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const cell = worldToCell(x, y);
    const blocker = findBlockAtCell(cell.cellX, cell.cellY);
    if (blocker) return false;
  }
  return true;
}

function bulletHitsBlock(bullet, block) {
  const half = block.size / 2;
  const closestX = clamp(bullet.x, block.x - half, block.x + half);
  const closestY = clamp(bullet.y, block.y - half, block.y + half);
  return Math.hypot(bullet.x - closestX, bullet.y - closestY) <= BULLET_RADIUS;
}

function bulletHitsTurret(bullet, turret) {
  const half = turret.size / 2;
  const closestX = clamp(bullet.x, turret.x - half, turret.x + half);
  const closestY = clamp(bullet.y, turret.y - half, turret.y + half);
  return Math.hypot(bullet.x - closestX, bullet.y - closestY) <= BULLET_RADIUS;
}

function handleBullets(now) {
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const bullet = bullets[i];
    bullet.x += bullet.vx * (TICK_MS / 1000);
    bullet.y += bullet.vy * (TICK_MS / 1000);

    const outOfBounds =
      bullet.x < -BULLET_RADIUS ||
      bullet.y < -BULLET_RADIUS ||
      bullet.x > ARENA_WIDTH + BULLET_RADIUS ||
      bullet.y > ARENA_HEIGHT + BULLET_RADIUS;
    if (outOfBounds || now - bullet.bornAt > BULLET_TTL_MS) {
      bullets.splice(i, 1);
      continue;
    }

    let consumed = false;
    for (let b = blocks.length - 1; b >= 0; b -= 1) {
      const block = blocks[b];
      if (!bulletHitsBlock(bullet, block)) continue;
      bullets.splice(i, 1);
      consumed = true;
      // Turret bullets are blocked by walls but do not damage them.
      if (bullet.source !== "turret" && !block.indestructible) {
        block.hp = Math.max(0, block.hp - (bullet.damage || BULLET_DAMAGE));
        if (block.hp <= 0) {
          blocks.splice(b, 1);
          sendEvent({ kind: "block_destroyed", blockId: block.id, byId: bullet.ownerId, ownerId: block.ownerId });
        }
      }
      break;
    }
    if (consumed) continue;

    for (let t = turrets.length - 1; t >= 0; t -= 1) {
      const turret = turrets[t];
      if (bullet.source === "turret") continue;
      if (!bulletHitsTurret(bullet, turret)) continue;
      turret.hp = Math.max(0, turret.hp - (bullet.damage || BULLET_DAMAGE));
      bullets.splice(i, 1);
      consumed = true;
      if (turret.hp <= 0) {
        turrets.splice(t, 1);
        sendEvent({ kind: "turret_destroyed", turretId: turret.id, byId: bullet.ownerId, ownerId: turret.ownerId });
      }
      break;
    }
    if (consumed) continue;

    for (const target of clients.values()) {
      if (target.id === bullet.ownerId) continue;
      if (now < target.invulnerableUntil) continue;
      const distance = Math.hypot(target.x - bullet.x, target.y - bullet.y);
      if (distance > PLAYER_RADIUS + BULLET_RADIUS) continue;

      target.hp = Math.max(0, target.hp - (bullet.damage || BULLET_DAMAGE));
      bullets.splice(i, 1);
      consumed = true;
      if (target.hp <= 0) {
        handleDeath(target, bullet.ownerId, now);
      }
      break;
    }
    if (consumed) continue;
  }
}

function gameTick() {
  const now = Date.now();
  const dt = TICK_MS / 1000;
  tickBots(now);
  for (const player of clients.values()) {
    const solids = getCollisionSolidsForPlayer(player);
    const nextX = player.x + player.input.dx * MOVE_SPEED * dt;
    const nextY = player.y + player.input.dy * MOVE_SPEED * dt;
    const resolved = resolvePlayerCollision(player, nextX, nextY, solids);
    player.x = resolved.x;
    player.y = resolved.y;
  }

  tickTurrets(now);
  handleBullets(now);
  updateBestHold(now);
  ensureKingExists();
  broadcastState();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/map" && req.method === "GET") {
    fs.readFile(DEFAULT_MAP_FILE, "utf-8", (err, raw) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Failed to read map file" }));
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        const sanitized = sanitizeMapPayload(parsed);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(sanitized));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Map file is not valid JSON" }));
      }
    });
    return;
  }

  if (pathname === "/api/map" && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const sanitized = sanitizeMapPayload(parsed);
        fs.writeFile(DEFAULT_MAP_FILE, `${JSON.stringify(sanitized, null, 2)}\n`, "utf-8", (err) => {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Failed to save map file" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, map: sanitized }));
        });
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON payload" }));
      }
    });
    return;
  }

  let requestPath = pathname === "/" ? "/client/index.html" : pathname;
  if (!path.extname(requestPath) && !requestPath.endsWith("/")) {
    requestPath = `${requestPath}/`;
  }
  if (requestPath.endsWith("/")) {
    requestPath = `${requestPath}index.html`;
  }
  const normalizedRequestPath = path.normalize(requestPath).replace(/^[/\\]+/, "");
  const filePath = path.join(WEB_ROOT, normalizedRequestPath);
  if (!filePath.startsWith(WEB_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
    }[ext] || "text/plain; charset=utf-8";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") return;
  throw err;
});

wss.on("connection", (socket) => {
  let player = null;

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "hello" && !player) {
      const baseId = typeof msg.playerId === "string" && msg.playerId.trim() ? msg.playerId.trim() : `player-${Date.now()}`;
      const idInUse = Array.from(clients.values()).some((p) => p.id === baseId);
      const id = idInUse ? `${baseId}-${Math.floor(Math.random() * 1000)}` : baseId;
      const role = kingId ? "sieger" : "king";
      player = {
        id,
        socket,
        isBot: false,
        x: ARENA_WIDTH / 2,
        y: ARENA_HEIGHT / 2,
        input: { dx: 0, dy: 0 },
        role,
        joinedAt: Date.now(),
        lastShotAt: 0,
        lastBlockAt: 0,
        lastTurretAt: 0,
        hp: role === "king" ? KING_MAX_HP : PLAYER_MAX_HP,
        maxHp: role === "king" ? KING_MAX_HP : PLAYER_MAX_HP,
        invulnerableUntil: 0,
      };
      applySpawn(player);
      resetPlayerCombat(player, Date.now());

      clients.set(socket, player);
      if (!kingId) {
        kingId = id;
        kingSince = Date.now();
      }

      socket.send(JSON.stringify({ type: "welcome", yourId: id }));
      sendEvent({ kind: "player_joined", playerId: id, role: player.role });
      broadcastState();
      return;
    }

    if (!player) return;

    if (msg.type === "input") {
      const dx = Number(msg.dx) || 0;
      const dy = Number(msg.dy) || 0;
      player.input = normalizeInput(dx, dy);
      return;
    }

    if (msg.type === "shoot") {
      const now = Date.now();
      if (now - player.lastShotAt < SHOOT_COOLDOWN_MS) return;
      player.lastShotAt = now;
      spawnBullet(player, msg.aimX, msg.aimY);
      return;
    }

    if (msg.type === "place_block") {
      placeBlock(player, msg.x, msg.y, Date.now());
      return;
    }

    if (msg.type === "paint_blocks") {
      paintBlocks(player, msg.cells, Date.now());
      return;
    }

    if (msg.type === "place_turret") {
      placeTurret(player, msg.x, msg.y, Date.now());
      return;
    }

    if (msg.type === "add_bot") {
      if (player.id === kingId) addBot(player.id);
      return;
    }

    if (msg.type === "remove_bot") {
      if (player.id === kingId) removeBot(player.id);
    }
  });

  socket.on("close", () => {
    if (!player) return;
    const wasKing = player.id === kingId;
    clients.delete(socket);
    sendEvent({ kind: "player_left", playerId: player.id });
    if (wasKing) {
      ensureKingExists();
    }
    broadcastState();
  });
});

setInterval(gameTick, TICK_MS);
loadDefaultMap();

function listenWithFallback(port, retriesLeft) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && retriesLeft > 0) {
      const nextPort = port + 1;
      // eslint-disable-next-line no-console
      console.warn(`port ${port} in use, retrying on ${nextPort}...`);
      listenWithFallback(nextPort, retriesLeft - 1);
      return;
    }
    throw err;
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`onevsall server listening on http://localhost:${port}`);
  });
}

listenWithFallback(BASE_PORT, MAX_PORT_RETRIES);
