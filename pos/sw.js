/* POS shell service worker — caches local HTML/JS/CSS only (not Firebase CDN). */
const CACHE = 'pos-shell-v1';
const SHELL = [
  './',
  './index.html',
  './css/normalize.css?v=4',
  './css/style.css?v=14',
  './js/order-sync-core.js?v=1',
  './js/event-window.js?v=4',
  './js/cup-count.js',
  './js/menu-data.js?v=6',
  './js/firebase-setup.js?v=8',
  './js/firebase-sync.js?v=15',
  './js/script.js?v=sync-reliability-1',
  './js/name-greeting-hook.js?v=2',
  './images/matchanese-logo.png',
  './images/matchanese-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Only same-origin POS assets; never intercept Firebase / third-party
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes('/pos/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
