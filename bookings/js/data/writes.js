/* Firestore writes for Bookings (and an in-memory twin for ?mock=1). */
import {
  promoteLeadToOpsEvent,
  promoteInvoiceToOpsEvent,
  confirmOpsEvent,
  loadEventTypes,
  archiveOverlayBooking,
  patchBookingDetails
} from '../../../shared/js/ops-events.js';
import { initFirebase } from './firebase.js';
import { computeProfileStatus, leadServiceValue } from './normalize.js';
import { createDraftInvoice, invoiceBlockers, defaultMilestones } from './invoice-builder.js';
import { STAGE_TO_PIPELINE, PUBLIC_INVOICE_ORIGIN } from '../constants.js';

const LEADS = 'serviceLeads';
const INVOICES = 'invoice-generator';
const PROOFS = 'invoicePaymentProofs';
const UPDATED_BY = 'bookings-app';
const EDIT_HISTORY_MAX = 100;
const QUOTE_REF_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const INVOICE_LOCKED = new Set(['date', 'venue', 'pax', 'price']);

/* ---------- Pure planning (tested) ---------- */

/**
 * Where a booking field edit lands.
 * @returns {{ target: 'lead'|'invoice'|'locked', patch?: object, reason?: string }}
 */
export function planFieldEdit(b, key, value) {
  const v = value == null ? '' : String(value).trim();
  if (b.kind === 'invoice') {
    const map = { clientName: 'clientName', company: 'clientCompany', email: 'clientEmail', phone: 'clientPhone', eventName: 'eventName', notes: 'bookingNotes' };
    if (!map[key]) return { target: 'locked', reason: 'Edit this in the invoice' };
    return { target: 'invoice', patch: { [map[key]]: v } };
  }
  if (b.invoiceId && INVOICE_LOCKED.has(key)) return { target: 'locked', reason: 'Follows the invoice' };
  switch (key) {
    case 'service': return { target: 'lead', patch: { serviceType: v, service: leadServiceValue(v) } };
    case 'date': return { target: 'lead', patch: { targetDate: v } };
    case 'time': return { target: 'lead', patch: { targetTime: v } };
    case 'pax': return { target: 'lead', patch: { targetPax: v } };
    case 'price': return { target: 'lead', patch: { quotedPrice: v } };
    case 'venue': return { target: 'lead', patch: { targetVenue: v } };
    case 'email': return { target: 'lead', patch: { clientEmail: v } };
    case 'phone': return { target: 'lead', patch: { clientPhone: v } };
    case 'clientName':
    case 'company':
    case 'eventType':
    case 'eventName':
    case 'notes':
      return { target: 'lead', patch: { [key]: v } };
    default:
      return { target: 'locked', reason: 'Not editable' };
  }
}

