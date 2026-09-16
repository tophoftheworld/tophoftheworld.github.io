import {
  addPhotos,
  listPhotos,
  deletePhoto,
  clearAll,
  getPhotoUrl,
  revokePhotoUrl,
  formatBytes,
  onPhotosUpdated,
  onGiveawayUpdated,
  notifyPhotosUpdated,
  parseEntriesFile,
  importEntries,
  displayLabel,
  getGiveaway,
  setGiveawayName,
  addBatch,
  updateBatchPrize,
  removeBatch,
  resetGiveawayProgress,
  cyclePhotoForce,
} from './db.js';
import { startAppRecording, stopAndDownload, abortRecording } from './recorder.js';
import {
  syncToCloud,
  pullPhotosToLocal,
  pushGiveaway,
  subscribeGiveaway,
} from './sync.js';

const els = {
  fileInput: document.getElementById('fileInput'),
  entriesInput: document.getElementById('entriesInput'),
  clearBtn: document.getElementById('clearBtn'),
  syncCloudBtn: document.getElementById('syncCloudBtn'),
  pullCloudBtn: document.getElementById('pullCloudBtn'),
  dropZone: document.getElementById('dropZone'),
  statusLine: document.getElementById('statusLine'),
  syncStatusLine: document.getElementById('syncStatusLine'),
  usernameSearchInput: document.getElementById('usernameSearchInput'),
  photoTableBody: document.getElementById('photoTableBody'),
  appFrame: document.getElementById('appFrame'),
  recordDrawBtn: document.getElementById('recordDrawBtn'),
  recordDrawBtnAlt: document.getElementById('recordDrawBtnAlt'),
  drawOnlyBtn: document.getElementById('drawOnlyBtn'),
  recordHint: document.getElementById('recordHint'),
  giveawayNameInput: document.getElementById('giveawayNameInput'),
  giveawayProgress: document.getElementById('giveawayProgress'),
  giveawayLockHint: document.getElementById('giveawayLockHint'),
  giveawayPanel: document.querySelector('.giveaway-panel'),
  batchList: document.getElementById('batchList'),
  addBatchForm: document.getElementById('addBatchForm'),
  batchPrizeInput: document.getElementById('batchPrizeInput'),
  addBatchBtn: document.getElementById('addBatchBtn'),
  resetGiveawayBtn: document.getElementById('resetGiveawayBtn'),
};

/** @type {Map<string, string>} */
const thumbUrls = new Map();
let busyRecording = false;
let winnersShowing = false;
let syncBusy = false;
let usernameQuery = '';

function applyUsernameFilter() {
  const q = String(usernameQuery || '').trim().toLowerCase();
  const rows = els.photoTableBody?.querySelectorAll('tr[data-id]') || [];
  rows.forEach((row) => {
    const userCell = row.querySelector('.col-user');
    const userText = userCell?.textContent?.trim()?.toLowerCase?.() || '';
    const match = !q || userText.includes(q);
    row.style.display = match ? '' : 'none';
  });
}

function revokeThumbs() {
  for (const url of thumbUrls.values()) revokePhotoUrl(url);
  thumbUrls.clear();
}

function setStatus(count, extra = '') {
  const base = count === 1 ? '1 photo' : `${count} photos`;
  els.statusLine.textContent = extra ? `${base} · ${extra}` : base;
}

function setSyncStatus(text) {
  if (els.syncStatusLine) els.syncStatusLine.textContent = text;
}

function setSyncBusy(busy) {
  syncBusy = busy;
  if (els.syncCloudBtn) els.syncCloudBtn.disabled = busy;
  if (els.pullCloudBtn) els.pullCloudBtn.disabled = busy;
}

async function pushGiveawaySafe() {
  try {
    await pushGiveaway();
  } catch (err) {
    console.error('Cloud giveaway push failed', err);
    setSyncStatus(err?.message || 'Could not sync giveaway to cloud');
  }
}

function setRecordHint(text) {
  if (els.recordHint) els.recordHint.textContent = text;
}

