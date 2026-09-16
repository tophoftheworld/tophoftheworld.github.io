/**
 * Standalone name-greeting publisher.
 * Loaded as its own file so a stale pos/js/script.js cache cannot block greetings.
 */
import { publishLiveSession } from './firebase-sync.js?v=9';

const BUILD = 'greeting-hook-1';
console.log('[GREETING_DEBUG][POS-HOOK] MODULE LOADED', { build: BUILD });

function getPosEvent() {
  return window.currentEvent || localStorage.getItem('currentEvent') || 'pop-up';
}

function publishGreeting(name, source) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    console.log('[GREETING_DEBUG][POS-HOOK] skip empty name', { source });
    return;
  }

  const event = getPosEvent();
  const greetingId = Date.now();
  const payload = {
    customerName: trimmed,
    nameGreetingId: greetingId
  };

  console.log('[GREETING_DEBUG][POS-HOOK] publishing greeting', { source, event, ...payload });

  publishLiveSession(event, payload).then((ok) => {
    console.log('[GREETING_DEBUG][POS-HOOK] publish result', { ok, greetingId, event, name: trimmed });
  });

  try {
    localStorage.setItem('posNameGreeting', JSON.stringify({
      id: greetingId,
      name: trimmed,
      event,
      at: greetingId
    }));
  } catch (err) {
    console.warn('[GREETING_DEBUG][POS-HOOK] localStorage failed', err);
  }

  try {
    const channel = new BroadcastChannel('pos-name-greeting');
    channel.postMessage({ id: greetingId, name: trimmed, event, at: greetingId });
    channel.close();
  } catch (err) {
    console.warn('[GREETING_DEBUG][POS-HOOK] BroadcastChannel failed', err);
  }
}

function readNameModalInput() {
  const modal = document.querySelector('.name-input-modal');
  if (!modal) return '';
  const input = modal.querySelector('input');
  return input ? String(input.value || '').trim() : '';
}

// Capture phase: run before script.js removes the modal.
document.addEventListener('click', (event) => {
  const okBtn = event.target && event.target.closest && event.target.closest('.name-input-modal .modal-add');
  if (!okBtn) return;
  publishGreeting(readNameModalInput(), 'ok-click');
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!document.querySelector('.name-input-modal')) return;
  publishGreeting(readNameModalInput(), 'enter-key');
}, true);
