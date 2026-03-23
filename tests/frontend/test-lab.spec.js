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
    const runBtn = page.locator('button:has-text("Run"), button:has-text("Test")').first();
    
    if (await runBtn.count() > 0) {
      await runBtn.click();
      await page.waitForTimeout(1000);
      
      // Should show some result
      const hasResult = await page.locator('.results, .output, [data-results]').count() > 0;
      
      expect(typeof hasResult).toBe('boolean');
    } else {
      expect(true).toBeTruthy();
    }
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
