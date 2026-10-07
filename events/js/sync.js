import { initializeFirebaseServices } from '../../shared/js/firebase-config.js?v=46';
import {
  ensureEventTypes,
  loadOpsEvents,
  loadOverlayLeads,
  createOpsEvent,
  updateOpsEvent,
  deleteOpsEvent,
  confirmOpsEvent,
  promoteLeadToOpsEvent,
  promoteInvoiceToOpsEvent,
  mergeInvoiceIntoOpsEvent,
  backfillOpsEventsFromBranches,
  archiveBranchForEvent,
  archiveOverlayBooking,
  patchBookingDetails,
  EVENT_STATUSES,
  OPS_EVENTS_COLLECTION,
  SERVICE_LEADS_COLLECTION,
  INVOICES_COLLECTION
} from '../../shared/js/ops-events.js?v=46';

let db = null;
let firestoreFns = null;
let ready = false;

export async function initSync() {
  if (ready) return { db, firestoreFns };
  const services = await initializeFirebaseServices('attendance');
  db = services.db;
  const fs = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
  firestoreFns = {
    getDocs: fs.getDocs,
    collection: fs.collection,
    doc: fs.doc,
    setDoc: fs.setDoc,
    addDoc: fs.addDoc,
    updateDoc: fs.updateDoc,
    deleteDoc: fs.deleteDoc,
    serverTimestamp: fs.serverTimestamp,
    query: fs.query,
    where: fs.where,
    getDoc: fs.getDoc
  };
  ready = true;
  return { db, firestoreFns };
}

export function getDb() {
  return { db, firestoreFns };
}

export async function seedAndLoadTypes() {
  await initSync();
  return ensureEventTypes(db, firestoreFns);
}

export async function fetchAllEvents() {
  await initSync();
  return loadOpsEvents(db, firestoreFns, { includeCancelled: false });
}

export async function fetchOverlayLeads(year, monthIndex) {
  await initSync();
  try {
    return await loadOverlayLeads(db, firestoreFns, { year, monthIndex });
  } catch (err) {
    console.error('Lead overlay load failed', err);
    return [];
  }
}

export async function saveNewEvent(input) {
  await initSync();
  return createOpsEvent(db, firestoreFns, input, { createdBy: 'events-app' });
}

export async function patchEvent(eventId, patch) {
  await initSync();
  return updateOpsEvent(db, firestoreFns, eventId, patch, { updatedBy: 'events-app' });
}

export async function removeEvent(eventId) {
  await initSync();
  return deleteOpsEvent(db, firestoreFns, eventId);
}

export async function confirmEvent(event, typeMeta) {
  await initSync();
  return confirmOpsEvent(db, firestoreFns, event, typeMeta);
}

export async function cancelEvent(event) {
  await initSync();
  await archiveBranchForEvent(db, firestoreFns, event);
  await updateOpsEvent(
    db,
    firestoreFns,
    event.id,
    { status: EVENT_STATUSES.cancelled },
    { updatedBy: 'events-app' }
  );
}

export async function promoteLead(lead) {
  await initSync();
  if (lead?.source === 'invoice' || lead?.invoiceId) {
    const invoiceId =
      lead.invoiceId ||
      (String(lead.id).startsWith('inv:') ? String(lead.id).split(':')[1] : null);
    const inv = invoiceId ? await getInvoiceById(invoiceId) : null;
    if (!inv) throw new Error('Invoice not found');
    return promoteInvoiceToOpsEvent(db, firestoreFns, inv, { createdBy: 'events-app' });
  }
  return promoteLeadToOpsEvent(db, firestoreFns, lead, { createdBy: 'events-app' });
}

export async function promoteInvoice(invoice, opts = {}) {
  await initSync();
  return promoteInvoiceToOpsEvent(db, firestoreFns, invoice, {
    createdBy: 'events-app',
    ...opts
  });
}

