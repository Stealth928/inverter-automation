const CACHE_VERSION = 'socrates-v67';
const CACHE_PREFIX = 'socrates-';
const API_CLIENT_VERSION = '5';
const SHARED_UTILS_VERSION = '13';
const APP_SHELL_VERSION = '25';
const TOUR_VERSION = '33';
const ADMIN_VERSION = '14';
const DASHBOARD_VERSION = '10';
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
  `/js/dashboard.js?v=${DASHBOARD_VERSION}`,
  '/favicon.ico',
  '/manifest.webmanifest',
  '/icons/icon-192.png?v=2',
  '/icons/icon-512.png?v=2',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

function toSafeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function parsePushPayload(event) {
  if (!event || !event.data) {
    return {
      title: 'SoCrates notification',
      body: '',
      severity: 'info',
      deepLink: '/app.html'
    };
  }

  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        title: toSafeText(parsed.title, 'SoCrates notification'),
        body: toSafeText(parsed.body),
        severity: toSafeText(parsed.severity, 'info').toLowerCase(),
        deepLink: toSafeText(parsed.deepLink, '/app.html')
      };
    }
  } catch (_error) {
    // Fall back to text payload.
  }

  const fallbackBody = toSafeText(event.data.text ? event.data.text() : '');
  return {
    title: 'SoCrates notification',
    body: fallbackBody,
    severity: 'info',
    deepLink: '/app.html'
  };
}

function resolveDeepLinkUrl(deepLink) {
  const raw = toSafeText(deepLink, '/app.html');
  try {
    return new URL(raw, self.location.origin).toString();
  } catch (_error) {
    return `${self.location.origin}/app.html`;
  }
}

function iconForSeverity(severity) {
  const level = toSafeText(severity, 'info').toLowerCase();
  if (level === 'danger') return '/icons/icon-192.png?v=2';
  if (level === 'warning') return '/icons/icon-192.png?v=2';
  if (level === 'success') return '/icons/icon-192.png?v=2';
  return '/icons/icon-192.png?v=2';
}

function notificationTagFromPayload(payload) {
  const candidates = [
    toSafeText(payload?.notificationId),
    toSafeText(payload?.eventKey),
    toSafeText(payload?.campaignId)
  ].filter(Boolean);
  return candidates.length ? `socrates-notify-${candidates[0]}` : undefined;
}

async function postPushToClients(payload) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!clientList.length) {
    return { hasVisibleClient: false };
  }

  const hasVisibleClient = clientList.some((client) => client.visibilityState === 'visible');
  const message = {
    type: 'SOC_NOTIFICATIONS_PUSH',
    payload
  };

  if (hasVisibleClient) {
    await Promise.all(clientList
      .filter((client) => client.visibilityState === 'visible')
      .map((client) => client.postMessage(message)));
    return { hasVisibleClient: true };
  }

  return { hasVisibleClient: false };
}

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

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const payload = parsePushPayload(event);
    const clientResult = await postPushToClients(payload);
    if (clientResult.hasVisibleClient) {
      return;
    }

    await self.registration.showNotification(payload.title, {
      body: payload.body || '',
      icon: iconForSeverity(payload.severity),
      badge: '/icons/icon-192.png?v=2',
      tag: notificationTagFromPayload(payload),
      data: {
        ...payload,
        deepLink: resolveDeepLinkUrl(payload.deepLink)
      }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const payload = event.notification?.data && typeof event.notification.data === 'object'
    ? event.notification.data
    : {};
  const targetUrl = resolveDeepLinkUrl(payload.deepLink);
  event.notification?.close();

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientList.length) {
      const preferredClient = clientList.find((client) => client.visibilityState === 'visible') || clientList[0];
      try {
        if (preferredClient && typeof preferredClient.navigate === 'function') {
          await preferredClient.navigate(targetUrl);
        }
      } catch (_error) {
        // Ignore navigate failures and still attempt focus.
      }
      if (preferredClient && typeof preferredClient.focus === 'function') {
        await preferredClient.focus();
      }
      if (preferredClient && typeof preferredClient.postMessage === 'function') {
        preferredClient.postMessage({
          type: 'SOC_NOTIFICATIONS_CLICK',
          payload: {
            ...payload,
            deepLink: targetUrl
          }
        });
      }
      return;
    }

    await self.clients.openWindow(targetUrl);
  })());
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
    event.respondWith(fetch(request, { cache: 'no-store' }));
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
    requestUrl.pathname === '/js/dashboard.js' ||
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
