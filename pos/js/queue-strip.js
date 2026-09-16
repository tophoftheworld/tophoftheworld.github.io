/*
 * Line-facing queue strip.
 *
 * Renders the top 20% strip (1080x384) of a portrait LED.
 * Subscribes to today's pending orders for the active event and derives:
 *   preparing = pending + not all items.prepared
 *   ready     = pending + all items.prepared
 * Orders leave the board when status changes away from pending (DONE / void / delete).
 */

import { loadEventsFromFirebase, subscribeToOrders } from './firebase-sync.js';

const READY_LIMIT = 6;
const PREP_LIMIT = 14;
const EVENT_STORAGE_KEY = 'queueStripEvent';
const FALLBACK_EVENT = 'pop-up';

const query = new URLSearchParams(window.location.search);
const QUERY_EVENT = query.get('event');
const HIDE_SETTINGS = query.get('hideSettings') === '1';

let activeEvent = QUERY_EVENT || localStorage.getItem(EVENT_STORAGE_KEY) || localStorage.getItem('currentEvent') || FALLBACK_EVENT;
let unsubscribeOrders = null;
const ordersById = new Map();

const els = {
  readyList: document.getElementById('readyList'),
  prepList: document.getElementById('prepList'),
  liveDot: document.getElementById('stripLiveDot'),
  pendingCount: document.getElementById('stripPendingCount'),
  settingsBtn: document.getElementById('stripSettingsBtn'),
  settingsOverlay: document.getElementById('stripSettingsOverlay'),
  settingsCloseBtn: document.getElementById('stripSettingsCloseBtn'),
  eventSelector: document.getElementById('stripEventSelector')
};

function getQueueLabel(pos) {
  if (pos === 1) return 'NEXT';
  const suffix = pos === 2 ? 'ND' : pos === 3 ? 'RD' : 'TH';
  return `${pos}${suffix}`;
}

function firstName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Guest';
  return trimmed.split(/\s+/)[0];
}

function displayName(name) {
  return firstName(name).toUpperCase();
}

function isFullyPrepared(order) {
  return Array.isArray(order?.items) &&
    order.items.length > 0 &&
    order.items.every(item => Boolean(item.prepared));
}

function setLiveState(isLive) {
  if (!els.liveDot) return;
  els.liveDot.classList.toggle('offline', !isLive);
}

function renderReady(readyOrders) {
  els.readyList.innerHTML = '';

  if (readyOrders.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ready-empty';
    empty.textContent = 'Hang tight — drinks coming up';
    els.readyList.appendChild(empty);
    return;
  }

  readyOrders.slice(0, READY_LIMIT).forEach(order => {
    const row = document.createElement('div');
    row.className = 'ready-item';

    const name = document.createElement('div');
    name.className = 'ready-name';
    name.textContent = displayName(order.customerName || order.name);
    row.appendChild(name);

    const countLine = document.createElement('div');
    countLine.className = 'ready-items';
    countLine.textContent = formatDrinkCount(order.items);
    row.appendChild(countLine);

    els.readyList.appendChild(row);
  });
}

function formatDrinkCount(items) {
  if (!Array.isArray(items) || items.length === 0) return '0 Drinks';
  const total = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return `${total} Drink${total === 1 ? '' : 's'}`;
}

function updatePendingCount(count) {
  if (!els.pendingCount) return;
  els.pendingCount.textContent = `${count} order${count === 1 ? '' : 's'} pending`;
}

function renderPreparing(prepOrders) {
  els.prepList.innerHTML = '';
  updatePendingCount(prepOrders.length);

  if (prepOrders.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'prep-empty';
    empty.textContent = 'All caught up!';
    els.prepList.appendChild(empty);
    return;
  }

  const visible = prepOrders.slice(0, PREP_LIMIT);
  visible.forEach((order, index) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (index === 0 ? ' is-next' : '');

    const badge = document.createElement('span');
    badge.className = 'chip-badge';
    badge.textContent = getQueueLabel(index + 1);

    const body = document.createElement('div');
    body.className = 'chip-body';

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = displayName(order.customerName || order.name);

    const drinks = document.createElement('span');
    drinks.className = 'chip-drinks';
    drinks.textContent = formatDrinkCount(order.items);

    body.appendChild(name);
    body.appendChild(drinks);
    chip.appendChild(badge);
    chip.appendChild(body);
    els.prepList.appendChild(chip);
  });

  const overflow = prepOrders.length - visible.length;
  if (overflow > 0) {
    const more = document.createElement('div');
    more.className = 'chip-more';
    more.textContent = `+${overflow}`;
    els.prepList.appendChild(more);
  }
}

function renderFromMap() {
  const pending = Array.from(ordersById.values()).filter(o => o.status === 'pending');

  const ready = pending
    .filter(isFullyPrepared)
    .sort((a, b) => {
      const aTime = new Date(a.readyAt || a.timestamp || 0).getTime();
      const bTime = new Date(b.readyAt || b.timestamp || 0).getTime();
      return aTime - bTime;
    });

  const preparing = pending
    .filter(o => !isFullyPrepared(o))
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

  renderReady(ready);
  renderPreparing(preparing);
}

function upsertOrderFromSnapshot(docSnapshot) {
  const data = { id: docSnapshot.id, ...docSnapshot.data() };
  const orderId = data.id || docSnapshot.id;

  if (data.status !== 'pending') {
    ordersById.delete(orderId);
  } else {
    ordersById.set(orderId, { ...data, id: orderId });
  }

  setLiveState(true);
  renderFromMap();
}

function subscribeForEvent(eventKey) {
  activeEvent = eventKey || FALLBACK_EVENT;
  localStorage.setItem(EVENT_STORAGE_KEY, activeEvent);

  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }

  ordersById.clear();
  setLiveState(false);
  renderFromMap();

  unsubscribeOrders = subscribeToOrders(activeEvent, new Date(), (docSnapshot) => {
    upsertOrderFromSnapshot(docSnapshot);
  });
}

function openSettings() {
  els.settingsOverlay.hidden = false;
}

function closeSettings() {
  els.settingsOverlay.hidden = true;
}

async function loadEvents() {
  const events = await loadEventsFromFirebase();
  const activeEvents = events.filter(event => !event.archived);

  els.eventSelector.innerHTML = '';
  activeEvents.forEach(event => {
    const option = document.createElement('option');
    option.value = event.key;
    option.textContent = event.name;
    els.eventSelector.appendChild(option);
  });

  if (activeEvents.length === 0) {
    const fallbackOption = document.createElement('option');
    fallbackOption.value = FALLBACK_EVENT;
    fallbackOption.textContent = FALLBACK_EVENT;
    els.eventSelector.appendChild(fallbackOption);
  }

  const hasActiveEvent = activeEvents.some(event => event.key === activeEvent);
  const selectedEvent = hasActiveEvent
    ? activeEvents.find(event => event.key === activeEvent)
    : activeEvents[0] || { key: FALLBACK_EVENT, name: FALLBACK_EVENT };

  els.eventSelector.value = selectedEvent.key;
  subscribeForEvent(selectedEvent.key);
}

function initSettingsHandlers() {
  if (HIDE_SETTINGS) {
    els.settingsBtn.hidden = true;
    closeSettings();
    return;
  }

  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsCloseBtn.addEventListener('click', closeSettings);
  els.settingsOverlay.addEventListener('click', (event) => {
    if (event.target === els.settingsOverlay) closeSettings();
  });
  els.eventSelector.addEventListener('change', (event) => {
    subscribeForEvent(event.target.value);
    closeSettings();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initSettingsHandlers();
  await loadEvents();
});
