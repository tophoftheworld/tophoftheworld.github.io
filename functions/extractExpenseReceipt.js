/**
 * Gemini receipt → expense field extraction for the expenses app.
 * Prefer high-capacity Flash-Lite; fall back to Flash if needed.
 * New API projects cannot use gemini-2.5-* models.
 */

const GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];
const GEMINI_MODEL = GEMINI_MODELS[0];

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw base64 payload cap
const MAX_ATTEMPTS_PER_MODEL = 3;

const STAFF_BUSY_MESSAGE =
  'Couldn’t read the receipt right now. Tap Auto-fill to try again.';
const STAFF_GENERIC_MESSAGE =
  'Couldn’t extract details from this receipt. You can fill the form manually.';

const CATEGORY_OPTIONS = [
  'Supplies',
  'Logistics',
  'Staff',
  'Rent & Utilities',
  'Marketing',
  'Equipment',
  'Operations'
];

function buildExtractionPrompt(todayIso) {
  const year = String(todayIso || '').slice(0, 4) || String(new Date().getFullYear());
  return `You extract structured fields from a Philippine business receipt, OR, or sales invoice photo for an expense form.

Today's date (upload context): ${todayIso || 'unknown'}. Current calendar year: ${year}.

Return JSON only matching the schema. Rules:
- Use null for unknown fields. Do not invent values.
- Dates as YYYY-MM-DD when possible (Philippine receipts often use MM/DD/YYYY or DD/MM/YYYY — prefer unambiguous ISO).
- YEAR RULE (critical): Receipts are uploaded daily for recent expenses (usually today / this week, almost always within the last ~3 months for quarterly VAT). The year is almost always ${year}. Prefer year ${year} whenever the printed year is blurry, ambiguous, truncated, or you are not 100% certain. Only use a different year if the full 4-digit year is clearly printed and unmistakably not ${year} (e.g. a crisp "2025" in early January for a December receipt). Never invent old years like 2020–2024 from OCR noise.
- Money as numbers in PHP (no currency symbols, no commas).
- supplierName: MERCHANT / store / company issuing the receipt (header name). NEVER use "SOLD TO" / customer / buyer name or TIN (e.g. if sold to Matchanese Inc., that is the customer — still extract the restaurant/hotel as supplier).
- businessName, tin (xxx-xxx-xxx-xxx), address: merchant fields when present (not SOLD TO).
- invoiceNumber: OR / SI / Invoice / Ref number when present.
- totalAmount: ALWAYS the receipt TOTAL DUE / amount paid / grand total (includes VAT + service charge + local tax).
- printedVat: copy printed "VATable Sales" / "VAT Amount (12%)" when shown; else nulls.
- DATE: use the transaction/OR date near the top. IGNORE permit lines like "Date Issued" / "Valid Until" on the footer.

VAT / non-VATable add-ons (critical for PH restaurant bills):
Many bills print: VATable Sales → VAT 12% → then Local Tax / Service Charge → TOTAL DUE.
Service charge and local tax are added AFTER VAT (outside the 12% base). On our form they go in vatExemptAmount even if the receipt's "VAT Exempt Sales" line is 0.00.
- vatExemptAmount = (printed VAT-exempt/zero-rated if any) + Service charge + Local tax + similar post-VAT add-ons.
- Do NOT put the 12% VAT amount itself into vatExemptAmount or into items.

Items rules:
1) Prefer clear line items with quantity + unit price when they reconcile to the merchandise/subtotal (within ~1 PHP).
2) If lines are unclear, broken, or do not reconcile → return items as [] and still set totalAmount to TOTAL DUE.
3) Restaurant / cafe / hotel / food-service receipts:
   - Do NOT itemize every dish/drink. Collapse food/beverage into one item: name "Meals".
   - Meals price/total MUST be VAT-INCLUSIVE food: VATable Sales + VAT Amount when both are printed (e.g. 6955.36 + 834.64 = 7790.00). Never set Meals to VATable-only net.
   - If SERVICE CHARGE is printed, add item "Service charge" (qty 1).
   - If LOCAL TAX is printed, add item "Local Tax" (qty 1).
   - Never add a separate "VAT" / "VAT Amount" line item.
   - totalAmount = TOTAL DUE. Items should sum to TOTAL DUE (Meals VAT-incl + Service charge + Local Tax).
   - vatExemptAmount = Service charge + Local Tax (+ any true VAT-exempt sales).
4) Skip payment lines, change, GCASH/cash tendered, and VAT summary lines as items (except using them for printedVat / Meals math).

Category suggestion (suggestedCategory) — pick exactly one of:
Supplies, Logistics, Staff, Rent & Utilities, Marketing, Equipment, Operations
Heuristics:
- Restaurant / cafe / meals / canteen → Staff
- Groceries / consumables / packaging / store goods → Supplies
- Lalamove / Grab / courier / delivery fee alone → Logistics
- Rent, electricity, water, internet → Rent & Utilities
- Ads / promo → Marketing
- Tools / equipment → Equipment
- Otherwise best fit; default Supplies if unsure.

suggestedAllocation (optional hint only): Store | General | Workshop | Popup | Bar Service
- Restaurant meals often General; do not invent event names.`;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplierName: { type: 'STRING', nullable: true },
    businessName: { type: 'STRING', nullable: true },
    tin: { type: 'STRING', nullable: true },
    address: { type: 'STRING', nullable: true },
    invoiceNumber: { type: 'STRING', nullable: true },
    date: { type: 'STRING', nullable: true },
    totalAmount: { type: 'NUMBER', nullable: true },
    vatExemptAmount: { type: 'NUMBER', nullable: true },
    suggestedCategory: { type: 'STRING', nullable: true },
    suggestedAllocation: { type: 'STRING', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'NUMBER', nullable: true },
          price: { type: 'NUMBER', nullable: true },
          total: { type: 'NUMBER', nullable: true }
        },
        required: ['name']
      }
    },
    printedVat: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        vatableSale: { type: 'NUMBER', nullable: true },
        vatAmount: { type: 'NUMBER', nullable: true }
      }
    }
  },
  required: ['items']
};

