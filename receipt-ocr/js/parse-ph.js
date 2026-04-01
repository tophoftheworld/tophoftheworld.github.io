/**
 * Heuristic Philippine receipt / OR parsing from plain OCR text.
 */

const TIN_RE = /\b(\d{3}-\d{3}-\d{3}-\d{3,4})\b/g;

/**
 * Extract peso numbers: 1,234.56, ₱1,234.56, or thermal style 38.80- (discount after number).
 */
export function parseMoney(str) {
  if (!str) return null;
  let s = String(str).trim();
  const trailingMinus = s.match(/^([\d,]+\.?\d*)\s*-\s*([A-Za-z]*)?$/);
  if (trailingMinus) {
    const n = parseFloat(trailingMinus[1].replace(/,/g, ''));
    return Number.isFinite(n) ? -n : null;
  }
  const cleaned = s
    .replace(/[₱PHPphp\s]/gi, '')
    .replace(/,/g, '')
    .match(/-?\d+\.?\d*/);
  if (!cleaned) return null;
  const n = parseFloat(cleaned[0]);
  return Number.isFinite(n) ? n : null;
}

/** Positive xxx.xx amounts on a line (tax tables, totals). */
function moneyAmountsOnLine(line) {
  return (line.match(/[\d,]+\.\d{2}/g) || [])
    .map((m) => parseFloat(m.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

export function extractTin(text) {
  const matches = text.matchAll(TIN_RE);
  const found = [];
  for (const m of matches) {
    if (m[1]) found.push(m[1]);
  }
  return found[0] || '';
}

export function extractInvoiceNumber(text) {
  const lines = text.split(/\r?\n/);
  const patterns = [
    /SALES\s*INVOICE\s*NUMBER\s*[:\s#]*([A-Z0-9\-]+)/i,
    /(?:TR\s*NO\.?|TRANSACTION\s*NO\.?)\s*[:\s#]*([A-Z0-9\-]+)/i,
    /(?:OR|SI)\s*[#No.:\s]*([A-Z0-9\-\/]+)/i,
    /(?:Invoice|Inv\.?)\s*[#No.:\s]*([A-Z0-9\-\/]+)/i,
    /(?:Official\s*Receipt)\s*(?:No\.?)?\s*[#:]\s*([A-Z0-9\-\/]+)/i,
  ];

  for (const line of lines) {
    for (const p of patterns) {
      const m = line.match(p);
      if (m && m[1] && m[1].length >= 2) {
        const v = m[1].trim();
        if (!/^(gas|cash|php|vat)$/i.test(v)) return v;
      }
    }
  }
  const ref = text.match(/\bRef\.?\s*[:\s#]*(\d{6,})\b/i);
  if (ref) return ref[1];
  return '';
}

/**
 * @returns {string} ISO yyyy-mm-dd or ''
 */
export function extractDate(text) {
  const s = text.replace(/\s+/g, ' ');

  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (dmy) {
    const mm = dmy[1].padStart(2, '0');
    const dd = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }

  const mmm = s.match(
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/,
  );
  if (mmm) {
    const yy = parseInt(mmm[3], 10);
    const year = yy < 70 ? 2000 + yy : 1900 + yy;
    const mm = mmm[1].padStart(2, '0');
    const dd = mmm[2].padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  const monthNames =
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s*(20\d{2})/i;
  const mon = s.match(monthNames);
  if (mon) {
    const mi = [
      'january','february','march','april','may','june',
      'july','august','september','october','november','december',
    ].indexOf(mon[1].toLowerCase()) + 1;
    if (mi > 0) {
      const mm = String(mi).padStart(2, '0');
      const dd = mon[2].padStart(2, '0');
      return `${mon[3]}-${mm}-${dd}`;
    }
  }

  return '';
}

/**
 * Guess vendor name from first non-empty lines (skip common headers).
 */
export function extractSupplierName(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const skip =
    /^(tin|vat|or|si|invoice|date|time|cashier|thank\s*you|sales|pos|machine|min|tid|store|tr\s*no|brgy|barangay|the\s+podium|telephone|bir|ptu)/i;
  const looksLikeAddress =
    /^(brgy|barangay|\d+\s).*(city|manila|cebu|davao)/i;

  for (const line of lines.slice(0, 15)) {
    if (line.length < 4 || line.length > 100) continue;
    if (skip.test(line)) continue;
    if (looksLikeAddress.test(line)) continue;
    if (/^[\d\s\/\.\-]+$/.test(line)) continue;
    if (/^\d+\/\d+$/.test(line)) continue;
    if (/^vat\s*reg/i.test(line)) continue;
    if (/^\d{3}-\d{3}-\d{3}-\d{3}/.test(line)) continue;
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) continue;
    return line;
  }

  const caps = lines.find(
    (l) =>
      l.length >= 4 &&
      l.length < 60 &&
      /[A-Z]{3,}/.test(l) &&
      !skip.test(l)
  );
  return caps || lines[0] || '';
}

export function extractTotalAmount(text) {
  const lines = text.split(/\r?\n/);
  const scored = [];

  const pushScore = (value, weight) => {
    if (value != null && value > 0 && value < 1e9) {
      scored.push({ value, weight });
    }
  };

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/sub\s*total|subtotal|change\s*due|balance\s*due/i.test(line)) {
      continue;
    }
    if (/\btotal\s+items\b|\bitems\s+purchased\b/i.test(line)) {
      continue;
    }

    const totalLabel =
      /\bTOTAL\s*[:\s]+\s*([\d,]+\.?\d*)\b/i.exec(line) ||
      /^\s*TOTAL\s+([\d,]+\.?\d*)\s*$/i.exec(line);
    if (totalLabel && !/sub/i.test(line)) {
      pushScore(parseMoney(totalLabel[1]), 100);
    }

    const payLine = line.match(
      /\b(?:GCASH|CASH|CARD|DEBIT|CREDIT|PAYMAYA)\s+PAYMENT\s+([\d,]+\.?\d*)\b/i,
    );
    if (payLine) {
      pushScore(parseMoney(payLine[1]), 95);
    }

    if (/\bvatable\b/i.test(line)) {
      const amounts = moneyAmountsOnLine(line).filter((n) => n > 0);
      if (amounts.length >= 1) {
        pushScore(amounts[amounts.length - 1], 88);
      }
    }

    if (/\bgross\b/i.test(lower) && /net|vat|grp/.test(lower)) {
      const amounts = moneyAmountsOnLine(line).filter((n) => n > 0);
      if (amounts.length) pushScore(amounts[amounts.length - 1], 82);
    }
  }

  const keywords =
    /total\s*amount|amount\s*due|grand\s*total|total\s*sales|total\s*payable|amount\s*payable/i;
  for (const line of lines) {
    if (keywords.test(line)) {
      const nums = line.match(/[\d,]+\.\d{2}/g) || line.match(/[\d,]+\.?\d*/g);
      if (nums) {
        const v = parseMoney(nums[nums.length - 1]);
        pushScore(v, 75);
      }
    }
  }

  const looseTotal = text.match(
    /\bTOTAL\b[^\d\n]{0,24}([\d,]+\.\d{2})\b/i,
  );
  if (looseTotal) {
    pushScore(parseMoney(looseTotal[1]), 70);
  }

  if (!scored.length) {
    const fallback = text.match(
      /(?:grand\s*total|total\s*amount|amount\s*due)[^\d]*([\d,]+\.?\d*)/i,
    );
    if (fallback) pushScore(parseMoney(fallback[1]), 50);
  }

  if (!scored.length) return null;

  scored.sort((a, b) => b.weight - a.weight || b.value - a.value);
  return scored[0].value;
}

/**
 * Extract printed VAT-related amounts from OCR.
 */
export function extractPrintedVatFigures(text) {
  const lines = text.split(/\r?\n/);
  let vatableSale = null;
  let vatAmount = null;
  let taxableAmount = null;
  let vatExemptAmount = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/\bvatable\b/i.test(line)) {
      const nums = line.match(/[\d,]+\.\d{2}/g);
      if (nums && nums.length >= 3) {
        vatableSale = parseMoney(nums[0]);
        vatAmount = parseMoney(nums[1]);
      } else if (nums && nums.length === 2) {
        vatableSale = parseMoney(nums[0]);
        vatAmount = parseMoney(nums[1]);
      } else {
        const num = parseMoney(line.match(/[\d,]+\.?\d*/)?.[0] || line);
        if (num != null) vatableSale = num;
      }
    }

    const num = parseMoney(line.match(/[\d,]+\.?\d*/)?.[0] || line);

    if (/vatable\s*sale|sale\s*subject\s*to\s*vat/.test(lower) && num != null && vatableSale == null) {
      vatableSale = num;
    }
    if (/vat\s*(?:12|12%|amount)/.test(lower) && num != null && vatAmount == null) {
      vatAmount = num;
    }
    if (/taxable\s*amount|taxable\s*sale/.test(lower) && num != null) {
      taxableAmount = num;
    }
    if (/vat\s*exempt|zero[\s-]*rated|exempt\s*sale/.test(lower) && num != null) {
      vatExemptAmount = num;
    }
  }

  return {
    vatableSale,
    vatAmount,
    taxableAmount,
    vatExemptAmount,
    totalAmount: extractTotalAmount(text),
  };
}

/**
 * @returns {{ name: string, quantity: number, price: number, total: number }[]}
 */
export function extractLineItems(text) {
  const items = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const lineRe = /^(.+?)\s+(\d+(?:\.\d+)?)\s+@?\s*([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(lineRe);
    if (m) {
      const qty = parseFloat(m[2]) || 1;
      const price = parseMoney(m[3]);
      const total = parseMoney(m[4]);
      if (price != null && total != null) {
        items.push({
          name: m[1].trim().slice(0, 120),
          quantity: qty,
          price,
          total,
        });
      }
      continue;
    }

    const ace = line.match(
      /^\s*(\d{12,})\s+([\d,]+\.?\d*)\s*([A-Z]{0,3})\s*$/i,
    );
    if (ace) {
      const price = parseMoney(ace[2]);
      const desc = (lines[i + 1] && !/^\d{12,}/.test(lines[i + 1])
        ? lines[i + 1]
        : `Item ${items.length + 1}`
      ).slice(0, 120);
      if (price != null) {
        items.push({
          name: desc,
          quantity: 1,
          price,
          total: price,
        });
      }
    }
  }

  return items.slice(0, 30);
}

/**
 * Full parse for UI + expense JSON.
 */
export function parseReceiptText(text) {
  const tin = extractTin(text);
  const invoiceNumber = extractInvoiceNumber(text);
  const date = extractDate(text);
  const supplierName = extractSupplierName(text);
  const totalAmount = extractTotalAmount(text);
  const printedVat = extractPrintedVatFigures(text);
  const items = extractLineItems(text);

  const itemsOut =
    items.length > 0
      ? items
      : totalAmount != null
        ? [
            {
              name: 'Receipt total (line items not parsed)',
              quantity: 1,
              price: totalAmount,
              total: totalAmount,
            },
          ]
        : [];

  return {
    supplierName,
    businessName: '',
    tin,
    address: '',
    invoiceNumber,
    date,
    items: itemsOut,
    totalAmount: totalAmount ?? 0,
    vatExemptAmount: printedVat.vatExemptAmount ?? 0,
    vatComputationEnabled: true,
    printedVat,
    rawText: text,
  };
}
