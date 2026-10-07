import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSingleNumber,
  serviceFromLead,
  computeProfileStatus,
  deriveStage,
  shapeInvoice,
  buildBookings
} from '../js/data/normalize.js';

const NOW = new Date('2026-10-03T04:00:00Z');

const completeLead = {
  clientName: 'Ana',
  service: 'private_mobile_matcha_bar',
  targetDate: '2026-11-14',
  targetPax: '120 cups',
  targetVenue: 'Makati',
  eventType: 'Wedding'
};

function invoice(overrides = {}) {
  return {
    id: 'inv1',
    invoiceNumber: 'INV-2026-1001-001',
    shareStatus: 'published',
    totalAmount: 40000,
    invoiceItems: [
      { id: 1, eventType: 'mobile_bar', packageType: 'starter', description: 'Starter package', eventDate: '2026-11-14', eventVenue: 'Makati', count: 120 }
    ],
    paymentMilestones: [
      { id: 'm1', role: 'first', milestone: 'Date Reservation', percentage: 25, amount: 10000, paid: false },
      { id: 'm2', role: 'preEvent', milestone: 'Pre-Event', percentage: 25, amount: 10000, paid: false },
      { id: 'm3', role: 'final', milestone: 'Event Completion', percentage: 50, amount: 20000, paid: false }
    ],
    savedAt: '2026-10-01T02:00:00Z',
    ...overrides
  };
}

test('parseSingleNumber reads one number and rejects ranges', () => {
  assert.equal(parseSingleNumber('120 cups'), 120);
  assert.equal(parseSingleNumber('Php 43,500'), 43500);
  assert.equal(parseSingleNumber('30k'), 30000);
  assert.equal(parseSingleNumber(85), 85);
  assert.equal(parseSingleNumber('100-150'), null);
  assert.equal(parseSingleNumber('around a hundred'), null);
  assert.equal(parseSingleNumber(''), null);
});

test('serviceFromLead maps lead services and event type hints', () => {
  assert.equal(serviceFromLead({ service: 'private_mobile_matcha_bar' }), 'mobile_bar');
  assert.equal(serviceFromLead({ service: 'private_matcha_workshop' }), 'matcha_workshop');
  assert.equal(serviceFromLead({ service: 'private_matcha_workshop', eventType: 'Mochi class' }), 'mochi_workshop');
  assert.equal(serviceFromLead({ serviceType: 'matcha_popup', service: 'private_mobile_matcha_bar' }), 'matcha_popup');
  assert.equal(serviceFromLead({ eventType: 'Office pop-up' }), 'matcha_popup');
  assert.equal(serviceFromLead({}), null);
});

test('computeProfileStatus needs all six fields', () => {
  assert.equal(computeProfileStatus(completeLead), 'complete');
  assert.equal(computeProfileStatus({ ...completeLead, targetVenue: '' }), 'draft');
});

test('deriveStage maps lead statuses without an invoice', () => {
  const s = (lead) => deriveStage({ lead, invoice: null, todayYmd: '2026-10-03' });
  assert.equal(s({ pipelineStatus: 'inquiry', clientName: 'x' }), 'inquiry');
  assert.equal(s({ ...completeLead, pipelineStatus: 'inquiry' }), 'inquiry');
  assert.equal(s({ pipelineStatus: 'qualifying' }), 'inquiry');
  assert.equal(s({ pipelineStatus: 'inquiry', quotedPrice: 'PHP 29,500' }), 'quoted');
  assert.equal(s({ pipelineStatus: 'quoted' }), 'quoted');
  assert.equal(s({ pipelineStatus: 'invoiced' }), 'invoiced');
  assert.equal(s({ pipelineStatus: 'deposit' }), 'booked');
  assert.equal(s({ pipelineStatus: 'completed' }), 'completed');
  assert.equal(s({ pipelineStatus: 'lost', quotedPrice: '29500' }), 'quoted');
});

test('deriveStage follows invoice payments', () => {
  const today = '2026-10-03';
  const unpaid = shapeInvoice(invoice());
  assert.equal(deriveStage({ lead: { pipelineStatus: 'quoted' }, invoice: unpaid, todayYmd: today }), 'invoiced');

  const deposit = shapeInvoice(invoice({ paymentMilestones: invoice().paymentMilestones.map((m, i) => ({ ...m, paid: i === 0 })) }));
  assert.equal(deriveStage({ lead: null, invoice: deposit, todayYmd: today }), 'booked');

  const pendingDeposit = shapeInvoice(
    invoice({ paymentMilestones: invoice().paymentMilestones.map((m, i) => ({ ...m, paid: i === 0 })) }),
    [{ invoiceId: 'inv1', status: 'sent', amount: 10000, allocations: [{ milestoneId: 'm1', amount: 10000 }] }]
  );
  assert.equal(deriveStage({ lead: null, invoice: pendingDeposit, todayYmd: today }), 'invoiced');

  const allPaid = shapeInvoice(invoice({ paymentMilestones: invoice().paymentMilestones.map((m) => ({ ...m, paid: true })) }));
  assert.equal(deriveStage({ lead: null, invoice: allPaid, todayYmd: today }), 'booked');
  assert.equal(deriveStage({ lead: null, invoice: allPaid, todayYmd: '2026-11-20' }), 'completed');
  assert.equal(deriveStage({ lead: null, invoice: { ...unpaid, bookingStage: 'completed' }, todayYmd: today }), 'completed');

  const confirmed = { status: 'confirmed' };
  assert.equal(deriveStage({ lead: { pipelineStatus: 'inquiry' }, invoice: null, event: confirmed, todayYmd: today }), 'booked');
  assert.equal(deriveStage({ lead: null, invoice: unpaid, event: confirmed, todayYmd: today }), 'booked');
  assert.equal(deriveStage({ lead: { pipelineStatus: 'inquiry' }, invoice: null, event: { status: 'draft' }, todayYmd: today }), 'inquiry');
  assert.equal(deriveStage({ lead: { pipelineStatus: 'completed' }, invoice: null, event: confirmed, todayYmd: today }), 'completed');

  const byHand = shapeInvoice(invoice({ bookingStage: 'booked' }));
  assert.equal(byHand.bookedByHand, true);
  assert.equal(deriveStage({ lead: { pipelineStatus: 'invoiced' }, invoice: byHand, todayYmd: today }), 'booked');
  assert.equal(deriveStage({ lead: null, invoice: byHand, todayYmd: '2026-12-31' }), 'booked');
  assert.equal(shapeInvoice(invoice({ bookingStage: 'booked', paymentMilestones: invoice().paymentMilestones.map((m, i) => ({ ...m, paid: i === 0 })) })).bookedByHand, false);
});

