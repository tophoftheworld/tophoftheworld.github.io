import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { planFieldEdit, buildLeadUpdate, planStageChange, planRestore, allowedStages, createLiveWriter, allocateSettlement } from '../js/data/writes.js';
import {
  nextInvoiceNumber,
  mobileBarListPrice,
  defaultMilestones,
  buildInvoicePayload,
  invoiceBlockers
} from '../js/data/invoice-builder.js';

const leadBooking = { id: 'l1', kind: 'lead', leadId: 'l1', invoiceId: null };
const invoicedLead = { ...leadBooking, invoiceId: 'i1' };
const invoiceOnly = { id: 'inv:i1', kind: 'invoice', leadId: null, invoiceId: 'i1' };

test('planFieldEdit maps booking fields onto lead fields', () => {
  assert.deepEqual(planFieldEdit(leadBooking, 'date', '2026-11-14'), { target: 'lead', patch: { targetDate: '2026-11-14' } });
  assert.deepEqual(planFieldEdit(leadBooking, 'pax', 120), { target: 'lead', patch: { targetPax: '120' } });
  assert.deepEqual(planFieldEdit(leadBooking, 'service', 'mobile_bar'), {
    target: 'lead',
    patch: { serviceType: 'mobile_bar', service: 'private_mobile_matcha_bar' }
  });
  assert.deepEqual(planFieldEdit(leadBooking, 'email', ' a@b.c '), { target: 'lead', patch: { clientEmail: 'a@b.c' } });
});

test('planFieldEdit locks invoice-owned fields', () => {
  assert.equal(planFieldEdit(invoicedLead, 'price', 1).target, 'locked');
  assert.equal(planFieldEdit(invoicedLead, 'venue', 'x').target, 'locked');
  assert.equal(planFieldEdit(invoicedLead, 'notes', 'x').target, 'lead');
  assert.deepEqual(planFieldEdit(invoiceOnly, 'company', 'Acme'), { target: 'invoice', patch: { clientCompany: 'Acme' } });
  assert.deepEqual(planFieldEdit(invoiceOnly, 'notes', 'n'), { target: 'invoice', patch: { bookingNotes: 'n' } });
  assert.equal(planFieldEdit(invoiceOnly, 'service', 'mobile_bar').target, 'locked');
});

test('buildLeadUpdate appends manual history and recomputes profile', () => {
  const lead = {
    clientName: 'Ana', service: 'private_mobile_matcha_bar', targetDate: '2026-11-14', targetPax: '120',
    targetVenue: '', eventType: 'Wedding', editHistory: [{ at: 'x', source: 'automation', changes: [] }]
  };
  const { update, changes } = buildLeadUpdate(lead, { targetVenue: 'Makati' }, '2026-10-03T00:00:00.000Z');
  assert.equal(update.profileStatus, 'complete');
  assert.deepEqual(changes, [{ field: 'targetVenue', from: null, to: 'Makati' }]);
  assert.equal(update.editHistory.length, 2);
  assert.equal(update.editHistory[1].source, 'manual');

  const same = buildLeadUpdate(lead, { clientName: 'Ana' }, 'now');
  assert.equal(same.changes.length, 0);
  assert.equal(same.update.editHistory, undefined);
});

test('planStageChange writes pipelineStatus or invoice bookingStage', () => {
  assert.deepEqual(planStageChange(leadBooking, 'booked').patch, { pipelineStatus: 'deposit' });
  assert.deepEqual(planStageChange(leadBooking, 'completed').patch, { pipelineStatus: 'completed' });
  assert.equal(planStageChange(leadBooking, null).patch.pipelineStatus, 'inquiry');
  assert.equal(planStageChange({ ...leadBooking, price: 29500 }, null).patch.pipelineStatus, 'quoted');
  assert.equal(planStageChange(invoicedLead, null).patch.pipelineStatus, 'invoiced');
  assert.deepEqual(planStageChange(invoiceOnly, 'completed'), { target: 'invoice', patch: { bookingStage: 'completed' } });
  assert.deepEqual(planStageChange(invoiceOnly, null), { target: 'invoice', patch: { bookingStage: null } });
  assert.deepEqual(allowedStages(leadBooking), ['inquiry', 'quoted', 'invoiced', 'booked', 'completed']);
  assert.deepEqual(allowedStages(invoicedLead), ['completed']);
});

