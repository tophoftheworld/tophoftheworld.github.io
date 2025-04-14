const CACHE_NAME = 'matchanese-v2'; // 🆕 Bump version when deploying
const CACHE_NAME = 'matchanese-attendance-v1';
const OFFLINE_URLS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/script.js',
    '/js/firebase-setup.js',
    '/manifest.webmanifest',
    'https://cdn.jsdelivr.net/npm/flatpickr',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        )
    );
});


self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cached =>
            cached || fetch(event.request).catch(() => caches.match('/'))
        )
    );
});
