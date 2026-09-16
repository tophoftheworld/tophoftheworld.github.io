/** Demo weeks: one row per item × location */

export const THIS_WEEK_ID = 'week-this';
export const STORAGE_KEY = 'purchasing-prototype-v7';
export const OVERLAY_COMPAT_NOTE = 'Purchasing overlays sync to Firebase; stock/need come from Order View';

export const PURCHASE_SUPPLIERS = [
  { id: 'mcecbi1s1y1k5suznxch', name: "Green Portos Dev't Corporation" },
  { id: 'greenstar-one', name: 'Greenstar One Enterprises' },
  { id: 'mcf1vurimem8kkqpxmr', name: "Arlene's Dairyhouse" },
  { id: 'ms1qgr4huszl1hzs2bh', name: 'Metro Retail Stores Group, Inc.' },
  { id: 'mcecbi1rngmlxek6ma', name: 'TX Concept Group Inc.' },
  { id: 'mcf1vuricq4gtr5w96a', name: 'TX Concept Group Inc. Cupholder' },
  { id: 'lbc-courier', name: 'LBC / local courier' },
];

const SUP = {
  matcha: PURCHASE_SUPPLIERS[0],
  dairy: PURCHASE_SUPPLIERS[2],
  grocery: PURCHASE_SUPPLIERS[3],
  packaging: PURCHASE_SUPPLIERS[4],
};

const OPT = {
  matcha: [PURCHASE_SUPPLIERS[0], PURCHASE_SUPPLIERS[1]],
  dairy: [PURCHASE_SUPPLIERS[2], PURCHASE_SUPPLIERS[3]],
  oat: [PURCHASE_SUPPLIERS[3], PURCHASE_SUPPLIERS[2]],
  packaging: [PURCHASE_SUPPLIERS[4], PURCHASE_SUPPLIERS[5]],
};

const ITEM = {
  matcha: 'JZEdsbbQxSKxlCrkd49W',
  dairy: 'iffxRiMsHujGuZH3z2YS',
  oat: 'vdpSsFr9VqCmNAN7c7zC',
  icedCups: 'knm8sfwCNvgKnwWiwrOX',
  lids: 'PzIwXMjMOMAZ8QIZbirG',
  cones: '3vFgGQsXR9OFNjrbYv04',
};

const COUNTED = {
  'sm-north': '2026-08-18',
  podium: '2026-08-15',
  moa: '2026-08-18',
  events: '2026-08-17',
};

let lineCounter = 0;

export function supplierOptionsForItem(itemId, supplier) {
  if (itemId === ITEM.matcha) return OPT.matcha;
  if (itemId === ITEM.dairy) return OPT.dairy;
  if (itemId === ITEM.oat) return OPT.oat;
  if (itemId === ITEM.icedCups || itemId === ITEM.lids || itemId === ITEM.cones) return OPT.packaging;
  return supplier ? [supplier] : [];
}

