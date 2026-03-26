const { test, expect } = require('@playwright/test');
const { installInternalPageHarness, jsonResponse } = require('./support/browser-harness');

test.use({ serviceWorkers: 'block' });

async function waitForSetupReady(page) {
  await expect(page.locator('#submitBtn')).toBeVisible();
  await expect(page.locator('#previewLaunchBtn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.getElementById('previewLaunchBtn')?.dataset.bound || null)).toBe('1');
}

async function mountSetupPage(page, options = {}) {
  const validateCalls = [];
  const validateResponse = options.validateResponse || jsonResponse({ errno: 0, result: { valid: true } });

  await installInternalPageHarness(page, {
    user: {
      uid: 'test-user-123',
      email: 'test@example.com',
      displayName: 'test'
    },
    trackRedirects: true
  });

  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    const method = route.request().method().toUpperCase();

    if (path === '/api/config/setup-status') {
      await route.fulfill(jsonResponse({ errno: 0, result: { setupComplete: false } }));
      return;
    }

    if (path === '/api/user/init-profile') {
      await route.fulfill(jsonResponse({ errno: 0, result: { initialized: true } }));
      return;
    }

    if (path === '/api/config/validate-keys' && method === 'POST') {
      const body = route.request().postDataJSON ? route.request().postDataJSON() : {};
      validateCalls.push(body || {});
      await route.fulfill(validateResponse);
      return;
    }

    await route.fulfill(jsonResponse({ errno: 0, result: {} }));
  });

  await page.goto('/setup.html', { waitUntil: 'domcontentloaded' });
  await waitForSetupReady(page);

  return { validateCalls };
}

