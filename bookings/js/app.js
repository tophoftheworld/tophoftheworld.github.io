/* Bookings — hash router, views and actions over live Firestore data (or ?mock=1). */
import * as U from './ui.js';
import { SERVICES, STAGES, PIPELINE_STAGES, CLOSED_GROUPS, channelLabel } from './constants.js';
import { createLiveRepo, createMockRepo } from './data/repo.js';
import { createLiveWriter, createMockWriter, allowedStages, planFieldEdit } from './data/writes.js';
import { loadConversation, resolveConversationId, inboxUrl } from './data/conversations.js';
import { invoiceBlockers, invoiceEditorUrl, mobileBarListPrice } from './data/invoice-builder.js';

const { esc, money, icon } = U;
const MOCK = new URLSearchParams(location.search).get('mock') === '1';

let repo;
let writer;
if (MOCK) {
  const M = await import('./mock-data.js');
  U.setNow(M.NOW);
  U.setStaff(M.STAFF);
  repo = createMockRepo(M);
  writer = createMockWriter(repo);
} else {
  repo = createLiveRepo();
  writer = createLiveWriter();
}

function loadPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function loadJsonPref(key, fallback) {
  try {
    const v = JSON.parse(loadPref(key, 'null'));
    return Array.isArray(v) ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

const state = {
  search: '',
  all: { stages: new Set(), service: '', sort: loadPref('bk.all.sort', 'date'), view: loadPref('bk.all.view', 'stage'), collapsed: new Set(loadJsonPref('bk.all.collapsed', [])), expanded: new Set() },
  board: { closed: new Set(), quietOpen: false },
  pipelineStage: 'inquiry',
  lastList: '#/all',
  activityOpen: false,
  chats: new Map(),
  awaitingId: null
};

const app = document.getElementById('app');
const byId = (id) => repo.find(id);
const bookings = () => repo.state.bookings;

/* ---------- Router ---------- */

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, id, tab] = h.split('/');
  if (view === 'b' && id) return { view: 'detail', id: decodeURIComponent(id), tab: tab || null };
  if (view === 'pipeline') return { view };
  return { view: 'all' };
}

let renderQueued = false;

/** Live snapshots re-render, but never while the user is typing in the page. */
function scheduleRender() {
  const active = document.activeElement;
  if (active && app.contains(active) && active.matches('input, textarea, select')) {
    renderQueued = true;
    return;
  }
  render();
}

