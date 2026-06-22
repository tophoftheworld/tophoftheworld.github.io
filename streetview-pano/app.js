/**
 * Fetches panorama metadata from Google's public photometa endpoint and stitches
 * tiles from streetviewpixels-pa.googleapis.com (same endpoints the Maps web client uses).
 */

const PHOTOMETA_PB_SUFFIX =
  '!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1!6m1!1e2!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3';

/** Token embedded in the Maps `listentityphotos` request (from public write-ups of the web client). */
const MAPS_PREVIEW_TOKEN = 'CAEIBAgFCAYgAQ';
/** Float appended by the web client; treated as a constant in those same notes. */
const LISTENTITY_ANCHOR = 45.12133303837374;

let cachedMapsClientId = null;

const TILE_BASE =
  'https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile';

let abortCtl = null;
let lastBlobUrl = null;
/** @type {any} */
let pannellumViewer = null;

function $(id) {
  return document.getElementById(id);
}

function stripJsonpPrefix(text) {
  const t = text.trim();
  if (t.startsWith(")]}'")) return t.slice(4);
  return t;
}

/** Street View pano IDs are token-like; Place IDs (ChIJ…) make photometa return HTTP 400. */
function sanitizePanoCandidate(v) {
  const id = String(v).trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  if (id.length < 16 || id.length > 64) return null;
  if (id.startsWith('ChIJ')) return null;
  if (id.startsWith('CAE') || id.startsWith('CAI')) return null;
  return id;
}

