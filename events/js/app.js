import {
  displayTitle,
  EVENT_STATUSES,
  manilaTodayYmd,
  datesInRange,
  isScheduled
} from '../../shared/js/ops-events.js?v=21';
import {
  seedAndLoadTypes,
  fetchAllEvents,
  fetchOverlayLeads,
  saveNewEvent,
  patchEvent,
  removeEvent,
  confirmEvent,
  cancelEvent,
  promoteLead,
  promoteInvoice,
  mergeBookingIntoEvent,
  archiveBooking,
  saveBookingDetails,
  runBackfill,
  getEventById,
  getInvoiceById
} from './sync.js?v=21';
import { setTypes, typeOptionsHtml, getType } from './types.js?v=21';
import { renderCalendar, renderUnscheduled, monthLabel } from './calendar.js?v=21';
import {
  createDrawer,
  renderEventEditor,
  readEventForm,
  eventFooterHtml,
  renderLeadPeek,
  readBookingForm,
  leadFooterHtml,
  renderMergeChooser,
  readMergeForm,
  mergeFooterHtml,
  showComposer,
  showDayPeek,
  wireHeadcountField,
  wirePartyFields
} from './panel.js?v=21';
import { filterLeadsForMonth } from './leads-overlay.js?v=21';

const state = {
  year: new Date().getFullYear(),
  monthIndex: new Date().getMonth(),
  filter: 'all',
  events: [],
  leads: [],
  selectedEvent: null,
  selectedLead: null,
  mergeMode: false,
  unscheduledOpen: false,
  navGeneration: 0
};

const els = {
  monthLabel: document.getElementById('monthLabel'),
  calGrid: document.getElementById('calGrid'),
  syncStatus: document.getElementById('syncStatus'),
  unscheduledList: document.getElementById('unscheduledList'),
  unscheduledCount: document.getElementById('unscheduledCount'),
  unscheduledToggle: document.getElementById('unscheduledToggle'),
  unscheduledChevron: document.getElementById('unscheduledChevron'),
  composerRoot: document.getElementById('composerRoot'),
  addEventBtn: document.getElementById('addEventBtn'),
  prevMonthBtn: document.getElementById('prevMonthBtn'),
  nextMonthBtn: document.getElementById('nextMonthBtn'),
  todayBtn: document.getElementById('todayBtn')
};

const drawer = createDrawer({
  drawer: document.getElementById('drawer'),
  backdrop: document.getElementById('drawerBackdrop'),
  titleEl: document.getElementById('drawerTitle'),
  bodyEl: document.getElementById('drawerBody'),
  footerEl: document.getElementById('drawerFooter')
});

function setStatus(text) {
  if (els.syncStatus) els.syncStatus.textContent = text;
}

function initShell() {
  const embedded = window.self !== window.top;
  document.body.classList.toggle('embedded', embedded);
  document.body.classList.add('events-app');
  if (els.unscheduledList) els.unscheduledList.hidden = true;
  if (els.unscheduledChevron) els.unscheduledChevron.textContent = '▸';
  if (els.unscheduledToggle) els.unscheduledToggle.setAttribute('aria-expanded', 'false');
}

function paint() {
  els.monthLabel.textContent = monthLabel(state.year, state.monthIndex);
  const monthLeads = filterLeadsForMonth(state.leads, state.year, state.monthIndex);

  renderCalendar({
    gridEl: els.calGrid,
    year: state.year,
    monthIndex: state.monthIndex,
    events: state.events,
    leads: monthLeads,
    filter: state.filter,
    onDayClick: handleDayClick,
    onDayMore: handleDayMore,
    onEventClick: openEvent,
    onLeadClick: openLead,
    onEventDrop: handleDrop
  });

  renderUnscheduled(els.unscheduledList, els.unscheduledCount, state.events, {
    filter: state.filter,
    onEventClick: openEvent
  });
}

function statusSummary() {
  const invoiced = (state.leads || []).filter(
    (l) => l.pipelineStatus === 'invoiced' || l.source === 'invoice'
  ).length;
  return `${state.events.length} events · ${state.leads.length} leads (${invoiced} invoiced)`;
}

