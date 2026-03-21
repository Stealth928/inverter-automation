const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockAdminEnvironment(page, options = {}) {
  const behaviorResult = options.behaviorResult || {
    configured: false,
    source: 'ga4-data-api',
    updatedAt: new Date().toISOString(),
    window: { days: 30, startDate: '30daysAgo', endDate: 'today' },
    warnings: ['GA4 property id not configured on server'],
    setup: {
      requiredEnv: 'GA4_PROPERTY_ID',
      message: 'Set GA4_PROPERTY_ID to the numeric Google Analytics 4 property id for your web property to enable the Behaviour tab.'
    }
  };

  await page.route('**/js/firebase-config.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.firebaseConfig = { apiKey: "YOUR_TEST_KEY" };'
    });
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let payload = { errno: 0, result: {} };

    if (path === '/api/admin/check') {
      payload = { errno: 0, result: { isAdmin: true } };
    } else if (path === '/api/admin/platform-stats') {
      payload = {
        errno: 0,
        result: {
          summary: { totalUsers: 12, configuredUsers: 9, mau: 7, automationActive: 5 },
          trend: [],
          warnings: []
        }
      };
    } else if (path === '/api/admin/firestore-metrics') {
      payload = {
        errno: 0,
        result: {
          updatedAt: new Date().toISOString(),
          source: 'gcp-monitoring+usage-estimate',
          firestore: {
            readsMtd: 1234,
            writesMtd: 456,
            deletesMtd: 12,
            storageGb: 0.4,
            estimatedDocOpsCostUsd: 1.23,
            estimatedDocOpsBreakdown: []
          },
          billing: {
            projectMtdCostUsd: 4.56,
            projectServices: [],
            estimatedMtdCostUsd: 4.56,
            services: []
          },
          trend: [],
          warnings: []
        }
      };
    } else if (path === '/api/admin/behavior-metrics') {
      payload = { errno: 0, result: behaviorResult };
    } else if (path === '/api/user/init-profile') {
      payload = { errno: 0, result: { initialized: true } };
    }

    await route.fulfill(jsonResponse(payload));
  });

  await page.addInitScript(() => {
    window.__DISABLE_AUTH_REDIRECTS__ = true;
    window.__DISABLE_SERVICE_WORKER__ = true;
    window.mockFirebaseAuth = {
      currentUser: {
        uid: 'admin-user-1',
        email: 'admin@example.com',
        displayName: 'Admin User',
        getIdToken: () => Promise.resolve('mock-token')
      }
    };
    try {
      localStorage.setItem('mockAuthUser', JSON.stringify({
        uid: 'admin-user-1',
        email: 'admin@example.com',
        displayName: 'Admin User'
      }));
    } catch (_error) {
      // ignore storage issues in test bootstrap
    }
  });
}

test.describe('Admin Behaviour Tab', () => {
  test('renders the Behaviour tab and setup guidance when GA4 is not configured', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /Behaviour/i })).toBeVisible();
    await page.getByRole('button', { name: /Behaviour/i }).click();
    await expect(page.locator('#tab-behavior')).toBeVisible();
    await expect(page.locator('#behaviorSetup')).toContainText(/GA4_PROPERTY_ID/i);
  });

  test('renders behaviour metrics when the endpoint returns aggregated data', async ({ page }) => {
    await mockAdminEnvironment(page, {
      behaviorResult: {
        configured: true,
        source: 'ga4-data-api',
        propertyId: '123456789',
        updatedAt: '2026-03-21T03:14:15.000Z',
        window: { days: 30, startDate: '30daysAgo', endDate: 'today' },
        summary: {
          activeUsers: 18,
          pageViews: 146,
          eventCount: 221,
          avgEngagementSecondsPerUser: 51.8,
          avgEventsPerUser: 12.3,
          trackedPageCount: 6,
          customEventTypes: 2
        },
        pageSeries: [
          { date: '2026-03-18', activeUsers: 7, pageViews: 44, eventCount: 65 },
          { date: '2026-03-19', activeUsers: 11, pageViews: 52, eventCount: 81 }
        ],
        topPages: [
          { path: '/app.html', title: 'Overview', pageViews: 81, activeUsers: 14, avgEngagementSeconds: 43.6 },
          { path: '/settings.html', title: 'Settings', pageViews: 32, activeUsers: 8, avgEngagementSeconds: 26.8 }
        ],
        topEvents: [
          { eventName: 'settings_save_all', eventCount: 19, activeUsers: 6 },
          { eventName: 'history_fetch_report', eventCount: 12, activeUsers: 5 }
        ],
        warnings: []
      }
    });

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Behaviour/i }).click();
    await expect(page.locator('#behaviorActiveUsers')).toHaveText('18');
    await expect(page.locator('#behaviorPageViews')).toHaveText('146');
    await expect(page.locator('#behaviorEvents')).toHaveText('221');
    await expect(page.locator('#behaviorTopPagesBody')).toContainText('/app.html');
    await expect(page.locator('#behaviorTopEventsBody')).toContainText('Settings Save All');
    await expect(page.locator('#behaviorMetricsUpdated')).toContainText(/GA4 property 123456789/i);
  });
});