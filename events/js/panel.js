import {
  displayTitle,
  EVENT_STATUSES,
  headcountFieldLabel,
  headcountUnitForType,
  parseHeadcount,
  partyFieldsForType,
  pipelineLabel,
  resolveHeadcountFields,
  serviceModeForType,
  typeIdFromLead
} from '../../shared/js/ops-events.js?v=21';
import { escapeHtml, typeLabel, typeOptionsHtml } from './types.js?v=21';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.drawer
 * @param {HTMLElement} opts.backdrop
 * @param {HTMLElement} opts.titleEl
 * @param {HTMLElement} opts.bodyEl
 * @param {HTMLElement} opts.footerEl
 */
export function createDrawer(opts) {
  const { drawer, backdrop, titleEl, bodyEl, footerEl } = opts;

  function open() {
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    });
  }

  function close() {
    backdrop.classList.remove('open');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!drawer.classList.contains('open')) backdrop.hidden = true;
    }, 200);
  }

  backdrop.addEventListener('click', close);

  return {
    open,
    close,
    setTitle(text) {
      titleEl.textContent = text;
    },
    setBody(html) {
      bodyEl.innerHTML = html;
    },
    setFooter(html) {
      footerEl.innerHTML = html;
    },
    bodyEl,
    footerEl
  };
}

export function renderEventEditor(event, { mode = 'edit' } = {}) {
  const status = event?.status || EVENT_STATUSES.draft;
  return `
    <div class="field">
      <label for="ev-title">Event name</label>
      <input id="ev-title" type="text" placeholder="Event / hold name" value="${escapeAttrValue(event?.title || '')}" />
    </div>
    <div class="field">
      <label for="ev-type">Type</label>
      <select id="ev-type">${typeOptionsHtml(event?.typeId)}</select>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="ev-start">Start date</label>
        <input id="ev-start" type="date" value="${escapeAttrValue(event?.startDate || '')}" />
      </div>
      <div class="field">
        <label for="ev-end">End date</label>
        <input id="ev-end" type="date" value="${escapeAttrValue(event?.endDate || event?.startDate || '')}" />
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="ev-start-time">Start time</label>
        <input id="ev-start-time" type="time" value="${escapeAttrValue(event?.startTime || '')}" />
      </div>
      <div class="field">
        <label for="ev-end-time">End time</label>
        <input id="ev-end-time" type="time" value="${escapeAttrValue(event?.endTime || '')}" />
      </div>
    </div>
    <div class="field">
      <label for="ev-venue">Venue</label>
      <input id="ev-venue" type="text" placeholder="Venue / location" value="${escapeAttrValue(event?.venue || '')}" />
    </div>
    ${partyFieldsHtml(event)}
    ${headcountFieldHtml(event)}
    <div class="field">
      <label for="ev-notes">Notes</label>
      <textarea id="ev-notes">${escapeHtml(event?.notes || '')}</textarea>
    </div>
    <div class="field">
      <label>Status</label>
      <div>${statusBadge(status)}</div>
    </div>
    ${linkedRowHtml(event)}
    ${mode === 'view' ? '' : ''}
  `;
}

function partyFieldsHtml(event) {
  const typeId = event?.typeId || null;
  const fields = partyFieldsForType(typeId);
  const hidden = fields.length ? '' : ' hidden';
  const rows = ['organizer', 'clientName', 'contactName']
    .map((key) => {
      const meta = fields.find((f) => f.key === key);
      const show = !!meta;
      const label = meta?.label || key;
      const val = event?.[key] || '';
      return `<div class="field party-field" data-party-key="${escapeAttrValue(key)}"${
        show ? '' : ' hidden'
      }>
      <label for="ev-${escapeAttrValue(key)}">${escapeHtml(label)}</label>
      <input id="ev-${escapeAttrValue(key)}" type="text" value="${escapeAttrValue(val)}" />
    </div>`;
    })
    .join('');
  return `<div id="ev-party-wrap"${hidden}>${rows}</div>`;
}