function render() {
  renderQueued = false;
  if (!MOCK) U.setNow(new Date());
  closeMenus();
  const r = parseRoute();
  document.querySelectorAll('.bk-tab[data-view]').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.view === r.view || (r.view === 'detail' && state.lastList === `#/${t.dataset.view}`));
  });
  document.body.dataset.view = r.view;
  if (r.view !== 'detail') state.lastList = `#/${r.view}`;
  updateCounts();

  const { loading, error } = repo.state;
  if (loading) {
    app.innerHTML = renderLoading();
    return;
  }
  if (error && !bookings().length) {
    app.innerHTML = renderError(error);
    return;
  }

  if (r.view === 'pipeline') {
    app.innerHTML = renderPipeline();
    const board = app.querySelector('.bk-board');
    if (board) board.scrollLeft = boardScrollLeft;
  } else if (r.view === 'all') app.innerHTML = renderAll();
  else if (r.view === 'detail') {
    const b = byId(r.id);
    if (!b) {
      app.innerHTML = state.awaitingId === r.id
        ? renderLoading('Opening the new booking…')
        : `<div class="bk-page"><div class="bk-empty">That booking doesn’t exist anymore. <a href="#/all">Back to all bookings</a></div></div>`;
      return;
    }
    if (state.awaitingId === r.id) state.awaitingId = null;
    const tab = r.tab || defaultTab(b);
    app.innerHTML = renderDetail(b, tab);
    if (tab === 'conversation') ensureChat(b);
    const thread = app.querySelector('.bk-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function updateCounts() {
  const open = repo.state.loading ? '' : String(bookings().filter((b) => U.groupOf(b) === 'open').length);
  document.querySelectorAll('[data-count="all"], [data-count="pipeline"]').forEach((el) => { el.textContent = open; });
}

function renderLoading(text = 'Loading bookings…') {
  return `<div class="bk-page"><div class="bk-empty bk-loading"><span class="bk-spinner" aria-hidden="true"></span><strong>${esc(text)}</strong><span>Leads, invoices and events from Firestore.</span></div></div>`;
}

function renderError(err) {
  return `
    <div class="bk-page">
      <div class="bk-empty is-error">
        ${icon('alert')}
        <strong>Couldn’t load bookings</strong>
        <span>${esc(err?.message || String(err))}</span>
        <span><a href="">Retry</a> · <a href="?mock=1">Open with sample data</a></span>
      </div>
    </div>`;
}

function emptyState(title, body, ic) {
  return `<div class="bk-empty">${icon(ic || 'check')}<strong>${esc(title)}</strong><span>${esc(body)}</span></div>`;
}

/* ---------- List helpers ---------- */

/** Open bookings filter by stage; closed ones by their group (completed, expired, archived). */
function filterKey(b) {
  const g = U.groupOf(b);
  return g === 'open' ? b.stage : g;
}

function matchesSearch(b, q) {
  if (!q) return true;
  return [b.clientName, b.company, b.venue, b.eventType, b.eventName, b.ref, b.invoice?.number, b.email, b.phone, U.serviceLabel(b.service)]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

function needsRank(b) {
  return U.nextAction(b).rank;
}

function allSorter(kind) {
  if (kind === 'date') return (a, c) => (a.date || '9999').localeCompare(c.date || '9999');
  if (kind === 'recent') return (a, c) => new Date(c.createdAt) - new Date(a.createdAt);
  if (kind === 'value') return (a, c) => (c.invoice?.total ?? c.price ?? 0) - (a.invoice?.total ?? a.price ?? 0);
  return (a, c) => needsRank(a) - needsRank(c) || upcomingFirst(a, c);
}

function upcomingFirst(a, c) {
  const today = U.todayYmd();
  const key = (b) => (!b.date ? '3' : b.date >= today ? `1${b.date}` : `2${b.date}`);
  return key(a).localeCompare(key(c)) || new Date(c.lastActivityAt) - new Date(a.lastActivityAt);
}

/* ---------- Board ---------- */

function closedPill(id) {
  const g = CLOSED_GROUPS.find((x) => x.id === id);
  return `<span class="bk-stage-pill is-${esc(id)}">${esc(g.label)}</span>`;
}

function renderPipeline() {
  const all = bookings();
  const q = state.search.trim().toLowerCase();
  const sorter = allSorter('needs');
  const open = PIPELINE_STAGES.map((s) => ({
    id: s,
    pill: U.stagePill(s),
    items: all.filter((b) => U.groupOf(b) === 'open' && b.stage === s && matchesSearch(b, q)).sort(sorter)
  }));
  const closedCounts = Object.fromEntries(CLOSED_GROUPS.map((g) => [g.id, all.filter((b) => U.groupOf(b) === g.id && matchesSearch(b, q)).length]));
  const closed = CLOSED_GROUPS.filter((g) => state.board.closed.has(g.id)).map((g) => ({
    id: g.id,
    pill: closedPill(g.id),
    closed: true,
    items: all.filter((b) => U.groupOf(b) === g.id && matchesSearch(b, q))
      .sort((a, c) => String(c.archivedAt || c.date || '').localeCompare(String(a.archivedAt || a.date || '')))
  }));
  const cols = [...open, ...closed];
  if (!cols.some((c) => c.id === state.pipelineStage)) state.pipelineStage = 'inquiry';

  return `
    <div class="bk-page is-wide bk-pipeline">
      <header class="bk-page-head">
        <div><h1>Board</h1></div>
        <div class="bk-board-toggles" role="group" aria-label="Show closed columns">
          ${CLOSED_GROUPS.map((g) => `<button type="button" class="bk-filter-chip ${state.board.closed.has(g.id) ? 'is-on' : ''}" data-action="toggle-board-group" data-group="${g.id}" title="${esc(g.hint)}">${esc(g.label)} <span class="bk-chip-count">${closedCounts[g.id]}</span></button>`).join('')}
        </div>
      </header>

      <div class="bk-stage-switch" role="tablist">
        ${cols.map((c) => `<button type="button" role="tab" class="${state.pipelineStage === c.id ? 'is-active' : ''}" data-action="pipeline-stage" data-stage="${c.id}">${c.closed ? esc(CLOSED_GROUPS.find((g) => g.id === c.id).label) : esc(U.stageMeta(c.id).label)} <span>${c.items.length}</span></button>`).join('')}
      </div>

      <div class="bk-board">
        ${cols.map((c) => `
          <section class="bk-col ${c.closed ? 'is-closed' : ''} ${state.pipelineStage === c.id ? 'is-current' : ''}" data-stage="${c.id}">
            <header class="bk-col-head">
              <div class="bk-col-title">${c.pill} <span class="bk-count is-muted">${c.items.length}</span></div>
            </header>
            <div class="bk-col-body">${renderColumnBody(c)}</div>
          </section>`).join('')}
      </div>
    </div>`;
}

function renderColumnBody(c) {
  if (!c.items.length) return '<div class="bk-col-empty">Nothing here</div>';
  const card = (b) => U.bookingCard(b);
  if (c.id !== 'quoted') return c.items.map(card).join('');
  const active = c.items.filter((b) => !U.isQuiet(b));
  const quiet = c.items.filter((b) => U.isQuiet(b));
  return `
    ${active.length ? active.map(card).join('') : '<div class="bk-col-empty">No active quotes</div>'}
    ${quiet.length ? `
      <button type="button" class="bk-quiet-toggle" data-action="toggle-quiet" aria-expanded="${state.board.quietOpen}">
        ${icon('moon')}<span>Gone quiet</span><span class="bk-count is-muted">${quiet.length}</span><span class="bk-caret">${icon(state.board.quietOpen ? 'chevronUp' : 'chevron')}</span>
      </button>
      ${state.board.quietOpen ? `<div class="bk-quiet-list">${quiet.map(card).join('')}</div>` : ''}` : ''}`;
}

/* ---------- All ---------- */

function renderAll() {
  const f = state.all;
  const q = state.search.trim().toLowerCase();
  const base = bookings();
  let list = base.filter((b) => matchesSearch(b, q));
  const counts = {};
  for (const b of list) counts[filterKey(b)] = (counts[filterKey(b)] || 0) + 1;
  const hiddenClosed = f.stages.size ? 0 : list.filter((b) => U.groupOf(b) !== 'open').length;
  list = f.stages.size ? list.filter((b) => f.stages.has(filterKey(b))) : list.filter((b) => U.groupOf(b) === 'open');
  if (f.service) list = list.filter((b) => b.service === f.service);
  state.all.counts = counts;

  const groups = f.view === 'next' ? nextStepGroups(list) : stageGroups(list);

  return `
    <div class="bk-page bk-all ${f.view === 'next' ? 'is-by-next' : 'is-by-stage'}">
      <header class="bk-all-head">
        <h1>All bookings</h1>
        <div class="bk-toolbar">
          <div class="bk-seg" role="tablist" aria-label="Group by">
            <button type="button" role="tab" class="${f.view !== 'next' ? 'is-active' : ''}" data-action="all-view" data-view="stage">By stage</button>
            <button type="button" role="tab" class="${f.view === 'next' ? 'is-active' : ''}" data-action="all-view" data-view="next">By next step</button>
          </div>
          <button type="button" class="bk-select bk-stage-filter ${f.stages.size ? 'is-on' : ''}" data-action="stage-filter" aria-haspopup="true" title="${esc(stageFilterLabel())}">${esc(stageFilterLabel())}</button>
          <select class="bk-select bk-filter-service" data-filter="service" aria-label="Service">
            <option value="">All services</option>
            ${Object.entries(SERVICES).map(([k, v]) => `<option value="${k}" ${f.service === k ? 'selected' : ''}>${esc(v.short)}</option>`).join('')}
          </select>
          <select class="bk-select bk-filter-sort" data-filter="sort" aria-label="Sort">
            ${ALL_SORTS.map(([k, label]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>Sort: ${esc(label)}</option>`).join('')}
          </select>
          <span class="bk-toolbar-end">
            <span class="bk-toolbar-count">${list.length} shown${hiddenClosed ? `<span class="bk-muted"> · ${hiddenClosed} closed hidden</span>` : ''}</span>
            <button type="button" class="bk-link-btn ${hasFilters() ? '' : 'is-hidden'}" data-action="clear-filters" ${hasFilters() ? '' : 'tabindex="-1" aria-hidden="true"'}>Clear</button>
          </span>
        </div>
      </header>

      ${list.length ? groups.map(renderGroup).join('') : emptyState('No bookings match', 'Try clearing filters or searching for something else.', 'doc')}
    </div>`;
}

const ALL_SORTS = [['date', 'Event date'], ['updated', 'Last updated'], ['newest', 'Newest'], ['amount', 'Amount']];
const ROW_HEIGHT = 72;

const byEventDate = (a, c) => (a.date || '9999').localeCompare(c.date || '9999') || new Date(c.lastActivityAt) - new Date(a.lastActivityAt);
const newestFirst = (field) => (a, c) => String(c[field] || '').localeCompare(String(a[field] || ''));
const amountOf = (b) => b.invoice?.total ?? b.price ?? 0;

/** Sort inside a section. Event date runs soonest-first for open work and most-recent-first for closed sections. */
function sectionSorter(closedKey) {
  const s = state.all.sort;
  if (s === 'updated') return newestFirst('lastActivityAt');
  if (s === 'newest') return newestFirst('createdAt');
  if (s === 'amount') return (a, c) => amountOf(c) - amountOf(a) || byEventDate(a, c);
  if (closedKey === 'archived') return newestFirst('archivedAt');
  return closedKey ? newestFirst('date') : byEventDate;
}

function stageGroups(list) {
  const keys = state.all.stages.size
    ? [...PIPELINE_STAGES, ...CLOSED_GROUPS.map((g) => g.id)].filter((k) => state.all.stages.has(k))
    : PIPELINE_STAGES;
  return keys.map((k) => ({
    key: `stage:${k}`,
    head: CLOSED_GROUPS.some((g) => g.id === k) ? closedPill(k) : U.stagePill(k),
    items: list.filter((b) => filterKey(b) === k).sort(sectionSorter(['archived', 'expired', 'completed'].includes(k) ? k : ''))
  }));
}

function nextStepGroups(list) {
  const by = new Map();
  for (const b of list) {
    const a = U.nextAction(b);
    if (!by.has(a.key)) by.set(a.key, []);
    by.get(a.key).push(b);
  }
  return U.NEXT_ACTIONS.filter((a) => by.has(a.key)).map((a) => ({
    key: `next:${a.key}`,
    head: `<span class="bk-group-label">${esc(a.label)}</span>`,
    items: by.get(a.key).sort(sectionSorter(a.key === 'done' ? 'completed' : ['archived', 'expired'].includes(a.key) ? a.key : ''))
  }));
}

function sectionCap() {
  return Math.max(3, Math.floor(window.innerHeight / 3 / ROW_HEIGHT));
}

function renderGroup(g) {
  const collapsed = state.all.collapsed.has(g.key);
  const showAll = state.all.expanded.has(g.key);
  const cap = sectionCap();
  const capped = !showAll && g.items.length > cap + 1;
  const items = capped ? g.items.slice(0, cap) : g.items;
  const toggle = g.items.length > cap + 1
    ? `<button type="button" class="bk-group-more" data-action="toggle-more" data-group="${esc(g.key)}">${showAll ? 'Show less' : `Show all ${g.items.length}`}</button>`
    : '';
  return `
    <section class="bk-group ${collapsed ? 'is-collapsed' : ''}">
      <button type="button" class="bk-group-head" data-action="toggle-group" data-group="${esc(g.key)}" aria-expanded="${!collapsed}">
        <span class="bk-caret">${icon(collapsed ? 'chevron' : 'chevronUp')}</span>
        ${g.head}
        <span class="bk-count is-muted">${g.items.length}</span>
      </button>
      ${collapsed ? '' : g.items.length
        ? `<div class="bk-panel">${U.ROW_HEAD}<div class="bk-list bk-rows">${items.map((b) => U.bookingCard(b, { row: true, quick: true })).join('')}</div>${toggle}</div>`
        : '<div class="bk-group-empty">Nothing here</div>'}
    </section>`;
}

function saveAllPrefs() {
  try {
    localStorage.setItem('bk.all.view', state.all.view);
    localStorage.setItem('bk.all.sort', state.all.sort);
    localStorage.setItem('bk.all.collapsed', JSON.stringify([...state.all.collapsed]));
  } catch (_) { /* storage unavailable */ }
}

function stageFilterLabel() {
  const s = state.all.stages;
  if (!s.size) return 'Stage: Open';
  const labels = [...PIPELINE_STAGES.filter((id) => s.has(id)).map((id) => U.stageMeta(id).label), ...CLOSED_GROUPS.filter((g) => s.has(g.id)).map((g) => g.label)];
  return labels.length > 2 ? `Stage: ${labels.length} selected` : `Stage: ${labels.join(', ')}`;
}

function openStageFilter(anchor) {
  closeMenus();
  const s = state.all.stages;
  const counts = state.all.counts || {};
  const item = (id, label) => `
    <button type="button" class="bk-popover-item bk-check-item ${s.has(id) ? 'is-checked' : ''}" data-action="toggle-stage" data-stage="${id}" role="menuitemcheckbox" aria-checked="${s.has(id)}">
      <span class="bk-checkbox">${icon('check')}</span><span>${esc(label)}</span><span class="bk-chip-count">${counts[id] || 0}</span>
    </button>`;
  const menu = document.createElement('div');
  menu.className = 'bk-popover bk-stage-menu';
  menu.innerHTML = `
    ${PIPELINE_STAGES.map((id) => item(id, U.stageMeta(id).label)).join('')}
    <hr>
    ${CLOSED_GROUPS.map((g) => item(g.id, g.label)).join('')}
    <hr>
    <button type="button" class="bk-popover-item" data-action="stage-filter-reset" ${s.size ? '' : 'disabled'}>${icon('refresh')}<span>Open only</span></button>`;
  placePopover(menu, anchor, 'left');
}

function reopenStageFilter() {
  render();
  const btn = app.querySelector('.bk-stage-filter');
  if (btn) openStageFilter(btn);
}

function hasFilters() {
  const f = state.all;
  return f.stages.size || f.service || state.search;
}

/* ---------- Detail ---------- */

function defaultTab(b) {
  if (b.stage === 'booked' || b.stage === 'completed') return b.event ? 'event' : 'invoice';
  if (b.stage === 'invoiced' || b.kind === 'invoice') return 'invoice';
  return 'conversation';
}

function renderDetail(b, tab) {
  const step = U.nextStep(b);
  const backLabel = state.lastList === '#/pipeline' ? 'Board' : 'All bookings';
  const chatCount = MOCK ? (b.chat || []).length : state.chats.get(b.id)?.messages?.length;

  return `
    <div class="bk-detail">
      <div class="bk-detail-shell">
        <aside class="bk-detail-left">
          <a class="bk-back" href="${state.lastList}">← ${backLabel}</a>

          <header class="bk-client">
            ${U.avatar(b.clientName, 'lg')}
            <div class="bk-client-main">
              <h1>${esc(U.displayNames(b).title)}</h1>
              <div class="bk-client-sub">${esc([U.displayNames(b).contact, b.eventName || b.eventType].filter(Boolean).join(' · ') || U.serviceLabel(b.service))}</div>
              <div class="bk-client-contact">
                ${U.channelIcon(b.channel)}
                ${b.email ? `<span>${esc(b.email)}</span>` : ''}
                ${b.phone ? `<span>${esc(b.phone)}</span>` : ''}
                ${!b.email && !b.phone ? `<span class="bk-muted">via ${esc(channelLabel(b.channel))}</span>` : ''}
              </div>
            </div>
            <div class="bk-client-actions">
              <button type="button" class="bk-stage-btn is-lg" data-stage-menu="${esc(b.id)}">${U.stagePill(b.stage, '', `<span class="bk-caret">${icon('chevron')}</span>`)}</button>
            </div>
          </header>

          ${renderStepper(b)}

          ${step ? `
          <section class="bk-next ${step.tone ? 'is-' + step.tone : ''}">
            <p class="bk-eyebrow">Next step</p>
            <div class="bk-next-title">${esc(step.title)}</div>
            ${step.body ? `<p class="bk-next-body">${esc(step.body)}</p>` : ''}
            <div class="bk-next-actions">
              <button type="button" class="inv-btn inv-btn-primary" data-action="${step.action}" data-id="${esc(b.id)}">${esc(step.label)}</button>
              ${step.secondary ? `<button type="button" class="inv-btn inv-btn-secondary" data-action="${step.secondary.action}" data-id="${esc(b.id)}">${esc(step.secondary.label)}</button>` : ''}
              ${step.moved && b.invoiceId && !MOCK ? `<a class="inv-btn inv-btn-secondary" href="${esc(invoiceEditorUrl(b.invoiceId))}" target="_blank" rel="noopener" title="Change the date on the invoice">Moved</a>` : ''}
            </div>
          </section>` : ''}

          <section class="bk-form-section">
            <p class="bk-eyebrow">Details</p>
            <div class="bk-fields">
              ${fieldSelect(b, 'service', 'Service', Object.entries(SERVICES).map(([k, v]) => [k, v.label]))}
              ${b.kind === 'lead' ? field(b, 'eventType', 'Event type', 'text', 'Wedding, corporate…') : ''}
              ${field(b, 'eventName', 'Event name', 'text', 'Optional', true)}
              ${field(b, 'date', 'Event date', 'date', '', false, true)}
              ${b.kind === 'lead' ? field(b, 'time', 'Time', 'text', '2:00–6:00 PM') : ''}
              ${field(b, 'pax', `Pax (${SERVICES[b.service]?.unit || 'pax'})`, 'number', b.paxNote || '120', false, true)}
              ${field(b, 'price', b.invoice ? 'Invoice total' : 'Quoted price', 'number', b.priceNote || 'Php', false, b.stage === 'quoted')}
              ${field(b, 'venue', 'Venue', 'text', 'Where is it?', true, true)}
            </div>
            ${b.invoiceId ? `<p class="bk-muted bk-small">Date, venue, pax and price follow the invoice. <a href="${esc(invoiceEditorUrl(b.invoiceId))}" target="_blank" rel="noopener">Edit invoice ${icon('open')}</a></p>` : ''}
          </section>

          <section class="bk-form-section">
            <p class="bk-eyebrow">Contact</p>
            <div class="bk-fields">
              ${field(b, 'clientName', 'Name', 'text', '', true, true)}
              ${field(b, 'company', 'Company', 'text', 'Optional')}
              ${field(b, 'email', 'Email', 'email', 'name@email.com')}
              ${field(b, 'phone', 'Phone', 'tel', '09xx')}
            </div>
          </section>

          <section class="bk-form-section">
            <p class="bk-eyebrow">Notes</p>
            <textarea class="bk-notes" data-field="notes" rows="3" placeholder="Anything the team should know…">${esc(b.notes || '')}</textarea>
          </section>

          <section class="bk-form-section">
            <button type="button" class="bk-activity-toggle" data-action="toggle-activity" aria-expanded="${state.activityOpen}">
              <span class="bk-eyebrow">Activity</span>
              <span class="bk-muted">${b.activity.length} events</span>
              <span class="bk-caret">${icon(state.activityOpen ? 'chevronUp' : 'chevron')}</span>
            </button>
            ${state.activityOpen ? `<ol class="bk-activity">${b.activity.map((a) => `
              <li class="is-${a.kind}">
                <span class="bk-act-dot"></span>
                <div><div>${esc(a.text)}</div>
                ${a.detail ? `<div class="bk-muted bk-act-detail">${esc(a.detail.join(', '))}</div>` : ''}
                <div class="bk-muted bk-act-time">${esc(U.relTime(a.at))}${a.kind === 'bot' ? ' · Bot' : a.kind === 'human' ? ' · Staff' : ''}</div></div>
              </li>`).join('')}</ol>` : ''}
          </section>

          ${renderRecord(b)}
        </aside>

        <section class="bk-detail-right">
          <nav class="bk-dtabs" role="tablist">
            ${dtab(b, 'conversation', 'Conversation', canHaveChat(b) || b.chat?.length ? (chatCount != null ? `<span class="bk-dtab-meta">${chatCount}</span>` : '') : '<span class="bk-dtab-meta">None</span>', tab)}
            ${dtab(b, 'invoice', 'Invoice', b.invoice ? U.invoicePill(b.invoice) : '<span class="bk-dtab-meta">None</span>', tab)}
            ${dtab(b, 'event', 'Event', b.event ? `<span class="inv-pill ${b.event.status === 'confirmed' ? 'is-calendar' : 'is-draft'}">${b.event.status === 'confirmed' ? 'Confirmed' : 'Draft'}</span>` : '<span class="bk-dtab-meta">None</span>', tab)}
          </nav>
          <div class="bk-dtab-body">
            ${tab === 'conversation' ? renderConversation(b) : tab === 'invoice' ? renderInvoiceTab(b) : renderEventTab(b)}
          </div>
        </section>
      </div>

      <footer class="bk-actionbar">
        <span class="bk-save-status" id="saveStatus">${icon('check')}${MOCK ? 'Sample data · not saved' : 'Saved to Firestore'}</span>
        <div class="bk-actionbar-btns">
          ${b.archived
            ? `<button type="button" class="inv-btn inv-btn-ghost" data-action="restore" data-id="${esc(b.id)}">${icon('refresh')}Restore</button>`
            : `<button type="button" class="inv-btn inv-btn-ghost" data-action="archive" data-id="${esc(b.id)}">${icon('archive')}Archive</button>`}
          <a class="inv-btn inv-btn-secondary" href="../events/admin.html" target="_top">${icon('calendar')}Open in Events</a>
        </div>
      </footer>
    </div>`;
}

function renderRecord(b) {
  const id = (label, value) => value
    ? `<div class="bk-record-row"><span>${label}</span><button type="button" class="bk-record-copy" data-action="copy-id" data-copy="${esc(value)}" title="Copy">${esc(value)}</button></div>`
    : '';
  return `
    <section class="bk-form-section bk-record">
      <p class="bk-eyebrow">Record</p>
      ${id(b.kind === 'invoice' ? 'Invoice' : 'Ref', b.ref)}
      <div class="bk-record-row"><span>Source</span><span>${esc(channelLabel(b.channel))}</span></div>
      <div class="bk-record-row"><span>Created</span><span>${esc(U.relTime(b.createdAt))}</span></div>
      ${id('Lead ID', b.leadId)}
      ${id('Invoice ID', b.invoiceId)}
      ${id('Event ID', b.event?.id)}
    </section>`;
}

function renderStepper(b) {
  const steps = STAGES.map((s) => s.id);
  const idx = steps.indexOf(b.stage);
  const group = U.groupOf(b);
  if (group === 'archived' || group === 'expired') {
    const text = group === 'archived' ? `Archived${b.archivedAt ? ` ${U.relTime(b.archivedAt)}` : ''} · was ${U.stageMeta(b.stage).label}` : `Expired · ${U.expiredReason(b)}`;
    return `<div class="bk-stepper-note is-closed">${icon(group === 'archived' ? 'archive' : 'moon')}${esc(text)}</div>`;
  }
  return `<ol class="bk-stepper">${steps.map((s, i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-current' : ''}"><span class="bk-step-dot">${i < idx ? icon('check') : ''}</span><span class="bk-step-label">${esc(U.stageMeta(s).label)}</span></li>`).join('')}</ol>`;
}

function dtab(b, id, label, meta, current) {
  return `<a role="tab" class="bk-dtab ${current === id ? 'is-active' : ''}" href="#/b/${encodeURIComponent(b.id)}/${id}" aria-selected="${current === id}">${esc(label)} ${meta}</a>`;
}

function lockedReason(b, key) {
  const plan = planFieldEdit(b, key, '');
  if (plan.target !== 'locked') return '';
  return b.invoiceId ? 'From invoice' : plan.reason;
}

function field(b, key, label, type, placeholder, wide, required) {
  const val = b[key] ?? '';
  const empty = val === '' || val == null;
  const locked = lockedReason(b, key);
  return `
    <label class="bk-field ${wide ? 'is-wide' : ''} ${required ? 'is-required' : ''} ${required && empty && !locked ? 'is-empty' : ''}">
      <span class="bk-field-label">${esc(label)}${locked ? ` <em>${esc(locked)}</em>` : ''}</span>
      <input type="${type}" data-field="${key}" value="${esc(val)}" placeholder="${esc(placeholder || '')}" ${locked ? 'disabled' : ''}>
    </label>`;
}

function fieldSelect(b, key, label, options) {
  const locked = lockedReason(b, key);
  return `
    <label class="bk-field is-required ${b[key] || locked ? '' : 'is-empty'}">
      <span class="bk-field-label">${esc(label)}${locked ? ` <em>${esc(locked)}</em>` : ''}</span>
      <select data-field="${key}" ${locked ? 'disabled' : ''}>
        <option value="">Not set</option>
        ${options.map(([v, l]) => `<option value="${v}" ${b[key] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
    </label>`;
}

/* ----- Conversation tab ----- */

function canHaveChat(b) {
  return !!(b.conversationId || (b.channel === 'chatbot' && b.ref));
}

/** Loads the chat once per booking; chatbot leads without a stored id are matched by quote reference. */
function ensureChat(b) {
  if (MOCK || !canHaveChat(b)) return;
  if (state.chats.has(b.id)) return;
  state.chats.set(b.id, { status: 'loading' });
  (async () => {
    let conversationId = b.conversationId;
    if (!conversationId) {
      conversationId = await resolveConversationId({ quoteReference: b.ref, createdAt: b.createdAt, updatedAt: b.raw?.lead?.updatedAt });
      if (!conversationId) return { status: 'unmatched' };
      writer.linkConversation(b, conversationId).catch((err) => console.warn('[bookings] could not save chat link', err));
    }
    const messages = await loadConversation(conversationId, { createdAt: b.createdAt });
    return { status: 'ready', conversationId, messages };
  })()
    .then((entry) => state.chats.set(b.id, entry))
    .catch((error) => state.chats.set(b.id, { status: 'error', error }))
    .finally(() => {
      const r = parseRoute();
      if (r.view === 'detail' && r.id === b.id) scheduleRender();
    });
}

function renderConversation(b) {
  const who = { client: b.clientName, bot: 'Matchanese bot', staff: 'Staff' };
  const entry = state.chats.get(b.id) || { status: 'loading' };
  const conversationId = b.conversationId || entry.conversationId;
  let body;
  if (MOCK) {
    body = renderThread(b.chat || [], who, b);
  } else if (!canHaveChat(b)) {
    body = `<div class="bk-thread-empty">${b.channel === 'manual' ? 'Created manually, so there is no linked chat.' : b.kind === 'invoice' ? 'Created from an invoice, so there is no linked chat.' : 'No chat is linked to this lead yet.'}</div>`;
  } else if (entry.status === 'loading') {
    body = `<div class="bk-thread-empty"><span class="bk-spinner" aria-hidden="true"></span> ${b.conversationId ? 'Loading conversation…' : `Finding the chat with quote ${esc(b.ref)}…`}</div>`;
  } else if (entry.status === 'unmatched') {
    body = `<div class="bk-thread-empty">Couldn’t find this lead’s chat. Chats are matched by the quote reference ${esc(b.ref)} appearing in the conversation.<br><button type="button" class="bk-link-btn" data-action="reload-chat" data-id="${esc(b.id)}">Search again</button></div>`;
  } else if (entry.status === 'error') {
    body = `<div class="bk-thread-empty">Couldn’t load the chat: ${esc(entry.error?.message || 'unknown error')}<br><button type="button" class="bk-link-btn" data-action="reload-chat" data-id="${esc(b.id)}">Try again</button></div>`;
  } else {
    body = renderThread(entry.messages, who, b);
  }
  return `
    <div class="bk-convo">
      <div class="bk-convo-head">
        ${U.channelIcon(b.channel)}
        <span>${esc(channelLabel(b.channel))}${b.channel === 'chatbot' ? ' conversation' : ''}</span>
        ${conversationId ? `<a class="bk-link-btn" href="${esc(inboxUrl(conversationId))}" target="_blank" rel="noopener">Open in Inbox ${icon('open')}</a>` : ''}
      </div>
      <div class="bk-thread">${body}</div>
      ${conversationId ? '<p class="bk-composer-note">Read-only. Reply to the client from the inbox or Messenger.</p>' : ''}
    </div>`;
}

function renderThread(messages, who, b) {
  if (!messages.length) return '<div class="bk-thread-empty">No messages in this conversation.</div>';
  return messages.map((m) => `
    <div class="bk-msg is-${esc(m.from)}">
      <div class="bk-msg-meta">${esc(who[m.from] || m.from)}${m.at ? ` · ${esc(U.relTime(m.at))}` : ''}</div>
      <div class="bk-bubble">${esc(m.text)}</div>
    </div>`).join('');
}

/* ----- Invoice tab ----- */

function renderInvoiceTab(b) {
  if (!b.invoice) {
    const blockers = invoiceBlockers(b);
    const autoPrice = !b.price && (b.service === 'mobile_bar' || b.service === 'matcha_popup') && b.pax ? mobileBarListPrice('starter', b.pax) : null;
    const carry = [
      ['Client', b.clientName], ['Company', b.company], ['Service', b.service ? U.serviceLabel(b.service) : ''],
      ['Date', U.fmtDate(b.date, { weekday: 'short', year: 'numeric' })], ['Pax', U.paxLabel(b)], ['Venue', b.venue],
      ['Price', b.price ? money(b.price) : autoPrice ? `${money(autoPrice)} (Starter rate)` : '']
    ];
    return `
      <div class="bk-inv-empty">
        <div class="bk-inv-empty-card">
          ${icon('doc')}
          <h3>No invoice yet</h3>
          <p>Creating one makes a draft in the invoice generator from these details. Review it there before publishing.</p>
          <dl class="bk-carry">
            ${carry.map(([k, v]) => `<div class="${v ? '' : 'is-missing'}"><dt>${k}</dt><dd>${v ? esc(v) : 'Missing'}</dd></div>`).join('')}
          </dl>
          <button type="button" class="inv-btn inv-btn-primary" data-action="create-invoice" data-id="${esc(b.id)}" ${blockers.length ? 'disabled' : ''}>Create draft invoice</button>
          ${blockers.length ? `<p class="bk-muted bk-small">Fill in ${esc(blockers.join(', '))} first.</p>` : ''}
        </div>
      </div>`;
  }
  const inv = b.invoice;
  const f = U.invoiceFacts(inv);
  const days = inv.days?.length ? inv.days : [{ date: b.date, venue: b.venue, count: b.pax, description: inv.packageLabel }];
  return `
    <div class="bk-inv">
      ${inv.proofPending ? `
        <div class="bk-banner is-ok">
          ${icon('cash')}
          <div><strong>Proof uploaded</strong><span>${money(inv.pendingAmount)}</span></div>
          <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="confirm-payment" data-id="${esc(b.id)}">Confirm</button>
        </div>` : ''}
      ${!inv.published ? `
        <div class="bk-banner is-warn">
          ${icon('doc')}
          <div><strong>Draft</strong><span>Not visible to the client</span></div>
          <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="publish-invoice" data-id="${esc(b.id)}">Publish</button>
        </div>` : ''}

      <div class="bk-inv-toolbar">
        <span class="bk-muted">Customer page preview</span>
        <div class="bk-inv-toolbar-btns">
          <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="copy-link" data-id="${esc(b.id)}">${icon('link')}${inv.published ? 'Copy link' : 'Publish'}</button>
          ${inv.published && inv.publicToken ? `<a class="inv-btn inv-btn-secondary inv-btn-sm" href="https://matchanese-invoice.web.app/i/${esc(inv.publicToken)}" target="_blank" rel="noopener">Customer page ${icon('open')}</a>` : ''}
          ${b.invoiceId && !MOCK ? `<a class="inv-btn inv-btn-secondary inv-btn-sm" href="${esc(invoiceEditorUrl(b.invoiceId))}" target="_blank" rel="noopener">Edit invoice ${icon('open')}</a>` : ''}
        </div>
      </div>

      <div class="bk-inv-preview">
        <div class="bk-inv-hero">
          <img src="../invoice-generator/img/matchanese-logo-full.png" alt="Matchanese" class="bk-inv-logo">
          <div class="bk-inv-hero-right">
            <div class="bk-inv-no">${esc(inv.number)}</div>
            ${inv.invoiceDate ? `<div class="bk-muted">Issued ${esc(U.fmtDate(inv.invoiceDate, { year: 'numeric' }))}</div>` : ''}
          </div>
        </div>
        <div class="bk-inv-billto">
          <p class="bk-eyebrow">Billed to</p>
          <div class="bk-inv-client">${esc(b.company || b.clientName)}</div>
          ${b.company ? `<div class="bk-muted">${esc(b.clientName)}</div>` : ''}
        </div>

        <div class="bk-inv-block">
          <p class="bk-eyebrow">Your booking</p>
          ${days.map((d) => `
            <div class="bk-inv-item">
              <div>
                <div class="bk-inv-item-title">${esc(d.description || U.serviceLabel(b.service))}</div>
                <div class="bk-muted">${esc([d.count ? `${d.count} ${SERVICES[d.typeId || b.service]?.unit || 'pax'}` : '', d.venue].filter(Boolean).join(' · '))}</div>
                <div class="bk-muted">${esc(U.fmtDate(d.date, { weekday: 'short', year: 'numeric' }))}${b.time ? ` · ${esc(b.time)}` : ''}</div>
              </div>
            </div>`).join('')}
          <div class="bk-inv-total"><span>Total</span><span>${money(inv.total)}</span></div>
        </div>

        <div class="bk-inv-block">
          <p class="bk-eyebrow">Payment schedule</p>
          <ol class="bk-milestones">
            ${inv.milestones.map((m, i) => {
              const n = U.daysUntil(m.date);
              const isNext = f.next === m;
              const got = U.receivedOn(m);
              const settleable = !U.isCollected(m) && !m.pending && U.leftOn(m) > 0.5;
              let st = 'Upcoming';
              let cls = '';
              if (U.isCollected(m)) { st = 'Paid'; cls = 'is-paid'; }
              else if (m.pending) { st = 'Proof sent'; cls = 'is-sent'; }
              else if (got > 0.5) { st = 'Partial'; cls = 'is-partial'; }
              else if (isNext && n != null && n < 0 && b.stage !== 'completed') { st = `${-n}d overdue`; cls = 'is-overdue'; }
              else if (isNext && b.stage !== 'completed') { st = n === 0 ? 'Due today' : n != null ? `Due ${U.relDays(m.date)}` : 'Due'; cls = 'is-due'; }
              else if (b.stage === 'completed') st = 'Unpaid';
              return `
                <li class="${cls}">
                  <span class="bk-ms-dot">${U.isCollected(m) ? icon('check') : ''}</span>
                  <div class="bk-ms-main"><div>${esc(m.label)} <span class="bk-muted">· ${m.pct}%</span></div><div class="bk-muted">${esc(U.fmtDate(m.date, { year: 'numeric' }))}</div></div>
                  <div class="bk-ms-side">
                    <div class="bk-ms-amt">${got > 0.5 && !U.isCollected(m) ? `${money(got)} <span class="bk-muted">of ${money(m.amount)}</span>` : money(m.amount)}</div>
                    <div class="bk-ms-status">${esc(st)}</div>
                    ${settleable ? `<button type="button" class="bk-ms-settle" data-action="settle" data-id="${esc(b.id)}" data-ms="${i}">Settle</button>` : ''}
                  </div>
                </li>`;
            }).join('')}
          </ol>
          <div class="bk-inv-balance ${f.remaining <= 0.5 ? 'is-clear' : ''}">
            <span>${f.remaining <= 0.5 ? 'Fully paid' : 'Balance'}</span>
            <strong>${f.remaining <= 0.5 ? money(f.paid) : money(f.remaining)}</strong>
          </div>
          ${f.remaining > 0.5 ? `
          <div class="bk-inv-pay-actions">
            <button type="button" class="inv-btn inv-btn-secondary" data-action="record-payment" data-id="${esc(b.id)}">Record payment</button>
            <button type="button" class="inv-btn inv-btn-primary" data-action="settle" data-id="${esc(b.id)}">Settle all</button>
          </div>` : ''}
        </div>
      </div>
    </div>`;
}

/* ----- Event tab ----- */

function renderEventTab(b) {
  if (!b.event) {
    const canAdd = !!b.date;
    return `
      <div class="bk-inv-empty">
        <div class="bk-inv-empty-card">
          ${icon('calendar')}
          <h3>Not on the calendar yet</h3>
          <p>${b.stage === 'booked' ? 'This is booked, so it should be on the calendar for staffing, menu and purchasing.' : 'Add a draft hold so the date is blocked while you close the deal.'}</p>
          <button type="button" class="inv-btn inv-btn-primary" data-action="add-event" data-id="${esc(b.id)}" ${canAdd ? '' : 'disabled'}>${b.stage === 'booked' ? 'Add to calendar' : 'Hold the date'}</button>
          ${canAdd ? '' : '<p class="bk-muted bk-small">Set an event date first.</p>'}
        </div>
      </div>`;
  }
  const ev = b.event;
  const date = ev.startDate || b.date;
  const endDate = ev.endDate && ev.endDate !== ev.startDate ? ev.endDate : null;
  const n = U.daysUntil(date);
  const staff = Array.isArray(ev.staff) ? ev.staff : null;
  const headcount = ev.headcount ? `${ev.headcount} ${ev.headcountUnit || SERVICES[b.service]?.unit || 'pax'}` : U.paxLabel(b);
  return `
    <div class="bk-event">
      <div class="bk-event-hero">
        <div class="bk-datebox is-lg ${n != null && n >= 0 && n <= 7 ? 'is-soon' : ''}">
          <span class="bk-datebox-m">${esc(U.fmtDate(date, { month: 'short', day: undefined }))}</span>
          <span class="bk-datebox-d">${esc(U.fmtDate(date, { month: undefined, day: 'numeric' }))}</span>
        </div>
        <div class="bk-event-main">
          <div class="bk-event-title">${esc(ev.title || `${b.eventType || U.serviceLabel(b.service)} · ${b.clientName}`)}</div>
          <div class="bk-muted">${esc(U.fmtDateRange({ date, endDate }))}${ev.time || b.time ? ` · ${esc(ev.time || b.time)}` : ''}${date ? ` · ${esc(U.relDays(date))}` : ''}</div>
          <div class="bk-muted">${esc([ev.venue || b.venue, headcount].filter(Boolean).join(' · '))}</div>
        </div>
        <span class="inv-pill ${ev.status === 'confirmed' ? 'is-calendar' : 'is-draft'}">${ev.status === 'confirmed' ? 'Confirmed' : 'Draft hold'}</span>
      </div>

      ${ev.status !== 'confirmed' ? `
        <div class="bk-banner is-info">
          ${icon('calendar')}
          <div><strong>Draft hold</strong><span>Confirming opens it up to Schedule, POS, Purchasing and Expenses.</span></div>
          <button type="button" class="inv-btn inv-btn-primary inv-btn-sm" data-action="confirm-event" data-id="${esc(b.id)}">Confirm event</button>
        </div>` : ''}

      <div class="bk-staff-strip">
        <p class="bk-eyebrow">Team</p>
        ${staff
          ? (staff.length ? `<div class="bk-staff-list">${staff.map(U.staffAvatar).join('')}</div>` : `<div class="bk-staff-none">${icon('alert')}No one scheduled yet</div>`)
          : `<div class="bk-staff-none is-muted">Staffing lives in Events and Schedule. <a class="bk-link-btn" href="../events/admin.html" target="_top">Open in Events ${icon('open')}</a></div>`}
      </div>

      <div class="bk-widgets">
        ${[
          { title: 'Schedule', ic: 'people', value: staff ? `${staff.length} staff` : 'Open in Events' },
          { title: 'Branch', ic: 'doc', value: ev.branchKey || (ev.status === 'confirmed' ? 'Provisioning…' : 'Created on confirm') },
          { title: 'Purchasing', ic: 'cash', value: 'Coming soon', soon: true },
          { title: 'Expenses', ic: 'cash', value: 'Coming soon', soon: true }
        ].map((w) => `
          <div class="bk-widget ${w.soon ? 'is-soon' : ''}">
            <div class="bk-widget-head">${icon(w.ic)}<span>${esc(w.title)}</span>${w.soon ? '<span class="bk-soon-tag">Coming soon</span>' : ''}</div>
            <div class="bk-widget-value">${esc(w.value)}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ---------- Menus & modals ---------- */

function closeMenus() {
  document.querySelectorAll('.bk-popover').forEach((p) => p.remove());
}

function openStageMenu(anchor, id) {
  closeMenus();
  const b = byId(id);
  if (!b) return;
  const allowed = new Set(allowedStages(b));
  const menu = document.createElement('div');
  menu.className = 'bk-popover';
  menu.innerHTML = `
    <div class="bk-popover-title">Move to</div>
    ${b.archived ? `<button type="button" class="bk-popover-item" data-action="restore" data-id="${esc(id)}">${icon('refresh')}<span>Restore from archive</span></button><hr>` : ''}
    ${!b.archived && b.stage === 'completed' ? `<button type="button" class="bk-popover-item" data-action="reopen" data-id="${esc(id)}">${icon('refresh')}<span>Reopen</span></button><hr>` : ''}
    ${STAGES.map((s) => {
      const current = b.stage === s.id;
      const disabled = !current && !allowed.has(s.id);
      return `
      <button type="button" class="bk-popover-item ${current ? 'is-current' : ''}" data-action="set-stage" data-id="${esc(id)}" data-stage="${s.id}" ${disabled ? 'disabled title="Follows invoice payments"' : ''}>
        ${U.stagePill(s.id)}<span class="bk-muted">${esc(disabled ? 'From payments' : s.id === 'booked' && b.stage === 'invoiced' ? 'Book before the deposit' : s.hint)}</span>${current ? icon('check') : ''}
      </button>`;
    }).join('')}`;
  placePopover(menu, anchor);
}

function placePopover(menu, anchor, align) {
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.min(Math.max(8, align === 'left' ? r.left : r.right - w), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;
}

function modal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="bk-modal-overlay" data-action="close-modal"><div class="bk-modal" role="dialog" aria-modal="true">${html}</div></div>`;
  root.querySelector('input, select, textarea, button.inv-btn-primary')?.focus();
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function suggestPrice(b) {
  if (!b.pax) return null;
  if (b.service === 'mobile_bar' || b.service === 'matcha_popup') return mobileBarListPrice('starter', b.pax);
  return null;
}

function quoteMessage(b, price) {
  const first = b.clientName.split(' ')[0];
  return `Hi ${first}! For ${U.paxLabel(b) || 'your event'} on ${U.fmtDate(b.date) || 'your date'}, our quote is Php ${price ? Number(price).toLocaleString('en-PH') : '—'}. Let us know and we’ll send the invoice to lock the date 🍵`;
}

function quoteModal(id) {
  const b = byId(id);
  const suggested = b.price || suggestPrice(b);
  modal(`
    <header class="bk-modal-head"><h3>Record quote for ${esc(b.clientName.split(' ')[0])}</h3></header>
    <div class="bk-modal-body">
      <label class="bk-field is-wide"><span class="bk-field-label">Price (Php)</span><input type="number" id="quotePrice" value="${suggested || ''}"></label>
      ${!b.price && suggested ? `<p class="bk-muted bk-small">Starter package rate for ${esc(U.paxLabel(b))}.</p>` : ''}
      <label class="bk-field is-wide"><span class="bk-field-label">Message to send</span><textarea id="quoteMsg" rows="4">${esc(quoteMessage(b, suggested))}</textarea></label>
      <p class="bk-muted bk-small">Saving moves this to Quoted. Send the message yourself from the inbox or Messenger.</p>
    </div>
    <footer class="bk-modal-foot">
      <button type="button" class="inv-btn inv-btn-ghost" data-action="close-modal">Cancel</button>
      <button type="button" class="inv-btn inv-btn-secondary" data-action="copy-quote-msg">${icon('link')}Copy message</button>
      <button type="button" class="inv-btn inv-btn-primary" data-action="confirm-quote" data-id="${esc(id)}">Save quote</button>
    </footer>`);
}

const PAY_METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['bank', 'Bank'], ['other', 'Other']];

/** `ms`: settle one milestone. `custom`: any amount. Neither: the full balance. */
function paymentModal(b, { ms = null, custom = false } = {}) {
  const f = U.invoiceFacts(b.invoice);
  const m = ms != null ? b.invoice.milestones[ms] : null;
  const nextDue = f.next ? U.leftOn(f.next) : 0;
  const amount = m ? U.leftOn(m) : custom ? nextDue || f.remaining : f.remaining;
  const title = m ? `Settle ${m.label}` : custom ? 'Record payment' : 'Settle all';
  const chip = (label, value) => `<button type="button" class="bk-pay-chip ${Math.abs(value - amount) < 0.5 ? 'is-on' : ''}" data-action="pay-fill" data-amount="${value}">${esc(label)} ${money(value)}</button>`;
  modal(`
    <header class="bk-modal-head"><h3>${esc(title)}</h3></header>
    <div class="bk-modal-body bk-pay">
      <label class="bk-field is-wide"><span class="bk-field-label">Amount (Php)</span><input type="number" id="payAmount" min="0" step="0.01" value="${Math.round(amount * 100) / 100}"></label>
      ${!m ? `<div class="bk-pay-chips">${nextDue > 0.5 && Math.abs(nextDue - f.remaining) > 0.5 ? chip('Next due', nextDue) : ''}${chip('Full', f.remaining)}</div>` : ''}
      <div class="bk-field is-wide"><span class="bk-field-label">Method</span>
        <div class="bk-pay-seg" role="radiogroup">${PAY_METHODS.map(([v, l], i) => `<label><input type="radio" name="payMethod" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </div>
      <div class="bk-pay-row">
        <label class="bk-field"><span class="bk-field-label">Date</span><input type="date" id="payDate" value="${U.todayYmd()}"></label>
        <label class="bk-field"><span class="bk-field-label">Reference</span><input id="payRef" placeholder="Optional"></label>
      </div>
    </div>
    <footer class="bk-modal-foot">
      <button type="button" class="inv-btn inv-btn-ghost" data-action="close-modal">Cancel</button>
      <button type="button" class="inv-btn inv-btn-primary" data-action="save-payment" data-id="${esc(b.id)}" ${m ? `data-ms="${ms}"` : ''}>Save</button>
    </footer>`);
}

function newBookingModal() {
  modal(`
    <header class="bk-modal-head"><h3>New booking</h3></header>
    <div class="bk-modal-body bk-fields">
      <label class="bk-field is-wide"><span class="bk-field-label">Client name</span><input id="nbName" placeholder="Who is it for?"></label>
      <label class="bk-field"><span class="bk-field-label">Service</span>
        <select id="nbService">${Object.entries(SERVICES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
      <label class="bk-field"><span class="bk-field-label">Event date</span><input id="nbDate" type="date"></label>
      <label class="bk-field"><span class="bk-field-label">Pax</span><input id="nbPax" type="number" placeholder="100"></label>
      <label class="bk-field"><span class="bk-field-label">Venue</span><input id="nbVenue" placeholder="Optional"></label>
    </div>
    <footer class="bk-modal-foot">
      <button type="button" class="inv-btn inv-btn-ghost" data-action="close-modal">Cancel</button>
      <button type="button" class="inv-btn inv-btn-primary" data-action="create-booking">Create</button>
    </footer>`);
}

/* ---------- Actions ---------- */

function fail(err) {
  console.error('[bookings]', err);
  U.toast(err?.message || 'Something went wrong', { error: true });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

function setSaveStatus(kind) {
  const el = document.getElementById('saveStatus');
  if (!el) return;
  el.classList.toggle('is-saving', kind === 'saving');
  el.classList.toggle('is-error', kind === 'error');
  if (kind === 'saving') el.textContent = 'Saving…';
  else if (kind === 'error') el.innerHTML = `${icon('alert')}Not saved`;
  else el.innerHTML = `${icon('check')}${MOCK ? 'Updated (sample data)' : 'Saved'}`;
}

async function changeStage(b, stage) {
  const prevLabel = U.stageMeta(b.stage).label;
  const undo = await writer.setStage(b, stage);
  U.toast(stage ? `${b.clientName} moved to ${U.stageMeta(stage).label}` : `${b.clientName} reopened`, {
    actionLabel: 'Undo',
    onAction: () => undo().then(() => U.toast(`Back to ${prevLabel}`)).catch(fail)
  });
}

const actions = {
  'new-booking': () => newBookingModal(),
  'create-booking': async (el) => {
    const name = document.getElementById('nbName').value.trim();
    if (!name) {
      document.getElementById('nbName').focus();
      return;
    }
    const input = {
      clientName: name,
      service: document.getElementById('nbService').value,
      date: document.getElementById('nbDate').value || '',
      pax: Number(document.getElementById('nbPax').value) || null,
      venue: document.getElementById('nbVenue').value.trim()
    };
    const id = await U.busyButton(el, 'Creating…', 'Created ✓', () => writer.createBooking(input));
    closeModal();
    state.awaitingId = id;
    go(`#/b/${encodeURIComponent(id)}`);
  },
  'close-modal': (el, e) => {
    if (el.classList.contains('bk-modal-overlay') && e.target !== el) return;
    closeModal();
  },
  'set-stage': async (el, e, b) => {
    closeMenus();
    const stage = el.dataset.stage;
    if (stage === b.stage) return;
    await changeStage(b, stage);
  },
  archive: async (el, e, b) => {
    closeMenus();
    const undo = await writer.archive(b);
    U.toast(`Archived ${b.clientName}`, { actionLabel: 'Undo', onAction: () => undo().then(() => U.toast(`Restored ${b.clientName}`)).catch(fail) });
  },
  restore: async (el, e, b) => {
    closeMenus();
    await writer.restore(b);
    U.toast(`Restored ${b.clientName}`);
  },
  reopen: (el, e, b) => {
    closeMenus();
    return changeStage(b, null);
  },
  'mark-booked': (el, e, b) => changeStage(b, 'booked'),
  'mark-completed': (el, e, b) => changeStage(b, 'completed'),
  'open-chat': (el, e, b) => go(`#/b/${encodeURIComponent(b.id)}/conversation`),
  'open-event': (el, e, b) => go(`#/b/${encodeURIComponent(b.id)}/event`),
  'reload-chat': (el, e, b) => {
    state.chats.delete(b.id);
    render();
  },
  'send-quote': (el, e, b) => quoteModal(b.id),
  'copy-quote-msg': async (el) => {
    const ok = await copyText(document.getElementById('quoteMsg').value);
    U.toast(ok ? 'Message copied' : 'Couldn’t copy — select the text instead', { error: !ok });
  },
  'confirm-quote': async (el, e, b) => {
    const price = Number(document.getElementById('quotePrice').value);
    if (!price) {
      document.getElementById('quotePrice').focus();
      return;
    }
    await U.busyButton(el, 'Saving…', 'Saved ✓', () => writer.sendQuote(b, price));
    closeModal();
    U.toast(`${b.clientName} quoted at ${money(price)}`);
  },
  'create-invoice': async (el, e, b) => {
    const created = await U.busyButton(el, 'Creating…', 'Created ✓', () => writer.createInvoice(b));
    U.toast(`Draft ${created.invoiceNumber} created`, MOCK ? {} : {
      actionLabel: 'Edit invoice',
      onAction: () => window.open(invoiceEditorUrl(created.id), '_blank', 'noopener')
    });
    go(`#/b/${encodeURIComponent(b.id)}/invoice`);
  },
  'publish-invoice': async (el, e, b) => {
    const url = await U.busyButton(el, 'Publishing…', 'Copied ✓', () => writer.publishInvoice(b));
    const ok = await copyText(url);
    U.toast(ok ? 'Published · customer link copied' : `Published · ${url}`);
  },
  'copy-link': async (el, e, b) => {
    const url = await U.busyButton(el, b.invoice?.published ? 'Copying…' : 'Publishing…', 'Copied ✓', () => writer.publishInvoice(b));
    const ok = await copyText(url);
    if (!ok) U.toast(url, { ms: 9000 });
  },
  'confirm-payment': async (el, e, b) => {
    const wasBooked = b.stage === 'booked';
    const res = await U.busyButton(el, 'Confirming…', 'Confirmed ✓', () => writer.confirmPayment(b));
    if (res.booked && !wasBooked) {
      const name = U.displayNames(b).title;
      if (res.eventAdded || b.event) U.toast(`${name} is booked and on the calendar`);
      else U.toast(`${name} is booked`, { actionLabel: 'Add to calendar', onAction: () => run(actions['add-event'], null, null, byId(b.id) || b) });
    } else {
      U.toast(`Confirmed ${money(res.confirmed)}`);
    }
  },
  settle: (el, e, b) => paymentModal(b, { ms: el.dataset.ms != null ? Number(el.dataset.ms) : null }),
  'record-payment': (el, e, b) => paymentModal(b, { custom: true }),
  'pay-fill': (el) => {
    document.getElementById('payAmount').value = el.dataset.amount;
    el.parentElement.querySelectorAll('.bk-pay-chip').forEach((c) => c.classList.toggle('is-on', c === el));
  },
  'save-payment': async (el, e, b) => {
    const input = document.getElementById('payAmount');
    const amount = Number(input.value);
    if (!(amount > 0)) return input.focus();
    const ms = el.dataset.ms != null ? b.invoice.milestones[Number(el.dataset.ms)] : null;
    const res = await U.busyButton(el, 'Saving…', 'Saved ✓', () => writer.recordPayment(b, {
      amount,
      milestoneId: ms?.id ?? null,
      milestoneIndex: el.dataset.ms != null ? Number(el.dataset.ms) : null,
      method: document.querySelector('input[name="payMethod"]:checked')?.value || 'cash',
      paidAt: document.getElementById('payDate').value,
      reference: document.getElementById('payRef').value
    }));
    closeModal();
    U.toast(res.settled ? `${U.displayNames(b).title} is fully paid` : `Recorded ${money(res.recorded)}`);
  },
  'add-event': async (el, e, b) => {
    await U.busyButton(el, 'Adding…', 'Added ✓', () => writer.addEvent(b));
    U.toast('Added to the calendar as a draft hold');
    go(`#/b/${encodeURIComponent(b.id)}/event`);
  },
  'confirm-event': async (el, e, b) => {
    await U.busyButton(el, 'Confirming…', 'Confirmed ✓', () => writer.confirmEvent(b));
    U.toast('Event confirmed');
  },
  'toggle-activity': () => {
    state.activityOpen = !state.activityOpen;
    render();
  },
  'copy-id': async (el) => {
    const ok = await copyText(el.dataset.copy);
    U.toast(ok ? 'Copied' : 'Couldn’t copy', { error: !ok });
  },
  'pipeline-stage': (el) => {
    state.pipelineStage = el.dataset.stage;
    render();
  },
  'toggle-board-group': (el) => {
    const g = el.dataset.group;
    const adding = !state.board.closed.has(g);
    if (adding) state.board.closed.add(g);
    else state.board.closed.delete(g);
    render();
    if (adding) app.querySelector(`.bk-col[data-stage="${g}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  },
  'toggle-quiet': () => {
    state.board.quietOpen = !state.board.quietOpen;
    render();
  },
  'stage-filter': (el) => {
    if (document.querySelector('.bk-stage-menu')) return closeMenus();
    openStageFilter(el);
  },
  'toggle-stage': (el) => {
    const s = el.dataset.stage;
    if (state.all.stages.has(s)) state.all.stages.delete(s);
    else state.all.stages.add(s);
    reopenStageFilter();
  },
  'all-view': (el) => {
    state.all.view = el.dataset.view === 'next' ? 'next' : 'stage';
    saveAllPrefs();
    render();
  },
  'toggle-group': (el) => {
    const k = el.dataset.group;
    if (state.all.collapsed.has(k)) state.all.collapsed.delete(k);
    else state.all.collapsed.add(k);
    saveAllPrefs();
    render();
  },
  'toggle-more': (el) => {
    const k = el.dataset.group;
    if (state.all.expanded.has(k)) state.all.expanded.delete(k);
    else state.all.expanded.add(k);
    render();
  },
  'stage-filter-reset': () => {
    state.all.stages.clear();
    reopenStageFilter();
  },
  'clear-filters': () => {
    state.all = { ...state.all, stages: new Set(), service: '' };
    state.search = '';
    document.getElementById('globalSearch').value = '';
    render();
  }
};

function run(fn, el, e, b) {
  try {
    const result = fn(el, e || { preventDefault() {}, stopPropagation() {}, target: el }, b);
    if (result && typeof result.then === 'function') result.catch(fail);
  } catch (err) {
    fail(err);
  }
}

/* ---------- Events ---------- */

document.addEventListener('click', (e) => {
  const stageBtn = e.target.closest('[data-stage-menu]');
  if (stageBtn) {
    e.stopPropagation();
    e.preventDefault();
    if (document.querySelector('.bk-popover')) return closeMenus();
    return openStageMenu(stageBtn, stageBtn.dataset.stageMenu);
  }

  const actEl = e.target.closest('[data-action]');
  if (actEl && actEl.tagName !== 'FORM' && !actEl.disabled) {
    const fn = actions[actEl.dataset.action];
    if (fn) {
      if (actEl.tagName === 'BUTTON' || actEl.tagName === 'A') e.stopPropagation();
      const b = actEl.dataset.id ? byId(actEl.dataset.id) : null;
      if (actEl.dataset.id && !b) return U.toast('That booking changed — try again', { error: true });
      run(fn, actEl, e, b);
      return;
    }
  }

  if (!e.target.closest('.bk-popover')) closeMenus();

  const open = e.target.closest('[data-open]');
  if (open && !e.target.closest('a, button, input, select, textarea')) {
    const tab = open.dataset.tab;
    go(`#/b/${encodeURIComponent(open.dataset.open)}${tab ? '/' + tab : ''}`);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenus();
    closeModal();
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open][role="button"]')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === '/' && !e.target.matches('input, textarea, select')) {
    e.preventDefault();
    document.getElementById('globalSearch').focus();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-filter]')) {
    const k = t.dataset.filter;
    state.all[k] = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'sort') saveAllPrefs();
    render();
    return;
  }
  if (t.matches('[data-field]')) {
    const r = parseRoute();
    const b = byId(r.id);
    if (!b) return;
    const key = t.dataset.field;
    const value = t.value;
    if (String(b[key] ?? '') === value) return;
    t.closest('.bk-field.is-required')?.classList.toggle('is-empty', !value);
    setSaveStatus('saving');
    writer.updateField(b, key, value)
      .then(() => setSaveStatus('saved'))
      .catch((err) => {
        setSaveStatus('error');
        fail(err);
      });
  }
});

document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (renderQueued) scheduleRender();
  }, 0);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'globalSearch') {
    state.search = e.target.value;
    clearTimeout(render.searchT);
    render.searchT = setTimeout(() => {
      if (parseRoute().view === 'detail') go(state.lastList);
      else render();
      document.getElementById('globalSearch').focus();
    }, 180);
  }
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  render();
});
window.addEventListener('resize', closeMenus);