/** Collect likely panorama IDs from pasted text (URL or raw id). */
function extractCandidates(raw) {
  const s = raw.trim();
  if (!s) return [];

  const out = [];
  const seen = new Set();
  const add = (x) => {
    const v = sanitizePanoCandidate(x);
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };

  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    /* ignore */
  }

  const panoidParam = decoded.match(/[?&#]panoid=([^&]+)/i);
  if (panoidParam) {
    try {
      add(decodeURIComponent(panoidParam[1]));
    } catch {
      add(panoidParam[1]);
    }
  }

  if (/^[a-zA-Z0-9_-]+$/.test(s) && s.length >= 16 && s.length <= 200) {
    add(s);
  }

  const reBang1s = /!1s([^!]+)/g;
  let m;
  while ((m = reBang1s.exec(decoded))) {
    add(m[1]);
  }

  const ftid = decoded.match(/(?:1s|!1s)([a-zA-Z0-9_-]{22})(?:!|$)/);
  if (ftid) add(ftid[1]);

  return out;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomIntBelow(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Uniform index in [0, n) — crypto when available so successive clicks don’t cluster. */
function randomIntBelow(n) {
  if (n <= 0) return 0;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

/** Uniform float in [0, 1) — crypto when available. */
function randomUnitFloat() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  }
  return Math.random();
}

/**
 * Uniform random point on the globe (equal area over the sphere).
 * Most samples fall on water or places without Street View — that’s expected.
 */
function randomLatLngUniformSphere() {
  const u = randomUnitFloat();
  const v = randomUnitFloat();
  const lat = Math.asin(2 * u - 1) * (180 / Math.PI);
  const lng = 360 * v - 180;
  return { lat, lng };
}

function listEntityPhotosUrl(clientId, lat, lng) {
  const pb =
    '!1e3!5m54!2m2!1i203!2i100!3m3!2i4!3s' +
    MAPS_PREVIEW_TOKEN +
    '!5b1!7m42!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e9!2b1!3e2!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!2b1!4b1!8m0!9b0!11m1!4b1!6m3!1s' +
    clientId +
    '!7e81!15i11021!9m2!2d' +
    lng +
    '!3d' +
    lat +
    '!10d' +
    LISTENTITY_ANCHOR;
  return (
    'https://www.google.com/maps/rpc/photo/listentityphotos?authuser=0&hl=en&gl=us&pb=' +
    encodeURIComponent(pb)
  );
}

/** Pull panorama-looking IDs out of the decoded listentityphotos payload (walk + regex pass). */
function extractPanoIdsFromListEntity(doc) {
  const out = [];
  const seen = new Set();

  function maybeAdd(s) {
    if (typeof s !== 'string') return;
    if (seen.has(s)) return;
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(s)) return;
    if (s.startsWith('ChIJ') || s.startsWith('CAE') || s.startsWith('CAI')) return;
    if (s === MAPS_PREVIEW_TOKEN) return;
    seen.add(s);
    out.push(s);
  }

  function walk(node, depth) {
    if (depth > 28 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      if (node.length && typeof node[0] === 'string') maybeAdd(node[0]);
      for (const x of node) walk(x, depth + 1);
    }
  }

  walk(doc, 0);
  try {
    const raw = JSON.stringify(doc);
    const re = /\b([a-zA-Z0-9_-]{22})\b/g;
    let m;
    while ((m = re.exec(raw))) {
      maybeAdd(m[1]);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Best-effort lat/lng from photometa JSON (structure varies slightly). */
function extractLatLngFromPhotometa(doc) {
  let found = null;
  function walk(node, depth) {
    if (found || depth > 18) return;
    if (Array.isArray(node)) {
      for (let i = 0; i <= node.length - 4; i++) {
        if (
          node[i] === null &&
          node[i + 1] === null &&
          typeof node[i + 2] === 'number' &&
          typeof node[i + 3] === 'number'
        ) {
          const lat = node[i + 2];
          const lng = node[i + 3];
          if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            found = { lat, lng };
            return;
          }
        }
      }
      for (const x of node) walk(x, depth + 1);
    }
  }
  walk(doc, 0);
  return found;
}

async function getMapsClientId(signal) {
  if (cachedMapsClientId) return cachedMapsClientId;
  try {
    const res = await fetch('https://www.google.com/maps', {
      credentials: 'omit',
      signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/\],\s*null\s*,\s*0\s*,\s*"([^"]+)"/);
      if (m?.[1] && m[1].length > 8) {
        cachedMapsClientId = m[1];
        return cachedMapsClientId;
      }
    }
  } catch {
    /* fall through */
  }
  return 'CqW8ZMSZH8m2qtsP4s2swAM';
}

/**
 * Random panorama: uniform globe sample → nearby-pano JSON → photometa checks until one works.
 * This phase only hits **small metadata endpoints** (no tile imagery). Panorama JPEG tiles download **once**
 * after this returns, inside `stitchPanorama`.
 */
async function pickRandomStreetViewPano(signal, onAttemptStatus) {
  const clientId = await getMapsClientId(signal);
  /** Upper bound on globe tries (most fail on ocean / no coverage — stops earlier on success). */
  const maxProbe = 180;

  for (let attempt = 1; attempt <= maxProbe; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { lat, lng } = randomLatLngUniformSphere();
    onAttemptStatus(
      `Searching metadata ${attempt}/${maxProbe} (no tiles yet) — ${lat.toFixed(2)}°, ${lng.toFixed(2)}°…`
    );

    let doc;
    try {
      const res = await fetch(listEntityPhotosUrl(clientId, lat, lng), {
        credentials: 'omit',
        signal,
      });
      if (!res.ok) continue;
      const text = await res.text();
      doc = JSON.parse(stripJsonpPrefix(text));
    } catch {
      continue;
    }

    const ids = extractPanoIdsFromListEntity(doc);
    if (!ids.length) continue;

    shuffleInPlace(ids);
    const maxTry = Math.min(ids.length, 18);
    for (let k = 0; k < maxTry; k++) {
      const id = ids[k];
      try {
        const metaDoc = await fetchPhotometa(id, signal);
        if (!parseMeta(metaDoc)) continue;
        const ll = extractLatLngFromPhotometa(metaDoc);
        return {
          panoId: id,
          lat: ll?.lat ?? lat,
          lng: ll?.lng ?? lng,
        };
      } catch {
        /* next id */
      }
    }
  }

  return null;
}

function photometaUrl(panoId) {
  const pb =
    '!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2sus!3m3!1m2!1e2!2s' +
    panoId +
    PHOTOMETA_PB_SUFFIX;
  return (
    'https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=us&pb=' +
    encodeURIComponent(pb)
  );
}

async function fetchPhotometa(panoId, signal) {
  const res = await fetch(photometaUrl(panoId), { credentials: 'omit', signal });
  if (!res.ok) throw new Error(`Metadata HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(stripJsonpPrefix(text));
  return json;
}

/** Read full equirectangular size and tile size from photometa JSON. */
function parseMeta(doc) {
  try {
    const dim = doc?.[1]?.[0]?.[2]?.[2];
    if (!Array.isArray(dim) || dim.length < 2) return null;
    const fullHeight = dim[0];
    const fullWidth = dim[1];
    const tilePair = doc?.[1]?.[0]?.[2]?.[3]?.[1];
    let tileW = 512;
    let tileH = 512;
    if (Array.isArray(tilePair) && tilePair.length >= 2) {
      tileW = tilePair[0];
      tileH = tilePair[1];
    }
    let copyright = '';
    const copyBlock = doc?.[1]?.[0]?.[4]?.[0]?.[0]?.[0]?.[0];
    if (typeof copyBlock === 'string') copyright = copyBlock;

    return { fullWidth, fullHeight, tileW, tileH, copyright };
  } catch {
    return null;
  }
}

function dimensionsAtZoom(fullWidth, fullHeight, zoom) {
  const z = Math.max(1, Math.min(5, zoom));
  const d = 5 - z;
  const pow = 2 ** d;
  return {
    width: Math.round(fullWidth / pow),
    height: Math.round(fullHeight / pow),
    zoom: z,
  };
}

function tileUrl(panoId, x, y, zoom) {
  return `${TILE_BASE}&panoid=${encodeURIComponent(panoId)}&x=${x}&y=${y}&zoom=${zoom}&nbt=1&fover=2`;
}

async function fetchTile(url, signal) {
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok) throw new Error(`Tile ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTileWithRetry(url, signal, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchTile(url, signal);
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      await sleep(120 * (i + 1));
    }
  }
  throw lastErr;
}

/** Bounded concurrency pool. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function stitchPanorama(panoId, zoom, onProgress, signal) {
  const metaDoc = await fetchPhotometa(panoId, signal);
  const meta = parseMeta(metaDoc);
  if (!meta) throw new Error('Could not parse panorama metadata (unsupported or Photo Sphere).');

  const { width, height } = dimensionsAtZoom(meta.fullWidth, meta.fullHeight, zoom);
  const { tileW, tileH } = meta;
  const cols = Math.ceil(width / tileW);
  const rows = Math.ceil(height / tileH);
  const total = cols * rows;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');

  const tasks = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tasks.push({ x, y, i: y * cols + x });
    }
  }

  let completed = 0;

  await mapPool(tasks, 8, async ({ x, y }) => {
    const url = tileUrl(panoId, x, y, zoom);
    const bmp = await fetchTileWithRetry(url, signal);
    try {
      const dx = x * tileW;
      const dy = y * tileH;
      const dw = Math.min(tileW, width - dx);
      const dh = Math.min(tileH, height - dy);
      const sw = Math.min(bmp.width, dw);
      const sh = Math.min(bmp.height, dh);
      if (sw > 0 && sh > 0) {
        ctx.drawImage(bmp, 0, 0, sw, sh, dx, dy, sw, sh);
      }
    } finally {
      bmp.close?.();
    }
    completed++;
    onProgress(completed, total);
  });

  return { canvas, meta, cols, rows };
}

/**
 * @param {{ coords?: { lat: number; lng: number } }} [extra]
 */
async function runStitchPipeline(panoId, zoom, signal, extra) {
  setStatus(`Downloading tiles for ${panoId}…`);
  const { canvas, meta, cols, rows } = await stitchPanorama(panoId, zoom, (done, total) => {
    setProgress(true, done / total);
    setStatus(`Stitching tiles ${done} / ${total}…`);
  }, signal);

  const prev = $('preview-canvas');
  prev.width = canvas.width;
  prev.height = canvas.height;
  const pctx = prev.getContext('2d');
  pctx.drawImage(canvas, 0, 0);

  const mime = $('format-select').value;
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const quality = mime === 'image/jpeg' ? 0.92 : undefined;

  const blob = await new Promise((resolve, reject) => {
    prev.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), mime, quality);
  });

  const url = URL.createObjectURL(blob);
  const a = $('download-link');
  if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
  lastBlobUrl = url;
  a.href = url;
  a.download = `streetview-${panoId}-z${zoom}.${ext}`;

  let metaText = `${canvas.width}×${canvas.height}px · tile grid ${cols}×${rows} · ${meta.copyright || '© Google'} · zoom ${zoom}`;
  const cr = extra?.coords;
  if (
    cr &&
    typeof cr.lat === 'number' &&
    typeof cr.lng === 'number' &&
    !Number.isNaN(cr.lat) &&
    !Number.isNaN(cr.lng)
  ) {
    metaText += ` · approx. ${cr.lat.toFixed(4)}°, ${cr.lng.toFixed(4)}°`;
  }
  $('meta-line').textContent = metaText;
  $('preview-section').hidden = false;
  setStatus('Done.');
  setProgress(false);
  initPanoramaViewer();
}

