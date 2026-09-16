const PESO = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
const PESO_DEC = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTY = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });

export function formatPeso(n) {
  if (n == null || Number.isNaN(n)) return '\u2014';
  return PESO.format(Math.round(n));
}

export function formatPesoRate(n) {
  if (n == null || Number.isNaN(n)) return '\u2014';
  return PESO_DEC.format(n);
}

/** Round rate for compact numeric inputs (max 2 decimals). */
export function formatRateInput(n) {
  if (n == null || Number.isNaN(n) || !Number(n)) return '';
  return String(Math.round(Number(n) * 100) / 100);
}

export function formatQty(n, unit) {
  if (n == null || Number.isNaN(n)) return '\u2014';
  return `${QTY.format(n)} ${unit || ''}`.trim();
}

export function formatDateShort(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/** Receipt-friendly date: Sep 5, 2026 */
export function formatDateMedium(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateRange(startIso, endIso) {
  if (!startIso && !endIso) return '\u2014';
  if (!endIso || startIso === endIso) return formatDateShort(startIso);
  return `${formatDateShort(startIso)} \u2013 ${formatDateShort(endIso)}`;
}

/** Short datetime for last-edit labels: Sep 13, 10:16 PM */
export function formatDateTimeShort(iso) {
  if (!iso) return '\u2014';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Latest touch on a week doc or any of its lines.
 * @returns {{ updatedAt: string, updatedBy: { uid?: string|null, name?: string }|null }|null}
 */
export function resolveWeekLastEdit(week) {
  if (!week) return null;
  let best = null;
  const consider = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const at = entry.updatedAt;
    if (typeof at !== 'string' || !at) return;
    if (!best || at > best.updatedAt) {
      best = {
        updatedAt: at,
        updatedBy: entry.updatedBy && typeof entry.updatedBy === 'object' ? entry.updatedBy : null,
      };
    }
  };
  consider(week);
  for (const line of week.lines || []) consider(line);
  return best;
}

export function formatLastEditLabel(edit) {
  if (!edit?.updatedAt) return '';
  const name = edit.updatedBy?.name || edit.updatedBy?.email || null;
  const when = formatDateTimeShort(edit.updatedAt);
  return name ? `Last edit \u00B7 ${name} \u00B7 ${when}` : `Last edit \u00B7 ${when}`;
}

export function formatLineEditTitle(line) {
  const name = line?.updatedBy?.name;
  const at = line?.updatedAt;
  if (!name && !at) return '';
  if (name && at) return `Last edit \u00B7 ${name} \u00B7 ${formatDateTimeShort(at)}`;
  if (name) return `Last edit \u00B7 ${name}`;
  return `Last edit \u00B7 ${formatDateTimeShort(at)}`;
}

export function formatRunoutDays(iso) {
  const days = (() => {
    if (!iso) return null;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const d = new Date(`${iso}T12:00:00`);
    return Math.round((d - today) / 86400000);
  })();
  if (days == null) return '\u2014';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1) return `In ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export function formatDelta(current, prior) {
  if (!prior) return { text: '\u2014', cls: '' };
  const diff = current - prior;
  const pct = prior ? (diff / prior) * 100 : 0;
  const sign = diff >= 0 ? '+' : '';
  const cls = diff > 0 ? 'delta-up' : diff < 0 ? 'delta-down' : '';
  return { text: `${sign}${formatPeso(diff)} (${sign}${pct.toFixed(1)}%)`, cls };
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function statusLabel(status, scope = 'week') {
  if (scope === 'line') {
    const map = {
      planned: 'Open',
      ordered: 'Ordered',
      delivered: 'Delivered',
      spent: 'Paid',
    };
    return map[status] || status;
  }
  const map = {
    draft: 'Open',
    ordered: 'Ordering',
    settled: 'Settled',
  };
  return map[status] || status;
}

export function dayLabel(orderDay) {
  return orderDay === 'thu' ? 'Thu' : 'Mon';
}
