/**
 * Invoice overlay helpers for the Events calendar.
 */

import { invoiceCalendarDates } from '../../shared/js/ops-events.js?v=21';

export function filterInvoicesForMonth(invoices, year, monthIndex) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const out = [];
  for (const inv of invoices || []) {
    if (inv.opsEventId) continue;
    const dates = Array.isArray(inv.eventDates) && inv.eventDates.length
      ? inv.eventDates
      : invoiceCalendarDates(inv);
    for (const d of dates) {
      if (d && d.startsWith(prefix)) {
        out.push({ ...inv, eventDate: d });
      }
    }
  }
  return out;
}

export function invoiceChipLabel(invoice) {
  return String(
    invoice.clientName || invoice.clientCompany || invoice.invoiceNumber || 'Invoice'
  ).trim();
}
