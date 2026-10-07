/* Mock data for design work (?mock=1). Same booking shape as data/normalize.js output. */
import { channelLabel } from './constants.js';

export const NOW = new Date('2026-09-28T13:00:00+08:00');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

export const STAFF = {
  tin: { name: 'Tin', color: '#2b9348' },
  migs: { name: 'Migs', color: '#0b4f8a' },
  ella: { name: 'Ella', color: '#8a4b0a' },
  jon: { name: 'Jon', color: '#4b2e83' },
  rica: { name: 'Rica', color: '#1e3a5f' }
};

function msg(from, at, text, extracted) {
  return { from, at, text, extracted: extracted || null };
}

function milestones(total, firstDue, preDue, finalDue, paidCount) {
  const rows = [
    { label: 'Date reservation', pct: 25, date: firstDue },
    { label: 'Pre-event', pct: 25, date: preDue },
    { label: 'Event completion', pct: 50, date: finalDue }
  ];
  return rows.map((r, i) => ({
    ...r,
    amount: Math.round((total * r.pct) / 100),
    paid: i < paidCount
  }));
}

export const bookings = [
  /* ---------- INQUIRY (missing details) ---------- */
  {
    id: 'b-kaye', ref: 'K7M2P', stage: 'inquiry', channel: 'instagram',
    clientName: 'Kaye Villanueva', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Wedding', date: '2026-12-05', pax: 150, paxNote: '~150 guests',
    venue: 'Tagaytay', price: null,
    createdAt: hoursAgo(3), lastActivityAt: hoursAgo(3), waitingOn: 'us',
    chat: [
      msg('client', hoursAgo(3.2), 'Hi! Do you do matcha bars for weddings? Dec 5 in Tagaytay, around 150 guests 🍵'),
      msg('bot', hoursAgo(3.1), 'Yes we do! Our Mobile Matcha Bar starts at Php 29,500 for 100 cups. Can I get your name?'),
      msg('client', hoursAgo(3), "I'm Kaye! Ok will wait for full quote po", { field: 'clientName', value: 'Kaye Villanueva' })
    ]
  },
  {
    id: 'b-jericho', ref: 'J4TQ9', stage: 'inquiry', channel: 'messenger',
    clientName: 'Jericho Tan', company: 'Accenture PH', email: 'jericho.tan@example.com', phone: '',
    service: 'matcha_workshop', eventType: 'Team building', date: '2026-11-14', pax: 25,
    venue: 'Uptown BGC', price: null,
    createdAt: hoursAgo(5), lastActivityAt: hoursAgo(5), waitingOn: 'us',
    chat: [
      msg('client', hoursAgo(5.3), 'Hello, inquiring for a matcha workshop for our team, 25 pax, Nov 14.', { field: 'pax', value: '25' }),
      msg('bot', hoursAgo(5.2), 'Lovely! Where would the workshop be held?'),
      msg('client', hoursAgo(5), 'Our office in Uptown BGC', { field: 'venue', value: 'Uptown BGC' })
    ]
  },
  {
    id: 'b-maria-dup', ref: 'M8RX2', stage: 'inquiry', channel: 'instagram', duplicateOf: 'b-maria',
    clientName: 'maria.santos', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Corporate', date: '2026-10-30', pax: 120,
    venue: '', price: null,
    createdAt: hoursAgo(9), lastActivityAt: hoursAgo(9), waitingOn: 'us',
    chat: [
      msg('client', hoursAgo(9), 'Hi again, following up on the Oct 30 matcha bar for Acme!')
    ]
  },
  {
    id: 'b-bea', ref: 'B2LWN', stage: 'inquiry', channel: 'widget',
    clientName: 'Bea L.', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Birthday', date: null, pax: null, paxNote: '80-100',
    venue: '', price: null,
    createdAt: hoursAgo(20), lastActivityAt: hoursAgo(20), waitingOn: 'us',
    chat: [
      msg('client', hoursAgo(20), 'how much for a matcha cart for a bday, 80-100 people?'),
      msg('bot', hoursAgo(20), 'Our Starter package is Php 29,500 for 100 cups. What date are you thinking?')
    ]
  },
  {
    id: 'b-patricia', ref: 'P9GH3', stage: 'inquiry', channel: 'instagram',
    clientName: 'Patricia Gomez', company: '', email: '', phone: '0917 555 0144',
    service: 'mochi_workshop', eventType: 'Birthday', date: '2026-10-24', pax: 12,
    venue: 'Quezon City', price: null,
    createdAt: daysAgo(1), lastActivityAt: daysAgo(1), waitingOn: 'us',
    chat: [
      msg('client', daysAgo(1), 'Hi! Mochi workshop for my daughter\u2019s 12th bday, 12 kids, Oct 24 in QC. Possible?')
    ]
  },
  {
    id: 'b-lanz', ref: 'L3ZZ8', stage: 'inquiry', channel: 'instagram',
    clientName: '@lanz.eats', company: '', email: '', phone: '',
    service: null, eventType: '', date: null, pax: null, venue: '', price: null,
    createdAt: daysAgo(1.5), lastActivityAt: daysAgo(1.5), waitingOn: 'us',
    chat: [msg('client', daysAgo(1.5), 'hm po')]
  },
  {
    id: 'b-carlo-dup', ref: 'C5VB1', stage: 'inquiry', channel: 'messenger', duplicateOf: 'b-carlo',
    clientName: 'Carlo Reyes', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Corporate', date: '2027-01-16', pax: 100,
    venue: 'Ortigas', price: null,
    createdAt: daysAgo(2), lastActivityAt: daysAgo(2), waitingOn: 'us',
    chat: [msg('client', daysAgo(2), 'Hey guys! Loved the bar at our Sept event. Booking again for Jan 16, same package?')]
  },

  /* ---------- INQUIRY (details in) ---------- */
  {
    id: 'b-maria', ref: 'M2QK7', stage: 'inquiry', channel: 'instagram',
    clientName: 'Maria Santos', company: 'Acme Corp', email: 'maria@acme.ph', phone: '0917 812 3345',
    service: 'mobile_bar', eventType: 'Corporate anniversary', date: '2026-10-30', time: '14:00–18:00', pax: 120,
    venue: 'Bonifacio High Street, BGC', price: null,
    createdAt: daysAgo(6), lastActivityAt: hoursAgo(2), waitingOn: 'us',
    notes: 'Wants oat milk option. Asked if we can brand cups with Acme logo.',
    chat: [
      msg('client', daysAgo(6), 'Hi! Planning our 10th anniversary on Oct 30, 2–6pm at BGC. Around 120 people.', { field: 'date', value: 'Oct 30' }),
      msg('bot', daysAgo(6), 'Congrats! For 120 cups, our Starter is around Php 33,700. May I have your name and company?'),
      msg('client', daysAgo(6), 'Maria Santos, Acme Corp', { field: 'company', value: 'Acme Corp' }),
      msg('staff', daysAgo(4), 'Hi Maria! Tin here from Matchanese. Do you need oat milk options?'),
      msg('client', hoursAgo(2), 'Yes, oat milk please! Also can you print our logo on the cups? What would that cost?')
    ]
  },
  {
    id: 'b-anton', ref: 'A6DN4', stage: 'inquiry', channel: 'messenger',
    clientName: 'Anton Dizon', company: '', email: 'anton.d@example.com', phone: '',
    service: 'matcha_workshop', eventType: 'Bridal shower', date: '2026-11-08', pax: 15,
    venue: 'Salcedo Village, Makati', price: null,
    createdAt: daysAgo(8), lastActivityAt: daysAgo(3), waitingOn: 'client',
    chat: [
      msg('client', daysAgo(8), 'Surprise bridal shower for my sister, 15 pax, Nov 8.'),
      msg('staff', daysAgo(3), 'Sounds fun! Would it be at a home or a venue? That affects setup.')
    ]
  },
  {
    id: 'b-sam', ref: 'S1GL5', stage: 'inquiry', channel: 'widget',
    clientName: 'Sam Ocampo', company: 'Globe Telecom', email: 'socampo@example.com', phone: '0918 222 9087',
    service: 'matcha_popup', eventType: 'Office pop-up', date: '2026-11-20', pax: 300, paxNote: '~300 cups',
    venue: 'The Globe Tower, BGC', price: null,
    createdAt: daysAgo(4), lastActivityAt: daysAgo(1), waitingOn: 'us',
    chat: [
      msg('client', daysAgo(4), 'We want a matcha pop-up at our lobby for wellness week, ~300 employees.'),
      msg('client', daysAgo(1), 'Any update on the proposal? Need it for internal approval by Friday.')
    ]
  },
  {
    id: 'b-lia', ref: 'L8FR2', stage: 'inquiry', channel: 'instagram',
    clientName: 'Lia Fernandez', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Debut', date: '2026-12-19', pax: 150,
    venue: 'Alabang Country Club', price: null,
    createdAt: daysAgo(30), lastActivityAt: daysAgo(24), waitingOn: 'client',
    chat: [
      msg('client', daysAgo(30), 'Matcha bar for my 18th, Dec 19 at Alabang CC, 150 guests'),
      msg('staff', daysAgo(24), 'Hi Lia! Sending the package options, would you prefer Starter or Signature?')
    ]
  },

  /* ---------- QUOTED ---------- */
  {
    id: 'b-rafael', ref: 'R4WC6', stage: 'quoted', channel: 'instagram',
    clientName: 'Rafael Cruz', company: '', email: 'raf.cruz@example.com', phone: '0927 111 4455',
    service: 'mobile_bar', eventType: 'Wedding', date: '2026-11-28', time: '17:00–21:00', pax: 150,
    venue: 'Hillcreek Gardens, Tagaytay', price: 47000, priceNote: 'Signature 150 cups + Tagaytay transport',
    createdAt: daysAgo(12), lastActivityAt: daysAgo(2), waitingOn: 'client',
    chat: [
      msg('client', daysAgo(12), 'Wedding on Nov 28 at Hillcreek, 150 guests. Signature package po'),
      msg('staff', daysAgo(2), 'Here\u2019s the quote: Signature 150 cups Php 43,500 + Tagaytay transport Php 3,500 = Php 47,000.')
    ]
  },
  {
    id: 'b-nina', ref: 'N7PS3', stage: 'quoted', channel: 'messenger',
    clientName: 'Nina Aquino', company: 'Shopee PH', email: 'nina.aquino@example.com', phone: '',
    service: 'matcha_workshop', eventType: 'Employee engagement', date: '2026-10-17', pax: 30,
    venue: 'Shopee Office, Taguig', price: 36000,
    createdAt: daysAgo(9), lastActivityAt: hoursAgo(20), waitingOn: 'us',
    chat: [
      msg('staff', daysAgo(5), 'Quote for 30 pax matcha workshop: Php 36,000 inclusive of materials.'),
      msg('client', hoursAgo(20), 'Looks good! Can we see the menu of drinks they\u2019ll make? Then we can proceed with invoice.')
    ]
  },
  {
    id: 'b-jules', ref: 'J9MM1', stage: 'quoted', channel: 'instagram',
    clientName: 'Jules Mercado', company: '', email: '', phone: '',
    service: 'mochi_workshop', eventType: 'Barkada', date: '2026-10-10', pax: 20,
    venue: 'Marikina', price: 18000,
    createdAt: daysAgo(10), lastActivityAt: daysAgo(6), waitingOn: 'client',
    chat: [
      msg('staff', daysAgo(6), 'Mochi workshop for 20: Php 18,000. Let us know so we can hold Oct 10 for you!')
    ]
  },
  {
    id: 'b-hannah', ref: 'H2YT8', stage: 'quoted', channel: 'instagram',
    clientName: 'Hannah Lim', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Baby shower', date: '2026-11-01', pax: 100,
    venue: 'San Juan', price: 29500,
    createdAt: daysAgo(35), lastActivityAt: daysAgo(26), waitingOn: 'client',
    chat: [msg('staff', daysAgo(26), 'Starter package 100 cups: Php 29,500. Happy to hold the date!')]
  },

  /* ---------- INVOICED ---------- */
  {
    id: 'b-enrique', ref: 'E3YW7', stage: 'invoiced', channel: 'instagram',
    clientName: 'Enrique & Yasmin', company: '', email: 'enrique.yasmin@example.com', phone: '0917 900 1122',
    service: 'mobile_bar', eventType: 'Wedding', date: '2026-10-24', time: '18:00–22:00', pax: 150,
    venue: 'The Blue Leaf Pavilion, Taguig', price: 52000,
    createdAt: daysAgo(21), lastActivityAt: hoursAgo(1), waitingOn: 'us',
    invoice: {
      number: 'INV-2026-0915-002', status: 'unpaid', published: true, proofPending: true,
      packageLabel: 'Signature · 150 cups + custom menu', total: 52000,
      milestones: milestones(52000, '2026-09-30', '2026-10-17', '2026-10-24', 0)
    },
    chat: [
      msg('staff', daysAgo(10), 'Here\u2019s your invoice link! First payment due Sept 30.'),
      msg('client', hoursAgo(1), 'Paid the reservation fee via GCash, uploaded the screenshot on the invoice page 🙏')
    ]
  },
  {
    id: 'b-carmela', ref: 'C1UX4', stage: 'invoiced', channel: 'messenger',
    clientName: 'Carmela Santos', company: 'Unilab', email: 'csantos@example.com', phone: '',
    service: 'matcha_workshop', eventType: 'Wellness day', date: '2026-10-15', pax: 40,
    venue: 'Unilab Pioneer, Mandaluyong', price: 48000,
    createdAt: daysAgo(20), lastActivityAt: daysAgo(8), waitingOn: 'client',
    invoice: {
      number: 'INV-2026-0914-001', status: 'unpaid', published: true,
      packageLabel: 'Matcha workshop · 40 pax', total: 48000,
      milestones: milestones(48000, '2026-09-21', '2026-10-08', '2026-10-15', 0)
    },
    chat: [msg('staff', daysAgo(8), 'Invoice sent! Reservation fee due Sept 21 to lock the date.')]
  },
  {
    id: 'b-bianca', ref: 'B6KD2', stage: 'invoiced', channel: 'widget',
    clientName: 'Bianca Ramos', company: 'BDO Unibank', email: 'bianca.ramos@example.com', phone: '0998 765 4321',
    service: 'mobile_bar', eventType: 'Christmas party', date: '2026-12-11', pax: 200,
    venue: 'BDO Corporate Center, Makati', price: 61800,
    createdAt: daysAgo(7), lastActivityAt: daysAgo(1), waitingOn: 'us',
    invoice: {
      number: 'INV-2026-0927-001', status: 'draft', published: false,
      packageLabel: 'Starter · 200 cups', total: 61800,
      milestones: milestones(61800, '2026-10-05', '2026-12-04', '2026-12-11', 0)
    },
    chat: [msg('client', daysAgo(1), 'Please send the invoice so finance can process 🙂')]
  },

  /* ---------- BOOKED ---------- */
  {
    id: 'b-market', ref: 'MMFR0', stage: 'booked', channel: 'manual',
    clientName: 'Coffee & Matcha Fair', company: 'Market! Market!', email: '', phone: '',
    service: 'matcha_popup', eventType: 'Mall pop-up', date: '2026-10-03', endDate: '2026-10-05', pax: 600, paxNote: '~200 cups/day',
    venue: 'Market! Market! Activity Center', price: null,
    createdAt: daysAgo(40), lastActivityAt: daysAgo(2), waitingOn: null,
    event: {
      id: 'ev-market', status: 'confirmed', staff: ['tin', 'migs', 'ella'],
      menu: '12 drinks · custom menu', purchasing: 'Plan drafted', schedule: '3 shifts/day'
    },
    chat: []
  },
  {
    id: 'b-gab', ref: 'G5TH1', stage: 'booked', channel: 'instagram',
    clientName: 'Gab & Therese', company: '', email: 'gab.therese@example.com', phone: '0917 333 2211',
    service: 'mobile_bar', eventType: 'Wedding', date: '2026-10-02', time: '16:00–20:00', pax: 150,
    venue: 'Loreland Farm, Antipolo', price: 45500,
    createdAt: daysAgo(50), lastActivityAt: daysAgo(3), waitingOn: null,
    invoice: {
      number: 'INV-2026-0810-003', status: 'partial', published: true,
      packageLabel: 'Signature · 150 cups', total: 45500,
      milestones: milestones(45500, '2026-08-15', '2026-09-25', '2026-10-02', 2)
    },
    event: { id: 'ev-gab', status: 'confirmed', staff: [], menu: 'Signature menu', purchasing: 'Not started', schedule: 'No shifts yet' },
    chat: [msg('client', daysAgo(3), 'Pre-event payment sent! Excited 💚')]
  },
  {
    id: 'b-ateneo', ref: 'A2OB9', stage: 'booked', channel: 'messenger',
    clientName: 'Ateneo Culinary Org', company: 'Ateneo de Manila', email: 'aco@example.com', phone: '',
    service: 'matcha_workshop', eventType: 'Org workshop', date: '2026-10-08', pax: 35,
    venue: 'Ateneo, Katipunan', price: 42000,
    createdAt: daysAgo(28), lastActivityAt: daysAgo(5), waitingOn: null,
    invoice: {
      number: 'INV-2026-0902-001', status: 'partial', published: true,
      packageLabel: 'Matcha workshop · 35 pax', total: 42000,
      milestones: milestones(42000, '2026-09-05', '2026-10-01', '2026-10-08', 1)
    },
    event: { id: 'ev-ateneo', status: 'confirmed', staff: ['jon', 'rica'], menu: 'Workshop kit', purchasing: 'Ordered', schedule: '2 staff' },
    chat: []
  },
  {
    id: 'b-kristine', ref: 'K1YU3', stage: 'booked', channel: 'instagram',
    clientName: 'Kristine Yu', company: '', email: 'kyu@example.com', phone: '',
    service: 'mobile_bar', eventType: 'Engagement party', date: '2026-11-21', pax: 120,
    venue: 'Rockwell Tent, Makati', price: 38000,
    createdAt: daysAgo(18), lastActivityAt: daysAgo(4), waitingOn: null,
    invoice: {
      number: 'INV-2026-0912-002', status: 'partial', published: true,
      packageLabel: 'Starter · 120 cups + coffee add-on', total: 38000,
      milestones: milestones(38000, '2026-09-19', '2026-11-14', '2026-11-21', 1)
    },
    event: { id: 'ev-kristine', status: 'draft', staff: [], menu: 'Not set', purchasing: 'Not started', schedule: 'No shifts yet' },
    chat: []
  },

  /* ---------- COMPLETED ---------- */
  {
    id: 'b-carlo', ref: 'C8RS5', stage: 'completed', channel: 'messenger',
    clientName: 'Carlo Reyes', company: 'Ortigas Land', email: 'carlo.reyes@example.com', phone: '0917 404 5566',
    service: 'mobile_bar', eventType: 'Corporate', date: '2026-09-12', pax: 100,
    venue: 'Estancia Mall, Ortigas', price: 29500,
    createdAt: daysAgo(60), lastActivityAt: daysAgo(16), waitingOn: null,
    invoice: {
      number: 'INV-2026-0801-001', status: 'partial', published: true,
      packageLabel: 'Starter · 100 cups', total: 29500,
      milestones: milestones(29500, '2026-08-05', '2026-09-05', '2026-09-12', 2)
    },
    event: { id: 'ev-carlo', status: 'confirmed', staff: ['tin', 'jon'], menu: 'Starter menu', purchasing: 'Done', schedule: 'Done' },
    chat: []
  },
  {
    id: 'b-paolo', ref: 'P4GA7', stage: 'completed', channel: 'instagram',
    clientName: 'Paolo Garcia', company: '', email: '', phone: '',
    service: 'matcha_workshop', eventType: 'Birthday', date: '2026-09-20', pax: 20,
    venue: 'Poblacion, Makati', price: 24000,
    createdAt: daysAgo(45), lastActivityAt: daysAgo(8), waitingOn: null,
    invoice: {
      number: 'INV-2026-0825-002', status: 'paid', published: true,
      packageLabel: 'Matcha workshop · 20 pax', total: 24000,
      milestones: milestones(24000, '2026-08-28', '2026-09-13', '2026-09-20', 3)
    },
    event: { id: 'ev-paolo', status: 'confirmed', staff: ['ella'], menu: 'Workshop kit', purchasing: 'Done', schedule: 'Done' },
    chat: []
  },

  /* ---------- ARCHIVED ---------- */
  {
    id: 'b-dana', ref: 'D7CZ2', stage: 'quoted', archived: true, channel: 'instagram',
    clientName: 'Dana Cruz', company: '', email: '', phone: '',
    service: 'mobile_bar', eventType: 'Birthday', date: '2026-10-18', pax: 60,
    venue: 'Pasig', price: 29500,
    createdAt: daysAgo(25), lastActivityAt: daysAgo(15), waitingOn: null, chat: []
  },
  {
    id: 'b-mark', ref: 'M3VL6', stage: 'inquiry', archived: true, channel: 'messenger',
    clientName: 'Mark Villareal', company: 'Jollibee Group', email: '', phone: '',
    service: 'matcha_popup', eventType: 'Office pop-up', date: '2026-10-03', pax: 250,
    venue: 'Ortigas', price: null,
    createdAt: daysAgo(22), lastActivityAt: daysAgo(19), waitingOn: null, chat: []
  }
];