/* Board: click-and-drag to scroll sideways with the mouse. */
let boardDrag = null;
let boardScrollLeft = 0;

document.addEventListener('pointerdown', (e) => {
  const board = e.target.closest('.bk-board');
  if (!board || e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest('button, a, input, select, textarea')) return;
  boardDrag = { board, x: e.clientX, left: board.scrollLeft, moved: false };
});

document.addEventListener('pointermove', (e) => {
  if (!boardDrag) return;
  const dx = e.clientX - boardDrag.x;
  if (!boardDrag.moved && Math.abs(dx) < 5) return;
  boardDrag.moved = true;
  boardDrag.board.classList.add('is-dragging');
  boardDrag.board.scrollLeft = boardDrag.left - dx;
});

document.addEventListener('pointerup', () => {
  if (!boardDrag) return;
  const { board, moved } = boardDrag;
  boardDrag = null;
  board.classList.remove('is-dragging');
  if (moved) {
    // Swallow the click that ends a drag so it doesn't open a card.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
  }
});

document.addEventListener('scroll', (e) => {
  if (e.target.classList?.contains('bk-board')) boardScrollLeft = e.target.scrollLeft;
}, true);

if (MOCK) document.body.classList.add('is-mock');
/** Booked means confirmed on the calendar: add or confirm the event for any booked booking missing one. Once per booking per session. */
const autoCalendarTried = new Set();
let autoCalendarRunning = false;
async function autoCalendar() {
  if (autoCalendarRunning || repo.state.loading) return;
  const due = bookings().filter((b) => b.stage === 'booked' && !b.archived && b.date && !U.eventDone(b) && !autoCalendarTried.has(b.id)
    && (!b.event || b.event.status === 'draft'));
  if (!due.length) return;
  autoCalendarRunning = true;
  const added = [];
  for (const b of due) {
    autoCalendarTried.add(b.id);
    try {
      if (b.event) await writer.confirmEvent(b);
      else await writer.addEvent(b);
      added.push(U.displayNames(b).title);
    } catch (err) {
      console.warn('Auto-calendar failed for', b.id, err);
    }
  }
  autoCalendarRunning = false;
  if (added.length) U.toast(added.length === 1 ? `${added[0]} is confirmed on the calendar` : `${added.length} booked events confirmed on the calendar`);
}

repo.subscribe(() => {
  scheduleRender();
  autoCalendar();
});
