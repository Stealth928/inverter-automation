const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

async function bootstrapRulesLibrary(page, options = {}) {
  const createRequests = [];
  const deleteRequests = [];
  const config = options.config || {
    inverterCapacityW: 10000,
    defaults: {}
  };
  const rulesState = options.rulesState || {};
  const statusState = options.statusState || {};

  await page.route('**/firebasejs/**', async (route) => {
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
      body: ''
    });
  });

  await page.route('**/js/api-client.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.apiClient = {
          get: async function(url) {
            const res = await fetch(url);
            return res.json();
          },
          post: async function(url, body) {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            return res.json();
          }
        };
      `
    });
  });

  await page.route('**/js/app-shell.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.AppShell = {
          init: function(options) {
            if (options && typeof options.onReady === 'function') {
              setTimeout(function() {
                options.onReady({ user: { uid: 'rules-library-test' }, apiClient: window.apiClient });
              }, 0);
            }
            return Promise.resolve({ user: { uid: 'rules-library-test' }, apiClient: window.apiClient });
          }
        };
      `
    });
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/config') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ errno: 0, result: config })
      });
    }

    if (path === '/api/automation/status') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ errno: 0, result: { rules: rulesState, ...statusState } })
      });
    }

    if (path === '/api/automation/rule/create') {
      const body = route.request().postDataJSON();
      createRequests.push(body);
      rulesState[slugify(body.name)] = body;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ errno: 0, result: { ruleId: slugify(body.name) } })
      });
    }

    if (path === '/api/automation/rule/delete') {
      const body = route.request().postDataJSON();
      deleteRequests.push(body);
      const ruleId = slugify(body.ruleName);
      delete rulesState[ruleId];
      if (statusState.activeRule === ruleId) {
        statusState.activeRule = null;
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ errno: 0, result: { deleted: body.ruleName } })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ errno: 0, result: {} })
    });
  });

  await page.addInitScript(() => {
    window.alert = function () {};
  });

  await page.goto('/rules-library.html');
  await page.waitForSelector('.rule-card');

  return { createRequests, deleteRequests };
}