bookings.forEach((b) => {
  b.activity = buildActivity(b);
});

function buildActivity(b) {
  const rows = [{ at: b.createdAt, kind: 'system', text: b.channel === 'manual' ? 'Created manually' : `Captured from ${channelLabel(b.channel)} by the bot` }];
  if (b.channel !== 'manual') {
    rows.push({ at: b.createdAt, kind: 'bot', text: 'Bot updated 4 fields', detail: ['Service', 'Event date', 'Pax', 'Venue'] });
  }
  if (b.price && b.stage !== 'inquiry') rows.push({ at: b.lastActivityAt, kind: 'bot', text: `Quote sent · Php ${b.price.toLocaleString('en-PH')}` });
  if (b.invoice) {
    rows.push({ at: b.lastActivityAt, kind: 'system', text: `Invoice ${b.invoice.number} ${b.invoice.published ? 'published' : 'drafted'}` });
    const paid = b.invoice.milestones.filter((m) => m.paid);
    paid.forEach((m) => rows.push({ at: m.date, kind: 'system', text: `${m.label} payment confirmed` }));
  }
  if (b.event) rows.push({ at: b.lastActivityAt, kind: 'system', text: `Event ${b.event.status === 'confirmed' ? 'confirmed on calendar' : 'drafted on calendar'}` });
  if (b.archived) rows.push({ at: b.lastActivityAt, kind: 'human', text: 'Archived' });
  return rows.sort((a, c) => new Date(c.at) - new Date(a.at));
}
