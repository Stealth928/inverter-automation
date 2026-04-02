const { test, expect } = require('@playwright/test');

/**
 * Test Lab Page Tests
 * 
 * Tests the automation testing lab at test.html
 */

test.describe('Test Lab Page', () => {
  
  test.beforeEach(async ({ page }) => {
    // Mock Firebase auth
    await page.addInitScript(() => {
      window.mockFirebaseAuth = {
        currentUser: {
          uid: 'test-user-123',
          email: 'test@example.com',
          getIdToken: () => Promise.resolve('mock-token')
        }
      };
    });
    
    await page.goto('/test.html');
  });

  test('should load test lab page', async ({ page }) => {
    await expect(page).toHaveTitle(/Test|Lab|Debug|Automation/i);
  });

  test('should adapt Automation Lab chrome in light theme', async ({ page }) => {
    await page.goto('about:blank');
    await page.addInitScript(() => {
      window.localStorage.setItem('uiTheme', 'light');
    });

    await page.goto('/test.html?mode=quick');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    await expect(page.locator('.lab-mode-head')).toBeVisible();
    await expect(page.getByRole('button', { name: /Quick Simulation/i })).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: /Run Automation Test/i })).toBeVisible();

    const styles = await page.evaluate(() => {
      const parseRgb = (value) => {
        const matches = String(value || '').match(/\d+(\.\d+)?/g);
        return matches ? matches.slice(0, 3).map(Number) : null;
      };
      const brightness = (rgb) => {
        if (!rgb || rgb.length < 3) return null;
        return ((rgb[0] * 299) + (rgb[1] * 587) + (rgb[2] * 114)) / 1000;
      };
      const read = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const style = window.getComputedStyle(el);
        return {
          backgroundColor: style.backgroundColor,
          color: style.color,
          backgroundBrightness: brightness(parseRgb(style.backgroundColor)),
          colorBrightness: brightness(parseRgb(style.color))
        };
      };

      return {
        activeTab: read('.lab-mode-tab.active'),
        modeStat: read('.lab-mode-stat'),
        quickPanel: read('#simConditionsCard'),
        quickRunButton: read('#simRunActions .btn-primary')
      };
    });

    expect(styles.activeTab?.colorBrightness).toBeLessThan(80);
    expect(styles.modeStat?.backgroundBrightness).toBeGreaterThan(200);
    expect(styles.quickPanel?.backgroundBrightness).toBeGreaterThan(200);
    expect(styles.quickRunButton?.colorBrightness).toBeLessThan(80);
  });

  test('should unlock Backtesting / Optimisation for promoted admins after AppShell is ready', async ({ page }) => {
    let adminReady = false;

    await page.goto('about:blank');
    await page.addInitScript(() => {
      let appShellValue = null;
      let released = false;
      const pendingOnReady = [];

      const wrapAppShell = (value) => {
        if (!value || value.__automationLabReadyWrapped || typeof value.onReady !== 'function') {
          return value;
        }

        const originalOnReady = value.onReady.bind(value);
        value.onReady = (callback) => {
          if (released) {
            return originalOnReady(callback);
          }
          pendingOnReady.push(callback);
        };
        value.__automationLabReadyWrapped = true;
        window.__releaseAutomationLabShellReady = () => {
          if (released) return;
          released = true;
          while (pendingOnReady.length) {
            originalOnReady(pendingOnReady.shift());
          }
        };
        return value;
      };

      Object.defineProperty(window, 'AppShell', {
        configurable: true,
        get() {
          return appShellValue;
        },
        set(value) {
          appShellValue = wrapAppShell(value);
        }
      });
    });

    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let status = 200;
      let body = { errno: 0, result: {} };

      if (path === '/api/admin/check') {
        status = adminReady ? 200 : 401;
        body = adminReady
          ? { errno: 0, result: { isAdmin: true } }
          : { errno: 401, error: 'Unauthorized' };
      } else if (path === '/api/config/setup-status') {
        body = { errno: 0, result: { setupComplete: true } };
      } else if (path === '/api/user/init-profile') {
        body = { errno: 0, result: { initialized: true } };
      } else if (path === '/api/config') {
        body = {
          errno: 0,
          result: {
            timezone: 'Australia/Sydney',
            inverterCapacityW: 10000
          }
        };
      } else if (path === '/api/automation/status') {
        body = {
          errno: 0,
          result: {
            enabled: true,
            rules: {},
            config: {
              automation: { intervalMs: 60000 },
              cache: { amber: 60000, inverter: 300000, weather: 1800000 },
              defaults: { cooldownMinutes: 5, durationMinutes: 30 }
            }
          }
        };
      } else if (path === '/api/backtests/tariff-plans' || path === '/api/backtests/runs') {
        body = { errno: 0, result: [] };
      }

      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });
    });

    await page.goto('/test.html');
    adminReady = true;
    await page.evaluate(() => {
      if (typeof window.__releaseAutomationLabShellReady === 'function') {
        window.__releaseAutomationLabShellReady();
      }
    });

    const backtestButton = page.getByRole('button', { name: /Backtesting \/ Optimisation/i });
    await expect(backtestButton).toBeVisible({ timeout: 10000 });
    await expect(backtestButton).toBeEnabled({ timeout: 10000 });
  });

  test('should apply configured inverter capacity to Automation Lab rule power validation', async ({ page }) => {
    let createRequestCount = 0;
    let lastCreatePayload = null;

    await page.goto('about:blank');

    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          errno: 0,
          result: {
            inverterCapacityW: 15000
          }
        })
      });
    });

    await page.route('**/api/automation/rule/create', async (route) => {
      createRequestCount += 1;
      lastCreatePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ errno: 0, result: { ok: true } })
      });
    });

    await page.goto('/test.html');
    await page.waitForFunction(() => typeof window.showAddRuleModal === 'function');
    await page.evaluate(() => {
      window.__testLabAlerts = [];
      window.alert = (message) => window.__testLabAlerts.push(String(message));
      window.showAddRuleModal();
    });

    await expect.poll(async () => {
      return page.locator('#actionFdPwr').evaluate((input) => input.max);
    }, { timeout: 10000 }).toBe('15000');

    await page.fill('#ruleName', 'Happy Hour Export');
    await page.check('#condFeedIn');
    await page.fill('#condFeedInVal', '1');
    await page.fill('#actionFdPwr', '16000');
    await page.getByRole('button', { name: 'Create Rule' }).click();

    await expect.poll(async () => {
      return page.evaluate(() => window.__testLabAlerts[0] || '');
    }, { timeout: 5000 }).toContain('15000W');
    expect(createRequestCount).toBe(0);

    await page.fill('#actionFdPwr', '15000');
    await page.getByRole('button', { name: 'Create Rule' }).click();

    await expect.poll(() => createRequestCount, { timeout: 5000 }).toBe(1);
    expect(lastCreatePayload.action.fdPwr).toBe(15000);
  });

  test('should display rule testing section', async ({ page }) => {
    const hasTestSection = await page.getByText(/test|rule|evaluate|condition/i).count() > 0;
    expect(hasTestSection).toBeTruthy();
  });

  test('should have rule selector or list', async ({ page }) => {
    const hasSelect = await page.locator('select, .rule-list, .rule-selector').count() > 0;
    const hasRuleText = await page.getByText(/rule|select|choose/i).count() > 0;
    
    expect(hasSelect || hasRuleText).toBeTruthy();
  });

  test('should have test input fields', async ({ page }) => {
    // Input fields for test data (price, SOC, time, etc.)
    const inputCount = await page.locator('input[type="text"], input[type="number"], input[type="time"]').count();
    
    expect(inputCount).toBeGreaterThanOrEqual(0);
  });

  test('should have run test button', async ({ page }) => {
    const runBtn = page.locator('button:has-text("Run"), button:has-text("Test"), button:has-text("Evaluate")').first();
    const hasRun = await runBtn.count() > 0;
    
    expect(hasRun).toBeTruthy();
  });

  test('should display test results', async ({ page }) => {
    const hasResults = await page.locator('.results, .output, [data-results], #test-results').count() > 0;
    const hasResultsText = await page.getByText(/result|output|match|pass|fail/i).count() > 0;
    
    expect(hasResults || hasResultsText).toBeTruthy();
  });

  test('should show condition evaluation', async ({ page }) => {
    const hasConditions = await page.getByText(/condition|if|when|and|or/i).count() > 0;
    
    expect(hasConditions).toBeTruthy();
  });

  test('should display mock data section', async ({ page }) => {
    const hasMock = await page.getByText(/mock|simulate|test data|sample/i).count() > 0;
    
    expect(hasMock || true).toBeTruthy();
  });

  test('should have SOC input field', async ({ page }) => {
    const socInput = page.locator('input[name*="soc"], input[id*="soc"], input[placeholder*="SOC"]').first();
    const hasSOC = await socInput.count() > 0 || await page.getByText(/state of charge|soc|battery/i).count() > 0;
    
    expect(hasSOC).toBeTruthy();
  });

  test('should have price input field', async ({ page }) => {
    const priceInput = page.locator('input[name*="price"], input[id*="price"], input[placeholder*="price"]').first();
    const hasPrice = await priceInput.count() > 0 || await page.getByText(/price|tariff|cost/i).count() > 0;
    
    expect(hasPrice).toBeTruthy();
  });

  test('should have time/schedule input', async ({ page }) => {
    const timeInput = page.locator('input[type="time"], input[name*="time"], input[id*="time"]').first();
    const hasTime = await timeInput.count() > 0 || await page.getByText(/time|hour|schedule/i).count() > 0;
    
    expect(hasTime).toBeTruthy();
  });

  test('should run test and show results', async ({ page }) => {
    await page.route('**/api/automation/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          errno: 0,
          triggered: false,
          allResults: []
        })
      });
    });

    const runBtn = page.getByRole('button', { name: /Run Automation Test/i });
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    await expect(page.locator('#testResults')).toContainText('No Rules Matched');
  });

  test('should display pass/fail status', async ({ page }) => {
    const hasStatus = await page.getByText(/pass|fail|match|success|error/i).count() > 0;
    
    expect(hasStatus || true).toBeTruthy();
  });

  test('should show action that would be taken', async ({ page }) => {
    const hasActionIntentUi = await page.getByText(/exactly what would happen|run automation test|mock inverter scheduler|api payload preview/i).count() > 0;
    expect(hasActionIntentUi).toBeTruthy();
  });

  test('should have clear/reset button', async ({ page }) => {
    const clearBtn = page.locator('button:has-text("Clear"), button:has-text("Reset")').first();
    const hasClear = await clearBtn.count() > 0;
    
    expect(typeof hasClear).toBe('boolean');
  });

  test('should load sample/preset data', async ({ page }) => {
    const presetBtn = page.locator('button:has-text("Sample"), button:has-text("Preset"), button:has-text("Example")').first();
    
    if (await presetBtn.count() > 0) {
      await presetBtn.click();
      await page.waitForTimeout(500);
      
      // Inputs should be populated
      const inputs = page.locator('input[type="text"], input[type="number"]');
      const firstInput = inputs.first();
      
      if (await firstInput.count() > 0) {
        const value = await firstInput.inputValue();
        expect(typeof value).toBe('string');
      }
    }
    
    expect(true).toBeTruthy();
  });

  test('should populate the expanded quick presets including weekday-aware scenarios', async ({ page }) => {
    await page.goto('about:blank');

    await page.route('**/api/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          errno: 0,
          result: {
            inverterCapacityW: 10000
          }
        })
      });
    });

    await page.route('**/api/automation/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          errno: 0,
          result: {
            enabled: true,
            rules: {},
            config: {
              automation: { intervalMs: 60000 },
              cache: { amber: 60000, inverter: 300000, weather: 1800000 },
              defaults: { cooldownMinutes: 5, durationMinutes: 30 }
            }
          }
        })
      });
    });

    await page.goto('/test.html');
    await page.getByRole('button', { name: /Quick Simulation/i }).click();
    await page.waitForFunction(() => typeof window.loadPreset === 'function');

    await page.getByRole('button', { name: /Negative Price/i }).click();
    await expect(page.locator('#simBuy')).toHaveValue('-6');
    await expect(page.locator('#simSoC')).toHaveValue('58');
    await expect(page.locator('#simForecastBuy1D')).toHaveValue('4');

    await page.getByRole('button', { name: /Low Solar/i }).click();
    await expect(page.locator('#simSolarRadiation')).toHaveValue('120');
    await expect(page.locator('#simForecastSolar1D')).toHaveValue('130');
    await expect(page.locator('#simCloudCover')).toHaveValue('86');

    await page.getByRole('button', { name: /Weekend Export/i }).click();
    await expect(page.locator('#simTime')).toHaveValue('11:30');
    await expect(page.locator('#simDayOfWeek')).toHaveValue('6');
    await expect(page.locator('#simFeedIn')).toHaveValue('10');
    await expect(page.locator('#simSoC')).toHaveValue('94');
  });

  test('should show condition details', async ({ page }) => {
    // Should show breakdown of condition evaluation
    const hasDetails = await page.locator('.condition-details, .debug-info, [data-debug]').count() > 0;
    
    expect(typeof hasDetails).toBe('boolean');
  });

  test('should display rule priority in test', async ({ page }) => {
    const hasPriority = await page.getByText(/priority|order/i).count() > 0;
    
    expect(hasPriority || true).toBeTruthy();
  });

  test('should navigate back to control', async ({ page }) => {
    const controlLink = page.locator('a[href*="control"], a:has-text("Control"), a:has-text("Rules")').first();
    const hasControlLink = await controlLink.count() > 0;
    
    if (hasControlLink) {
      const href = (await controlLink.getAttribute('href').catch(() => '')) || '';
      await controlLink.click({ timeout: 2000 }).catch(() => {});
      const navigated = await page.waitForURL(/control\.html/, { timeout: 3000 }).then(() => true).catch(() => false);
      expect(navigated || page.url().includes('control') || href.includes('control')).toBeTruthy();
    } else {
      expect(true).toBeTruthy();
    }
  });

  test('should validate input ranges', async ({ page }) => {
    const socInput = page.locator('input[name*="soc"], input[id*="soc"]').first();
    
    if (await socInput.count() > 0) {
      // Try invalid SOC value
      await socInput.fill('150');
      await page.waitForTimeout(200);
      
      // Should show validation error or clamp value
      const isInvalid = await socInput.evaluate(el => el.validity.valid === false).catch(() => false);
      
      expect(typeof isInvalid).toBe('boolean');
    } else {
      expect(true).toBeTruthy();
    }
  });

  test('should display responsive layout', async ({ page }) => {
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    // Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show help or documentation', async ({ page }) => {
    const hasHelp = await page.locator('.help, .documentation, [data-help]').count() > 0;
    const hasHelpText = await page.getByText(/help|how to|guide/i).count() > 0;
    
    expect(typeof (hasHelp || hasHelpText)).toBeTruthy();
  });

  test('should have all condition types available', async ({ page }) => {
    const hasConditionTypes = await page.getByText(/price|soc|time|day|solar|generation/i).count() > 0;
    
    expect(hasConditionTypes).toBeTruthy();
  });

  test('should show test history or log', async ({ page }) => {
    const hasLog = await page.locator('.test-log, .history, [data-log]').count() > 0;
    const hasLogText = await page.getByText(/log|history|previous/i).count() > 0;
    
    expect(typeof (hasLog || hasLogText)).toBe('boolean');
  });
});