function setBusy(busy) {
  $('btn-fetch').disabled = busy;
  $('btn-random').disabled = busy;
  $('btn-cancel').disabled = !busy;
  $('url-input').disabled = busy;
  $('zoom-select').disabled = busy;
  $('format-select').disabled = busy;
}

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function setProgress(visible, pct = 0) {
  const wrap = document.querySelector('.progress-wrap');
  const bar = $('progress-bar');
  wrap.hidden = !visible;
  bar.style.width = `${Math.round(pct * 100)}%`;
}

function destroyPannellumViewer() {
  window.removeEventListener('resize', onViewerViewportResize);
  if (pannellumViewer) {
    try {
      pannellumViewer.destroy();
    } catch {
      /* ignore */
    }
    pannellumViewer = null;
  }
  const host = $('pviewer');
  if (host) host.innerHTML = '';
}

function onViewerViewportResize() {
  if (typeof pannellumViewer?.resize === 'function') {
    pannellumViewer.resize();
  }
}

/** Mount Pannellum inline in #pviewer (fullscreen control is built into Pannellum UI). */
function initPanoramaViewer() {
  destroyPannellumViewer();
  if (!lastBlobUrl) return;
  if (typeof window.pannellum === 'undefined' || typeof window.pannellum.viewer !== 'function') {
    setStatus('360° viewer library failed to load. Check your network and reload.', true);
    return;
  }

  requestAnimationFrame(() => {
    try {
      pannellumViewer = window.pannellum.viewer('pviewer', {
        type: 'equirectangular',
        panorama: lastBlobUrl,
        autoLoad: true,
        compass: false,
        showFullscreenCtrl: true,
        minHfov: 28,
        maxHfov: 125,
        hfov: 90,
      });
      window.addEventListener('resize', onViewerViewportResize);
      onViewerViewportResize();
    } catch (err) {
      setStatus(`Could not start 360° viewer: ${err.message || err}`, true);
      destroyPannellumViewer();
    }
  });
}

