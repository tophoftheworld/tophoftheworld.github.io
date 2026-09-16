/**
 * Gemini chat → structured invoice draft for the invoice-generator app.
 * Prefer Flash for structured chat; Lite remains a capacity fallback.
 * Reuses GEMINI_API_KEY from extractExpenseReceipt.
 */

const { GEMINI_MODELS: OCR_MODELS } = require('./extractExpenseReceipt');

/** Invoice chat: Flash first (better structured JSON), then Lite. */
const INVOICE_CHAT_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'].filter((m, i, arr) => {
  // Keep known OCR models as safety if names drift
  return arr.indexOf(m) === i;
});
// Ensure we still have something if OCR list is the only source of truth
const GEMINI_CHAT_MODELS =
  INVOICE_CHAT_MODELS.length > 0 ? INVOICE_CHAT_MODELS : [...OCR_MODELS].reverse();

const MAX_ATTEMPTS_PER_MODEL = 3;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 8000;
const MAX_INVOICE_JSON_CHARS = 20000;

const STAFF_BUSY_MESSAGE =
  'Couldn’t update the invoice right now. Try again in a moment.';
const STAFF_GENERIC_MESSAGE =
  'Couldn’t update the invoice from that message. Try rephrasing or edit manually.';

const EVENT_TYPES = ['mobile_bar', 'matcha_workshop', 'mochi_workshop'];
const PACKAGE_TYPES = ['starter', 'signature', 'special', ''];
const TRANSPORT_KEYS = ['none', 'laguna', 'bulacan', 'tagaytay', 'pampanga'];
const MILESTONE_ROLES = ['first', 'preEvent', 'final', ''];
const PAYMENT_STRUCTURES = ['three', 'two'];

const MATCHA_WORKSHOP_INCLUSIONS = [
  'Guided matcha workshop',
  'Use of all matcha tools during the session',
  'Two rounds of hands-on matcha making (one cup + one bottled drink to take home)',
  'Printed reference guides',
  'Sticker pack',
  'Mini tote bag',
  'Transportation within Metro Manila'
];

const MOBILE_BAR_SIGNATURE_DRINKS = ['Signature Matchanese Latte', 'Hojicha Latte'];

/** Choice-drink pool for mobile bar (aligned with Chatbase IG booking knowledge). */
const MOBILE_BAR_CHOICE_MENU = {
  pool: [
    'Strawberry Matchanese Latte',
    'Matchanese Seasalt Latte',
    'Spanish Matchanese Latte',
    'Matchanese Sunrise',
    'Matchanese Coconut',
    'Earl Grey Matchanese Latte',
    'Salted Caramel Matchanese Latte',
    'White Chocolate Matchanese Latte',
    'Blueberry Matchanese Latte',
    'Peach Mango Matchanese Latte'
  ],
  // Coffee swaps into a Choice slot (+₱3500 coffee add-on) — never extra slots
  coffee: [
    'Americano',
    'Kyoto Latte',
    'Spanish Latte',
    'Matchanese Espresso',
    'Seasalt Latte'
  ]
};

const MOBILE_BAR_SERVING_DEFAULT =
  'Iced (12oz) Drinks · Dairy or Oat Milk (choose one)';

const MOBILE_BAR_ADDITIONAL_OPTIONS_DEFAULT = [
  'Iced (12oz) Drinks',
  'Dairy or Oat Milk (choose one)'
];

const MILK_OAT_OPTIONS = ['Iced (12oz) Drinks', 'Oat Milk'];
const MILK_DAIRY_OPTIONS = ['Iced (12oz) Drinks', 'Dairy Milk'];
const MILK_DUAL_OPTIONS = ['Iced (12oz) Drinks', 'Dairy and Oat Milk'];
const DUAL_MILK_ADDON_FEE = 500;

/** Common misnames / legacy POS names → exact Chatbase catalog names. */
const CHOICE_DRINK_ALIASES = {
  'strawberry matchanese latte': 'Strawberry Matchanese Latte',
  'strawberry matcha latte': 'Strawberry Matchanese Latte',
  'strawberry matcha': 'Strawberry Matchanese Latte',
  'matchanese seasalt latte': 'Matchanese Seasalt Latte',
  'matcha seasalt latte': 'Matchanese Seasalt Latte',
  'matcha seasalt': 'Matchanese Seasalt Latte',
  'seasalt matcha': 'Matchanese Seasalt Latte',
  'seasalt latte': 'Matchanese Seasalt Latte',
  'sea salt latte': 'Matchanese Seasalt Latte',
  'spanish matchanese latte': 'Spanish Matchanese Latte',
  'matchanese sunrise': 'Matchanese Sunrise',
  'matchanese coconut': 'Matchanese Coconut',
  'earl grey matchanese latte': 'Earl Grey Matchanese Latte',
  'earl grey matcha': 'Earl Grey Matchanese Latte',
  'salted caramel matchanese latte': 'Salted Caramel Matchanese Latte',
  'salted caramel': 'Salted Caramel Matchanese Latte',
  'white chocolate matchanese latte': 'White Chocolate Matchanese Latte',
  'white chocolate': 'White Chocolate Matchanese Latte',
  'blueberry matchanese latte': 'Blueberry Matchanese Latte',
  'blueberry': 'Blueberry Matchanese Latte',
  'peach mango matchanese latte': 'Peach Mango Matchanese Latte',
  'peach mango': 'Peach Mango Matchanese Latte',
  'cafe americano': 'Americano',
  'americano': 'Americano',
  'kyoto latte': 'Kyoto Latte',
  'spanish latte': 'Spanish Matchanese Latte',
  'coffee spanish latte': 'Spanish Latte',
  'matchanese espresso': 'Matchanese Espresso',
  'espresso': 'Matchanese Espresso',
  'coffee seasalt latte': 'Seasalt Latte',
  'coffee seasalt': 'Seasalt Latte'
};

/** Fillable choice drinks only (base signatures excluded). */
function fillableChoiceCatalog(includeCoffee = true) {
  const list = [...MOBILE_BAR_CHOICE_MENU.pool];
  if (includeCoffee) list.push(...MOBILE_BAR_CHOICE_MENU.coffee);
  return list;
}

function allChoiceDrinkCatalog(includeCoffee = true) {
  return fillableChoiceCatalog(includeCoffee);
}

/** Bare "Matcha Latte" etc. = Signature Matchanese Latte base — never a Choice slot. */
function isBaseDrinkSynonym(key) {
  const k = String(key || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!k) return false;
  if (MOBILE_BAR_SIGNATURE_DRINKS.some((d) => d.toLowerCase() === k)) return true;
  return (
    k === 'matcha latte' ||
    k === 'matcha' ||
    k === 'signature matcha' ||
    k === 'signature matcha latte' ||
    k === 'signature matchanese' ||
    k === 'matchanese latte' ||
    k === 'hojicha' ||
    k === 'hojicha matcha'
  );
}

function normalizeChoiceDrinkName(name, { coffeeAddOn = false } = {}) {
  const t = String(name || '').trim();
  if (!t) return '';
  const key = t.toLowerCase().replace(/\s+/g, ' ');
  if (isBaseDrinkSynonym(key)) return '';
  if (
    coffeeAddOn &&
    (key === 'coffee seasalt latte' || key === 'coffee seasalt')
  ) {
    return 'Seasalt Latte';
  }
  if (coffeeAddOn && (key === 'coffee spanish latte' || key === 'spanish latte coffee')) {
    return 'Spanish Latte';
  }
  if (CHOICE_DRINK_ALIASES[key]) {
    const mapped = CHOICE_DRINK_ALIASES[key];
    if (mapped === 'Seasalt Latte' && !coffeeAddOn) return 'Matchanese Seasalt Latte';
    if (mapped === 'Spanish Latte' && key === 'spanish latte' && !coffeeAddOn) {
      return 'Spanish Matchanese Latte';
    }
    return mapped;
  }
  if (key === 'seasalt latte' || key === 'sea salt latte') {
    return 'Matchanese Seasalt Latte';
  }
  const catalog = fillableChoiceCatalog(true);
  const exact = catalog.find((d) => d.toLowerCase() === key);
  if (exact) {
    if (exact === 'Seasalt Latte' && !coffeeAddOn) return 'Matchanese Seasalt Latte';
    return exact;
  }
  const withoutLatte = key.replace(/\s+latte$/, '');
  const soft = catalog.find((d) => d.toLowerCase() === withoutLatte);
  if (soft) return soft;
  // Custom / off-menu request — keep text (still uses 1 choice slot)
  return t;
}

/**
 * Match a drink query against a choiceDrinks entry. Returns index or -1.
 * Matches raw text (so "Matcha Latte" still finds itself before normalize strips it).
 */
function findChoiceDrinkIndex(list, query, { coffeeAddOn = false } = {}) {
  const q = String(query || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!q) return -1;
  const arr = Array.isArray(list) ? list : [];
  const normalizedQ = normalizeChoiceDrinkName(query, { coffeeAddOn });
  for (let i = 0; i < arr.length; i++) {
    const raw = String(arr[i] || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) continue;
    if (raw === q) return i;
    if (isBaseDrinkSynonym(q) && isBaseDrinkSynonym(raw)) return i;
    if (normalizedQ) {
      const n = normalizeChoiceDrinkName(arr[i], { coffeeAddOn });
      if (n && n.toLowerCase() === normalizedQ.toLowerCase()) return i;
    }
    if (q.length >= 4 && (raw.includes(q) || q.includes(raw))) return i;
  }
  return -1;
}