async function reload() {
  setStatus('Loading…');
  els.calGrid?.classList.add('is-loading');
  const gen = ++state.navGeneration;
  try {
    const [events, leads] = await Promise.all([
      fetchAllEvents(),
      fetchOverlayLeads(state.year, state.monthIndex)
    ]);
    if (gen !== state.navGeneration) return;
    state.events = events;
    state.leads = leads;
    paint();
    setStatus(statusSummary());
  } catch (err) {
    console.error(err);
    if (gen === state.navGeneration) setStatus('Failed to load');
  } finally {
    if (gen === state.navGeneration) els.calGrid?.classList.remove('is-loading');
  }
}

async function navigateMonth(year, monthIndex) {
  state.year = year;
  state.monthIndex = monthIndex;
  state.leads = [];
  const gen = ++state.navGeneration;
  paint();
  els.calGrid?.classList.add('is-loading');
  setStatus('Loading…');
  try {
    const leads = await fetchOverlayLeads(state.year, state.monthIndex);
    if (gen !== state.navGeneration) return;
    state.leads = leads;
    paint();
    setStatus(statusSummary());
  } catch (err) {
    console.error(err);
    if (gen === state.navGeneration) setStatus('Failed to load overlays');
  } finally {
    if (gen === state.navGeneration) els.calGrid?.classList.remove('is-loading');
  }
}

function handleDayClick(ymd) {
  els.composerRoot.innerHTML = '';
  const pop = showComposer(els.composerRoot, {
    date: ymd,
    typesHtml: typeOptionsHtml(null),
    onCancel: () => {
      els.composerRoot.innerHTML = '';
    },
    onSave: async (payload) => {
      els.composerRoot.innerHTML = '';
      try {
        setStatus('Saving…');
        let created = await saveNewEvent({
          ...payload,
          status: EVENT_STATUSES.draft
        });
        if (payload.status === EVENT_STATUSES.confirmed) {
          created = await confirmEvent(created, getType(created.typeId));
        }
        await reload();
        openEvent(state.events.find((e) => e.id === created.id) || created);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Could not save event');
        setStatus('Error');
      }
    }
  });

  const gridRect = els.calGrid.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = `${Math.min(gridRect.top + 40, window.innerHeight - 280)}px`;
  pop.style.left = `${Math.min(gridRect.left + 40, window.innerWidth - 300)}px`;
}

function itemsForDay(ymd) {
  const items = [];
  for (const ev of state.events || []) {
    if (ev.status === EVENT_STATUSES.cancelled) continue;
    if (!isScheduled(ev)) continue;
    if (state.filter === 'leads') continue;
    if (state.filter === 'drafts' && ev.status !== EVENT_STATUSES.draft) continue;
    if (state.filter === 'events' && ev.status === EVENT_STATUSES.draft) continue;
    const span = datesInRange(ev.startDate, ev.endDate || ev.startDate);
    if (span.includes(ymd)) items.push({ kind: 'event', data: ev });
  }
  if (state.filter === 'all' || state.filter === 'leads') {
    for (const lead of filterLeadsForMonth(state.leads, state.year, state.monthIndex)) {
      if (lead.targetDate === ymd) items.push({ kind: 'lead', data: lead });
    }
  }
  return items;
}

function positionPop(pop) {
  const gridRect = els.calGrid.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = `${Math.min(gridRect.top + 40, window.innerHeight - 320)}px`;
  pop.style.left = `${Math.min(gridRect.left + 40, window.innerWidth - 320)}px`;
}

function handleDayMore(ymd) {
  els.composerRoot.innerHTML = '';
  const pop = showDayPeek(els.composerRoot, {
    date: ymd,
    items: itemsForDay(ymd),
    onClose: () => {
      els.composerRoot.innerHTML = '';
    },
    onAdd: (date) => handleDayClick(date),
    onEventClick: (id) => {
      const ev = state.events.find((x) => x.id === id);
      if (ev) openEvent(ev);
    },
    onLeadClick: (id) => {
      const lead = state.leads.find((x) => x.id === id);
      if (lead) openLead(lead);
    }
  });
  positionPop(pop);
}

