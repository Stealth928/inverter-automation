const CACHE_VERSION = 'socrates-v50';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/login.html',
  '/setup.html',
  '/settings.html',
  '/control.html',
  '/history.html',
  '/roi.html',
  '/curtailment-discovery.html',
  '/admin.html',
  '/css/shared-styles.css?v=9',
  '/css/tour.css?v=4',
  '/js/tour.js?v=31',
  '/js/firebase-config.js',
  '/js/firebase-auth.js',
  '/js/api-client.js?v=5',
  '/js/shared-utils.js?v=13',
  '/js/app-shell.js?v=15',
  '/js/admin.js?v=5',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    return;
  }

  // Screenshot carousel assets should always reflect latest deploys.
  // Bypass service-worker cache so same-filename replacements are picked up.
  if (requestUrl.pathname.startsWith('/images/screenshots/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) {
            return cachedPage;
          }
          return caches.match('/app.html');
        })
    );
    return;
  }

  const isCriticalShellAsset =
    requestUrl.pathname === '/js/tour.js' ||
    requestUrl.pathname === '/js/app-shell.js' ||
    requestUrl.pathname === '/js/admin.js' ||
    requestUrl.pathname === '/js/api-client.js' ||
    requestUrl.pathname === '/js/shared-utils.js' ||
    requestUrl.pathname === '/css/shared-styles.css' ||
    requestUrl.pathname === '/css/tour.css';

  if (isCriticalShellAsset) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(STATIC_CACHE);
          return cache.match(request);
        })
    );
    return;
  }

  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) => cache.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            cache.put(request, copy);
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    }))
  );
});
