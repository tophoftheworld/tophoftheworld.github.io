/* Pure join + stage derivation: serviceLeads + invoice-generator + opsEvents -> booking cards. */
import {
  normalizeTargetDate,
  invoicePackageDays,
  typeIdFromInvoice
} from '../../../shared/js/ops-events.js';

const LEAD_SERVICE_MOBILE_BAR = 'private_mobile_matcha_bar';
const LEAD_SERVICE_WORKSHOP = 'private_matcha_workshop';
const SERVICE_IDS = ['mobile_bar', 'matcha_workshop', 'mochi_workshop', 'matcha_popup'];
const COMPLETENESS_FIELDS = ['clientName', 'service', 'targetDate', 'targetPax', 'targetVenue', 'eventType'];

const FIELD_LABELS = {
  clientName: 'Client name',
  service: 'Service',
  targetDate: 'Event date',
  targetPax: 'Pax',
  targetVenue: 'Venue',
  eventType: 'Event type',
  quotedPrice: 'Quoted price',
  pipelineStatus: 'Status',
  notes: 'Notes',
  clientEmail: 'Email',
  clientPhone: 'Phone',
  company: 'Company',
  eventName: 'Event name',
  targetTime: 'Time',
  lostReason: 'Lost reason',
  lostAt: 'Lost at'
};

/* ---------- Field helpers ---------- */

export function toIso(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return null;
}

/** A single number from free text ("120 cups", "Php 43,500", "30k"); null for ranges or prose without one number. */
export function parseSingleNumber(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).replace(/,/g, '').toLowerCase();
  const matches = text.match(/\d+(?:\.\d+)?\s*k?/g);
  if (!matches || matches.length !== 1) return null;
  const m = matches[0].trim();
  const n = parseFloat(m);
  if (!Number.isFinite(n)) return null;
  return m.endsWith('k') ? n * 1000 : n;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

export function serviceFromLead(lead) {
  const explicit = str(lead?.serviceType);
  if (SERVICE_IDS.includes(explicit)) return explicit;
  const service = str(lead?.service);
  const eventType = str(lead?.eventType).toLowerCase();
  if (SERVICE_IDS.includes(service)) return service;
  if (SERVICE_IDS.includes(eventType)) return eventType;
  if (service === LEAD_SERVICE_MOBILE_BAR) return 'mobile_bar';
  if (service === LEAD_SERVICE_WORKSHOP) return eventType.includes('mochi') ? 'mochi_workshop' : 'matcha_workshop';
  if (eventType.includes('mochi')) return 'mochi_workshop';
  if (eventType.includes('pop-up') || eventType.includes('popup')) return 'matcha_popup';
  if (eventType.includes('mobile') || eventType.includes('bar')) return 'mobile_bar';
  if (eventType.includes('workshop')) return 'matcha_workshop';
  return null;
}

/** Bookings service id -> the serviceLeads `service` value other apps understand. */
export function leadServiceValue(serviceId) {
  if (serviceId === 'mobile_bar') return LEAD_SERVICE_MOBILE_BAR;
  if (serviceId === 'matcha_workshop' || serviceId === 'mochi_workshop') return LEAD_SERVICE_WORKSHOP;
  return serviceId || '';
}

export function computeProfileStatus(record) {
  for (const f of COMPLETENESS_FIELDS) {
    if (str(record?.[f]) === '') return 'draft';
  }
  return 'complete';
}

export function fieldLabel(key) {
  return FIELD_LABELS[key] || key;
}

/* ---------- Invoice facts ---------- */

function scheduleRows(invoice) {
  const list = Array.isArray(invoice?.paymentMilestones) ? invoice.paymentMilestones : [];
  return list
    .filter((m) => m && !m.splitFromId && str(m.milestone) && (Number(m.percentage) > 0 || Number(m.amount) > 0))
    .map((m) => ({
      id: m.id != null ? String(m.id) : null,
      role: m.role || null,
      label: str(m.milestone),
      pct: Number(m.percentage) || 0,
      date: normalizeTargetDate(m.date) || '',
      amount: Number(m.amount) || 0,
      paid: m.paid === true,
      received: Number(m.received) || 0
    }));
}

