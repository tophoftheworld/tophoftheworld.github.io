/**
 * Replenishment forecast — pure date/qty math, no Firebase.
 * Inventory Order View (and later Purchasing) call this with different coverage windows.
 */

export const DEFAULT_LEAD_TIME_DAYS = 1;
export const DEFAULT_BUFFER_PCT = 0.2;
export const STOCK_LOOKBACK_DAYS = 14;

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfWeekMonday(date) {
  const normalized = startOfDay(date);
  const dayOfWeek = normalized.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  normalized.setDate(normalized.getDate() + offsetToMonday);
  return normalized;
}

/** Mon=0 … Sun=6 */
export function getIndexFromMondayForDate(d) {
  const dow = d.getDay();
  return dow === 0 ? 6 : dow - 1;
}

export function isSameDay(a, b) {
  return getDateKey(a) === getDateKey(b);
}

export function daysInclusive(start, end) {
  const dates = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    dates.push(startOfDay(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function daysBetween(from, to) {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.round((b - a) / 86400000);
}

/** Last complete Mon–Sun week. On Sunday, this week is still in progress. */
export function lastCompleteWeekStart(today, weeksAgo = 1) {
  const thisMonday = startOfWeekMonday(today);
  return addDays(thisMonday, -7 * weeksAgo);
}

export function weekDates(weekStart) {
  return daysInclusive(weekStart, addDays(weekStart, 6));
}

/**
 * Mon–Thu → this calendar week. Fri–Sun → next Mon–Sun.
 * That week is the plan anchor; Plan for then picks entire week or a half.
 */
export function planWeekStart(today) {
  const thisMonday = startOfWeekMonday(today);
  const idx = getIndexFromMondayForDate(today);
  if (idx >= 4) return addDays(thisMonday, 7);
  return thisMonday;
}

export function planWeekDates(today) {
  return weekDates(planWeekStart(today));
}

/** Keep only today and later so past days of the anchored week are not re-ordered. */
export function remainingDatesFromToday(dates, today) {
  const now = startOfDay(today);
  return dates.filter(d => startOfDay(d) >= now);
}

export function sliceOfPlanWeek(weekStart, horizon) {
  const mon = startOfDay(weekStart);
  if (horizon === 'wave1') return daysInclusive(mon, addDays(mon, 3));
  if (horizon === 'wave2') return daysInclusive(addDays(mon, 4), addDays(mon, 6));
  return weekDates(mon);
}

export function coverageDatesForHorizon(today, horizon) {
  const weekStart = planWeekStart(today);
  return remainingDatesFromToday(sliceOfPlanWeek(weekStart, horizon), today);
}

/**
 * Coverage for a purchasing week: full horizon slice of the plan week anchored at `asOf`.
 * Does not clip to calendar today — Monday-as-of planning covers the whole Mon–Sun (or wave).
 */
export function coverageDatesForPlanAsOf(asOf, horizon) {
  const weekStart = planWeekStart(asOf);
  return sliceOfPlanWeek(weekStart, horizon);
}

/** Always the full anchored week — halves are optional, never auto-selected. */
export function defaultHorizonForToday(_today) {
  return 'week';
}

/** Last N complete Mon–Sun weeks (on Sunday the current week is still open). */
export function lastCompleteWeekStarts(today, count = 4) {
  const starts = [];
  for (let i = 1; i <= count; i++) starts.push(lastCompleteWeekStart(today, i));
  return starts;
}

/** Element-wise mean of Mon–Sun patterns (after each week is uplifted). */
export function averageWeekdayPatterns(patterns) {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const list = (patterns || []).filter(p => Array.isArray(p) && p.length === 7);
  if (!list.length) return out;
  for (let i = 0; i < 7; i++) {
    out[i] = list.reduce((s, p) => s + (Number(p[i]) || 0), 0) / list.length;
  }
  return out;
}

export function leadTimeDates(coverageDates, leadTimeDays = DEFAULT_LEAD_TIME_DAYS) {
  if (!coverageDates.length || !leadTimeDays) return [];
  const last = coverageDates[coverageDates.length - 1];
  const extra = [];
  for (let i = 1; i <= leadTimeDays; i++) extra.push(addDays(last, i));
  return extra;
}

export function sumPatternForDates(pattern, dates) {
  if (!Array.isArray(pattern) || pattern.length !== 7) return 0;
  let total = 0;
  for (const d of dates) {
    total += Number(pattern[getIndexFromMondayForDate(d)]) || 0;
  }
  return total;
}

/**
 * suggested = (need over window + lead-time days of need) × (1 + buffer) − stock − inTransit
 * Lead time and buffer are skipped for `today` (caller passes 0).
 */
export function computeProjectedNeed({
  pattern,
  coverageDates,
  leadTimeDays = DEFAULT_LEAD_TIME_DAYS,
  bufferPct = DEFAULT_BUFFER_PCT,
  applyLeadTime = true,
  applyBuffer = true
}) {
  const leadDates = applyLeadTime ? leadTimeDates(coverageDates, leadTimeDays) : [];
  const coverageNeed = sumPatternForDates(pattern, coverageDates);
  const leadNeed = sumPatternForDates(pattern, leadDates);
  const rawNeed = coverageNeed + leadNeed;
  const projected = applyBuffer ? rawNeed * (1 + bufferPct) : rawNeed;
  return { coverageNeed, leadNeed, leadDates, rawNeed, projected };
}

export function computeSuggestedOrder(projected, stock, inTransit = 0) {
  if (projected == null || !Number.isFinite(Number(projected))) return null;
  const s = Number(stock);
  const t = Number(inTransit) || 0;
  const stockVal = Number.isFinite(s) ? s : 0;
  return Math.max(0, Math.ceil(projected - stockVal - t));
}

/**
 * A baseline day is censored when closing was checked and stock ended at/below zero.
 * Those days under-read demand (you sold what you had, not what was wanted).
 */
export function isCensoredDay(dayQty) {
  if (!dayQty || !dayQty.hasClosingData) return false;
  const closing = Number(dayQty.closing);
  return Number.isFinite(closing) && closing <= 0;
}

export function upliftCensoredPattern(usedByIndex, censoredByIndex) {
  const used = Array.from({ length: 7 }, (_, i) => Number(usedByIndex[i]) || 0);
  const censored = Array.from({ length: 7 }, (_, i) => !!censoredByIndex[i]);
  const uncensoredVals = used.filter((_, i) => !censored[i]);
  const zeroDays = censored.filter(Boolean).length;
  if (zeroDays === 0) {
    return { pattern: used, zeroDays: 0, uplifted: false, allCensored: false };
  }
  if (uncensoredVals.length === 0) {
    return { pattern: used, zeroDays, uplifted: false, allCensored: true };
  }
  const avg = uncensoredVals.reduce((a, b) => a + b, 0) / uncensoredVals.length;
  const pattern = used.map((u, i) => (censored[i] ? avg : u));
  return { pattern, zeroDays, uplifted: true, allCensored: false };
}

/**
 * Newest usable count: today's closing, else today's opening+added, else
 * walking backward — prefer closing, then opening+added.
 */
export function pickLatestStock(byDateKey, today, lookbackDays = STOCK_LOOKBACK_DAYS) {
  const now = startOfDay(today);
  for (let i = 0; i <= lookbackDays; i++) {
    const date = addDays(now, -i);
    const key = getDateKey(date);
    const q = byDateKey[key];
    if (!q) continue;
    const closingChecked = !!(q.closing && q.closing.checked);
    const openingChecked = !!(q.opening && q.opening.checked);
    const added = Number(q.added?.value) || 0;
    if (i === 0 && closingChecked) {
      return {
        qty: Number(q.closing.value) || 0,
        date,
        dateKey: key,
        kind: 'closing'
      };
    }
    if (i === 0 && openingChecked) {
      return {
        qty: (Number(q.opening.value) || 0) + added,
        date,
        dateKey: key,
        kind: 'opening'
      };
    }
    if (i > 0 && closingChecked) {
      return {
        qty: Number(q.closing.value) || 0,
        date,
        dateKey: key,
        kind: 'closing'
      };
    }
    if (i > 0 && openingChecked) {
      return {
        qty: (Number(q.opening.value) || 0) + added,
        date,
        dateKey: key,
        kind: 'opening'
      };
    }
  }
  return { qty: 0, date: null, dateKey: null, kind: null };
}

/**
 * If the count is older than yesterday's closing, subtract estimated usage
 * for each complete day after the count through yesterday.
 */
export function rollForwardStock(stock, pattern, countDate, countKind, today) {
  if (!countDate) return Number(stock) || 0;
  const now = startOfDay(today);
  let start;
  if (countKind === 'opening' && isSameDay(countDate, now)) {
    return Number(stock) || 0;
  }
  start = addDays(countDate, 1);
  const end = addDays(now, -1);
  if (start > end) return Number(stock) || 0;
  let remaining = Number(stock) || 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    remaining -= Number(pattern[getIndexFromMondayForDate(d)]) || 0;
  }
  return remaining;
}

export function countAgeDays(countDate, today) {
  if (!countDate) return null;
  return daysBetween(countDate, today);
}

/**
 * Project when stock hits zero: start from tomorrow (local), subtract each
 * calendar day's usage from pattern[Mon=0..Sun=6] cycling weekly.
 */
export function computeRunOutDate(stock, pattern, today) {
  if (!Array.isArray(pattern) || pattern.length !== 7) return null;

  let remaining = Number(stock);
  if (!Number.isFinite(remaining)) remaining = 0;

  const sumUse = pattern.reduce((a, x) => a + (Number(x) || 0), 0);

  if (sumUse <= 0) {
    if (remaining <= 0) return { outNow: true, noBaselineUsage: true };
    return null;
  }

  if (remaining <= 0) return { outNow: true };

  const cursor = addDays(today, 1);
  const todayMid = startOfDay(today);

  for (let i = 0; i < 730; i++) {
    remaining -= Number(pattern[getIndexFromMondayForDate(cursor)]) || 0;
    if (remaining <= 0) {
      const runMid = startOfDay(cursor);
      const daysUntil = Math.round((runMid - todayMid) / 86400000);
      return { date: startOfDay(cursor), daysUntil };
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { beyondHorizon: true };
}

export function formatShortDate(date) {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateRange(start, end) {
  if (!start) return '';
  if (!end || isSameDay(start, end)) return formatShortDate(start);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    const month = start.toLocaleDateString(undefined, { month: 'short' });
    return `${month} ${start.getDate()}–${end.getDate()}`;
  }
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

export function horizonLabel(horizon) {
  if (horizon === 'wave1') return 'Mon–Thu';
  if (horizon === 'wave2') return 'Fri–Sun';
  return 'Entire week';
}

export function migrateStoredHorizon(stored, today) {
  if (stored === 'wave1' || stored === 'wave2' || stored === 'week') return stored;
  return defaultHorizonForToday(today);
}

/** Days of supply a restock / running-low par should cover. */
export const RESTOCK_COVER_DAYS = 2;
/** Complete days of usage used to estimate that par. */
export const RESTOCK_USAGE_LOOKBACK_DAYS = 14;

/** Last N complete days ending yesterday (today is still being counted). */
export function restockLookbackDates(today, lookbackDays = RESTOCK_USAGE_LOOKBACK_DAYS) {
  const days = Math.max(1, Number(lookbackDays) || RESTOCK_USAGE_LOOKBACK_DAYS);
  const dates = [];
  const yesterday = addDays(startOfDay(today), -1);
  for (let i = days - 1; i >= 0; i--) {
    dates.push(addDays(yesterday, -i));
  }
  return dates;
}

/**
 * Restock par from recent daily usage: average counted day × coverDays, rounded up.
 * Days without a closing count are skipped so missing logs do not dilute the average.
 * Returns null when there is no usable usage.
 */
export function suggestRestockFromUsage(dailyUsages, coverDays = RESTOCK_COVER_DAYS) {
  const cover = Number(coverDays);
  const days = Number.isFinite(cover) && cover > 0 ? cover : RESTOCK_COVER_DAYS;
  const samples = [];
  for (const day of dailyUsages || []) {
    if (day == null) continue;
    if (typeof day === 'number') {
      if (Number.isFinite(day) && day >= 0) samples.push(day);
      continue;
    }
    if (day.hasClosingData === false) continue;
    const used = Number(day.used);
    if (!Number.isFinite(used)) continue;
    samples.push(Math.max(0, used));
  }
  if (samples.length === 0) return null;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return Math.max(0, Math.ceil(avg * days));
}
