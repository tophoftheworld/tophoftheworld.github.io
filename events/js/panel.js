import {
  displayTitle,
  EVENT_STATUSES,
  formatHeadcountLabel,
  headcountFieldLabel,
  headcountUnitForType,
  parseHeadcount,
  partyFieldsForType,
  pipelineLabel,
  resolveHeadcountFields,
  serviceModeForType,
  typeIdFromLead
} from '../../shared/js/ops-events.js?v=38';
import { escapeHtml, typeLabel, typeOptionsHtml } from './types.js?v=38';

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

const DASH_WIDGETS = [
  { id: 'schedule', title: 'Schedule' },
  { id: 'menu', title: 'Menu' },
  { id: 'sales', title: 'Sales' },
  { id: 'expenses', title: 'Expenses' },
  { id: 'invoice', title: 'Invoice' },
  { id: 'inbox', title: 'Inbox' },
  { id: 'purchasing', title: 'Purchasing' },
  { id: 'workshops', title: 'Workshops' }
];

/** Which widgets apply for this event type (mockup filter). */
function widgetsForEvent(event) {
  const typeId = event?.typeId;
  const isPopup = typeId === 'matcha_popup';
  const isWorkshop = typeId === 'matcha_workshop' || typeId === 'mochi_workshop';
  const isBar = typeId === 'mobile_bar';
  return DASH_WIDGETS.filter((w) => {
    if (w.id === 'menu' || w.id === 'sales') return isPopup;
    if (w.id === 'purchasing') return isPopup || isWorkshop;
    if (w.id === 'workshops') return isWorkshop;
    if (w.id === 'schedule' || w.id === 'expenses' || w.id === 'invoice' || w.id === 'inbox') {
      return isPopup || isWorkshop || isBar || !typeId;
    }
    return true;
  });
}

function expensesAllocationLabel(typeId) {
  if (typeId === 'matcha_popup') return 'Popup';
  if (typeId === 'mobile_bar') return 'Bar Service';
  if (typeId === 'matcha_workshop' || typeId === 'mochi_workshop') return 'Workshop';
  return 'Popup';
}

/** Hardcoded mock from employees_v2 (nicknames + staff-photos). Not live shifts. */
const SCHEDULE_MOCK_ROWS = [
  {
    name: 'Bea',
    photoUrl:
      'https://firebasestorage.googleapis.com/v0/b/matchanese-attendance.firebasestorage.app/o/staff-photos%2F130129?alt=media&token=e20582ce-a877-4887-9482-728bee8ef2e2',
    timeIn: '9:30 AM',
    timeOut: '6:30 PM',
    kind: 'opening'
  },
  {
    name: 'Acerr',
    photoUrl:
      'https://firebasestorage.googleapis.com/v0/b/matchanese-attendance.firebasestorage.app/o/staff-photos%2F130429?alt=media&token=68788e50-90b2-4f08-af1f-0c1456cfc3a5',
    timeIn: '9:30 AM',
    timeOut: '6:30 PM',
    kind: 'opening'
  },
  {
    name: 'Mae',
    photoUrl:
      'https://firebasestorage.googleapis.com/v0/b/matchanese-attendance.firebasestorage.app/o/staff-photos%2F130829?alt=media&token=efe0081e-b805-476c-bc0e-ab03c9502ecc',
    timeIn: '1:00 PM',
    timeOut: '10:00 PM',
    kind: 'closing'
  },
  {
    name: 'Lester',
    photoUrl:
      'https://firebasestorage.googleapis.com/v0/b/matchanese-attendance.firebasestorage.app/o/staff-photos%2F131029?alt=media&token=690f3989-d839-4375-8847-b1edab4e1c37',
    timeIn: '1:00 PM',
    timeOut: '10:00 PM',
    kind: 'closing'
  }
];

const SCHEDULE_KIND_LABEL = {
  opening: 'Opening',
  closing: 'Closing'
};

function scheduleCardHtml(row) {
  return `<div class="event-sched-card is-${escapeAttrValue(row.kind)}">
      <img class="event-sched-card__photo" src="${escapeAttrValue(row.photoUrl)}" alt="" width="36" height="36" loading="lazy" />
      <div class="event-sched-card__details">
        <div class="event-sched-card__name">${escapeHtml(row.name)}</div>
        <div class="event-sched-card__kind">${escapeHtml(SCHEDULE_KIND_LABEL[row.kind] || row.kind)}</div>
        <div class="event-sched-card__time">${escapeHtml(row.timeIn)} – ${escapeHtml(row.timeOut)}</div>
      </div>
    </div>`;
}

