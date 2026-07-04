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

const canvas = () => document.getElementById('pdfCanvas');
const pageWrap = () => document.getElementById('pageWrap');
const overlayLayer = () => document.getElementById('overlayLayer');

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

  await renderCurrentPage();
  updatePageControls();
  return { numPages: pdfDoc.numPages, fileName };
}

export function clearPdf() {
  pdfDoc = null;
  pdfBytes = null;
  fileName = '';
  currentPage = 0;
  pageSizes = [];
}

export function getPageSize(pageIndex) {
  return pageSizes[pageIndex] || { width: 0, height: 0 };
}

export async function renderCurrentPage() {
  if (!pdfDoc) return;

  const pageNum = currentPage + 1;
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: renderScale });

  const c = canvas();
  const ctx = c.getContext('2d');
  c.width = viewport.width;
  c.height = viewport.height;

  const wrap = pageWrap();
  wrap.style.width = `${viewport.width}px`;
  wrap.style.height = `${viewport.height}px`;

  const overlay = overlayLayer();
  overlay.style.width = `${viewport.width}px`;
  overlay.style.height = `${viewport.height}px`;

  const penLayer = document.getElementById('penLayer');
  if (penLayer) {
    penLayer.width = viewport.width;
    penLayer.height = viewport.height;
    penLayer.style.width = `${viewport.width}px`;
    penLayer.style.height = `${viewport.height}px`;
  }

  await page.render({ canvasContext: ctx, viewport }).promise;

  if (onRenderComplete) onRenderComplete();
}

export function goToPage(index) {
  if (!pdfDoc || index < 0 || index >= pdfDoc.numPages) return false;
  currentPage = index;
  renderCurrentPage();
  updatePageControls();
  return true;
}

export function nextPage() {
  return goToPage(currentPage + 1);
}

export function prevPage() {
  return goToPage(currentPage - 1);
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

  await renderCurrentPage();
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
}

export function wireDropzone(onFile) {
  const dropzone = document.getElementById('dropzone');
  const pdfInput = document.getElementById('pdfInput');
  const btnOpen = document.getElementById('btnOpen');

  const handleFiles = (files) => {
    const file = files[0];
    if (!file || file.type !== 'application/pdf') return;
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
