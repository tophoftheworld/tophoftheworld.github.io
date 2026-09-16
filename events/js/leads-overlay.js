/**
 * Lead overlay helpers for the Events calendar.
 * Includes invoice-sourced rows shaped as Invoiced leads.
 */

import { normalizeTargetDate, pipelineLabel } from '../../shared/js/ops-events.js?v=21';

export function filterLeadsForMonth(leads, year, monthIndex) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const out = [];
  for (const l of leads || []) {
    if (l.opsEventId) continue;
    if (l.archived) continue;
    const dates =
      Array.isArray(l.targetDates) && l.targetDates.length
        ? l.targetDates.map(normalizeTargetDate).filter(Boolean)
        : [normalizeTargetDate(l.targetDate)].filter(Boolean);
    for (const d of dates) {
      if (d && d.startsWith(prefix)) out.push({ ...l, targetDate: d });
    }
  }
  return out;
}

export function leadChipLabel(lead) {
  return String(lead.clientName || lead.quoteReference || 'Lead').trim();
}

export function leadPipelineClass(lead) {
  return `lead-pipeline-${lead.pipelineStatus || 'inquiry'}`;
}

export { pipelineLabel, normalizeTargetDate };
