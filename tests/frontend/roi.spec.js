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
  backtestRuns = [],
  tariffPlans = [],
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
    } else if (path === '/api/backtests/runs') {
      body = { errno: 0, result: backtestRuns };
    } else if (path === '/api/backtests/tariff-plans') {
      body = { errno: 0, result: tariffPlans };
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
    await expect(page.locator('#roiProviderNotice')).toContainText(/AlphaESS ROI accuracy:\s*Indicative/i);
    await expect(page.locator('#roiProviderNotice')).toContainText(/advisory/i);
  });

  test('shows an exact ROI notice for FoxESS', async ({ page }) => {
    await mockRoiApi(page, { deviceProvider: 'foxess' });
    await page.goto('/roi.html');

    await expect(page.locator('#roiProviderNotice')).toBeVisible();
    await expect(page.locator('#roiProviderNotice')).toContainText(/FoxESS ROI accuracy:\s*Exact/i);
  });

  test('shows a provisional ROI notice for unknown providers', async ({ page }) => {
    await mockRoiApi(page, { deviceProvider: 'mystery-oem' });
    await page.goto('/roi.html');

    await expect(page.locator('#roiProviderNotice')).toBeVisible();
    await expect(page.locator('#roiProviderNotice')).toContainText(/Unknown provider ROI accuracy:\s*Provisional/i);
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

    await expect(page.locator('#roiContent')).toContainText(/requested charge power only/i);
    await expect(page.locator('#roiContent')).toContainText(/Accuracy for AlphaESS:\s*Indicative/i);
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
    await expect(roiTable).toContainText('buy 12.34c');
    await expect(roiTable).not.toContainText('buy 99.00c');
  });

  test('uses incremental charge power instead of attributing house load to ROI', async ({ page }) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await mockRoiApi(page, {
      deviceProvider: 'foxess',
      events: [
        {
          ruleId: 'charge-1',
          ruleName: 'Night charge',
          startTime: oneHourAgo,
          durationMs: 30 * 60 * 1000,
          type: 'completed',
          action: {
            workMode: 'ForceCharge',
            fdPwr: 2000
          },
          roiSnapshot: {
            buyPrice: 30,
            feedInPrice: 8,
            houseLoadW: 1000,
            estimatedGridExportW: 0
          }
        }
      ]
    });

    await page.goto('/roi.html');
    await page.locator('#btnCalculateROI').click();

    const roiTable = page.locator('#roiTable');
    await expect(roiTable).toContainText('-$0.30');
    await expect(page.locator('#roiContent')).toContainText('Charge cost / gain -$0.30');
  });

  test('restores ROI status visibility on a later failed calculation', async ({ page }) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let roiAuditRequestCount = 0;

    await page.route('**/api/**', async (route) => {
      const requestUrl = new URL(route.request().url());
      const path = requestUrl.pathname;
      let body = { errno: 0, result: {} };

      if (path === '/api/config') {
        body = {
          errno: 0,
          result: {
            deviceProvider: 'foxess',
            deviceSn: 'ROI-SN-001',
            pricingProvider: 'amber',
            amberSiteId: '',
            rules: []
          }
        };
      } else if (path === '/api/config/setup-status') {
        body = {
          errno: 0,
          result: {
            setupComplete: true,
            deviceProvider: 'foxess'
          }
        };
      } else if (path === '/api/automation/audit') {
        if (requestUrl.searchParams.has('startDate')) {
          roiAuditRequestCount += 1;
          body = roiAuditRequestCount === 1
            ? {
                errno: 0,
                result: {
                  ruleEvents: [
                    {
                      ruleId: 'charge-1',
                      ruleName: 'Night charge',
                      startTime: oneHourAgo,
                      durationMs: 30 * 60 * 1000,
                      type: 'completed',
                      action: {
                        workMode: 'ForceCharge',
                        fdPwr: 2000
                      },
                      roiSnapshot: {
                        buyPrice: 30,
                        feedInPrice: 8,
                        houseLoadW: 0,
                        estimatedGridExportW: 0
                      }
                    }
                  ]
                }
              }
            : {
                errno: 500,
                error: 'Synthetic ROI failure'
              };
        } else {
          body = { errno: 0, result: { ruleEvents: [] } };
        }
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
      } else if (path === '/api/pricing/sites' || path === '/api/pricing/prices' || path === '/api/backtests/runs' || path === '/api/backtests/tariff-plans') {
        body = { errno: 0, result: [] };
      } else if (path.startsWith('/api/amber')) {
        body = { errno: 0, result: [] };
      }

      await route.fulfill(jsonResponse(body, 200));
    });

    await page.goto('/roi.html');
    await page.locator('#btnCalculateROI').click();
    await expect(page.locator('#roiStatus')).toContainText(/Analyzed 1 rule trigger/i);

    await page.waitForTimeout(3200);
    await page.locator('#btnCalculateROI').click();

    await expect(page.locator('#roiStatus')).toBeVisible();
    await expect(page.locator('#roiStatus')).toContainText(/Synthetic ROI failure/i);
  });

  test('values discharge as import avoidance plus export capture', async ({ page }) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await mockRoiApi(page, {
      deviceProvider: 'foxess',
      events: [
        {
          ruleId: 'discharge-1',
          ruleName: 'Peak discharge',
          startTime: oneHourAgo,
          durationMs: 30 * 60 * 1000,
          type: 'completed',
          action: {
            workMode: 'ForceDischarge',
            fdPwr: 3000
          },
          roiSnapshot: {
            buyPrice: 40,
            feedInPrice: 20,
            houseLoadW: 1200,
            estimatedGridExportW: 1800
          }
        }
      ]
    });

    await page.goto('/roi.html');
    await page.locator('#btnCalculateROI').click();

    const roiTable = page.locator('#roiTable');
    await expect(roiTable).toContainText('Discharge');
    await expect(roiTable).toContainText('buy 40.00c + feed-in 20.00c');
    await expect(roiTable).toContainText('$0.42');
    await expect(page.locator('#roiContent')).toContainText('Import avoidance $0.24');
    await expect(page.locator('#roiContent')).toContainText('Export capture $0.18');
  });

  test('escapes rule and condition content before rendering ROI and history', async ({ page }) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await mockRoiApi(page, {
      deviceProvider: 'foxess',
      events: [
        {
          ruleId: 'xss-1',
          ruleName: `<img src=x onerror="window.__roiXss='rule'">`,
          startTime: oneHourAgo,
          durationMs: 10 * 60 * 1000,
          type: 'completed',
          action: {
            workMode: 'ForceCharge',
            fdPwr: 1000
          },
          roiSnapshot: {
            buyPrice: 25,
            feedInPrice: 10,
            houseLoadW: 0,
            estimatedGridExportW: 0
          },
          startAllRules: [
            {
              name: `<svg onload="window.__roiXss='start'">`,
              triggered: true,
              conditions: [
                {
                  met: true,
                  name: 'Buy Price',
                  value: `<svg onload="window.__roiXss='condition'">`
                }
              ]
            }
          ]
        }
      ]
    });

    await page.goto('/roi.html');
    await page.locator('#btnCalculateROI').click();

    await expect(page.locator('#roiTable')).toContainText(`<img src=x onerror="window.__roiXss='rule'">`);
    await expect(page.locator('#automationHistoryContent')).toContainText(`<img src=x onerror="window.__roiXss='rule'">`);
    await expect.poll(async () => page.evaluate(() => window.__roiXss || null)).toBeNull();
  });

  test('shows baseline comparison evidence and keeps backtest period filters within shipped limits', async ({ page }) => {
    await mockRoiApi(page, {
      deviceProvider: 'foxess',
      backtestRuns: [
        {
          requestedAtMs: Date.now(),
          status: 'completed',
          request: {
            period: { startDate: '2026-03-01', endDate: '2026-03-30' },
            scenarios: [
              {
                name: 'Peak Saver',
                tariff: { plan: { name: 'Amber NSW' } }
              }
            ]
          },
          result: {
            confidence: 'medium',
            limitations: ['Battery SoC before the first historical sample was reconstructed from battery power'],
            summaries: [
              {
                scenarioId: 'baseline',
                scenarioName: 'No automation',
                totalBillAud: 210.15,
                throughputKWh: 5.1,
                triggerCount: 0,
                importKWh: 40,
                exportKWh: 12
              },
              {
                scenarioId: 'peak-saver',
                scenarioName: 'Peak Saver',
                totalBillAud: 180.10,
                throughputKWh: 9.5,
                triggerCount: 8,
                importKWh: 31,
                exportKWh: 16,
                deltaVsBaseline: {
                  billAud: 30.05
                }
              }
            ],
            comparisons: [
              {
                leftScenarioName: 'No automation',
                rightScenarioName: 'Peak Saver',
                billDeltaAud: -30.05
              }
            ]
          }
        }
      ],
      tariffPlans: [
        { id: 'plan-1', name: 'Amber NSW' }
      ]
    });

    await page.goto('/roi.html');

    await expect(page.locator('#roiBacktestsCard')).toContainText(/Compare Against Baseline/i);
    await expect(page.locator('#roiBacktestsCard')).toContainText(/passive self-use/i);
    await expect(page.locator('#roiBacktestsCard')).toContainText(/Most important limitation/i);
    await expect(page.locator('#roiBacktestsCard')).toContainText(/Confidence:\s*medium/i);
    await expect(page.locator('#roiBacktestsCard select[data-filter="period"]')).not.toContainText('365 days');
  });
});