function snapshotValue(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Full lead update: patch + recomputed profileStatus + an appended manual editHistory entry. */
export function buildLeadUpdate(lead, patch, nowIso) {
  const merged = { ...lead, ...patch };
  const changes = [];
  for (const [field, to] of Object.entries(patch)) {
    if (field === 'serviceType') continue;
    const from = snapshotValue(lead?.[field]);
    const next = snapshotValue(to);
    if (from !== next) changes.push({ field, from, to: next });
  }
  const update = { ...patch, profileStatus: computeProfileStatus(merged), updatedAt: nowIso, updatedBy: UPDATED_BY };
  if (changes.length) {
    const history = Array.isArray(lead?.editHistory) ? [...lead.editHistory] : [];
    history.push({ at: nowIso, source: 'manual', changes });
    update.editHistory = history.slice(-EDIT_HISTORY_MAX);
  }
  return { update, changes };
}

/** Stages a staff member can pick for this booking. Invoice-backed ones follow payments, but can be booked by hand before the deposit. */
export function allowedStages(b) {
  if (!b.invoiceId) return ['inquiry', 'quoted', 'invoiced', 'booked', 'completed'];
  if (b.stage === 'invoiced') return ['booked', 'completed'];
  if (b.stage === 'booked' && b.invoice?.bookedByHand) return ['invoiced', 'completed'];
  return ['completed'];
}

/** Stage a lead falls back to when reopened or restored. */
function openPipelineStatus(b) {
  if (b.invoiceId) return 'invoiced';
  return b.price ? 'quoted' : 'inquiry';
}

/** Patch for a manual stage move. `stage: null` reopens a completed booking. */
export function planStageChange(b, stage, nowIso = new Date().toISOString()) {
  if (b.invoiceId && stage === 'booked') {
    return { target: 'invoice', patch: { bookingStage: 'booked', bookedAt: nowIso, bookedBy: UPDATED_BY } };
  }
  if (b.invoiceId && stage === 'invoiced') {
    return { target: 'invoice', patch: { bookingStage: null, bookedAt: null, bookedBy: null } };
  }
  if (b.kind === 'invoice') {
    return { target: 'invoice', patch: { bookingStage: stage === 'completed' ? 'completed' : null } };
  }
  const pipelineStatus = stage == null ? openPipelineStatus(b) : STAGE_TO_PIPELINE[stage] || 'inquiry';
  return { target: 'lead', patch: { pipelineStatus } };
}

/** Patches that bring an archived (or legacy "lost") booking back. */
export function planRestore(b, nowIso) {
  const base = { archived: false, archivedAt: null, updatedAt: nowIso, updatedBy: UPDATED_BY };
  const out = [];
  if (b.leadId) {
    const lead = b.raw?.lead || {};
    out.push({
      target: 'lead',
      patch: lead.pipelineStatus === 'lost' ? { ...base, pipelineStatus: openPipelineStatus(b), lostReason: null, lostAt: null } : base
    });
  }
  if (b.invoiceId) {
    const inv = b.raw?.invoice || {};
    out.push({ target: 'invoice', patch: inv.bookingStage === 'lost' ? { ...base, bookingStage: null } : base });
  }
  return out;
}

export function randomQuoteReference() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => QUOTE_REF_CHARSET[n % QUOTE_REF_CHARSET.length]).join('');
}

export function generatePublicToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}

export function publicInvoiceUrl(token) {
  return `${PUBLIC_INVOICE_ORIGIN}/i/${token}`;
}

/**
 * Split a staff-recorded payment across the schedule. With `milestoneId` it lands on that milestone first;
 * anything beyond its balance (or with no target) fills the remaining milestones in order.
 */
export function allocateSettlement(Alloc, milestones, payments, amount, milestoneId) {
  const total = Alloc.roundMoney(amount);
  if (!(total > 0)) throw new Error('Enter an amount');
  const remaining = Alloc.totalRemainingOnSchedule(milestones, payments);
  if (!(remaining > 0.5)) throw new Error('Nothing left to pay');
  if (total > remaining + 0.5) throw new Error(`Only Php ${remaining.toLocaleString('en-PH')} is left`);
  const allocations = [];
  let leftover = total;
  let prior = payments;
  if (milestoneId != null && milestoneId !== '') {
    const m = Alloc.enrichMilestonesWithPayments(milestones, payments).find((x) => String(x.id) === String(milestoneId));
    if (m && m.remaining > 0.5) {
      const take = Alloc.roundMoney(Math.min(leftover, m.remaining));
      allocations.push({ milestoneId: m.id ?? null, role: m.role || null, milestoneName: String(m.milestone || ''), amount: take });
      leftover = Alloc.roundMoney(leftover - take);
      prior = [...payments, { status: 'confirmed', amount: take, allocations: [...allocations] }];
    }
  }
  if (leftover > 0.5) allocations.push(...Alloc.allocatePaymentWaterfall(milestones, leftover, prior));
  if (!allocations.length) throw new Error('No unpaid milestone to put this on');
  return allocations;
}

function manilaYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/* ---------- Live writer ---------- */