function setRecordBusy(busy) {
  busyRecording = busy;
  els.recordDrawBtn.disabled = busy;
  els.recordDrawBtnAlt.disabled = busy;
  if (els.drawOnlyBtn) els.drawOnlyBtn.disabled = busy;
  // Hide overlay during draw/record so it doesn't steal clicks mid-animation
  els.recordDrawBtn.style.visibility = busy ? 'hidden' : '';
}

function closeWinnersFromDashboard() {
  winnersShowing = false;
  postToApp({ type: 'sg-close-winners' });
  setRecordHint('Ready');
}

/** Phone shutter hotspot: close results if open, otherwise start record & draw. */
function onShutterHit() {
  if (busyRecording) return;
  if (winnersShowing) {
    closeWinnersFromDashboard();
    return;
  }
  recordAndDraw();
}

function refreshIframe() {
  const url = new URL(els.appFrame.src, window.location.href);
  url.searchParams.set('v', String(Date.now()));
  url.searchParams.set('embed', '1');
  els.appFrame.src = url.toString();
}

function postToApp(payload) {
  els.appFrame.contentWindow?.postMessage(payload, '*');
}

function waitForDrawResult(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for draw to finish'));
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== els.appFrame.contentWindow) return;
      const type = event.data?.type;
      if (type === 'sg-draw-complete') {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(event.data);
      } else if (type === 'sg-draw-failed') {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        reject(new Error(event.data?.error || 'Draw failed'));
      }
    }

    window.addEventListener('message', onMessage);
  });
}

/**
 * Record only the iframe (app content) — no bezel/notch/admin UI — then run the draw.
 * CropTarget must run in this parent window on the iframe element.
 */
async function recordAndDraw() {
  if (busyRecording) return;

  setRecordBusy(true);
  winnersShowing = false;
  setRecordHint('Share this tab when prompted — recording the app screen only');

  let session = null;
  try {
    session = await startAppRecording(els.appFrame);
    setRecordHint('Recording… rolling now');

    const donePromise = waitForDrawResult();
    postToApp({ type: 'sg-start-draw', record: false });
    await donePromise;

    setRecordHint('Saving video…');
    const result = await stopAndDownload(session, 'story-giveaway');
    session = null;
    winnersShowing = true;
    setRecordHint(result?.filename ? `Saved ${result.filename}` : 'Video downloaded');
  } catch (err) {
    console.error(err);
    abortRecording(session);
    winnersShowing = false;
    setRecordHint(err?.message || 'Recording cancelled');
  } finally {
    setRecordBusy(false);
  }
}

async function drawOnly() {
  if (busyRecording) return;

  setRecordBusy(true);
  winnersShowing = false;
  setRecordHint('Drawing…');

  try {
    const donePromise = waitForDrawResult();
    postToApp({ type: 'sg-start-draw', record: false });
    await donePromise;
    winnersShowing = true;
    setRecordHint('Draw complete');
  } catch (err) {
    console.error(err);
    winnersShowing = false;
    setRecordHint(err?.message || 'Draw failed');
  } finally {
    setRecordBusy(false);
  }
}

els.recordDrawBtn.addEventListener('click', () => onShutterHit());
els.recordDrawBtnAlt.addEventListener('click', () => {
  if (winnersShowing) {
    closeWinnersFromDashboard();
    return;
  }
  recordAndDraw();
});
els.drawOnlyBtn?.addEventListener('click', () => {
  if (winnersShowing) {
    closeWinnersFromDashboard();
    return;
  }
  drawOnly();
});

window.addEventListener('message', (event) => {
  if (event.source !== els.appFrame.contentWindow) return;
  if (event.data?.type === 'sg-winners-closed') {
    winnersShowing = false;
    setRecordHint('Ready');
  }
  if (event.data?.type === 'sg-draw-complete') {
    renderGiveaway().catch(console.error);
  }
});

