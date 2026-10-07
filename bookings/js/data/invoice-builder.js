/* Draft invoice from a booking — mirrors invoice-generator numbering, packages and default milestones. */

const MOBILE_BAR_PACKAGES = {
  starter: { name: 'Mobile Matcha Bar - STARTER PACKAGE', rates: { 100: 29500, 150: 43500 } },
  signature: { name: 'Mobile Matcha Bar - SIGNATURE PACKAGE', rates: { 100: 32500, 150: 46750 } },
  special: { name: 'Mobile Matcha Bar - SPECIAL PACKAGE', rates: { 100: 36000, 150: 52000 } }
};
const MOBILE_BAR_STANDARD_INCLUSIONS = [
  'Mobile Matcha Bar Setup',
  'Ingredients, cups, ice, and standard supplies',
  'Transportation within Metro Manila'
];
const MOBILE_BAR_ADDITIONAL_OPTIONS = ['Iced (12oz) Drinks', 'Dairy or Oat Milk (choose one)'];
const MATCHA_WORKSHOP_INCLUSIONS = [
  'Guided matcha workshop',
  'Use of all matcha tools during the session',
  'Two rounds of hands-on matcha making (one cup + one bottled drink to take home)',
  'Printed reference guides',
  'Sticker pack',
  'Mini tote bag',
  'Transportation within Metro Manila'
];
const WORKSHOP_TITLES = {
  matcha_workshop: 'Private Matcha Workshop',
  mochi_workshop: 'Private Mochi Making Workshop'
};

const DAY_MS = 86400e3;

function ymdToUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToYmd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function invoiceNumberPrefix(invoiceYmd) {
  const [y, m, d] = invoiceYmd.split('-');
  return `INV-${y}-${m}${d}-`;
}

