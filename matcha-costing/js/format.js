/** @param {number|null|undefined} n */
export function peso(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`;
}

/** @param {number|null|undefined} n */
export function pesoDec(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** @param {number|null|undefined} n */
export function pct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** @param {number|null|undefined} n */
export function cups(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.ceil(n).toLocaleString('en-PH');
}

/** @param {number|null|undefined} n */
export function cupsDec(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-PH', { maximumFractionDigits: 1 });
}

/** @param {number|null|undefined} n */
export function signedPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

/** @param {string} s */
export function esc(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/** @param {unknown} v */
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** @param {unknown} v */
export function parseNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
