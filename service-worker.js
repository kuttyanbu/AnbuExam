// Minimal service worker so Chrome allows installing. It does not cache anything,
// so admin updates from GitHub always appear immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));