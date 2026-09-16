/**
 * Shared ops event catalog (Event Management System).
 * Collections: opsEventTypes, opsEvents
 * Confirmed events also provision Firestore `branches` for POS / schedule / expenses.
 */

export const OPS_EVENTS_COLLECTION = 'opsEvents';
export const OPS_EVENT_TYPES_COLLECTION = 'opsEventTypes';
export const SERVICE_LEADS_COLLECTION = 'serviceLeads';
export const INVOICES_COLLECTION = 'invoice-generator';
export const BRANCHES_COLLECTION = 'branches';

export const TIMEZONE = 'Asia/Manila';

export const EVENT_STATUSES = Object.freeze({
  draft: 'draft',
  confirmed: 'confirmed',
  cancelled: 'cancelled'
});

/** Seeded event types — written once if the types collection is empty. */
export const SEED_EVENT_TYPES = Object.freeze([
  {
    id: 'matcha_workshop',
    label: 'Matcha Workshop',
    color: '#2b9348',
    defaultDurationHours: 2,
    archived: false,
    adapters: {
      pos: false,
      schedule: true,
      expensesAllocation: 'Workshop',
      branchType: 'workshop',
      googleCalendar: true
    }
  },
  {
    id: 'mochi_workshop',
    label: 'Mochi Making Workshop',
    color: '#c2410c',
    defaultDurationHours: 2,
    archived: false,
    adapters: {
      pos: false,
      schedule: true,
      expensesAllocation: 'Workshop',
      branchType: 'workshop',
      googleCalendar: true
    }
  },
  {
    id: 'mobile_bar',
    label: 'Mobile Matcha Bar Service',
    color: '#0f766e',
    defaultDurationHours: 3,
    archived: false,
    adapters: {
      pos: false,
      schedule: true,
      expensesAllocation: 'Bar Service',
      branchType: 'service',
      googleCalendar: true
    }
  },
  {
    id: 'matcha_popup',
    label: 'Matcha Bar Pop-up',
    color: '#b45309',
    defaultDurationHours: 8,
    archived: false,
    adapters: {
      pos: true,
      schedule: true,
      expensesAllocation: 'Popup',
      branchType: 'popup',
      serviceType: 'popup',
      googleCalendar: true
    }
  }
]);

const LEAD_SERVICE_MOBILE_BAR = 'private_mobile_matcha_bar';
const LEAD_SERVICE_WORKSHOP = 'private_matcha_workshop';

export function slugifyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'event';
}

export function branchKeyForType(typeId, title, serviceMode) {
  const slug = slugifyKey(title);
  if (typeId === 'matcha_popup') {
    const prefix = serviceMode === 'package' ? 'package' : 'popup';
    return `${prefix}-${slug}`;
  }
  if (typeId === 'mobile_bar') return `service-${slug}`;
  return `workshop-${slug}`;
}

/** Derive serviceMode from type — no separate UI control. */
export function serviceModeForType(typeId) {
  if (typeId === 'matcha_popup') return 'popup';
  return null;
}

/** Short calendar label: workshop · pop-up · package · bar */
export function typeShorthand(event) {
  const typeId = event?.typeId;
  if (typeId === 'matcha_workshop' || typeId === 'mochi_workshop') return 'workshop';
  if (typeId === 'mobile_bar') return 'bar';
  if (typeId === 'matcha_popup') {
    return event?.serviceMode === 'package' ? 'package' : 'pop-up';
  }
  return '';
}

export function typeIdFromLead(lead) {
  const service = String(lead?.service || '').trim();
  const eventType = String(lead?.eventType || '').toLowerCase();
  if (
    eventType === 'matcha_popup' ||
    eventType === 'mobile_bar' ||
    eventType === 'matcha_workshop' ||
    eventType === 'mochi_workshop'
  ) {
    return eventType;
  }
  if (service === LEAD_SERVICE_MOBILE_BAR) return 'mobile_bar';
  if (service === LEAD_SERVICE_WORKSHOP) {
    if (eventType.includes('mochi')) return 'mochi_workshop';
    return 'matcha_workshop';
  }
  if (eventType.includes('mochi')) return 'mochi_workshop';
  if (eventType.includes('mobile') || eventType.includes('bar')) return 'mobile_bar';
  if (eventType.includes('popup') || eventType.includes('pop-up')) return 'matcha_popup';
  return 'matcha_workshop';
}

export function typeIdFromBranch(branch) {
  const t = String(branch?.type || '').toLowerCase();
  const key = String(branch?.key || '').toLowerCase();
  if (t === 'popup' || key.startsWith('popup') || key.startsWith('package')) {
    return 'matcha_popup';
  }
  if (t === 'service' || key.startsWith('service')) return 'mobile_bar';
  if (t === 'workshop' || key.startsWith('workshop')) return 'matcha_workshop';
  return null;
}

export function displayTitle(event) {
  const t = String(event?.title || '').trim();
  return t || 'Hold';
}

/** Party-detail fields shown by event type (separate from title). */
export function partyFieldsForType(typeId) {
  if (typeId === 'matcha_popup') {
    return [
      { key: 'organizer', label: 'Organizer' },
      { key: 'contactName', label: 'Contact person' }
    ];
  }
  if (typeId === 'mobile_bar') {
    return [
      { key: 'clientName', label: 'Client' },
      { key: 'contactName', label: 'Contact person' }
    ];
  }
  if (typeId === 'matcha_workshop' || typeId === 'mochi_workshop') {
    return [{ key: 'contactName', label: 'Contact person' }];
  }
  return [];
}

export function normalizePartyFields(input = {}) {
  return {
    organizer: String(input.organizer || '').trim(),
    clientName: String(input.clientName || '').trim(),
    contactName: String(input.contactName || '').trim()
  };
}

