import * as pdfViewer from './pdf-viewer.js';
import { addAnnotation } from './annotations.js';
import { screenPointToPdf } from './coords.js';
import { getToolSize } from './tools.js';

let drawing = false;
let currentPoints = [];
let ctx = null;

export function initPenTool({ onStrokeComplete }) {
  const penLayer = document.getElementById('penLayer');
  ctx = penLayer.getContext('2d');

  penLayer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drawing = true;
    currentPoints = [];
    penLayer.setPointerCapture(e.pointerId);
    addPoint(e);
  });

  penLayer.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    addPoint(e);
    redrawCurrent();
  });

  penLayer.addEventListener('pointerup', (e) => {
    if (!drawing) return;
    drawing = false;
    penLayer.releasePointerCapture(e.pointerId);
    finishStroke(onStrokeComplete);
  });

  penLayer.addEventListener('pointercancel', () => {
    drawing = false;
    currentPoints = [];
    clearPenLayer();
  });
}

function overlayPoint(e) {
  const rect = document.getElementById('penLayer').getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function addPoint(e) {
  const screen = overlayPoint(e);
  const pageIndex = pdfViewer.getCurrentPage();
  const pageSize = pdfViewer.getPageSize(pageIndex);
  const scale = pdfViewer.getRenderScale();
  const pdf = screenPointToPdf(screen.x, screen.y, pageSize.height, scale);
  currentPoints.push(pdf);
}

function redrawCurrent() {
  clearPenLayer();
  if (currentPoints.length < 2) return;

  const pageIndex = pdfViewer.getCurrentPage();
  const pageSize = pdfViewer.getPageSize(pageIndex);
  const scale = pdfViewer.getRenderScale();
  const width = getToolSize() * scale;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  for (let i = 0; i < currentPoints.length; i++) {
    const sx = currentPoints[i].x * scale;
    const sy = (pageSize.height - currentPoints[i].y) * scale;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
}

function finishStroke(onStrokeComplete) {
  clearPenLayer();
  if (currentPoints.length < 2) {
    currentPoints = [];
    return;
  }

  const pageIndex = pdfViewer.getCurrentPage();
  addAnnotation({
    id: crypto.randomUUID(),
    type: 'pen',
    pageIndex,
    points: [...currentPoints],
    lineWidth: getToolSize(),
    color: '#000000',
  });

  currentPoints = [];
  if (onStrokeComplete) onStrokeComplete();
}

export function clearPenLayer() {
  const penLayer = document.getElementById('penLayer');
  if (!penLayer || !ctx) return;
  ctx.clearRect(0, 0, penLayer.width, penLayer.height);
}

export function resizePenLayer() {
  const penLayer = document.getElementById('penLayer');
  const canvas = document.getElementById('pdfCanvas');
  if (!penLayer || !canvas.width) return;
  penLayer.width = canvas.width;
  penLayer.height = canvas.height;
  penLayer.style.width = `${canvas.width}px`;
  penLayer.style.height = `${canvas.height}px`;
}

export function cancelPenDrawing() {
  drawing = false;
  currentPoints = [];
  clearPenLayer();
}
