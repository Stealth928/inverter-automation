const { test, expect } = require('@playwright/test');

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function mockRoiApi(page, {
  deviceProvider = 'foxess',
  events = [],
  pricingProvider = 'amber',
  pricingSelection = '',
  pricingSites = [],
  historicalPrices = []
} = {}) {
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
          pricingProvider,
          aemoRegion: pricingProvider === 'aemo' ? (pricingSelection || 'NSW1') : undefined,
          amberSiteId: pricingProvider === 'amber' ? pricingSelection : undefined,
          siteIdOrRegion: pricingSelection || undefined,
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
    } else if (path === '/api/pricing/sites') {
      body = { errno: 0, result: pricingSites };
    } else if (path === '/api/pricing/prices') {
      body = { errno: 0, result: historicalPrices };
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

  test('matches AEMO settled prices on exact 5-minute boundaries without Amber timestamp offset', async ({ page }) => {
    const eventStartIso = '2026-03-26T10:00:00.000Z';
    const eventStartMs = Date.parse(eventStartIso);

    await mockRoiApi(page, {
      deviceProvider: 'foxess',
      pricingProvider: 'aemo',
      pricingSelection: 'NSW1',
      pricingSites: [
        {
          id: 'NSW1',
          region: 'NSW1',
          provider: 'aemo'
        }
      ],
      historicalPrices: [
        {
          type: 'CurrentInterval',
          channelType: 'general',
          perKwh: 12.34,
          startTime: eventStartIso,
          endTime: '2026-03-26T10:05:00.000Z'
        },
        {
          type: 'CurrentInterval',
          channelType: 'feedIn',
          perKwh: -5.67,
          startTime: eventStartIso,
          endTime: '2026-03-26T10:05:00.000Z'
        }
      ],
      events: [
        {
          ruleId: 'aemo-charge-1',
          ruleName: 'AEMO Charge',
          startTime: eventStartMs,
          durationMs: 4 * 60 * 1000,
          type: 'completed',
          action: {
            workMode: 'ForceCharge',
            fdPwr: 5000
          },
          roiSnapshot: {
            buyPrice: 99,
            feedInPrice: 8,
            houseLoadW: 0,
            estimatedGridExportW: 0
          }
        }
      ]
    });

    await page.goto('/roi.html');
    await page.locator('#btnCalculateROI').click();

    const roiTable = page.locator('#roiTable');
    await expect(roiTable).toBeVisible();
    await expect(roiTable).toContainText('12.34¢');
    await expect(roiTable).not.toContainText('99.00¢');
  });
});