/** Unit for structured headcount by event type. */
export function headcountUnitForType(typeId) {
  if (typeId === 'mobile_bar') return 'cups';
  if (typeId === 'matcha_workshop' || typeId === 'mochi_workshop') return 'pax';
  return null;
}

export function parseHeadcount(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function resolveHeadcountFields(typeId, headcount, headcountUnit) {
  const unit = headcountUnit || headcountUnitForType(typeId) || null;
  if (!unit) return { headcount: null, headcountUnit: null };
  const n = parseHeadcount(headcount);
  if (n == null) return { headcount: null, headcountUnit: null };
  return { headcount: n, headcountUnit: unit };
}

export function formatHeadcountLabel(event) {
  const n = parseHeadcount(event?.headcount);
  if (n == null) return '';
  const unit = event?.headcountUnit || headcountUnitForType(event?.typeId);
  if (!unit) return String(n);
  return `${n} ${unit}`;
}

export function headcountFieldLabel(typeId) {
  const unit = headcountUnitForType(typeId);
  if (unit === 'cups') return 'Cups';
  if (unit === 'pax') return 'Pax';
  return null;
}

export function isScheduled(event) {
  return Boolean(event?.startDate && /^\d{4}-\d{2}-\d{2}$/.test(event.startDate));
}

export function eventTouchesMonth(event, year, monthIndex) {
  if (!isScheduled(event)) return false;
  const start = event.startDate;
  const end = event.endDate && /^\d{4}-\d{2}-\d{2}$/.test(event.endDate) ? event.endDate : start;
  const monthStart = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const monthEnd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return start <= monthEnd && end >= monthStart;
}

export function datesInRange(startDate, endDate) {
  if (!startDate) return [];
  const end = endDate && endDate >= startDate ? endDate : startDate;
  const out = [];
  let cur = startDate;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    cur = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    if (out.length > 62) break;
  }
  return out;
}

export function manilaTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function normalizeTargetDate(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object') {
    if (typeof raw.toDate === 'function') {
      try {
        raw = raw.toDate();
      } catch (_) {
        return '';
      }
    }
    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) return '';
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(raw);
    }
    if (typeof raw.seconds === 'number') {
      return normalizeTargetDate(new Date(raw.seconds * 1000));
    }
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {object} firestoreFns
 */
export async function ensureEventTypes(db, firestoreFns) {
  const { getDocs, collection, doc, setDoc, serverTimestamp } = firestoreFns;
  const snap = await getDocs(collection(db, OPS_EVENT_TYPES_COLLECTION));
  if (!snap.empty) {
    const types = [];
    snap.forEach((d) => types.push({ id: d.id, ...d.data() }));
    return types.filter((t) => !t.archived);
  }
  const now = serverTimestamp ? { createdAt: serverTimestamp() } : { createdAt: new Date().toISOString() };
  await Promise.all(
    SEED_EVENT_TYPES.map((t) => {
      const { id, ...rest } = t;
      return setDoc(doc(db, OPS_EVENT_TYPES_COLLECTION, id), { ...rest, ...now });
    })
  );
  return SEED_EVENT_TYPES.map((t) => ({ ...t }));
}

export async function loadEventTypes(db, firestoreFns) {
  const { getDocs, collection } = firestoreFns;
  const snap = await getDocs(collection(db, OPS_EVENT_TYPES_COLLECTION));
  if (snap.empty) return ensureEventTypes(db, firestoreFns);
  const types = [];
  snap.forEach((d) => types.push({ id: d.id, ...d.data() }));
  return types.filter((t) => !t.archived).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

export async function loadOpsEvents(db, firestoreFns, { includeCancelled = false } = {}) {
  const { getDocs, collection } = firestoreFns;
  const snap = await getDocs(collection(db, OPS_EVENTS_COLLECTION));
  const events = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    if (!includeCancelled && data.status === EVENT_STATUSES.cancelled) return;
    events.push({ id: d.id, ...data });
  });
  return events;
}

