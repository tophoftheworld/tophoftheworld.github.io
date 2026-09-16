import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

let pdfDoc = null;
let pdfBytes = null;
let fileName = '';
let currentPage = 0;
let renderScale = 1.5;
let zoomMode = '1';
let pageSizes = [];
let pageEls = [];

const pagesContainer = () => document.getElementById('pagesContainer');

let onRenderComplete = null;

export function getState() {
  return { pdfDoc, pdfBytes, fileName, currentPage, renderScale, pageSizes };
}

export function setOnRenderComplete(fn) {
  onRenderComplete = fn;
}

export async function loadPdf(arrayBuffer, name) {
  pdfBytes = arrayBuffer.slice(0);
  fileName = name;
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  currentPage = 0;
  pageSizes = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });
  }

  buildPageElements();
  await renderAllPages();
  updatePageControls();
  return { numPages: pdfDoc.numPages, fileName };
}

export function clearPdf() {
  pdfDoc = null;
  pdfBytes = null;
  fileName = '';
  currentPage = 0;
  pageSizes = [];
  pageEls = [];
  const container = pagesContainer();
  if (container) container.innerHTML = '';
}

export function getPageSize(pageIndex) {
  return pageSizes[pageIndex] || { width: 0, height: 0 };
}

/** DOM layers for a given page: { wrap, canvas, overlay, penLayer }. */
export function getPageEls(pageIndex) {
  return pageEls[pageIndex] || null;
}

export function eachPage(cb) {
  pageEls.forEach((els, i) => cb(els, i));
}

function buildPageElements() {
  const container = pagesContainer();
  container.innerHTML = '';
  pageEls = [];

  for (let i = 0; i < pdfDoc.numPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.pageIndex = String(i);

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';

    const overlay = document.createElement('div');
    overlay.className = 'overlay-layer';

    const penLayer = document.createElement('canvas');
    penLayer.className = 'pen-layer';

    wrap.append(canvas, overlay, penLayer);
    container.appendChild(wrap);

    pageEls.push({ wrap, canvas, overlay, penLayer });
  }
}

async function renderPage(pageIndex) {
  const els = pageEls[pageIndex];
  if (!els) return;

  const page = await pdfDoc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: renderScale });

  const { wrap, canvas, overlay, penLayer } = els;
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  wrap.style.width = `${viewport.width}px`;
  wrap.style.height = `${viewport.height}px`;

  overlay.style.width = `${viewport.width}px`;
  overlay.style.height = `${viewport.height}px`;

  penLayer.width = viewport.width;
  penLayer.height = viewport.height;
  penLayer.style.width = `${viewport.width}px`;
  penLayer.style.height = `${viewport.height}px`;

  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function renderAllPages() {
  if (!pdfDoc) return;
  for (let i = 0; i < pdfDoc.numPages; i++) {
    await renderPage(i);
  }
  if (onRenderComplete) onRenderComplete();
}

export function goToPage(index) {
  if (!pdfDoc || index < 0 || index >= pdfDoc.numPages) return false;
  currentPage = index;
  const els = pageEls[index];
  const scroll = document.getElementById('viewerScroll');
  if (els && scroll) {
    const wrapRect = els.wrap.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    scroll.scrollTop += wrapRect.top - scrollRect.top - 16;
  }
  updatePageControls();
  return true;
}

export function nextPage() {
  return goToPage(currentPage + 1);
}

export function prevPage() {
  return goToPage(currentPage - 1);
}

function computeCurrentPageFromScroll() {
  const scroll = document.getElementById('viewerScroll');
  if (!scroll || !pageEls.length) return 0;
  const scrollRect = scroll.getBoundingClientRect();
  const mid = scrollRect.top + scroll.clientHeight / 2;

  let best = 0;
  let bestDist = Infinity;
  pageEls.forEach((els, i) => {
    const r = els.wrap.getBoundingClientRect();
    const center = r.top + r.height / 2;
    const d = Math.abs(center - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function updatePageControls() {
  const indicator = document.getElementById('pageIndicator');
  const btnPrev = document.getElementById('btnPrevPage');
  const btnNext = document.getElementById('btnNextPage');

  if (!pdfDoc) {
    indicator.textContent = '—';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }

  indicator.textContent = `${currentPage + 1} / ${pdfDoc.numPages}`;
  btnPrev.disabled = currentPage <= 0;
  btnNext.disabled = currentPage >= pdfDoc.numPages - 1;
}

export async function setZoom(mode) {
  zoomMode = mode;

  if (mode === 'fit') {
    const scroll = document.getElementById('viewerScroll');
    const pageSize = getPageSize(currentPage);
    const available = scroll.clientWidth - 64;
    renderScale = Math.max(0.5, Math.min(available / pageSize.width, 3));
  } else {
    renderScale = parseFloat(mode) * 1.5;
  }

  document.querySelectorAll('.btn-zoom').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.zoom === mode);
  });

  await renderAllPages();
}

export function getRenderScale() {
  return renderScale;
}

export function getCurrentPage() {
  return currentPage;
}

export function getNumPages() {
  return pdfDoc ? pdfDoc.numPages : 0;
}

export function getPdfBytes() {
  return pdfBytes;
}

export function getFileName() {
  return fileName;
}

export function showViewer(show) {
  document.getElementById('dropzone').hidden = show;
  document.getElementById('viewer').hidden = !show;
}

export function wireViewerControls() {
  document.getElementById('btnPrevPage').addEventListener('click', prevPage);
  document.getElementById('btnNextPage').addEventListener('click', nextPage);

  document.querySelectorAll('.btn-zoom').forEach((btn) => {
    btn.addEventListener('click', () => setZoom(btn.dataset.zoom));
  });

  const scroll = document.getElementById('viewerScroll');
  scroll.addEventListener('scroll', () => {
    if (!pdfDoc) return;
    const page = computeCurrentPageFromScroll();
    if (page !== currentPage) {
      currentPage = page;
      updatePageControls();
    }
  });
}

export function wireDropzone(onFile) {
  const dropzone = document.getElementById('dropzone');
  const pdfInput = document.getElementById('pdfInput');
  const btnOpen = document.getElementById('btnOpen');

  const handleFiles = (files) => {
    const file = files?.[0];
    if (!file) return;
    onFile(file);
  };

  dropzone.addEventListener('click', () => pdfInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pdfInput.click();
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  pdfInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  btnOpen.addEventListener('click', () => pdfInput.click());
}
