export const SERVICES = {
  mobile_bar: { label: 'Mobile Matcha Bar', short: 'Mobile bar', unit: 'cups' },
  matcha_workshop: { label: 'Matcha Workshop', short: 'Matcha workshop', unit: 'pax' },
  mochi_workshop: { label: 'Mochi Making Workshop', short: 'Mochi workshop', unit: 'pax' },
  matcha_popup: { label: 'Matcha Bar Pop-up', short: 'Pop-up', unit: 'cups' }
};

export const STAGES = [
  { id: 'inquiry', label: 'Inquiry', hint: 'Waiting on details or a price' },
  { id: 'quoted', label: 'Quoted', hint: 'Price sent' },
  { id: 'invoiced', label: 'Invoiced', hint: 'Invoice created' },
  { id: 'booked', label: 'Booked', hint: 'Date locked in' },
  { id: 'completed', label: 'Completed', hint: 'Event done and paid' }
];

export const PIPELINE_STAGES = ['inquiry', 'quoted', 'invoiced', 'booked'];

/** Closed groups shown on demand, after the open stages. */
export const CLOSED_GROUPS = [
  { id: 'completed', label: 'Completed', hint: 'Event done and nothing owed' },
  { id: 'expired', label: 'Expired', hint: 'Never invoiced and the date passed or it went silent' },
  { id: 'archived', label: 'Archived', hint: 'Put away by the team' }
];

/** Bookings stage -> serviceLeads.pipelineStatus. */
export const STAGE_TO_PIPELINE = {
  inquiry: 'inquiry',
  quoted: 'quoted',
  invoiced: 'invoiced',
  booked: 'deposit',
  completed: 'completed'
};

export const QUIET_DAYS = 21;
export const EXPIRE_SILENT_DAYS = 60;

export const PUBLIC_INVOICE_ORIGIN = 'https://matchanese-invoice.web.app';

export function channelLabel(c) {
  return {
    instagram: 'Instagram',
    messenger: 'Messenger',
    widget: 'Website chat',
    chatbot: 'Chatbot',
    manual: 'Manual',
    invoice: 'Invoice'
  }[c] || c || 'Unknown';
}
