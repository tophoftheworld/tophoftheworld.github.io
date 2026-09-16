/**
 * Shared payroll period calendar — same ids/labels as admin payroll period dropdown.
 * Period id format: YYYY-MM-DD_YYYY-MM-DD (start_end).
 */

export function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse period id into local calendar start/end (matches generatePayrollPeriods boundaries).
 * @param {string} periodId
 * @returns {{ startDate: Date, endDate: Date } | null}
 */
export function getPeriodDatesFromId(periodId) {
    if (!periodId || typeof periodId !== 'string') return null;
    const m = periodId.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    const [_, a, b] = m;
    const startDate = new Date(
        parseInt(a.slice(0, 4), 10),
        parseInt(a.slice(5, 7), 10) - 1,
        parseInt(a.slice(8, 10), 10)
    );
    const endDate = new Date(
        parseInt(b.slice(0, 4), 10),
        parseInt(b.slice(5, 7), 10) - 1,
        parseInt(b.slice(8, 10), 10)
    );
    return { startDate, endDate };
}

/**
 * @param {Date} [startDate]
 * @param {Date} [endDate]
 * @param {boolean} [limitCount]
 * @param {number} [safetyMaxPeriods] Max iterations (default 50). Pass 0 for no cap (migration / full history).
 * @returns {{ id: string, start: Date, end: Date, label: string }[]}
 */