function scheduleWidgetHtml() {
  const opening = SCHEDULE_MOCK_ROWS.filter((r) => r.kind === 'opening');
  const closing = SCHEDULE_MOCK_ROWS.filter((r) => r.kind === 'closing');
  const total = SCHEDULE_MOCK_ROWS.length;

  const section = (kind, rows) => {
    if (!rows.length) return '';
    return `<div class="event-sched-section">
      <div class="event-sched-section__label">${escapeHtml(SCHEDULE_KIND_LABEL[kind])} · ${rows.length}</div>
      <div class="event-sched-list">${rows.map(scheduleCardHtml).join('')}</div>
    </div>`;
  };

  return `
    <div class="event-widget__stat-row">
      <strong>${total} scheduled</strong>
    </div>
    ${section('opening', opening)}
    ${section('closing', closing)}`;
}

function widgetBodyHtml(id, event) {
  const allocation = expensesAllocationLabel(event?.typeId);
  switch (id) {
    case 'schedule':
      return scheduleWidgetHtml();
    case 'menu':
      return `
        <div class="event-widget__stat-row">
          <span class="event-widget__sub">Custom Menu · 6 categories</span>
        </div>
        <ul class="event-widget__menu">
          <li><span>Halaya Latte</span><span>₱200</span></li>
          <li><span>Ceremonial Matcha</span><span>₱220</span></li>
          <li><span>Seasalt Cream Cookie</span><span>₱90</span></li>
        </ul>
        <p class="event-widget__more">+14 more · from Pop-ups manage event</p>`;
    case 'sales':
      return `
        <div class="event-widget__metric-label">Total Sales</div>
        <div class="event-widget__money-lg">₱24,850</div>
        <div class="event-widget__metrics">
          <div><span class="event-widget__metric-label">Cups Sold</span><span class="event-widget__metric-value">186</span></div>
          <div><span class="event-widget__metric-label">Orders</span><span class="event-widget__metric-value">94</span></div>
          <div><span class="event-widget__metric-label">Est. Profit</span><span class="event-widget__metric-value">₱9.1k</span></div>
        </div>
        <p class="event-widget__tenders">Cash ₱11.2k · GCash ₱9.4k · Card ₱4.3k</p>
        <p class="event-widget__more">EOD · Variance +₱120</p>`;
    case 'expenses':
      return `
        <div class="event-widget__stat-row">
          <strong class="event-widget__money">₱8,420</strong>
          <span class="linked-badge on">${escapeHtml(allocation)}</span>
        </div>
        <ul class="event-widget__list">
          <li><span class="event-widget__list-main"><span class="event-widget__name">SM Hypermarket</span><span class="event-widget__meta">Supplier</span></span><span>₱2,180</span></li>
          <li><span class="event-widget__list-main"><span class="event-widget__name">Lazada</span><span class="event-widget__meta">Supplier</span></span><span>₱960</span></li>
          <li><span class="event-widget__list-main"><span class="event-widget__name">Petty cash</span><span class="event-widget__meta">Pop-up Cash</span></span><span>₱450</span></li>
        </ul>
        <p class="event-widget__more">Allocation · ${escapeHtml(allocation)}</p>`;
    case 'invoice':
      return `
        <div class="event-widget__stat-row">
          <code class="event-widget__code">INV-2026-1042</code>
          <span class="event-widget__status is-partial">Partial</span>
        </div>
        <div class="event-widget__money-stack">
          <div><span class="event-widget__metric-label">Total</span><span class="event-widget__metric-value">Php 45,000</span></div>
          <div><span class="event-widget__metric-label">Remaining</span><span class="event-widget__metric-value is-due">Php 30,000</span></div>
        </div>
        <p class="event-widget__more">Date Reservation · Payment confirmed</p>`;
    case 'inbox':
      return `
        <div class="event-widget__stat-row">
          <span class="lead-pip lead-pipeline-quoted">Quoted</span>
          <span class="event-widget__meta">2h ago</span>
        </div>
        <p class="event-widget__name event-widget__name--lg">Lanson Events</p>
        <p class="event-widget__subline">Private Matcha Workshop · 16 pax · ₱45,000</p>
        <p class="event-widget__preview">Can we confirm the Saturday setup time and send the deposit slip?</p>`;
    case 'purchasing':
      return `
        <div class="event-widget__stat-row">
          <span class="event-widget__sub">Week of Sep 22–28</span>
          <span class="linked-badge on">Ordering</span>
        </div>
        <p class="event-widget__name event-widget__name--lg">${escapeHtml(displayTitle(event) || 'Event location')}</p>
        <div class="event-widget__metrics">
          <div><span class="event-widget__metric-label">Plan</span><span class="event-widget__metric-value">₱12.4k</span></div>
          <div><span class="event-widget__metric-label">Lines</span><span class="event-widget__metric-value">18</span></div>
          <div><span class="event-widget__metric-label">Status</span><span class="event-widget__metric-value">Open</span></div>
        </div>
        <p class="event-widget__more">Budget · Order · Reconcile</p>`;
    case 'workshops':
      return `
        <div class="event-widget__stat-row">
          <span class="event-widget__sub">Session roster</span>
          <span class="linked-badge on">4 left</span>
        </div>
        <p class="event-widget__seats"><strong>12</strong><span>/16 booked</span></p>
        <ul class="event-widget__people event-widget__people--compact">
          <li><span class="event-widget__name">Priya</span></li>
          <li><span class="event-widget__name">Marco</span></li>
          <li><span class="event-widget__name">Elle</span></li>
        </ul>
        <p class="event-widget__more">+9 participants · open</p>`;
    default:
      return '';
  }
}