export async function mergeBookingIntoEvent(booking, eventId, retain) {
  await initSync();
  let invoice = null;
  if (booking?.source === 'invoice' || booking?.invoiceId) {
    invoice = await getInvoiceById(booking.invoiceId || String(booking.id).replace(/^inv:/, ''));
  } else if (booking?.invoiceId) {
    invoice = await getInvoiceById(booking.invoiceId);
  }
  if (invoice) {
    return mergeInvoiceIntoOpsEvent(db, firestoreFns, invoice, eventId, retain, {
      updatedBy: 'events-app'
    });
  }
  // Lead without invoice: link lead and optionally overwrite fields
  const { doc, updateDoc, getDoc } = firestoreFns;
  const evSnap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, eventId));
  if (!evSnap.exists()) throw new Error('Event not found');
  const event = { id: evSnap.id, ...evSnap.data() };
  const pick = (key, eventVal, leadVal) =>
    (retain[key] || 'event') === 'invoice' || (retain[key] || 'event') === 'lead'
      ? leadVal
      : eventVal;
  const patch = {
    title: pick('title', event.title, booking.clientName),
    venue: pick('venue', event.venue, booking.targetVenue),
    startDate: pick('startDate', event.startDate, booking.targetDate),
    endDate: pick('endDate', event.endDate || event.startDate, booking.targetDate),
    links: {
      ...(event.links || {}),
      leadId: booking.id
    },
    updatedAt: new Date().toISOString(),
    updatedBy: 'events-app'
  };
  await updateDoc(doc(db, OPS_EVENTS_COLLECTION, eventId), patch);
  await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, booking.id), {
    opsEventId: eventId,
    updatedAt: new Date().toISOString()
  });
  return { id: eventId, ...event, ...patch };
}

export async function archiveBooking(booking) {
  await initSync();
  return archiveOverlayBooking(db, firestoreFns, booking, { updatedBy: 'events-app' });
}

export async function saveBookingDetails(input) {
  await initSync();
  return patchBookingDetails(db, firestoreFns, input, { updatedBy: 'events-app' });
}

export async function runBackfill() {
  await initSync();
  return backfillOpsEventsFromBranches(db, firestoreFns);
}