/**
 * Apply remove/replace/add choice-drink edits from user text.
 * Handles "replace X with Y", "remove Matcha Latte", and plain adds.
 */
function applyChoiceDrinkEditsFromText(existing, userText, maxSlots, { coffeeAddOn = false } = {}) {
  const raw = String(userText || '');
  let list = Array.isArray(existing) ? existing.slice() : [];

  const removeQueries = [];
  const replaceRe =
    /\b(?:replace|swap)\s+(?:the\s+)?(?:duplicate\s+)?(.+?)\s+(?:with|for|to|wiht)\s+/gi;
  let m;
  while ((m = replaceRe.exec(raw)) !== null) {
    removeQueries.push(m[1].trim());
  }
  if (/\b(?:replace|swap)\s+(?:it|that|this|the\s+duplicate)\s+(?:with|for|to|wiht)\b/i.test(raw)) {
    if (list.some((d) => isBaseDrinkSynonym(String(d || '').toLowerCase().replace(/\s+/g, ' ')))) {
      removeQueries.push('Matcha Latte');
    }
  }
  const removeRe =
    /\b(?:remove|drop|delete|take\s+out)\s+(?:the\s+)?(?:duplicate\s+)?([A-Za-z][A-Za-z0-9 &'()-]*?)(?=\s+(?:and|from|please|on|in)|[.!?,]|$)/gi;
  while ((m = removeRe.exec(raw)) !== null) {
    removeQueries.push(m[1].trim());
  }
  if (/\b(?:remove|drop|delete)\s+(?:the\s+)?duplicate\b/i.test(raw)) {
    removeQueries.push('Matcha Latte');
  }

  for (const q of removeQueries) {
    let idx = findChoiceDrinkIndex(list, q, { coffeeAddOn });
    while (idx >= 0) {
      list.splice(idx, 1);
      idx = findChoiceDrinkIndex(list, q, { coffeeAddOn });
    }
    if (isBaseDrinkSynonym(q) || /matcha\s+latte/i.test(q)) {
      list = list.filter(
        (d) => !isBaseDrinkSynonym(String(d || '').toLowerCase().replace(/\s+/g, ' '))
      );
    }
  }

  const mentioned = extractChoiceDrinksFromText(raw, coffeeAddOn);
  return normalizeChoiceDrinksList([...list, ...mentioned], maxSlots, { coffeeAddOn });
}

function normalizeChoiceDrinksList(list, maxSlots, { coffeeAddOn = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = normalizeChoiceDrinkName(raw, { coffeeAddOn });
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  if (maxSlots != null && maxSlots >= 0) return out.slice(0, maxSlots);
  return out;
}

/**
 * Resolve packageType from user text.
 * Change/upgrade phrases win; complaint "still shows starter" does not select starter.
 */
function resolvePackageTypeFromText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;

  const changeRe =
    /\b(?:change|switch|upgrade|make(?:\s+it)?|use|set)(?:\s+(?:it|the\s+package|package|this))?\s+(?:from\s+\w+\s+)?(?:to\s+)?(starter|signature|special)\b/gi;
  let lastChange = null;
  let m;
  while ((m = changeRe.exec(raw)) !== null) {
    lastChange = m[1].toLowerCase();
  }
  if (lastChange) return lastChange;

  const toPkg = [
    ...raw.matchAll(/\bto\s+(?:the\s+)?(starter|signature|special)(?:\s+package)?\b/gi)
  ];
  if (toPkg.length) return toPkg[toPkg.length - 1][1].toLowerCase();

  // Complaints about what the doc shows — do not treat as a package selection
  if (
    /\b(still\s+shows?|still\s+say(?:s|ing)?|showing|displays?|on\s+the\s+(?:doc|invoice|preview))\b/i.test(
      raw
    ) &&
    /\b(starter|signature|special)\b/i.test(raw)
  ) {
    return null;
  }

  const found = [];
  if (/\bstarter\b/i.test(raw)) found.push('starter');
  if (/\bsignature\b/i.test(raw)) found.push('signature');
  if (/\bspecial\b/i.test(raw)) found.push('special');
  const unique = [...new Set(found)];
  if (unique.length === 1) return unique[0];
  return null;
}

function choiceSlotsForPackage(packageType) {
  if (packageType === 'signature') return 3;
  if (packageType === 'special') return 5;
  if (packageType === 'starter') return 1;
  return 1;
}

/** Find catalog drink names mentioned in user text (longest match first). */
function extractChoiceDrinksFromText(text, includeCoffee = true) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const coffeeAddOn = !!includeCoffee;
  const catalog = fillableChoiceCatalog(includeCoffee)
    .slice()
    .sort((a, b) => b.length - a.length);
  const found = [];
  const lower = raw.toLowerCase();
  const usedRanges = [];
  for (const drink of catalog) {
    // Skip coffee Seasalt Latte as substring of "Matcha Seasalt Latte" — match longer first already
    const idx = lower.indexOf(drink.toLowerCase());
    if (idx < 0) continue;
    const end = idx + drink.length;
    if (usedRanges.some(([s, e]) => idx < e && end > s)) continue;
    // Prefer Matcha Seasalt over coffee Seasalt Latte when both could match
    if (drink === 'Seasalt Latte' && lower.includes('matcha seasalt')) continue;
    usedRanges.push([idx, end]);
    found.push(normalizeChoiceDrinkName(drink, { coffeeAddOn }));
  }
  for (const [alias, canonical] of Object.entries(CHOICE_DRINK_ALIASES)) {
    if (!includeCoffee && MOBILE_BAR_CHOICE_MENU.coffee.includes(canonical)) continue;
    const idx = lower.indexOf(alias);
    if (idx < 0) continue;
    const end = idx + alias.length;
    if (usedRanges.some(([s, e]) => idx < e && end > s)) continue;
    usedRanges.push([idx, end]);
    const name = normalizeChoiceDrinkName(canonical, { coffeeAddOn });
    if (name && !found.includes(name)) found.push(name);
  }
  return found.filter(Boolean);
}

function buildDefaultMilestones(structure) {
  const now = Date.now();
  if (structure === 'two') {
    return [
      { id: now, role: 'first', milestone: 'Down Payment', date: '', percentage: 50, amount: 0, paid: false },
      { id: now + 1, role: 'final', milestone: 'Final Payment', date: '', percentage: 50, amount: 0, paid: false }
    ];
  }
  return [
    { id: now, role: 'first', milestone: 'Date Reservation', date: '', percentage: 25, amount: 0, paid: false },
    { id: now + 1, role: 'preEvent', milestone: 'Pre-Event', date: '', percentage: 25, amount: 0, paid: false },
    { id: now + 2, role: 'final', milestone: 'Event Completion', date: '', percentage: 50, amount: 0, paid: false }
  ];
}

function parseMilkOptionsFromText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  if (
    /\bdual\s+milk\b/i.test(raw) ||
    /\bboth\s+(dairy|oat)\b/i.test(raw) ||
    /\bdairy\s+and\s+oat\b/i.test(raw) ||
    /\boat\s+and\s+dairy\b/i.test(raw)
  ) {
    return [...MILK_DUAL_OPTIONS];
  }
  if (/\bdairy\s+or\s+oat\b/i.test(raw) || (/\b(choose\s+one|either)\b/i.test(raw) && /\b(dairy|oat)\b/i.test(raw))) {
    return [...MOBILE_BAR_ADDITIONAL_OPTIONS_DEFAULT];
  }
  if (/\boat\s*milk\b/i.test(raw) || (/\boat\b/i.test(raw) && /\b(milk|please)\b/i.test(raw))) {
    return [...MILK_OAT_OPTIONS];
  }
  if (/\bdairy\s*milk\b/i.test(raw) || (/\bdairy\b/i.test(raw) && /\bmilk\b/i.test(raw))) {
    return [...MILK_DAIRY_OPTIONS];
  }
  return null;
}

function isAddressSearchRequest(text) {
  const raw = String(text || '');
  return (
    /\b(search|look\s*up|find|google)\b/i.test(raw) &&
    /\baddress\b/i.test(raw)
  );
}

function isContaminatedAddress(value) {
  const s = String(value || '');
  if (!s.trim()) return false;
  const trimmed = s.trim();
  return (
    /\b(search|look\s*up|find|google|add\s+it\s+here|and\s+add\s+it)\b/i.test(s) ||
    /^of\s+/i.test(trimmed) ||
    s.length > 80 ||
    // Comparative / multi-package prose dumped into a place field
    /\b(while|whereas|workshop|matcha\s+bar|mobile\s+bar|for\s+the)\b/i.test(s) ||
    /\b(is|are)\s+(?:in|at|on)\b/i.test(s) ||
    /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
      s
    ) ||
    (trimmed.split(/\s+/).length > 6 && /\b(is|while|for|the)\b/i.test(s))
  );
}