async function renderGiveaway() {
  const g = await getGiveaway();
  const started = (g.currentBatchIndex || 0) > 0 || (g.batchResults || []).length > 0;
  const locked = started;

  els.giveawayPanel?.classList.toggle('is-locked', locked);
  els.giveawayLockHint?.classList.toggle('hidden', !locked);

  if (els.giveawayNameInput) {
    if (document.activeElement !== els.giveawayNameInput) {
      els.giveawayNameInput.value = g.name || '';
    }
    els.giveawayNameInput.disabled = locked;
  }
  if (els.batchPrizeInput) els.batchPrizeInput.disabled = locked;
  if (els.addBatchBtn) els.addBatchBtn.disabled = locked;

  const total = g.batches.length;
  const idx = g.currentBatchIndex || 0;
  if (!total) {
    els.giveawayProgress.textContent = 'No prize batches yet — add prizes below';
  } else if (idx >= total) {
    els.giveawayProgress.textContent = `All ${total} batches complete · Start over to reset`;
  } else {
    const next = g.batches[idx];
    els.giveawayProgress.textContent = `Next: batch ${idx + 1} of ${total} · ${next.prize}`;
  }

  const list = els.batchList;
  list.innerHTML = '';
  if (!total) {
    list.innerHTML = '<li class="batch-list__empty">No batches yet</li>';
    return;
  }

  g.batches.forEach((batch, i) => {
    const li = document.createElement('li');
    li.className = 'batch-item';
    if (i < idx) li.classList.add('is-done');
    if (i === idx) li.classList.add('is-next');
    li.dataset.id = batch.id;

    const result = (g.batchResults || []).find((r) => r.batchId === batch.id);
    const winners = (result?.winnerLabels || []).filter(Boolean);
    const winnersHtml = winners.length
      ? `<p class="batch-item__winners">${winners
          .map((label) => `<span>${escapeHtml(label)}</span>`)
          .join('<span class="batch-item__sep">·</span>')}</p>`
      : '';

    li.innerHTML = `
      <span class="batch-item__index">${i + 1}</span>
      <input class="batch-item__prize" type="text" value="${escapeAttr(batch.prize)}" aria-label="Prize name" ${locked ? 'disabled' : ''} />
      <button type="button" class="batch-item__delete" data-delete-batch="${batch.id}" ${locked ? 'disabled' : ''}>Delete</button>
      ${winnersHtml}
    `;
    list.appendChild(li);
  });
}

document.querySelectorAll('.panel-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab;
    document.querySelectorAll('.panel-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.getElementById('tabFiles')?.classList.toggle('is-active', id === 'files');
    document.getElementById('tabGiveaway')?.classList.toggle('is-active', id === 'giveaway');
  });
});

els.giveawayNameInput?.addEventListener('change', async () => {
  if (els.giveawayNameInput.disabled) return;
  try {
    await setGiveawayName(els.giveawayNameInput.value);
    await pushGiveawaySafe();
    await renderGiveaway();
  } catch (err) {
    console.error(err);
  }
});

els.addBatchForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (els.batchPrizeInput?.disabled) return;
  const prize = els.batchPrizeInput.value.trim();
  if (!prize) return;
  try {
    await addBatch(prize);
    await pushGiveawaySafe();
    els.batchPrizeInput.value = '';
    await renderGiveaway();
  } catch (err) {
    console.error(err);
    setRecordHint(err?.message || 'Could not add batch');
  }
});

els.batchList?.addEventListener('change', async (e) => {
  const input = e.target.closest('.batch-item__prize');
  if (!input || input.disabled) return;
  const item = input.closest('.batch-item');
  const id = item?.dataset.id;
  if (!id) return;
  try {
    await updateBatchPrize(id, input.value);
    await pushGiveawaySafe();
    await renderGiveaway();
  } catch (err) {
    console.error(err);
    await renderGiveaway();
  }
});

els.batchList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-batch]');
  if (!btn || btn.disabled) return;
  const id = btn.getAttribute('data-delete-batch');
  if (!confirm('Delete this prize batch?')) return;
  try {
    await removeBatch(id);
    await pushGiveawaySafe();
    await renderGiveaway();
  } catch (err) {
    console.error(err);
  }
});

