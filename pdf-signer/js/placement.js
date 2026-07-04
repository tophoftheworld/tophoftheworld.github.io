import { getSignature, getImageDimensions } from './signature-store.js';
import { getSignaturePlacementSize, centerPdfRect, screenPointToPdf } from './coords.js';
import * as pdfViewer from './pdf-viewer.js';
import { addAnnotation } from './annotations.js';
import { getActiveTool, CHECK_SIZE_PDF, getToolSize } from './tools.js';

let placementMode = { active: false, signatureId: null };
let onPlacementModeChange = null;
let cancelToolFn = null;

export function initPlacement({ onModeChange, cancelTool }) {
  onPlacementModeChange = onModeChange;
  cancelToolFn = cancelTool;

  const ghost = document.getElementById('placementGhost');
  const overlay = document.getElementById('overlayLayer');

  document.addEventListener('mousemove', (e) => {
    if (!placementMode.active) return;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
  });

  overlay.addEventListener('click', async (e) => {
    if (e.target.closest('.placed-item') || e.target.closest('.text-editor-inline')) return;
    if (!pdfViewer.getState().pdfDoc) return;

    const rect = overlay.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const pageIndex = pdfViewer.getCurrentPage();
    const pageSize = pdfViewer.getPageSize(pageIndex);
    const scale = pdfViewer.getRenderScale();
    const pdfPoint = screenPointToPdf(clickX, clickY, pageSize.height, scale);

    if (placementMode.active) {
      await placeSignature(pdfPoint, pageIndex, scale);
      return;
    }

    const tool = getActiveTool();
    if (tool === 'check') placeCheck(pdfPoint, pageIndex);
    else if (tool === 'text') placeTextEditor(clickX, clickY, pdfPoint, pageIndex, scale);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placementMode.active) cancelPlacementMode();
  });
}

async function placeSignature(pdfPoint, pageIndex, scale) {
  const sig = getSignature(placementMode.signatureId);
  if (!sig) return;

  const dims = await getImageDimensions(sig.dataUrl);
  const size = getSignaturePlacementSize(dims.width, dims.height, scale);
  const pdfRect = centerPdfRect(pdfPoint.x, pdfPoint.y, size.width, size.height);

  addAnnotation({
    id: crypto.randomUUID(),
    type: 'signature',
    signatureId: sig.id,
    pageIndex,
    x: pdfRect.x,
    y: pdfRect.y,
    width: pdfRect.width,
    height: pdfRect.height,
    rotation: 0,
  });

  cancelPlacementMode();
}

function placeCheck(pdfPoint, pageIndex) {
  const size = CHECK_SIZE_PDF;
  const pdfRect = centerPdfRect(pdfPoint.x, pdfPoint.y, size, size);
  addAnnotation({
    id: crypto.randomUUID(),
    type: 'check',
    pageIndex,
    x: pdfRect.x,
    y: pdfRect.y,
    size,
    rotation: 0,
  });
}

function placeTextEditor(screenX, screenY, pdfPoint, pageIndex, scale) {
  const overlay = document.getElementById('overlayLayer');
  overlay.querySelectorAll('.text-editor-inline').forEach((el) => el.remove());

  const fontSize = getToolSize();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text-editor-inline';
  input.placeholder = 'Type here';
  input.style.left = `${screenX}px`;
  input.style.top = `${screenY}px`;
  input.style.fontSize = `${fontSize * scale}px`;

  const commit = () => {
    const text = input.value.trim();
    input.remove();
    if (!text) return;
    addAnnotation({
      id: crypto.randomUUID(),
      type: 'text',
      pageIndex,
      x: pdfPoint.x,
      y: pdfPoint.y,
      text,
      fontSize,
      color: '#000000',
      rotation: 0,
    });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') input.remove();
  });
  input.addEventListener('blur', commit);

  overlay.appendChild(input);
  input.focus();
}

export async function startPlacementMode(signatureId) {
  if (!pdfViewer.getState().pdfDoc) return;
  const sig = getSignature(signatureId);
  if (!sig) return;

  if (cancelToolFn) cancelToolFn();
  placementMode = { active: true, signatureId };

  const ghost = document.getElementById('placementGhost');
  const ghostImg = document.getElementById('placementGhostImg');
  ghostImg.src = sig.dataUrl;

  const dims = await getImageDimensions(sig.dataUrl);
  const scale = pdfViewer.getRenderScale();
  const size = getSignaturePlacementSize(dims.width, dims.height, scale);
  ghostImg.style.width = `${size.screenWidth}px`;
  ghostImg.style.height = `${size.screenHeight}px`;
  ghost.hidden = false;

  document.getElementById('overlayLayer').classList.add('placement-mode', 'interactive');
  if (onPlacementModeChange) onPlacementModeChange(placementMode);
}

export function cancelPlacementMode() {
  placementMode = { active: false, signatureId: null };
  const ghost = document.getElementById('placementGhost');
  const ghostImg = document.getElementById('placementGhostImg');
  ghost.hidden = true;
  ghostImg.style.width = '';
  ghostImg.style.height = '';

  const overlay = document.getElementById('overlayLayer');
  overlay.classList.remove('placement-mode');
  if (onPlacementModeChange) onPlacementModeChange(placementMode);
}

export function getPlacementMode() {
  return placementMode;
}

export { addAnnotation } from './annotations.js';
