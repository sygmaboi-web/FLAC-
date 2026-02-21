const CACHE_NAME = 'kingpin-shell-v1';
const APP_SHELL = [
  '/',
  '/app',
  '/auth',
  '/manifest.webmanifest',
  '/icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          const responseClone = response.clone();
          if (event.request.url.startsWith(self.location.origin)) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone).catch(() => {});
            });
          }
          return response;
        })
        .catch(async () => {
          const url = new URL(event.request.url);
          if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
            const appShell = await caches.match('/');
            if (appShell) return appShell;
          }
          throw new Error('Network unavailable');
        });
    })
  );
});