export function buildEventPayload(input = {}, { createdBy = 'events-app' } = {}) {
  const now = new Date().toISOString();
  const status = input.status || EVENT_STATUSES.draft;
  const title = String(input.title || '').trim();
  const typeId = input.typeId || null;
  const startDate = normalizeTargetDate(input.startDate) || null;
  const endDate = normalizeTargetDate(input.endDate) || startDate;
  const key =
    input.key ||
    (typeId && title ? branchKeyForType(typeId, title, serviceModeForType(typeId)) : null);
  const { headcount, headcountUnit } = resolveHeadcountFields(
    typeId,
    input.headcount,
    input.headcountUnit
  );
  const party = normalizePartyFields(input);

  return {
    title,
    typeId,
    status,
    startDate,
    endDate: endDate || startDate,
    startTime: input.startTime || null,
    endTime: input.endTime || null,
    venue: String(input.venue || '').trim(),
    organizer: party.organizer,
    clientName: party.clientName,
    contactName: party.contactName,
    notes: String(input.notes || '').trim(),
    headcount,
    headcountUnit,
    key,
    serviceMode: serviceModeForType(typeId),
    links: {
      branchId: input.links?.branchId || null,
      branchKey: input.links?.branchKey || null,
      forecastId: input.links?.forecastId || null,
      workshopEventId: input.links?.workshopEventId || null,
      googleCalendarEventId: input.links?.googleCalendarEventId || null,
      leadId: input.links?.leadId || null,
      invoiceId: input.links?.invoiceId || null
    },
    createdBy: input.createdBy || createdBy,
    updatedBy: input.updatedBy || createdBy,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

export async function createOpsEvent(db, firestoreFns, input, opts = {}) {
  const { addDoc, collection } = firestoreFns;
  const payload = buildEventPayload(input, opts);
  const ref = await addDoc(collection(db, OPS_EVENTS_COLLECTION), payload);
  return { id: ref.id, ...payload };
}

export async function updateOpsEvent(db, firestoreFns, eventId, patch, opts = {}) {
  const { doc, updateDoc } = firestoreFns;
  const updates = {
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: opts.updatedBy || 'events-app'
  };
  if (patch.links) {
    updates.links = { ...patch.links };
  }
  await updateDoc(doc(db, OPS_EVENTS_COLLECTION, eventId), updates);
  return updates;
}

export async function deleteOpsEvent(db, firestoreFns, eventId) {
  const { doc, deleteDoc } = firestoreFns;
  await deleteDoc(doc(db, OPS_EVENTS_COLLECTION, eventId));
}

/**
 * Provision or update a `branches` row for a confirmed ops event.
 */
export async function provisionBranchForEvent(db, firestoreFns, event, typeMeta) {
  const { doc, setDoc, updateDoc, addDoc, collection, getDocs, query, where } = firestoreFns;
  const adapters = typeMeta?.adapters || SEED_EVENT_TYPES.find((t) => t.id === event.typeId)?.adapters;
  if (!adapters?.branchType) return null;

  const title = displayTitle(event);
  const key =
    event.key ||
    event.links?.branchKey ||
    branchKeyForType(event.typeId, title, event.serviceMode);

  const branchData = {
    key,
    name: title === 'Hold' ? key : title,
    type: adapters.branchType,
    archived: false,
    status: 'active',
    opsEventId: event.id,
    lastModified: new Date().toISOString()
  };
  if (adapters.branchType === 'popup') {
    branchData.serviceType =
      event.serviceMode === 'package' ? 'package' : adapters.serviceType || 'popup';
  }

  if (event.links?.branchId) {
    await updateDoc(doc(db, BRANCHES_COLLECTION, event.links.branchId), branchData);
    return { id: event.links.branchId, ...branchData };
  }

  // Prefer matching existing branch by key
  if (getDocs && query && where) {
    try {
      const snap = await getDocs(query(collection(db, BRANCHES_COLLECTION), where('key', '==', key)));
      if (!snap.empty) {
        const existing = snap.docs[0];
        await updateDoc(existing.ref, branchData);
        return { id: existing.id, ...branchData };
      }
    } catch (_) {
      /* fall through to scan */
    }
  }

  const all = await getDocs(collection(db, BRANCHES_COLLECTION));
  let matched = null;
  all.forEach((d) => {
    const data = d.data() || {};
    if (data.key === key || data.opsEventId === event.id) matched = { id: d.id, ...data };
  });
  if (matched) {
    await updateDoc(doc(db, BRANCHES_COLLECTION, matched.id), branchData);
    return { id: matched.id, ...branchData };
  }

  const created = {
    ...branchData,
    createdAt: new Date().toISOString(),
    createdBy: 'events-app'
  };
  if (setDoc && event.id) {
    // Use ops event id as branch doc id when possible for stable joins
    try {
      await setDoc(doc(db, BRANCHES_COLLECTION, event.id), created, { merge: true });
      return { id: event.id, ...created };
    } catch (_) {
      /* fall through */
    }
  }
  const ref = await addDoc(collection(db, BRANCHES_COLLECTION), created);
  return { id: ref.id, ...created };
}

export async function archiveBranchForEvent(db, firestoreFns, event) {
  const { doc, updateDoc } = firestoreFns;
  const branchId = event.links?.branchId;
  if (!branchId) return;
  try {
    await updateDoc(doc(db, BRANCHES_COLLECTION, branchId), {
      archived: true,
      status: 'archived',
      lastModified: new Date().toISOString()
    });
  } catch (_) {
    /* ignore */
  }
}

/**
 * Confirm an ops event: set status + provision branch + link.
 */
export async function confirmOpsEvent(db, firestoreFns, event, typeMeta) {
  const { doc, updateDoc } = firestoreFns;
  const branch = await provisionBranchForEvent(db, firestoreFns, event, typeMeta);
  const links = {
    ...(event.links || {}),
    branchId: branch?.id || event.links?.branchId || null,
    branchKey: branch?.key || event.links?.branchKey || event.key || null
  };
  const key = branch?.key || event.key || links.branchKey;
  await updateDoc(doc(db, OPS_EVENTS_COLLECTION, event.id), {
    status: EVENT_STATUSES.confirmed,
    key,
    links,
    updatedAt: new Date().toISOString(),
    updatedBy: 'events-app'
  });
  return { ...event, status: EVENT_STATUSES.confirmed, key, links };
}

/**
 * Dual-write helper when POS / Schedule create a branches row.
 */
export async function createOpsEventFromBranch(db, firestoreFns, branch, { createdBy = 'branch-sync' } = {}) {
  const typeId = typeIdFromBranch(branch);
  if (!typeId) return null;

  // Skip if already linked
  if (branch.opsEventId) return { id: branch.opsEventId };

  const { getDocs, collection, addDoc, updateDoc, doc } = firestoreFns;
  const snap = await getDocs(collection(db, OPS_EVENTS_COLLECTION));
  let existing = null;
  snap.forEach((d) => {
    const data = d.data() || {};
    if (data.links?.branchId === branch.id || data.links?.branchKey === branch.key || data.key === branch.key) {
      existing = { id: d.id, ...data };
    }
  });
  if (existing) {
    if (branch.id && !branch.opsEventId) {
      try {
        await updateDoc(doc(db, BRANCHES_COLLECTION, branch.id), { opsEventId: existing.id });
      } catch (_) {
        /* ignore */
      }
    }
    return existing;
  }

  const payload = buildEventPayload(
    {
      title: branch.name || '',
      typeId,
      status: EVENT_STATUSES.confirmed,
      startDate: null,
      endDate: null,
      key: branch.key,
      serviceMode: branch.serviceType === 'package' ? 'package' : null,
      links: {
        branchId: branch.id || null,
        branchKey: branch.key || null
      },
      createdBy
    },
    { createdBy }
  );
  const ref = await addDoc(collection(db, OPS_EVENTS_COLLECTION), payload);
  if (branch.id) {
    try {
      await updateDoc(doc(db, BRANCHES_COLLECTION, branch.id), { opsEventId: ref.id });
    } catch (_) {
      /* ignore */
    }
  }
  return { id: ref.id, ...payload };
}

/**
 * Import branches that lack an opsEvent into opsEvents as unscheduled confirmed rows.
 */
export async function backfillOpsEventsFromBranches(db, firestoreFns) {
  const { getDocs, collection } = firestoreFns;
  const [branchesSnap, eventsSnap] = await Promise.all([
    getDocs(collection(db, BRANCHES_COLLECTION)),
    getDocs(collection(db, OPS_EVENTS_COLLECTION))
  ]);

  const linkedBranchIds = new Set();
  const linkedKeys = new Set();
  eventsSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.links?.branchId) linkedBranchIds.add(data.links.branchId);
    if (data.links?.branchKey) linkedKeys.add(data.links.branchKey);
    if (data.key) linkedKeys.add(data.key);
  });

  const created = [];
  for (const d of branchesSnap.docs) {
    const data = d.data() || {};
    if (data.archived) continue;
    const t = data.type;
    if (t !== 'popup' && t !== 'workshop' && t !== 'service') continue;
    if (data.opsEventId || linkedBranchIds.has(d.id) || (data.key && linkedKeys.has(data.key))) continue;
    const row = await createOpsEventFromBranch(
      db,
      firestoreFns,
      { id: d.id, ...data },
      { createdBy: 'backfill' }
    );
    if (row) created.push(row);
  }
  return created;
}