export function readEventForm(root) {
  const q = (id) => root.querySelector(`#${id}`);
  const typeId = q('ev-type')?.value || null;
  const { headcount, headcountUnit } = resolveHeadcountFields(
    typeId,
    q('ev-headcount')?.value,
    null
  );
  const partyKeys = partyFieldsForType(typeId).map((f) => f.key);
  const party = {};
  for (const key of ['organizer', 'clientName', 'contactName']) {
    if (partyKeys.includes(key)) {
      party[key] = q(`ev-${key}`)?.value?.trim() || '';
    }
  }
  return {
    title: q('ev-title')?.value?.trim() || '',
    typeId,
    startDate: q('ev-start')?.value || null,
    endDate: q('ev-end')?.value || q('ev-start')?.value || null,
    startTime: q('ev-start-time')?.value || null,
    endTime: q('ev-end-time')?.value || null,
    venue: q('ev-venue')?.value?.trim() || '',
    ...party,
    notes: q('ev-notes')?.value?.trim() || '',
    headcount,
    headcountUnit,
    serviceMode: serviceModeForType(typeId)
  };
}

/** Keep Pax/Cups field label + visibility in sync with type select. */
export function wireHeadcountField(root) {
  const typeSelect = root.querySelector('#ev-type');
  const wrap = root.querySelector('#ev-headcount-wrap');
  const label = root.querySelector('#ev-headcount-label');
  if (!typeSelect || !wrap || !label) return;

  const sync = () => {
    const unitLabel = headcountFieldLabel(typeSelect.value);
    if (!unitLabel) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    label.textContent = unitLabel;
  };

  typeSelect.addEventListener('change', sync);
  sync();
}

/** Show organizer / client / contact fields based on event type. */
export function wirePartyFields(root) {
  const typeSelect = root.querySelector('#ev-type');
  const wrap = root.querySelector('#ev-party-wrap');
  if (!typeSelect || !wrap) return;

  const sync = () => {
    const fields = partyFieldsForType(typeSelect.value);
    wrap.hidden = fields.length === 0;
    wrap.querySelectorAll('.party-field').forEach((el) => {
      const key = el.dataset.partyKey;
      const meta = fields.find((f) => f.key === key);
      el.hidden = !meta;
      const label = el.querySelector('label');
      if (label && meta) label.textContent = meta.label;
    });
  };

  typeSelect.addEventListener('change', sync);
  sync();
}