function lid() {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

function mkLine(opts) {
  return {
    id: opts.id || lid(),
    kind: opts.kind || 'item',
    itemId: opts.itemId ?? null,
    freeTextName: opts.freeTextName ?? null,
    location: opts.location ?? null,
    qty: opts.qty,
    unit: opts.unit,
    estimatedCost: opts.estimatedCost,
    supplierId: opts.supplier?.id ?? null,
    supplierName: opts.supplier?.name || '\u2014',
    supplierOptions: opts.supplierOptions || supplierOptionsForItem(opts.itemId, opts.supplier),
    source: opts.source || 'forecast',
    status: opts.status || 'planned',
    onPlan: opts.onPlan ?? false,
    needQty: opts.needQty ?? null,
    stockQty: opts.stockQty ?? null,
    runoutDate: opts.runoutDate ?? null,
    lastCountedAt: opts.lastCountedAt ?? (opts.location ? COUNTED[opts.location] : null),
    countAgeDays: opts.countAgeDays ?? null,
    lastPaidRate: opts.lastPaidRate ?? null,
    lastPaidDate: opts.lastPaidDate ?? null,
    linkedExpenseIds: opts.linkedExpenseIds || [],
    attachedLineIds: opts.attachedLineIds || [],
    frozen: opts.frozen ?? false,
    actualCost: opts.actualCost ?? null,
    rateLocked: opts.rateLocked ?? false,
  };
}

function mkFee(opts) {
  return mkLine({
    kind: 'deliveryFee',
    freeTextName: 'Delivery fee',
    qty: 1,
    unit: 'lot',
    needQty: null,
    stockQty: null,
    runoutDate: null,
    lastCountedAt: null,
    countAgeDays: null,
    source: 'manual',
    ...opts,
  });
}

function packagingFees(patch = {}) {
  const prefix = patch.id || 'line-fee-tx';
  const { id: _id, ...rest } = patch;
  return [
    mkFee({
      id: `${prefix}-north`,
      location: 'sm-north',
      supplier: SUP.packaging,
      estimatedCost: 120,
      attachedLineIds: ['line-cups-north', 'line-lids-north'],
      ...rest,
    }),
    mkFee({
      id: `${prefix}-podium`,
      location: 'podium',
      supplier: SUP.packaging,
      estimatedCost: 120,
      attachedLineIds: ['line-cups-podium', 'line-lids-podium'],
      ...rest,
    }),
    mkFee({
      id: `${prefix}-moa`,
      location: 'moa',
      supplier: SUP.packaging,
      estimatedCost: 110,
      attachedLineIds: ['line-cups-moa', 'line-lids-moa'],
      ...rest,
    }),
  ];
}

function planLines() {
  return [
    mkLine({
      id: 'line-matcha-north', itemId: ITEM.matcha, location: 'sm-north', qty: 1800, unit: 'g', estimatedCost: 4320,
      supplier: SUP.matcha, needQty: 1650, stockQty: 400, runoutDate: '2026-08-19',
      lastPaidRate: 2.4, lastPaidDate: '2026-08-08',
    }),
    mkLine({
      id: 'line-matcha-podium', itemId: ITEM.matcha, location: 'podium', qty: 2000, unit: 'g', estimatedCost: 4800,
      supplier: SUP.matcha, needQty: 1811, stockQty: 220, runoutDate: '2026-08-18',
      lastPaidRate: 2.4, lastPaidDate: '2026-08-08',
    }),
    mkLine({
      id: 'line-matcha-moa', itemId: ITEM.matcha, location: 'moa', qty: 1200, unit: 'g', estimatedCost: 2880,
      supplier: SUP.matcha, needQty: 1100, stockQty: 350, runoutDate: '2026-08-20',
      lastPaidRate: 2.4, lastPaidDate: '2026-08-08',
    }),
    mkLine({
      id: 'line-dairy-north', itemId: ITEM.dairy, location: 'sm-north', qty: 24, unit: 'L', estimatedCost: 4200,
      supplier: SUP.dairy, needQty: 22, stockQty: 8, runoutDate: '2026-08-20',
      lastPaidRate: 175, lastPaidDate: '2026-08-07',
    }),
    mkLine({
      id: 'line-dairy-podium', itemId: ITEM.dairy, location: 'podium', qty: 24, unit: 'L', estimatedCost: 4200,
      supplier: SUP.dairy, needQty: 20, stockQty: 6, runoutDate: '2026-08-19',
      lastPaidRate: 175, lastPaidDate: '2026-08-07',
    }),
    mkLine({
      id: 'line-dairy-moa', itemId: ITEM.dairy, location: 'moa', qty: 24, unit: 'L', estimatedCost: 4200,
      supplier: SUP.dairy, needQty: 20, stockQty: 10, runoutDate: '2026-08-22',
      lastPaidRate: 175, lastPaidDate: '2026-08-07',
    }),
    mkLine({
      id: 'line-oat-podium', itemId: ITEM.oat, location: 'podium', qty: 12, unit: 'L', estimatedCost: 3420,
      supplier: SUP.grocery, needQty: 10, stockQty: 4, runoutDate: '2026-08-21',
      lastPaidRate: 285, lastPaidDate: '2026-08-05',
    }),
    mkLine({
      id: 'line-oat-moa', itemId: ITEM.oat, location: 'moa', qty: 12, unit: 'L', estimatedCost: 3420,
      supplier: SUP.grocery, needQty: 8, stockQty: 5, runoutDate: '2026-08-21',
      lastPaidRate: 285, lastPaidDate: '2026-08-05',
    }),
    mkLine({
      id: 'line-oat-events', itemId: ITEM.oat, location: 'events', qty: 8, unit: 'L', estimatedCost: 2280,
      supplier: SUP.grocery, needQty: 6, stockQty: 2, runoutDate: '2026-08-22',
      lastPaidRate: 285, lastPaidDate: '2026-08-05',
    }),
    mkLine({
      id: 'line-cups-north', itemId: ITEM.icedCups, location: 'sm-north', qty: 1000, unit: 'pcs', estimatedCost: 1450,
      supplier: SUP.packaging, needQty: 950, stockQty: 80, runoutDate: '2026-08-18',
      lastPaidRate: 1.45, lastPaidDate: '2026-08-10',
    }),
    mkLine({
      id: 'line-cups-podium', itemId: ITEM.icedCups, location: 'podium', qty: 1200, unit: 'pcs', estimatedCost: 1740,
      supplier: SUP.packaging, needQty: 1100, stockQty: 120, runoutDate: '2026-08-18',
      lastPaidRate: 1.45, lastPaidDate: '2026-08-10',
    }),
    mkLine({
      id: 'line-cups-moa', itemId: ITEM.icedCups, location: 'moa', qty: 800, unit: 'pcs', estimatedCost: 1160,
      supplier: SUP.packaging, needQty: 750, stockQty: 90, runoutDate: '2026-08-19',
      lastPaidRate: 1.45, lastPaidDate: '2026-08-10',
    }),
    mkLine({
      id: 'line-cups-events', itemId: ITEM.icedCups, location: 'events', qty: 400, unit: 'pcs', estimatedCost: 580,
      supplier: SUP.packaging, needQty: 350, stockQty: 40, runoutDate: '2026-08-21',
      lastPaidRate: 1.45, lastPaidDate: '2026-08-10',
    }),
    mkLine({
      id: 'line-lids-north', itemId: ITEM.lids, location: 'sm-north', qty: 1200, unit: 'pcs', estimatedCost: 1680,
      supplier: SUP.packaging, needQty: 1150, stockQty: 60, runoutDate: '2026-08-18',
      lastPaidRate: 1.4, lastPaidDate: '2026-08-10',
    }),
    mkLine({
      id: 'line-lids-podium', itemId: ITEM.lids, location: 'podium', qty: 1300, unit: 'pcs', estimatedCost: 1820,
      supplier: SUP.packaging, needQty: 1250, stockQty: 80, runoutDate: '2026-08-18',
      lastPaidRate: 1.4, lastPaidDate: '2026-08-10',
    }),
    mkLine({
      id: 'line-cones-podium', itemId: ITEM.cones, location: 'podium', qty: 120, unit: 'pcs', estimatedCost: 960,
      supplier: SUP.packaging, needQty: null, stockQty: 0, runoutDate: '2026-08-17',
      lastPaidRate: 7.5, lastPaidDate: '2026-07-20', source: 'manual',
      lastCountedAt: '2026-08-14', countAgeDays: 4,
    }),
  ];
}

function applyThisWeekStates(lines) {
  const patch = {
    'line-cups-north': { onPlan: true, status: 'ordered', frozen: true },
    'line-lids-north': { onPlan: true, status: 'delivered', frozen: true },
    'line-cups-podium': {
      onPlan: true, status: 'delivered', frozen: true,
      linkedExpenseIds: ['exp-cups-podium'], actualCost: 1740,
    },
    'line-lids-podium': { onPlan: true, status: 'ordered', frozen: true },
    'line-cups-moa': { onPlan: true, status: 'delivered', frozen: true },
    'line-lids-moa': { onPlan: true, status: 'ordered', frozen: true },
    'line-matcha-north': { onPlan: true, status: 'planned' },
    'line-dairy-north': { onPlan: true, status: 'planned' },
  };
  return lines.map((l) => (patch[l.id] ? { ...l, ...patch[l.id] } : l));
}

function subtotal(lines) {
  return lines.filter((l) => l.onPlan).reduce((s, l) => s + l.estimatedCost, 0);
}

function offPlanSample() {
  return [
    {
      id: 'off-1',
      date: '2026-08-14',
      supplierName: 'Japan Home, Inc.',
      amount: 420,
      reason: 'Emergency napkins \u2014 ran out Saturday',
      location: 'podium',
    },
    {
      id: 'off-2',
      date: '2026-08-15',
      supplierName: "Arlene's Dairyhouse",
      amount: 350,
      reason: 'Extra milk pickup, not on the plan',
      location: 'sm-north',
    },
  ];
}

export function buildPastSeedWeeks() {
  lineCounter = 0;

  const sentLines = [
    ...planLines().map((l) => ({ ...l, onPlan: true, status: 'ordered', frozen: true })),
    ...packagingFees({ id: 'line-fee-sent', onPlan: true, status: 'ordered', frozen: true }),
  ];
  const sentSub = subtotal(sentLines);
  const weekSent = {
    id: 'week-sent',
    weekStart: '2026-08-10',
    weekEnd: '2026-08-16',
    status: 'ordered',
    settledAt: null,
    released: sentSub,
    spent: 0,
    returned: 0,
    buffer: 0,
    lines: sentLines,
    offPlanExpenses: [],
  };

  const settledLines = [
    ...planLines().map((l) => ({
      ...l,
      onPlan: true,
      status: 'delivered',
      frozen: true,
      linkedExpenseIds: [`exp-settled-${l.id}`],
      actualCost: l.estimatedCost,
    })),
    ...packagingFees({ id: 'line-fee-settled', onPlan: true, status: 'delivered', frozen: true }).map((f) => ({
      ...f,
      linkedExpenseIds: [`exp-settled-${f.id}`],
      actualCost: f.estimatedCost,
    })),
  ];
  const settledSub = subtotal(settledLines);
  const weekSettled = {
    id: 'week-settled',
    weekStart: '2026-08-03',
    weekEnd: '2026-08-09',
    status: 'settled',
    settledAt: '2026-08-10T09:30:00',
    released: settledSub,
    spent: settledSub - 240,
    returned: 240,
    buffer: 0,
    lines: settledLines,
    offPlanExpenses: offPlanSample(),
  };

  return [weekSent, weekSettled];
}

/** @deprecated use buildPastSeedWeeks \u2014 this week comes from Order View */
export function buildSeedWeeks() {
  return buildPastSeedWeeks();
}

export function getDefaultState() {
  return {
    version: 7,
    weeks: [],
  };
}