function widgetCardHtml(widget, event) {
  return `<article class="event-widget" data-widget="${escapeAttrValue(widget.id)}">
    <h3 class="event-widget__title">${escapeHtml(widget.title)}</h3>
    <div class="event-widget__body">${widgetBodyHtml(widget.id, event)}</div>
  </article>`;
}

function dashStatus(event) {
  if (event?.status === EVENT_STATUSES.cancelled) return { key: 'cancelled', label: 'Cancelled' };
  if (event?.status === EVENT_STATUSES.confirmed) return { key: 'confirmed', label: 'Confirmed' };
  if (!String(event?.title || '').trim()) return { key: 'hold', label: 'Hold' };
  return { key: 'draft', label: 'Draft' };
}

function formatDashDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDashTime(value) {
  if (!value || !/^\d{1,2}:\d{2}/.test(value)) return '';
  const [hs, ms] = value.split(':');
  const h = Number(hs);
  const m = Number(ms);
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  if (!m) return `${h12} ${ampm}`;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDashWhen(event) {
  const start = formatDashDate(event?.startDate);
  const end = formatDashDate(event?.endDate || event?.startDate);
  const range = start && end && start !== end ? `${start} – ${end}` : start;
  const t1 = formatDashTime(event?.startTime);
  const t2 = formatDashTime(event?.endTime);
  const times = t1 && t2 ? `${t1} – ${t2}` : t1 || t2;
  return [range, times].filter(Boolean).join(' · ');
}

function dashFacts(event) {
  const facts = [];
  const t1 = formatDashTime(event?.startTime);
  const t2 = formatDashTime(event?.endTime);
  if (t1 || t2) {
    facts.push({ label: 'Time', value: t1 && t2 ? `${t1} – ${t2}` : t1 || t2 });
  }
  const venue = String(event?.venue || '').trim();
  if (venue) facts.push({ label: 'Venue', value: venue });
  for (const field of partyFieldsForType(event?.typeId)) {
    const value = String(event?.[field.key] || '').trim();
    if (value) facts.push({ label: field.label, value });
  }
  const hc = formatHeadcountLabel(event);
  if (hc) {
    facts.push({ label: headcountFieldLabel(event?.typeId) || 'Headcount', value: hc });
  }
  return facts;
}

function dashHeaderActions(event, { editing = false } = {}) {
  const isDraft = !event?.id || event.status === EVENT_STATUSES.draft;
  if (editing) {
    return `
      ${event?.id ? `<button type="button" class="inv-btn inv-btn-ghost inv-btn-sm" data-action="dash-view">Cancel</button>` : ''}
      <button type="button" class="inv-btn inv-btn-ghost inv-btn-sm" data-action="dash-close">Close</button>
    `;
  }
  return `
    ${event?.id && isDraft ? `<button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="confirm">Confirm</button>` : ''}
    <button type="button" class="inv-btn inv-btn-secondary inv-btn-sm" data-action="dash-edit">Edit</button>
    <button type="button" class="inv-btn inv-btn-ghost inv-btn-sm" data-action="dash-close">Close</button>
  `;
}

/** Read-only event dashboard (header + facts + placeholder widgets). */
export function renderEventDashboard(event) {
  const status = dashStatus(event);
  const type = event?.typeId ? typeLabel(event.typeId) : '';
  const when = formatDashWhen(event);
  const venue = String(event?.venue || '').trim();
  const sub = [when, venue].filter(Boolean).join(' · ');
  const notes = String(event?.notes || '').trim();
  const facts = dashFacts(event);
  return `
    <header class="event-dash-header">
      <div class="event-dash-header__main">
        <div class="event-dash-kicker">
          ${type ? `<span class="event-dash-type">${escapeHtml(type)}</span>` : ''}
          <span class="event-dash-status is-${status.key}">${escapeHtml(status.label)}</span>
        </div>
        <h2 class="event-dash-title" id="eventModalTitle">${escapeHtml(displayTitle(event))}</h2>
        ${sub ? `<p class="event-dash-sub">${escapeHtml(sub)}</p>` : ''}
      </div>
      <div class="event-dash-header__actions">
        ${dashHeaderActions(event)}
      </div>
    </header>
    ${
      facts.length
        ? `<dl class="event-dash-facts">${facts
            .map(
              (f) => `<div class="event-dash-fact">
          <dt>${escapeHtml(f.label)}</dt>
          <dd>${escapeHtml(f.value)}</dd>
        </div>`
            )
            .join('')}</dl>`
        : ''
    }
    ${
      notes
        ? `<div class="event-dash-notes">
        <span class="event-dash-notes__label">Notes</span>
        <p>${escapeHtml(notes)}</p>
      </div>`
        : ''
    }
    <section class="event-dash-widgets" aria-label="Connected apps">
      <div class="event-dash-widgets-grid">
        ${widgetsForEvent(event)
          .map((w) => widgetCardHtml(w, event))
          .join('')}
      </div>
    </section>
  `;
}

/** Edit mode shell inside the event modal (header + form). */
export function renderEventModalEdit(event) {
  const isNew = !event?.id;
  return `
    <header class="event-dash-header is-editing">
      <div class="event-dash-header__main">
        <div class="event-dash-kicker">
          <span class="event-dash-type">${isNew ? 'New event' : 'Editing'}</span>
        </div>
        <h2 class="event-dash-title" id="eventModalTitle">${escapeHtml(displayTitle(event))}</h2>
      </div>
      <div class="event-dash-header__actions">
        ${dashHeaderActions(event, { editing: true })}
      </div>
    </header>
    <div class="event-dash-editor">
      ${renderEventEditor(event)}
    </div>
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

/** Day overflow list — events + leads for a date (same details as calendar pills). */
export function showDayPeek(
  rootEl,
  { date, items, onEventClick, onLeadClick, onAdd, onClose }
) {
  const rows = (items || [])
    .map((item) => {
      if (item.kind === 'lead') {
        const lead = item.data;
        const label = String(lead.eventName || lead.clientName || lead.quoteReference || 'Lead').trim();
        const pip = lead.pipelineStatus || 'inquiry';
        const metaParts = [];
        const venue = String(lead.targetVenue || '').trim();
        if (venue) metaParts.push(venue);
        if (lead.targetPax) metaParts.push(String(lead.targetPax));
        const meta = metaParts.join(' · ');
        return `<button type="button" class="day-peek-item is-lead" data-lead-id="${escapeAttrValue(lead.id)}">
          <span class="day-peek-item__body">
            <span class="day-peek-item__title-row">
              <span class="lead-pip lead-pipeline-${escapeHtml(pip)}">${escapeHtml(pipelineLabel(pip))}</span>
              <span class="day-peek-label">${escapeHtml(label)}</span>
            </span>
            ${meta ? `<span class="day-peek-meta">${escapeHtml(meta)}</span>` : ''}
          </span>
        </button>`;
      }
      const ev = item.data;
      const title = displayTitle(ev);
      const meta = peekEventMeta(ev);
      const kind =
        ev.status === EVENT_STATUSES.draft
          ? String(ev.title || '').trim()
            ? 'draft'
            : 'hold'
          : 'confirmed';
      return `<button type="button" class="day-peek-item is-event is-${kind}" data-event-id="${escapeAttrValue(ev.id)}">
          <span class="day-peek-item__body">
            <span class="day-peek-label">${escapeHtml(title)}</span>
            ${meta ? `<span class="day-peek-meta">${escapeHtml(meta)}</span>` : ''}
          </span>
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
      const id = btn.dataset.eventId;
      rootEl.innerHTML = '';
      onEventClick?.(id);
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

function peekEventMeta(ev) {
  const parts = [];
  const venue = String(ev?.venue || '').trim();
  if (venue) parts.push(venue);
  const hc = formatHeadcountLabel(ev);
  if (hc) parts.push(hc);
  return parts.join(' · ');
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
