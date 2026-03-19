const { test, expect } = require('@playwright/test');

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockRoiApi(page, { deviceProvider = 'foxess', events = [] } = {}) {
  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    let body = { errno: 0, result: {} };

    if (path === '/api/config') {
      body = {
        errno: 0,
        result: {
          deviceProvider,
          deviceSn: 'ROI-SN-001',
          rules: []
        }
      };
    } else if (path === '/api/config/setup-status') {
      body = {
        errno: 0,
        result: {
          setupComplete: true,
          deviceProvider
        }
      };
    } else if (path === '/api/automation/audit') {
      body = {
        errno: 0,
        result: {
          ruleEvents: events
        }
      };
    } else if (path === '/api/metrics/api-calls') {
      body = {
        errno: 0,
        result: {
          '2026-03-20': {
            inverter: 0,
            amber: 0,
            weather: 0,
            ev: 0
          }
        }
      };
    } else if (path === '/api/admin/check') {
      body = { errno: 0, result: { isAdmin: false } };
    } else if (path === '/api/user/init-profile') {
      body = { errno: 0, result: { initialized: true } };
    } else if (path.startsWith('/api/amber')) {
      body = { errno: 0, result: [] };
    }

    await route.fulfill(jsonResponse(body, 200));
  });
}

test.describe('ROI Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('mockAuthUser', JSON.stringify({
          uid: 'test-user-roi',
          email: 'roi@example.com',
          displayName: 'ROI User'
        }));
        localStorage.setItem('mockAuthToken', 'mock-token');
      } catch (e) {
        // ignore
      }

      window.safeRedirect = function () {};
      window.location.assign = function () {};
    });
  });

  test('shows AlphaESS advisory notice on the ROI page', async ({ page }) => {
    await mockRoiApi(page, { deviceProvider: 'alphaess' });
    await page.goto('/roi.html');

    await expect(page.locator('#roiProviderNotice')).toBeVisible();
    await expect(page.locator('#roiProviderNotice')).toContainText(/AlphaESS ROI note/i);
    await expect(page.locator('#roiProviderNotice')).toContainText(/advisory/i);
  });

  test('keeps the ROI provider notice hidden for FoxESS', async ({ page }) => {
    await mockRoiApi(page, { deviceProvider: 'foxess' });
    await page.goto('/roi.html');

    await expect(page.locator('#roiProviderNotice')).toBeHidden();
  });

  test('uses advisory wording in the ROI calculation summary for AlphaESS', async ({ page }) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await mockRoiApi(page, {
      deviceProvider: 'alphaess',
      events: [
        {
          ruleId: 'alpha-rule-1',
          ruleName: 'Alpha Charge',
          startTime: oneHourAgo,
          durationMs: 10 * 60 * 1000,
          type: 'completed',
          action: {
            workMode: 'ForceCharge',
            fdPwr: 5000
          }
        }
      ]
    });

    await page.goto('/roi.html');
    await page.locator('#btnCalculateROI').click();

    await expect(page.locator('#roiContent')).toContainText(/requested rule power/i);
    await expect(page.locator('#roiContent')).toContainText(/indicative rather than exact/i);
  });
});
