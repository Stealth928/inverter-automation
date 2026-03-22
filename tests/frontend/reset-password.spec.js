const { test, expect } = require('@playwright/test');
const { installInternalPageHarness } = require('./support/browser-harness');

test.use({ serviceWorkers: 'block' });

async function mountResetPage(page, options = {}) {
  const verifyResponse = options.verifyResponse || { success: true, email: 'reset@example.com' };
  const confirmResponse = options.confirmResponse || { success: true };
  const query = Object.prototype.hasOwnProperty.call(options, 'query')
    ? options.query
    : '?mode=resetPassword&oobCode=test-code';

  await installInternalPageHarness(page, {
    signedIn: false,
    stubFirebaseConfig: false
  });

  await page.addInitScript(({ initialVerifyResponse, initialConfirmResponse }) => {
    window.__resetTestState = {
      verifyResponse: initialVerifyResponse,
      confirmResponse: initialConfirmResponse,
      verifyCalls: [],
      confirmCalls: []
    };
  }, {
    initialVerifyResponse: verifyResponse,
    initialConfirmResponse: confirmResponse
  });

  await page.route('**/js/firebase-auth.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.firebaseAuth = {
          initialized: true,
          init: async function () { this.initialized = true; },
          verifyPasswordResetCode: async function (code) {
            window.__resetTestState.verifyCalls.push(code);
            return window.__resetTestState.verifyResponse;
          },
          confirmPasswordReset: async function (code, newPassword) {
            window.__resetTestState.confirmCalls.push({ code, newPassword });
            return window.__resetTestState.confirmResponse;
          }
        };
      `
    });
  });

  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: ''
    });
  });

  await page.goto(`/reset-password.html${query}`, { waitUntil: 'domcontentloaded' });
}

test.describe('Reset Password Page', () => {
  test('shows a fatal state when the reset link is missing or malformed @smoke', async ({ page }) => {
    await mountResetPage(page, { query: '' });

    await expect(page).toHaveTitle(/Reset Password/i);
    await expect(page.locator('#fatal')).toBeVisible();
    await expect(page.locator('#fatalMsg')).toContainText(/Missing or invalid password reset link/i);
    await expect(page.locator('a[href="/login.html"]')).toBeVisible();
  });

  test('verifies a valid reset code and reveals the bound account email @smoke', async ({ page }) => {
    await mountResetPage(page);

    await expect(page.locator('#form')).toBeVisible();
    await expect(page.locator('#intro')).toContainText(/Enter a new password/i);
    await expect(page.locator('#email')).toHaveValue('reset@example.com');
    await expect(page.locator('#email')).toBeDisabled();
  });

  test('rejects passwords shorter than six characters without calling confirm', async ({ page }) => {
    await mountResetPage(page);

    await page.locator('#password').fill('123');
    await page.locator('#submitBtn').click();

    await expect(page.locator('#msg')).toContainText(/at least 6 characters/i);
    await expect.poll(() => page.evaluate(() => window.__resetTestState.confirmCalls.length)).toBe(0);
  });

  test('submits a valid password reset and redirects back to sign in', async ({ page }) => {
    await mountResetPage(page);

    await page.locator('#password').fill('new-password-123');
    await page.locator('#submitBtn').click();

    await expect(page.locator('#msg')).toContainText(/Password updated successfully/i);
    await expect.poll(() => page.evaluate(() => window.__resetTestState.confirmCalls.length)).toBe(1);

    const confirmCall = await page.evaluate(() => window.__resetTestState.confirmCalls[0]);
    expect(confirmCall).toMatchObject({
      code: 'test-code',
      newPassword: 'new-password-123'
    });

    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('/login.html');
  });

  test('shows the fatal expired-link state when code verification fails', async ({ page }) => {
    await mountResetPage(page, {
      verifyResponse: {
        success: false,
        error: 'Expired link'
      }
    });

    await expect(page.locator('#fatal')).toBeVisible();
    await expect(page.locator('#fatalMsg')).toContainText(/Expired link/i);
    await expect(page.locator('#form')).toBeHidden();
  });

  test('keeps the user on the page and shows an error when reset confirmation fails', async ({ page }) => {
    await mountResetPage(page, {
      confirmResponse: {
        success: false,
        error: 'Reset failed'
      }
    });

    await page.locator('#password').fill('new-password-123');
    await page.locator('#submitBtn').click();

    await expect(page.locator('#msg')).toContainText(/Reset failed/i);
    await expect(page).toHaveURL(/reset-password\.html/);
    await expect(page.locator('#submitBtn')).toContainText(/Set new password/i);
  });
});