function openEvent(event) {
  state.selectedEvent = event;
  state.selectedLead = null;
  state.mergeMode = false;
  drawer.setTitle(displayTitle(event));
  drawer.setBody(renderEventEditor(event));
  drawer.setFooter(eventFooterHtml(event));
  wireHeadcountField(drawer.bodyEl);
  wirePartyFields(drawer.bodyEl);
  drawer.open();
  wireDrawerActions();
}

function openLead(lead) {
  state.selectedLead = lead;
  state.selectedEvent = null;
  state.mergeMode = false;
  drawer.setTitle(lead.clientName || lead.quoteReference || 'Lead');
  drawer.setBody(renderLeadPeek(lead));
  drawer.setFooter(leadFooterHtml(lead));
  drawer.open();
  wireDrawerActions();
}

function openMergeChooser(booking) {
  state.selectedLead = booking;
  state.mergeMode = true;
  drawer.setTitle('Merge into event');
  drawer.setBody(renderMergeChooser(state.events, booking));
  drawer.setFooter(mergeFooterHtml());
  drawer.open();
  wireDrawerActions();
}

function bookingLinks(lead) {
  const invoiceId =
    lead.invoiceId ||
    (String(lead.id).startsWith('inv:') ? String(lead.id).split(':')[1] : null);
  return {
    leadId: lead.source === 'invoice' ? lead.leadId || null : lead.id,
    invoiceId
  };
}

