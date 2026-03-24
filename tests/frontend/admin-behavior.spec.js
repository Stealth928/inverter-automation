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
  const apiHealthResult = options.apiHealthResult || {
    source: 'metrics-rollups+cloud-functions-monitoring',
    updatedAt: new Date().toISOString(),
    window: { days: 30 },
    summary: {
      totalCalls: 1240,
      lastDayCalls: 88,
      callsAvg7d: 73.4,
      dominantProvider: { key: 'foxess', label: 'FoxESS', sharePct: 52.4 },
      callsPerExecution: 1.78,
      healthStatus: 'warn'
    },
    monitoring: {
      available: true,
      requestExecutionsTotal: 696,
      errorExecutionsTotal: 14,
      errorRatePct: 2.01
    },
    providers: [
      { key: 'foxess', label: 'FoxESS', totalCalls: 650, sharePct: 52.4, lastDayCalls: 41, avgDailyCalls7d: 34.2, trendPct: 42.1 },
      { key: 'amber', label: 'Amber', totalCalls: 310, sharePct: 25.0, lastDayCalls: 21, avgDailyCalls7d: 17.2, trendPct: 18.3 },
      { key: 'weather', label: 'Weather', totalCalls: 190, sharePct: 15.3, lastDayCalls: 15, avgDailyCalls7d: 11.4, trendPct: 4.5 },
      { key: 'ev', label: 'Tesla EV', totalCalls: 90, sharePct: 7.3, lastDayCalls: 11, avgDailyCalls7d: 10.6, trendPct: 87.4 }
    ],
    daily: [
      { date: '2026-03-20', totalCalls: 61, categories: { inverter: 35, amber: 14, weather: 7, ev: 5 }, evBreakdown: { wake: 2, vehicleData: 3 }, requestExecutions: 34, errorExecutions: 0 },
      { date: '2026-03-21', totalCalls: 75, categories: { inverter: 42, amber: 18, weather: 9, ev: 6 }, evBreakdown: { wake: 1, command: 2, vehicleData: 3 }, requestExecutions: 39, errorExecutions: 1 },
      { date: '2026-03-22', totalCalls: 88, categories: { inverter: 48, amber: 21, weather: 8, ev: 11 }, evBreakdown: { wake: 2, command: 4, vehicleData: 5 }, requestExecutions: 44, errorExecutions: 2 }
    ],
    alerts: [
      {
        level: 'warn',
        code: 'potential_overage_foxess',
        title: 'FoxESS usage acceleration',
        detail: 'Latest 7-day average is 34/day, up 42.1% versus the prior week. Treat this as a potential overage or rate-limit risk if that provider has tight quotas.'
      }
    ],
    warnings: []
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
    } else if (path === '/api/admin/api-health') {
      payload = { errno: 0, result: apiHealthResult };
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

  test('renders API health metrics and alerts from the admin endpoint', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /API Health/i }).click();
    await expect(page.locator('#apiHealthTotalCalls')).toHaveText('1.2K');
    await expect(page.locator('#apiHealthDominantProvider')).toHaveText('FoxESS');
    await expect(page.locator('#apiHealthErrorRate')).toHaveText('2.01%');
    await expect(page.locator('#apiHealthProvidersBody')).toContainText('Amber');
    await expect(page.locator('#apiHealthAlerts')).toContainText(/potential overage or rate-limit risk/i);
    await expect(page.locator('#apiHealthDailyBody')).toContainText('Wake');
    await expect(page.locator('#apiHealthDailyBody')).toContainText('Command');
    await expect(page.locator('#apiHealthDailyBody')).toContainText('Data');
  });

  test('keeps API health layout contained on phone screens', async ({ page }) => {
    await mockAdminEnvironment(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /API Health/i }).click();
    await expect(page.locator('#apiHealthDailyBody')).toContainText('Wake');

    const cardBounds = await page.locator('#tab-apiHealth .card').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth
      };
    });

    expect(cardBounds.left).toBeGreaterThanOrEqual(-1);
    expect(cardBounds.right).toBeLessThanOrEqual(cardBounds.viewportWidth + 1);
  });
});