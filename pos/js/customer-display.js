import { loadEventsFromFirebase, subscribeToLiveSession } from './firebase-sync.js?v=9';

console.log('[GREETING_DEBUG][display] MODULE LOADED', { build: 'greeting-fix-1' });

const EVENT_STORAGE_KEY = 'customerDisplayEvent';
const FALLBACK_EVENT = 'pop-up';
const query = new URLSearchParams(window.location.search);
const QUERY_EVENT = query.get('event');
const HIDE_SETTINGS = query.get('hideSettings') === '1';
const IS_EMBEDDED = query.get('embedded') === '1';

function clampDisplayRadius(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 12;
  return Math.max(0, Math.min(80, n));
}

function clampDisplayScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(2.5, Math.round(n * 100) / 100));
}

function applyDisplayRadius(value) {
  const px = clampDisplayRadius(value) + 'px';
  document.documentElement.style.setProperty('--display-radius', px);
  if (document.body) document.body.style.setProperty('--display-radius', px);
}

function applyDisplayScale(value) {
  const scale = String(clampDisplayScale(value));
  document.documentElement.style.setProperty('--display-scale', scale);
  if (document.body) document.body.style.setProperty('--display-scale', scale);
}

if (IS_EMBEDDED && document.body) {
  document.body.classList.add('is-embedded');
}
applyDisplayRadius(query.get('radius'));
applyDisplayScale(query.get('scale'));

window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || data.type !== 'menu-creator-display-style') return;
  if (data.radius != null) applyDisplayRadius(data.radius);
  if (data.scale != null) applyDisplayScale(data.scale);
});

let activeEvent = QUERY_EVENT || localStorage.getItem(EVENT_STORAGE_KEY) || localStorage.getItem('currentEvent') || FALLBACK_EVENT;
let unsubscribeLiveSession = null;

