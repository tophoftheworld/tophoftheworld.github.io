import { loadEventsFromFirebase, subscribeToLiveSession } from './firebase-sync.js';

const EVENT_STORAGE_KEY = 'customerDisplayEvent';
const FALLBACK_EVENT = 'pop-up';
const query = new URLSearchParams(window.location.search);
const QUERY_EVENT = query.get('event');
const HIDE_SETTINGS = query.get('hideSettings') === '1';

let activeEvent = QUERY_EVENT || localStorage.getItem(EVENT_STORAGE_KEY) || localStorage.getItem('currentEvent') || FALLBACK_EVENT;
let unsubscribeLiveSession = null;

const els = {
  primaryTitle: document.getElementById('displayPrimaryTitle'),
  eventName: document.getElementById('displayEventName'),
  liveBadge: document.getElementById('displayLiveBadge'),
  lastUpdated: document.getElementById('displayLastUpdated'),
  orderList: document.getElementById('displayOrderList'),
  emptyState: document.getElementById('displayEmptyState'),
  orderTotal: document.getElementById('displayOrderTotal'),
  qrOverlay: document.getElementById('displayQrOverlay'),
  paymentMethod: document.getElementById('displayPaymentMethod'),
  qrAmount: document.getElementById('displayQrAmount'),
  settingsBtn: document.getElementById('displaySettingsBtn'),
  settingsOverlay: document.getElementById('displaySettingsOverlay'),
  settingsCloseBtn: document.getElementById('displaySettingsCloseBtn'),
  eventSelector: document.getElementById('displayEventSelector')
};

function formatCurrency(amount) {
  return `₱ ${Number(amount || 0).toFixed(2)}`;
}

function setLiveState(isLive) {
  els.liveBadge.textContent = isLive ? 'LIVE' : 'NO SIGNAL';
  els.liveBadge.classList.toggle('offline', !isLive);
}

function updateLastUpdatedLabel(timestamp) {
  if (!timestamp) {
    els.lastUpdated.textContent = 'Waiting for updates...';
    return;
  }

  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  els.lastUpdated.textContent = `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function renderItems(items) {
  els.orderList.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'customer-order-row';

    const left = document.createElement('div');
    left.className = 'customer-order-left';
    const title = document.createElement('div');
    title.className = 'customer-order-title';
    title.textContent = `${item.quantity || 0}x ${item.name || 'Item'}`;
    left.appendChild(title);

    const customText = formatCustomizationText(item.customizations);
    if (customText) {
      const detail = document.createElement('div');
      detail.className = 'customer-order-detail';
      detail.textContent = customText;
      left.appendChild(detail);
    }

    const right = document.createElement('div');
    right.className = 'customer-order-right';
    right.textContent = formatCurrency(item.lineTotal ?? (item.quantity || 0) * (item.unitPrice || 0));

    row.appendChild(left);
    row.appendChild(right);
    els.orderList.appendChild(row);
  });
}

function formatCustomizationText(customizations) {
  if (!customizations || typeof customizations !== 'object') return '';

  const parts = [];
  const pushIf = (value, label = null) => {
    if (!value || value === 'none') return;
    parts.push(label ? `${label}: ${value}` : String(value));
  };

  pushIf(customizations.variant);
  pushIf(customizations.serving);
  pushIf(customizations.size);
  pushIf(customizations.sweetness, 'Sweetness');
  pushIf(customizations.milk, 'Milk');
  pushIf(customizations.strengthLevel, 'Strength');
  pushIf(customizations.matchaStrength, 'Matcha');
  pushIf(customizations.discount, 'Discount');

  if (customizations.customDiscountPercent) {
    parts.push(`Custom ${customizations.customDiscountPercent}%`);
  }

  return parts.join(' | ');
}

function renderLiveSession(data) {
  if (!data || !Array.isArray(data.items) || data.items.length === 0 || data.status === 'idle') {
    els.primaryTitle.innerHTML = 'YOUR <span class="light">ORDER</span>';
    els.emptyState.hidden = false;
    els.orderList.innerHTML = '';
    els.orderTotal.textContent = formatCurrency(0);
    els.qrOverlay.hidden = true;
    updateLastUpdatedLabel(data?.updatedAt);
    return;
  }

  if (data.customerName) {
    const safeName = String(data.customerName).toUpperCase();
    els.primaryTitle.innerHTML = `<span class="customer-primary-name">${safeName}</span><span class="customer-primary-suffix">'S ORDER</span>`;
  } else {
    els.primaryTitle.innerHTML = 'YOUR <span class="light">ORDER</span>';
  }
  els.emptyState.hidden = true;

  renderItems(data.items);
  els.orderTotal.textContent = formatCurrency(data.total);

  const method = String(data.paymentMethod || '').toLowerCase();
  const showQr = Boolean(data.showQr) && (method === 'gcash' || method === 'card');
  els.qrOverlay.hidden = !showQr;
  if (showQr) {
    els.paymentMethod.textContent = method === 'card' ? 'CARD PAYMENT' : 'GCASH PAYMENT';
    els.qrAmount.textContent = `Amount Due: ${formatCurrency(data.total)}`;
  }

  updateLastUpdatedLabel(data.updatedAt);
}

function openSettings() {
  els.settingsOverlay.hidden = false;
}

function closeSettings() {
  els.settingsOverlay.hidden = true;
}

function setEvent(eventKey, eventLabel = null) {
  activeEvent = eventKey || FALLBACK_EVENT;
  localStorage.setItem(EVENT_STORAGE_KEY, activeEvent);
  els.eventName.textContent = eventLabel || activeEvent;

  if (unsubscribeLiveSession) {
    unsubscribeLiveSession();
  }

  setLiveState(false);
  unsubscribeLiveSession = subscribeToLiveSession(activeEvent, (data) => {
    setLiveState(true);
    renderLiveSession(data);
  });
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

  const fallbackOption = document.createElement('option');
  if (activeEvents.length === 0) {
    fallbackOption.value = FALLBACK_EVENT;
    fallbackOption.textContent = FALLBACK_EVENT;
    els.eventSelector.appendChild(fallbackOption);
  }

  const hasActiveEvent = activeEvents.some(event => event.key === activeEvent);
  const selectedEvent = hasActiveEvent
    ? activeEvents.find(event => event.key === activeEvent)
    : activeEvents[0] || { key: FALLBACK_EVENT, name: FALLBACK_EVENT };

  els.eventSelector.value = selectedEvent.key;
  setEvent(selectedEvent.key, selectedEvent.name);
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
    const label = event.target.options[event.target.selectedIndex]?.textContent || event.target.value;
    setEvent(event.target.value, label);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initSettingsHandlers();
  await loadEvents();
});