export function invoiceTotal(invoice) {
  const t = invoice?.totalAmount ?? invoice?.amountTotal;
  const n = typeof t === 'number' ? t : parseSingleNumber(t);
  if (n != null) return n;
  return scheduleRows(invoice).reduce((s, m) => s + m.amount, 0);
}

function pendingMilestoneIds(pendingProofs) {
  const ids = new Set();
  for (const p of pendingProofs || []) {
    for (const a of Array.isArray(p.allocations) ? p.allocations : []) {
      if (a?.milestoneId != null) ids.add(String(a.milestoneId));
    }
    if (p.milestoneId != null) ids.add(String(p.milestoneId));
  }
  return ids;
}

function invoicePaymentStatus(milestones, published) {
  if (!published) return 'draft';
  if (milestones.length && milestones.every((m) => m.paid)) return 'paid';
  if (milestones.some((m) => m.paid || m.received > 0)) return 'partial';
  return 'unpaid';
}

/** Confirmed money per milestone id, from payment allocations. */
function confirmedByMilestone(payments) {
  const map = new Map();
  for (const p of payments || []) {
    for (const a of Array.isArray(p.allocations) ? p.allocations : []) {
      if (a?.milestoneId == null) continue;
      const id = String(a.milestoneId);
      map.set(id, (map.get(id) || 0) + (Number(a.amount) || 0));
    }
  }
  return map;
}

