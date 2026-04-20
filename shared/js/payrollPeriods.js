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
