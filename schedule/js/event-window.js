/** Schedule event picker: hide past events; keep current and upcoming ones selectable. */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Days after end still treated as the event window (egress). */
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
 * Past events (ended before shiftDate, plus egress margin) are hidden.
 * Current and future events stay visible so staff can be scheduled in advance.
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
  const windowEnd = addDaysYmd(range.end, marginDays);
  return dateYmd <= windowEnd;
}

export function filterScheduleEventsForDate(events, dateYmd) {
  return (events || []).filter((event) => isScheduleEventVisibleOnDate(event, dateYmd));
}
