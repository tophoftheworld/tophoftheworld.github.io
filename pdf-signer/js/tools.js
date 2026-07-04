import * as pdfViewer from './pdf-viewer.js';

let activeTool = null;
let onToolChange = null;
let cancelPlacementFn = null;
let savedTextSizePt = 14;
let savedPenWidthStep = 3;

const TEXT_MIN_PT = 8;
const PREVIEW_SAMPLE = 'Sample';

export const CHECK_SIZE_PDF = 22;

export function initTools({ onChange, cancelPlacement }) {
  onToolChange = onChange;
  cancelPlacementFn = cancelPlacement;

  for (const { id, tool } of [
    { id: 'btnToolText', tool: 'text' },
    { id: 'btnToolCheck', tool: 'check' },
    { id: 'btnToolPen', tool: 'pen' },
  ]) {
    document.getElementById(id).addEventListener('click', () => {
      if (!pdfViewer.getState().pdfDoc) return;
      setActiveTool(activeTool === tool ? null : tool);
    });
  }

  const toolOptions = document.getElementById('toolOptions');
  toolOptions.addEventListener('click', (e) => e.stopPropagation());
  toolOptions.addEventListener('mousedown', (e) => e.stopPropagation());

  document.getElementById('toolSize').addEventListener('input', () => {
    persistSizeFromSlider();
    updateToolOptionsUI();
  });

  window.addEventListener('resize', () => {
    if (activeTool === 'text') updateToolOptionsUI();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeTool) setActiveTool(null);
  });
}

function persistSizeFromSlider() {
  const val = parseInt(document.getElementById('toolSize').value, 10);
  if (activeTool === 'text') savedTextSizePt = val;
  else if (activeTool === 'pen') savedPenWidthStep = val;
}

function getPreviewScale() {
  return pdfViewer.getState().pdfDoc ? pdfViewer.getRenderScale() : 1.5;
}

function measureMaxTextSizePt() {
  const scale = getPreviewScale();
  return fitMaxPtForWidth(getPreviewInnerWidth(), scale);
}

function getPreviewInnerWidth() {
  const page = document.getElementById('textSizePreviewPage');
  if (page && page.offsetWidth > 50) return page.clientWidth - 16;
  const sidebar = document.querySelector('.sidebar');
  return sidebar ? sidebar.clientWidth - 48 : 240;
}

function fitMaxPtForWidth(maxWidthPx, scale) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let lo = TEXT_MIN_PT;
  let hi = 72;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    ctx.font = `${mid * scale}px Inter, sans-serif`;
    if (ctx.measureText(PREVIEW_SAMPLE).width <= maxWidthPx) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

function configureSizeSlider() {
  const slider = document.getElementById('toolSize');
  if (activeTool === 'text') {
    const maxPt = measureMaxTextSizePt();
    savedTextSizePt = Math.min(Math.max(savedTextSizePt, TEXT_MIN_PT), maxPt);
    slider.min = TEXT_MIN_PT;
    slider.max = maxPt;
    slider.step = 1;
    slider.value = savedTextSizePt;
  } else if (activeTool === 'pen') {
    slider.min = 1;
    slider.max = 12;
    slider.step = 1;
    slider.value = savedPenWidthStep;
  }
}

export function setActiveTool(tool) {
  if (activeTool === 'text') {
    savedTextSizePt = parseInt(document.getElementById('toolSize').value, 10) || savedTextSizePt;
  }
  if (activeTool === 'pen') {
    savedPenWidthStep = parseInt(document.getElementById('toolSize').value, 10) || savedPenWidthStep;
  }

  activeTool = tool;
  if (cancelPlacementFn) cancelPlacementFn();

  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  const overlay = document.getElementById('overlayLayer');
  overlay.classList.toggle('tool-text', tool === 'text');
  overlay.classList.toggle('tool-check', tool === 'check');
  overlay.classList.toggle('tool-pen', tool === 'pen');
  overlay.classList.toggle('tool-active', tool === 'text' || tool === 'check');

  const penLayer = document.getElementById('penLayer');
  if (penLayer) {
    penLayer.style.pointerEvents = tool === 'pen' ? 'auto' : 'none';
    penLayer.style.cursor = tool === 'pen' ? 'crosshair' : 'default';
  }

  if (tool !== 'pen') {
    import('./pen-tool.js').then((m) => m.clearPenLayer());
  }

  if (tool === 'text' || tool === 'pen') configureSizeSlider();
  updateToolOptionsUI();

  if (onToolChange) onToolChange(activeTool);
}

function updateToolOptionsUI() {
  const options = document.getElementById('toolOptions');
  const textPreview = document.getElementById('textSizePreview');
  const isText = activeTool === 'text';
  const isPen = activeTool === 'pen';

  options.hidden = !isText && !isPen;
  document.getElementById('toolSizeLabel').textContent = isText ? 'Text size' : 'Pen width';
  textPreview.hidden = !isText;

  if (!isText) return;

  const scale = getPreviewScale();
  const maxPt = measureMaxTextSizePt();
  const slider = document.getElementById('toolSize');

  slider.min = TEXT_MIN_PT;
  slider.max = maxPt;
  if (savedTextSizePt > maxPt) {
    savedTextSizePt = maxPt;
    slider.value = maxPt;
  }

  const pt = savedTextSizePt;
  const sample = document.getElementById('textSizeSample');
  const page = document.getElementById('textSizePreviewPage');

  sample.style.fontSize = `${pt * scale}px`;
  document.getElementById('textSizePt').textContent = `${pt} pt`;
  document.getElementById('textSizeZoomNote').textContent = 'Same size as on the PDF';

  requestAnimationFrame(() => {
    const textH = sample.getBoundingClientRect().height;
    page.style.minHeight = `${Math.ceil(textH + 24)}px`;
  });
}

export function refreshToolPreview() {
  updateToolOptionsUI();
}

export function getActiveTool() {
  return activeTool;
}

export function cancelActiveTool() {
  if (activeTool) setActiveTool(null);
}

export function setToolsEnabled(enabled) {
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.disabled = !enabled;
  });
  if (!enabled) setActiveTool(null);
}

export function getTextSizePt() {
  return savedTextSizePt;
}

export function getPenWidthPt() {
  return 0.4 + savedPenWidthStep * 0.45;
}

export function getToolSize() {
  if (activeTool === 'text') return getTextSizePt();
  if (activeTool === 'pen') return getPenWidthPt();
  return getTextSizePt();
}