function stripDataUrl(base64OrDataUrl) {
  if (!base64OrDataUrl || typeof base64OrDataUrl !== 'string') return '';
  const m = base64OrDataUrl.match(
    /^data:(?:image\/[\w+.-]+|application\/pdf);base64,(.+)$/i
  );
  return (m ? m[1] : base64OrDataUrl).replace(/\s/g, '');
}

function detectMimeType(imageBase64, explicitMime) {
  const explicit = explicitMime ? String(explicitMime).toLowerCase() : '';
  if (explicit.startsWith('image/') || explicit === 'application/pdf') {
    return explicitMime;
  }
  if (typeof imageBase64 === 'string') {
    const m = imageBase64.match(/^data:(image\/[\w+.-]+|application\/pdf);base64,/i);
    if (m) return m[1];
  }
  return 'image/jpeg';
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeTin(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{3}-\d{3}-\d{3}-\d{3}$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 12) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return s;
}

function localTodayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetweenLocal(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

/**
 * Bias receipt years to current year. Staff upload daily; VAT lookback ~3 months.
 * Keep a non-current year only when it is previous year and still within lookback.
 * Clamp dates more than FUTURE_SLACK_DAYS in the future to today (stops Nov ghosts in Sep).
 */
function coerceReceiptDateYear(isoDate, now = new Date()) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
  const todayIso = localTodayIso(now);
  const currentYear = now.getFullYear();
  const [, mm, dd] = isoDate.split('-');
  const year = parseInt(isoDate.slice(0, 4), 10);

  const LOOKBACK_DAYS = 100; // ~3 months quarterly VAT window
  const FUTURE_SLACK_DAYS = 7;

  let result = isoDate;

  if (year !== currentYear) {
    let keepPrevious = false;
    // Allow previous-year date only if still recent (e.g. Dec receipt in early Jan).
    if (year === currentYear - 1) {
      const ageDays = daysBetweenLocal(isoDate, todayIso);
      if (ageDays >= 0 && ageDays <= LOOKBACK_DAYS) {
        keepPrevious = true;
      }
    }

    if (!keepPrevious) {
      // Default: force current year with same month/day.
      let forced = `${currentYear}-${mm}-${dd}`;
      const forcedFromToday = daysBetweenLocal(todayIso, forced);
      if (forcedFromToday > FUTURE_SLACK_DAYS) {
        // e.g. today Jan 5, OCR said 2024-12-20 → prefer previous-year Dec if in lookback
        const prev = `${currentYear - 1}-${mm}-${dd}`;
        const ageDays = daysBetweenLocal(prev, todayIso);
        if (ageDays >= 0 && ageDays <= LOOKBACK_DAYS) {
          forced = prev;
        }
      }
      result = forced;
    }
  }

  // Never keep a date more than a week in the future (permit / misread month).
  const fromToday = daysBetweenLocal(todayIso, result);
  if (fromToday > FUTURE_SLACK_DAYS) {
    return todayIso;
  }
  return result;
}