test('invoice bookings can be booked by hand before the deposit, and un-booked', () => {
  assert.deepEqual(allowedStages({ ...invoicedLead, stage: 'invoiced' }), ['booked', 'completed']);
  assert.deepEqual(allowedStages({ ...invoicedLead, stage: 'booked', invoice: { bookedByHand: true } }), ['invoiced', 'completed']);
  assert.deepEqual(allowedStages({ ...invoicedLead, stage: 'booked', invoice: { bookedByHand: false } }), ['completed']);
  assert.deepEqual(planStageChange(invoicedLead, 'booked', 't'), { target: 'invoice', patch: { bookingStage: 'booked', bookedAt: 't', bookedBy: 'bookings-app' } });
  assert.deepEqual(planStageChange(invoiceOnly, 'invoiced'), { target: 'invoice', patch: { bookingStage: null, bookedAt: null, bookedBy: null } });
});

test('planRestore unarchives both records and clears legacy lost', () => {
  const plain = planRestore({ ...invoicedLead, raw: { lead: { archived: true }, invoice: { archived: true } } }, 't');
  assert.deepEqual(plain.map((p) => p.target), ['lead', 'invoice']);
  assert.equal(plain[0].patch.archived, false);
  assert.equal(plain[0].patch.pipelineStatus, undefined);

  const lost = planRestore({ ...leadBooking, price: 29500, raw: { lead: { pipelineStatus: 'lost', lostReason: 'Price' } } }, 't');
  assert.deepEqual(lost[0].patch, { archived: false, archivedAt: null, updatedAt: 't', updatedBy: 'bookings-app', pipelineStatus: 'quoted', lostReason: null, lostAt: null });

  const inv = planRestore({ ...invoiceOnly, raw: { invoice: { bookingStage: 'lost' } } }, 't');
  assert.equal(inv[0].patch.bookingStage, null);
});

function fakeFirestore(collections) {
  const writes = [];
  const fns = {
    collection: (_db, name) => ({ name }),
    doc: (_db, name, id) => ({ name, id }),
    where: (field, op, value) => ({ field, op, value }),
    query: (col, ...filters) => ({ ...col, filters }),
    getDocs: async (q) => {
      const rows = (collections[q.name] || []).filter((r) => (q.filters || []).every((f) => r[f.field] === f.value));
      const docs = rows.map((r) => ({ id: r.id, data: () => r }));
      return { docs, empty: !rows.length, forEach: (fn) => docs.forEach(fn) };
    },
    getDoc: async (ref) => {
      const row = (collections[ref.name] || []).find((r) => r.id === ref.id);
      return { exists: () => !!row, data: () => row };
    },
    updateDoc: async (ref, patch) => {
      writes.push({ ...ref, patch });
    },
    addDoc: async (col, data) => {
      writes.push({ name: col.name, added: data });
      return { id: `new-${writes.length}` };
    }
  };
  return { fns, writes };
}

