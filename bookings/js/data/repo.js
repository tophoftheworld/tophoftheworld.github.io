import { initFirebase } from './firebase.js';
import { buildBookings } from './normalize.js';

const COLLECTIONS = {
  leads: 'serviceLeads',
  invoices: 'invoice-generator',
  events: 'opsEvents',
  proofs: 'invoicePaymentProofs'
};

function createStore() {
  const listeners = new Set();
  const state = { bookings: [], loading: true, error: null, lastSyncedAt: null };
  return {
    state,
    emit(patch) {
      Object.assign(state, patch);
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    }
  };
}

/** Live repo: onSnapshot over leads, invoices, events and pending payment proofs. */
export function createLiveRepo() {
  const store = createStore();
  const raw = { leads: null, invoices: null, events: null, proofs: [] };
  const unsubs = [];
  let rebuildTimer = null;
  let started = false;

  const rebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      if (raw.leads == null || raw.invoices == null || raw.events == null) return;
      try {
        const bookings = buildBookings({
          leads: raw.leads,
          invoices: raw.invoices,
          events: raw.events,
          pendingProofs: raw.proofs,
          now: new Date()
        });
        store.emit({ bookings, loading: false, error: null, lastSyncedAt: new Date().toISOString() });
      } catch (err) {
        console.error('[bookings] normalize failed', err);
        store.emit({ loading: false, error: err });
      }
    }, 60);
  };

  const onError = (label) => (err) => {
    console.error(`[bookings] ${label} listener failed`, err);
    store.emit({ loading: false, error: err });
  };

  async function start() {
    if (started) return;
    started = true;
    try {
      const { db, fns } = await initFirebase();
      const { collection, onSnapshot, query, where } = fns;
      const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      unsubs.push(
        onSnapshot(collection(db, COLLECTIONS.leads), (s) => { raw.leads = docs(s); rebuild(); }, onError('leads')),
        onSnapshot(collection(db, COLLECTIONS.invoices), (s) => { raw.invoices = docs(s); rebuild(); }, onError('invoices')),
        onSnapshot(collection(db, COLLECTIONS.events), (s) => { raw.events = docs(s); rebuild(); }, onError('events')),
        onSnapshot(query(collection(db, COLLECTIONS.proofs), where('status', 'in', ['sent', 'confirmed'])), (s) => { raw.proofs = docs(s); rebuild(); }, onError('proofs'))
      );
    } catch (err) {
      started = false;
      onError('init')(err);
    }
  }

  return {
    mode: 'live',
    now: () => new Date(),
    subscribe(fn) {
      start();
      return store.subscribe(fn);
    },
    get state() {
      return store.state;
    },
    find(id) {
      return store.state.bookings.find((b) => b.id === id) || null;
    },
    stop() {
      unsubs.splice(0).forEach((u) => u());
      started = false;
    }
  };
}

/** Mock repo: in-memory copy of mock-data with an explicit emit for mock writes. */
export function createMockRepo(mock) {
  const store = createStore();
  const bookings = mock.bookings.map((b) => ({
    kind: 'lead',
    leadId: b.id,
    invoiceId: b.invoice ? `mock-inv-${b.id}` : null,
    ...structuredClone(b)
  }));
  store.emit({ bookings, loading: false, error: null, lastSyncedAt: mock.NOW.toISOString() });
  return {
    mode: 'mock',
    now: () => mock.NOW,
    subscribe: (fn) => store.subscribe(fn),
    get state() {
      return store.state;
    },
    find(id) {
      return store.state.bookings.find((b) => b.id === id) || null;
    },
    commit() {
      store.emit({ bookings: [...store.state.bookings] });
    },
    stop() {}
  };
}
