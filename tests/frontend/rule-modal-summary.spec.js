const { test, expect } = require('@playwright/test');

async function openAddRuleModal(page) {
  await page.waitForFunction(() => typeof window.showAddRuleModal === 'function');
  await page.evaluate(() => {
    const existing = document.getElementById('addRuleModal');
    if (existing) existing.remove();
    window.showAddRuleModal();
  });
  await expect(page.locator('#addRuleModal')).toBeVisible();
}

test.describe('Rule Modal Summaries', () => {
  test.beforeEach(async ({ page }) => {
    // Stub AppShell to avoid auth/setup redirects during UI-focused modal tests.
    await page.route('**/js/app-shell.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.AppShell = {
            init: function(options) {
              if (options && typeof options.onReady === 'function') {
                setTimeout(function() { options.onReady({ user: null, apiClient: null }); }, 0);
              }
              return Promise.resolve({ user: null, apiClient: null });
            }
          };
        `
      });
    });

    // Force local mock auth mode in tests.
    await page.route('**/js/firebase-config.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.firebaseConfig = { apiKey: "YOUR_TEST_KEY" };'
      });
    });

    // Prevent backend calls from failing noisily while we test modal UX.
    await page.route('**/api/**', async (route) => {
      const requestUrl = new URL(route.request().url());
      let body = { errno: 0, result: {} };

      if (requestUrl.pathname === '/api/config') {
        body = {
          errno: 0,
          result: {
            automation: { intervalMs: 60000 },
            preferences: { forecastDays: 6, weatherPlace: 'Sydney, Australia' }
          }
        };
      }

      if (requestUrl.pathname === '/api/automation/status') {
        body = {
          errno: 0,
          result: {
            enabled: false,
            inBlackout: false,
            lastCheck: Date.now(),
            rules: {}
          }
        };
      }

      if (requestUrl.pathname === '/api/config/setup-status') {
        body = {
          errno: 0,
          result: { setupComplete: true }
        };
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });
    });

    await page.addInitScript(() => {
      try {
        localStorage.setItem('mockAuthUser', JSON.stringify({
          uid: 'test-user-rule-modal',
          email: 'rulemodal@example.com',
          displayName: 'Rule Modal User'
        }));
        localStorage.setItem('mockAuthToken', 'mock-token');
      } catch (e) {
        // ignore
      }

      // Suppress redirects/alerts in test runs.
      window.safeRedirect = function () {};
      window.location.assign = function () {};
      window.alert = function () {};
    });

    await page.goto('/app.html');
    await page.waitForLoadState('domcontentloaded');
  });

  test('keeps top and action plain-English summaries in sync', async ({ page }) => {
    await openAddRuleModal(page);

    await page.fill('#addRuleModal #newRuleName', 'Heat Shield');
    await page.uncheck('#addRuleModal #newRuleEnabled');
    await page.check('#addRuleModal #condTempEnabled');
    await page.selectOption('#addRuleModal #condTempType', 'forecastMax');
    await page.selectOption('#addRuleModal #condTempOp', '<');
    await page.fill('#addRuleModal #condTempVal', '40');
    await page.selectOption('#addRuleModal #condTempDayOffset', '3');

    const topSummary = page.locator('#addRuleModal #rulePlainEnglishTopText');
    await expect(topSummary).toContainText('Heat Shield is paused.');
    await expect(topSummary).toContainText('forecast daily maximum temperature in the next 3 days is below 40');
    await expect(topSummary).toContainText('Then it will force battery discharge for 30 minutes.');

    await page.selectOption('#addRuleModal #newRuleWorkMode', 'SelfUse');
    await page.fill('#addRuleModal #newRuleDuration', '45');
    await page.fill('#addRuleModal #newRuleFdPwr', '4200');
    await page.fill('#addRuleModal #newRuleFdSoc', '30');
    await page.fill('#addRuleModal #newRuleMinSoc', '25');
    await page.fill('#addRuleModal #newRuleMaxSoc', '85');
    await page.fill('#addRuleModal #newRuleCooldown', '7');

    const actionSummary = page.locator('#addRuleModal #ruleActionPlainEnglishText');
    await expect(actionSummary).toContainText('When triggered, this rule will switch inverter to self-use mode for 45 minutes at 4200W');
    await expect(actionSummary).toContainText('stop SoC 30%');
    await expect(actionSummary).toContainText('min grid SoC 25%');
    await expect(actionSummary).toContainText('max SoC 85%');
    await expect(actionSummary).toContainText('cooldown 7 minutes');
    await expect(actionSummary).toContainText('Active cancellation applies');
  });

  test('shows forecast-first temperature choices and supports 0-10 day look-ahead', async ({ page }) => {
    await openAddRuleModal(page);

    const tempTypeOptions = await page.locator('#addRuleModal #condTempType option').allTextContents();
    expect(tempTypeOptions.slice(0, 2)).toEqual(['Forecast Daily Max', 'Forecast Daily Min']);

    const dayOffsetValues = await page.locator('#addRuleModal #condTempDayOffset option').evaluateAll((options) =>
      options.map((opt) => opt.value)
    );
    expect(dayOffsetValues).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

    const dayOffsetLabels = await page.locator('#addRuleModal #condTempDayOffset option').allTextContents();
    expect(dayOffsetLabels[0]).toBe('today');
    expect(dayOffsetLabels[1]).toBe('tomorrow');
    expect(dayOffsetLabels[10]).toBe('10 days ahead');

    await page.check('#addRuleModal #condTempEnabled');
    await expect(page.locator('#addRuleModal #condTempDayOffsetWrap')).toBeVisible();
    await expect(page.locator('#addRuleModal #condTempDayOffsetWrap')).toContainText('for');

    await page.selectOption('#addRuleModal #condTempType', 'battery');
    await expect(page.locator('#addRuleModal #condTempDayOffsetWrap')).toBeHidden();
    await expect(page.locator('#addRuleModal #condTempDayOffset')).toHaveValue('0');
  });

  test('groups current price conditions ahead of forecast price', async ({ page }) => {
    await openAddRuleModal(page);

    await expect(page.locator('#addRuleModal')).toContainText('Feed-in Price (current)');
    await expect(page.locator('#addRuleModal')).toContainText('Buy Price (current)');
    await expect(page.locator('#addRuleModal')).toContainText('Live export spot price');
    await expect(page.locator('#addRuleModal')).toContainText('Live import spot price');
    await expect(page.locator('#addRuleModal')).toContainText('Upcoming price window');

    const conditionOrder = await page.locator('#addRuleModal [data-condition-key]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-condition-key'))
    );

    expect(conditionOrder.slice(0, 4)).toEqual([
      'feedInPrice',
      'buyPrice',
      'forecastPrice',
      'soc'
    ]);
  });

  test('dims inactive condition rows and enables controls only when selected', async ({ page }) => {
    await openAddRuleModal(page);

    const buyRow = page.locator('#addRuleModal [data-condition-key="buyPrice"]');
    const buyOperator = page.locator('#addRuleModal #condBuyOp');
    const buyValue = page.locator('#addRuleModal #condBuyVal');

    await expect(buyOperator).toBeDisabled();
    await expect(buyValue).toBeDisabled();

    await page.check('#addRuleModal #condBuyEnabled');
    await expect(buyOperator).toBeEnabled();
    await expect(buyValue).toBeEnabled();
    await expect(buyRow).toHaveCSS('opacity', '1');
  });

  test('uses master summaries only and omits legacy temperature panel', async ({ page }) => {
    await openAddRuleModal(page);

    await expect(page.locator('#addRuleModal #rulePlainEnglishTop')).toBeVisible();
    await expect(page.locator('#addRuleModal #ruleActionPlainEnglish')).toBeVisible();
    await expect(page.locator('#addRuleModal #condTempPreviewWrap')).toHaveCount(0);
    await expect(page.locator('#addRuleModal').getByText('Currently off: temperature condition is off.')).toHaveCount(0);
  });
});
