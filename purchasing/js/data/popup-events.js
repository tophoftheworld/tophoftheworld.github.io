/**
 * Active pop-up / package events from the same Firestore `branches` collection
 * the Pop-ups sales dashboard uses (type: 'popup').
 */
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from '../firebase.js?v=96';

const CACHE_KEY = 'purchasing-popup-events-v1';

/** @type {Array<{ id: string, key: string, name: string, serviceType: string }>} */
let cached = [];

function readLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeLocalCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch (_) {
    /* ignore */
  }
}

export function getCachedPopupEvents() {
  return (cached.length ? cached : readLocalCache()).slice();
}

/**
 * @returns {Promise<Array<{ id: string, key: string, name: string, serviceType: string }>>}
 */
export async function loadActivePopupEvents() {
  try {
    const snapshot = await getDocs(collection(db, 'branches'));
    const events = [];
    snapshot.forEach((d) => {
      const data = d.data() || {};
      if (data.type !== 'popup') return;
      if (data.archived) return;
      const name = String(data.name || '').trim();
      const key = String(data.key || d.id || '').trim();
      if (!name && !key) return;
      events.push({
        id: d.id,
        key: key || name,
        name: name || key,
        serviceType: data.serviceType || 'popup',
      });
    });
    events.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    cached = events;
    writeLocalCache(events);
    return events.slice();
  } catch (err) {
    console.warn('Could not load pop-up events for Purchasing', err);
    cached = readLocalCache();
    return cached.slice();
  }
}