function wantsThreeMilestones(text) {
  const raw = String(text || '');
  return (
    /\b(?:3|three)\s*[- ]?(?:payment\s+)?milestones?\b/i.test(raw) ||
    /\b(?:3|three)\s*payments?\b/i.test(raw) ||
    /\bpayment\s+(?:in\s+)?(?:3|three)\b/i.test(raw) ||
    /\bmake\s+the\s+payment\s+(?:3|three)\b/i.test(raw)
  );
}

function wantsTwoMilestones(text) {
  const raw = String(text || '');
  return (
    /\b(?:2|two)\s*[- ]?(?:payment\s+)?milestones?\b/i.test(raw) ||
    /\b(?:2|two)\s*payments?\b/i.test(raw)
  );
}

function wantsInvoiceDateNotEvent(text) {
  const raw = String(text || '');
  return /\binvoice\s+date\b/i.test(raw) || /\bdate\s+of\s+(?:the\s+)?invoice\b/i.test(raw);
}

function buildSystemPrompt(todayIso) {
  const poolList = MOBILE_BAR_CHOICE_MENU.pool.map((d) => `- ${d}`).join('\n  ');
  const coffeeList = MOBILE_BAR_CHOICE_MENU.coffee.map((d) => `- ${d}`).join('\n  ');

  return `You are the billing assistant for MATCHANESE, INC. invoice generator (internal tool).
Today's date (context): ${todayIso || 'unknown'}.
Domain knowledge MUST match the customer-facing Chatbase Mobile Matcha Bar booking rules below.

Return JSON only matching the schema:
- assistantMessage: 1) one short sentence confirming what you changed in the invoice JSON this turn (only fields you actually set), then 2) ask ONE high-value missing detail if any remain. When drinks change, also restate Choice slots filled vs remaining (e.g. "1 of 3 choice slots filled, 2 remain"). Do not dump a questionnaire. Do not list all standard inclusions unless asked.
- invoice: a PATCH — ONLY the fields you are changing this turn, and their new values. Never echo back unchanged fields.

PATCH RULES (critical):
- Omit every field you are not changing. Do NOT resend clientName, dates, venues, drinks, or packages that stay the same.
- invoiceItems: include ONLY the items you are changing, each with its "id" from CURRENT INVOICE plus the changed fields. Omit untouched items entirely.
- Adding a brand-new package: include the full new item (no id).
- Arrays you change (choiceDrinks, additionalOptions, workshopInclusions, customLineItems, paymentMilestones) must be the COMPLETE new array, not a fragment.
- Cup or guest count: send a single number field \`count\` (mobile bar minimum 100).
- Changing nothing (questions, confirmations, quoting the document): return invoice: {} with no invoiceItems. An empty patch is the correct answer when you are not editing.
- Put every change in the patch — never only in assistantMessage.

MULTI-PACKAGE (critical):
- Each invoiceItems[i] has its OWN eventVenue and eventDate.
- If the user describes two services with two places/dates, emit TWO items with distinct venues/dates. Do not collapse both into one field.
- eventVenue = short place name only (e.g. "Taguig", "The Annex, SM North EDSA"). NEVER put comparative sentences, "while…", package names, or dates inside eventVenue.

Missing-field asks: only ask for a field that is blank on the RELEVANT invoiceItems[i] (or top-level client fields) in CURRENT INVOICE / your output. Never ask for venue/date if the user just supplied them and you wrote them into the correct item(s). Do NOT keep asking for billed-to street address every turn — ask at most once, and skip it when the user is actively correcting package fields (cups, venue, drinks, package). Priority when truly blank: that item's eventVenue → eventDate → remaining Choice drinks → milk (Dairy OR Oat) → durationHours if not 3 → coffee add-on / transport → billed-to address (paste street; no web search) → TIN.
Never claim a field was updated unless it is in the patch this turn. If you say cups/venue changed, the patch must carry the new \`count\` and eventVenue values on the right item id.

You also receive DOCUMENT PREVIEW — quote it when asked what the invoice says. NEVER invent milk/menu wording.

═══════════════════════════════════════
SLOT SYSTEM (track for the whole conversation — never silently grow)
═══════════════════════════════════════
Every package has a FIXED total drink slot count:
- Starter = 3 total (2 Base + 1 Choice)
- Signature = 5 total (2 Base + 3 Choice)
- Special = 7 total (2 Base + 5 Choice)

Base slots (always, never removed/replaced/swapped — even if client wants a Hojicha variation):
  ${MOBILE_BAR_SIGNATURE_DRINKS.join(', ')}
A variation of a base drink is a NEW pick that uses a Choice slot; it does NOT replace the base.

Choice slots → store in choiceDrinks[] (length ≤ choice slots for packageType).
Each pool drink, coffee swap, OR custom/off-menu request uses exactly 1 Choice slot. Never slot-exempt.
NEVER put Base drinks or bare "Matcha Latte" / "Signature Matcha" in choiceDrinks[] — those ARE the Signature Matchanese Latte base, not a choice pick.
On remove/replace, return the COMPLETE new choiceDrinks[] array (authoritative full list), not a partial patch. Do not claim a drink was removed unless it is gone from choiceDrinks[].
When asked what drinks are already selected: list choiceDrinks[] by exact name, then note the two Base drinks separately. Do not answer with only "N of M slots".

If requested drinks would exceed Choice slots:
1) Offer next tier (Starter→Signature→Special) with price difference.
2) If they upgrade, continue filling remaining Choice slots — do not stop.
3) Fully customized quote only if count exceeds Special's 7 total slots OR they refuse upgrades.

═══════════════════════════════════════
DRINK POOL (Choice slots — exact names)
═══════════════════════════════════════
  ${poolList}

Coffee (requires coffeeAddOn +₱3500; each coffee pick still uses 1 Choice slot — never adds slots):
  ${coffeeList}
Phrase coffee as a swap into a choice slot. Bare "Seasalt Latte" → Matchanese Seasalt Latte (pool). Coffee seasalt → Seasalt Latte (coffee list). Spanish Latte without coffee → Spanish Matchanese Latte.

Custom/off-menu: acknowledge possible; final feasibility/pricing needs team confirmation; still 1 Choice slot. Same language for matcha or coffee customs.

Picks are locked at booking (not on event day). Write exact names into choiceDrinks[].

═══════════════════════════════════════
FIELD MAP
═══════════════════════════════════════
| User says | Field(s) | NEVER |
| Billed-to person/company | clientName only | address/venue/instructions |
| Billing street | clientAddress | search instructions |
| Event place for a package | that item's eventVenue (short place) | dumping multi-package prose; clientName |
| Event day for a package | that item's eventDate | invoiceDate unless they said invoice date |
| "invoice date" | invoiceDate | eventDate |
| Starter/Signature/Special | packageType = starter|signature|special | assistantMessage only |
| Cup or guest count | count (number; mobile bar min 100) | splitting into cups/numberOfPax/customCups |
| Choice drinks | choiceDrinks[] (full list on replace/remove) | inventing drinks; Base/"Matcha Latte" in choiceDrinks; exceeding slots without upgrade |
| oat / dairy milk | additionalOptions ["Iced (12oz) Drinks","Oat Milk"] or ["…","Dairy Milk"] | claiming oat while leaving choose-one text |
| dual milk / dairy and oat | additionalOptions ["Iced (12oz) Drinks","Dairy and Oat Milk"] + customLineItems Dual Milk Add-On ₱${DUAL_MILK_ADDON_FEE} | almond/soy unless asked (+₱${DUAL_MILK_ADDON_FEE}/type) |
| 3 milestones | paymentStructure "three", paymentTermsCustomized false, default milestones | inventing Down/Mid/Final 33/67 |
| coffee drink request | coffeeAddOn true + choiceDrinks entry | treating coffee as free / extra slot |
| Extra fees / branded cups / merch | customLineItems | hours of service text |

CRITICAL address: cannot web-search. Ask them to paste the street.

CRITICAL clientName: short proper name only; renames must update JSON; never whole-message dumps.

CRITICAL event type: mochi_workshop / matcha_workshop / mobile_bar. On a bar, "N pax" = cups. Min cups = 100.

Mobile Matcha Bar rates (JS recomputes package totals from packageType + count; leave unitPrice 0):
- When changing cups or guests, set \`count\` to the number (mobile bar minimum 100).
- Starter 100/150 = 29500/43500; Signature 32500/46750; Special 36000/52000
- Beyond 150: scale quietly — never present package tables or per-cup rates.
- coffeeAddOn → ₱3500. transportAddOn: none | laguna | bulacan (₱3000) | tagaytay | pampanga (₱5000). Metro Manila transport included.
- Default durationHours = 3. Ingress/egress fixed (JS). Do not list all inclusions unless asked.
- Standard inclusions (only if asked): Mobile Matcha Bar setup; trained baristas (min 3 for 100 cups, +1–2 per +50 cups); 3 hours service; 1h ingress + 1h egress; ingredients/cups/ice/supplies; MM transport.
- Default serving: ${MOBILE_BAR_SERVING_DEFAULT}. Lead with Dairy OR Oat only unless they ask for other milks.

Large events: may suggest longer hours, more baristas, or waves — pick what fits; don't list every option. Onsite cup extensions (sets of 10) are day-of charges — note only if relevant.

Payment: three = Date Reservation / Pre-Event / Event Completion (25/25/50). Prefer paymentTermsCustomized false.
You do not confirm bookings/payments — if they want to reserve/pay, say the team will reach out.

Workshops (matcha_workshop | mochi_workshop):
- count = guest/pax count; unitCost = per-person rate as a number string (required when the user gave a rate — never leave blank if known).
- Matcha default workshopInclusions:
  ${MATCHA_WORKSHOP_INCLUSIONS.map((x) => `- ${x}`).join('\n  ')}
- Mochi: workshopInclusions [] unless specified.

Custom line items: merch, dual milk fee, branded cups, quoted adjustments — NOT "Hours of Service" (use durationHours).`;
}

