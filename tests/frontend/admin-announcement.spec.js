const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockAdminAnnouncementEnvironment(page, options = {}) {
  const savedRequests = [];
  let currentAnnouncement = options.initialAnnouncement || {
    enabled: true,
    id: 'release-note-1',
    title: 'Initial announcement',
    body: 'Hello operators.',
    severity: 'warning',
    showOnce: true,
    audience: {
      requireTourComplete: true,
      requireSetupComplete: true,
      requireAutomationEnabled: false,
      minAccountAgeDays: 7,
      onlyIncludeUids: [],
      includeUids: ['user-a'],
      excludeUids: []
    },
    updatedAt: '2026-03-22T00:00:00.000Z',
    updatedByUid: 'admin-user-1',
    updatedByEmail: 'admin@example.com'
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

    if (path === '/api/admin/announcement' && route.request().method() === 'GET') {
      await route.fulfill(jsonResponse({ errno: 0, result: { announcement: currentAnnouncement } }));
      return;
    }

    if (path === '/api/admin/announcement' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      savedRequests.push(body);
      currentAnnouncement = {
        ...body.announcement,
        updatedAt: '2026-03-22T12:34:56.000Z',
        updatedByUid: 'admin-user-1',
        updatedByEmail: 'admin@example.com'
      };
      await route.fulfill(jsonResponse({ errno: 0, result: { announcement: currentAnnouncement } }));
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
      // ignore storage issues in test bootstrap
    }
  });

  return {
    getSavedRequests() {
      return savedRequests;
    }
  };
}

test.describe('Admin Announcement Tab', () => {
  test('renders admin tabs in the expected order', async ({ page }) => {
    await mockAdminAnnouncementEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.admin-tab-nav .tab-btn')).toHaveText([
      '\uD83D\uDCC8 Overview',
      '\uD83D\uDC65 Users',
      '\u2699\uFE0F Scheduler',
      '\uD83D\uDEF0\uFE0F DataWorks',
      '\uD83E\uDDED Behaviour',
      '\uD83E\uDE7A API Health',
      '\uD83D\uDCE3 Announcement',
      '\uD83D\uDD14 Notifications'
    ]);
  });

  test('loads the saved announcement and persists admin edits', async ({ page }) => {
    const env = await mockAdminAnnouncementEnvironment(page);

    await page.goto('/admin.html');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Announcement/i }).click();

    await expect(page.locator('#announcementIdInput')).toHaveValue('release-note-1');
    await expect(page.locator('#announcementTitleInput')).toHaveValue('Initial announcement');
    await expect(page.locator('#announcementAudienceSummary')).toContainText('Account age >= 7 days');
    await expect(page.locator('#announcementLifecycleTitle')).toHaveText('Live show-once announcement (release-note-1)');
    await expect(page.locator('#announcementSaveEffect')).toContainText('Keeping the same ID preserves prior dismissals');
    await expect(page.locator('#saveAnnouncementBtn')).toHaveText('Save Live');

    await page.locator('#announcementTitleInput').fill('Updated announcement');
    await page.locator('#announcementBodyInput').fill('Updated body for eligible users.');
    await page.locator('#announcementMinAccountAgeInput').fill('14');
    await page.locator('#announcementOnlyIncludeUidsInput').fill('vip@example.com');
    await page.locator('#announcementIncludeUidsInput').fill('user-a\nuser-b@example.com');
    await page.locator('#announcementSeveritySelect').selectOption('danger');
    await page.locator('#announcementShowOnceInput').uncheck();

    await expect(page.locator('#announcementPreview')).toHaveClass(/danger/);
    await expect(page.locator('#announcementAudienceSummary')).toContainText('Account age >= 14 days');
    await expect(page.locator('#announcementAudienceSummary')).toContainText('Only include allowlist: 1 user');
    await expect(page.locator('#announcementLifecycleTitle')).toHaveText('Live repeatable announcement');
    await expect(page.locator('#saveAnnouncementBtn')).toHaveText('Save Live');

    await page.locator('#saveAnnouncementBtn').click();

    await expect(page.locator('#announcementUpdated')).toContainText(/Last updated/i);
    await expect(page.locator('#announcementPreviewTitle')).toHaveText('Updated announcement');

    expect(env.getSavedRequests()).toEqual([
      {
        announcement: {
          enabled: true,
          id: 'release-note-1',
          title: 'Updated announcement',
          body: 'Updated body for eligible users.',
          severity: 'danger',
          showOnce: false,
          audience: {
            requireTourComplete: true,
            requireSetupComplete: true,
            requireAutomationEnabled: false,
            minAccountAgeDays: 14,
            onlyIncludeUids: ['vip@example.com'],
            includeUids: ['user-a', 'user-b@example.com'],
            excludeUids: []
          }
        }
      }
    ]);
  });
});
