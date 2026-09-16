import * as pdfViewer from './pdf-viewer.js';
import { addAnnotation } from './annotations.js';
import { screenPointToPdf } from './coords.js';
import { getToolSize } from './tools.js';

let drawing = false;
let currentPoints = [];
let activeLayer = null;
let activePageIndex = -1;
let activeCtx = null;

export function initPenTool({ onStrokeComplete }) {
  const container = document.getElementById('pagesContainer');

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const layer = e.target.closest('.pen-layer');
    if (!layer) return;

    const wrap = layer.closest('.page-wrap');
    if (!wrap) return;

    e.preventDefault();
    drawing = true;
    currentPoints = [];
    activeLayer = layer;
    activePageIndex = Number(wrap.dataset.pageIndex);
    activeCtx = layer.getContext('2d');
    layer.setPointerCapture(e.pointerId);
    addPoint(e);
  });

  container.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    addPoint(e);
    redrawCurrent();
  });

  container.addEventListener('pointerup', (e) => {
    if (!drawing) return;
    drawing = false;
    if (activeLayer) activeLayer.releasePointerCapture(e.pointerId);
    finishStroke(onStrokeComplete);
  });

  container.addEventListener('pointercancel', () => {
    drawing = false;
    currentPoints = [];
    clearPenLayer();
    activeLayer = null;
    activeCtx = null;
    activePageIndex = -1;
  });
}

function layerPoint(e) {
  const rect = activeLayer.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function addPoint(e) {
  const screen = layerPoint(e);
  const pageSize = pdfViewer.getPageSize(activePageIndex);
  const scale = pdfViewer.getRenderScale();
  const pdf = screenPointToPdf(screen.x, screen.y, pageSize.height, scale);
  currentPoints.push(pdf);
}

function redrawCurrent() {
  clearPenLayer();
  if (currentPoints.length < 2 || !activeCtx) return;

  const pageSize = pdfViewer.getPageSize(activePageIndex);
  const scale = pdfViewer.getRenderScale();
  const width = getToolSize() * scale;

  activeCtx.strokeStyle = '#000';
  activeCtx.lineWidth = width;
  activeCtx.lineCap = 'round';
  activeCtx.lineJoin = 'round';
  activeCtx.beginPath();

  for (let i = 0; i < currentPoints.length; i++) {
    const sx = currentPoints[i].x * scale;
    const sy = (pageSize.height - currentPoints[i].y) * scale;
    if (i === 0) activeCtx.moveTo(sx, sy);
    else activeCtx.lineTo(sx, sy);
  }
  activeCtx.stroke();
}

function finishStroke(onStrokeComplete) {
  clearPenLayer();
  const pageIndex = activePageIndex;
  const points = currentPoints;

  currentPoints = [];
  activeLayer = null;
  activeCtx = null;
  activePageIndex = -1;

  if (points.length < 2) return;

  addAnnotation({
    id: crypto.randomUUID(),
    type: 'pen',
    pageIndex,
    points: [...points],
    lineWidth: getToolSize(),
    color: '#000000',
  });

  if (onStrokeComplete) onStrokeComplete();
}

export function clearPenLayer() {
  if (!activeLayer || !activeCtx) return;
  activeCtx.clearRect(0, 0, activeLayer.width, activeLayer.height);
}

export function cancelPenDrawing() {
  drawing = false;
  currentPoints = [];
  clearPenLayer();
  activeLayer = null;
  activeCtx = null;
  activePageIndex = -1;
}