const PACKAGE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    id: { type: 'NUMBER', nullable: true },
    eventType: { type: 'STRING', nullable: true },
    eventVenue: { type: 'STRING', nullable: true },
    eventDate: { type: 'STRING', nullable: true },
    description: { type: 'STRING', nullable: true },
    count: { type: 'NUMBER', nullable: true },
    countLabel: { type: 'STRING', nullable: true },
    isWorkshop: { type: 'BOOLEAN', nullable: true },
    workshopInclusions: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' }
    },
    workshopDetails: { type: 'STRING', nullable: true },
    quantity: { type: 'NUMBER', nullable: true },
    unitCost: { type: 'STRING', nullable: true },
    packageType: { type: 'STRING', nullable: true },
    coffeeAddOn: { type: 'BOOLEAN', nullable: true },
    transportAddOn: { type: 'STRING', nullable: true },
    unitPrice: { type: 'NUMBER', nullable: true },
    durationHours: { type: 'NUMBER', nullable: true },
    choiceDrinks: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' }
    },
    menuItems: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' }
    },
    additionalOptions: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' }
    },
    otherInclusions: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' }
    },
    serviceWindow: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' }
    },
    baristas: { type: 'STRING', nullable: true }
  }
};

const CUSTOM_LINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    id: { type: 'NUMBER', nullable: true },
    name: { type: 'STRING', nullable: true },
    description: { type: 'STRING', nullable: true },
    quantity: { type: 'NUMBER', nullable: true },
    price: { type: 'NUMBER', nullable: true }
  }
};

const MILESTONE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    id: { type: 'NUMBER', nullable: true },
    role: { type: 'STRING', nullable: true },
    milestone: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true },
    percentage: { type: 'NUMBER', nullable: true },
    amount: { type: 'NUMBER', nullable: true },
    paid: { type: 'BOOLEAN', nullable: true }
  }
};

const INVOICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    invoiceNumber: { type: 'STRING', nullable: true },
    invoiceDate: { type: 'STRING', nullable: true },
    clientName: { type: 'STRING', nullable: true },
    clientAddress: { type: 'STRING', nullable: true },
    clientTIN: { type: 'STRING', nullable: true },
    notes: { type: 'STRING', nullable: true },
    invoiceItems: {
      type: 'ARRAY',
      nullable: true,
      items: PACKAGE_ITEM_SCHEMA
    },
    customLineItems: {
      type: 'ARRAY',
      nullable: true,
      items: CUSTOM_LINE_SCHEMA
    },
    paymentMilestones: {
      type: 'ARRAY',
      nullable: true,
      items: MILESTONE_SCHEMA
    },
    paymentStructure: { type: 'STRING', nullable: true },
    paymentTermsCustomized: { type: 'BOOLEAN', nullable: true }
  }
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    assistantMessage: { type: 'STRING' },
    invoice: INVOICE_SCHEMA
  },
  required: ['assistantMessage', 'invoice']
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 500;
}

function isCapacityMessage(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('high demand') ||
    m.includes('resource exhausted') ||
    m.includes('try again later') ||
    m.includes('unavailable') ||
    m.includes('overloaded') ||
    m.includes('capacity')
  );
}

function toStaffError(rawMessage, status) {
  if (status === 429 || status === 503 || isCapacityMessage(rawMessage)) {
    const err = new Error(STAFF_BUSY_MESSAGE);
    err.code = 'resource-exhausted';
    err.staffFacing = true;
    return err;
  }
  const err = new Error(STAFF_GENERIC_MESSAGE);
  err.code = 'internal';
  err.staffFacing = true;
  err.causeMessage = rawMessage;
  return err;
}

function extractJsonText(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();
}

function localTodayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeIsoDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  const isoMatch = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slash = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    const y = slash[3];
    if (a > 12 && b <= 12) {
      return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  return '';
}

function toFiniteNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function str(value) {
  return value == null ? '' : String(value).trim();
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => str(x)).filter(Boolean);
}

function normalizeTransport(value) {
  const key = str(value).toLowerCase().replace(/\s+/g, '_');
  if (key === 'laguna_bulacan') return 'laguna';
  if (key === 'tagaytay_pampanga') return 'tagaytay';
  if (TRANSPORT_KEYS.includes(key)) return key;
  return 'none';
}

function normalizeEventType(value, item) {
  const raw = str(value).toLowerCase();
  if (EVENT_TYPES.includes(raw)) return raw;
  const blob = `${raw} ${str(item?.description)} ${str(item?.eventVenue)}`;
  if (/mochi/.test(blob)) return 'mochi_workshop';
  if (/matcha\s*workshop|workshop/.test(blob) && !/mobile|bar|starter|signature|special/.test(blob)) {
    return 'matcha_workshop';
  }
  if (item?.isWorkshop === true) {
    return /mochi/i.test(blob) ? 'mochi_workshop' : 'matcha_workshop';
  }
  if (/mobile|bar|starter|signature|special/i.test(blob + str(item?.packageType))) {
    return 'mobile_bar';
  }
  return 'mobile_bar';
}

function normalizePackageType(value, eventType) {
  if (eventType !== 'mobile_bar') return '';
  const raw = str(value).toLowerCase();
  if (PACKAGE_TYPES.includes(raw) && raw) return raw;
  if (/starter/i.test(raw)) return 'starter';
  if (/signature/i.test(raw)) return 'signature';
  if (/special/i.test(raw)) return 'special';
  return '';
}

/**
 * Single source of truth for package headcount (cups or workshop guests).
 * Prefers `count`; falls back to legacy triad then digits in `cups`.
 */
function resolvePackageCount(item) {
  const n = parseInt(item?.count, 10);
  if (n > 0) return n;
  if (item?.numberOfPax === 'custom') return parseInt(item.customCups, 10) || 0;
  const nop = parseInt(item?.numberOfPax, 10);
  if (nop > 0) return nop;
  const m = String(item?.cups || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function normalizePackageItem(raw, index) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const eventType = normalizeEventType(item.eventType, item);
  const isWorkshop = eventType === 'matcha_workshop' || eventType === 'mochi_workshop';
  const packageType = normalizePackageType(item.packageType, eventType);
  const id = toNullableNumber(item.id) ?? Date.now() + index;

  const count = resolvePackageCount(item);

  let workshopInclusions = Array.isArray(item.workshopInclusions)
    ? stringList(item.workshopInclusions)
    : null;
  if (isWorkshop && workshopInclusions == null) {
    workshopInclusions =
      eventType === 'matcha_workshop' ? [...MATCHA_WORKSHOP_INCLUSIONS] : [];
  }

  const durationHoursRaw = toNullableNumber(item.durationHours);
  const durationHours =
    durationHoursRaw != null && durationHoursRaw > 0 ? durationHoursRaw : null;

  return {
    id,
    eventType,
    eventVenue: str(item.eventVenue),
    eventDate: normalizeIsoDate(item.eventDate) || str(item.eventDate),
    description: str(item.description),
    count,
    countLabel: isWorkshop ? 'participants' : 'cups',
    isWorkshop,
    workshopInclusions: workshopInclusions || [],
    workshopDetails: str(item.workshopDetails),
    quantity: toFiniteNumber(item.quantity, 0),
    unitCost: item.unitCost == null || item.unitCost === '' ? '' : String(item.unitCost),
    choiceDrinks: normalizeChoiceDrinksList(
      item.choiceDrinks,
      choiceSlotsForPackage(packageType),
      { coffeeAddOn: isWorkshop ? false : !!item.coffeeAddOn }
    ),
    // Client sync recomputes menu/duration/baristas from source fields.
    menuItems: stringList(item.menuItems),
    additionalOptions: (() => {
      const opts = stringList(item.additionalOptions);
      return opts.length ? opts : [...MOBILE_BAR_ADDITIONAL_OPTIONS_DEFAULT];
    })(),
    otherInclusions: stringList(item.otherInclusions),
    durationHours,
    duration: '',
    serviceWindow: stringList(item.serviceWindow),
    baristas: str(item.baristas),
    unitPrice: 0,
    packageType,
    coffeeAddOn: isWorkshop ? false : !!item.coffeeAddOn,
    transportAddOn: isWorkshop ? 'none' : normalizeTransport(item.transportAddOn)
  };
}

function normalizeCustomLine(raw, index) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const name = str(item.name);
  // Drop bogus "hours of service" custom lines — those belong in durationHours
  if (/\bhours?\s+of\s+service\b/i.test(name) && !toFiniteNumber(item.price, 0)) {
    return null;
  }
  return {
    id: toNullableNumber(item.id) ?? Date.now() + 1000 + index,
    name,
    description: str(item.description),
    quantity: toFiniteNumber(item.quantity, 1),
    price: toFiniteNumber(item.price, 0)
  };
}