/**
 * Promote a service lead into a draft ops event.
 */
export async function promoteLeadToOpsEvent(db, firestoreFns, lead, opts = {}) {
  const { doc, updateDoc } = firestoreFns;
  if (!lead?.id) throw new Error('Lead id required');
  if (lead.opsEventId) {
    return { id: lead.opsEventId, alreadyLinked: true };
  }

  const startDate = normalizeTargetDate(lead.targetDate);
  if (!startDate) {
    throw new Error('Set a target date on the lead before adding it to the calendar.');
  }

  const typeId = typeIdFromLead(lead);
  const clientName = String(lead.clientName || '').trim();
  const title =
    String(lead.eventName || lead.eventTitle || lead.quoteReference || clientName || '').trim() ||
    'Lead event';
  const noteParts = [];
  if (lead.quoteReference) noteParts.push(`Quote: ${lead.quoteReference}`);
  if (lead.eventType) noteParts.push(`Event type: ${lead.eventType}`);
  if (lead.notes) noteParts.push(String(lead.notes).trim());
  const { headcount, headcountUnit } = resolveHeadcountFields(
    typeId,
    lead.targetPax,
    null
  );

  const event = await createOpsEvent(
    db,
    firestoreFns,
    {
      title,
      typeId,
      status: EVENT_STATUSES.draft,
      startDate,
      endDate: startDate,
      venue: String(lead.targetVenue || '').trim(),
      clientName,
      contactName: String(lead.contactName || lead.contactPerson || '').trim(),
      organizer: String(lead.organizer || '').trim(),
      notes: noteParts.join('\n'),
      headcount,
      headcountUnit,
      links: { leadId: lead.id },
      createdBy: opts.createdBy || 'lead-promote'
    },
    { createdBy: opts.createdBy || 'lead-promote' }
  );

  await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, lead.id), {
    opsEventId: event.id,
    updatedAt: new Date().toISOString()
  });

  return event;
}

/**
 * Soft-archive a service lead so it leaves the calendar overlay / active lists.
 */
export async function archiveServiceLead(db, firestoreFns, leadId, opts = {}) {
  const { doc, updateDoc } = firestoreFns;
  if (!leadId) throw new Error('Lead id required');
  const now = new Date().toISOString();
  await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, leadId), {
    archived: true,
    archivedAt: now,
    updatedAt: now,
    updatedBy: opts.updatedBy || 'events-app'
  });
  return { id: leadId, archived: true, archivedAt: now };
}

export function invoicePrimaryItem(invoice) {
  const items = Array.isArray(invoice?.invoiceItems) ? invoice.invoiceItems : [];
  const packages = items.filter((item) => {
    if (!item) return false;
    if (item.isWorkshop) return true;
    return !!(item.packageType && item.packageType !== 'custom');
  });
  return packages[0] || items[0] || null;
}

export function invoiceCalendarDates(invoice) {
  return invoicePackageDays(invoice).map((d) => d.date);
}

/**
 * One calendar day per dated package line (cups/pax/venue from that package).
 */
