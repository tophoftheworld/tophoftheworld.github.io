import test from 'node:test';
import assert from 'node:assert/strict';
import { setNow, nextAction, nextStep, invoiceFacts, displayNames, relTime, NEXT_ACTIONS } from '../js/ui.js';

setNow(new Date('2026-10-04T10:00:00+08:00'));

const recent = '2026-10-03T10:00:00+08:00';
const base = { stage: 'inquiry', archived: false, date: '2026-11-20', lastActivityAt: recent, service: 'mobile_bar', pax: 100, venue: 'BGC' };
const inv = (over = {}) => ({ total: 10000, published: true, proofPending: false, milestones: [{ label: 'Date Reservation', amount: 5000, date: '2026-10-20', paid: false }], ...over });

test('inquiry: complete details need a price, missing ones are listed', () => {
  const ready = nextAction(base);
  assert.equal(ready.key, 'quote');
  assert.equal(ready.text, 'Needs price');
  const a = nextAction({ ...base, date: null, pax: null });
  assert.equal(a.key, 'waiting_details');
  assert.equal(a.text, 'Needs date, pax');
});

test('quoted goes quiet after 21 days', () => {
  assert.equal(nextAction({ ...base, stage: 'quoted' }).text, 'Quote sent');
  const quiet = nextAction({ ...base, stage: 'quoted', lastActivityAt: '2026-09-01T10:00:00+08:00' });
  assert.equal(quiet.key, 'quiet');
  assert.equal(quiet.text, 'Quiet 33d');
});

test('invoiced: unsent, due, overdue and proof uploaded', () => {
  assert.equal(nextAction({ ...base, stage: 'invoiced', invoice: inv({ published: false }) }).text, 'Not sent');
  const due = nextAction({ ...base, stage: 'invoiced', invoice: inv() });
  assert.equal(due.key, 'unpaid');
  assert.equal(due.text, 'Due Oct 20');
  const late = nextAction({ ...base, stage: 'invoiced', invoice: inv({ milestones: [{ label: 'Date Reservation', amount: 5000, date: '2026-09-30', paid: false }] }) });
  assert.equal(late.key, 'overdue');
  assert.equal(late.text, 'Overdue 4d');
  assert.equal(late.strong, true);
  assert.match(nextAction({ ...base, stage: 'invoiced', invoice: inv({ proofPending: true, pendingAmount: 5000 }) }).text, /^Proof · /);
});

test('booked: no calendar prompts, only staff and upcoming', () => {
  const paid = inv({ milestones: [{ amount: 5000, date: '2026-09-01', paid: true }, { amount: 5000, date: '2026-11-19', paid: false }] });
  const b = { ...base, stage: 'booked', invoice: paid };
  assert.equal(nextAction(b).key, 'upcoming');
  assert.equal(nextAction({ ...b, event: { status: 'draft' } }).key, 'upcoming');
  const staff = nextAction({ ...b, date: '2026-10-09', event: { status: 'confirmed', staff: [] } });
  assert.equal(staff.key, 'staff');
  assert.equal(staff.text, 'No staff · in 5d');
  assert.equal(nextAction({ ...b, date: '2026-10-07', event: { status: 'confirmed', staff: ['a'] } }).text, 'In 3 days');
  assert.ok(!NEXT_ACTIONS.some((a) => a.key === 'confirm_event' || a.key === 'add_event'));
});

test('booked by hand: the skipped deposit is not overdue, later payments still are', () => {
  const ms = [{ amount: 5000, date: '2026-09-01', paid: false }, { amount: 5000, date: '2026-11-19', paid: false }];
  const b = { ...base, stage: 'booked', date: '2026-10-09', invoice: inv({ bookedByHand: true, milestones: ms }), event: { status: 'confirmed', staff: ['a'] } };
  const a = nextAction(b);
  assert.equal(a.key, 'upcoming');
  assert.equal(a.text, 'No deposit · in 5d');
  const lateBalance = nextAction({ ...b, invoice: inv({ bookedByHand: true, milestones: [ms[0], { ...ms[1], date: '2026-09-30' }] }) });
  assert.equal(lateBalance.key, 'overdue');
});

test('after the event: booked stays booked until paid, unbooked invoices ask', () => {
  const ms = [{ amount: 5000, date: '2026-09-01', paid: false }, { amount: 5000, date: '2026-10-30', paid: false }];
  const done = { ...base, stage: 'booked', date: '2026-10-01', invoice: inv({ bookedByHand: true, milestones: ms }) };
  const a = nextAction(done);
  assert.equal(a.key, 'after_event');
  assert.match(a.text, /unpaid$/);
  const late = nextAction({ ...done, invoice: inv({ bookedByHand: true, milestones: [ms[0], { ...ms[1], date: '2026-10-02' }] }) });
  assert.equal(late.text, 'Overdue 2d');
  assert.equal(late.strong, true);
  assert.equal(nextAction({ ...base, stage: 'invoiced', date: '2026-10-01', invoice: inv() }).key, 'not_booked');
  assert.equal(nextAction({ ...base, stage: 'booked', date: '2026-09-24', event: { status: 'confirmed' } }).key, 'to_close');

  const step = nextStep(done);
  assert.equal(step.title, 'Balance due');
  assert.equal(step.secondary.action, 'settle');
  assert.equal(step.secondary.label, 'Settle');
});

test('completed and archived: done, no money nagging, no next-step card', () => {
  assert.equal(nextAction({ ...base, archived: true }).key, 'archived');
  assert.equal(nextAction({ ...base, date: '2026-09-01' }).key, 'expired');
  assert.equal(nextAction({ ...base, stage: 'completed', invoice: inv() }).text, 'Done');
  assert.equal(nextAction({ ...base, stage: 'completed' }).text, 'Done');
  assert.equal(nextStep({ ...base, stage: 'completed', invoice: inv() }), null);
  assert.equal(nextStep({ ...base, archived: true }), null);
});

test('invoiceFacts counts partial payments', () => {
  const f = invoiceFacts(inv({ milestones: [{ amount: 5000, date: '2026-10-20', paid: false, received: 2000 }, { amount: 5000, date: '2026-11-19', paid: false }] }));
  assert.equal(f.paid, 2000);
  assert.equal(f.remaining, 8000);
});

test('relTime: days up to 29, then a date with the year only when it is not this year', () => {
  assert.equal(relTime('2026-09-20T10:00:00+08:00'), '14d ago');
  assert.equal(relTime('2026-08-12T10:00:00+08:00'), 'Aug 12');
  assert.equal(relTime('2025-08-12T10:00:00+08:00'), 'Aug 12, 2025');
});

test('displayNames: company leads, rep shows only under a company', () => {
  assert.deepEqual(displayNames({ clientName: 'Giselle', company: 'SolarWinds' }), { title: 'SolarWinds', contact: 'Giselle' });
  assert.deepEqual(displayNames({ clientName: 'Giselle', company: '' }), { title: 'Giselle', contact: '' });
  assert.deepEqual(displayNames({ clientName: 'Creat8', company: 'creat8' }), { title: 'creat8', contact: '' });
  assert.deepEqual(displayNames({ clientName: '', company: '' }), { title: 'Unnamed client', contact: '' });
});
