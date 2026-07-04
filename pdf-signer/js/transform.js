import { getSignature } from './signature-store.js';
import { pdfRectToScreen, screenRectToPdf } from './coords.js';
import * as pdfViewer from './pdf-viewer.js';
import { getActiveTool } from './tools.js';
import {
  getForPage,
  updateAnnotation,
  removeAnnotation,
} from './annotations.js';

let selectedId = null;
let onSelectChange = null;
let onRefresh = null;

export function initTransform({ onSelect, onRefresh: refresh }) {
  onSelectChange = onSelect;
  onRefresh = refresh;

  document.getElementById('btnDeletePlaced').addEventListener('click', deleteSelected);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && selectedId) deleteSelected();
    if (e.key === 'Escape' && selectedId) selectPlaced(null);
  });

  document.getElementById('viewerScroll').addEventListener('mousedown', (e) => {
    if (!selectedId) return;
    if (e.target.closest('.placed-item')) return;
    if (e.target.closest('#transformToolbar')) return;
    if (e.target.closest('.text-editor-inline')) return;
    selectPlaced(null);
  });

  document.querySelector('.sidebar').addEventListener('mousedown', (e) => {
    if (e.target.closest('#toolOptions')) return;
    if (selectedId) selectPlaced(null);
  });
}

export function renderOverlays() {
  const overlay = document.getElementById('overlayLayer');
  const pageIndex = pdfViewer.getCurrentPage();
  const pageSize = pdfViewer.getPageSize(pageIndex);
  const scale = pdfViewer.getRenderScale();
  const items = getForPage(pageIndex);

  overlay.querySelectorAll('.placed-item, .pen-stroke').forEach((el) => el.remove());

  const hasInteractive =
    items.length > 0 ||
    overlay.classList.contains('placement-mode') ||
    overlay.classList.contains('tool-active') ||
    getActiveTool() === 'pen';
  overlay.classList.toggle('interactive', hasInteractive);

  for (const ann of items) {
    if (ann.type === 'pen') renderPenStroke(overlay, ann, pageSize, scale);
    else renderBoxItem(overlay, ann, pageSize, scale);
  }

  positionToolbar();
}

function renderPenStroke(overlay, ann, pageSize, scale) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('pen-stroke', 'placed-item');
  svg.dataset.id = ann.id;
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'stroke';

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const d = ann.points
    .map((p, i) => {
      const sx = p.x * scale;
      const sy = (pageSize.height - p.y) * scale;
      return `${i === 0 ? 'M' : 'L'} ${sx} ${sy}`;
    })
    .join(' ');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', ann.color || '#000');
  path.setAttribute('stroke-width', ann.lineWidth * scale);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  if (ann.id === selectedId) path.setAttribute('stroke', '#2b9348');
  svg.appendChild(path);

  wirePenInteraction(svg, ann, pageSize, scale);
  overlay.appendChild(svg);
}

function textMetrics(ann, scale) {
  const fontSize = ann.fontSize * scale;
  const width = Math.max(ann.text.length * ann.fontSize * 0.55 * scale, 40);
  const height = fontSize * 1.3;
  return { fontSize, width, height };
}

