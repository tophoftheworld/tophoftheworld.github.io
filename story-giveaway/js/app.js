import {
  listPhotos,
  getThumbUrl,
  revokePhotoUrl,
  onPhotosUpdated,
  onGiveawayUpdated,
  displayLabel,
  getGiveaway,
  recordBatchDraw,
  normalizeUsername,
} from './db.js';
import { startAppRecording, stopAndDownload } from './recorder.js';
import {
  ensurePhotosFromCloud,
  pushGiveaway,
  subscribeGiveaway,
  fetchFullResUrl,
} from './sync.js';

const WINNER_COUNT = 5;
const LOOP_COPIES = 3;
const SPIN_DURATION_MS = 5500;
const WHITE_FADE_MS = 1000;

const els = {
  feedViewport: document.getElementById('feedViewport'),
  feedTrack: document.getElementById('feedTrack'),
  emptyState: document.getElementById('emptyState'),
  photoCount: document.getElementById('photoCount'),
  shutterBtn: document.getElementById('shutterBtn'),
  shutterDock: document.querySelector('.shutter-dock'),
  prizeLabel: document.getElementById('prizeLabel'),
  prizeLabelText: document.getElementById('prizeLabelText'),
  drawOverlay: document.getElementById('drawOverlay'),
  revealStage: document.getElementById('revealStage'),
  winnersStage: document.getElementById('winnersStage'),
  toast: document.getElementById('toast'),
  lightbox: document.getElementById('lightbox'),
  lightboxImg: document.getElementById('lightboxImg'),
  lightboxClose: document.getElementById('lightboxClose'),
};

/** @type {{ id: string, name: string, username?: string, layout?: string, url: string, label: string }[]} */
let photos = [];
let objectUrls = [];
let mode = 'idle'; // idle | spinning | revealing | winners
let spinRaf = 0;
let toastTimer = 0;
let loopGuard = false;
/** @type {Awaited<ReturnType<typeof getGiveaway>> | null} */
let giveaway = null;
let activePrizeName = '';

function showToast(message, ms = 2200) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), ms);
}

function revokeAllUrls() {
  for (const url of objectUrls) revokePhotoUrl(url);
  objectUrls = [];
}

async function loadPhotos() {
  const rows = await listPhotos();
  revokeAllUrls();
  photos = rows.map((row) => {
    const url = getThumbUrl(row);
    objectUrls.push(url);
    return {
      id: row.id,
      name: row.name,
      username: row.username || '',
      layout: row.layout === 'framed' ? 'framed' : 'fullscreen',
      url,
      label: displayLabel(row),
    };
  });
  renderFeed();
  updateShutterIdle();
}

async function openLightbox(photoId) {
  if (mode !== 'idle' && mode !== 'winners') return;
  const photo = photos.find((p) => p.id === photoId);
  if (!photo) return;
  try {
    els.lightboxImg.src = await fetchFullResUrl(photo.id);
  } catch {
    els.lightboxImg.src = photo.url;
  }
  els.lightboxImg.alt = photo.label;
  els.lightboxImg.classList.toggle('is-framed', photo.layout === 'framed');
  els.lightbox.classList.remove('hidden');
}

async function withFullResUrls(winners) {
  const urls = await Promise.all(
    winners.map((w) => fetchFullResUrl(w.id).catch(() => w.url))
  );
  return winners.map((w, i) => ({ ...w, url: urls[i] }));
}

function updateShutterIdle() {
  els.photoCount.textContent = String(photos.length);
  if (mode !== 'idle') return;
  const canStart = giveaway ? canDraw(giveaway) : photos.length >= WINNER_COUNT;
  els.shutterBtn.disabled = !canStart;
  els.shutterBtn.classList.remove('shutter--locked', 'shutter--close');
  els.shutterBtn.setAttribute('aria-label', 'Draw winners');
}

