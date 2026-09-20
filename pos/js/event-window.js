/** POS event picker: show events overlapping [today-2d, today+2d] in Asia/Manila. */

const TIMEZONE = 'Asia/Manila';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const POS_EVENT_WINDOW_DAYS = 2;

export function manilaTodayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

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

export { eventDateRange };

export const AUTO_ARCHIVE_AFTER_DAYS = 7;

export function shouldAutoArchiveEvent(event, todayYmd = manilaTodayYmd()) {
  if (!event || event.archived || event.autoArchiveExempt) return false;
  const range = eventDateRange(event);
  if (!range) return false;
  const cutoff = addDaysYmd(todayYmd, -AUTO_ARCHIVE_AFTER_DAYS);
  return range.end <= cutoff;
}

/**
 * Undated events stay visible. Archived events are hidden.
 * Dated events show when their range overlaps today ± windowDays (inclusive).
 */
export function isPosEventVisible(event, todayYmd, windowDays = POS_EVENT_WINDOW_DAYS) {
  if (!event || event.archived) return false;
  const range = eventDateRange(event);
  if (!range) return true;
  const windowStart = addDaysYmd(todayYmd, -windowDays);
  const windowEnd = addDaysYmd(todayYmd, windowDays);
  return range.start <= windowEnd && range.end >= windowStart;
}

export function filterPosSelectableEvents(events, todayYmd = manilaTodayYmd()) {
  return (events || []).filter((event) => isPosEventVisible(event, todayYmd));
}

/** @typedef {'current' | 'upcoming' | 'past' | 'archived'} DashboardEventGroup */

export function classifyDashboardEvent(event, todayYmd = manilaTodayYmd()) {
  if (!event || event.archived) return 'archived';
  const range = eventDateRange(event);
  if (!range) return 'current';
  const windowStart = addDaysYmd(todayYmd, -POS_EVENT_WINDOW_DAYS);
  const windowEnd = addDaysYmd(todayYmd, POS_EVENT_WINDOW_DAYS);
  if (range.start <= windowEnd && range.end >= windowStart) return 'current';
  if (range.start > windowEnd) return 'upcoming';
  return 'past';
}

function byStartAsc(a, b) {
  const as = eventDateRange(a)?.start || '9999-99-99';
  const bs = eventDateRange(b)?.start || '9999-99-99';
  return as.localeCompare(bs) || String(a.name || '').localeCompare(String(b.name || ''));
}

function byEndDesc(a, b) {
  const ae = eventDateRange(a)?.end || '';
  const be = eventDateRange(b)?.end || '';
  return be.localeCompare(ae) || String(a.name || '').localeCompare(String(b.name || ''));
}

export function groupDashboardEvents(events, todayYmd = manilaTodayYmd()) {
  const groups = { current: [], upcoming: [], past: [], archived: [] };
  for (const event of events || []) {
    groups[classifyDashboardEvent(event, todayYmd)].push(event);
  }
  groups.current.sort(byStartAsc);
  groups.upcoming.sort(byStartAsc);
  groups.past.sort(byEndDesc);
  return groups;
}