export function shapeInvoice(invoice, pendingProofs = [], confirmedPayments = []) {
  const days = invoicePackageDays(invoice);
  const typeId = typeIdFromInvoice(invoice);
  const pendingIds = pendingMilestoneIds(pendingProofs);
  const confirmed = confirmedByMilestone(confirmedPayments);
  const milestones = scheduleRows(invoice).map((m) => {
    const pending = m.id != null && pendingIds.has(m.id);
    // Older invoices have no payment records; their paid flag is all there is.
    const flagged = m.paid && !pending ? m.amount : 0;
    return { ...m, pending, received: Math.max(flagged, Math.min(m.amount, confirmed.get(m.id) || 0)) };
  });
  const published = invoice.shareStatus === 'published';
  const first = days[0];
  const item = first?.item || null;
  const pendingAmount = (pendingProofs || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return {
    id: invoice.id,
    number: str(invoice.invoiceNumber) || 'Draft invoice',
    published,
    publicToken: invoice.publicToken || null,
    status: invoicePaymentStatus(milestones, published),
    total: invoiceTotal(invoice),
    milestones,
    proofPending: (pendingProofs || []).length > 0,
    pendingProofs: pendingProofs || [],
    pendingAmount,
    packageLabel: [str(item?.description), first?.count ? `${first.count} ${typeId.includes('workshop') ? 'pax' : 'cups'}` : '']
      .filter(Boolean)
      .join(' · '),
    days,
    typeId,
    invoiceDate: normalizeTargetDate(invoice.invoiceDate) || '',
    savedAt: toIso(invoice.savedAt) || toIso(invoice.updatedAt),
    publishedAt: toIso(invoice.publishedAt),
    opsEventId: invoice.opsEventId || (Array.isArray(invoice.opsEventIds) ? invoice.opsEventIds[0] : null) || null,
    bookingStage: invoice.bookingStage || null,
    bookedByHand: invoice.bookingStage === 'booked' && !(milestones[0]?.paid && !milestones[0]?.pending),
    bookedAt: toIso(invoice.bookedAt),
    leadId: invoice.leadId || null,
    clientName: str(invoice.clientName),
    clientCompany: str(invoice.clientCompany),
    clientEmail: str(invoice.clientEmail),
    clientPhone: str(invoice.clientPhone),
    eventName: str(invoice.eventName)
  };
}

/* ---------- Stage ---------- */

function stageFromLeadStatus(lead) {
  const status = str(lead?.pipelineStatus) || 'inquiry';
  switch (status) {
    case 'completed': return 'completed';
    case 'deposit': return 'booked';
    case 'invoiced': return 'invoiced';
    case 'quoted': return 'quoted';
    default:
      return parseSingleNumber(lead?.quotedPrice) != null ? 'quoted' : 'inquiry';
  }
}

/** Archived flag or the legacy manual "lost" status both put a booking away. */
function isPutAway(record) {
  return !!record?.archived || str(record?.pipelineStatus) === 'lost' || str(record?.bookingStage) === 'lost';
}

/**
 * Explicit completed (lead.pipelineStatus or invoice.bookingStage) always wins.
 * Otherwise an invoice decides from its payment schedule; without one, the lead status decides.
 * A confirmed calendar event lifts anything earlier to booked.
 */
export function deriveStage({ lead, invoice, event, todayYmd }) {
  const stage = paymentStage({ lead, invoice, todayYmd });
  // A confirmed calendar event means the date is locked in, however the client paid.
  if (event?.status === 'confirmed' && ['inquiry', 'quoted', 'invoiced'].includes(stage)) return 'booked';
  return stage;
}

function paymentStage({ lead, invoice, todayYmd }) {
  const explicit = str(lead?.pipelineStatus) || str(invoice?.bookingStage);
  if (explicit === 'completed' || explicit === 'delivered') return 'completed';

  if (invoice) {
    const ms = invoice.milestones;
    const lastDay = invoice.days.length ? invoice.days[invoice.days.length - 1].date : '';
    const allConfirmed = ms.length > 0 && ms.every((m) => m.paid && !m.pending);
    if (allConfirmed && lastDay && lastDay < todayYmd) return 'completed';
    const first = ms[0];
    if (first && first.paid && !first.pending) return 'booked';
    if (invoice.bookingStage === 'booked') return 'booked';
    return 'invoiced';
  }
  return stageFromLeadStatus(lead);
}

/* ---------- Activity ---------- */

function activityFromLead(lead) {
  const rows = [];
  const created = toIso(lead.createdAt);
  if (created) {
    rows.push({
      at: created,
      kind: 'system',
      text: lead.source === 'manual' ? 'Created manually' : 'Captured from chat by the bot'
    });
  }
  for (const entry of Array.isArray(lead.editHistory) ? lead.editHistory : []) {
    const at = toIso(entry.at);
    if (!at) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    if (!changes.length) continue;
    const isBot = entry.source === 'automation';
    if (isBot) {
      rows.push({
        at,
        kind: 'bot',
        text: `Bot updated ${changes.length} field${changes.length === 1 ? '' : 's'}`,
        detail: changes.map((c) => fieldLabel(c.field))
      });
    } else {
      for (const c of changes) {
        if (c.field === 'lostAt' || c.field === 'serviceType') continue;
        rows.push({
          at,
          kind: 'human',
          text: c.to ? `${fieldLabel(c.field)}: ${c.from ? `${c.from} → ` : ''}${c.to}` : `Cleared ${fieldLabel(c.field).toLowerCase()}`
        });
      }
    }
  }
  return rows;
}

function activityFromInvoice(inv) {
  const rows = [];
  if (inv.savedAt) rows.push({ at: inv.savedAt, kind: 'system', text: `Invoice ${inv.number} last saved` });
  if (inv.publishedAt) rows.push({ at: inv.publishedAt, kind: 'system', text: `Invoice ${inv.number} published` });
  for (const p of inv.pendingProofs) {
    const at = toIso(p.createdAt);
    if (at) rows.push({ at, kind: 'system', text: `Payment proof uploaded · Php ${Number(p.amount || 0).toLocaleString('en-PH')}` });
  }
  return rows;
}

/* ---------- Event shape ---------- */

/** A confirmed event with the deposit still unpaid counts as booked by hand: that deposit is no longer what makes it late. */
function heldByEvent(inv, ev) {
  if (!inv || ev?.status !== 'confirmed') return;
  const first = inv.milestones[0];
  if (first && !(first.paid && !first.pending)) inv.bookedByHand = true;
}

function shapeEvent(ev) {
  if (!ev) return null;
  return {
    id: ev.id,
    status: ev.status || 'draft',
    title: str(ev.title),
    startDate: normalizeTargetDate(ev.startDate) || '',
    endDate: normalizeTargetDate(ev.endDate) || '',
    time: [str(ev.startTime), str(ev.endTime)].filter(Boolean).join('–'),
    venue: str(ev.venue),
    headcount: ev.headcount ?? null,
    headcountUnit: ev.headcountUnit || '',
    typeId: ev.typeId || null,
    branchKey: ev.links?.branchKey || ev.key || null,
    staff: null,
    raw: ev
  };
}

/* ---------- Join ---------- */

function latestIso(...values) {
  let best = null;
  for (const v of values) {
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

/**
 * @param {{ leads: object[], invoices: object[], events: object[], pendingProofs: object[], now?: Date }} input
 * @returns {object[]} booking cards; archived ones carry `archived: true`
 */
export function buildBookings({ leads = [], invoices = [], events = [], pendingProofs = [], now = new Date() }) {
  const todayYmd = normalizeTargetDate(now) || now.toISOString().slice(0, 10);

  const eventsById = new Map();
  const eventByLead = new Map();
  const eventByInvoice = new Map();
  for (const ev of events) {
    if (!ev || ev.status === 'cancelled') continue;
    eventsById.set(ev.id, ev);
    if (ev.links?.leadId && !eventByLead.has(ev.links.leadId)) eventByLead.set(ev.links.leadId, ev);
    if (ev.links?.invoiceId && !eventByInvoice.has(ev.links.invoiceId)) eventByInvoice.set(ev.links.invoiceId, ev);
  }

  const proofsByInvoice = new Map();
  const confirmedByInvoice = new Map();
  for (const p of pendingProofs) {
    if (!p?.invoiceId) continue;
    const map = p.status === 'sent' ? proofsByInvoice : p.status === 'confirmed' ? confirmedByInvoice : null;
    if (!map) continue;
    const list = map.get(p.invoiceId) || [];
    list.push(p);
    map.set(p.invoiceId, list);
  }

  const leadsById = new Map(leads.filter(Boolean).map((l) => [l.id, l]));
  const invoiceByLead = new Map();
  const unlinkedInvoices = [];
  for (const raw of invoices) {
    if (!raw) continue;
    const linked = raw.leadId ? leadsById.get(raw.leadId) : null;
    // An archived invoice on a still-open lead was replaced or voided; the lead stands alone.
    if (raw.archived && linked && !isPutAway(linked)) continue;
    const inv = shapeInvoice(raw, proofsByInvoice.get(raw.id) || [], confirmedByInvoice.get(raw.id) || []);
    if (inv.leadId && linked) {
      const prev = invoiceByLead.get(inv.leadId);
      if (!prev || String(inv.savedAt || '') > String(prev.inv.savedAt || '')) invoiceByLead.set(inv.leadId, { inv, raw });
    } else {
      unlinkedInvoices.push({ inv, raw });
    }
  }

  const findEvent = (ids, lead, invoice) => {
    for (const id of ids) {
      if (id && eventsById.has(id)) return eventsById.get(id);
    }
    if (invoice && eventByInvoice.has(invoice.id)) return eventByInvoice.get(invoice.id);
    if (lead && eventByLead.has(lead.id)) return eventByLead.get(lead.id);
    return null;
  };

  const out = [];

  for (const lead of leads) {
    if (!lead) continue;
    const pair = invoiceByLead.get(lead.id) || null;
    const inv = pair?.inv || null;
    const ev = shapeEvent(findEvent([lead.opsEventId, inv?.opsEventId], lead, inv));
    heldByEvent(inv, ev);
    const firstDay = inv?.days[0];
    const lastDay = inv?.days[inv.days.length - 1];
    const leadDate = normalizeTargetDate(lead.targetDate) || '';
    const leadPax = parseSingleNumber(lead.targetPax);
    const leadPrice = parseSingleNumber(lead.quotedPrice);
    const service = serviceFromLead(lead) || inv?.typeId || null;

    const booking = {
      id: lead.id,
      kind: 'lead',
      leadId: lead.id,
      invoiceId: inv?.id || null,
      ref: str(lead.quoteReference) || lead.id.slice(0, 6),
      stage: deriveStage({ lead, invoice: inv, event: ev, todayYmd }),
      archived: isPutAway(lead),
      archivedAt: toIso(lead.archivedAt) || toIso(lead.lostAt) || null,
      channel: lead.source === 'manual' ? 'manual' : 'chatbot',
      clientName: str(lead.clientName) || str(lead.contactName) || 'Unnamed lead',
      company: inv?.clientCompany || str(lead.company) || str(lead.organizer),
      email: str(lead.clientEmail) || inv?.clientEmail || '',
      phone: str(lead.clientPhone) || inv?.clientPhone || '',
      service,
      eventType: str(lead.eventType),
      eventName: str(lead.eventName) || inv?.eventName || '',
      date: firstDay?.date || leadDate || ev?.startDate || null,
      endDate: lastDay && lastDay.date !== firstDay?.date ? lastDay.date : (ev?.endDate && ev.endDate !== ev.startDate ? ev.endDate : null),
      time: ev?.time || str(lead.targetTime),
      pax: firstDay?.count != null ? parseSingleNumber(firstDay.count) : leadPax,
      paxNote: leadPax == null ? str(lead.targetPax) : '',
      venue: firstDay?.venue || str(lead.targetVenue) || ev?.venue || '',
      price: inv ? inv.total : leadPrice,
      priceNote: leadPrice == null ? str(lead.quotedPrice) : '',
      notes: str(lead.notes),
      conversationId: lead.conversationId || null,
      createdAt: toIso(lead.createdAt) || toIso(lead.updatedAt) || now.toISOString(),
      lastActivityAt: latestIso(
        toIso(lead.updatedAt),
        toIso(lead.createdAt),
        inv?.savedAt,
        ...(inv?.pendingProofs || []).map((p) => toIso(p.createdAt))
      ) || now.toISOString(),
      profileStatus: lead.profileStatus || computeProfileStatus(lead),
      invoice: inv,
      event: ev,
      activity: [...activityFromLead(lead), ...(inv ? activityFromInvoice(inv) : [])]
        .filter((a) => a.at)
        .sort((a, b) => b.at.localeCompare(a.at)),
      raw: { lead, invoice: pair?.raw || null, event: ev?.raw || null }
    };
    out.push(booking);
  }

  for (const { inv, raw } of unlinkedInvoices) {
    const ev = shapeEvent(findEvent([inv.opsEventId], null, inv));
    heldByEvent(inv, ev);
    const firstDay = inv.days[0];
    const lastDay = inv.days[inv.days.length - 1];
    const representative = inv.clientName;
    const company = inv.clientCompany;
    out.push({
      id: `inv:${inv.id}`,
      kind: 'invoice',
      leadId: null,
      invoiceId: inv.id,
      ref: inv.number,
      stage: deriveStage({ lead: null, invoice: inv, event: ev, todayYmd }),
      archived: isPutAway(raw),
      archivedAt: toIso(raw.archivedAt) || toIso(raw.lostAt) || null,
      channel: 'invoice',
      clientName: representative || company || 'Unnamed client',
      company: representative && company && company !== representative ? company : '',
      email: inv.clientEmail,
      phone: inv.clientPhone,
      service: inv.typeId,
      eventType: '',
      eventName: inv.eventName,
      date: firstDay?.date || ev?.startDate || null,
      endDate: lastDay && lastDay.date !== firstDay?.date ? lastDay.date : null,
      time: ev?.time || '',
      pax: firstDay?.count != null ? parseSingleNumber(firstDay.count) : null,
      paxNote: '',
      venue: firstDay?.venue || ev?.venue || '',
      price: inv.total,
      priceNote: '',
      notes: str(raw.bookingNotes),
      conversationId: null,
      createdAt: inv.savedAt || now.toISOString(),
      lastActivityAt: latestIso(inv.savedAt, inv.publishedAt, ...inv.pendingProofs.map((p) => toIso(p.createdAt))) || now.toISOString(),
      profileStatus: 'complete',
      invoice: inv,
      event: ev,
      activity: activityFromInvoice(inv).sort((a, b) => b.at.localeCompare(a.at)),
      raw: { lead: null, invoice: raw, event: ev?.raw || null }
    });
  }

  return out;
}
