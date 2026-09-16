import { FFmpeg } from '../vendor/ffmpeg/index.js';

const VENDOR = new URL('../vendor/ffmpeg/', import.meta.url);

const els = {
  engineStatus: document.getElementById('engineStatus'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  fileList: document.getElementById('fileList'),
  fileCount: document.getElementById('fileCount'),
  clearBtn: document.getElementById('clearBtn'),
  downloadAllBtn: document.getElementById('downloadAllBtn'),
};

/** @type {FFmpeg | null} */
let ffmpeg = null;
let engineReady = false;
let processing = false;

/** @type {Map<string, { id: string, name: string, input: File, status: string, progress: number, mp4Blob: Blob | null, mp4Name: string, error: string }>} */
const jobs = new Map();

function uuid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function baseName(filename) {
  return String(filename || 'recording').replace(/\.[^.]+$/, '') || 'recording';
}

function mp4NameFor(file) {
  return `${baseName(file.name)}.mp4`;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setEngineStatus(text, kind = '') {
  els.engineStatus.textContent = text;
  els.engineStatus.classList.remove('is-ready', 'is-error');
  if (kind) els.engineStatus.classList.add(kind);
}

function updateToolbar() {
  const list = [...jobs.values()];
  const done = list.filter((j) => j.status === 'done').length;
  els.fileCount.textContent =
    list.length === 1 ? '1 file' : `${list.length} files` + (done ? ` · ${done} ready` : '');
  const busy = processing || list.some((j) => j.status === 'converting' || j.status === 'queued');
  els.clearBtn.disabled = busy || !list.length;
  els.downloadAllBtn.disabled = !done;
  els.dropZone.classList.toggle('is-disabled', !engineReady || busy);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderList() {
  const list = [...jobs.values()];
  updateToolbar();

  if (!list.length) {
    els.fileList.innerHTML = '<li class="file-list__empty">No files yet</li>';
    return;
  }

  els.fileList.innerHTML = list
    .map((job) => {
      const statusLabel =
        job.status === 'queued'
          ? 'Queued'
          : job.status === 'converting'
            ? `Converting… ${job.progress}%`
            : job.status === 'done'
              ? `Ready · ${formatBytes(job.mp4Blob?.size || 0)}`
              : job.status === 'error'
                ? job.error || 'Failed'
                : job.status;

      const downloadBtn =
        job.status === 'done' && job.mp4Blob
          ? `<button type="button" class="btn btn--primary" data-download="${job.id}">Download</button>`
          : '';

      return `
        <li class="file-item ${job.status === 'done' ? 'is-done' : ''} ${job.status === 'error' ? 'is-error' : ''}" data-id="${job.id}">
          <div class="file-item__main">
            <p class="file-item__name" title="${escapeHtml(job.name)}">${escapeHtml(job.name)}</p>
            <p class="file-item__meta">${escapeHtml(job.mp4Name)} · ${escapeHtml(statusLabel)}</p>
          </div>
          <div class="file-item__actions">
            ${downloadBtn}
            <button type="button" class="btn" data-remove="${job.id}" ${processing ? 'disabled' : ''}>Remove</button>
          </div>
          <div class="file-item__bar" aria-hidden="true">
            <div class="file-item__bar-fill" style="width:${job.progress}%"></div>
          </div>
        </li>
      `;
    })
    .join('');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileToBytes(file) {
  return file.arrayBuffer().then((buf) => new Uint8Array(buf));
}

async function loadEngine() {
  try {
    setEngineStatus('Loading converter (first time may take a moment)…');
    ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      const pct = Math.min(99, Math.round((progress || 0) * 100));
      for (const job of jobs.values()) {
        if (job.status === 'converting') job.progress = pct;
      }
      renderList();
    });

    await ffmpeg.load({
      coreURL: `${VENDOR}ffmpeg-core.js`,
      wasmURL: `${VENDOR}ffmpeg-core.wasm`,
    });

    engineReady = true;
    setEngineStatus('Converter ready — drop WebM files to start', 'is-ready');
    els.dropZone.classList.remove('is-disabled');
  } catch (err) {
    console.error(err);
    setEngineStatus(`Could not load converter: ${err?.message || err}`, 'is-error');
  }
}

async function convertJob(job) {
  if (!ffmpeg) throw new Error('Converter not ready');

  const inName = `in-${job.id}.webm`;
  const outName = `out-${job.id}.mp4`;

  job.status = 'converting';
  job.progress = 0;
  renderList();

  await ffmpeg.writeFile(inName, await fileToBytes(job.input));
  await ffmpeg.exec([
    '-i',
    inName,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outName,
  ]);

  const data = await ffmpeg.readFile(outName);
  job.mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
  job.status = 'done';
  job.progress = 100;

  try {
    await ffmpeg.deleteFile(inName);
    await ffmpeg.deleteFile(outName);
  } catch {
    /* ignore cleanup errors */
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  updateToolbar();

  try {
    for (const job of jobs.values()) {
      if (job.status !== 'queued') continue;
      try {
        await convertJob(job);
      } catch (err) {
        console.error(err);
        job.status = 'error';
        job.error = err?.message || 'Conversion failed';
        job.progress = 100;
      }
      renderList();
    }
  } finally {
    processing = false;
    updateToolbar();
    renderList();
  }
}

function addFiles(fileList) {
  const files = [...fileList].filter(
    (f) => f.type === 'video/webm' || /\.webm$/i.test(f.name)
  );
  if (!files.length) return;

  for (const file of files) {
    const id = uuid();
    jobs.set(id, {
      id,
      name: file.name,
      input: file,
      status: 'queued',
      progress: 0,
      mp4Blob: null,
      mp4Name: mp4NameFor(file),
      error: '',
    });
  }

  renderList();
  processQueue();
}

els.dropZone.addEventListener('click', () => {
  if (!engineReady || processing) return;
  els.fileInput.click();
});

els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files?.length) addFiles(els.fileInput.files);
  els.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) => {
  els.dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    if (!engineReady || processing) return;
    els.dropZone.classList.add('is-dragover');
  });
});

['dragleave', 'drop'].forEach((type) => {
  els.dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('is-dragover');
    if (type !== 'drop' || !engineReady || processing) return;
    addFiles(e.dataTransfer?.files || []);
  });
});

els.fileList.addEventListener('click', (e) => {
  const dl = e.target.closest('[data-download]');
  if (dl) {
    const job = jobs.get(dl.getAttribute('data-download'));
    if (job?.mp4Blob) downloadBlob(job.mp4Blob, job.mp4Name);
    return;
  }

  const rm = e.target.closest('[data-remove]');
  if (!rm || processing) return;
  jobs.delete(rm.getAttribute('data-remove'));
  renderList();
});

els.clearBtn.addEventListener('click', () => {
  if (processing) return;
  jobs.clear();
  renderList();
});

els.downloadAllBtn.addEventListener('click', () => {
  const done = [...jobs.values()].filter((j) => j.status === 'done' && j.mp4Blob);
  if (!done.length) return;

  done.forEach((job, i) => {
    setTimeout(() => downloadBlob(job.mp4Blob, job.mp4Name), i * 450);
  });
});

loadEngine();
