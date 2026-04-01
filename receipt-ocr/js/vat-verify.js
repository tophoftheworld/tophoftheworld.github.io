/**
 * VAT math aligned with expenses/js/shared.js (calculateVatBreakdown).
 * Used only for verification vs printed OCR amounts — not for expense save logic.
 */

export function calculateVatBreakdown(totalAmount, vatExemptAmount = 0, isVatRegistered = false) {
  const total = Number(totalAmount) || 0;
  const exempt = Number(vatExemptAmount) || 0;

  if (!isVatRegistered || total <= 0) {
    return {
      totalAmount: total,
      vatExemptAmount: 0,
      taxableAmount: 0,
      vatableSale: 0,
      vatAmount: 0,
      isVatRegistered: false,
    };
  }

  const taxableAmount = total - exempt;
  const vatableSale = taxableAmount / 1.12;
  const vatAmount = taxableAmount - vatableSale;

  return {
    totalAmount: total,
    vatExemptAmount: exempt,
    taxableAmount,
    vatableSale,
    vatAmount,
    isVatRegistered: true,
  };
}

/**
 * @param {object} printed
 * @param {number|null} [printed.vatableSale]
 * @param {number|null} [printed.vatAmount]
 * @param {number|null} [printed.taxableAmount]
 * @param {number|null} [printed.totalAmount]
 */
export function verifyVatAgainstPrinted(
  totalAmount,
  vatExemptAmount,
  isVatRegistered,
  printed
) {
  const expected = calculateVatBreakdown(totalAmount, vatExemptAmount, isVatRegistered);

  const toleranceAbs = 0.5;
  const tolerancePct = 0.01;

  const within = (a, b) => {
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return null;
    const diff = Math.abs(a - b);
    const pctOk = Math.abs(b) > 0 ? diff / Math.abs(b) <= tolerancePct : diff <= toleranceAbs;
    return diff <= toleranceAbs || pctOk;
  };

  const checks = [];

  if (printed?.vatableSale != null && expected.isVatRegistered) {
    const ok = within(printed.vatableSale, expected.vatableSale);
    checks.push({
      label: 'Vatable sale',
      printed: printed.vatableSale,
      expected: expected.vatableSale,
      ok,
    });
  }

  if (printed?.vatAmount != null && expected.isVatRegistered) {
    const ok = within(printed.vatAmount, expected.vatAmount);
    checks.push({
      label: 'VAT (12%)',
      printed: printed.vatAmount,
      expected: expected.vatAmount,
      ok,
    });
  }

  if (printed?.taxableAmount != null && expected.isVatRegistered) {
    const ok = within(printed.taxableAmount, expected.taxableAmount);
    checks.push({
      label: 'Taxable amount',
      printed: printed.taxableAmount,
      expected: expected.taxableAmount,
      ok,
    });
  }

  if (printed?.totalAmount != null) {
    const ok = within(printed.totalAmount, expected.totalAmount);
    checks.push({
      label: 'Total',
      printed: printed.totalAmount,
      expected: expected.totalAmount,
      ok,
    });
  }

  const evaluated = checks.filter((c) => c.ok !== null);
  const allOk = evaluated.length ? evaluated.every((c) => c.ok) : null;
  const anyFail = evaluated.some((c) => c.ok === false);

  let overall = 'insufficient';
  if (evaluated.length) {
    if (anyFail) overall = 'mismatch';
    else if (allOk) overall = 'ok';
  }

  return {
    expected,
    checks,
    overall,
  };
}