export function generatePayrollPeriods(startDate, endDate, limitCount = false, safetyMaxPeriods = 50) {
    const isDefault = !startDate || !endDate;
    const periods = [];
    const today = new Date();
    let maxIterations = 50;
    if (safetyMaxPeriods === 0) maxIterations = Number.POSITIVE_INFINITY;
    else if (typeof safetyMaxPeriods === 'number' && safetyMaxPeriods > 0) maxIterations = safetyMaxPeriods;

    let minDate;
    if (!isDefault) {
        minDate = new Date(startDate);
        const daysInMonth = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 0).getDate();
        const secondCutoff = daysInMonth - 3;
        if (minDate.getDate() <= 12) {
            minDate.setDate(1);
            minDate.setMonth(minDate.getMonth() - 1);
            const daysInPrevMonth = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 0).getDate();
            minDate.setDate(daysInPrevMonth - 2);
        } else if (minDate.getDate() <= secondCutoff) {
            minDate.setDate(13);
        } else {
            minDate.setDate(daysInMonth - 2);
        }
    } else {
        minDate = new Date(today);
        minDate.setMonth(minDate.getMonth() - 2);
    }

    let currentPeriodEnd = new Date();
    const daysInCurMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const secondCutoffThisMonth = daysInCurMonth - 3;

    if (today.getDate() > secondCutoffThisMonth) {
        currentPeriodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 12);
    } else if (today.getDate() > 12) {
        currentPeriodEnd = new Date(today.getFullYear(), today.getMonth(), secondCutoffThisMonth);
    } else {
        currentPeriodEnd = new Date(today.getFullYear(), today.getMonth(), 12);
    }

    let periodEnd = new Date(currentPeriodEnd);
    let count = 0;

    while ((!isDefault || count < 3) && (isDefault || periodEnd >= minDate)) {
        let periodStart;

        if (periodEnd.getDate() === 12) {
            const prevMonth = periodEnd.getMonth() === 0 ? 11 : periodEnd.getMonth() - 1;
            const prevYear = periodEnd.getMonth() === 0 ? periodEnd.getFullYear() - 1 : periodEnd.getFullYear();
            const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
            const startDay = daysInPrevMonth - 2;
            periodStart = new Date(prevYear, prevMonth, startDay);

            if (periodStart < minDate) break;
        } else {
            periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 13);
            if (periodStart < minDate) break;
        }

        periods.push({
            id: `${formatDate(periodStart)}_${formatDate(periodEnd)}`,
            start: periodStart,
            end: periodEnd,
            label: `${periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        });
        count++;

        if (isDefault && count >= 3) break;
        if (!isDefault && limitCount && count >= 3) break;

        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() - 1);

        if (Number.isFinite(maxIterations) && count > maxIterations) break;
    }

    return periods.sort((a, b) => b.start - a.start);
}

/**
 * Pay day for a cutoff (period end): normally end + 3 days.
 * Month overflow: 12th → 15th same month; near-EOM cutoff → last day of month.
 * @param {Date} cutoffDate
 * @returns {Date}
 */
export function getPayDay(cutoffDate) {
    const cutoff = new Date(
        cutoffDate.getFullYear(),
        cutoffDate.getMonth(),
        cutoffDate.getDate()
    );
    const payDay = new Date(cutoff);
    payDay.setDate(cutoff.getDate() + 3);

    if (payDay.getMonth() !== cutoff.getMonth()) {
        const cutoffDay = cutoff.getDate();
        const month = cutoff.getMonth();
        const year = cutoff.getFullYear();
        if (cutoffDay === 12) {
            return new Date(year, month, 15);
        }
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        return new Date(year, month, lastDayOfMonth);
    }

    return payDay;
}

function periodFromStartEnd(start, end) {
    return {
        id: `${formatDate(start)}_${formatDate(end)}`,
        start,
        end,
        label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        payDay: startOfLocalDay(getPayDay(end))
    };
}

/**
 * Payroll period whose cutoff covers this calendar date (not “the period containing today”).
 * Late-month dates after the second cutoff belong to the period paid on the next 12th’s payday.
 * @param {Date|string} date
 * @returns {{ id: string, start: Date, end: Date, label: string, payDay: Date } | null}
 */
export function getPeriodContainingDate(date) {
    const parsed = date instanceof Date ? date : parseLocalDateInput(date);
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    const d = startOfLocalDay(parsed);
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const secondCutoff = daysInMonth - 3;

    let start;
    let end;
    if (day <= 12) {
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        const daysInPrev = new Date(prevYear, prevMonth + 1, 0).getDate();
        start = new Date(prevYear, prevMonth, daysInPrev - 2);
        end = new Date(year, month, 12);
    } else if (day <= secondCutoff) {
        start = new Date(year, month, 13);
        end = new Date(year, month, secondCutoff);
    } else {
        start = new Date(year, month, daysInMonth - 2);
        end = new Date(year, month + 1, 12);
    }
    return periodFromStartEnd(start, end);
}

function parseLocalDateInput(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfLocalDay(value);
    if (typeof value.toDate === 'function') {
        try {
            return startOfLocalDay(value.toDate());
        } catch (_) {
            return null;
        }
    }
    const s = String(value);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
}

function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Among payroll periods, pick the one whose pay day is the closest upcoming
 * (smallest payDay >= asOfDate, same calendar day counts).
 * @param {Date} [asOfDate]
 * @param {{ id: string, start: Date, end: Date, label?: string }[]} [periods]
 * @returns {{ id: string, start: Date, end: Date, label?: string, payDay: Date } | null}
 */
export function getPeriodForClosestPayDay(asOfDate = new Date(), periods = null) {
    const asOf = startOfLocalDay(asOfDate || new Date());
    const list = Array.isArray(periods) && periods.length
        ? periods
        : generatePayrollPeriods();

    let best = null;
    for (const period of list) {
        if (!period?.end) continue;
        const payDay = getPayDay(period.end);
        const payDayStart = startOfLocalDay(payDay);
        if (payDayStart < asOf) continue;
        if (!best || payDayStart < best.payDay) {
            best = { ...period, payDay: payDayStart };
        }
    }
    return best;
}

/**
 * Periods sorted oldest → newest by start date.
 * @param {{ id: string, start: Date, end: Date, label?: string }[]} [periods]
 */
export function sortPeriodsAscending(periods = null) {
    const list = Array.isArray(periods) && periods.length
        ? [...periods]
        : generatePayrollPeriods();
    return list.sort((a, b) => a.start - b.start);
}

/**
 * Build the chronologically next cutoff after a known period end date.
 * @param {Date} periodEnd
 * @returns {{ id: string, start: Date, end: Date, label: string, payDay: Date } | null}
 */
export function buildNextPeriodAfterEnd(periodEnd) {
    if (!periodEnd) return null;
    const end = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate());
    const nextStart = new Date(end);
    nextStart.setDate(end.getDate() + 1);

    let nextEnd;
    if (nextStart.getDate() === 13) {
        const daysInMonth = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0).getDate();
        nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth(), daysInMonth - 3);
    } else {
        // Started near month-end (monthEnd-2); ends on the 12th of the following month
        if (nextStart.getMonth() === end.getMonth()) {
            nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 12);
        } else {
            nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth(), 12);
        }
    }

    return {
        id: `${formatDate(nextStart)}_${formatDate(nextEnd)}`,
        start: nextStart,
        end: nextEnd,
        label: `${nextStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${nextEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        payDay: startOfLocalDay(getPayDay(nextEnd))
    };
}

/**
 * Next payroll period after periodId (by start date). Synthesizes forward if list has no successor.
 * @param {string} periodId
 * @param {{ id: string, start: Date, end: Date, label?: string }[]} [periods]
 */
export function getNextPayrollPeriod(periodId, periods = null) {
    if (!periodId) return null;
    const asc = sortPeriodsAscending(periods);
    const idx = asc.findIndex((p) => p.id === periodId);
    if (idx >= 0 && idx < asc.length - 1) {
        const next = asc[idx + 1];
        return { ...next, payDay: startOfLocalDay(getPayDay(next.end)) };
    }
    const fromId = getPeriodDatesFromId(periodId);
    if (fromId?.endDate) return buildNextPeriodAfterEnd(fromId.endDate);
    if (idx >= 0 && asc[idx]?.end) return buildNextPeriodAfterEnd(asc[idx].end);
    return null;
}

/**
 * Up to `count` prior period ids immediately before periodId (newest prior first).
 * @param {string} periodId
 * @param {number} [count=2]
 * @param {{ id: string, start: Date, end: Date, label?: string }[]} [periods]
 * @returns {string[]}
 */
export function getPreviousPeriodIds(periodId, count = 2, periods = null) {
    if (!periodId || count <= 0) return [];
    const asc = sortPeriodsAscending(periods);
    const idx = asc.findIndex((p) => p.id === periodId);
    if (idx <= 0) return [];
    const out = [];
    for (let i = idx - 1; i >= 0 && out.length < count; i--) {
        out.push(asc[i].id);
    }
    return out;
}

/**
 * Closest upcoming payday period, or the period after that (next cutoff).
 * @param {'this'|'next'} [which='this']
 * @param {Date} [asOfDate]
 * @param {{ id: string, start: Date, end: Date, label?: string }[]} [periods]
 */
export function getPeriodForClosestPayDayOffset(which = 'this', asOfDate = new Date(), periods = null) {
    const list = Array.isArray(periods) && periods.length
        ? periods
        : generatePayrollPeriods();
    const first = getPeriodForClosestPayDay(asOfDate, list);
    if (!first) return null;
    if (which !== 'next') return first;
    return getNextPayrollPeriod(first.id, list) || first;
}