export function invoicePackageDays(invoice) {
  const items = Array.isArray(invoice?.invoiceItems) ? invoice.invoiceItems : [];
  const packages = items.filter((item) => {
    if (!item) return false;
    if (item.isWorkshop) return true;
    return !!(item.packageType && item.packageType !== 'custom');
  });
  const pool = packages.length ? packages : items;
  const days = [];
  for (const item of pool) {
    const date = normalizeTargetDate(item?.eventDate || item?.date);
    if (!date) continue;
    const typeId = typeIdFromInvoice({ ...invoice, invoiceItems: [item] }) || 'mobile_bar';
    days.push({
      date,
      venue: String(item.eventVenue || '').trim(),
      count: invoiceItemCount(item),
      typeId,
      description: String(item.description || '').trim(),
      itemId: item.id != null ? String(item.id) : null,
      item
    });
  }
  if (!days.length) {
    const top = normalizeTargetDate(invoice?.eventDate || invoice?.event_date);
    if (top) {
      const primary = invoicePrimaryItem(invoice);
      const typeId = typeIdFromInvoice(invoice) || 'mobile_bar';
      days.push({
        date: top,
        venue: String(primary?.eventVenue || invoice.eventVenue || '').trim(),
        count: invoiceItemCount(primary),
        typeId,
        description: String(primary?.description || '').trim(),
        itemId: primary?.id != null ? String(primary.id) : null,
        item: primary
      });
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export function invoicePrimaryDate(invoice) {
  const dates = invoiceCalendarDates(invoice);
  return dates[0] || '';
}

export function invoiceItemCount(item) {
  if (!item) return null;
  if (item.count != null && item.count !== '') return item.count;
  const cups = String(item.cups || '').match(/\d+/);
  if (cups) return cups[0];
  const pax = String(item.numberOfPax || '').match(/\d+/);
  if (pax) return pax[0];
  return null;
}

export function typeIdFromInvoice(invoice) {
  const item = invoicePrimaryItem(invoice);
  const et = String(item?.eventType || '').toLowerCase();
  const desc = String(item?.description || '').toLowerCase();
  if (et === 'mochi_workshop' || et.includes('mochi') || desc.includes('mochi')) return 'mochi_workshop';
  if (et === 'matcha_workshop' || et.includes('workshop') || desc.includes('workshop')) {
    return 'matcha_workshop';
  }
  if (et === 'mobile_bar' || et.includes('mobile') || et.includes('bar') || desc.includes('mobile')) {
    return 'mobile_bar';
  }
  if (et === 'matcha_popup' || desc.includes('pop-up') || desc.includes('popup')) return 'matcha_popup';
  if (item?.isWorkshop) return 'matcha_workshop';
  if (item?.packageType) return 'mobile_bar';
  return 'mobile_bar';
}

/**
 * Shape an invoice as an Invoiced lead for Events overlay (no serviceLead required).
 * Prefer invoiceAsLeadOverlays() when an invoice has multiple package days.
 */
export function invoiceAsLeadOverlay(invoice) {
  return invoiceAsLeadOverlays(invoice)[0] || null;
}

/** One overlay row per package day (correct cups/venue per day). */
export function invoiceAsLeadOverlays(invoice) {
  const invoiceId = invoice.id;
  const days = invoicePackageDays(invoice);
  const baseName =
    String(invoice.clientName || invoice.clientCompany || invoice.invoiceNumber || 'Invoice').trim() ||
    'Invoice';
  const quoted =
    invoice.totalAmount != null
      ? String(invoice.totalAmount)
      : invoice.amountTotal != null
        ? String(invoice.amountTotal)
        : null;
  const eventName = String(invoice.eventName || invoice.eventTitle || '').trim();
  const contactName = String(invoice.contactName || invoice.contactPerson || '').trim();
  const organizer = String(invoice.organizer || '').trim();
  return days.map((day, index) => ({
    id: `inv:${invoiceId}:${day.date}:${day.itemId || index}`,
    source: 'invoice',
    invoiceId,
    leadId: invoice.leadId || null,
    clientName: baseName,
    eventName: eventName || baseName,
    organizer,
    contactName,
    quoteReference: invoice.invoiceNumber || null,
    targetDate: day.date,
    targetDates: [day.date],
    targetVenue: day.venue,
    targetPax: day.count,
    eventType: day.typeId,
    pipelineStatus: 'invoiced',
    opsEventId: invoice.opsEventId || null,
    archived: !!invoice.archived,
    quotedPrice: quoted,
    totalAmount: invoice.totalAmount ?? invoice.amountTotal ?? null
  }));
}

/**
 * Soft-archive an invoice (and linked lead when present).
 */
export async function archiveInvoice(db, firestoreFns, invoiceId, opts = {}) {
  const { doc, updateDoc, getDoc } = firestoreFns;
  if (!invoiceId) throw new Error('Invoice id required');
  const now = new Date().toISOString();
  const invRef = doc(db, INVOICES_COLLECTION, invoiceId);
  const snap = await getDoc(invRef);
  const data = snap.exists() ? snap.data() || {} : {};
  await updateDoc(invRef, {
    archived: true,
    archivedAt: now,
    updatedAt: now,
    updatedBy: opts.updatedBy || 'events-app'
  });
  if (data.leadId) {
    try {
      await archiveServiceLead(db, firestoreFns, data.leadId, opts);
    } catch (_) {
      /* lead may be missing */
    }
  }
  return { id: invoiceId, archived: true, archivedAt: now, leadId: data.leadId || null };
}

/**
 * Soft-archive a booking overlay row (real lead or invoice-sourced).
 */
export async function archiveOverlayBooking(db, firestoreFns, booking, opts = {}) {
  if (!booking) throw new Error('Booking required');
  if (booking.source === 'invoice' || booking.invoiceId) {
    const invoiceId =
      booking.invoiceId ||
      (String(booking.id).startsWith('inv:') ? String(booking.id).split(':')[1] : null);
    return archiveInvoice(db, firestoreFns, invoiceId, opts);
  }
  if (booking.id && !String(booking.id).startsWith('inv:')) {
    return archiveServiceLead(db, firestoreFns, booking.id, opts);
  }
  throw new Error('Nothing to archive');
}

/**
 * Merge an invoice into an existing ops event with per-field retain choices.
 * retain: { title, venue, startDate, endDate, typeId, headcount } each 'event' | 'invoice'
 */
export async function mergeInvoiceIntoOpsEvent(db, firestoreFns, invoice, eventId, retain = {}, opts = {}) {
  const { doc, updateDoc, getDoc } = firestoreFns;
  if (!invoice?.id) throw new Error('Invoice id required');
  if (!eventId) throw new Error('Event id required');

  const evSnap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, eventId));
  if (!evSnap.exists()) throw new Error('Event not found');
  const event = { id: evSnap.id, ...evSnap.data() };

  const dates = invoiceCalendarDates(invoice);
  const primary = invoicePrimaryItem(invoice);
  const invTitle =
    String(
      invoice.eventName || invoice.eventTitle || invoice.clientName || invoice.clientCompany || invoice.invoiceNumber || ''
    ).trim() || 'Invoice event';
  const invVenue = String(primary?.eventVenue || '').trim();
  const invTypeId = typeIdFromInvoice(invoice);
  const invHc = resolveHeadcountFields(invTypeId, invoiceItemCount(primary), null);
  const invParty = normalizePartyFields({
    organizer: invoice.organizer,
    clientName: invoice.clientName || invoice.clientCompany,
    contactName: invoice.contactName || invoice.contactPerson
  });

  const pick = (key, eventVal, invoiceVal) =>
    (retain[key] || 'event') === 'invoice' ? invoiceVal : eventVal;

  const startDate = pick('startDate', event.startDate, dates[0] || event.startDate);
  const endDate = pick(
    'endDate',
    event.endDate || event.startDate,
    dates[dates.length - 1] || dates[0] || event.endDate
  );
  const typeId = pick('typeId', event.typeId, invTypeId);
  const headcountFields =
    (retain.headcount || 'event') === 'invoice'
      ? invHc
      : { headcount: event.headcount ?? null, headcountUnit: event.headcountUnit ?? null };

  const patch = {
    title: pick('title', event.title, invTitle),
    venue: pick('venue', event.venue, invVenue),
    startDate: normalizeTargetDate(startDate) || event.startDate,
    endDate: normalizeTargetDate(endDate) || normalizeTargetDate(startDate) || event.endDate,
    typeId,
    headcount: headcountFields.headcount,
    headcountUnit: headcountFields.headcountUnit,
    serviceMode: serviceModeForType(typeId),
    organizer: pick('organizer', event.organizer || '', invParty.organizer),
    clientName: pick('clientName', event.clientName || '', invParty.clientName),
    contactName: pick('contactName', event.contactName || '', invParty.contactName),
    links: {
      ...(event.links || {}),
      invoiceId: invoice.id,
      leadId: invoice.leadId || event.links?.leadId || null
    },
    updatedAt: new Date().toISOString(),
    updatedBy: opts.updatedBy || 'invoice-merge'
  };

  await updateDoc(doc(db, OPS_EVENTS_COLLECTION, eventId), patch);

  const now = new Date().toISOString();
  await updateDoc(doc(db, INVOICES_COLLECTION, invoice.id), {
    opsEventId: eventId,
    updatedAt: now
  });

  if (invoice.leadId) {
    try {
      await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, invoice.leadId), {
        opsEventId: eventId,
        pipelineStatus: 'invoiced',
        updatedAt: now
      });
    } catch (_) {
      /* ignore */
    }
  }

  return { id: eventId, ...event, ...patch };
}