function normalizeMilestone(raw, index) {
  const m = raw && typeof raw === 'object' ? raw : {};
  let role = str(m.role);
  if (!MILESTONE_ROLES.includes(role)) role = '';
  return {
    id: toNullableNumber(m.id) ?? Date.now() + 2000 + index,
    role,
    milestone: str(m.milestone) || 'Payment',
    date: normalizeIsoDate(m.date) || str(m.date),
    percentage: toFiniteNumber(m.percentage, 0),
    amount: toFiniteNumber(m.amount, 0),
    paid: !!m.paid
  };
}

function normalizeInvoice(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  let paymentStructure = str(data.paymentStructure).toLowerCase();
  if (!PAYMENT_STRUCTURES.includes(paymentStructure)) paymentStructure = 'three';

  let clientName = sanitizeCompoundClientName(str(data.clientName));
  if (isContaminatedClientName(clientName)) {
    clientName = cleanExtractedClientName(clientName) || '';
  }

  return {
    invoiceNumber: str(data.invoiceNumber),
    invoiceDate: normalizeIsoDate(data.invoiceDate) || str(data.invoiceDate),
    clientName,
    clientAddress: str(data.clientAddress),
    clientTIN: str(data.clientTIN),
    notes: str(data.notes),
    invoiceItems: Array.isArray(data.invoiceItems)
      ? data.invoiceItems.map((item, i) => normalizePackageItem(item, i))
      : [],
    customLineItems: Array.isArray(data.customLineItems)
      ? data.customLineItems.map((item, i) => normalizeCustomLine(item, i)).filter(Boolean)
      : [],
    paymentMilestones: Array.isArray(data.paymentMilestones)
      ? data.paymentMilestones.map((m, i) => normalizeMilestone(m, i))
      : [],
    paymentStructure,
    paymentTermsCustomized: !!data.paymentTermsCustomized
  };
}

function normalizeResponse(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    assistantMessage: str(data.assistantMessage) || 'Updated the invoice.',
    invoice: normalizeInvoice(data.invoice)
  };
}

function overlayInvoice(baseRaw, patchRaw) {
  const base = normalizeInvoice(baseRaw);
  const patch = normalizeInvoice(patchRaw);
  let paymentStructure = patch.paymentStructure || base.paymentStructure || 'three';
  if (paymentStructure !== 'two' && paymentStructure !== 'three') paymentStructure = 'three';

  const clientNameRaw = patch.clientName || base.clientName;
  const clientNameSanitized = sanitizeCompoundClientName(clientNameRaw);
  const clientName = isContaminatedClientName(clientNameSanitized)
    ? sanitizeCompoundClientName(base.clientName) || cleanExtractedClientName(clientNameSanitized) || ''
    : clientNameSanitized;

  return {
    invoiceNumber: patch.invoiceNumber || base.invoiceNumber,
    invoiceDate: patch.invoiceDate || base.invoiceDate,
    clientName: isContaminatedClientName(clientName) ? base.clientName : clientName,
    clientAddress: patch.clientAddress || base.clientAddress,
    clientTIN: patch.clientTIN || base.clientTIN,
    notes: patch.notes || base.notes,
    invoiceItems: mergePackageItemsFieldwise(base.invoiceItems, patch.invoiceItems),
    customLineItems: patch.customLineItems.length ? patch.customLineItems : base.customLineItems,
    paymentMilestones: patch.paymentMilestones.length
      ? patch.paymentMilestones
      : base.paymentMilestones,
    paymentStructure,
    paymentTermsCustomized:
      typeof patchRaw?.paymentTermsCustomized === 'boolean'
        ? patch.paymentTermsCustomized
        : base.paymentTermsCustomized
  };
}

function pickNonEmptyField(baseVal, patchVal) {
  if (patchVal == null) return baseVal;
  if (typeof patchVal === 'string') return patchVal.trim() ? patchVal : baseVal;
  if (typeof patchVal === 'number') return Number.isNaN(patchVal) ? baseVal : patchVal;
  if (typeof patchVal === 'boolean') return patchVal;
  if (Array.isArray(patchVal)) return patchVal.length ? patchVal : baseVal;
  return patchVal || baseVal;
}

/** Field-level merge so sparse Gemini package rows cannot wipe filled values. */
function mergePackageItemsFieldwise(baseItems, patchItems) {
  const base = Array.isArray(baseItems) ? baseItems : [];
  const patch = Array.isArray(patchItems) ? patchItems : [];
  if (!patch.length) return base;
  if (!base.length) return patch.map((item, i) => normalizePackageItem(item, i));

  const used = new Set();
  const merged = patch.map((incoming, i) => {
    let cur = null;
    if (incoming?.id != null) {
      const byId = base.findIndex((b) => b && b.id === incoming.id);
      if (byId >= 0) {
        cur = base[byId];
        used.add(byId);
      }
    }
    if (!cur && i < base.length && !used.has(i)) {
      cur = base[i];
      used.add(i);
    }
    if (!cur) return normalizePackageItem(incoming, i);
    const out = { ...cur };
    const keys = new Set([...Object.keys(cur), ...Object.keys(incoming || {})]);
    keys.forEach((key) => {
      if (key === 'id') {
        out.id = incoming.id != null ? incoming.id : cur.id;
        return;
      }
      if (key === 'count' || key === 'cups' || key === 'numberOfPax' || key === 'customCups') return;
      out[key] = pickNonEmptyField(cur[key], incoming[key]);
    });
    const patchCount = parseInt(incoming?.count, 10);
    if (patchCount > 0) {
      out.count = patchCount;
    } else {
      const legacyPatch = resolvePackageCount({
        count: 0,
        numberOfPax: incoming?.numberOfPax,
        customCups: incoming?.customCups,
        cups: incoming?.cups
      });
      out.count = legacyPatch > 0 ? legacyPatch : resolvePackageCount(cur);
    }
    delete out.cups;
    delete out.numberOfPax;
    delete out.customCups;
    return normalizePackageItem(out, i);
  });

  if (patch.length < base.length) {
    for (let i = 0; i < base.length; i++) {
      if (!used.has(i)) merged.push(base[i]);
    }
  }
  return merged;
}

/**
 * Apply one raw patch item onto a base item. Presence in the patch is the intent:
 * keys the model omitted are left alone, so schema defaults cannot clobber the form.
 */