function renderFeed() {
  const track = els.feedTrack;
  track.innerHTML = '';

  if (!photos.length) {
    els.emptyState.classList.remove('hidden');
    return;
  }
  els.emptyState.classList.add('hidden');

  // Triple the list so we can loop scroll seamlessly
  const copies = photos.length < 9 ? Math.max(LOOP_COPIES, 6) : LOOP_COPIES;
  const frag = document.createDocumentFragment();

  for (let copy = 0; copy < copies; copy++) {
    for (const photo of photos) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'feed-cell';
      btn.dataset.photoId = photo.id;
      btn.setAttribute('aria-label', `Open ${photo.label}`);
      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = '';
      if (photo.layout === 'framed') img.classList.add('is-framed');
      img.loading = copy === 0 ? 'eager' : 'lazy';
      img.draggable = false;
      btn.appendChild(img);
      frag.appendChild(btn);
    }
  }

  track.appendChild(frag);
  // Start in the middle copy so user can scroll both ways
  requestAnimationFrame(() => {
    const mid = track.scrollHeight / copies;
    els.feedViewport.scrollTop = mid;
  });
}

function maintainEndlessScroll() {
  if (loopGuard || mode === 'spinning' || !photos.length) return;
  const vp = els.feedViewport;
  const track = els.feedTrack;
  const copies = Math.max(1, Math.round(track.children.length / photos.length));
  if (copies < 2) return;

  const segment = track.scrollHeight / copies;
  if (segment <= 0) return;

  const top = vp.scrollTop;
  // Near top → jump forward one segment
  if (top < segment * 0.25) {
    loopGuard = true;
    vp.scrollTop = top + segment;
    loopGuard = false;
  } else if (top > segment * (copies - 1.25)) {
    loopGuard = true;
    vp.scrollTop = top - segment;
    loopGuard = false;
  }
}

function closeLightbox() {
  els.lightbox.classList.add('hidden');
  els.lightboxImg.removeAttribute('src');
  els.lightboxImg.classList.remove('is-framed');
}

function pickWinners(pool, count = WINNER_COUNT) {
  const list = pool.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, count);
}

function isForceExcluded(photo, g) {
  return new Set(g?.forcedExcludePhotoIds || []).has(photo.id);
}

function isNormallyEligible(photo, g) {
  const wonUsers = new Set((g?.wonUsernames || []).map((u) => normalizeUsername(u)));
  const wonIds = new Set(g?.wonPhotoIds || []);
  const key = normalizeUsername(photo.username);
  if (key) return !wonUsers.has(key);
  return !wonIds.has(photo.id);
}

/** Photos marked Must win — guaranteed in the next draw. */
function getForcedWinners(g = giveaway) {
  const forcedIds = new Set(g?.forcedIncludePhotoIds || []);
  return photos.filter((photo) => forcedIds.has(photo.id) && !isForceExcluded(photo, g));
}

/** Pool for random winner slots (excludes forced winners + excluded + ineligible). */
function getRandomWinnerPool(g = giveaway, reservedIds = new Set()) {
  const forcedInclude = new Set(g?.forcedIncludePhotoIds || []);
  return photos.filter((photo) => {
    if (reservedIds.has(photo.id)) return false;
    if (isForceExcluded(photo, g)) return false;
    if (forcedInclude.has(photo.id)) return false;
    return isNormallyEligible(photo, g);
  });
}

/**
 * Build winner list: forced includes first, then random fill.
 * @returns {{ winners: typeof photos } | { error: string }}
 */
function pickDrawWinners(g = giveaway, count = WINNER_COUNT) {
  const forced = getForcedWinners(g);
  if (forced.length > count) {
    return { error: `Too many forced winners (${forced.length}) — max ${count}` };
  }

  const reserved = new Set(forced.map((p) => p.id));
  const needed = count - forced.length;
  const pool = getRandomWinnerPool(g, reserved);
  if (pool.length < needed) {
    return {
      error: `Need ${needed} more eligible entries (${pool.length} left${forced.length ? `, ${forced.length} forced` : ''})`,
    };
  }

  const winners = [...forced, ...pickWinners(pool, needed)];
  for (let i = winners.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [winners[i], winners[j]] = [winners[j], winners[i]];
  }
  return { winners };
}

function canDraw(g = giveaway) {
  return !pickDrawWinners(g, WINNER_COUNT).error;
}