export function eventFooterHtml(event) {
  const isDraft = !event?.id || event.status === EVENT_STATUSES.draft;
  const isConfirmed = event?.status === EVENT_STATUSES.confirmed;
  const invoiceId = event?.links?.invoiceId;
  const isMultiDaySpan =
    event?.startDate &&
    event?.endDate &&
    event.startDate !== event.endDate &&
    !!invoiceId;
  return `
    ${isDraft ? `<button type="button" class="inv-btn inv-btn-secondary" data-action="save-draft">Save draft</button>` : ''}
    ${isDraft ? `<button type="button" class="inv-btn inv-btn-primary" data-action="confirm">Confirm</button>` : ''}
    ${isConfirmed ? `<button type="button" class="inv-btn inv-btn-primary" data-action="save">Save</button>` : ''}
    ${
      isMultiDaySpan && isDraft
        ? `<button type="button" class="inv-btn inv-btn-secondary" data-action="resplit-invoice">Split into package days</button>`
        : ''
    }
    ${
      invoiceId
        ? `<button type="button" class="inv-btn inv-btn-secondary" data-action="open-invoice" data-invoice-id="${escapeAttrValue(
            invoiceId
          )}">Open invoice</button>`
        : ''
    }
    ${event?.id && isDraft ? `<button type="button" class="inv-btn inv-btn-danger" data-action="delete">Delete</button>` : ''}
    ${isConfirmed ? `<button type="button" class="inv-btn inv-btn-danger" data-action="cancel">Cancel event</button>` : ''}
  `;
}

export function renderLeadPeek(lead) {
  const pip = lead.pipelineStatus || 'inquiry';
  const isInvoice = lead.source === 'invoice' || !!lead.invoiceId;
  const typeId = typeIdFromLead(lead) || lead.eventType || null;
  const eventName = String(lead.eventName || lead.eventTitle || '').trim();
  return `
    <div class="field">
      <label for="bk-title">Event name</label>
      <input id="bk-title" type="text" value="${escapeAttrValue(eventName)}" placeholder="Separate from client / organizer" />
    </div>
    ${bookingPartyFieldsHtml(lead, typeId)}
    <div class="field-row">
      <div class="field">
        <label for="bk-date">Date</label>
        <input id="bk-date" type="date" value="${escapeAttrValue(lead.targetDate || '')}" />
      </div>
      <div class="field">
        <label for="bk-venue">Venue</label>
        <input id="bk-venue" type="text" value="${escapeAttrValue(lead.targetVenue || '')}" />
      </div>
    </div>
    <dl class="detail-dl">
      <div class="field"><dt>Status</dt><dd><span class="lead-pip lead-pipeline-${escapeHtml(pip)}">${escapeHtml(pipelineLabel(pip))}</span></dd></div>
      ${
        isInvoice
          ? `<div class="field"><dt>Invoice #</dt><dd><code>${escapeHtml(lead.quoteReference || '—')}</code></dd></div>`
          : `<div class="field"><dt>Quote</dt><dd><code>${escapeHtml(lead.quoteReference || '—')}</code></dd></div>`
      }
      <div class="field"><dt>Pax / cups</dt><dd>${escapeHtml(lead.targetPax || '—')}</dd></div>
      <div class="field"><dt>Quoted / total</dt><dd>${escapeHtml(lead.quotedPrice || lead.totalAmount || '—')}</dd></div>
    </dl>
    <p class="subtle">${
      isInvoice
        ? 'Invoiced bookings appear as leads. Save details to sync invoice (and linked event/lead if any).'
        : 'Leads are not events until you add them to the calendar. Save details to sync linked records.'
    }</p>
  `;
}

function bookingPartyFieldsHtml(lead, typeId) {
  const fields = partyFieldsForType(typeId);
  if (!fields.length) {
    // Still show contact if present on unknown types
    const contact = lead.contactName || lead.contactPerson || '';
    if (!contact && !lead.organizer && !lead.clientName) return '';
  }
  const keys = fields.length
    ? fields.map((f) => f.key)
    : ['organizer', 'clientName', 'contactName'].filter(
        (k) => lead[k] || (k === 'contactName' && lead.contactPerson)
      );
  return keys
    .map((key) => {
      const meta = fields.find((f) => f.key === key) || {
        key,
        label:
          key === 'organizer'
            ? 'Organizer'
            : key === 'clientName'
              ? 'Client'
              : 'Contact person'
      };
      const val =
        key === 'contactName'
          ? lead.contactName || lead.contactPerson || ''
          : lead[key] || '';
      return `<div class="field">
      <label for="bk-${escapeAttrValue(key)}">${escapeHtml(meta.label)}</label>
      <input id="bk-${escapeAttrValue(key)}" type="text" value="${escapeAttrValue(val)}" />
    </div>`;
    })
    .join('');
}

export function readBookingForm(root) {
  const readIfPresent = (id) => {
    const el = root.querySelector(`#${id}`);
    if (!el) return undefined;
    return el.value?.trim() || '';
  };
  return {
    title: root.querySelector('#bk-title')?.value?.trim() || '',
    venue: root.querySelector('#bk-venue')?.value?.trim() || '',
    startDate: root.querySelector('#bk-date')?.value || '',
    endDate: root.querySelector('#bk-date')?.value || '',
    organizer: readIfPresent('bk-organizer'),
    clientName: readIfPresent('bk-clientName'),
    contactName: readIfPresent('bk-contactName')
  };
}