export async function getLeadById(leadId) {
  await initSync();
  const { getDoc, doc } = firestoreFns;
  const snap = await getDoc(doc(db, SERVICE_LEADS_COLLECTION, leadId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getInvoiceById(invoiceId) {
  await initSync();
  if (!invoiceId) return null;
  const { getDoc, doc } = firestoreFns;
  const snap = await getDoc(doc(db, INVOICES_COLLECTION, invoiceId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getEventById(eventId) {
  await initSync();
  const { getDoc, doc } = firestoreFns;
  const snap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, eventId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

const SHIFT_PRESETS = {
  opening: { start: '09:30', end: '18:30', label: 'Opening' },
  adjustedOpening: { start: '10:30', end: '19:30', label: 'Adjusted Opening' },
  midshift: { start: '11:00', end: '20:00', label: 'Mid' },
  closing: { start: '13:00', end: '22:00', label: 'Closing' },
  closingHalf: { start: '18:00', end: '22:00', label: 'Closing Half-Day' },
  custom: { start: '09:30', end: '18:30', label: 'Custom' }
};

export const SCHEDULE_SHIFT_PRESETS = SHIFT_PRESETS;

/** Days before start / after end allowed for schedule widget day nav. */
export const SCHEDULE_NAV_MARGIN_DAYS = 1;

function ymdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysYmd(ymd, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return ymdLocal(dt);
}

export function weekKeyForYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return ymdLocal(monday);
}

function manilaTodayYmd() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch {
    return ymdLocal(new Date());
  }
}

/** Event dates expanded by ±margin for ingress/egress day navigation. */
export function scheduleNavDates(event, marginDays = SCHEDULE_NAV_MARGIN_DAYS) {
  const start = event?.startDate;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const endRaw = event?.endDate && /^\d{4}-\d{2}-\d{2}$/.test(event.endDate) ? event.endDate : start;
  const end = endRaw >= start ? endRaw : start;
  const from = addDaysYmd(start, -marginDays);
  const to = addDaysYmd(end, marginDays);
  const out = [];
  let cur = from;
  while (cur && cur <= to && out.length < 60) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function datesInEventRange(event, maxDays = 3) {
  return scheduleNavDates(event, 0).slice(0, maxDays);
}

function to12Hour(time) {
  if (!time) return '';
  const raw = String(time).trim();
  if (/am|pm/i.test(raw)) {
    return raw.replace(/\s+/g, ' ').toUpperCase().replace(/([AP]M)/, ' $1').replace(/\s+/g, ' ').trim();
  }
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return raw;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = ((h + 11) % 12) + 1;
  return `${h}:${min} ${ampm}`;
}

function plannedTimes(shift) {
  if (shift?.customStart || shift?.customEnd) {
    return { start: to12Hour(shift.customStart), end: to12Hour(shift.customEnd) };
  }
  const preset = SHIFT_PRESETS[shift?.type];
  if (preset) return { start: to12Hour(preset.start), end: to12Hour(preset.end) };
  return { start: '', end: '' };
}

function shiftBelongsToBranch(shiftBranch, branchKey, branchName) {
  const b = String(shiftBranch || '').trim();
  if (!b) return false;
  if (branchKey && b === branchKey) return true;
  if (branchName && b === branchName) return true;
  return false;
}

/** Map shift type → UI section bucket. */
export function shiftSectionKind(type) {
  if (type === 'closing' || type === 'closingHalf') return 'closing';
  if (type === 'midshift') return 'mid';
  if (type === 'custom') return 'custom';
  return 'opening';
}

/** Normalize stored time to HH:MM for <input type="time">. */
export function toTimeInputValue(time) {
  if (!time) return '';
  const raw = String(time).trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 5);
  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = Number(m12[1]);
    const min = m12[2];
    const ap = m12[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  return '';
}

async function resolveEventBranch(event) {
  const links = event?.links || {};
  let branchKey = links.branchKey || event?.key || null;
  let branchName = null;
  let branchId = links.branchId || null;

  if (branchId) {
    try {
      const { getDoc, doc } = firestoreFns;
      const branchSnap = await getDoc(doc(db, 'branches', branchId));
      if (branchSnap.exists()) {
        const data = branchSnap.data() || {};
        branchKey = data.key || branchKey;
        branchName = data.name || null;
      }
    } catch (_) {
      /* ignore */
    }
  }

  return { branchKey, branchName, branchId };
}

/**
 * Load schedule rows for an event day (photo + nickname + in/out + type).
 * @param {object} event
 * @param {{ date?: string }} [opts]
 */
export async function fetchEventSchedulePreview(event, opts = {}) {
  await initSync();
  const { getDocs, collection, doc, getDoc } = firestoreFns;
  const { branchKey, branchName } = await resolveEventBranch(event);

  if (!branchKey && !branchName) {
    return {
      rows: [],
      date: null,
      timedIn: 0,
      scheduled: 0,
      emptyReason: 'no-branch',
      branchKey: null,
      branchName: null,
      navDates: []
    };
  }

  const navDates = scheduleNavDates(event);
  if (!navDates.length) {
    return {
      rows: [],
      date: null,
      timedIn: 0,
      scheduled: 0,
      emptyReason: 'no-dates',
      branchKey,
      branchName,
      navDates: []
    };
  }

  const today = manilaTodayYmd();
  const requested = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : null;
  const focusDate = requested && navDates.includes(requested)
    ? requested
    : navDates.includes(today)
      ? today
      : navDates[0];

  const weekKey = weekKeyForYmd(focusDate);

  let shifts = [];
  try {
    const snap = await getDocs(collection(db, 'schedules', weekKey, 'shifts'));
    snap.forEach((s) => {
      const data = s.data() || {};
      if (data.date !== focusDate) return;
      if (!shiftBelongsToBranch(data.branch, branchKey, branchName)) return;
      if (!data.employeeId || data.employeeId === 'unassigned') return;
      shifts.push({ id: s.id, ...data });
    });
  } catch (err) {
    console.warn('Schedule preview load failed:', err);
    return {
      rows: [],
      date: focusDate,
      timedIn: 0,
      scheduled: 0,
      emptyReason: 'load-failed',
      branchKey,
      branchName,
      navDates
    };
  }

  shifts.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  const rows = [];
  let timedIn = 0;
  for (const shift of shifts) {
    const planned = plannedTimes(shift);
    let name = shift.employeeId;
    let photoUrl = null;
    let timeIn = planned.start;
    let timeOut = planned.end;
    let isActual = false;

    try {
      const empSnap = await getDoc(doc(db, 'employees_v2', shift.employeeId));
      if (empSnap.exists()) {
        const emp = empSnap.data() || {};
        name = emp.nickname || String(emp.name || '').split(' ')[0] || name;
        photoUrl = emp.photoUrl || null;
      }
    } catch (_) {
      /* ignore */
    }

    try {
      const attSnap = await getDoc(doc(db, 'attendance_v2', shift.employeeId, 'dates', focusDate));
      if (attSnap.exists()) {
        const att = attSnap.data() || {};
        const attBranch = att.clockIn?.branch || att.branch || '';
        if (!attBranch || shiftBelongsToBranch(attBranch, branchKey, branchName)) {
          const clockIn = att.clockIn?.time || att.timeIn || null;
          const clockOut = att.clockOut?.time || att.timeOut || null;
          if (clockIn) {
            isActual = true;
            timedIn += 1;
            timeIn = to12Hour(clockIn);
            timeOut = clockOut ? to12Hour(clockOut) : '';
            photoUrl = att.clockIn?.selfie || att.timeInPhoto || photoUrl;
          }
        }
      }
    } catch (_) {
      /* ignore */
    }

    const type = shift.type || 'opening';
    rows.push({
      shiftId: shift.id,
      employeeId: shift.employeeId,
      type,
      kind: shiftSectionKind(type),
      name,
      photoUrl,
      timeIn,
      timeOut,
      isActual,
      customStart: shift.customStart || null,
      customEnd: shift.customEnd || null
    });
  }

  return {
    rows,
    date: focusDate,
    timedIn,
    scheduled: rows.length,
    emptyReason: rows.length ? null : 'none',
    branchKey,
    branchName,
    navDates
  };
}

/** Active employees for the schedule widget picker. */
export async function fetchScheduleEmployees() {
  await initSync();
  const { getDocs, collection } = firestoreFns;
  const snap = await getDocs(collection(db, 'employees_v2'));
  const list = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    // Match Schedule app: archived OR active === false are excluded from assign dropdowns
    if (data.archived || data.active === false) return;
    const nickname = data.nickname || String(data.name || '').split(' ')[0] || d.id;
    list.push({
      id: d.id,
      nickname,
      name: data.name || nickname,
      photoUrl: data.photoUrl || null
    });
  });
  list.sort((a, b) => a.nickname.localeCompare(b.nickname));
  return list;
}

function generateShiftId() {
  return `shift_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create or update a scheduled shift for an event branch/day.
 * @param {{ shiftId?: string, date: string, branchKey: string, type: string, employeeId: string, customStart?: string, customEnd?: string }} input
 */
export async function saveEventShift(input) {
  await initSync();
  const { setDoc, getDoc, doc } = firestoreFns;
  const date = input.date;
  const branch = input.branchKey;
  const type = input.type;
  const employeeId = input.employeeId;
  if (!date || !branch || !type || !employeeId) {
    throw new Error('Missing shift fields');
  }
  if (!SHIFT_PRESETS[type]) throw new Error('Unknown shift type');

  let customStart = null;
  let customEnd = null;
  if (type === 'custom') {
    customStart = toTimeInputValue(input.customStart) || null;
    customEnd = toTimeInputValue(input.customEnd) || null;
    if (!customStart || !customEnd) {
      throw new Error('Custom shifts need start and end times');
    }
  }

  const id = input.shiftId || generateShiftId();
  const weekKey = weekKeyForYmd(date);
  let createdAt = input.createdAt || null;
  if (!createdAt && input.shiftId) {
    try {
      const existing = await getDoc(doc(db, 'schedules', weekKey, 'shifts', id));
      if (existing.exists()) createdAt = existing.data()?.createdAt || null;
    } catch (_) {
      /* ignore */
    }
  }
  if (!createdAt) createdAt = new Date().toISOString();

  const payload = {
    date,
    branch,
    type,
    employeeId,
    customStart,
    customEnd,
    role: 'barista',
    customRole: null,
    createdAt,
    updatedAt: new Date()
  };
  await setDoc(doc(db, 'schedules', weekKey, 'shifts', id), payload);
  return { id, ...payload };
}

export async function deleteEventShift({ shiftId, date }) {
  await initSync();
  const { deleteDoc, doc } = firestoreFns;
  if (!shiftId || !date) throw new Error('Missing shift id/date');
  const weekKey = weekKeyForYmd(date);
  await deleteDoc(doc(db, 'schedules', weekKey, 'shifts', shiftId));
}

export { EVENT_STATUSES };