function getAnnRect(ann, pageSize, scale) {
  if (ann.type === 'text') {
    const { width, height } = textMetrics(ann, scale);
    return {
      x: ann.x,
      y: ann.y,
      width: width / scale,
      height: height / scale,
    };
  }
  if (ann.type === 'check') {
    return { x: ann.x, y: ann.y, width: ann.size, height: ann.size };
  }
  return { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
}

function renderBoxItem(overlay, ann, pageSize, scale) {
  const rect = getAnnRect(ann, pageSize, scale);
  const screen = pdfRectToScreen(rect, pageSize.height, scale);
  const el = document.createElement('div');
  el.className = 'placed-item';
  if (ann.type === 'text') el.classList.add('placed-text');
  if (ann.type === 'check') el.classList.add('placed-check');
  if (ann.type === 'signature') el.classList.add('placed-signature');
  el.dataset.id = ann.id;
  el.style.left = `${screen.left}px`;
  el.style.top = `${screen.top}px`;
  el.style.width = `${screen.width}px`;
  el.style.height = `${screen.height}px`;
  el.style.transform = `rotate(${ann.rotation || 0}deg)`;

  if (ann.type === 'signature') {
    const sig = getSignature(ann.signatureId);
    if (!sig) return;
    const img = document.createElement('img');
    img.src = sig.dataUrl;
    img.alt = 'Signature';
    el.appendChild(img);
  } else if (ann.type === 'text') {
    el.textContent = ann.text;
    el.style.fontSize = `${ann.fontSize * scale}px`;
    el.style.color = ann.color || '#000';
  } else if (ann.type === 'check') {
    el.textContent = '✓';
    el.style.fontSize = `${ann.size * scale * 0.9}px`;
  }

  if (ann.id === selectedId && ann.type !== 'pen') {
    el.classList.add('selected');
    el.appendChild(Object.assign(document.createElement('div'), { className: 'sig-border' }));
    if (ann.type !== 'pen') addHandles(el, ann, pageSize, scale);
  }

  wireBoxInteraction(el, ann, pageSize, scale);
  overlay.appendChild(el);
}

function addHandles(el, ann, pageSize, scale) {
  const handles = ann.type === 'text' ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'ne', 'sw', 'se', 'rotate'];
  for (const h of handles) {
    const handle = document.createElement('div');
    handle.className = h === 'rotate' ? 'handle handle-rotate' : `handle handle-${h}`;
    handle.dataset.handle = h;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (h === 'rotate') startRotate(e, el, ann);
      else startResize(e, el, ann, pageSize, scale, h);
    });
    el.appendChild(handle);
  }
}

function wirePenInteraction(svg, ann, pageSize, scale) {
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectPlaced(ann.id, { refresh: false });

    const startX = e.clientX;
    const startY = e.clientY;
    const startPoints = ann.points.map((p) => ({ ...p }));
    let moved = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      const ddx = dx / scale;
      const ddy = -dy / scale;
      ann.points = startPoints.map((p) => ({ x: p.x + ddx, y: p.y + ddy }));
      const path = svg.querySelector('path');
      const d = ann.points
        .map((p, i) => {
          const sx = p.x * scale;
          const sy = (pageSize.height - p.y) * scale;
          return `${i === 0 ? 'M' : 'L'} ${sx} ${sy}`;
        })
        .join(' ');
      path.setAttribute('d', d);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) updateAnnotation(ann.id, { points: ann.points }, { silent: true });
      if (onRefresh) onRefresh();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function wireBoxInteraction(el, ann, pageSize, scale) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.dataset?.handle) return;
    e.preventDefault();
    e.stopPropagation();
    selectPlaced(ann.id, { refresh: false });
    positionToolbar();

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(el.style.left);
    const startTop = parseFloat(el.style.top);
    const w = parseFloat(el.style.width);
    const h = parseFloat(el.style.height);
    let moved = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      el.style.left = `${startLeft + dx}px`;
      el.style.top = `${startTop + dy}px`;
      positionToolbar();
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (moved) {
        const pdfRect = screenRectToPdf(
          { left: startLeft + dx, top: startTop + dy, width: w, height: h },
          pageSize.height,
          scale
        );
        if (ann.type === 'text') {
          updateAnnotation(ann.id, { x: pdfRect.x, y: pdfRect.y }, { silent: true });
        } else if (ann.type === 'check') {
          updateAnnotation(ann.id, { x: pdfRect.x, y: pdfRect.y }, { silent: true });
        } else {
          updateAnnotation(ann.id, { x: pdfRect.x, y: pdfRect.y }, { silent: true });
        }
      }
      if (onRefresh) onRefresh();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  if (ann.type === 'text') {
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      editText(ann, pageSize, scale);
    });
  }
}

function editText(ann, pageSize, scale) {
  const overlay = document.getElementById('overlayLayer');
  const rect = getAnnRect(ann, pageSize, scale);
  const screen = pdfRectToScreen(rect, pageSize.height, scale);
  overlay.querySelectorAll('.text-editor-inline').forEach((el) => el.remove());

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text-editor-inline';
  input.value = ann.text;
  input.style.left = `${screen.left}px`;
  input.style.top = `${screen.top}px`;
  input.style.fontSize = `${ann.fontSize * scale}px`;

  const commit = () => {
    const text = input.value.trim();
    input.remove();
    if (text) updateAnnotation(ann.id, { text });
    if (onRefresh) onRefresh();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') input.remove();
  });
  input.addEventListener('blur', commit);
  overlay.appendChild(input);
  input.focus();
  input.select();
}

