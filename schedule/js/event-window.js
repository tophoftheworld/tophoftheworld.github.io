/** Schedule event picker: show events whose period covers the shift date (± margin). */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Days before start / after end allowed for ingress / egress. */
export const SCHEDULE_EVENT_MARGIN_DAYS = 1;

export function addDaysYmd(ymd, days) {
  if (!YMD.test(ymd || '')) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function eventDateRange(event) {
  const start = YMD.test(event?.startDate || '') ? event.startDate : '';
  const endRaw = YMD.test(event?.endDate || '') ? event.endDate : '';
  if (!start && !endRaw) return null;
  const end = endRaw && endRaw >= start ? endRaw : start || endRaw;
  return { start: start || end, end };
}

/**
 * Undated events stay selectable. Archived events are hidden.
 * Dated events show when shiftDate falls in [start - margin, end + margin].
 */
export function isScheduleEventVisibleOnDate(
  event,
  dateYmd,
  marginDays = SCHEDULE_EVENT_MARGIN_DAYS
) {
  if (!event || event.archived) return false;
  if (!YMD.test(dateYmd || '')) return true;
  const range = eventDateRange(event);
  if (!range) return true;
  const windowStart = addDaysYmd(range.start, -marginDays);
  const windowEnd = addDaysYmd(range.end, marginDays);
  return dateYmd >= windowStart && dateYmd <= windowEnd;
}

export function filterScheduleEventsForDate(events, dateYmd) {
  return (events || []).filter((event) => isScheduleEventVisibleOnDate(event, dateYmd));
}