/**
 * Write-through booking details to every linked store that applies.
 * Event name (title) stays separate from organizer / client / contact.
 */
export async function patchBookingDetails(db, firestoreFns, input = {}, opts = {}) {
  const { doc, updateDoc, getDoc } = firestoreFns;
  const now = new Date().toISOString();
  const updatedBy = opts.updatedBy || 'events-app';
  const title = input.title != null ? String(input.title).trim() : undefined;
  const venue = input.venue != null ? String(input.venue).trim() : undefined;
  const startDate =
    input.startDate != null ? normalizeTargetDate(input.startDate) || null : undefined;
  const endDate =
    input.endDate != null
      ? normalizeTargetDate(input.endDate) || startDate || null
      : startDate !== undefined
        ? startDate
        : undefined;
  const party =
    input.organizer != null || input.clientName != null || input.contactName != null
      ? normalizePartyFields(input)
      : null;

  const links = input.links || {};
  let opsEventId = input.opsEventId || null;
  let leadId = links.leadId || input.leadId || null;
  let invoiceId = links.invoiceId || input.invoiceId || null;
  const notes = [];

  if (opsEventId) {
    const patch = { updatedAt: now, updatedBy };
    if (title !== undefined) patch.title = title;
    if (venue !== undefined) patch.venue = venue;
    if (startDate !== undefined) patch.startDate = startDate;
    if (endDate !== undefined) patch.endDate = endDate || startDate;
    if (party) {
      if (input.organizer != null) patch.organizer = party.organizer;
      if (input.clientName != null) patch.clientName = party.clientName;
      if (input.contactName != null) patch.contactName = party.contactName;
    }
    await updateDoc(doc(db, OPS_EVENTS_COLLECTION, opsEventId), patch);

    try {
      const evSnap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, opsEventId));
      if (evSnap.exists()) {
        const ev = evSnap.data() || {};
        leadId = leadId || ev.links?.leadId || null;
        invoiceId = invoiceId || ev.links?.invoiceId || null;
        if (ev.links?.branchId && (title !== undefined || startDate !== undefined)) {
          const branchPatch = { lastModified: now };
          if (title !== undefined) branchPatch.name = title || ev.title || '';
          if (startDate !== undefined) branchPatch.startDate = startDate;
          if (endDate !== undefined) branchPatch.endDate = endDate || startDate;
          await updateDoc(doc(db, BRANCHES_COLLECTION, ev.links.branchId), branchPatch);
        }
        if (ev.links?.googleCalendarEventId) {
          notes.push('Google Calendar link present; calendar API sync skipped in this client.');
        }
      }
    } catch (err) {
      notes.push(err.message || 'Branch/calendar sync note failed');
    }
  }

  if (leadId) {
    const patch = { updatedAt: now };
    if (title !== undefined) patch.eventName = title;
    if (venue !== undefined) patch.targetVenue = venue;
    if (startDate !== undefined) patch.targetDate = startDate;
    if (party) {
      if (input.organizer != null) patch.organizer = party.organizer;
      if (input.clientName != null) patch.clientName = party.clientName;
      if (input.contactName != null) patch.contactName = party.contactName;
    }
    await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, leadId), patch);
  }

  if (invoiceId) {
    const invRef = doc(db, INVOICES_COLLECTION, invoiceId);
    const invSnap = await getDoc(invRef);
    if (invSnap.exists()) {
      const data = invSnap.data() || {};
      const items = Array.isArray(data.invoiceItems) ? data.invoiceItems.map((item) => ({ ...item })) : [];
      if (venue !== undefined || startDate !== undefined) {
        for (const item of items) {
          if (venue !== undefined) item.eventVenue = venue;
          if (startDate !== undefined) item.eventDate = startDate;
        }
      }
      const patch = { updatedAt: now };
      if (title !== undefined) patch.eventName = title;
      if (startDate !== undefined) patch.eventDate = startDate;
      if (party) {
        if (input.organizer != null) patch.organizer = party.organizer;
        if (input.clientName != null) patch.clientName = party.clientName;
        if (input.contactName != null) patch.contactName = party.contactName;
      }
      if (items.length) patch.invoiceItems = items;
      await updateDoc(invRef, patch);
    }
  }

  return { opsEventId, leadId, invoiceId, notes };
}