export function leadFooterHtml(lead) {
  if (lead.opsEventId) {
    return `
      <button type="button" class="inv-btn inv-btn-secondary" data-action="save-booking">Save details</button>
      <button type="button" class="inv-btn inv-btn-primary" data-action="view-event">View event</button>
      ${
        lead.invoiceId
          ? `<button type="button" class="inv-btn inv-btn-secondary" data-action="open-invoice" data-invoice-id="${escapeAttrValue(
              lead.invoiceId
            )}">Open invoice</button>`
          : ''
      }
    `;
  }
  return `
    <button type="button" class="inv-btn inv-btn-secondary" data-action="save-booking">Save details</button>
    <button type="button" class="inv-btn inv-btn-primary" data-action="promote">Add to calendar</button>
    <button type="button" class="inv-btn inv-btn-secondary" data-action="promote-merge">Merge into event…</button>
    ${
      lead.invoiceId
        ? `<button type="button" class="inv-btn inv-btn-secondary" data-action="open-invoice" data-invoice-id="${escapeAttrValue(
            lead.invoiceId
          )}">Open invoice</button>`
        : ''
    }
    <button type="button" class="inv-btn inv-btn-danger" data-action="archive-lead">Archive</button>
  `;
}

export function renderMergeChooser(events, booking) {
  const options = (events || [])
    .filter((ev) => ev.status !== EVENT_STATUSES.cancelled)
    .slice(0, 40)
    .map((ev) => {
      const label = `${displayTitle(ev)}${ev.startDate ? ` · ${ev.startDate}` : ''}`;
      return `<option value="${escapeAttrValue(ev.id)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  return `
    <div class="field">
      <label for="merge-event">Merge into</label>
      <select id="merge-event">${options || '<option value="">No events</option>'}</select>
    </div>
    <p class="subtle">For each field, keep the event value or take from this booking.</p>
    ${['title', 'venue', 'startDate', 'typeId', 'headcount']
      .map(
        (key) => `
      <div class="field">
        <label>${escapeHtml(key)}</label>
        <select data-retain="${escapeAttrValue(key)}">
          <option value="event" selected>Keep event</option>
          <option value="invoice">Take from booking</option>
        </select>
      </div>`
      )
      .join('')}
    <p class="subtle">Booking: ${escapeHtml(booking.clientName || '')} · ${escapeHtml(
      booking.targetDate || ''
    )} · ${escapeHtml(booking.targetVenue || '')}</p>
  `;
}

export function readMergeForm(root) {
  const eventId = root.querySelector('#merge-event')?.value || '';
  const retain = {};
  root.querySelectorAll('[data-retain]').forEach((el) => {
    retain[el.dataset.retain] = el.value || 'event';
  });
  return { eventId, retain };
}

export function mergeFooterHtml() {
  return `
    <button type="button" class="inv-btn inv-btn-ghost" data-action="merge-cancel">Cancel</button>
    <button type="button" class="inv-btn inv-btn-primary" data-action="merge-confirm">Merge</button>
  `;
}

function linkedRowHtml(event) {
  if (!event?.id) return '';
  const links = event.links || {};
  const badges = [
    ['Lead', !!links.leadId],
    ['Invoice', !!links.invoiceId],
    ['POS', !!links.branchId && event.typeId === 'matcha_popup'],
    ['Schedule', !!links.branchId],
    ['Calendar', !!links.googleCalendarEventId]
  ];
  return `<div class="field">
    <label>Linked</label>
    <div class="linked-row">
      ${badges
        .map(
          ([label, on]) =>
            `<span class="linked-badge${on ? ' on' : ''}">${escapeHtml(label)}</span>`
        )
        .join('')}
    </div>
    ${
      links.leadId
        ? `<p class="subtle" style="margin-top:0.4rem">Lead id: ${escapeHtml(links.leadId)}</p>`
        : ''
    }
    ${
      links.invoiceId
        ? `<p class="subtle" style="margin-top:0.25rem">Invoice id: ${escapeHtml(links.invoiceId)}</p>`
        : ''
    }
  </div>`;
}

function headcountFieldHtml(event) {
  const typeId = event?.typeId || null;
  const unitLabel = headcountFieldLabel(typeId);
  const unit = headcountUnitForType(typeId);
  const value = parseHeadcount(event?.headcount);
  const hidden = unit ? '' : ' hidden';
  return `<div class="field" id="ev-headcount-wrap"${hidden}>
      <label for="ev-headcount" id="ev-headcount-label">${escapeHtml(unitLabel || 'Headcount')}</label>
      <input id="ev-headcount" type="number" min="1" step="1" inputmode="numeric"
        placeholder="${unit === 'cups' ? 'Number of cups' : 'Number of pax'}"
        value="${value != null ? escapeAttrValue(String(value)) : ''}" />
    </div>`;
}

function statusBadge(status) {
  const label =
    status === EVENT_STATUSES.confirmed
      ? 'Confirmed'
      : status === EVENT_STATUSES.cancelled
        ? 'Cancelled'
        : 'Draft';
  return `<span class="linked-badge${status === EVENT_STATUSES.confirmed ? ' on' : ''}">${label}</span>`;
}

function formatService(service) {
  if (service === 'private_mobile_matcha_bar') return 'Private Mobile Matcha Bar';
  if (service === 'private_matcha_workshop') return 'Private Matcha Workshop';
  return service || '—';
}

function escapeAttrValue(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

export function showComposer(rootEl, { date, typesHtml, onSave, onCancel }) {
  rootEl.innerHTML = `
    <div class="composer-pop" id="composerPop" role="dialog" aria-label="New event">
      <h3>New on ${escapeHtml(date)}</h3>
      <div class="field">
        <label for="c-title">Title</label>
        <input id="c-title" type="text" placeholder="Hold (optional)" />
      </div>
      <div class="field">
        <label for="c-type">Type</label>
        <select id="c-type">${typesHtml}</select>
      </div>
      <div class="composer-actions">
        <button type="button" class="inv-btn inv-btn-ghost inv-btn-sm" data-action="cancel">Cancel</button>
        <button type="button" class="inv-btn inv-btn-secondary inv-btn-sm" data-action="draft">Save draft</button>
        <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="confirm">Confirm</button>
      </div>
    </div>
  `;
  const pop = rootEl.querySelector('#composerPop');
  pop.onclick = (e) => e.stopPropagation();
  pop.querySelector('[data-action="cancel"]').onclick = () => {
    rootEl.innerHTML = '';
    onCancel?.();
  };
  pop.querySelector('[data-action="draft"]').onclick = () => {
    onSave?.({
      title: pop.querySelector('#c-title').value.trim(),
      typeId: pop.querySelector('#c-type').value || null,
      startDate: date,
      endDate: date,
      status: EVENT_STATUSES.draft
    });
  };
  pop.querySelector('[data-action="confirm"]').onclick = () => {
    onSave?.({
      title: pop.querySelector('#c-title').value.trim(),
      typeId: pop.querySelector('#c-type').value || null,
      startDate: date,
      endDate: date,
      status: EVENT_STATUSES.confirmed
    });
  };
  return pop;
}

/** Day overflow list — events + leads for a date. */
export function showDayPeek(
  rootEl,
  { date, items, onEventClick, onLeadClick, onAdd, onClose }
) {
  const rows = (items || [])
    .map((item) => {
      if (item.kind === 'lead') {
        const lead = item.data;
        const label = String(lead.clientName || lead.quoteReference || 'Lead').trim();
        const pip = lead.pipelineStatus || 'inquiry';
        return `<button type="button" class="day-peek-item" data-lead-id="${escapeAttrValue(lead.id)}">
          <span class="lead-pip lead-pipeline-${escapeHtml(pip)}">${escapeHtml(pipelineLabel(pip))}</span>
          <span class="day-peek-label">${escapeHtml(label)}</span>
        </button>`;
      }
      const ev = item.data;
      return `<button type="button" class="day-peek-item" data-event-id="${escapeAttrValue(ev.id)}">
        <span class="day-peek-label">${escapeHtml(displayTitle(ev))}</span>
        <span class="subtle">${escapeHtml(typeLabel(ev.typeId) || '')}</span>
      </button>`;
    })
    .join('');

  rootEl.innerHTML = `
    <div class="composer-pop day-peek-pop" id="dayPeekPop" role="dialog" aria-label="Items on ${escapeHtml(date)}">
      <h3>${escapeHtml(formatDayHeading(date))}</h3>
      <div class="day-peek-list">${rows || `<p class="subtle" style="margin:0">Nothing on this day.</p>`}</div>
      <div class="composer-actions">
        <button type="button" class="inv-btn inv-btn-ghost inv-btn-sm" data-action="close">Close</button>
        <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="add">+ Event</button>
      </div>
    </div>
  `;
  const pop = rootEl.querySelector('#dayPeekPop');
  pop.onclick = (e) => e.stopPropagation();
  pop.querySelector('[data-action="close"]').onclick = () => {
    rootEl.innerHTML = '';
    onClose?.();
  };
  pop.querySelector('[data-action="add"]').onclick = () => {
    rootEl.innerHTML = '';
    onAdd?.(date);
  };
  pop.querySelectorAll('[data-event-id]').forEach((btn) => {
    btn.onclick = () => {
      rootEl.innerHTML = '';
      onEventClick?.(btn.dataset.eventId);
    };
  });
  pop.querySelectorAll('[data-lead-id]').forEach((btn) => {
    btn.onclick = () => {
      rootEl.innerHTML = '';
      onLeadClick?.(btn.dataset.leadId);
    };
  });
  return pop;
}

function formatDayHeading(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export { displayTitle, typeLabel };
