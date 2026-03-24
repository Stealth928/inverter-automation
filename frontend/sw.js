const CACHE_VERSION = 'socrates-v63';
const CACHE_PREFIX = 'socrates-';
const API_CLIENT_VERSION = '5';
const SHARED_UTILS_VERSION = '13';
const APP_SHELL_VERSION = '24';
const TOUR_VERSION = '33';
const ADMIN_VERSION = '14';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_FALLBACK_PAGE = '/app.html';

const STATIC_ASSETS = [
  '/',
  '/app.html',
  '/login.html',
  '/setup.html',
  '/settings.html',
  '/control.html',
  '/history.html',
  '/roi.html',
  '/admin.html',
  '/css/shared-styles.css?v=9',
  '/css/tour.css?v=4',
  `/js/tour.js?v=${TOUR_VERSION}`,
  '/js/firebase-config.js',
  '/js/firebase-auth.js',
  `/js/api-client.js?v=${API_CLIENT_VERSION}`,
  `/js/shared-utils.js?v=${SHARED_UTILS_VERSION}`,
  `/js/app-shell.js?v=${APP_SHELL_VERSION}`,
  `/js/admin.js?v=${ADMIN_VERSION}`,
  '/favicon.ico',
  '/manifest.webmanifest',
  '/icons/icon-192.png?v=2',
  '/icons/icon-512.png?v=2',
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
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
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

  // Market insights data must reflect the latest publish immediately.
  // Bypass the service-worker cache so the admin panel never sticks to an old snapshot.
  if (requestUrl.pathname.startsWith('/data/aemo-market-insights/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (requestUrl.pathname === '/data/release-manifest.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Screenshot carousel assets should always reflect latest deploys.
  // Bypass service-worker cache so same-filename replacements are picked up.
  if (requestUrl.pathname.startsWith('/images/screenshots/')) {
    event.respondWith(fetch(request));
    return;
  }

  const updateCacheFromNetwork = async (cache, cacheKey, fetchOptions = {}) => {
    const networkResponse = await fetch(request, fetchOptions);
    if (networkResponse && networkResponse.status === 200) {
      cache.put(cacheKey, networkResponse.clone());
    }
    return networkResponse;
  };

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        try {
          return await updateCacheFromNetwork(cache, request, { cache: 'no-store' });
        } catch (_error) {
          const cachedPage = await cache.match(request);
          return cachedPage || caches.match(OFFLINE_FALLBACK_PAGE);
        }
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
      caches.open(STATIC_CACHE).then(async (cache) => {
        try {
          return await updateCacheFromNetwork(cache, request, { cache: 'no-store' });
        } catch (_error) {
          return cache.match(request);
        }
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
