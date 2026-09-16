import { SEED_EVENT_TYPES } from '../../shared/js/ops-events.js?v=21';

/** @type {Map<string, object>} */
let typeMap = new Map();

export function setTypes(types) {
  typeMap = new Map((types || []).map((t) => [t.id, t]));
}

export function getTypes() {
  const fromMap = [...typeMap.values()];
  if (fromMap.length) return fromMap;
  return SEED_EVENT_TYPES.map((t) => ({ ...t }));
}

export function getType(typeId) {
  if (!typeId) return null;
  return typeMap.get(typeId) || SEED_EVENT_TYPES.find((t) => t.id === typeId) || null;
}

export function typeColor(typeId) {
  return getType(typeId)?.color || '#6b7280';
}

export function typeLabel(typeId) {
  return getType(typeId)?.label || typeId || 'Untitled type';
}

export function typeOptionsHtml(selectedId, { includeEmpty = true } = {}) {
  const opts = [];
  if (includeEmpty) {
    opts.push(`<option value="">—</option>`);
  }
  for (const t of getTypes()) {
    const sel = t.id === selectedId ? ' selected' : '';
    opts.push(`<option value="${escapeAttr(t.id)}"${sel}>${escapeHtml(t.label)}</option>`);
  }
  return opts.join('');
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;');
}
