import * as pdfViewer from './pdf-viewer.js';
import {
  loadSignatures,
  addSignature,
  removeSignature,
  renderSignatureGrid,
  saveSignatures,
} from './signature-store.js';
import { initSignatureModal } from './signature-modal.js';
import {
  initPlacement,
  startPlacementMode,
  cancelPlacementMode,
  getPlacementMode,
} from './placement.js';
import {
  initAnnotations,
  getAnnotations,
  clearAnnotations,
} from './annotations.js';
import { initTransform, renderOverlays, clearSelection, getSelectedId } from './transform.js';
import { exportSignedPdf } from './export.js';
import { initTools, setActiveTool, cancelActiveTool, setToolsEnabled, refreshToolPreview } from './tools.js';
import { initPenTool } from './pen-tool.js';
import {
  isImageDocument,
  isPdfDocument,
  imageFileToPdfBytes,
} from './image-utils.js';

let selectedSavedId = null;

function refreshUI() {
  const selected = getSelectedId();
  if (selected && !getAnnotations().some((p) => p.id === selected)) {
    clearSelection();
  }
  renderOverlays();
  updateButtons();
  renderSidebarSignatures();
}

function renderSidebarSignatures() {
  const mode = getPlacementMode();
  const hasPdf = !!pdfViewer.getState().pdfDoc;
  const grid = document.getElementById('signatureGrid');
  grid.classList.toggle('signatures-disabled', !hasPdf);

  renderSignatureGrid(grid, loadSignatures(), {
    onSelect: (sig) => {
      if (!hasPdf) return;
      cancelActiveTool();
      selectedSavedId = sig.id;
      document.getElementById('btnDeleteSaved').disabled = false;
      startPlacementMode(sig.id);
      renderSidebarSignatures();
    },
    activePlacementId: mode.active ? mode.signatureId : null,
    selectedSavedId,
    disabled: !hasPdf,
  });
}

function updateButtons() {
  const hasPdf = !!pdfViewer.getState().pdfDoc;
  const hasItems = getAnnotations().length > 0;

  document.getElementById('btnClear').disabled = !hasPdf;
  document.getElementById('btnDownload').disabled = !hasPdf || !hasItems;
  setToolsEnabled(hasPdf);
}

async function loadDocumentFile(file) {
  const isPdf = isPdfDocument(file);
  const isImage = isImageDocument(file);
  if (!isPdf && !isImage) {
    alert('Please choose a PDF or photo (JPG, PNG, WebP).');
    return;
  }

  const items = getAnnotations();
  if (items.length && !confirm('Replace document? All annotations will be cleared.')) return;

  try {
    let buffer;
    if (isImage) {
      buffer = await imageFileToPdfBytes(file);
    } else {
      buffer = await file.arrayBuffer();
    }
    await pdfViewer.loadPdf(buffer, file.name);
  } catch (err) {
    alert('Could not open file: ' + (err.message || err));
    return;
  }

  clearAnnotations();
  clearSelection();
  cancelPlacementMode();
  cancelActiveTool();

  pdfViewer.showViewer(true);
  document.getElementById('fileName').hidden = false;
  document.getElementById('fileName').textContent = file.name;
  refreshUI();
}

function clearAll() {
  if (!pdfViewer.getState().pdfDoc) return;
  if (getAnnotations().length && !confirm('Clear document and all annotations?')) return;

  pdfViewer.clearPdf();
  clearAnnotations();
  clearSelection();
  cancelPlacementMode();
  cancelActiveTool();
  pdfViewer.showViewer(false);
  document.getElementById('fileName').hidden = true;
  refreshUI();
}

async function downloadPdf() {
  const btn = document.getElementById('btnDownload');
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  try {
    await exportSignedPdf(getAnnotations());
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download Signed PDF`;
    updateButtons();
  }
}

function init() {
  initAnnotations(() => {
    updateButtons();
    renderOverlays();
  });

  pdfViewer.wireDropzone(loadDocumentFile);
  pdfViewer.wireViewerControls();

  pdfViewer.setOnRenderComplete(() => {
    renderOverlays();
    refreshToolPreview();
  });

  initSignatureModal(async (name, dataUrl) => {
    addSignature(name, dataUrl);
    renderSidebarSignatures();
  });

  initTools({
    onChange: () => {
      renderSidebarSignatures();
      renderOverlays();
    },
    cancelPlacement: cancelPlacementMode,
  });

  initPlacement({
    onModeChange: () => {
      renderSidebarSignatures();
      renderOverlays();
    },
    cancelTool: cancelActiveTool,
  });

  initPenTool({ onStrokeComplete: refreshUI });

  initTransform({
    onSelect: () => {},
    onRefresh: refreshUI,
  });

  document.getElementById('btnClear').addEventListener('click', clearAll);
  document.getElementById('btnDownload').addEventListener('click', downloadPdf);

  document.getElementById('btnDeleteSaved').addEventListener('click', () => {
    if (!selectedSavedId) return;
    if (!confirm('Delete this saved signature?')) return;
    removeSignature(selectedSavedId);
    selectedSavedId = null;
    document.getElementById('btnDeleteSaved').disabled = true;
    renderSidebarSignatures();
  });

  document.querySelector('.sidebar').addEventListener('click', (e) => {
    if (e.target.closest('.signature-thumb') || e.target.closest('#btnNewSignature')) return;
    if (e.target.closest('.tool-btn') || e.target.closest('#toolOptions')) return;
    if (getPlacementMode().active) {
      cancelPlacementMode();
      renderSidebarSignatures();
    }
    cancelActiveTool();
  });

  renderSidebarSignatures();
  updateButtons();
  migrateStoredSignatures();
}

async function migrateStoredSignatures() {
  const sigs = loadSignatures();
  if (!sigs.length) return;

  const { processSignatureDataUrl } = await import('./image-utils.js');
  let changed = false;

  for (let i = 0; i < sigs.length; i++) {
    try {
      const processed = await processSignatureDataUrl(sigs[i].dataUrl);
      if (processed !== sigs[i].dataUrl) {
        sigs[i].dataUrl = processed;
        changed = true;
      }
    } catch {
      /* keep original */
    }
  }

  if (changed) {
    saveSignatures(sigs);
    renderSidebarSignatures();
  }
}

init();
