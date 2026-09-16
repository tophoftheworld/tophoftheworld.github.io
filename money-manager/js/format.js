const peso = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

export function formatMoney(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
    return peso.format(Number(n));
}

export function formatMoneyCompact(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${v < 0 ? '−' : ''}₱${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${v < 0 ? '−' : ''}₱${(abs / 1000).toFixed(1)}k`;
    return formatMoney(v);
}

export function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateShort(iso) {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function daysUntil(iso) {
    if (!iso) return null;
    const target = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    target.setHours(12, 0, 0, 0);
    return Math.round((target - now) / 86400000);
}

export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function roleLabel(role) {
    const map = {
        OPERATING: 'Operating',
        TRANSIT: 'Transit',
        PERSONAL: 'Personal',
        EXTERNAL_WALLET: 'External'
    };
    return map[role] || role || '—';
}
