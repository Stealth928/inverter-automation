const { test, expect } = require('@playwright/test');

async function seedAuthUser(page, user) {
  await page.addInitScript((seedUser) => {
    window.__DISABLE_SERVICE_WORKER__ = true;
    try {
      localStorage.removeItem('mockAuthUser');
      localStorage.removeItem('mockAuthToken');
      localStorage.setItem('socratesAppReleaseId', '2026-03-22-announcement-runtime-1');
      sessionStorage.setItem('socratesAppReleaseReload:2026-03-22-announcement-runtime-1', '1');
    } catch (e) {
      // ignore in test setup
    }

    if (!seedUser) return;

    try {
      localStorage.setItem('mockAuthUser', JSON.stringify(seedUser));
      localStorage.setItem('mockAuthToken', 'mock-token');
    } catch (e) {
      // ignore in test setup
    }
  }, user || null);
}

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockAuthenticatedAnnouncementShell(page, options = {}) {
  const announcement = options.announcement || {
    enabled: true,
    id: 'release-note-1',
    title: 'New market insights rollout',
    body: 'We updated the dashboard for experienced users.',
    severity: 'warning',
    showOnce: true,
    audience: {
      requireTourComplete: true,
      requireSetupComplete: true,
      requireAutomationEnabled: false,
      minAccountAgeDays: 3,
      includeUids: [],
      excludeUids: []
    }
  };
  const state = {
    announcementRequests: 0,
    dismissedIds: []
  };

  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    });
  });

  await page.route('**/js/firebase-config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.firebaseConfig = { apiKey: "YOUR_TEST_KEY" };'
    });
  });

  await page.route('**/js/firebase-auth.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (function () {
          const raw = localStorage.getItem('mockAuthUser');
          const parsed = raw ? JSON.parse(raw) : null;
          const currentUser = parsed ? {
            uid: parsed.uid,
            email: parsed.email || '',
            displayName: parsed.displayName || '',
            getIdToken: async function () { return localStorage.getItem('mockAuthToken') || 'mock-token'; }
          } : null;
          window.firebaseAuth = {
            user: currentUser,
            async init() {},
            async getIdToken() {
              return localStorage.getItem('mockAuthToken') || 'mock-token';
            },
            onAuthStateChanged(callback) {
              setTimeout(function () { callback(currentUser); }, 0);
            },
            async signOut() {
              this.user = null;
              return { success: true };
            }
          };
        })();
      `
    });
  });

  await page.route('**/js/api-client.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        function initAPIClient(firebaseAuth) {
          return {
            async fetch(endpoint, options = {}) {
              const headers = {
                'Content-Type': 'application/json',
                ...(options.headers || {})
              };
              if (firebaseAuth && typeof firebaseAuth.getIdToken === 'function') {
                headers.Authorization = 'Bearer ' + await firebaseAuth.getIdToken();
              }
              return fetch(endpoint, { ...options, headers });
            }
          };
        }
        window.initAPIClient = initAPIClient;
      `
    });
  });

  await page.route('**/js/dashboard.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        AppShell.init({ pageName: 'app', requireAuth: true, checkSetup: true, autoMetrics: false });
        AppShell.onReady(() => {});
      `
    });
  });

  await page.route('**/js/app-analytics.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    });
  });

  await page.route('**/js/tour.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    });
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/user/init-profile') {
      await route.fulfill(jsonResponse({ errno: 0, result: { initialized: true } }));
      return;
    }

    if (path === '/api/config/setup-status') {
      await route.fulfill(jsonResponse({ errno: 0, result: { setupComplete: true } }));
      return;
    }

    if (path === '/api/admin/check') {
      await route.fulfill(jsonResponse({ errno: 0, result: { isAdmin: false } }));
      return;
    }

    if (path === '/api/config/announcement') {
      state.announcementRequests += 1;
      const visibleAnnouncement = state.dismissedIds.includes(announcement.id)
        ? null
        : announcement;
      await route.fulfill(jsonResponse({ errno: 0, result: { announcement: visibleAnnouncement } }));
      return;
    }

    if (path === '/api/config/announcement/dismiss') {
      const requestBody = route.request().postDataJSON();
      state.dismissedIds = Array.from(new Set([...state.dismissedIds, requestBody.id]));
      await route.fulfill(jsonResponse({
        errno: 0,
        msg: 'Announcement dismissed',
        result: {
          id: requestBody.id,
          announcementDismissedIds: state.dismissedIds
        }
      }));
      return;
    }

    await route.fulfill(jsonResponse({ errno: 0, result: {} }));
  });

  return state;
}

test.describe('Announcement Banner', () => {
  test.use({ serviceWorkers: 'block' });

  test('loads the runtime announcement and persists a show-once dismissal', async ({ page }) => {
    await seedAuthUser(page, {
      uid: 'announcement-user',
      email: 'announcement@example.com',
      displayName: 'Announcement User'
    });

    const runtimeState = await mockAuthenticatedAnnouncementShell(page);

    await page.goto('/app.html');
    await page.waitForFunction(() => Boolean(window.AppShell?.getUser?.()));
    await page.evaluate(() => window.AppShell.refreshAnnouncement());

    const banner = page.locator('#globalAnnouncementBanner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#globalAnnouncementBannerTitle')).toHaveText('New market insights rollout');
    await expect(page.locator('#globalAnnouncementBannerBody')).toContainText('experienced users');
    expect(runtimeState.announcementRequests).toBeGreaterThanOrEqual(1);

    await page.evaluate(() => {
      document.getElementById('globalAnnouncementDismissButton')?.click();
    });
    await expect.poll(() => runtimeState.dismissedIds.join(',')).toBe('release-note-1');
    await expect(banner).toBeHidden();
    expect(runtimeState.dismissedIds).toEqual(['release-note-1']);

    await page.reload();
    await expect(banner).toBeHidden();
  });
});
