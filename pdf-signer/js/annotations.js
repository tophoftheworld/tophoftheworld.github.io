let annotations = [];
let onChange = null;

export function initAnnotations(callback) {
  onChange = callback;
}

export function getAnnotations() {
  return annotations;
}

/** @deprecated alias */
export const getPlacedSignatures = getAnnotations;

export function addAnnotation(item) {
  annotations.push(item);
  notify();
}

export function updateAnnotation(id, updates, { silent = false } = {}) {
  const idx = annotations.findIndex((a) => a.id === id);
  if (idx === -1) return;
  annotations[idx] = { ...annotations[idx], ...updates };
  if (!silent) notify();
}

export function removeAnnotation(id) {
  annotations = annotations.filter((a) => a.id !== id);
  notify();
}

export function clearAnnotations() {
  annotations = [];
  notify();
}

/** @deprecated alias */
export const clearPlacedSignatures = clearAnnotations;

export function getForPage(pageIndex) {
  return annotations.filter((a) => a.pageIndex === pageIndex);
}

/** @deprecated alias */
export const getPlacedForPage = getForPage;

function notify() {
  if (onChange) onChange(annotations);
}
