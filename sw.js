const CACHE_NAME = 'matchanese-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/js/script.js',
    '/js/firebase-setup.js',
    '/css/style.css',
    '/manifest.webmanifest',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(resp => resp || fetch(event.request))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
});