function hasKey(obj, key) {
  return !!obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function applyPackageItemPatch(baseItem, rawPatchItem, index) {
  const cur = baseItem && typeof baseItem === 'object' ? baseItem : {};
  const p = rawPatchItem && typeof rawPatchItem === 'object' ? rawPatchItem : {};
  const merged = { ...cur };

  Object.keys(p).forEach((key) => {
    if (key === 'id' || key === 'count' || key === 'cups' || key === 'numberOfPax' || key === 'customCups') {
      return;
    }
    merged[key] = pickNonEmptyField(cur[key], p[key]);
  });

  const patchCount = parseInt(p.count, 10);
  if (patchCount > 0) {
    merged.count = patchCount;
  } else if (hasKey(p, 'cups') || hasKey(p, 'numberOfPax') || hasKey(p, 'customCups')) {
    const legacy = resolvePackageCount(p);
    if (legacy > 0) merged.count = legacy;
  } else {
    merged.count = resolvePackageCount(cur);
  }
  delete merged.cups;
  delete merged.numberOfPax;
  delete merged.customCups;

  merged.id = cur.id != null ? cur.id : toNullableNumber(p.id);
  return normalizePackageItem(merged, index);
}


/** Patch only the items the model touched (match by id, else position); keep the rest. */
function applyPackageItemPatches(baseItems, rawPatchItems) {
  const base = Array.isArray(baseItems) ? baseItems : [];
  const patches = Array.isArray(rawPatchItems) ? rawPatchItems : [];
  if (!patches.length) return base;

  const out = base.map((item) => ({ ...item }));
  const used = new Set();
  const added = [];

  patches.forEach((rawItem, i) => {
    const p = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const pid = toNullableNumber(p.id);
    let idx = -1;
    if (pid != null) {
      idx = out.findIndex((b, bi) => b && b.id === pid && !used.has(bi));
    } else if (i < out.length && !used.has(i)) {
      idx = i;
    }
    if (idx < 0) {
      added.push(normalizePackageItem(p, base.length + added.length));
      return;
    }
    used.add(idx);
    out[idx] = applyPackageItemPatch(out[idx], p, idx);
  });

  return [...out, ...added];
}

/**
 * Apply Gemini's patch (changed fields only) onto the current invoice.
 * Unlike overlayInvoice, this never normalizes the patch first — normalizing a
 * sparse patch would fill defaults (transport "none", default milk options,
 * coffeeAddOn false) that would overwrite good values the model never touched.
 */
function applyGeminiPatch(baseRaw, rawPatch) {
  const base = normalizeInvoice(baseRaw);
  const patch = rawPatch && typeof rawPatch === 'object' ? rawPatch : {};
  const out = { ...base };

  ['invoiceNumber', 'clientAddress', 'clientTIN', 'notes'].forEach((key) => {
    if (hasKey(patch, key)) out[key] = pickNonEmptyField(base[key], str(patch[key]));
  });

  if (hasKey(patch, 'invoiceDate')) {
    const date = normalizeIsoDate(patch.invoiceDate) || str(patch.invoiceDate);
    out.invoiceDate = pickNonEmptyField(base.invoiceDate, date);
  }

  if (hasKey(patch, 'clientName')) {
    const sanitized = sanitizeCompoundClientName(str(patch.clientName));
    const name = isContaminatedClientName(sanitized)
      ? cleanExtractedClientName(sanitized) || ''
      : sanitized;
    out.clientName = pickNonEmptyField(base.clientName, name);
  }

  if (hasKey(patch, 'paymentStructure')) {
    const structure = str(patch.paymentStructure).toLowerCase();
    if (PAYMENT_STRUCTURES.includes(structure)) out.paymentStructure = structure;
  }
  if (typeof patch.paymentTermsCustomized === 'boolean') {
    out.paymentTermsCustomized = patch.paymentTermsCustomized;
  }

  if (Array.isArray(patch.customLineItems) && patch.customLineItems.length) {
    out.customLineItems = patch.customLineItems
      .map((line, i) => normalizeCustomLine(line, i))
      .filter(Boolean);
  }
  if (Array.isArray(patch.paymentMilestones) && patch.paymentMilestones.length) {
    out.paymentMilestones = patch.paymentMilestones.map((m, i) => normalizeMilestone(m, i));
  }
  if (Array.isArray(patch.invoiceItems) && patch.invoiceItems.length) {
    out.invoiceItems = applyPackageItemPatches(base.invoiceItems, patch.invoiceItems);
  }

  return normalizeInvoice(out);
}

function titleCaseName(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^[A-Z0-9.&'-]+$/.test(w) && w.length <= 4) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function clipNameCandidate(name) {
  let t = String(name || '').trim();
  if (!t) return '';
  t = t.split(/[,|\n]/)[0].trim();
  t = t.replace(/'s\b.*$/i, '').trim();
  // Clause split: "Bea Boldo and set the event…" → "Bea Boldo"
  t = sanitizeCompoundClientName(t);
  // Strip trailing headcount before generic stop-words (avoids "Catherine Dee 20")
  t = t.replace(/\s+\d{1,4}\s*[- ]?(?:cups?|pax|guests?|participants?).*$/i, '');
  t = t.replace(
    /\s+\b(?:for|with|at|in|on|address|venue|package|starter|signature|special|mobile|matcha|workshop|cups?|pax|guests?|participants?|hours?)\b[\s\S]*$/i,
    ''
  );
  t = t.replace(/\s+\d{1,4}\s*$/g, '').trim();
  return t.trim();
}

/**
 * Drop instruction clauses glued with "and" (not a venue dictionary).
 * "Bea Boldo And Set The Event" → "Bea Boldo"
 */
function sanitizeCompoundClientName(name) {
  let t = String(name || '').trim();
  if (!t) return '';
  const m = t.match(
    /^(.+?)\s+and\s+(set|make|change|update|book|add|put|create|schedule)\b[\s\S]*$/i
  );
  if (m) return m[1].trim();
  return t;
}

function isCompoundClauseClientName(name) {
  return /\band\s+(set|make|change|update|book|add|put|create|schedule)\b/i.test(String(name || ''));
}

function cleanExtractedClientName(name) {
  let cleaned = clipNameCandidate(name).replace(/[.!?]+$/g, '').trim();
  cleaned = cleaned
    .replace(/^(?:the\s+)?(?:client(?:\s+name)?|name|company)\s+(?:is\s+|:?\s*)/i, '')
    .trim();
  cleaned = cleaned.replace(/\s+(please|thanks|thank you)$/i, '').trim();
  if (!cleaned) return '';
  if (/^(the|a|an|me|us|this|that|my|our|them|it|its|it's|how|about|starter|signature|special)$/i.test(cleaned)) return '';
  if (/^\d+$/.test(cleaned)) return '';
  if (cleaned.length < 2 || cleaned.length > 60) return '';
  if (
    /\b(pax|cups?|address|package|starter|signature|special|invoice|update|please|hours?|service|workshop|how about)\b/i.test(
      cleaned
    )
  ) {
    return '';
  }
  if (isCompoundClauseClientName(cleaned)) return '';
  return titleCaseName(cleaned);
}

function isContaminatedClientName(name) {
  const s = String(name || '');
  if (!s) return false;
  if (s.length > 48) return true;
  if (isCompoundClauseClientName(s)) return true;
  return /\b(pax|cups?|address|package|starter|signature|special|for\s+\d|invoice|update|hours?|service|workshop|how about|please)\b/i.test(
    s
  );
}

/** True when the user clearly renames the billed-to party (must overwrite form/Gemini). */
function isExplicitRenameIntent(text) {
  const raw = str(text);
  if (!raw) return false;
  return (
    /\b(?:just\s+)?(?:make|set)\s+it\s+(?:to\s+)?/i.test(raw) ||
    /\b(?:rename(?:\s+client)?(?:\s+to)?|change\s+(?:the\s+)?(?:client\s+)?name\s+to|set\s+(?:the\s+)?(?:client\s+)?name\s+to)\b/i.test(
      raw
    ) ||
    /\bchange\s+(?:it|this|that|the\s+name)\s+to\b/i.test(raw)
  );
}

/** Only explicit name phrases — never treat a whole sentence as a name. */
function extractClientNameFromText(text) {
  const raw = str(text);
  if (!raw) return '';
  const patterns = [
    /\b(?:write\s+(?:the\s+)?invoice\s+to|make\s+(?:me\s+)?(?:an?\s+)?invoice\s+for|invoice\s+(?:for|to)|billed\s+to)\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
    /\bbill(?:\s+\w+){0,3}\s+to\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
    /\b(?:client(?:\s+name)?|name|company)\s*(?:is|:|=)\s*(.+?)(?=\s+and\s+|[.!?]|$)/i,
    /\bit'?s\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})$/i,
    /\b(?:rename(?:\s+client)?(?:\s+to)?|change\s+(?:the\s+)?(?:client\s+)?name\s+to|set\s+(?:the\s+)?(?:client\s+)?name\s+to)\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
    /\bchange\s+(?:it|this|that|the\s+name)\s+to\s+(.+?)(?=\s+and\s+|[.!?]|$)/i,
    // After invoice-for patterns so "make me an invoice for X" wins over "make it"
    /\b(?:just\s+)?(?:make|set)\s+it\s+(?:to\s+)?(.+?)(?=\s+and\s+|[.!?]|$)/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const name = cleanExtractedClientName(m[1]);
    if (name) return name;
  }
  return '';
}

function extractClientNameFromAssistantText(text) {
  const raw = str(text);
  if (!raw) return '';
  const patterns = [
    /\b(?:client(?:\s+name)?|billed\s+to|name)\s+(?:to|as|:)\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i,
    /\bupdated\s+(?:the\s+)?(?:client(?:\s+name)?|name)\s+to\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i,
    /\bset\s+(?:the\s+)?(?:client(?:\s+name)?|name)\s+to\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i,
    /\binvoice\s+for\s+([A-Za-z][A-Za-z0-9 .,'&-]{1,60})/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const name = cleanExtractedClientName(m[1]);
    if (name) return name;
  }
  return '';
}

const MONTH_NAME_TO_NUM = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

function parseLooseEventDate(text, fallbackYear) {
  const raw = String(text || '');
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const slash = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    const y = parseInt(slash[3], 10);
    let month;
    let day;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const named = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i
  );
  if (named) {
    const month = MONTH_NAME_TO_NUM[named[1].toLowerCase().replace(/\.$/, '')];
    const day = parseInt(named[2], 10);
    const year = named[3] ? parseInt(named[3], 10) : fallbackYear || new Date().getFullYear();
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return '';
}

function parseUnitCostHint(text) {
  const raw = String(text || '');
  const patterns = [
    /@\s*₱?\s*([\d,]+(?:\.\d+)?)\b/i,
    /\b(?:at|of)\s*₱?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*(?:pax|person|participant|head))?/i,
    /₱\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*(?:pax|person|participant|head))?/i,
    /\b([\d,]+(?:\.\d+)?)\s*(?:php|pesos?)?\s*per\s*(?:pax|person|participant|head)\b/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const n = parseFloat(String(m[1]).replace(/,/g, ''));
    if (n > 0 && n < 1000000) return String(n);
  }
  return '';
}

/**
 * Parse structured hints from user text for fallback enrichment.
 * Splits billed-to city vs event venue; detects workshops vs mobile bar.
 */
function parseInvoiceHintsFromText(...texts) {
  const raw = texts.filter(Boolean).join('\n');
  if (!raw.trim()) return {};

  const hints = {};

  if (/\bmochi\b/i.test(raw) && /\bworkshop\b/i.test(raw)) {
    hints.eventType = 'mochi_workshop';
  } else if (/\bmatcha\b/i.test(raw) && /\bworkshop\b/i.test(raw)) {
    hints.eventType = 'matcha_workshop';
  } else if (/\b(mobile\s+(?:matcha\s+)?bar|matcha\s+bar)\b/i.test(raw)) {
    hints.eventType = 'mobile_bar';
  } else if (/\b(starter|signature|special)\b/i.test(raw) && /\b(cups?|bar)\b/i.test(raw)) {
    hints.eventType = 'mobile_bar';
  }

  const addrIn = raw.match(
    /\baddress\s*(?:is\s*)?(?:in|at|:)?\s*([A-Za-z][A-Za-z0-9 .'-]*?)(?=\s+(?:mochi|matcha|mobile|workshop|package|starter|for\s+\d)|[,.]|$)/i
  );
  if (addrIn && !isAddressSearchRequest(raw)) {
    const place = titleCaseName(addrIn[1].trim());
    if (place && place.length <= 40 && !isContaminatedAddress(place)) {
      hints.clientAddress = place;
      hints.eventVenue = place;
    }
  }

  // Never treat "search for the address of X and add it here" as a place
  if (isAddressSearchRequest(raw)) {
    delete hints.clientAddress;
    // Keep genuine venue if set elsewhere; only clear if it looks contaminated
  }

  const venueOnly = raw.match(/\b(?:venue|location)\s*(?:is\s*)?(?:in|at|:)?\s*([^,.\n@]+)/i);
  if (venueOnly && !hints.eventVenue && !isAddressSearchRequest(raw)) {
    const place = titleCaseName(venueOnly[1].trim().slice(0, 80));
    if (!isContaminatedAddress(place)) hints.eventVenue = place;
  }

  if (!hints.eventVenue && !isAddressSearchRequest(raw)) {
    const cityAt = raw.match(/,\s*([A-Za-z][A-Za-z .'-]{1,40}?)\s*(?:@|at\s*₱|at\s*\d)/i);
    if (cityAt) hints.eventVenue = titleCaseName(cityAt[1].trim());
  }
  if (!hints.eventVenue && !isAddressSearchRequest(raw)) {
    const inCity = raw.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:on|at|@|,|\d)|$)/i);
    if (inCity && !/\b(the|a|an|our|my)\b/i.test(inCity[1])) {
      hints.eventVenue = titleCaseName(inCity[1].trim());
    }
  }

  const resolvedPkg = resolvePackageTypeFromText(raw);
  if (resolvedPkg) hints.packageType = resolvedPkg;

  const cupsMatch =
    raw.match(/\b(\d{2,4})\s*[- ]?(?:cup|cups)\b/i) ||
    raw.match(/\b(\d{2,4})-cup\b/i) ||
    raw.match(/\b(?:cup|cups)\s*[:=]?\s*(\d{2,4})\b/i);
  if (cupsMatch) {
    const n = parseInt(cupsMatch[1], 10);
    if (n >= 50 && n <= 500) {
      hints.cups = n;
    }
  }

  const paxMatch =
    raw.match(/\b(\d{1,4})\s*[- ]?(?:pax|guests|participants?)\b/i) ||
    raw.match(/\b(?:pax|guests|participants?)\s*[:=]?\s*(\d{1,4})\b/i);
  if (paxMatch) {
    const n = parseInt(paxMatch[1], 10);
    if (n >= 1 && n <= 500) hints.pax = n;
  }

  const hoursMatch = raw.match(/\b(\d{1,2})\s*hours?\s+(?:of\s+)?service\b/i);
  if (hoursMatch) {
    const h = parseInt(hoursMatch[1], 10);
    if (h >= 1 && h <= 24) hints.durationHours = h;
  }

  const unitCost = parseUnitCostHint(raw);
  if (unitCost) hints.unitCost = unitCost;

  const looseDate = parseLooseEventDate(raw);
  if (looseDate) {
    if (wantsInvoiceDateNotEvent(raw)) {
      hints.invoiceDate = looseDate;
    } else {
      hints.eventDate = looseDate;
    }
  }

  const milkOpts = parseMilkOptionsFromText(raw);
  if (milkOpts) hints.additionalOptions = milkOpts;

  if (wantsThreeMilestones(raw)) {
    hints.paymentStructure = 'three';
    hints.paymentTermsCustomized = false;
    hints.forceDefaultMilestones = true;
  } else if (wantsTwoMilestones(raw)) {
    hints.paymentStructure = 'two';
    hints.paymentTermsCustomized = false;
    hints.forceDefaultMilestones = true;
  }

  if (/\bcoffee\s+add[- ]?on\b/i.test(raw) || /\bwith\s+coffee\b/i.test(raw)) {
    hints.coffeeAddOn = true;
  }

  if (/\blaguna\b/i.test(raw)) hints.transportAddOn = 'laguna';
  else if (/\bbulacan\b/i.test(raw)) hints.transportAddOn = 'bulacan';
  else if (/\btagaytay\b/i.test(raw)) hints.transportAddOn = 'tagaytay';
  else if (/\bpampanga\b/i.test(raw)) hints.transportAddOn = 'pampanga';

  normalizeBarPaxToCups(hints);
  return hints;
}

/** Domain rule: on a matcha/mobile bar, "N pax" means cups (not workshop participants). */
function normalizeBarPaxToCups(hints) {
  if (!hints || typeof hints !== 'object') return hints;
  const isWorkshop =
    hints.eventType === 'matcha_workshop' || hints.eventType === 'mochi_workshop';
  if (isWorkshop) return hints;
  const isBar = hints.eventType === 'mobile_bar' || !!hints.packageType;
  if (isBar && hints.pax && !hints.cups) {
    hints.cups = hints.pax;
  }
  return hints;
}

function applyHintsToInvoice(invoice, _hints, _messages) {
  // AI path must never invent invoice fields from user-text regex.
  // Kept as a no-op for older tests that still import the name.
  return ensureDualMilkAddOn(scrubInvalidInvoiceFields(normalizeInvoice(invoice)));
}

/** Scrub invalid AI-emitted place/address values (does not re-parse user chat). */
function scrubInvalidInvoiceFields(invoice) {
  const out = normalizeInvoice(invoice);
  if (isContaminatedAddress(out.clientAddress)) out.clientAddress = '';
  out.invoiceItems = out.invoiceItems.map((it) => {
    if (!it) return it;
    const next = { ...it };
    if (isContaminatedAddress(next.eventVenue)) next.eventVenue = '';
    return next;
  });
  out.customLineItems = out.customLineItems.filter(
    (line) => !/\bhours?\s+of\s+service\b/i.test(line?.name || '')
  );
  return out;
}

/** Ensure Dual Milk Add-On line exists when package options include dairy and oat. */
function ensureDualMilkAddOn(invoice) {
  const out = normalizeInvoice(invoice);
  const hasDual = out.invoiceItems.some(
    (item) =>
      !item.isWorkshop &&
      Array.isArray(item.additionalOptions) &&
      item.additionalOptions.some((o) => /dairy\s+and\s+oat/i.test(String(o || '')))
  );
  if (!hasDual) return out;
  const lines = [...out.customLineItems];
  const idx = lines.findIndex((l) => /dual\s+milk/i.test(String(l.name || '')));
  if (idx < 0) {
    lines.push({
      id: Date.now() + 500,
      name: 'Dual Milk Add-On',
      description: 'Dairy and Oat Milk',
      quantity: 1,
      price: DUAL_MILK_ADDON_FEE
    });
  } else if (!toFiniteNumber(lines[idx].price, 0)) {
    lines[idx] = { ...lines[idx], price: DUAL_MILK_ADDON_FEE };
  }
  out.customLineItems = lines;
  return out;
}

/**
 * @deprecated User-text hint enrichment is disabled. Prefer Gemini JSON + scrubInvalidInvoiceFields.
 * Kept as a no-op wrapper for older tests that still import the name.
 */
function enrichInvoiceFromMessages(invoice, _messages, _assistantMessage = '') {
  return ensureDualMilkAddOn(scrubInvalidInvoiceFields(invoice));
}

/** Gemini's patch exactly as emitted — no defaults, no normalization. For debug/audit. */
function rawGeminiPatch(raw) {
  const patch = raw && typeof raw === 'object' ? raw.invoice : null;
  if (!patch || typeof patch !== 'object') return {};
  return patch;
}

function finalizeChatResult(raw, currentInvoice, _messages) {
  const normalized = normalizeResponse(raw);
  const patch = rawGeminiPatch(raw);
  let invoice = applyGeminiPatch(currentInvoice, patch);
  invoice = scrubInvalidInvoiceFields(invoice);
  invoice = ensureDualMilkAddOn(invoice);
  return {
    assistantMessage: normalized.assistantMessage,
    // geminiPatch = literal model output (changed fields only). invoice = after patch apply/scrub.
    geminiPatch: patch,
    invoice
  };
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const role = m?.role === 'assistant' ? 'assistant' : 'user';
      let content = str(m?.content);
      if (content.length > MAX_MESSAGE_CHARS) {
        content = content.slice(0, MAX_MESSAGE_CHARS);
      }
      return { role, content };
    })
    .filter((m) => m.content);
}

/** Slim source fields for the prompt (not preview-computed strings). */
function slimInvoiceForPrompt(invoice) {
  const full = normalizeInvoice(invoice);
  return {
    invoiceNumber: full.invoiceNumber,
    invoiceDate: full.invoiceDate,
    clientName: full.clientName,
    clientAddress: full.clientAddress,
    clientTIN: full.clientTIN,
    notes: full.notes,
    invoiceItems: full.invoiceItems.map((item) => ({
      id: item.id,
      eventType: item.eventType,
      eventVenue: item.eventVenue,
      eventDate: item.eventDate,
      packageType: item.packageType,
      count: resolvePackageCount(item) || undefined,
      coffeeAddOn: item.coffeeAddOn,
      transportAddOn: item.transportAddOn,
      durationHours: item.durationHours,
      choiceDrinks: item.choiceDrinks,
      additionalOptions: item.additionalOptions,
      unitCost: item.unitCost,
      workshopInclusions: item.workshopInclusions,
      workshopDetails: item.workshopDetails,
      otherInclusions: item.otherInclusions,
      isWorkshop: item.isWorkshop
    })),
    customLineItems: full.customLineItems,
    paymentMilestones: full.paymentMilestones,
    paymentStructure: full.paymentStructure,
    paymentTermsCustomized: full.paymentTermsCustomized
  };
}

function sanitizeDocumentPreview(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (t.length > 12000) t = t.slice(0, 12000);
  return t;
}

function sanitizeCurrentInvoice(invoice) {
  const slim = slimInvoiceForPrompt(invoice);
  let json = JSON.stringify(slim);
  if (json.length > MAX_INVOICE_JSON_CHARS) {
    json = json.slice(0, MAX_INVOICE_JSON_CHARS);
  }
  return json;
}

function buildRequestBody({ messages, currentInvoice, documentPreview = '', now = new Date() }) {
  const todayIso = localTodayIso(now);
  const systemText = buildSystemPrompt(todayIso);
  const invoiceJson = sanitizeCurrentInvoice(currentInvoice);
  const previewText = sanitizeDocumentPreview(documentPreview);
  const sanitized = sanitizeMessages(messages);

  let contextBlock =
    `CURRENT INVOICE JSON (editable source fields):\n${invoiceJson}\n\n`;
  if (previewText) {
    contextBlock +=
      `DOCUMENT PREVIEW (read-only display text — may lag; quote only when asked what the doc says; NEVER copy cup/venue values from here into invoice JSON — edit CURRENT INVOICE JSON fields):\n${previewText}\n\n`;
  }
  contextBlock +=
    'Apply the following conversation. Return invoice as a PATCH: only changed fields, and for invoiceItems only the changed items (each with its id from CURRENT INVOICE). Return invoice: {} when nothing changes. Each invoiceItems[i] has its own eventVenue/eventDate. packageType and choiceDrinks must appear in the patch when the user changes package or picks drinks.';

  const contents = [
    {
      role: 'user',
      parts: [{ text: contextBlock }]
    }
  ];

  for (let i = 0; i < sanitized.length; i++) {
    const msg = sanitized[i];
    let text = msg.content;
    if (msg.role === 'user' && i === sanitized.length - 1) {
      text +=
        '\n\n(Reminder: invoice = PATCH of changed fields only, invoiceItems entries carry their id; invoice: {} if nothing changes. clientName = short person/company only. Venue → eventVenue. Hours → durationHours. Cups/guests → count. Package upgrade → packageType. Named drinks → choiceDrinks[]. Milk/serving → additionalOptions[] or quote DOCUMENT PREVIEW. Workshop → eventType matcha_workshop|mochi_workshop.)';
    }
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }]
    });
  }

  if (!sanitized.length || sanitized[sanitized.length - 1].role !== 'user') {
    contents.push({
      role: 'user',
      parts: [{ text: 'Please return the updated invoice JSON for the current state.' }]
    });
  }

  return {
    systemInstruction: {
      parts: [{ text: systemText }]
    },
    contents,
    generationConfig: {
      temperature: 0.1,
      // JSON mode only — fat responseSchema made Flash invent unitCost/inclusions
      // and omit sparse patch fields like count (verified by direct A/B).
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
}

/** Flatten the Gemini request body into readable text for staff debug UI. */
function formatPromptPreview(body) {
  const parts = [];
  const systemText = body?.systemInstruction?.parts?.[0]?.text;
  if (systemText) {
    parts.push('=== SYSTEM ===');
    parts.push(String(systemText));
  }
  const contents = Array.isArray(body?.contents) ? body.contents : [];
  contents.forEach((entry, i) => {
    const role = String(entry?.role || 'user').toUpperCase();
    const text = Array.isArray(entry?.parts)
      ? entry.parts.map((p) => String(p?.text || '')).join('\n')
      : '';
    parts.push('');
    parts.push(`=== ${role} [${i}] ===`);
    parts.push(text);
  });
  return parts.join('\n');
}

async function callGeminiModel({ apiKey, model, body }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

async function generateInvoiceFromChat({ apiKey, messages, currentInvoice, documentPreview }) {
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.code = 'failed-precondition';
    throw err;
  }

  const sanitized = sanitizeMessages(messages);
  if (!sanitized.length) {
    const err = new Error('At least one chat message is required');
    err.code = 'invalid-argument';
    throw err;
  }

  const body = buildRequestBody({
    messages: sanitized,
    currentInvoice: currentInvoice || {},
    documentPreview: documentPreview || ''
  });

  let lastStaffError = null;

  for (const model of GEMINI_CHAT_MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const { res, payload } = await callGeminiModel({ apiKey, model, body });
        if (!res.ok) {
          const rawMessage = payload?.error?.message || `Gemini request failed (${res.status})`;
          console.warn(`[generateInvoiceFromChat] ${model} attempt ${attempt} failed:`, rawMessage);
          lastStaffError = toStaffError(rawMessage, res.status);
          if (isRetryableStatus(res.status) || isCapacityMessage(rawMessage)) {
            if (attempt < MAX_ATTEMPTS_PER_MODEL) {
              await sleep(400 * attempt * attempt);
              continue;
            }
            break;
          }
          throw lastStaffError;
        }

        const text = extractJsonText(payload);
        if (!text) {
          lastStaffError = toStaffError('empty response', 500);
          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(400 * attempt * attempt);
            continue;
          }
          break;
        }

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          lastStaffError = toStaffError('invalid JSON', 500);
          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(400 * attempt * attempt);
            continue;
          }
          break;
        }

        return {
          ...finalizeChatResult(parsed, currentInvoice || {}, sanitized),
          promptPreview: formatPromptPreview(body)
        };
      } catch (error) {
        if (error?.staffFacing) throw error;
        console.warn(`[generateInvoiceFromChat] ${model} attempt ${attempt} network error:`, error?.message);
        lastStaffError = toStaffError(error?.message || 'network error', 503);
        if (attempt < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(400 * attempt * attempt);
          continue;
        }
        break;
      }
    }
  }

  throw lastStaffError || toStaffError('all models failed', 503);
}