function ensureGreetingOverlay() {
  let overlay = document.getElementById('displayGreetingOverlay');
  let text = document.getElementById('displayGreetingText');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'displayGreetingOverlay';
    overlay.className = 'display-greeting-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    text = document.createElement('p');
    text.id = 'displayGreetingText';
    text.className = 'display-greeting-text';
    overlay.appendChild(text);
    document.body.appendChild(overlay);
  } else if (!text) {
    text = document.createElement('p');
    text.id = 'displayGreetingText';
    text.className = 'display-greeting-text';
    overlay.appendChild(text);
  }

  // Inline critical styles so a stale CSS cache still shows the greeting.
  if (!document.getElementById('displayGreetingStyle')) {
    const style = document.createElement('style');
    style.id = 'displayGreetingStyle';
    style.textContent = `
      .display-greeting-overlay {
        position: fixed; inset: 0; z-index: 2000;
        display: flex; align-items: center; justify-content: center;
        padding: 24px 20px; box-sizing: border-box;
        background: #fff; opacity: 0; pointer-events: none;
        transition: opacity 0.35s ease;
      }
      .display-greeting-overlay.is-visible { opacity: 1; pointer-events: auto; }
      .display-greeting-text {
        margin: 0; width: 100%; max-width: 100%;
        color: #1d8a00; font-family: 'Poppins', sans-serif;
        font-weight: 800; font-size: 72px; line-height: 1.05;
        letter-spacing: -0.02em; text-align: center; white-space: nowrap;
        opacity: 0; transform: translateY(24px);
        transition: opacity 0.4s ease, transform 0.4s ease;
      }
      .display-greeting-overlay.is-greeting-in .display-greeting-text {
        opacity: 1; transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  return { overlay, text };
}

const greetingEls = ensureGreetingOverlay();

const els = {
  primaryTitle: document.getElementById('displayPrimaryTitle'),
  eventName: document.getElementById('displayEventName'),
  liveBadge: document.getElementById('displayLiveBadge'),
  lastUpdated: document.getElementById('displayLastUpdated'),
  orderList: document.getElementById('displayOrderList'),
  emptyState: document.getElementById('displayEmptyState'),
  orderTotal: document.getElementById('displayOrderTotal'),
  qrOverlay: document.getElementById('displayQrOverlay'),
  qrImage: document.getElementById('displayQrImage'),
  paymentMethod: document.getElementById('displayPaymentMethod'),
  qrAmount: document.getElementById('displayQrAmount'),
  settingsBtn: document.getElementById('displaySettingsBtn'),
  settingsOverlay: document.getElementById('displaySettingsOverlay'),
  settingsCloseBtn: document.getElementById('displaySettingsCloseBtn'),
  eventSelector: document.getElementById('displayEventSelector'),
  greetingOverlay: greetingEls.overlay,
  greetingText: greetingEls.text
};

const GREETING_FADE_MS = 350;
const GREETING_SLIDE_MS = 400;
const GREETING_HOLD_MS = 1400;
const GREETING_MIN_FONT_PX = 28;
const GREETING_MAX_FONT_PX = 240;

let lastSeenGreetingId = null;
let hasHydratedLiveSession = false;
let greetingRunToken = 0;
let greetingTimers = [];
let lastKnownCustomerName = '';
let lastPlayedGreetingAt = 0;
let lastPlayedGreetingName = '';

function greetingDebug(...args) {
  console.log('[GREETING_DEBUG][display]', ...args);
}

function triggerGreetingFromPulse(payload, source) {
  if (!payload || payload.id == null || !payload.name) return;

  const eventKey = payload.event || FALLBACK_EVENT;
  if (eventKey !== activeEvent) {
    greetingDebug('pulse ignored — event mismatch', { source, got: eventKey, active: activeEvent });
    return;
  }

  const greetingId = String(payload.id);
  if (greetingId === lastSeenGreetingId) {
    greetingDebug('pulse ignored — already seen', { source, greetingId });
    return;
  }

  hasHydratedLiveSession = true;
  lastSeenGreetingId = greetingId;
  lastKnownCustomerName = String(payload.name).trim();
  greetingDebug('pulse → play', { source, greetingId, name: lastKnownCustomerName });
  playNameGreeting(lastKnownCustomerName);
}

function clearGreetingTimers() {
  greetingTimers.forEach((id) => clearTimeout(id));
  greetingTimers = [];
}

function scheduleGreetingStep(fn, delay) {
  const id = setTimeout(fn, delay);
  greetingTimers.push(id);
  return id;
}

function fitGreetingTextToWidth() {
  const textEl = els.greetingText;
  const overlay = els.greetingOverlay;
  if (!textEl || !overlay) return;

  const availableWidth = Math.max(0, overlay.clientWidth - 40);
  if (!availableWidth) return;

  // Grow/shrink to the largest size that still fits the content width.
  let low = GREETING_MIN_FONT_PX;
  let high = GREETING_MAX_FONT_PX;
  let best = low;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    textEl.style.fontSize = `${mid}px`;
    if (textEl.scrollWidth <= availableWidth) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  textEl.style.fontSize = `${best}px`;
}

function resetGreetingOverlay() {
  clearGreetingTimers();
  if (!els.greetingOverlay || !els.greetingText) return;
  els.greetingOverlay.classList.remove('is-visible', 'is-greeting-in');
  els.greetingOverlay.setAttribute('aria-hidden', 'true');
  els.greetingText.textContent = '';
  els.greetingText.style.fontSize = '';
}

function playNameGreeting(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    greetingDebug('playNameGreeting skipped — empty name');
    return;
  }

  const now = Date.now();
  if (trimmed === lastPlayedGreetingName && now - lastPlayedGreetingAt < 2500) {
    greetingDebug('playNameGreeting debounce — already playing', { name: trimmed });
    return;
  }
  lastPlayedGreetingName = trimmed;
  lastPlayedGreetingAt = now;

  const ensured = ensureGreetingOverlay();
  els.greetingOverlay = ensured.overlay;
  els.greetingText = ensured.text;

  const token = ++greetingRunToken;
  clearGreetingTimers();

  greetingDebug('PLAYING greeting', { name: trimmed, event: activeEvent });
  els.greetingText.textContent = `Hi, ${trimmed}!`;
  els.greetingOverlay.classList.remove('is-greeting-in');
  els.greetingOverlay.classList.add('is-visible');
  els.greetingOverlay.setAttribute('aria-hidden', 'false');

  // Fit after the overlay is visible so clientWidth is accurate.
  requestAnimationFrame(() => {
    if (token !== greetingRunToken) return;
    fitGreetingTextToWidth();
  });

  scheduleGreetingStep(() => {
    if (token !== greetingRunToken) return;
    els.greetingOverlay.classList.add('is-greeting-in');
  }, GREETING_FADE_MS);

  scheduleGreetingStep(() => {
    if (token !== greetingRunToken) return;
    els.greetingOverlay.classList.remove('is-greeting-in');
  }, GREETING_FADE_MS + GREETING_SLIDE_MS + GREETING_HOLD_MS);

  scheduleGreetingStep(() => {
    if (token !== greetingRunToken) return;
    els.greetingOverlay.classList.remove('is-visible');
    els.greetingOverlay.setAttribute('aria-hidden', 'true');
  }, GREETING_FADE_MS + GREETING_SLIDE_MS + GREETING_HOLD_MS + GREETING_SLIDE_MS);

  scheduleGreetingStep(() => {
    if (token !== greetingRunToken) return;
    els.greetingText.textContent = '';
    els.greetingText.style.fontSize = '';
  }, GREETING_FADE_MS + GREETING_SLIDE_MS + GREETING_HOLD_MS + GREETING_SLIDE_MS + GREETING_FADE_MS);
}

function maybePlayNameGreeting(data) {
  const greetingId = data && data.nameGreetingId != null ? String(data.nameGreetingId) : '';
  const name = data && data.customerName ? String(data.customerName).trim() : '';
  if (name) lastKnownCustomerName = name;

  greetingDebug('snapshot', {
    event: activeEvent,
    name: name || null,
    nameGreetingId: greetingId || null,
    hydrated: hasHydratedLiveSession,
    lastSeen: lastSeenGreetingId
  });

  if (!hasHydratedLiveSession) {
    hasHydratedLiveSession = true;
    lastSeenGreetingId = greetingId || null;
    // Late-loading embeds (menu-creator viewer) may first connect AFTER Enter/OK.
    // Play if the greeting was confirmed in the last few seconds.
    const ts = Number(greetingId);
    if (name && Number.isFinite(ts) && Date.now() - ts < 8000) {
      greetingDebug('hydrate RECENT greeting → play', { greetingId, name });
      playNameGreeting(name);
    } else {
      greetingDebug('hydrate skip', { greetingId: greetingId || null, name: name || null });
    }
    return;
  }

  if (!greetingId) {
    greetingDebug('skip — no nameGreetingId', { name: name || null });
    return;
  }
  if (greetingId === lastSeenGreetingId) {
    greetingDebug('skip — same greetingId', { greetingId });
    return;
  }
  lastSeenGreetingId = greetingId;
  if (!name) {
    greetingDebug('skip — greetingId changed but name empty', { greetingId });
    return;
  }

  playNameGreeting(name);
}

function formatCurrency(amount) {
  return `₱ ${Number(amount || 0).toFixed(2)}`;
}

function escapeDisplayHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function applyCustomerTitle(data) {
  const name = data && data.customerName ? String(data.customerName).trim() : '';
  if (name) {
    const safeName = escapeDisplayHtml(name.toUpperCase());
    els.primaryTitle.innerHTML = `<span class="customer-primary-name">${safeName}</span><span class="customer-primary-suffix">'S ORDER</span>`;
    return;
  }
  els.primaryTitle.innerHTML = 'YOUR <span class="light">ORDER</span>';
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
  if (customizations.matchaOption) {
    const opt = String(customizations.matchaOption);
    parts.push(opt === 'natsu' ? 'Natsu' : opt === 'aki' ? 'Aki' : opt);
  }
  pushIf(customizations.discount && customizations.discount !== 'custom', 'Discount');

  if (customizations.discount === 'custom') {
    if (customizations.customDiscountMode === 'amount' && customizations.customDiscountAmount) {
      parts.push(`₱${Number(customizations.customDiscountAmount)} OFF`);
    } else if (customizations.customDiscountPercent) {
      parts.push(`${customizations.customDiscountPercent}% OFF`);
    } else {
      parts.push('CUSTOM');
    }
  }

  return parts.join(' | ');
}