test.describe('Setup Page', () => {
  test('renders the setup form with FoxESS selected by default @smoke', async ({ page }) => {
    await mountSetupPage(page);

    await expect(page).toHaveTitle(/Setup/i);
    await expect(page.locator('#providerFoxess')).toBeChecked();
    await expect(page.locator('#pricingProvider')).toHaveValue('amber');
    await expect(page.locator('#deviceSn')).toBeVisible();
    await expect(page.locator('#foxessToken')).toBeVisible();
    await expect(page.locator('#amberApiKeyGroup')).toBeVisible();
    await expect(page.locator('#pricingAemoRegionGroup')).toBeHidden();
    await expect(page.locator('#weatherPlace')).toBeVisible();
    await expect(page.locator('#previewLaunchBtn')).toContainText(/Preview With Sample Data/i);
  });

  test('shows field validation before posting incomplete FoxESS credentials', async ({ page }) => {
    const { validateCalls } = await mountSetupPage(page);

    await page.locator('#foxessToken').fill('placeholder-token');
    await page.locator('#weatherPlace').fill('Sydney, Australia');
    await page.locator('#inverterCapacityKw').fill('10');
    await page.locator('#batteryCapacityKwh').fill('13.5');
    await page.locator('#submitBtn').click();

    await expect(page.locator('#deviceSnGroup')).toHaveClass(/error/);
    await expect(page.locator('#deviceSnGroup .error-message .message-text')).toContainText(/Device Serial Number is required/i);
    await expect.poll(() => validateCalls.length).toBe(0);
  });

  test('switches provider-specific fields when AlphaESS is selected', async ({ page }) => {
    await mountSetupPage(page);

    await page.locator('#providerAlphaEssOption').click();

    await expect(page.locator('#alphaessFields')).toBeVisible();
    await expect(page.locator('#foxessFields')).toBeHidden();
    await expect(page.locator('#providerAlphaEss')).toBeChecked();
  });

  test('posts normalized FoxESS setup payload and stores success state @smoke', async ({ page }) => {
    const { validateCalls } = await mountSetupPage(page);

    await page.locator('#deviceSn').fill(' TEST-SN-001 ');
    await page.locator('#foxessToken').fill(' foxess-token ');
    await page.locator('#amberApiKey').fill(' amber-key ');
    await page.locator('#weatherPlace').fill('Sydney,Australia');
    await page.locator('#inverterCapacityKw').fill('10');
    await page.locator('#batteryCapacityKwh').fill('13.5');

    await page.locator('#submitBtn').click();

    await expect.poll(() => validateCalls.length).toBe(1);
    expect(validateCalls[0]).toMatchObject({
      device_sn: 'TEST-SN-001',
      foxess_token: 'foxess-token',
      amber_api_key: 'amber-key',
      weather_place: 'Sydney, Australia',
      inverter_capacity_w: 10000,
      battery_capacity_kwh: 13.5
    });

    await expect(page.locator('#submitBtn')).toContainText(/Success! Redirecting/i);
    await expect(page.locator('#deviceSnGroup')).toHaveClass(/success/);
    await expect(page.locator('#foxessTokenGroup')).toHaveClass(/success/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('foxess_setup_device_sn'))).toBe('TEST-SN-001');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tourAutoLaunch'))).toBe('1');
  });

  test('posts AEMO pricing selection when AEMO is chosen', async ({ page }) => {
    const { validateCalls } = await mountSetupPage(page);

    await page.locator('#pricingProvider').selectOption('aemo');
    await expect(page.locator('#pricingAemoRegionGroup')).toBeVisible();
    await expect(page.locator('#amberApiKeyGroup')).toBeHidden();

    await page.locator('#pricingAemoRegion').selectOption('SA1');
    await page.locator('#deviceSn').fill(' TEST-SN-002 ');
    await page.locator('#foxessToken').fill(' foxess-token-2 ');
    await page.locator('#weatherPlace').fill('Sydney,Australia');
    await page.locator('#inverterCapacityKw').fill('10');
    await page.locator('#batteryCapacityKwh').fill('13.5');

    await page.locator('#submitBtn').click();

    await expect.poll(() => validateCalls.length).toBe(1);
    expect(validateCalls[0]).toMatchObject({
      device_sn: 'TEST-SN-002',
      foxess_token: 'foxess-token-2',
      pricing_provider: 'aemo',
      aemo_region: 'SA1',
      amber_api_key: null,
      weather_place: 'Sydney, Australia',
      inverter_capacity_w: 10000,
      battery_capacity_kwh: 13.5
    });
  });

  test('surfaces validate-keys errors on the mapped field and restores the submit button', async ({ page }) => {
    await mountSetupPage(page, {
      validateResponse: jsonResponse({
        errno: 400,
        msg: 'Validation failed for: foxess_token',
        failed_keys: ['foxess_token'],
        errors: {
          foxess_token: 'FoxESS API Token is required'
        }
      }, 400)
    });

    await page.locator('#deviceSn').fill('TEST-SN-001');
    await page.locator('#foxessToken').fill('bad-token');
    await page.locator('#weatherPlace').fill('Sydney, Australia');
    await page.locator('#inverterCapacityKw').fill('10');
    await page.locator('#batteryCapacityKwh').fill('13.5');

    await page.locator('#submitBtn').click();

    await expect(page.locator('#foxessToken').locator('xpath=ancestor::div[contains(@class,"form-group")]')).toHaveClass(/error/);
    await expect(page.locator('#submitBtn')).toContainText(/Validate & Continue/i);
  });

  test('preview launch seeds preview mode and queues an app redirect', async ({ page }) => {
    await mountSetupPage(page);

    await page.locator('#previewLaunchBtn').click();

    const result = await page.evaluate(() => ({
      previewSession: window.PreviewSession ? window.PreviewSession.get() : null,
      autoLaunch: sessionStorage.getItem('tourAutoLaunch')
    }));

    expect(result.previewSession && result.previewSession.active).toBeTruthy();
    expect(result.autoLaunch).toBe('1');
  });

  test('profile menu tour action also enters preview mode from setup', async ({ page }) => {
    await mountSetupPage(page);

    await page.locator('[data-user-avatar]').click();
    await expect(page.locator('[data-take-tour]')).toBeVisible();
    await page.locator('[data-take-tour]').click();

    const result = await page.evaluate(() => ({
      previewSession: window.PreviewSession ? window.PreviewSession.get() : null
    }));

    expect(result.previewSession && result.previewSession.active).toBeTruthy();
  });
});