function wireDrawerActions() {
  drawer.footerEl.onclick = async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    try {
      if (action === 'save-draft' || action === 'save') {
        const form = readEventForm(drawer.bodyEl);
        if (!state.selectedEvent?.id) {
          await saveNewEvent({ ...form, status: EVENT_STATUSES.draft });
        } else {
          await patchEvent(state.selectedEvent.id, {
            ...form,
            links: state.selectedEvent.links || {}
          });
          const links = state.selectedEvent.links || {};
          const result = await saveBookingDetails({
            opsEventId: state.selectedEvent.id,
            title: form.title,
            venue: form.venue,
            startDate: form.startDate,
            endDate: form.endDate,
            ...(form.organizer !== undefined ? { organizer: form.organizer } : {}),
            ...(form.clientName !== undefined ? { clientName: form.clientName } : {}),
            ...(form.contactName !== undefined ? { contactName: form.contactName } : {}),
            links
          });
          if (result.notes?.length) setStatus(result.notes.join(' · '));
        }
        state.selectedEvent = null;
        drawer.close();
        await reload();
        return;
      }
      if (action === 'confirm') {
        const form = readEventForm(drawer.bodyEl);
        let ev = state.selectedEvent;
        if (!ev?.id) {
          ev = await saveNewEvent({ ...form, status: EVENT_STATUSES.draft });
        } else {
          await patchEvent(ev.id, { ...form, links: ev.links || {} });
          ev = { ...ev, ...form };
        }
        if (!form.typeId) {
          alert('Pick an event type before confirming.');
          return;
        }
        if (!String(form.title || '').trim()) {
          alert('Add a title before confirming.');
          return;
        }
        await confirmEvent(ev, getType(form.typeId || ev.typeId));
        state.selectedEvent = null;
        drawer.close();
        await reload();
        return;
      }
      if (action === 'delete') {
        if (!state.selectedEvent?.id) return;
        if (!confirm('Delete this draft?')) return;
        await removeEvent(state.selectedEvent.id);
        drawer.close();
        await reload();
        return;
      }
      if (action === 'cancel') {
        if (!state.selectedEvent?.id) return;
        if (
          !confirm(
            'Cancel this event? It will leave the calendar and archive the linked branch if any.'
          )
        ) {
          return;
        }
        await cancelEvent(state.selectedEvent);
        drawer.close();
        await reload();
        return;
      }
      if (action === 'save-booking') {
        if (!state.selectedLead) return;
        const form = readBookingForm(drawer.bodyEl);
        setStatus('Saving details…');
        const links = bookingLinks(state.selectedLead);
        const payload = {
          opsEventId: state.selectedLead.opsEventId || null,
          leadId: links.leadId,
          invoiceId: links.invoiceId,
          title: form.title,
          venue: form.venue,
          startDate: form.startDate,
          endDate: form.endDate,
          links
        };
        if (form.organizer !== undefined) payload.organizer = form.organizer;
        if (form.clientName !== undefined) payload.clientName = form.clientName;
        if (form.contactName !== undefined) payload.contactName = form.contactName;
        const result = await saveBookingDetails(payload);
        state.selectedLead = {
          ...state.selectedLead,
          eventName: form.title,
          targetVenue: form.venue,
          targetDate: form.startDate,
          ...(form.organizer !== undefined ? { organizer: form.organizer } : {}),
          ...(form.clientName !== undefined ? { clientName: form.clientName } : {}),
          ...(form.contactName !== undefined ? { contactName: form.contactName } : {})
        };
        await reload();
        openLead(
          state.leads.find((l) => l.id === state.selectedLead.id) || state.selectedLead
        );
        if (result.notes?.length) setStatus(result.notes.join(' · '));
        else setStatus('Details saved across linked records');
        return;
      }
      if (action === 'promote') {
        if (!state.selectedLead) return;
        setStatus('Adding to calendar…');
        const created = await promoteLead(state.selectedLead);
        await reload();
        const ev = state.events.find((x) => x.id === created.id) || (await getEventById(created.id));
        if (ev) openEvent(ev);
        return;
      }
      if (action === 'promote-merge') {
        if (!state.selectedLead) return;
        openMergeChooser(state.selectedLead);
        return;
      }
      if (action === 'merge-cancel') {
        if (state.selectedLead) openLead(state.selectedLead);
        return;
      }
      if (action === 'merge-confirm') {
        if (!state.selectedLead) return;
        const { eventId, retain } = readMergeForm(drawer.bodyEl);
        if (!eventId) {
          alert('Pick an event to merge into.');
          return;
        }
        setStatus('Merging…');
        const created = await mergeBookingIntoEvent(state.selectedLead, eventId, retain);
        await reload();
        const ev = state.events.find((x) => x.id === created.id) || (await getEventById(created.id));
        if (ev) openEvent(ev);
        return;
      }
      if (action === 'archive-lead') {
        if (!state.selectedLead?.id) return;
        const name =
          state.selectedLead.clientName ||
          state.selectedLead.quoteReference ||
          'this booking';
        if (!confirm(`Archive ${name}? It will leave Events (and Inbox if linked).`)) {
          return;
        }
        setStatus('Archiving…');
        await archiveBooking(state.selectedLead);
        state.leads = state.leads.filter((l) => l.id !== state.selectedLead.id);
        state.selectedLead = null;
        drawer.close();
        paint();
        setStatus(statusSummary());
        return;
      }
      if (action === 'view-event') {
        if (!state.selectedLead?.opsEventId) return;
        const ev =
          state.events.find((x) => x.id === state.selectedLead.opsEventId) ||
          (await getEventById(state.selectedLead.opsEventId));
        if (ev) openEvent(ev);
        return;
      }
      if (action === 'resplit-invoice') {
        const invoiceId = state.selectedEvent?.links?.invoiceId;
        if (!invoiceId) return;
        if (
          !confirm(
            'Replace this multi-day draft with one calendar event per invoice package day (correct cups each day)?'
          )
        ) {
          return;
        }
        setStatus('Splitting package days…');
        const inv = await getInvoiceById(invoiceId);
        if (!inv) throw new Error('Invoice not found');
        const created = await promoteInvoice(inv, { forceResplit: true });
        drawer.close();
        await reload();
        const ev =
          state.events.find((x) => x.id === created.id) || (await getEventById(created.id));
        if (ev) openEvent(ev);
        setStatus(
          created.ids?.length > 1
            ? `Created ${created.ids.length} package-day events`
            : statusSummary()
        );
        return;
      }
      if (action === 'open-invoice') {
        const invoiceId =
          btn.dataset.invoiceId ||
          state.selectedLead?.invoiceId ||
          state.selectedEvent?.links?.invoiceId;
        if (!invoiceId) return;
        const url = `../invoice-generator/invoices.html?id=${encodeURIComponent(invoiceId)}`;
        window.open(url, '_blank', 'noopener');
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Action failed');
      setStatus('Error');
    }
  };
}