function normalizeDate(value, now = new Date()) {
  if (!value) return '';
  const s = String(value).trim();
  let iso = '';
  const isoMatch = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  } else {
    const slash = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
    if (slash) {
      const a = parseInt(slash[1], 10);
      const b = parseInt(slash[2], 10);
      const y = slash[3];
      // Prefer MM/DD when first part > 12 is impossible; else assume MDY common on PH OR printers.
      if (a > 12 && b <= 12) {
        iso = `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
      } else {
        iso = `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
      }
    }
  }
  return coerceReceiptDateYear(iso, now);
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item) => {
      const name = String(item?.name || '').trim();
      if (!name) return null;
      // Never keep VAT amount as a purchasable line item
      if (/^vat(\s|$|amount|12%)/i.test(name) || /^vat\s*amount/i.test(name)) return null;
      const quantity = toFiniteNumber(item.quantity);
      const price = toFiniteNumber(item.price);
      let total = toFiniteNumber(item.total);
      if (total == null && quantity != null && price != null) {
        total = Math.round(quantity * price * 100) / 100;
      }
      return {
        name,
        quantity: quantity != null && quantity > 0 ? quantity : 1,
        price: price != null && price >= 0 ? price : 0,
        total: total != null && total >= 0 ? total : 0
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function isPostVatAddOnName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return false;
  if (n.includes('service charge') || n === 'service ch' || n === 'servicecharge') return true;
  if (n.includes('local tax') || n.includes('local gov') || n === 'lgu tax') return true;
  return false;
}

function isMealsItemName(name) {
  const n = String(name || '').toLowerCase().trim();
  return n === 'meals' || n === 'meal' || n === 'food' || n === 'food & beverage' || n === 'f&b';
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Align restaurant totals: Meals = VATable+VAT; vatExempt = SC+Local Tax; total = TOTAL DUE.
 */
function reconcileRestaurantVat(items, totalAmount, vatExemptAmount, printedVat) {
  let nextItems = items.slice();
  let nextTotal = totalAmount;
  let nextExempt = vatExemptAmount;

  const addOnSum = roundMoney(
    nextItems.filter((i) => isPostVatAddOnName(i.name)).reduce((s, i) => s + (Number(i.total) || 0), 0)
  );
  if (addOnSum > 0) {
    nextExempt = Math.max(nextExempt, addOnSum);
  }

  const vatable = printedVat?.vatableSale;
  const vatAmt = printedVat?.vatAmount;
  if (vatable != null && vatAmt != null && vatable > 0 && vatAmt >= 0) {
    const mealsInclusive = roundMoney(vatable + vatAmt);
    const mealsIdx = nextItems.findIndex((i) => isMealsItemName(i.name));
    if (mealsIdx >= 0) {
      const cur = nextItems[mealsIdx];
      const curTotal = Number(cur.total) || 0;
      // Lift net VATable Meals (or any shortfall) up to VAT-inclusive food amount
      if (Math.abs(curTotal - vatable) <= 1.5 || curTotal + 1 < mealsInclusive) {
        nextItems[mealsIdx] = {
          ...cur,
          quantity: 1,
          price: mealsInclusive,
          total: mealsInclusive
        };
      }
    }

    const reconstructed = roundMoney(mealsInclusive + addOnSum);
    if (addOnSum > 0 && (nextTotal <= 0 || Math.abs(nextTotal - reconstructed) > 2)) {
      nextTotal = reconstructed;
    }
  }

  return { items: nextItems, totalAmount: nextTotal, vatExemptAmount: nextExempt };
}

function normalizeParsed(raw, now = new Date()) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const printed = data.printedVat && typeof data.printedVat === 'object' ? data.printedVat : {};
  let items = normalizeItems(data.items);
  let totalAmount = toFiniteNumber(data.totalAmount) ?? 0;
  let vatExemptAmount = toFiniteNumber(data.vatExemptAmount) ?? 0;
  const printedVat = {
    vatableSale: toFiniteNumber(printed.vatableSale),
    vatAmount: toFiniteNumber(printed.vatAmount)
  };

  const reconciled = reconcileRestaurantVat(items, totalAmount, vatExemptAmount, printedVat);
  items = reconciled.items;
  totalAmount = reconciled.totalAmount;
  vatExemptAmount = reconciled.vatExemptAmount;

  // If items don't reconcile to total (when both present), drop items and keep total only.
  if (items.length > 0 && totalAmount > 0) {
    const itemsSum = items.reduce((s, i) => s + (Number(i.total) || 0), 0);
    if (Math.abs(itemsSum - totalAmount) > 2) {
      const names = items.map((i) => i.name.toLowerCase());
      const isMealsPattern =
        names.some((n) => isMealsItemName(n)) &&
        names.some((n) => isPostVatAddOnName(n));
      if (!isMealsPattern) {
        items = [];
      }
    }
  }

  let suggestedCategory = String(data.suggestedCategory || '').trim();
  if (!CATEGORY_OPTIONS.includes(suggestedCategory)) {
    suggestedCategory = '';
  }
  let suggestedAllocation = String(data.suggestedAllocation || '').trim();
  const allocOk = ['Store', 'General', 'Workshop', 'Popup', 'Bar Service'];
  if (!allocOk.includes(suggestedAllocation)) suggestedAllocation = '';

  return {
    supplierName: String(data.supplierName || '').trim(),
    businessName: String(data.businessName || data.supplierName || '').trim(),
    tin: normalizeTin(data.tin),
    address: String(data.address || '').trim(),
    invoiceNumber: String(data.invoiceNumber || '').trim(),
    date: normalizeDate(data.date, now),
    totalAmount,
    vatExemptAmount,
    items,
    suggestedCategory,
    suggestedAllocation,
    printedVat
  };
}

function extractJsonText(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();
}

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

function buildRequestBody(raw, mime, now = new Date()) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildExtractionPrompt(localTodayIso(now)) },
          { inline_data: { mime_type: mime, data: raw } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }
    }
  };
}