test('confirmPayment confirms sent proofs, re-syncs milestones and books the lead', async () => {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(new URL('../../invoice-generator/js/invoice-payment-alloc.js', import.meta.url), 'utf8'), sandbox);
  const Alloc = sandbox.module.exports;
  const invoice = {
    id: 'i1',
    paymentMilestones: [
      { id: 1, role: 'first', milestone: 'Date Reservation', percentage: 25, amount: 10000, paid: true },
      { id: 2, role: 'preEvent', milestone: 'Pre-Event', percentage: 25, amount: 10000, paid: false },
      { id: 3, role: 'final', milestone: 'Event Completion', percentage: 50, amount: 20000, paid: false }
    ]
  };
  const { fns, writes } = fakeFirestore({
    invoicePaymentProofs: [
      { id: 'p1', invoiceId: 'i1', status: 'sent', amount: 10000, allocations: [{ milestoneId: 1, amount: 10000 }] },
      { id: 'p0', invoiceId: 'other', status: 'sent', amount: 5, allocations: [] }
    ]
  });
  const writer = createLiveWriter({ ctx: async () => ({ db: {}, fns }), alloc: () => Alloc });
  let added = null;
  writer.addEvent = async (x) => { added = x; };
  const b = { kind: 'lead', leadId: 'l1', invoiceId: 'i1', raw: { invoice, lead: { pipelineStatus: 'invoiced', editHistory: [] } } };
  const res = await writer.confirmPayment(b);

  assert.deepEqual(res, { confirmed: 10000, booked: true, eventAdded: true, settled: false });
  assert.equal(added.raw.invoice.paymentMilestones[0].paid, true);
  const proof = writes.find((w) => w.name === 'invoicePaymentProofs');
  assert.equal(proof.id, 'p1');
  assert.equal(proof.patch.status, 'confirmed');
  const inv = writes.find((w) => w.name === 'invoice-generator');
  assert.deepEqual(Array.from(inv.patch.paymentMilestones, (m) => m.paid), [true, false, false]);
  const lead = writes.find((w) => w.name === 'serviceLeads');
  assert.equal(lead.patch.pipelineStatus, 'deposit');
  assert.equal(writes.length, 3);
});

function loadAlloc() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(new URL('../../invoice-generator/js/invoice-payment-alloc.js', import.meta.url), 'utf8'), sandbox);
  return sandbox.module.exports;
}

const SCHEDULE = [
  { id: 1, role: 'first', milestone: 'Date Reservation', percentage: 25, amount: 10000, paid: true },
  { id: 2, role: 'preEvent', milestone: 'Pre-Event', percentage: 25, amount: 10000, paid: false },
  { id: 3, role: 'final', milestone: 'Event Completion', percentage: 50, amount: 20000, paid: false }
];
const DEPOSIT = { id: 'p1', status: 'confirmed', amount: 10000, allocations: [{ milestoneId: 1, amount: 10000 }] };

test('allocateSettlement targets a milestone, spreads custom amounts and caps at the balance', () => {
  const Alloc = loadAlloc();
  const plain = (a) => Array.from(a, (x) => [x.milestoneId, x.amount]);
  assert.deepEqual(plain(allocateSettlement(Alloc, SCHEDULE, [DEPOSIT], 20000, 3)), [[3, 20000]]);
  assert.deepEqual(plain(allocateSettlement(Alloc, SCHEDULE, [DEPOSIT], 25000, 3)), [[3, 20000], [2, 5000]]);
  assert.deepEqual(plain(allocateSettlement(Alloc, SCHEDULE, [DEPOSIT], 15000)), [[2, 10000], [3, 5000]]);
  assert.deepEqual(plain(allocateSettlement(Alloc, SCHEDULE, [DEPOSIT], 30000)), [[2, 10000], [3, 20000]]);
  assert.throws(() => allocateSettlement(Alloc, SCHEDULE, [DEPOSIT], 31000), /left/);
  assert.throws(() => allocateSettlement(Alloc, SCHEDULE, [DEPOSIT], 0), /amount/);
});

test('recordPayment adds a confirmed staff payment and re-syncs the schedule', async () => {
  const Alloc = loadAlloc();
  const invoice = { id: 'i1', publicToken: 'tok', paymentMilestones: SCHEDULE };
  const { fns, writes } = fakeFirestore({ invoicePaymentProofs: [{ ...DEPOSIT, invoiceId: 'i1' }] });
  const writer = createLiveWriter({ ctx: async () => ({ db: {}, fns }), alloc: () => Alloc });
  const b = { kind: 'invoice', invoiceId: 'i1', date: '2020-01-01', event: { id: 'e1' }, raw: { invoice } };
  const res = await writer.recordPayment(b, { amount: 30000, method: 'cash', paidAt: '2026-10-04' });

  assert.deepEqual(res, { recorded: 30000, booked: true, eventAdded: false, settled: true });
  const added = writes.find((w) => w.added).added;
  assert.equal(added.status, 'confirmed');
  assert.equal(added.source, 'staff_manual');
  assert.equal(added.confirmedSource, 'staff_bookings');
  assert.equal(added.paymentMethod, 'cash');
  assert.equal(added.paidAt, '2026-10-04');
  assert.deepEqual(Array.from(added.allocations, (a) => a.amount), [10000, 20000]);
  const inv = writes.find((w) => w.name === 'invoice-generator');
  assert.deepEqual(Array.from(inv.patch.paymentMilestones, (m) => m.paid), [true, true, true]);
});

