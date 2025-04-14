// Matchanese Attendance App - Service Worker
const APP_VERSION = "0.47"; // IMPORTANT: Keep this in sync with script.js
const CACHE_NAME = `matchanese-v${APP_VERSION}`;
const DYNAMIC_CACHE = `matchanese-dynamic-v${APP_VERSION}`;

// Resources to cache during installation
const STATIC_RESOURCES = [
    '/',
    '/index.html',
    '/js/script.js',
    '/js/firebase-setup.js',
    '/css/style.css',
    '/manifest.webmanifest',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
    'https://cdn.jsdelivr.net/npm/flatpickr',
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js',
    'https://matchanese.com/cdn/shop/files/matchanese-2025-logo_e4944ef8-b626-4206-80c5-cc4fd9ed79ab.png'
];

// Resources that should always be fetched from network
const NETWORK_ONLY = [
    'firestore.googleapis.com'
];

// Install event - cache static resources
self.addEventListener('install', event => {
    console.log(`Service Worker v${APP_VERSION}: Installing...`);
    self.skipWaiting(); // Force activation on all open pages

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching static resources');
                return cache.addAll(STATIC_RESOURCES);
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

                        // Cache the network response for future use
                        caches.open(DYNAMIC_CACHE)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(error => {
                        console.log('Service Worker: Fetch failed; returning offline page instead.', error);
                        // Could return a custom offline page here if needed
                    });
            })
    );
});

// Background sync for offline data
self.addEventListener('sync', event => {
    if (event.tag === 'sync-attendance') {
        event.waitUntil(syncAttendanceData());
    }
});

// Function to sync offline attendance data
async function syncAttendanceData() {
    const offlineData = await getOfflineData();

    if (offlineData && offlineData.length > 0) {
        // Notify clients that sync is starting
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'SYNC_STARTED',
                    dataCount: offlineData.length
                });
            });
        });

        // This is a placeholder - the actual sync happens in the main JS
        // through the syncPendingData() function when back online

        // Notify clients sync is completed
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'SYNC_COMPLETED'
                });
            });
        });
    }
}

// Helper to get offline data (would be implemented in the app logic)
async function getOfflineData() {
    // This is just a placeholder since the actual offline data
    // is stored in localStorage by the app itself
    return [];
}

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CHECK_VERSION') {
        event.ports[0].postMessage({
            type: 'VERSION_INFO',
            version: APP_VERSION
        });
    }
});