async function callGeminiModel({ apiKey, model, raw, mime }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(raw, mime))
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

/**
 * @param {{ apiKey: string, imageBase64: string, mimeType?: string }} opts
 */
async function extractExpenseFieldsFromImage({ apiKey, imageBase64, mimeType }) {
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured');
    err.code = 'failed-precondition';
    throw err;
  }

  const raw = stripDataUrl(imageBase64);
  if (!raw || raw.length < 32) {
    const err = new Error('Receipt image is missing or empty');
    err.code = 'invalid-argument';
    throw err;
  }
  // base64 length ≈ 4/3 of bytes; reject oversized payloads
  if (raw.length > MAX_IMAGE_BYTES * 1.4) {
    const err = new Error('Receipt image is too large');
    err.code = 'invalid-argument';
    throw err;
  }

  const mime = detectMimeType(imageBase64, mimeType);
  let lastStaffError = null;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const { res, payload } = await callGeminiModel({ apiKey, model, raw, mime });
        if (!res.ok) {
          const rawMessage = payload?.error?.message || `Gemini request failed (${res.status})`;
          console.warn(`[extractExpenseReceipt] ${model} attempt ${attempt} failed:`, rawMessage);
          lastStaffError = toStaffError(rawMessage, res.status);
          if (isRetryableStatus(res.status) || isCapacityMessage(rawMessage)) {
            if (attempt < MAX_ATTEMPTS_PER_MODEL) {
              await sleep(400 * attempt * attempt);
              continue;
            }
            break; // try next model
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

        return normalizeParsed(parsed);
      } catch (error) {
        if (error?.staffFacing) throw error;
        console.warn(`[extractExpenseReceipt] ${model} attempt ${attempt} network error:`, error?.message);
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
  GEMINI_MODEL,
  GEMINI_MODELS,
  STAFF_BUSY_MESSAGE,
  STAFF_GENERIC_MESSAGE,
  extractExpenseFieldsFromImage,
  normalizeParsed,
  normalizeDate,
  coerceReceiptDateYear,
  stripDataUrl,
  detectMimeType,
  toStaffError
};