test('addEvent confirms the linked event when it is still a draft', async () => {
  const { fns, writes } = fakeFirestore({
    opsEventTypes: [{ id: 'custom', label: 'Custom' }],
    opsEvents: [{ id: 'ev1', status: 'draft', typeId: 'custom', title: 'Creat8' }, { id: 'ev2', status: 'confirmed', typeId: 'custom' }]
  });
  const writer = createLiveWriter({ ctx: async () => ({ db: {}, fns }) });
  await writer.addEvent({ raw: { lead: { id: 'l1', opsEventId: 'ev1', targetDate: '2026-11-20' } } });
  const ev = writes.find((w) => w.name === 'opsEvents');
  assert.equal(ev.id, 'ev1');
  assert.equal(ev.patch.status, 'confirmed');

  writes.length = 0;
  await writer.addEvent({ raw: { lead: { id: 'l2', opsEventId: 'ev2', targetDate: '2026-11-20' } } });
  assert.equal(writes.length, 0);
});

test('nextInvoiceNumber takes max sequence for the day', () => {
  assert.equal(nextInvoiceNumber('2026-10-03', []), 'INV-2026-1003-001');
  assert.equal(nextInvoiceNumber('2026-10-03', ['INV-2026-1003-001', 'INV-2026-1003-007', 'INV-2026-1002-020', 'junk']), 'INV-2026-1003-008');
});

test('mobileBarListPrice matches invoice-generator rates', () => {
  assert.equal(mobileBarListPrice('starter', 100), 29500);
  assert.equal(mobileBarListPrice('starter', 150), 43500);
  assert.equal(mobileBarListPrice('starter', 120), 35100);
  assert.equal(mobileBarListPrice('signature', 200), 61000);
});

test('defaultMilestones follows the three-payment rules', () => {
  const far = defaultMilestones({ total: 40000, invoiceYmd: '2026-10-03', eventYmd: '2026-11-14', idBase: 1 });
  assert.deepEqual(far.map((m) => [m.role, m.percentage, m.amount, m.date]), [
    ['first', 25, 10000, '2026-10-08'],
    ['preEvent', 25, 10000, '2026-11-07'],
    ['final', 50, 20000, '2026-11-14']
  ]);
  const soon = defaultMilestones({ total: 40000, invoiceYmd: '2026-10-03', eventYmd: '2026-10-10', idBase: 1 });
  assert.deepEqual(soon.map((m) => [m.percentage, m.date]), [[50, '2026-10-03'], [0, ''], [50, '2026-10-10']]);
});

test('buildInvoicePayload creates a linked draft', () => {
  const b = { leadId: 'l1', clientName: 'Ana', company: '', service: 'mobile_bar', date: '2026-11-14', pax: 120, venue: 'Makati', price: 38000 };
  assert.deepEqual(invoiceBlockers(b), []);
  const p = buildInvoicePayload(b, { invoiceNumber: 'INV-2026-1003-001', invoiceYmd: '2026-10-03', nowIso: 'now', idBase: 100 });
  assert.equal(p.shareStatus, 'draft');
  assert.equal(p.leadId, 'l1');
  assert.equal(p.totalAmount, 38000);
  assert.equal(p.invoiceItems[0].priceOverride, '38000');
  assert.equal(p.invoiceItems[0].count, 120);
  assert.equal(p.paymentMilestones.reduce((s, m) => s + m.amount, 0), 38000);
  assert.deepEqual(invoiceBlockers({ service: 'matcha_workshop', date: 'x', pax: 10 }), ['price']);
});