function showPrizeLabel(prize) {
  activePrizeName = prize || '';
  if (!els.prizeLabel) return;
  if (!activePrizeName) {
    hidePrizeLabel();
    return;
  }
  els.prizeLabelText
    ? (els.prizeLabelText.textContent = activePrizeName)
    : (els.prizeLabel.textContent = activePrizeName);
  els.prizeLabel.classList.remove('hidden');
  els.shutterDock?.classList.add('is-prize');
  // Hide shutter — prize name is the close control
  els.shutterBtn.classList.add('hidden');
  els.shutterBtn.disabled = true;
}

function hidePrizeLabel() {
  activePrizeName = '';
  if (!els.prizeLabel) return;
  if (els.prizeLabelText) els.prizeLabelText.textContent = '';
  else els.prizeLabel.textContent = '';
  els.prizeLabel.classList.add('hidden');
  els.shutterDock?.classList.remove('is-prize');
  els.shutterBtn.classList.remove('hidden');
}

async function loadGiveaway() {
  giveaway = await getGiveaway();
  if (mode === 'idle') updateShutterIdle();
  return giveaway;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setShutterState(state) {
  const btn = els.shutterBtn;
  btn.classList.remove('shutter--locked', 'shutter--close');
  if (state === 'locked') {
    btn.disabled = true;
    btn.classList.add('shutter--locked');
    btn.setAttribute('aria-label', 'Drawing…');
  } else if (state === 'close') {
    btn.disabled = false;
    btn.classList.add('shutter--close');
    btn.setAttribute('aria-label', 'Close winners');
  } else {
    updateShutterIdle();
  }
}

function resetOverlay() {
  cancelAnimationFrame(spinRaf);
  els.feedViewport.classList.remove('is-spinning');
  els.feedTrack.style.filter = '';
  els.drawOverlay.className = 'draw-overlay';
  els.drawOverlay.style.background = '';
  els.drawOverlay.style.backdropFilter = '';
  els.drawOverlay.style.webkitBackdropFilter = '';
  els.drawOverlay.setAttribute('aria-hidden', 'true');
  els.revealStage.innerHTML = '';
  els.winnersStage.innerHTML = '';
  els.winnersStage.className = 'winners-stage hidden';
  hidePrizeLabel();
}

async function runSpinAnimation() {
  const vp = els.feedViewport;
  const track = els.feedTrack;
  const copies = Math.max(1, Math.round(track.children.length / Math.max(photos.length, 1)));
  const segment = track.scrollHeight / copies;

  vp.classList.add('is-spinning');

  const start = performance.now();
  let last = start;

  return new Promise((resolve) => {
    const tick = (now) => {
      const elapsed = now - start;
      const dt = Math.min(32, now - last);
      last = now;

      // Timing map (ms):
      // 0–500: slow
      // 500–1000: ramp accelerate
      // 1000–4500: no blur, faster and faster
      // 4500–5500: blur + still faster
      // 5500–6500: fade to white (handled after spin)
      let velocity;
      let blur = 0;

      if (elapsed < 500) {
        const t = elapsed / 500;
        velocity = 0.15 + 0.45 * t; // slow crawl
      } else if (elapsed < 1000) {
        const t = (elapsed - 500) / 500;
        const ease = t * t;
        velocity = 0.6 + 2.4 * ease; // ramp accelerate
      } else if (elapsed < 4500) {
        const t = (elapsed - 1000) / 3500;
        const boost = Math.pow(t, 2.1); // keeps accelerating hard
        velocity = 3.0 + 8.5 * boost; // faster and faster, no blur
        blur = 0;
      } else {
        // 4.5–5.5s: still accelerating + motion blur builds
        const t = Math.min(1, (elapsed - 4500) / 1000);
        velocity = 11.5 + 4.5 * t;
        blur = 2 + 14 * Math.pow(t, 1.2);
      }

      track.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : '';

      let next = vp.scrollTop + velocity * dt;

      // Keep within looping band without visible jump during spin
      if (segment > 0) {
        while (next > segment * (copies - 1.1)) next -= segment;
        while (next < segment * 0.1) next += segment;
      }
      vp.scrollTop = next;

      if (elapsed < SPIN_DURATION_MS) {
        spinRaf = requestAnimationFrame(tick);
      } else {
        track.style.filter = '';
        vp.classList.remove('is-spinning');
        resolve();
      }
    };
    spinRaf = requestAnimationFrame(tick);
  });
}

async function revealSequential(winners) {
  els.revealStage.innerHTML = '';
  for (let i = 0; i < winners.length; i++) {
    const card = document.createElement('div');
    card.className = 'reveal-card';
    const img = document.createElement('img');
    img.src = winners[i].url;
    img.alt = winners[i].label;
    if (winners[i].layout === 'framed') img.classList.add('is-framed');
    card.appendChild(img);
    els.revealStage.appendChild(card);

    // Force reflow then animate in
    void card.offsetWidth;
    card.classList.add('is-in');
    await wait(500);
    if (i < winners.length - 1) {
      card.classList.remove('is-in');
      card.classList.add('is-out');
      await wait(180);
      card.remove();
    } else {
      card.classList.remove('is-in');
      card.classList.add('is-out');
      await wait(220);
      card.remove();
    }
  }
}

function showWinnersGrid(winners) {
  els.revealStage.innerHTML = '';
  const stage = els.winnersStage;
  stage.innerHTML = '';
  stage.classList.remove('hidden');

  const top = document.createElement('div');
  top.className = 'winners-row winners-row--top';
  const bottom = document.createElement('div');
  bottom.className = 'winners-row winners-row--bottom';

  winners.forEach((winner) => {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'winner-slot';
    slot.dataset.photoId = winner.id;
    slot.setAttribute('aria-label', `Open ${winner.label}`);
    const label = escapeHtml(winner.label);
    const framedClass = winner.layout === 'framed' ? 'is-framed' : '';
    slot.innerHTML = `
      <div class="winner-slot__photo"><img class="${framedClass}" src="${winner.url}" alt="" /></div>
      <p class="winner-slot__name" title="${label}">${label}</p>
    `;
    if (top.childElementCount < 3) top.appendChild(slot);
    else bottom.appendChild(slot);
  });

  stage.appendChild(top);
  stage.appendChild(bottom);

  requestAnimationFrame(() => {
    stage.classList.add('is-in');
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function startDraw({ record = false } = {}) {
  if (mode !== 'idle') return;

  await loadGiveaway();
  const g = giveaway;
  if (!g?.batches?.length) {
    showToast('Add prize batches in the dashboard');
    notifyParent({ type: 'sg-draw-failed', error: 'No prize batches configured' });
    return;
  }
  if (g.currentBatchIndex >= g.batches.length) {
    showToast('All prizes drawn — start over');
    notifyParent({ type: 'sg-draw-failed', error: 'All prizes already drawn' });
    return;
  }

  const batch = g.batches[g.currentBatchIndex];
  const drawResult = pickDrawWinners(g);
  if (drawResult.error) {
    showToast(drawResult.error);
    notifyParent({
      type: 'sg-draw-failed',
      error: drawResult.error,
    });
    return;
  }

  closeLightbox();

  let recording = null;
  let savedFilename = '';

  // Fullscreen only — dashboard recording is handled by admin (cropped to the iframe)
  if (record && !isEmbedded()) {
    try {
      showToast('Share this tab to record…', 4000);
      recording = await startAppRecording(document.getElementById('app'));
      showToast('Recording…');
    } catch (err) {
      console.warn(err);
      showToast('Drawing without recording');
    }
  }

  mode = 'spinning';
  setShutterState('locked');
  resetOverlay();

  const winners = drawResult.winners;

  els.drawOverlay.classList.add('is-active');
  els.drawOverlay.setAttribute('aria-hidden', 'false');

  try {
    await runSpinAnimation();

    mode = 'revealing';
    els.drawOverlay.classList.add('is-fading', 'is-white');
    els.drawOverlay.style.background = '';
    els.drawOverlay.style.backdropFilter = '';
    els.drawOverlay.style.webkitBackdropFilter = '';
    await wait(WHITE_FADE_MS);

    const winnersHd = await withFullResUrls(winners);
    await revealSequential(winnersHd);

    // Persist winners + advance batch before showing results
    giveaway = await recordBatchDraw({ winners });
    try {
      await pushGiveaway(giveaway);
    } catch (cloudErr) {
      console.error('Cloud giveaway push failed', cloudErr);
      showToast('Saved locally — cloud sync failed');
    }

    mode = 'winners';
    showWinnersGrid(winnersHd);
    showPrizeLabel(batch.prize);
    // Keep shutter hidden; prize name closes the results
    els.shutterBtn.disabled = true;
    els.shutterBtn.classList.add('hidden');

    await wait(1500);

    if (recording) {
      try {
        const result = await stopAndDownload(recording, 'story-giveaway');
        savedFilename = result?.filename || '';
        showToast(savedFilename ? `Saved ${savedFilename}` : 'Video downloaded');
      } catch (err) {
        console.error(err);
        showToast('Could not save video');
      }
      recording = null;
    }

    notifyParent({
      type: 'sg-draw-complete',
      filename: savedFilename,
      prize: batch.prize,
      batchIndex: g.currentBatchIndex,
    });
  } catch (err) {
    console.error(err);
    notifyParent({ type: 'sg-draw-failed', error: err?.message || 'Draw failed' });
    mode = 'idle';
    setShutterState('idle');
    resetOverlay();
  } finally {
    if (recording) {
      try {
        await stopAndDownload(recording, 'story-giveaway');
      } catch {
        recording.stream?.getTracks?.().forEach((t) => t.stop());
      }
    }
  }
}

function isEmbedded() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('embed') === '1') return true;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function notifyParent(payload) {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage(payload, '*');
  } catch {
    /* ignore */
  }
}

function closeWinners() {
  if (mode !== 'winners') return;
  resetOverlay();
  mode = 'idle';
  setShutterState('idle');
  notifyParent({ type: 'sg-winners-closed' });
}

// Events
els.feedViewport.addEventListener('scroll', () => maintainEndlessScroll(), { passive: true });

els.feedTrack.addEventListener('click', (e) => {
  const cell = e.target.closest('.feed-cell');
  if (!cell) return;
  openLightbox(cell.dataset.photoId);
});

els.winnersStage.addEventListener('click', (e) => {
  const slot = e.target.closest('.winner-slot');
  if (!slot) return;
  openLightbox(slot.dataset.photoId);
});

els.shutterBtn.addEventListener('click', () => {
  if (mode === 'winners') {
    closeWinners();
    return;
  }
  if (isEmbedded()) {
    showToast('Use Record & draw on the dashboard');
    return;
  }
  startDraw({ record: true });
});

els.prizeLabel?.addEventListener('click', () => {
  if (mode === 'winners') closeWinners();
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'sg-close-winners') {
    closeWinners();
    return;
  }
  if (event.data?.type !== 'sg-start-draw') return;
  if (mode === 'winners') closeWinners();
  if (mode !== 'idle') {
    notifyParent({ type: 'sg-draw-failed', error: 'Draw already in progress' });
    return;
  }
  // Dashboard owns recording; just roll
  startDraw({ record: false });
});

els.lightboxClose.addEventListener('click', closeLightbox);
els.lightbox.addEventListener('click', (e) => {
  if (e.target === els.lightbox) closeLightbox();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.lightbox.classList.contains('hidden')) closeLightbox();
    else if (mode === 'winners') closeWinners();
  }
});

onPhotosUpdated(() => {
  if (mode === 'idle') loadPhotos();
});

onGiveawayUpdated(() => {
  if (mode === 'idle') loadGiveaway().catch(console.error);
});

async function boot() {
  // Admin preview iframe shares local IDB — don't pull from cloud there
  if (!isEmbedded()) {
    showToast('Loading stories…', 8000);
    try {
      await ensurePhotosFromCloud(({ done, total }) => {
        if (total > 0) showToast(`Downloading ${done}/${total}…`, 8000);
      });
    } catch (err) {
      console.warn('Cloud photo pull failed — using local cache', err);
    }
  }

  await Promise.all([loadPhotos(), loadGiveaway()]);

  if (!photos.length) {
    showToast(isEmbedded() ? 'Upload photos in the panel' : 'No stories yet — sync from admin');
  } else if (!isEmbedded()) {
    showToast(`${photos.length} stories ready`, 1600);
  }

  if (!isEmbedded()) {
    try {
      await subscribeGiveaway((g) => {
        if (!g) return;
        giveaway = g;
        if (mode === 'idle') updateShutterIdle();
      });
    } catch (err) {
      console.warn('Giveaway subscription failed', err);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  showToast('Failed to load');
});
