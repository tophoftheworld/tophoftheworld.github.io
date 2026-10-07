/* Shared render helpers for the Bookings app. */
import { SERVICES, STAGES, QUIET_DAYS, EXPIRE_SILENT_DAYS, channelLabel } from './constants.js';

const DAY = 86400e3;
let NOW = new Date();
let STAFF = {};

export function setNow(date) {
  NOW = date;
}

export function setStaff(map) {
  STAFF = map || {};
}

export function now() {
  return NOW;
}

function manilaYmd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function todayYmd() {
  return manilaYmd(NOW);
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(n) {
  if (n == null || Number.isNaN(n)) return '';
  return 'Php ' + Math.round(n).toLocaleString('en-PH');
}

export function parseDay(ymd) {
  return ymd ? new Date(ymd + 'T00:00:00+08:00') : null;
}

export function fmtDate(ymd, opts) {
  const d = parseDay(ymd);
  if (!d || Number.isNaN(d.getTime())) return '';
  const o = { month: 'short', day: 'numeric', timeZone: 'Asia/Manila', ...(opts || {}) };
  return d.toLocaleDateString('en-US', o);
}

export function fmtDateRange(b) {
  if (!b.date) return '';
  if (b.endDate && b.endDate !== b.date) return `${fmtDate(b.date)}–${fmtDate(b.endDate, { month: undefined })}`;
  return fmtDate(b.date);
}

export function daysUntil(ymd) {
  const d = parseDay(ymd);
  return d ? Math.round((d - parseDay(todayYmd())) / DAY) : null;
}

export function relTime(iso) {
  if (!iso) return '';
  const diff = NOW - new Date(iso);
  const m = Math.round(diff / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const ymd = manilaYmd(new Date(iso));
  return ymd.slice(0, 4) === todayYmd().slice(0, 4) ? fmtDate(ymd) : fmtDate(ymd, { year: 'numeric' });
}

export function relDays(ymd) {
  const n = daysUntil(ymd);
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return `in ${n} days`;
  return `${-n} days ago`;
}

export function serviceLabel(s, short) {
  const svc = SERVICES[s];
  if (!svc) return 'Service not set';
  return short ? svc.short : svc.label;
}

export function paxLabel(b) {
  if (b.paxNote && !b.pax) return b.paxNote;
  if (!b.pax) return '';
  const unit = SERVICES[b.service]?.unit || 'pax';
  return `${b.pax} ${unit}`;
}

export function stageMeta(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

export function stagePill(stage, extra, trailing = '') {
  const s = stageMeta(stage);
  return `<span class="bk-stage-pill is-${esc(s.id)} ${extra || ''}">${esc(s.label)}${trailing}</span>`;
}

function initials(name) {
  const clean = String(name || '?').replace(/^@/, '').replace(/[^\p{L}\s&]/gu, ' ').trim();
  const parts = clean.split(/\s+|&/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatar(name, size) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [140, 205, 32, 265, 350, 178];
  const hue = hues[h % hues.length];
  return `<span class="bk-avatar ${size ? 'is-' + size : ''}" style="--av-h:${hue}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export function staffAvatar(key) {
  const s = STAFF[key];
  if (!s) return '';
  return `<span class="bk-staff-chip"><span class="bk-staff-dot" style="background:${s.color}">${esc(s.name[0])}</span>${esc(s.name)}</span>`;
}

const CHANNEL_ICONS = {
  instagram: '<svg viewBox="0 0 24 24"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.25-3.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>',
  messenger: '<svg viewBox="0 0 24 24"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.2 5.42 3.14 7.16V22l2.87-1.58c1.2.33 2.54.52 3.99.52 5.64 0 10-4.13 10-9.7S17.64 2 12 2Zm1 12.97-2.55-2.72-4.97 2.72 5.47-5.81 2.61 2.72 4.91-2.72L13 14.97Z"/></svg>',
  widget: '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z" transform="translate(-1 -1)"/></svg>',
  chatbot: '<svg viewBox="0 0 24 24"><path d="M11 2h2v2h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-3l-4 3v-3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4V2Zm-2 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg>',
  invoice: '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM8 12h8v1.5H8V12Zm0 3.5h8V17H8v-1.5Z"/></svg>',
  manual: '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"/></svg>'
};

export function channelIcon(c) {
  return `<span class="bk-channel is-${esc(c)}" title="${esc(channelLabel(c))}">${CHANNEL_ICONS[c] || ''}</span>`;
}

export function icon(name) {
  const P = {
    reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z',
    cash: 'M3 6h18v12H3V6Zm2 2v8h14V8H5Zm7 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
    alert: 'M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z',
    send: 'M2 21 23 12 2 3v7l15 2-15 2v7Z',
    calendar: 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm-2 8h14v10H5V10Z',
    people: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05A4.2 4.2 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z',
    doc: 'M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM8 12h8v1.5H8V12Zm0 3.5h8V17H8v-1.5Z',
    moon: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z',
    link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z',
    open: 'M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
    mail: 'M3 5h18v14H3V5Zm2 2v.5l7 4.5 7-4.5V7H5Zm14 2.8-7 4.5-7-4.5V17h14V9.8Z',
    more: 'M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    merge: 'M17 20.41 18.41 19 15 15.59 13.59 17 17 20.41ZM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5 7.5 8Z',
    x: 'M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3-1.41-1.41Z',
    spark: 'M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2Z',
    archive: 'M3 3h18v4H3V3Zm1 5h16v13H4V8Zm5 3v2h6v-2H9Z',
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z',
    chevron: 'M7 9.5 12 14.5 17 9.5 15.6 8.1 12 11.7 8.4 8.1Z',
    chevronUp: 'M7 14.5 12 9.5 17 14.5 15.6 15.9 12 12.3 8.4 15.9Z'
  };
  return `<svg class="bk-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || ''}"/></svg>`;
}

/* ---------- Invoice facts ---------- */

/** A milestone counts as collected only once staff confirmed it (paid and no proof still pending). */
export function isCollected(m) {
  return m.paid && !m.pending;
}

/** Confirmed money on a milestone, partial payments included. */
export function receivedOn(m) {
  return isCollected(m) ? m.amount : Math.min(m.amount, Number(m.received) || 0);
}

export function leftOn(m) {
  return Math.max(0, m.amount - receivedOn(m));
}

export function invoiceFacts(inv) {
  if (!inv) return null;
  const paid = inv.milestones.reduce((s, m) => s + receivedOn(m), 0);
  const remaining = inv.total - paid;
  const unpaid = inv.milestones.filter((m) => !isCollected(m));
  const next = unpaid[0] || null;
  // A deposit skipped by booking by hand is still owed, but its due date no longer makes anything late.
  const due = inv.bookedByHand && next === inv.milestones[0] ? unpaid[1] || null : next;
  const overdueDays = due?.date ? -daysUntil(due.date) : 0;
  return { paid, remaining, next, due, overdue: due && !due.pending && overdueDays > 0 ? overdueDays : 0 };
}

/** The event's last day is behind us. */
export function eventDone(b) {
  const last = b.endDate || b.date;
  return !!last && last < todayYmd();
}

export function invoicePill(inv) {
  if (!inv) return '';
  if (!inv.published) return '<span class="inv-pill is-draft">Draft</span>';
  if (inv.proofPending) return '<span class="inv-pill is-partial">Proof sent</span>';
  const map = { unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid' };
  return `<span class="inv-pill is-${esc(inv.status)}">${map[inv.status] || esc(inv.status)}</span>`;
}

/* ---------- What needs a human ---------- */

function silentDays(b) {
  return (NOW - new Date(b.lastActivityAt)) / DAY;
}

export function isQuiet(b) {
  if (!['inquiry', 'quoted'].includes(b.stage)) return false;
  return silentDays(b) >= QUIET_DAYS;
}

/** Why an un-invoiced booking stopped counting, or null while it is still live. */
export function expiredReason(b) {
  if (b.archived || !['inquiry', 'quoted'].includes(b.stage)) return null;
  if (b.date && b.date < todayYmd()) return 'Event date passed';
  const silent = silentDays(b) >= EXPIRE_SILENT_DAYS;
  if (silent && (b.stage === 'inquiry' || !b.date)) return `No activity for ${EXPIRE_SILENT_DAYS}+ days`;
  return null;
}

/** 'open' | 'completed' | 'expired' | 'archived' */
export function groupOf(b) {
  if (b.archived) return 'archived';
  if (b.stage === 'completed') return 'completed';
  if (expiredReason(b)) return 'expired';
  return 'open';
}

export function hasChat(b) {
  return !!(b.conversationId || b.chat?.length || (b.channel === 'chatbot' && b.ref));
}

/** Where a booking stands, in priority order. Also the "By next step" sections. `strong` marks money that is late. */
export const NEXT_ACTIONS = [
  { key: 'proof', label: 'Proof to review' },
  { key: 'overdue', label: 'Overdue', strong: true },
  { key: 'after_event', label: 'Unpaid, event done' },
  { key: 'not_booked', label: 'Date passed' },
  { key: 'to_close', label: 'Not closed' },
  { key: 'unsent', label: 'Invoice not sent' },
  { key: 'replied', label: 'Client replied' },
  { key: 'quote', label: 'Ready to quote' },
  { key: 'staff', label: 'No staff yet' },
  { key: 'quoted', label: 'Quote sent' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'quiet', label: 'Gone quiet' },
  { key: 'waiting_details', label: 'Waiting on details' },
  { key: 'upcoming', label: 'Upcoming events' },
  { key: 'done', label: 'Completed' },
  { key: 'expired', label: 'Expired' },
  { key: 'archived', label: 'Archived' }
];

const ACTION_META = Object.fromEntries(NEXT_ACTIONS.map((a, i) => [a.key, { ...a, rank: i }]));

function act(key, text) {
  return { ...ACTION_META[key], text: text || ACTION_META[key].label };
}

function quietFor(b) {
  return `Quiet ${Math.floor(silentDays(b))}d`;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "today", "tomorrow", "in 5d". */
function shortIn(ymd) {
  const n = daysUntil(ymd);
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return n > 0 ? `in ${n}d` : `${-n}d ago`;
}

function missingText(b) {
  return `Needs ${missingFields(b).join(', ').toLowerCase()}`;
}

/** Where a booking stands right now. Drives the status line, the next-step sections and sorting. */
export function nextAction(b) {
  const group = groupOf(b);
  if (group === 'archived') return act('archived');
  if (group === 'expired') return act('expired');

  const f = invoiceFacts(b.invoice);
  if (b.invoice?.proofPending) return act('proof', `Proof · ${money(b.invoice.pendingAmount || f?.next?.amount)}`);
  if (b.stage === 'completed') return act('done', 'Done');
  const late = f?.overdue ? `Overdue ${f.overdue}d` : '';
  if (b.stage === 'booked' && eventDone(b)) {
    if (!b.invoice) return act('to_close', 'No invoice');
    if (late) return { ...act('after_event', late), strong: true };
    return act('after_event', f.remaining > 0.5 ? `${money(f.remaining)} unpaid` : 'Event done');
  }
  if (b.stage === 'invoiced' && eventDone(b)) return act('not_booked', 'Date passed');
  if (late && b.invoice.published) return act('overdue', late);
  if (b.invoice && !b.invoice.published && !f.paid) return act('unsent', 'Not sent');
  if (b.waitingOn === 'us' && ['quoted', 'invoiced'].includes(b.stage) && !isQuiet(b)) return act('replied', `Replied ${relTime(b.lastActivityAt)}`);

  if (b.stage === 'inquiry') {
    if (!missingFields(b).length) return act('quote', 'Needs price');
    if (isQuiet(b)) return act('quiet', quietFor(b));
    return act('waiting_details', missingText(b));
  }
  if (b.stage === 'quoted') return isQuiet(b) ? act('quiet', quietFor(b)) : act('quoted');
  if (b.stage === 'invoiced') {
    if (!b.invoice) return act('quoted', 'No invoice');
    return act('unpaid', f?.next?.date ? `Due ${fmtDate(f.next.date)}` : 'Unpaid');
  }
  if (b.stage === 'booked') {
    const n = daysUntil(b.date);
    const when = b.date ? shortIn(b.date) : 'no date';
    if (Array.isArray(b.event?.staff) && !b.event.staff.length && n != null && n >= 0 && n <= 14) return act('staff', `No staff · ${when}`);
    if (b.invoice?.bookedByHand) return act('upcoming', `No deposit · ${when}`);
    return act('upcoming', b.date ? cap(relDays(b.date)) : 'Booked');
  }
  return act('upcoming');
}

export function statusLine(b) {
  const a = nextAction(b);
  return `<span class="bk-status ${a.strong ? 'is-strong' : ''}">${esc(a.text)}</span>`;
}

/** Company leads; the rep's name only shows underneath when there is a company. */
export function displayNames(b) {
  const company = String(b.company || '').trim();
  const person = String(b.clientName || '').trim();
  if (company && company.toLowerCase() !== person.toLowerCase()) return { title: company, contact: person };
  return { title: company || person || 'Unnamed client', contact: '' };
}

export function nextStep(b) {
  const f = invoiceFacts(b.invoice);
  const chat = hasChat(b);
  const group = groupOf(b);
  if (group === 'archived') return null;
  if (group === 'expired') {
    const reason = expiredReason(b) === 'Event date passed' ? 'Date passed' : 'No reply in a while';
    return { title: 'Expired', body: reason, action: 'archive', label: 'Archive' };
  }
  const dueLine = (m) => (m ? `${money(leftOn(m))}${m.date ? ` · due ${fmtDate(m.date)}` : ''}` : '');
  const chatOrPrice = { action: chat ? 'open-chat' : 'send-quote', label: chat ? 'Open chat' : 'Add price', secondary: chat ? { action: 'send-quote', label: 'Add price' } : null };
  switch (b.stage) {
    case 'inquiry':
      return { title: missingFields(b).length ? missingText(b) : 'Needs a price', ...chatOrPrice };
    case 'quoted':
      return { title: 'Ready to invoice', action: 'create-invoice', label: 'Create invoice', secondary: chat ? { action: 'open-chat', label: 'Open chat' } : null };
    case 'invoiced':
      if (b.invoice?.proofPending) return { title: 'Proof uploaded', body: money(b.invoice.pendingAmount || f?.next?.amount), action: 'confirm-payment', label: 'Confirm', tone: 'ok' };
      if (!b.invoice) return { title: 'No invoice yet', action: 'create-invoice', label: 'Create invoice' };
      if (eventDone(b)) {
        return { title: 'Did it happen?', action: 'mark-booked', label: 'Yes', secondary: { action: 'archive', label: 'Cancelled' }, moved: true };
      }
      if (!b.invoice.published) return { title: 'Invoice not sent', action: 'publish-invoice', label: 'Publish', secondary: { action: 'mark-booked', label: 'Mark booked' } };
      return {
        title: f?.overdue ? `Overdue ${f.overdue} day${f.overdue === 1 ? '' : 's'}` : 'Awaiting deposit',
        body: dueLine(f?.next),
        action: 'copy-link',
        label: 'Copy link',
        secondary: { action: 'mark-booked', label: 'Mark booked' },
        tone: f?.overdue ? 'danger' : undefined
      };
    case 'booked':
      if (b.invoice?.proofPending) return { title: 'Proof uploaded', body: money(b.invoice.pendingAmount), action: 'confirm-payment', label: 'Confirm', tone: 'ok' };
      if (eventDone(b)) {
        if (!f) return { title: 'Event done', action: 'mark-completed', label: 'Settle', secondary: { action: 'create-invoice', label: 'Create invoice' } };
        if (f.remaining <= 0.5) return { title: 'Event done', action: 'mark-completed', label: 'Close' };
        return {
          title: f.overdue ? `Overdue ${f.overdue} day${f.overdue === 1 ? '' : 's'}` : 'Balance due',
          body: `${money(f.remaining)}${f.due?.date ? ` · due ${fmtDate(f.due.date)}` : ''}`,
          action: 'copy-link',
          label: 'Copy link',
          secondary: { action: 'settle', label: 'Settle' },
          tone: f.overdue ? 'danger' : undefined
        };
      }
      if (!b.event) return { title: 'Not on calendar', body: b.date ? '' : 'Set a date first', action: 'add-event', label: 'Add to calendar' };
      if (Array.isArray(b.event.staff) && !b.event.staff.length) return { title: 'No staff yet', body: cap(relDays(b.date)), action: 'open-event', label: 'Schedule staff', tone: 'warn' };
      if (b.invoice?.bookedByHand) return { title: b.date ? cap(relDays(b.date)) : 'Booked', body: `No deposit · ${money(f.remaining)} due`, action: 'open-event', label: 'Open event', secondary: { action: 'copy-link', label: 'Copy link' } };
      return { title: b.date ? cap(relDays(b.date)) : 'Booked', action: 'open-event', label: 'Open event' };
    default:
      return null;
  }
}

export function missingFields(b) {
  const m = [];
  if (!b.service) m.push('Service');
  if (!b.date) m.push('Date');
  if (!b.pax && !b.paxNote) m.push('Pax');
  if (!b.venue) m.push('Venue');
  return m;
}

export function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

/* ---------- Booking card ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateTile(b) {
  if (!b.date) return '<div class="bk-date-tile is-none"><span>No date</span></div>';
  const n = daysUntil(b.date);
  const tone = n < 0 ? 'is-past' : n <= 7 ? 'is-soon' : '';
  const month = MONTHS[Number(b.date.slice(5, 7)) - 1] || '';
  const sameYear = b.date.slice(0, 4) === todayYmd().slice(0, 4);
  const multi = b.endDate && b.endDate !== b.date;
  const sub = multi ? `–${Number(b.endDate.slice(8, 10))}` : sameYear ? '' : b.date.slice(0, 4);
  return `
    <div class="bk-date-tile ${tone}" title="${esc(fmtDateRange(b))} · ${esc(relDays(b.date))}">
      <span class="bk-date-m">${esc(month)}</span>
      <span class="bk-date-d">${Number(b.date.slice(8, 10))}</span>
      ${sub ? `<span class="bk-date-sub">${esc(sub)}</span>` : ''}
    </div>`;
}

function moneyCell(b, f, value) {
  if (!value) return '<span class="bk-row-sub">—</span>';
  let line = '';
  if (f && f.remaining <= 0.5) line = '<span class="bk-row-sub">Paid</span>';
  else if (f && b.stage !== 'completed' && (b.invoice.published || f.paid)) line = `<span class="bk-row-sub">${money(f.remaining)} left</span>`;
  return `<span class="bk-row-amount">${money(value)}</span>${line}`;
}

function serviceWithQty(service, qty) {
  if (!service) return qty;
  return qty ? `${service} (${qty})` : service;
}

/** Event column: the event name leads when there is one, otherwise the service; quantity goes underneath. */
function eventCell(b) {
  const service = b.service ? serviceLabel(b.service, true) : '';
  const qty = paxLabel(b);
  const main = b.eventName || service || 'Service not set';
  const sub = b.eventName ? serviceWithQty(service, qty) : qty;
  return `<div class="bk-row-main ${main === 'Service not set' ? 'is-empty' : ''}">${esc(main)}</div>${sub ? `<div class="bk-row-sub">${esc(sub)}</div>` : ''}`;
}

/** Column headings for a panel of booking rows. */
export const ROW_HEAD = `
  <div class="bk-row-head" aria-hidden="true">
    <span>Date</span><span>Client</span><span>Event</span><span>Status</span><span class="is-right">Amount</span><span class="is-right">Updated</span>
  </div>`;

function bookingRow(b, o) {
  const f = invoiceFacts(b.invoice);
  const value = b.invoice?.total ?? b.price;
  const group = groupOf(b);
  const { title, contact } = displayNames(b);
  return `
    <article class="bk-row ${group === 'archived' || group === 'expired' ? 'is-closed' : ''}" data-open="${esc(b.id)}" tabindex="0" role="button" aria-label="Open ${esc(title)}">
      ${dateTile(b)}
      <div class="bk-row-who">
        <div class="bk-row-name">${esc(title)}</div>
        ${contact ? `<div class="bk-row-sub">${esc(contact)}</div>` : ''}
      </div>
      <div class="bk-row-what">${eventCell(b)}</div>
      <div class="bk-row-status">
        <button type="button" class="bk-stage-btn" data-stage-menu="${esc(b.id)}" aria-label="Change stage">${stagePill(b.stage)}</button>
        ${statusLine(b)}
      </div>
      <div class="bk-row-money">${moneyCell(b, f, value)}</div>
      <div class="bk-row-end">
        <span class="bk-row-updated" title="Last activity">${b.lastActivityAt ? esc(relTime(b.lastActivityAt)) : ''}</span>
        ${o.quick ? quickActions(b, group) : ''}
      </div>
    </article>`;
}

export function bookingCard(b, opts) {
  const o = opts || {};
  if (o.row) return bookingRow(b, o);
  const f = invoiceFacts(b.invoice);
  const value = b.invoice?.total ?? b.price;
  const { title } = displayNames(b);
  const service = b.service ? serviceLabel(b.service, true) : '';
  const what = service ? serviceWithQty(service, paxLabel(b)) : '';
  const year = b.date?.slice(0, 4);
  const when = b.date ? fmtDateRange(b) + (year !== todayYmd().slice(0, 4) ? `, ${year}` : '') : '';
  const group = groupOf(b);
  return `
    <article class="bk-card ${group === 'archived' || group === 'expired' ? 'is-closed' : ''}" data-open="${esc(b.id)}" tabindex="0" role="button" aria-label="Open ${esc(title)}">
      <div class="bk-card-name">${esc(title)}</div>
      <div class="bk-card-what ${what ? '' : 'is-missing'}">${esc(what || 'Service not set')}</div>
      <div class="bk-card-when-row">
        <span class="bk-card-when ${b.date ? '' : 'is-missing'}">${esc(when || 'No date')}</span>
        <button type="button" class="bk-stage-btn" data-stage-menu="${esc(b.id)}" aria-label="Change stage">${stagePill(b.stage)}</button>
      </div>
      <div class="bk-card-foot">
        ${statusLine(b)}
        ${value ? `<div class="bk-card-amount">${moneyCell(b, f, value)}</div>` : ''}
      </div>
    </article>`;
}

function quickActions(b, group) {
  const id = esc(b.id);
  const btn = (action, ic, label) => `<button type="button" class="bk-quick-btn" data-action="${action}" data-id="${id}" title="${esc(label)}">${icon(ic)}<span>${esc(label)}</span></button>`;
  const out = [];
  if (hasChat(b)) out.push(btn('open-chat', 'reply', 'Chat'));
  if (b.invoice?.published) out.push(btn('copy-link', 'link', 'Copy link'));
  out.push(group === 'archived' ? btn('restore', 'refresh', 'Restore') : btn('archive', 'archive', 'Archive'));
  return `<div class="bk-quick">${out.join('')}</div>`;
}

/* ---------- Feedback ---------- */

/** Busy state around an async action; restores the button afterwards. */
export async function busyButton(btn, busy, done, task) {
  if (!btn) return task();
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.textContent = busy;
  try {
    const result = await task();
    if (btn.isConnected) {
      btn.classList.remove('is-busy');
      btn.classList.add('is-done');
      btn.textContent = done;
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.disabled = false;
        btn.classList.remove('is-done');
        btn.innerHTML = original;
      }, 1400);
    }
    return result;
  } catch (err) {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.innerHTML = original;
    }
    throw err;
  }
}

export function toast(message, opts) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `bk-toast ${opts?.error ? 'is-error' : ''}`;
  el.innerHTML = `<span>${esc(message)}</span>${opts?.actionLabel ? `<button type="button">${esc(opts.actionLabel)}</button>` : ''}`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  const close = () => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 250);
  };
  if (opts?.actionLabel) {
    el.querySelector('button').addEventListener('click', () => {
      opts.onAction?.();
      close();
    });
  }
  setTimeout(close, opts?.ms || (opts?.error ? 7000 : 4200));
}