/**
 * Promote an invoice into draft ops event(s) — one event per package day.
 */
export async function promoteInvoiceToOpsEvent(db, firestoreFns, invoice, opts = {}) {
  const { doc, updateDoc, getDoc, deleteDoc } = firestoreFns;
  if (!invoice?.id) throw new Error('Invoice id required');

  const packageDays = invoicePackageDays(invoice);
  if (!packageDays.length) {
    throw new Error('Set an event date on the invoice before adding it to the calendar.');
  }

  const existingIds = [
    ...(Array.isArray(invoice.opsEventIds) ? invoice.opsEventIds : []),
    invoice.opsEventId
  ].filter(Boolean);
  const uniqueExisting = [...new Set(existingIds)];

  const needsResplit =
    packageDays.length > 1 &&
    uniqueExisting.length > 0 &&
    uniqueExisting.length < packageDays.length;

  // Already correctly split (or single-day already linked)
  if (uniqueExisting.length && !needsResplit && !opts.forceResplit) {
    return { id: uniqueExisting[0], ids: uniqueExisting, alreadyLinked: true };
  }

  // Remove prior draft event(s) before creating one-per-package-day
  if (uniqueExisting.length && (needsResplit || opts.forceResplit)) {
    for (const id of uniqueExisting) {
      try {
        const snap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, id));
        if (!snap.exists()) continue;
        const data = snap.data() || {};
        if (data.status === EVENT_STATUSES.draft || opts.forceResplit) {
          if (typeof deleteDoc === 'function') {
            await deleteDoc(doc(db, OPS_EVENTS_COLLECTION, id));
          }
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  // If linked lead already has an event and invoice is single-day, reuse it.
  if (invoice.leadId && packageDays.length === 1) {
    try {
      const leadSnap = await getDoc(doc(db, SERVICE_LEADS_COLLECTION, invoice.leadId));
      if (leadSnap.exists()) {
        const lead = leadSnap.data() || {};
        if (lead.opsEventId) {
          const now = new Date().toISOString();
          const day = packageDays[0];
          const evPatch = {
            'links.invoiceId': invoice.id,
            'links.invoiceItemId': day.itemId,
            updatedAt: now,
            updatedBy: opts.createdBy || 'invoice-promote'
          };
          const evSnap = await getDoc(doc(db, OPS_EVENTS_COLLECTION, lead.opsEventId));
          if (evSnap.exists()) {
            const ev = evSnap.data() || {};
            if (!ev.typeId && day.typeId) {
              evPatch.typeId = day.typeId;
              evPatch.serviceMode = serviceModeForType(day.typeId);
            }
            const hc = resolveHeadcountFields(day.typeId, day.count, null);
            if (ev.headcount == null && hc.headcount != null) {
              evPatch.headcount = hc.headcount;
              evPatch.headcountUnit = hc.headcountUnit;
            }
          }
          await updateDoc(doc(db, INVOICES_COLLECTION, invoice.id), {
            opsEventId: lead.opsEventId,
            opsEventIds: [lead.opsEventId],
            updatedAt: now
          });
          await updateDoc(doc(db, OPS_EVENTS_COLLECTION, lead.opsEventId), evPatch);
          await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, invoice.leadId), {
            pipelineStatus: 'invoiced',
            updatedAt: now
          });
          return {
            id: lead.opsEventId,
            ids: [lead.opsEventId],
            alreadyLinked: true,
            reusedLeadEvent: true
          };
        }
      }
    } catch (_) {
      /* fall through to create */
    }
  }

  const clientName = String(invoice.clientName || invoice.clientCompany || '').trim();
  const titleBase =
    String(invoice.eventName || invoice.eventTitle || invoice.invoiceNumber || clientName || '').trim() ||
    'Invoice event';
  const created = [];

  for (const day of packageDays) {
    const typeId = day.typeId || 'mobile_bar';
    const noteParts = [];
    if (invoice.invoiceNumber) noteParts.push(`Invoice: ${invoice.invoiceNumber}`);
    if (day.description) noteParts.push(day.description);
    if (packageDays.length > 1) noteParts.push(`Package day ${day.date}`);
    if (invoice.notes) noteParts.push(String(invoice.notes).trim());
    const { headcount, headcountUnit } = resolveHeadcountFields(typeId, day.count, null);

    const event = await createOpsEvent(
      db,
      firestoreFns,
      {
        title: titleBase,
        typeId,
        status: EVENT_STATUSES.draft,
        startDate: day.date,
        endDate: day.date,
        venue: day.venue,
        clientName,
        contactName: String(invoice.contactName || invoice.contactPerson || '').trim(),
        organizer: String(invoice.organizer || '').trim(),
        notes: noteParts.join('\n'),
        headcount,
        headcountUnit,
        links: {
          invoiceId: invoice.id,
          invoiceItemId: day.itemId,
          leadId: invoice.leadId || null
        },
        createdBy: opts.createdBy || 'invoice-promote'
      },
      { createdBy: opts.createdBy || 'invoice-promote' }
    );
    created.push(event);
  }

  const now = new Date().toISOString();
  const ids = created.map((e) => e.id);
  await updateDoc(doc(db, INVOICES_COLLECTION, invoice.id), {
    opsEventId: ids[0],
    opsEventIds: ids,
    updatedAt: now
  });

  if (invoice.leadId) {
    try {
      await updateDoc(doc(db, SERVICE_LEADS_COLLECTION, invoice.leadId), {
        opsEventId: ids[0],
        pipelineStatus: 'invoiced',
        updatedAt: now
      });
    } catch (_) {
      /* lead may be missing */
    }
  }

  return { ...created[0], id: ids[0], ids };
}