els.resetGiveawayBtn?.addEventListener('click', async () => {
  if (!confirm('Start over? This clears draw progress and past winners (keeps prize list).')) {
    return;
  }
  try {
    await resetGiveawayProgress();
    await pushGiveawaySafe();
    await renderGiveaway();
    setRecordHint('Giveaway reset — ready for first batch');
  } catch (err) {
    console.error(err);
  }
});

onGiveawayUpdated(() => {
  renderGiveaway().catch(console.error);
});

async function renderTable() {
  const [photos, g] = await Promise.all([listPhotos(), getGiveaway()]);
  revokeThumbs();
  setStatus(photos.length);

  const tbody = els.photoTableBody;
  tbody.innerHTML = '';

  if (!photos.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No photos uploaded yet</td></tr>';
    return;
  }

  const includeSet = new Set(g?.forcedIncludePhotoIds || []);
  const excludeSet = new Set(g?.forcedExcludePhotoIds || []);

  const frag = document.createDocumentFragment();
  for (const photo of photos) {
    const url = getPhotoUrl(photo);
    thumbUrls.set(photo.id, url);
    const label = displayLabel(photo);
    const hasUser = Boolean(String(photo.username || '').trim());
    const forceState = includeSet.has(photo.id)
      ? 'include'
      : excludeSet.has(photo.id)
        ? 'exclude'
        : 'none';
    const forceLabel =
      forceState === 'include' ? 'Must win' : forceState === 'exclude' ? 'Exclude' : 'None';
    const forceTitle =
      forceState === 'include'
        ? 'Guaranteed winner on the next draw (even if already won before)'
        : forceState === 'exclude'
          ? 'Stays in the grid — never picked as a winner'
          : 'Default eligibility (one entry per username)';

    const tr = document.createElement('tr');
    tr.dataset.id = photo.id;
    tr.innerHTML = `
      <td class="col-thumb"><img class="thumb" src="${url}" alt="" /></td>
      <td class="name-cell" title="${escapeAttr(photo.name)}">${escapeHtml(photo.name)}</td>
      <td class="col-user ${hasUser ? 'has-user' : ''}" title="${escapeAttr(label)}">${escapeHtml(label)}</td>
      <td class="col-size">${formatBytes(photo.size || photo.blob?.size || photo.thumbBlob?.size || 0)}</td>
      <td class="col-force">
        <button type="button" class="force-toggle force-toggle--${forceState}" data-force-photo="${photo.id}" title="${escapeAttr(forceTitle)}">${forceLabel}</button>
      </td>
      <td class="col-actions"><button type="button" class="btn--danger" data-delete="${photo.id}">Delete</button></td>
    `;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
  applyUsernameFilter();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    setStatus((await listPhotos()).length, 'no images found');
    return;
  }

  setStatus((await listPhotos()).length, `uploading ${files.length}…`);
  try {
    await addPhotos(files);
    await renderTable();
    notifyPhotosUpdated();
  } catch (err) {
    console.error(err);
    setStatus((await listPhotos()).length, 'upload failed');
  }
}

els.fileInput.addEventListener('change', async () => {
  await handleFiles(els.fileInput.files);
  els.fileInput.value = '';
});

els.entriesInput.addEventListener('change', async () => {
  const file = els.entriesInput.files?.[0];
  els.entriesInput.value = '';
  if (!file) return;
  try {
    const entries = await parseEntriesFile(file);
    const result = await importEntries(entries);
    await renderTable();
    setStatus(
      (await listPhotos()).length,
      `linked ${result.photosUpdated}/${result.metaCount} usernames`
    );
  } catch (err) {
    console.error(err);
    setStatus((await listPhotos()).length, err?.message || 'import failed');
  }
});