export function nextInvoiceNumber(invoiceYmd, existingNumbers) {
  const prefix = invoiceNumberPrefix(invoiceYmd);
  let max = 0;
  for (const n of existingNumbers) {
    const value = String(n || '').trim();
    if (!value.startsWith(prefix)) continue;
    const m = value.slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function mobileBarListPrice(packageType, cups) {
  const rates = MOBILE_BAR_PACKAGES[packageType]?.rates;
  const n = parseInt(cups, 10);
  if (!rates || !n || n <= 0) return 0;
  if (rates[n] != null) return rates[n];
  const slope = (rates[150] - rates[100]) / 50;
  const anchor = n > 150 ? 150 : 100;
  return Math.round(rates[anchor] + (n - anchor) * slope);
}

/** Same rules as invoice-generator calculateMilestoneDates + applyDefaultPaymentLogic (three-payment). */
export function defaultMilestones({ total, invoiceYmd, eventYmd, idBase = Date.now() }) {
  const inv = ymdToUtc(invoiceYmd);
  const ev = ymdToUtc(eventYmd);
  const daysUntilEvent = Math.ceil((ev - inv) / DAY_MS);
  const hasPreEvent = daysUntilEvent >= 14;

  let reservation = invoiceYmd;
  let preEvent = '';
  if (hasPreEvent) {
    const pre = ev - 7 * DAY_MS;
    preEvent = utcToYmd(pre);
    reservation = utcToYmd(Math.max(inv, Math.min(inv + 5 * DAY_MS, pre - 7 * DAY_MS)));
  }

  const pct = { first: hasPreEvent ? 25 : 50, preEvent: hasPreEvent ? 25 : 0, final: 50 };
  const amount = (p) => Math.round(total * p) / 100;
  return [
    { id: idBase, role: 'first', milestone: 'Date Reservation', date: reservation, percentage: pct.first, amount: amount(pct.first), paid: false },
    { id: idBase + 1, role: 'preEvent', milestone: 'Pre-Event', date: preEvent, percentage: pct.preEvent, amount: amount(pct.preEvent), paid: false },
    { id: idBase + 2, role: 'final', milestone: 'Event Completion', date: eventYmd, percentage: pct.final, amount: amount(pct.final), paid: false }
  ];
}

export function packageItemFromBooking(b, { idBase = Date.now() } = {}) {
  const count = Number(b.pax) || 0;
  const venue = b.venue || '';
  const date = b.date || '';
  if (b.service === 'matcha_workshop' || b.service === 'mochi_workshop') {
    const total = Number(b.price) || 0;
    return {
      id: idBase,
      eventType: b.service,
      eventVenue: venue,
      eventDate: date,
      description: WORKSHOP_TITLES[b.service],
      count,
      countLabel: 'participants',
      isWorkshop: true,
      workshopInclusions: b.service === 'matcha_workshop' ? [...MATCHA_WORKSHOP_INCLUSIONS] : [],
      workshopDetails: '',
      quantity: count,
      unitCost: count > 0 && total > 0 ? String(Math.round((total / count) * 100) / 100) : '',
      unitPrice: total,
      menuItems: [],
      choiceDrinks: [],
      additionalOptions: [],
      otherInclusions: [],
      durationHours: 3,
      packageType: '',
      coffeeAddOn: false,
      transportAddOn: 'none',
      priceOverride: ''
    };
  }
  const packageType = 'starter';
  const list = mobileBarListPrice(packageType, count);
  const price = Number(b.price) || list;
  return {
    id: idBase,
    eventType: 'mobile_bar',
    eventVenue: venue,
    eventDate: date,
    description: MOBILE_BAR_PACKAGES[packageType].name,
    count,
    countLabel: 'cups',
    isWorkshop: false,
    packageType,
    priceOverride: price && price !== list ? String(price) : '',
    unitPrice: price,
    menuItems: [],
    choiceDrinks: [],
    additionalOptions: [...MOBILE_BAR_ADDITIONAL_OPTIONS],
    otherInclusions: [...MOBILE_BAR_STANDARD_INCLUSIONS],
    durationHours: 3,
    serviceWindow: [],
    baristas: '',
    coffeeAddOn: false,
    transportAddOn: 'none'
  };
}

/** Missing booking fields that block invoice creation. */
export function invoiceBlockers(b) {
  const out = [];
  if (!b.service) out.push('service');
  if (!b.date) out.push('date');
  if (!b.pax) out.push('pax');
  if (!b.price && !(b.service === 'mobile_bar' || b.service === 'matcha_popup')) out.push('price');
  return out;
}

export function buildInvoicePayload(b, { invoiceNumber, invoiceYmd, nowIso, idBase = Date.now() }) {
  const item = packageItemFromBooking(b, { idBase });
  const total = Number(item.unitPrice) || 0;
  return {
    invoiceNumber,
    invoiceDate: invoiceYmd,
    clientName: b.clientName || '',
    clientCompany: b.company || '',
    clientEmail: b.email || '',
    clientPhone: b.phone || '',
    clientAddress: '',
    clientTIN: '',
    eventName: b.eventName || '',
    eventDate: b.date,
    notes: '',
    invoiceItems: [item],
    customLineItems: [],
    paymentMilestones: defaultMilestones({ total, invoiceYmd, eventYmd: b.date, idBase: idBase + 10 }),
    paymentStructure: 'three',
    paymentTermsCustomized: false,
    invoiceDiscount: 0,
    vatApplied: false,
    amountVat: 0,
    amountSubtotal: total,
    amountDiscount: 0,
    amountTotal: total,
    totalAmount: total,
    shareStatus: 'draft',
    leadId: b.leadId || null,
    createdFrom: 'bookings-app',
    savedAt: nowIso,
    updatedAt: nowIso
  };
}

/** Writes a draft invoice and returns { id, invoiceNumber }. */
export async function createDraftInvoice(db, fns, b, { invoiceYmd }) {
  const { collection, query, where, getDocs, addDoc } = fns;
  const prefix = invoiceNumberPrefix(invoiceYmd);
  const snap = await getDocs(
    query(collection(db, 'invoice-generator'), where('invoiceNumber', '>=', prefix), where('invoiceNumber', '<', `${prefix}\uf8ff`))
  );
  const invoiceNumber = nextInvoiceNumber(invoiceYmd, snap.docs.map((d) => d.data().invoiceNumber));
  const payload = buildInvoicePayload(b, { invoiceNumber, invoiceYmd, nowIso: new Date().toISOString() });
  const ref = await addDoc(collection(db, 'invoice-generator'), payload);
  return { id: ref.id, invoiceNumber, payload };
}

export function invoiceEditorUrl(invoiceId) {
  return `../invoice-generator/invoices.html?id=${encodeURIComponent(invoiceId)}`;
}
