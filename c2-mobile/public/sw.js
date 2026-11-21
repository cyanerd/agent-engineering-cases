// Offline shell: cache the app files on install, serve them when the network is down. No account data is cached.
const CACHE = 'shell-v1';
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html']))));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r ?? caches.match('./index.html'))));
});