$('btn-cancel').addEventListener('click', () => {
  abortCtl?.abort();
});

$('btn-fetch').addEventListener('click', async () => {
  destroyPannellumViewer();
  const raw = $('url-input').value;
  const candidates = extractCandidates(raw);
  if (!candidates.length) {
    setStatus('Paste a Google Maps Street View URL or a panorama ID.', true);
    return;
  }

  abortCtl = new AbortController();
  setBusy(true);
  setProgress(true, 0);
  $('preview-section').hidden = true;
  setStatus('Resolving panorama…');

  const zoom = parseInt($('zoom-select').value, 10);
  let panoId = null;
  let lastErr = null;

  for (const c of candidates) {
    try {
      const doc = await fetchPhotometa(c, abortCtl.signal);
      const meta = parseMeta(doc);
      if (meta) {
        panoId = c;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!panoId) {
    setBusy(false);
    setProgress(false);
    const hint400 =
      lastErr?.message?.includes('400') &&
      ' Google often returns HTTP 400 when the text contained a Place ID (ChIJ…) instead of a Street View pano id — open Street View, copy the link, or copy only the panoid= value.';
    setStatus(
      lastErr
        ? `No panorama found. Last error: ${lastErr.message}.${hint400 || ''}`
        : 'Could not find a Google-hosted Street View panorama in that text. User-uploaded Photo Spheres often use a different pipeline.',
      true
    );
    return;
  }

  try {
    await runStitchPipeline(panoId, zoom, abortCtl.signal);
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Cancelled.' : e.message || String(e);
    setStatus(msg, e?.name !== 'AbortError');
    setProgress(false);
  } finally {
    setBusy(false);
    abortCtl = null;
  }
});

$('btn-random').addEventListener('click', async () => {
  destroyPannellumViewer();

  abortCtl = new AbortController();
  setBusy(true);
  setProgress(true, 0);
  $('preview-section').hidden = true;
  setStatus('Finding a random Street View panorama…');

  const zoom = parseInt($('zoom-select').value, 10);

  try {
    const picked = await pickRandomStreetViewPano(abortCtl.signal, (msg) => setStatus(msg));
    if (!picked) {
      setStatus(
        'Could not resolve a panorama — Maps responses may be blocked or imagery rotated. Try again in a moment.',
        true
      );
      setProgress(false);
      return;
    }

    $('url-input').value = picked.panoId;
    await runStitchPipeline(picked.panoId, zoom, abortCtl.signal, { coords: picked });
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Cancelled.' : e.message || String(e);
    setStatus(msg, e?.name !== 'AbortError');
    setProgress(false);
  } finally {
    setBusy(false);
    abortCtl = null;
  }
});