function startResize(e, el, ann, pageSize, scale, corner) {
  selectPlaced(ann.id, { refresh: false });
  const startX = e.clientX;
  const startY = e.clientY;
  const startRect = {
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  };
  const aspect = startRect.width / startRect.height;

  const onMove = (ev) => {
    let { left, top, width, height } = { ...startRect };
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    if (corner.includes('e')) width = Math.max(20, startRect.width + dx);
    if (corner.includes('w')) {
      width = Math.max(20, startRect.width - dx);
      left = startRect.left + startRect.width - width;
    }
    if (corner.includes('s')) height = Math.max(10, startRect.height + dy);
    if (corner.includes('n')) {
      height = Math.max(10, startRect.height - dy);
      top = startRect.top + startRect.height - height;
    }

    if (ann.type !== 'text' && !ev.shiftKey) {
      height = width / aspect;
      if (corner.includes('n')) top = startRect.top + startRect.height - height;
    }

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    if (ann.type === 'text') {
      const newFontSize = (height / scale) / 1.3;
      el.style.fontSize = `${newFontSize * scale}px`;
    }
    positionToolbar();
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const pdfRect = screenRectToPdf(
      {
        left: parseFloat(el.style.left),
        top: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
      },
      pageSize.height,
      scale
    );
    if (ann.type === 'text') {
      updateAnnotation(ann.id, { x: pdfRect.x, y: pdfRect.y, fontSize: pdfRect.height / 1.3 }, { silent: true });
    } else if (ann.type === 'check') {
      updateAnnotation(ann.id, { x: pdfRect.x, y: pdfRect.y, size: pdfRect.width }, { silent: true });
    } else {
      updateAnnotation(ann.id, pdfRect, { silent: true });
    }
    if (onRefresh) onRefresh();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startRotate(e, el, ann) {
  selectPlaced(ann.id, { refresh: false });
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
  const startRotation = ann.rotation || 0;

  const onMove = (ev) => {
    const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    const deg = startRotation + ((angle - startAngle) * 180) / Math.PI;
    el.style.transform = `rotate(${deg}deg)`;
    positionToolbar();
  };

  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    const deg = startRotation + ((angle - startAngle) * 180) / Math.PI;
    updateAnnotation(ann.id, { rotation: deg }, { silent: true });
    if (onRefresh) onRefresh();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function deleteSelected() {
  if (!selectedId) return;
  removeAnnotation(selectedId);
  selectPlaced(null);
}

export function selectPlaced(id, { refresh = true } = {}) {
  const changed = selectedId !== id;
  selectedId = id;
  if (onSelectChange) onSelectChange(id);
  document.getElementById('transformToolbar').hidden = !id;
  if (changed && refresh && onRefresh) onRefresh();
}

export function getSelectedId() {
  return selectedId;
}

export function clearSelection() {
  selectPlaced(null);
}

function positionToolbar() {
  if (!selectedId) return;
  const ann = getForPage(pdfViewer.getCurrentPage()).find((a) => a.id === selectedId);
  const toolbar = document.getElementById('transformToolbar');
  if (!ann || !toolbar) return;

  let rect;
  const el = document.querySelector(`.placed-item[data-id="${selectedId}"]`);
  if (el && ann.type !== 'pen') {
    rect = el.getBoundingClientRect();
  } else if (ann.type === 'pen' && ann.points.length) {
    const pageSize = pdfViewer.getPageSize(ann.pageIndex);
    const scale = pdfViewer.getRenderScale();
    const xs = ann.points.map((p) => p.x * scale);
    const ys = ann.points.map((p) => (pageSize.height - p.y) * scale);
    const overlay = document.getElementById('overlayLayer').getBoundingClientRect();
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    rect = {
      left: overlay.left + minX,
      top: overlay.top + minY,
      width: maxX - minX,
      height: Math.max(...ys) - minY,
    };
  } else return;

  toolbar.style.left = `${rect.left + rect.width / 2 - toolbar.offsetWidth / 2}px`;
  toolbar.style.top = `${Math.max(8, rect.top - 44)}px`;
}