module.exports = {
  MATCHA_WORKSHOP_INCLUSIONS,
  MOBILE_BAR_CHOICE_MENU,
  MOBILE_BAR_SIGNATURE_DRINKS,
  MOBILE_BAR_SERVING_DEFAULT,
  MOBILE_BAR_ADDITIONAL_OPTIONS_DEFAULT,
  MILK_OAT_OPTIONS,
  MILK_DAIRY_OPTIONS,
  MILK_DUAL_OPTIONS,
  DUAL_MILK_ADDON_FEE,
  CHOICE_DRINK_ALIASES,
  GEMINI_CHAT_MODELS,
  RESPONSE_SCHEMA,
  STAFF_BUSY_MESSAGE,
  STAFF_GENERIC_MESSAGE,
  buildSystemPrompt,
  buildRequestBody,
  formatPromptPreview,
  sanitizeMessages,
  normalizeInvoice,
  normalizePackageItem,
  normalizeCustomLine,
  normalizeMilestone,
  normalizeResponse,
  overlayInvoice,
  applyGeminiPatch,
  mergePackageItemsFieldwise,
  extractClientNameFromText,
  extractClientNameFromAssistantText,
  isExplicitRenameIntent,
  sanitizeCompoundClientName,
  parseInvoiceHintsFromText,
  normalizeChoiceDrinkName,
  normalizeChoiceDrinksList,
  applyChoiceDrinkEditsFromText,
  isBaseDrinkSynonym,
  extractChoiceDrinksFromText,
  resolvePackageTypeFromText,
  parseMilkOptionsFromText,
  isAddressSearchRequest,
  ensureDualMilkAddOn,
  isContaminatedAddress,
  wantsThreeMilestones,
  wantsTwoMilestones,
  buildDefaultMilestones,
  normalizeBarPaxToCups,
  parseLooseEventDate,
  parseUnitCostHint,
  applyHintsToInvoice,
  enrichInvoiceFromMessages,
  scrubInvalidInvoiceFields,
  finalizeChatResult,
  slimInvoiceForPrompt,
  resolvePackageCount,
  isContaminatedClientName,
  normalizeIsoDate,
  generateInvoiceFromChat
};