els.syncCloudBtn?.addEventListener('click', async () => {
  if (syncBusy) return;
  setSyncBusy(true);
  setSyncStatus('Connecting…');
  try {
    const result = await syncToCloud({
      onProgress: (p) => {
        if (p.phase === 'listing' || p.phase === 'checking') {
          setSyncStatus('Checking cloud…');
          return;
        }
        if (p.phase === 'meta') {
          setSyncStatus(`Updating metadata ${p.done}/${p.total}`);
          return;
        }
        if (p.detail) {
          setSyncStatus(`Uploading ${p.detail}`);
          return;
        }
        setSyncStatus(
          `Uploading ${p.done}/${p.total}${p.name ? ` · ${p.name}` : ''}` +
            (typeof p.percent === 'number' ? ` · ${Math.round(p.percent * 100)}%` : '')
        );
      },
    });
    const failNote = result.failed?.length
      ? ` · ${result.failed.length} failed`
      : '';
    setSyncStatus(
      `Synced ${result.uploaded} new photo${result.uploaded === 1 ? '' : 's'}` +
        (result.skipped ? ` · ${result.skipped} already online` : '') +
        ` · giveaway updated${failNote}`
    );
  } catch (err) {
    console.error(err);
    setSyncStatus(err?.message || 'Sync failed');
  } finally {
    setSyncBusy(false);
  }
});

els.pullCloudBtn?.addEventListener('click', async () => {
  if (syncBusy) return;
  setSyncBusy(true);
  setSyncStatus('Pulling from cloud…');
  try {
    const result = await pullPhotosToLocal({
      onProgress: ({ done, total, name }) => {
        setSyncStatus(`Downloading ${done}/${total}${name ? ` · ${name}` : ''}`);
      },
    });
    await renderTable();
    refreshIframe();
    setSyncStatus(
      result.pulled
        ? `Pulled ${result.pulled} photo${result.pulled === 1 ? '' : 's'}` +
          (result.skipped ? ` · ${result.skipped} already local` : '')
        : result.total
          ? 'Already up to date'
          : 'No photos in cloud yet'
    );
  } catch (err) {
    console.error(err);
    setSyncStatus(err?.message || 'Pull failed');
  } finally {
    setSyncBusy(false);
  }
});

els.clearBtn.addEventListener('click', async () => {
  const photos = await listPhotos();
  if (!photos.length) return;
  if (!confirm(`Delete all ${photos.length} photos?`)) return;
  await clearAll();
  await renderTable();
  refreshIframe();
});

els.photoTableBody.addEventListener('click', async (e) => {
  const forceBtn = e.target.closest('[data-force-photo]');
  if (forceBtn) {
    const id = forceBtn.getAttribute('data-force-photo');
    await cyclePhotoForce(id);
    await pushGiveawaySafe();
    await renderTable();
    return;
  }

  const btn = e.target.closest('[data-delete]');
  if (!btn) return;
  const id = btn.getAttribute('data-delete');
  await deletePhoto(id);
  await renderTable();
});

['dragenter', 'dragover'].forEach((type) => {
  els.dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.dropZone.classList.add('is-dragover');
  });
});

['dragleave', 'drop'].forEach((type) => {
  els.dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'dragleave' && els.dropZone.contains(e.relatedTarget)) return;
    els.dropZone.classList.remove('is-dragover');
  });
});

els.dropZone.addEventListener('drop', (e) => {
  handleFiles(e.dataTransfer?.files);
});

document.querySelector('.panel')?.addEventListener('dragover', (e) => e.preventDefault());
document.querySelector('.panel')?.addEventListener('drop', (e) => {
  if (e.target.closest('.drop-zone')) return;
  e.preventDefault();
  handleFiles(e.dataTransfer?.files);
});

onPhotosUpdated(() => {
  renderTable().catch(console.error);
});

renderTable().catch(console.error);
renderGiveaway().catch(console.error);

els.usernameSearchInput?.addEventListener('input', () => {
  usernameQuery = els.usernameSearchInput.value;
  applyUsernameFilter();
});

subscribeGiveaway(() => {
  renderGiveaway().catch(console.error);
  renderTable().catch(console.error);
}).catch((err) => {
  console.error(err);
  setSyncStatus('Cloud giveaway offline — local only');
});
