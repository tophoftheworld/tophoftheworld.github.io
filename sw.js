// Matchanese Staff Portal - Service Worker
const APP_VERSION = "1.0.3";
const CACHE_NAME = `matchanese-staff-v${APP_VERSION}`;
const DYNAMIC_CACHE = `matchanese-staff-dynamic-v${APP_VERSION}`;

// Resources to cache during installation
const STATIC_RESOURCES = [
    '/',
    '/index.html',
    '/login.html',
    '/js/staff-auth.js',
    '/js/firebase-auth-setup.js',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/shared/assets/images/matchanese-2025-logo.png',
    '/shared/assets/images/matchanese-logo-full.png',
    'https://cdn.tailwindcss.com',
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js'
];

// Resources that should always be fetched from network
const NETWORK_ONLY = [
    'firestore.googleapis.com',
    'firebase'
];

// Install event - cache static resources
self.addEventListener('install', event => {
    console.log(`Service Worker v${APP_VERSION}: Installing...`);
    self.skipWaiting(); // Force activation on all open pages

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching static resources');
                return cache.addAll(STATIC_RESOURCES.filter(url => !url.startsWith('http')));
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log(`Service Worker v${APP_VERSION}: Activating...`);

    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(cacheName => {
                        return !cacheName.includes(APP_VERSION);
                    })
                    .map(cacheName => {
                        console.log('Service Worker: Clearing old cache', cacheName);
                        return caches.delete(cacheName);
                    })
            );
        }).then(() => {
            console.log('Service Worker: Claiming clients');
            return self.clients.claim(); // Take control of all open pages
        }).then(() => {
            // Notify clients about new version
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'NEW_VERSION',
                        version: APP_VERSION
                    });
                });
            });
        })
    );
});

// Helper function to check if URL should be network-only
function isNetworkOnlyRequest(url) {
    return NETWORK_ONLY.some(endpoint => url.includes(endpoint));
}

// Helper to determine if this is a Firebase API request
function isFirebaseRequest(url) {
    return url.includes('firestore.googleapis.com') ||
        url.includes('firebase');
}

// Fetch event - network-first strategy for API calls, cache-first for static resources
self.addEventListener('fetch', event => {
    const requestUrl = event.request.url;

    // Handle non-GET requests normally (pass through)
    if (event.request.method !== 'GET') {
        return;
    }

    // For Firebase/API requests - try network with offline fallback
    if (isFirebaseRequest(requestUrl)) {
        // We don't cache Firebase requests directly
        // The app should handle offline storage and sync
        return;
    }

    // For other requests - Cache First with Network Fallback
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Return cached response if available
                if (cachedResponse) {
                    return cachedResponse;
                }

                // Otherwise try fetching from network
                return fetch(event.request)
                    .then(response => {
                        // Check if we received a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response since it can only be consumed once
                        const responseToCache = response.clone();

                        // Only cache http(s) URLs (Cache API rejects chrome-extension:, etc.)
                        const url = (event.request.url || '').toLowerCase();
                        if (url.startsWith('http://') || url.startsWith('https://')) {
                            caches.open(DYNAMIC_CACHE)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                        }

                        return response;
                    })
                    .catch(error => {
                        console.log('Service Worker: Fetch failed; serving offline fallback.', error);
                        // Must return a Response — undefined triggers
                        // "Failed to convert value to 'Response'".
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html').then((page) => {
                                return (
                                    page ||
                                    new Response(
                                        '<!DOCTYPE html><html><body><h1>Offline</h1><p>Check your connection and refresh.</p></body></html>',
                                        {
                                            status: 503,
                                            statusText: 'Service Unavailable',
                                            headers: { 'Content-Type': 'text/html; charset=utf-8' },
                                        }
                                    )
                                );
                            });
                        }
                        return new Response('', {
                            status: 503,
                            statusText: 'Service Unavailable',
                        });
                    });
            })
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CHECK_VERSION') {
        event.ports[0].postMessage({
            type: 'VERSION_INFO',
            version: APP_VERSION
        });
    }
});