export function createLiveWriter({ ctx = initFirebase, alloc = () => window.InvoicePaymentAlloc } = {}) {
  let typesPromise = null;

  async function updateLead(b, patch) {
    const { db, fns } = await ctx();
    const nowIso = new Date().toISOString();
    const { update, changes } = buildLeadUpdate(b.raw.lead, patch, nowIso);
    await fns.updateDoc(fns.doc(db, LEADS, b.leadId), update);
    return changes;
  }

  async function updateInvoice(b, patch) {
    const { db, fns } = await ctx();
    await fns.updateDoc(fns.doc(db, INVOICES, b.invoiceId), { ...patch, updatedAt: new Date().toISOString(), updatedBy: UPDATED_BY });
  }

  async function confirmDraft(event) {
    if (!event || (event.status && event.status !== 'draft') || event.archived) return;
    const { db, fns } = await ctx();
    typesPromise = typesPromise || loadEventTypes(db, fns);
    const types = await typesPromise;
    await confirmOpsEvent(db, fns, event, types.find((t) => t.id === event.typeId) || null);
  }

  async function writeStagePatch(b, plan) {
    if (plan.target === 'invoice') await updateInvoice(b, plan.patch);
    else await updateLead(b, plan.patch);
  }

  return {
    async updateField(b, key, value) {
      const plan = planFieldEdit(b, key, value);
      if (plan.target === 'locked') throw new Error(plan.reason);
      if (plan.target === 'invoice') return updateInvoice(b, plan.patch);
      await updateLead(b, plan.patch);
      if (b.event && (key === 'date' || key === 'venue')) {
        const { db, fns } = await ctx();
        await patchBookingDetails(db, fns, {
          opsEventId: b.event.id,
          leadId: b.leadId,
          ...(key === 'date' ? { startDate: plan.patch.targetDate } : { venue: plan.patch.targetVenue })
        }, { updatedBy: UPDATED_BY });
      }
    },

    /** Returns an undo function. */
    async setStage(b, stage) {
      const plan = planStageChange(b, stage);
      const source = plan.target === 'invoice' ? b.raw.invoice : b.raw.lead;      const previous = Object.fromEntries(Object.keys(plan.patch).map((k) => [k, source?.[k] ?? null]));
      await writeStagePatch(b, plan);
      return () => writeStagePatch(b, { target: plan.target, patch: previous });
    },

    /** Returns an undo function. */
    async archive(b) {
      const { db, fns } = await ctx();
      await archiveOverlayBooking(db, fns, { id: b.id, invoiceId: b.invoiceId, source: b.kind === 'invoice' ? 'invoice' : 'lead' }, { updatedBy: UPDATED_BY });
      return () => this.restore(b);
    },

    async restore(b) {
      const { db, fns } = await ctx();
      for (const { target, patch } of planRestore(b, new Date().toISOString())) {
        await fns.updateDoc(fns.doc(db, target === 'lead' ? LEADS : INVOICES, target === 'lead' ? b.leadId : b.invoiceId), patch);
      }
    },

    async createBooking({ clientName, service, date, pax, venue }) {
      const { db, fns } = await ctx();
      let quoteReference = randomQuoteReference();
      for (let i = 0; i < 6; i += 1) {
        const snap = await fns.getDocs(fns.query(fns.collection(db, LEADS), fns.where('quoteReference', '==', quoteReference), fns.limit(1)));
        if (snap.empty) break;
        quoteReference = randomQuoteReference();
      }
      const nowIso = new Date().toISOString();
      const record = {
        clientName,
        serviceType: service || '',
        service: leadServiceValue(service),
        eventType: '',
        targetDate: date || '',
        targetPax: pax ? String(pax) : '',
        targetVenue: venue || '',
        quotedPrice: '',
        notes: '',
        quoteReference,
        source: 'manual',
        createdAt: nowIso,
        updatedAt: nowIso,
        updateCount: 1,
        pipelineStatus: 'inquiry',
        createdBy: UPDATED_BY
      };
      record.profileStatus = computeProfileStatus(record);
      record.editHistory = buildLeadUpdate({}, {
        clientName: record.clientName,
        service: record.service,
        targetDate: record.targetDate,
        targetPax: record.targetPax,
        targetVenue: record.targetVenue
      }, nowIso).update.editHistory || [];
      const ref = await fns.addDoc(fns.collection(db, LEADS), record);
      return ref.id;
    },

    async sendQuote(b, price) {
      await updateLead(b, { quotedPrice: String(price), pipelineStatus: 'quoted' });
    },

    async linkConversation(b, conversationId) {
      if (!b.leadId || !conversationId) return;
      const { db, fns } = await ctx();
      await fns.updateDoc(fns.doc(db, LEADS, b.leadId), { conversationId: String(conversationId), conversationLinkVia: 'quoteReference' });
    },

    async createInvoice(b) {
      const blockers = invoiceBlockers(b);
      if (blockers.length) throw new Error(`Fill in ${blockers.join(', ')} first`);
      if (b.invoiceId) throw new Error('This booking already has an invoice');
      const { db, fns } = await ctx();
      const created = await createDraftInvoice(db, fns, b, { invoiceYmd: manilaYmd() });
      if (b.leadId) await updateLead(b, { pipelineStatus: 'invoiced' });
      return created;
    },

    async publishInvoice(b) {
      const inv = b.raw.invoice;
      if (!inv) throw new Error('No invoice yet');
      if (inv.shareStatus === 'published' && inv.publicToken) return publicInvoiceUrl(inv.publicToken);
      const token = inv.publicToken || generatePublicToken();
      const { db, fns } = await ctx();
      await fns.updateDoc(fns.doc(db, INVOICES, inv.id), {
        publicToken: token,
        shareStatus: 'published',
        publishedAt: inv.publishedAt || new Date().toISOString(),
        savedAt: new Date().toISOString()
      });
      return publicInvoiceUrl(token);
    },

    async confirmPayment(b) {
      const Alloc = alloc();
      if (!Alloc) throw new Error('Payment helpers did not load');
      const inv = b.raw.invoice;
      if (!inv) throw new Error('No invoice yet');
      const { db, fns } = await ctx();
      const snap = await fns.getDocs(fns.query(fns.collection(db, PROOFS), fns.where('invoiceId', '==', inv.id)));
      const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const pending = payments.filter((p) => p.status === 'sent');
      if (!pending.length) throw new Error('No uploaded payment to confirm');
      const nowIso = new Date().toISOString();
      for (const p of pending) {
        await fns.updateDoc(fns.doc(db, PROOFS, p.id), { status: 'confirmed', confirmedAt: nowIso, confirmedSource: 'staff_bookings' });
        p.status = 'confirmed';
      }
      const milestones = Alloc.softSyncMilestonesFromPayments(inv.paymentMilestones || [], payments);
      await fns.updateDoc(fns.doc(db, INVOICES, inv.id), { paymentMilestones: milestones, savedAt: nowIso });
      const after = await this.afterPayment(b, milestones);
      return { confirmed: pending.reduce((s, p) => s + (Number(p.amount) || 0), 0), ...after };
    },

    /** Staff-recorded payment (cash, transfer, anything outside the customer page). */
    async recordPayment(b, { amount, milestoneId = null, method = 'cash', paidAt = '', reference = '' } = {}) {
      const Alloc = alloc();
      if (!Alloc) throw new Error('Payment helpers did not load');
      const inv = b.raw.invoice;
      if (!inv) throw new Error('No invoice yet');
      const { db, fns } = await ctx();
      const snap = await fns.getDocs(fns.query(fns.collection(db, PROOFS), fns.where('invoiceId', '==', inv.id)));
      const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const allocations = allocateSettlement(Alloc, inv.paymentMilestones || [], payments, amount, milestoneId);
      const nowIso = new Date().toISOString();
      const payment = {
        invoiceId: String(inv.id),
        publicToken: inv.publicToken || null,
        milestoneId: allocations[0].milestoneId,
        milestoneName: allocations[0].milestoneName,
        amount: Alloc.roundMoney(amount),
        paymentMethod: String(method || 'other').toLowerCase(),
        referenceNumber: String(reference || '').trim(),
        paidAt: paidAt || manilaYmd(),
        senderName: '',
        screenshotUrl: null,
        storagePath: null,
        status: 'confirmed',
        source: 'staff_manual',
        allocations,
        createdAt: nowIso,
        confirmedAt: nowIso,
        confirmedSource: 'staff_bookings'
      };
      await fns.addDoc(fns.collection(db, PROOFS), payment);
      const milestones = Alloc.softSyncMilestonesFromPayments(inv.paymentMilestones || [], [...payments, payment]);
      await fns.updateDoc(fns.doc(db, INVOICES, inv.id), { paymentMilestones: milestones, paymentProofUpdatedAt: nowIso, savedAt: nowIso });
      const after = await this.afterPayment(b, milestones);
      return { recorded: payment.amount, ...after };
    },

    /** Deposit in: the lead counts as booked, and an upcoming event goes on the calendar. */
    async afterPayment(b, milestones) {
      const firstPaid = milestones[0]?.paid === true;
      const leadStatus = b.raw.lead?.pipelineStatus;
      if (b.leadId && firstPaid && !['deposit', 'completed', 'lost'].includes(leadStatus)) {
        await updateLead(b, { pipelineStatus: 'deposit' });
      }
      let eventAdded = false;
      const upcoming = !b.date || (b.endDate || b.date) >= manilaYmd();
      if (firstPaid && !b.event && upcoming) {
        try {
          await this.addEvent({ ...b, raw: { ...b.raw, invoice: { ...b.raw.invoice, paymentMilestones: milestones } } });
          eventAdded = true;
        } catch (err) {
          console.warn('Booked, but could not add to calendar', err);
        }
      }
      return { booked: firstPaid, eventAdded, settled: milestones.every((m) => m.paid) };
    },

    /** Put a booked booking on the calendar and confirm it in one go (booked means the date is held). */
    async addEvent(b) {
      const { db, fns } = await ctx();
      let res;
      if (b.raw.invoice) {
        const inv = b.raw.invoice;
        const eventTitle = inv.eventTitle || b.eventName || inv.clientCompany || b.clientName;
        res = await promoteInvoiceToOpsEvent(db, fns, { ...inv, eventTitle }, { updatedBy: UPDATED_BY });
      } else {
        if (!b.raw.lead) throw new Error('Nothing to add');
        if (!b.raw.lead.targetDate) throw new Error('Set an event date first');
        res = await promoteLeadToOpsEvent(db, fns, b.raw.lead, { updatedBy: UPDATED_BY });
      }
      for (const id of res.ids || [res.id]) {
        const snap = await fns.getDoc(fns.doc(db, 'opsEvents', id));
        if (snap.exists()) await confirmDraft({ id, ...snap.data() });
      }
      return res.id;
    },

    async confirmEvent(b) {
      if (!b.event?.raw) throw new Error('Not on the calendar yet');
      await confirmDraft(b.event.raw);
    }
  };
}