function renderLiveSession(data) {
  applyCustomerTitle(data);
  maybePlayNameGreeting(data);

  if (!data || !Array.isArray(data.items) || data.items.length === 0 || data.status === 'idle') {
    els.emptyState.hidden = false;
    els.orderList.innerHTML = '';
    els.orderTotal.textContent = formatCurrency(0);
    els.qrOverlay.hidden = true;
    updateLastUpdatedLabel(data?.updatedAt);
    return;
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
    els.qrImage.src = method === 'card' ? 'images/qr.png' : 'images/qr-bea.png';
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

  // Treat each event subscription as a fresh hydrate so a stale greeting does not replay.
  hasHydratedLiveSession = false;
  lastSeenGreetingId = null;
  resetGreetingOverlay();

  setLiveState(false);
  unsubscribeLiveSession = subscribeToLiveSession(activeEvent, (data) => {
    setLiveState(true);
    renderLiveSession(data);
  });
}

function handleLocalNameGreeting(raw) {
  if (!raw) return;
  let payload = null;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    greetingDebug('localStorage greeting JSON parse failed');
    return;
  }
  triggerGreetingFromPulse(payload, 'localStorage');
}

function initNameGreetingBridge() {
  try {
    const channel = new BroadcastChannel('pos-name-greeting');
    channel.addEventListener('message', (event) => {
      triggerGreetingFromPulse(event.data, 'broadcast');
    });
    greetingDebug('BroadcastChannel listening');
  } catch (err) {
    greetingDebug('BroadcastChannel unavailable', err);
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== 'posNameGreeting') return;
    greetingDebug('storage event posNameGreeting received');
    handleLocalNameGreeting(event.newValue);
  });

  // Same-tab / late iframe: pick up a greeting written just before this display loaded.
  try {
    const raw = localStorage.getItem('posNameGreeting');
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload && payload.at && Date.now() - Number(payload.at) < 8000) {
      handleLocalNameGreeting(payload);
    }
  } catch (_) { /* ignore */ }
}

function initGreetingKeyboardShortcut() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'g' && event.key !== 'G') return;
    if (event.altKey || event.metaKey) return;
    // Allow Ctrl+G or plain G (when not typing in a field).
    const tag = (event.target && event.target.tagName) ? event.target.tagName.toLowerCase() : '';
    if (!event.ctrlKey && (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable)) {
      return;
    }
    event.preventDefault();
    const name = lastKnownCustomerName || 'Friend';
    greetingDebug('keyboard shortcut → play', { key: event.key, ctrl: event.ctrlKey, name });
    playNameGreeting(name);
  });
  greetingDebug('keyboard shortcut ready: press G (or Ctrl+G) to preview greeting');
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
  initGreetingKeyboardShortcut();
  greetingDebug('boot', { event: activeEvent, script: 'customer-display.js?v=greeting-fix-2' });
  await loadEvents();
  initNameGreetingBridge();
});