test.describe('Rules Library Import', () => {
  test('derives ForceCharge power from inverter capacity during import (ignores absolute defaults)', async ({ page }) => {
    const { createRequests } = await bootstrapRulesLibrary(page, {
      config: {
        inverterCapacityW: 5000,
        defaults: { fdPwr: 4300 }
      }
    });

    await page.locator('.rule-card:has-text("Cheap Import Charging")').click();
    await page.locator('#importBtn').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].action.workMode).toBe('ForceCharge');
    expect(createRequests[0].action.fdPwr).toBe(2500);
  });

  test('derives percent-based template power from inverter capacity and strips template-only fields', async ({ page }) => {
    const { createRequests } = await bootstrapRulesLibrary(page, {
      config: {
        inverterCapacityW: 6200,
        defaults: {}
      }
    });

    await page.locator('.rule-card:has-text("High Feed-in Export")').click();
    await page.locator('#importBtn').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].action.workMode).toBe('ForceDischarge');
    expect(createRequests[0].action.fdPwr).toBe(3100);
    expect(createRequests[0].action.fdPwrPercent).toBeUndefined();
  });

  test('shows resolved watts on cards relative to user inverter size', async ({ page }) => {
    await bootstrapRulesLibrary(page, {
      config: {
        inverterCapacityW: 6200,
        defaults: {}
      }
    });

    const highFeedinPower = page.locator('.rule-card:has-text("High Feed-in Export") .card-action-meta .action-meta').first();
    const cheapImportPower = page.locator('.rule-card:has-text("Cheap Import Charging") .card-action-meta .action-meta').first();

    await expect(highFeedinPower).toHaveText('3100W');
    await expect(cheapImportPower).toHaveText('3100W');
    await expect(page.locator('body')).not.toContainText('% of inverter capacity');
  });

  test('uses built-in template power profile fallback when fdPwrPercent is missing', async ({ page }) => {
    await bootstrapRulesLibrary(page, {
      config: {
        inverterCapacityW: 6200,
        defaults: {}
      }
    });

    await page.evaluate(() => {
      const template = window.RULE_LIBRARY.find((rule) => rule.id === 'price_high_feedin_export');
      if (template && template.rule && template.rule.action) {
        delete template.rule.action.fdPwrPercent;
      }
    });

    const highFeedinPower = page.locator('.rule-card:has-text("High Feed-in Export") .card-action-meta .action-meta').first();
    await expect(highFeedinPower).toHaveText('3100W');
  });

  test('caps template power to inverter capacity when template power is too high', async ({ page }) => {
    const { createRequests } = await bootstrapRulesLibrary(page, {
      config: {
        inverterCapacityW: 5000,
        defaults: {}
      }
    });

    await page.evaluate(() => {
      const template = window.RULE_LIBRARY.find((rule) => rule.name === 'Price Spike Response');
      if (template && template.rule && template.rule.action) {
        template.rule.action.fdPwr = 12000;
        delete template.rule.action.fdPwrPercent;
      }
    });

    await page.locator('.rule-card:has-text("Price Spike Response")').click();
    await page.locator('#importBtn').click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0].action.workMode).toBe('ForceDischarge');
    expect(createRequests[0].action.fdPwr).toBe(5000);
    await expect(page.locator('#bannerDetail')).toContainText('Power adjusted for inverter limits');
  });

  test('auto-adjusts duplicate priorities within the same import batch', async ({ page }) => {
    const { createRequests } = await bootstrapRulesLibrary(page, {
      config: {
        inverterCapacityW: 8000,
        defaults: { fdPwr: 3200 }
      }
    });

    await page.locator('.rule-card:has-text("Negative Price Charge")').click();
    await page.locator('.rule-card:has-text("Price Spike Response")').click();
    await page.locator('#importBtn').click();

    await expect.poll(() => createRequests.length).toBe(2);

    const priorities = createRequests.map((req) => req.priority);
    expect(new Set(priorities).size).toBe(2);
    expect(priorities).toContain(1);
    expect(priorities).toContain(2);
    await expect(page.locator('#bannerDetail')).toContainText('Priority adjusted to avoid clashes');
  });

  test('removes an already imported rule when selected from the library', async ({ page }) => {
    const { deleteRequests } = await bootstrapRulesLibrary(page, {
      rulesState: {
        cheap_import_charging: {
          name: 'Cheap Import Charging',
          enabled: false,
          priority: 3,
          action: { workMode: 'ForceCharge', durationMinutes: 60, fdPwr: 2500 }
        }
      }
    });

    const card = page.locator('.rule-card:has-text("Cheap Import Charging")');
    await expect(card).toHaveClass(/already-imported/);
    await card.click();
    await expect(card).toHaveClass(/marked-remove/);
    await page.locator('#importBtn').click();

    await expect.poll(() => deleteRequests.length).toBe(1);
    expect(deleteRequests[0].ruleName).toBe('Cheap Import Charging');
    await expect(page.locator('#bannerTitle')).toContainText('1 rule removed from your automation');
    await expect(page.locator('#bannerDetail')).toContainText('Removed:');
    await expect(page.locator('.rule-card:has-text("Cheap Import Charging")')).not.toHaveClass(/already-imported/);
  });

  test('shows active-rule cleanup note when the removed rule is currently active', async ({ page }) => {
    const { deleteRequests } = await bootstrapRulesLibrary(page, {
      rulesState: {
        cheap_import_charging: {
          name: 'Cheap Import Charging',
          enabled: true,
          priority: 3,
          action: { workMode: 'ForceCharge', durationMinutes: 60, fdPwr: 2500 }
        }
      },
      statusState: {
        activeRule: 'cheap_import_charging'
      }
    });

    await page.locator('.rule-card:has-text("Cheap Import Charging")').click();
    await page.locator('#importBtn').click();

    await expect.poll(() => deleteRequests.length).toBe(1);
    await expect(page.locator('#bannerDetail')).toContainText('Active rule cleanup applied');
  });
});