/* ---------- Mock writer (in-memory, ?mock=1) ---------- */

export function createMockWriter(repo) {
  const now = () => repo.now().toISOString();
  const log = (b, text, kind = 'human') => {
    b.activity = [{ at: now(), kind, text }, ...(b.activity || [])];
    b.lastActivityAt = now();
  };
  const done = (value) => {
    repo.commit();
    return value;
  };
  return {
    async updateField(b, key, value) {
      const plan = planFieldEdit(b, key, value);
      if (plan.target === 'locked') throw new Error(plan.reason);
      b[key] = key === 'pax' || key === 'price' ? (value ? Number(value) : null) : value;
      return done();
    },
    async setStage(b, stage) {
      const prev = b.stage;
      const prevHand = b.invoice?.bookedByHand;
      b.stage = stage || (b.invoice ? 'invoiced' : b.price ? 'quoted' : 'inquiry');
      if (b.invoice && (stage === 'booked' || stage === 'invoiced')) b.invoice.bookedByHand = stage === 'booked' && !b.invoice.milestones[0]?.paid;
      log(b, `Moved to ${b.stage}`);
      done();
      return async () => {
        b.stage = prev;
        if (b.invoice) b.invoice.bookedByHand = prevHand;
        done();
      };
    },
    async archive(b) {
      b.archived = true;
      b.archivedAt = now();
      log(b, 'Archived');
      done();
      return () => this.restore(b);
    },
    async restore(b) {
      b.archived = false;
      b.archivedAt = null;
      log(b, 'Restored');
      return done();
    },
    async createBooking({ clientName, service, date, pax, venue }) {
      const id = `b-${Math.random().toString(36).slice(2, 8)}`;
      repo.state.bookings = [{
        id, kind: 'lead', leadId: id, invoiceId: null, ref: randomQuoteReference(), stage: 'inquiry', channel: 'manual',
        clientName, company: '', email: '', phone: '', service, eventType: '', date: date || null, pax: pax || null,
        venue: venue || '', price: null, createdAt: now(), lastActivityAt: now(), chat: [], invoice: null, event: null,
        activity: [{ at: now(), kind: 'system', text: 'Created manually' }]
      }, ...repo.state.bookings];
      return done(id);
    },
    async linkConversation() {},
    async sendQuote(b, price) {
      b.price = price;
      b.stage = 'quoted';
      log(b, `Quote set · Php ${Number(price).toLocaleString('en-PH')}`);
      return done();
    },
    async createInvoice(b) {
      const blockers = invoiceBlockers(b);
      if (blockers.length) throw new Error(`Fill in ${blockers.join(', ')} first`);
      const total = Number(b.price) || 0;
      b.invoiceId = `mock-inv-${b.id}`;
      b.invoice = {
        id: b.invoiceId, number: 'INV-MOCK-001', status: 'draft', published: false, total, packageLabel: '',
        milestones: defaultMilestones({ total, invoiceYmd: now().slice(0, 10), eventYmd: b.date })
          .filter((m) => m.percentage > 0)
          .map((m) => ({ id: m.id, label: m.milestone, pct: m.percentage, date: m.date, amount: m.amount, paid: false }))
      };
      b.stage = 'invoiced';
      log(b, 'Invoice drafted', 'system');
      return done({ id: b.invoiceId, invoiceNumber: b.invoice.number });
    },
    async publishInvoice(b) {
      b.invoice.published = true;
      b.invoice.status = 'unpaid';
      log(b, 'Invoice published', 'system');
      done();
      return publicInvoiceUrl(b.ref.toLowerCase());
    },
    async confirmPayment(b) {
      const next = b.invoice.milestones.find((m) => !m.paid);
      if (next) next.paid = true;
      b.invoice.proofPending = false;
      const booked = b.stage === 'invoiced';
      if (booked) b.stage = 'booked';
      log(b, 'Payment confirmed', 'system');
      const eventAdded = booked && !b.event;
      if (eventAdded) {
        b.event = { id: `ev-${b.id}`, status: 'confirmed', staff: [], menu: 'Not set', purchasing: 'Not started', schedule: 'No shifts yet' };
        log(b, 'Added to calendar', 'system');
      }
      return done({ confirmed: next?.amount || 0, booked, eventAdded });
    },
    async recordPayment(b, { amount, milestoneIndex = null } = {}) {
      const ms = b.invoice.milestones;
      const left = (m) => Math.max(0, m.amount - (m.paid ? m.amount : Number(m.received) || 0));
      const owed = ms.reduce((s, m) => s + left(m), 0);
      let rest = Number(amount) || 0;
      if (!(rest > 0)) throw new Error('Enter an amount');
      if (rest > owed + 0.5) throw new Error(`Only Php ${owed.toLocaleString('en-PH')} is left`);
      const target = milestoneIndex != null ? ms[milestoneIndex] : null;
      for (const m of target ? [target, ...ms.filter((x) => x !== target)] : ms) {
        const take = Math.min(rest, left(m));
        if (take <= 0) continue;
        m.received = (m.paid ? m.amount : Number(m.received) || 0) + take;
        m.paid = m.received >= m.amount - 0.5;
        rest -= take;
      }
      const booked = b.stage === 'invoiced' && ms[0]?.paid;
      if (booked) b.stage = 'booked';
      const settled = ms.every((m) => m.paid);
      if (settled) b.stage = 'completed';
      log(b, `Payment recorded · Php ${Number(amount).toLocaleString('en-PH')}`);
      return done({ recorded: Number(amount), booked, eventAdded: false, settled });
    },
    async addEvent(b) {
      b.event = { id: `ev-${b.id}`, status: 'confirmed', staff: [], menu: 'Not set', purchasing: 'Not started', schedule: 'No shifts yet' };
      log(b, 'Added to calendar', 'system');
      return done(b.event.id);
    },
    async confirmEvent(b) {
      b.event.status = 'confirmed';
      log(b, 'Event confirmed', 'system');
      return done();
    }
  };
}