test('shapeInvoice reports payment status and pending proofs', () => {
  const draft = shapeInvoice(invoice({ shareStatus: 'draft' }));
  assert.equal(draft.status, 'draft');
  assert.equal(draft.published, false);

  const inv = shapeInvoice(invoice(), [{ invoiceId: 'inv1', status: 'sent', amount: 10000, allocations: [{ milestoneId: 'm1', amount: 10000 }] }]);
  assert.equal(inv.status, 'unpaid');
  assert.equal(inv.total, 40000);
  assert.equal(inv.proofPending, true);
  assert.equal(inv.pendingAmount, 10000);
  assert.deepEqual(inv.milestones.map((m) => m.pending), [true, false, false]);
  assert.equal(inv.typeId, 'mobile_bar');
  assert.equal(inv.days[0].date, '2026-11-14');
});

test('shapeInvoice counts confirmed partial payments per milestone', () => {
  const inv = shapeInvoice(invoice(), [], [{ invoiceId: 'inv1', status: 'confirmed', amount: 4000, allocations: [{ milestoneId: 'm1', amount: 4000 }] }]);
  assert.deepEqual(inv.milestones.map((m) => m.received), [4000, 0, 0]);
  assert.equal(inv.status, 'partial');
  const legacy = shapeInvoice(invoice({ paymentMilestones: invoice().paymentMilestones.map((m, i) => ({ ...m, paid: i === 0 })) }));
  assert.equal(legacy.milestones[0].received, legacy.milestones[0].amount);
});

test('buildBookings merges leads with invoices and keeps unlinked invoices', () => {
  const bookings = buildBookings({
    leads: [
      { id: 'lead1', ...completeLead, pipelineStatus: 'invoiced', quoteReference: 'ABCDE', createdAt: '2026-09-20T00:00:00Z' },
      { id: 'lead2', clientName: 'Ben', pipelineStatus: 'inquiry', createdAt: '2026-09-25T00:00:00Z', conversationId: 'c1' },
      { id: 'lead3', clientName: 'Archived', archived: true },
      { id: 'lead4', clientName: 'Legacy lost', pipelineStatus: 'lost' }
    ],
    invoices: [
      invoice({ id: 'old', leadId: 'lead1', savedAt: '2026-09-01T00:00:00Z', totalAmount: 1 }),
      invoice({ leadId: 'lead1' }),
      invoice({ id: 'inv2', clientName: 'Cora', clientCompany: 'Acme', leadId: null }),
      invoice({ id: 'inv3', archived: true }),
      invoice({ id: 'inv4', archived: true, leadId: 'lead2' }),
      { id: 'inv5', leadId: 'lead4', totalAmount: 5000, invoiceItems: [], paymentMilestones: [] }
    ],
    events: [
      { id: 'ev1', status: 'draft', links: { leadId: 'lead1' }, startDate: '2026-11-14' },
      { id: 'ev2', status: 'cancelled', links: { invoiceId: 'inv2' } }
    ],
    pendingProofs: [],
    now: NOW
  });

  assert.deepEqual(bookings.map((b) => b.id), ['lead1', 'lead2', 'lead3', 'lead4', 'inv:inv2', 'inv:inv3']);
  assert.deepEqual(bookings.map((b) => b.archived), [false, false, true, true, false, true]);
  assert.equal(bookings[3].invoiceId, 'inv5');

  const [a, b, , , c] = bookings;
  assert.equal(a.invoiceId, 'inv1');
  assert.equal(a.price, 40000);
  assert.equal(a.stage, 'invoiced');
  assert.equal(a.ref, 'ABCDE');
  assert.equal(a.event.id, 'ev1');
  assert.equal(a.pax, 120);
  assert.equal(a.service, 'mobile_bar');

  assert.equal(b.stage, 'inquiry');
  assert.equal(b.invoiceId, null);
  assert.equal(b.channel, 'chatbot');
  assert.equal(b.conversationId, 'c1');
  assert.equal(b.invoice, null);

  assert.equal(c.kind, 'invoice');
  assert.equal(c.channel, 'invoice');
  assert.equal(c.clientName, 'Cora');
  assert.equal(c.company, 'Acme');
  assert.equal(c.event, null);
});