async function handleDrop(eventId, ymd) {
  const ev = state.events.find((x) => x.id === eventId);
  if (!ev) return;
  const span = datesInRange(ev.startDate, ev.endDate || ev.startDate);
  const days = Math.max(1, span.length);
  const [y, m, d] = ymd.split('-').map(Number);
  const end = new Date(y, m - 1, d + days - 1);
  const endYmd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  try {
    await patchEvent(eventId, { startDate: ymd, endDate: endYmd, links: ev.links || {} });
    await saveBookingDetails({
      opsEventId: eventId,
      startDate: ymd,
      endDate: endYmd,
      links: ev.links || {}
    });
    await reload();
  } catch (err) {
    console.error(err);
    alert('Could not move event');
  }
}

function bindChrome() {
  els.prevMonthBtn.addEventListener('click', () => {
    let monthIndex = state.monthIndex - 1;
    let year = state.year;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
    navigateMonth(year, monthIndex);
  });
  els.nextMonthBtn.addEventListener('click', () => {
    let monthIndex = state.monthIndex + 1;
    let year = state.year;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    navigateMonth(year, monthIndex);
  });
  els.todayBtn.addEventListener('click', () => {
    const today = manilaTodayYmd();
    const [y, m] = today.split('-').map(Number);
    navigateMonth(y, m - 1);
  });

  document.querySelectorAll('.mode-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-toggle-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.filter = btn.dataset.filter || 'all';
      paint();
    });
  });

  els.addEventBtn.addEventListener('click', () => {
    const today = manilaTodayYmd();
    openEvent({
      title: '',
      typeId: null,
      status: EVENT_STATUSES.draft,
      startDate: today,
      endDate: today
    });
  });

  document.getElementById('drawerCloseBtn').addEventListener('click', () => drawer.close());

  els.unscheduledToggle.addEventListener('click', () => {
    state.unscheduledOpen = !state.unscheduledOpen;
    els.unscheduledList.hidden = !state.unscheduledOpen;
    els.unscheduledChevron.textContent = state.unscheduledOpen ? '▾' : '▸';
    els.unscheduledToggle.setAttribute('aria-expanded', String(state.unscheduledOpen));
  });
}

async function applyDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('event');
  const leadId = params.get('lead');
  const invoiceId = params.get('invoice');
  if (eventId) {
    const ev = state.events.find((e) => e.id === eventId) || (await getEventById(eventId));
    if (ev) {
      if (ev.startDate) {
        const [y, m] = ev.startDate.split('-').map(Number);
        state.year = y;
        state.monthIndex = m - 1;
        paint();
      }
      openEvent(ev);
    }
  } else if (invoiceId) {
    const invLead =
      state.leads.find((l) => l.invoiceId === invoiceId || l.id === `inv:${invoiceId}`) ||
      null;
    if (invLead) {
      openLead(invLead);
      return;
    }
    const inv = await getInvoiceById(invoiceId);
    if (inv?.opsEventId) {
      const ev = await getEventById(inv.opsEventId);
      if (ev) openEvent(ev);
    } else if (inv) {
      const { invoiceAsLeadOverlay } = await import('../../shared/js/ops-events.js?v=21');
      openLead(invoiceAsLeadOverlay(inv));
    }
  } else if (leadId) {
    const lead = state.leads.find((l) => l.id === leadId);
    if (lead) openLead(lead);
  }
}

async function boot() {
  initShell();
  bindChrome();
  try {
    const types = await seedAndLoadTypes();
    setTypes(types);
    setStatus('Syncing catalog…');
    try {
      const created = await runBackfill();
      if (created?.length) console.info(`Backfilled ${created.length} ops events from branches`);
    } catch (err) {
      console.warn('Backfill skipped:', err);
    }
    await reload();
    await applyDeepLink();
  } catch (err) {
    console.error(err);
    setStatus('Failed to start');
  }
}

boot();