/**
 * Load leads + active invoices (as Invoiced) for the calendar overlay.
 */
export async function loadOverlayLeads(db, firestoreFns, { year, monthIndex } = {}) {
  const { getDocs, collection } = firestoreFns;
  const prefix =
    year != null && monthIndex != null
      ? `${year}-${String(monthIndex + 1).padStart(2, '0')}`
      : null;

  const leadsSnap = await getDocs(collection(db, SERVICE_LEADS_COLLECTION));
  const byLeadId = new Map();
  const leads = [];

  leadsSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.opsEventId) return;
    if (data.archived) return;
    const targetDate = normalizeTargetDate(data.targetDate);
    if (!targetDate) return;
    if (prefix && !targetDate.startsWith(prefix)) return;
    const row = {
      id: d.id,
      ...data,
      source: 'lead',
      targetDate,
      pipelineStatus: data.pipelineStatus || 'inquiry'
    };
    byLeadId.set(d.id, row);
    leads.push(row);
  });

  const invSnap = await getDocs(collection(db, INVOICES_COLLECTION));
  invSnap.forEach((d) => {
    const data = d.data() || {};
    if (data.archived) return;
    if (data.opsEventId || (Array.isArray(data.opsEventIds) && data.opsEventIds.length)) return;
    const rows = invoiceAsLeadOverlays({ ...data, id: d.id });
    if (!rows.length) return;
    if (prefix && !rows.some((row) => row.targetDate.startsWith(prefix))) return;

    if (data.leadId && byLeadId.has(data.leadId)) {
      // Drop the plain lead chip; package-day invoiced chips replace it.
      const idx = leads.findIndex((l) => l.id === data.leadId);
      if (idx >= 0) leads.splice(idx, 1);
      byLeadId.delete(data.leadId);
    }

    for (const row of rows) {
      if (prefix && !row.targetDate.startsWith(prefix)) continue;
      leads.push(row);
    }
  });

  return leads;
}

/**
 * Load invoices that should overlay the calendar (have event date, not yet promoted).
 * @deprecated Prefer loadOverlayLeads which includes invoices as Invoiced leads.
 */
export async function loadOverlayInvoices(db, firestoreFns, { year, monthIndex } = {}) {
  const { getDocs, collection } = firestoreFns;
  const snap = await getDocs(collection(db, INVOICES_COLLECTION));
  const invoices = [];
  const prefix =
    year != null && monthIndex != null
      ? `${year}-${String(monthIndex + 1).padStart(2, '0')}`
      : null;

  snap.forEach((d) => {
    const data = d.data() || {};
    if (data.archived) return;
    if (data.opsEventId) return;
    const dates = invoiceCalendarDates({ ...data, id: d.id });
    if (!dates.length) return;
    if (prefix && !dates.some((dt) => dt.startsWith(prefix))) return;

    const primary = invoicePrimaryItem(data);
    invoices.push({
      id: d.id,
      ...data,
      eventDate: dates[0],
      eventDates: dates,
      eventVenue: String(primary?.eventVenue || data.eventVenue || '').trim(),
      eventType: primary?.eventType || null,
      headcountHint: invoiceItemCount(primary),
      totalAmount: data.totalAmount ?? data.amountTotal ?? null
    });
  });
  return invoices;
}

export function pipelineLabel(status) {
  const map = {
    inquiry: 'Inquiry',
    quoted: 'Quoted',
    invoiced: 'Invoiced',
    deposit: 'Deposit',
    completed: 'Completed'
  };
  return map[status] || status || 'Inquiry';
}

