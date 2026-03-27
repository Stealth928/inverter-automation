const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockAdminNotificationsEnvironment(page) {
  const savedConfigs = [];
  const sentBroadcasts = [];

  const overviewPayload = {
    config: {
      enabled: true,
      defaultChannels: ['inbox', 'push'],
      adminAlerts: {
        enabled: true,
        channels: ['inbox', 'push'],
        events: {
          signup: { enabled: true },
          schedulerBreach: { enabled: true },
          dataworksFailure: { enabled: true },
          apiHealthBad: { enabled: true }
        },
        cooldowns: {
          schedulerBreachMs: 1800000,
          dataworksFailureMs: 1800000,
          apiHealthBadMs: 3600000
        }
      },
      audienceDefaults: {
        requireTourComplete: true,
        requireSetupComplete: true,
        requireAutomationEnabled: false,
        minAccountAgeDays: 14,
        onlyIncludeUids: [],
        includeUids: [],
        excludeUids: []
      },
      updatedAt: '2026-03-27T01:00:00.000Z',
      updatedByUid: 'admin-user-1',
      updatedByEmail: 'admin@example.com'
    },
    pushConfigured: true,
    activeSubscriptionCount: 12,
    campaigns: [
      {
        id: 'campaign-1',
        title: 'Maintenance notice',
        createdAt: '2026-03-26T08:00:00.000Z',
        targetedUsers: 23,
        inboxCreated: 20,
        pushAttempted: 18,
        pushSuccess: 17
      }
    ]
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
    const method = route.request().method();

    if (path === '/api/admin/check') {
      await route.fulfill(jsonResponse({ errno: 0, result: { isAdmin: true } }));
      return;
    }
    if (path === '/api/admin/platform-stats') {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          summary: { totalUsers: 12, configuredUsers: 9, mau: 7, automationActive: 5 },
          trend: [],
          warnings: []
        }
      }));
      return;
    }
    if (path === '/api/admin/firestore-metrics') {
      await route.fulfill(jsonResponse({
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
      }));
      return;
    }
    if (path === '/api/user/init-profile') {
      await route.fulfill(jsonResponse({ errno: 0, result: { initialized: true } }));
      return;
    }

    if (path === '/api/admin/notifications/overview' && method === 'GET') {
      await route.fulfill(jsonResponse({ errno: 0, result: overviewPayload }));
      return;
    }
    if (path === '/api/admin/notifications/config' && method === 'POST') {
      const body = route.request().postDataJSON();
      savedConfigs.push(body);
      overviewPayload.config = {
        ...body.notifications,
        updatedAt: '2026-03-27T03:00:00.000Z',
        updatedByUid: 'admin-user-1',
        updatedByEmail: 'admin@example.com'
      };
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          notifications: {
            ...body.notifications,
            updatedAt: '2026-03-27T03:00:00.000Z',
            updatedByUid: 'admin-user-1',
            updatedByEmail: 'admin@example.com'
          }
        }
      }));
      return;
    }
    if (path === '/api/admin/notifications/broadcasts' && method === 'POST') {
      const body = route.request().postDataJSON();
      sentBroadcasts.push(body);
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          campaignId: 'campaign-test',
          targetedUsers: 10,
          inboxCreated: 9,
          pushAttempted: 8,
          pushSuccess: 7
        }
      }));
      return;
    }

    await route.fulfill(jsonResponse({ errno: 0, result: {} }));
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
      // ignore
    }
  });

  return {
    getSavedConfigs() {
      return savedConfigs;
    },
    getSentBroadcasts() {
      return sentBroadcasts;
    }
  };
}

test.describe('Admin Notifications Tab', () => {
  test('loads notifications config and overview details', async ({ page }) => {
    await mockAdminNotificationsEnvironment(page);
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Notifications/i }).click();

    await expect(page.locator('#notificationsConfigEnabledInput')).toBeChecked();
    await expect(page.locator('#notificationsConfigChannelInboxInput')).toBeChecked();
    await expect(page.locator('#notificationsConfigChannelPushInput')).toBeChecked();
    await expect(page.locator('#notificationsAdminAlertsEnabledInput')).toBeChecked();
    await expect(page.locator('#notificationsAdminAlertsEventSignupInput')).toBeChecked();
    await expect(page.locator('#notificationsConfigMinAgeInput')).toHaveValue('14');
    await expect(page.locator('#notificationsOverviewPushConfigured')).toHaveText('Yes');
    await expect(page.locator('#notificationsOverviewActiveSubs')).toContainText('12');
    await expect(page.locator('#notificationsCampaignsList')).toContainText('Maintenance notice');
  });

  test('saves config and sends broadcast payload', async ({ page }) => {
    const env = await mockAdminNotificationsEnvironment(page);
    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Notifications/i }).click();

    await page.locator('#notificationsConfigChannelPushInput').uncheck();
    await page.locator('#notificationsConfigRequireAutomationInput').check();
    await page.locator('#notificationsConfigMinAgeInput').fill('21');
    await page.locator('#saveNotificationsConfigBtn').click();

    await page.locator('#notificationsBroadcastTitleInput').fill('Push test');
    await page.locator('#notificationsBroadcastBodyInput').fill('Broadcast body');
    await page.locator('#notificationsBroadcastSeveritySelect').selectOption('warning');
    await page.locator('#notificationsBroadcastDeepLinkInput').fill('/settings.html#notificationsSection');
    await page.locator('#notificationsBroadcastChannelPushInput').uncheck();
    await page.locator('#sendNotificationsBroadcastBtn').click();

    expect(env.getSavedConfigs()).toEqual([
      {
        notifications: {
          enabled: true,
          defaultChannels: ['inbox'],
          adminAlerts: {
            enabled: true,
            channels: ['inbox', 'push'],
            events: {
              signup: {
                enabled: true
              },
              schedulerBreach: {
                enabled: true
              },
              dataworksFailure: {
                enabled: true
              },
              apiHealthBad: {
                enabled: true
              }
            },
            cooldowns: {
              schedulerBreachMs: 1800000,
              dataworksFailureMs: 1800000,
              apiHealthBadMs: 3600000
            }
          },
          audienceDefaults: {
            requireTourComplete: true,
            requireSetupComplete: true,
            requireAutomationEnabled: true,
            minAccountAgeDays: 21,
            onlyIncludeUids: [],
            includeUids: [],
            excludeUids: []
          }
        }
      }
    ]);

    expect(env.getSentBroadcasts()).toEqual([
      {
        title: 'Push test',
        body: 'Broadcast body',
        severity: 'warning',
        deepLink: '/settings.html#notificationsSection',
        channels: ['inbox'],
        audience: {
          requireTourComplete: true,
          requireSetupComplete: true,
          requireAutomationEnabled: true,
          minAccountAgeDays: 21,
          onlyIncludeUids: [],
          includeUids: [],
          excludeUids: []
        }
      }
    ]);
  });
});
