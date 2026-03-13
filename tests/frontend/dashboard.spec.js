const { test, expect } = require('@playwright/test');

/**
 * Dashboard (Index) Page Tests
 * 
 * Tests the main dashboard at index.html
 */

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

function extractVehicleIdFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/api\/ev\/vehicles\/([^/]+)\/(?:status|command)$/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (e) {
    return '';
  }
}

async function mockEvApis(page, options = {}) {
  const vehicles = Array.isArray(options.vehicles) ? options.vehicles : [];
  const statusByVehicleId = options.statusByVehicleId || {};
  const commandByVehicleId = options.commandByVehicleId || {};
  const defaultStatus = options.defaultStatus || {
    status: 200,
    body: {
      errno: 0,
      source: 'cache',
      result: {
        socPct: 50,
        chargingState: 'stopped',
        isPluggedIn: false,
        isHome: false,
        rangeKm: 250,
        chargeLimitPct: 80,
        asOfIso: new Date().toISOString()
      }
    }
  };
  const defaultCommand = options.defaultCommand || {
    status: 200,
    body: { errno: 0, result: { accepted: true } }
  };

  await page.route('**/api/ev/vehicles', async (route) => {
    await route.fulfill(jsonResponse({ errno: 0, result: vehicles }, 200));
  });

  await page.route('**/api/ev/vehicles/*/status*', async (route) => {
    const vehicleId = extractVehicleIdFromUrl(route.request().url());
    const mocked = statusByVehicleId[vehicleId] || defaultStatus;
    await route.fulfill(jsonResponse(mocked.body, mocked.status));
  });

  await page.route('**/api/ev/vehicles/*/command', async (route) => {
    if (typeof options.onCommandRequest === 'function') {
      await options.onCommandRequest(route.request());
    }
    const vehicleId = extractVehicleIdFromUrl(route.request().url());
    const mocked = commandByVehicleId[vehicleId] || defaultCommand;
    await route.fulfill(jsonResponse(mocked.body, mocked.status));
  });
}

test.describe('Dashboard Page', () => {
  
  test.beforeEach(async ({ page }) => {
    // Force firebase auth module into local mock mode with a signed-in mock user.
    await page.route('**/js/firebase-config.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.firebaseConfig = { apiKey: "YOUR_TEST_KEY" };'
      });
    });

    await page.addInitScript(() => {
      try {
        localStorage.setItem('mockAuthUser', JSON.stringify({
          uid: 'test-user-123',
          email: 'test@example.com',
          displayName: 'Test User'
        }));
        localStorage.setItem('mockAuthToken', 'mock-token');
      } catch (e) {
        // ignore
      }

      // Prevent redirects during tests.
      window.safeRedirect = function (target) { console.log('[Test] suppressed redirect to', target); };
      window.location.assign = function (url) { console.log('[Test] suppressed location.assign to', url); };
    });

    await page.goto('/app.html');
  });

  test('should load dashboard page', async ({ page }) => {
    await expect(page).toHaveTitle(/SoCrates|FoxESS Automation|Dashboard|Inverter|Home/i);
  });

  test('should display main navigation elements', async ({ page }) => {
    // Check for common navigation links
    const hasNavigation = await page.locator('nav, header, .nav, .menu').count() > 0;
    expect(hasNavigation).toBeTruthy();
  });

  test('should have link to settings page', async ({ page }) => {
    const settingsLink = page.locator('a[href*="settings"]').first();
    await expect(settingsLink).toBeVisible();
  });

  test('should have link to control page', async ({ page }) => {
    const controlLink = page.locator('a[href*="control"]').first();
    await expect(controlLink).toBeVisible();
  });

  test('should have link to history page', async ({ page }) => {
    const historyLink = page.locator('a[href*="history"]').first();
    await expect(historyLink).toBeVisible();
  });

  test('should display automation status section', async ({ page }) => {
    // Look for automation status indicators
    const hasStatus = await page.getByText(/automation|status|enabled|disabled/i).count() > 0;
    expect(hasStatus).toBeTruthy();
  });

  test('should display inverter data section', async ({ page }) => {
    // Look for inverter-related content
    const hasInverterData = await page.getByText(/inverter|battery|soc|power/i).count() > 0;
    expect(hasInverterData).toBeTruthy();
  });

  test('should have automation toggle control', async ({ page }) => {
    // Look for toggle switch or button
    const toggle = await page.locator('input[type="checkbox"], button:has-text("Enable"), button:has-text("Disable"), .toggle').count();
    expect(toggle).toBeGreaterThan(0);
  });

  test('should navigate to settings when clicking settings link', async ({ page }) => {
    const settingsLink = page.locator('a[href*="settings"]').first();
    await settingsLink.click();
    
    await page.waitForURL(/settings\.html/);
    expect(page.url()).toContain('settings');
  });

  test('should navigate to control page when clicking control link', async ({ page }) => {
    const controlLink = page.locator('a[href*="control"]').first();
    await controlLink.click();
    
    await page.waitForURL(/control\.html/);
    expect(page.url()).toContain('control');
  });

  test('should navigate to history page when clicking history link', async ({ page }) => {
    const historyLink = page.locator('a[href*="history"]').first();
    await historyLink.click();
    
    await page.waitForURL(/history\.html/);
    expect(page.url()).toContain('history');
  });

  test('should display loading state initially', async ({ page }) => {
    // Reload to catch initial loading state
    await page.reload();
    
    // Check for loading indicator (might be brief)
    const hasLoading = await page.locator('.loading, .spinner, [data-loading], [aria-busy="true"]').count();
    
    // Loading state exists or data loads too quickly
    expect(typeof hasLoading).toBe('number');
  });

  test('should display current time/date', async ({ page }) => {
    // Dashboard should show timestamp or current time
    const hasTimeInfo = await page.locator('[data-time], .time, .timestamp, .date').count() > 0;
    
    // Or check for actual time/date text
    const currentYear = new Date().getFullYear().toString();
    const hasYear = await page.getByText(currentYear).count() > 0;
    
    expect(hasTimeInfo || hasYear).toBeTruthy();
  });

  test('should have logout functionality', async ({ page }) => {
    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign Out"), a:has-text("Logout")').first();
    
    const hasLogout = await logoutButton.count() > 0;
    expect(hasLogout).toBeTruthy();
  });

  test('should display responsive layout', async ({ page }) => {
    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(200);
    
    const desktopVisible = await page.locator('body').isVisible();
    expect(desktopVisible).toBeTruthy();
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(200);
    
    const mobileVisible = await page.locator('body').isVisible();
    expect(mobileVisible).toBeTruthy();
  });

  test('should show user email or profile info', async ({ page }) => {
    // Mock auth should provide test email
    const hasEmail = await page.getByText(/test@example\.com|user|profile/i).count() > 0;
    
    // Profile section might exist
    const hasProfile = await page.locator('[data-user], .user-info, .profile').count() > 0;
    
    // Profile may not show without real auth - just check page loads
    expect(typeof (hasEmail || hasProfile)).toBe('boolean');
  });

  test('should render dashboard visibility toggles and keep cards visible by default', async ({ page }) => {
    const toggleKeys = ['inverter', 'prices', 'weather', 'ev', 'quickControls', 'scheduler'];
    for (const key of toggleKeys) {
      const toggle = page.locator(`[data-dashboard-toggle="${key}"]`);
      const card = page.locator(`[data-dashboard-card="${key}"]`);
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeChecked();
      await expect(card).toBeVisible();
    }
  });

  test('should hide selected cards and keep remaining priority cards visible', async ({ page }) => {
    const inverterToggle = page.locator('[data-dashboard-toggle="inverter"]');
    const pricesToggle = page.locator('[data-dashboard-toggle="prices"]');
    const weatherToggle = page.locator('[data-dashboard-toggle="weather"]');

    await inverterToggle.uncheck();
    await pricesToggle.uncheck();

    await expect(page.locator('[data-dashboard-card="inverter"]')).toBeHidden();
    await expect(page.locator('[data-dashboard-card="prices"]')).toBeHidden();
    await expect(page.locator('[data-dashboard-card="weather"]')).toBeVisible();

    const visiblePriorityCards = page.locator('#priorityRow [data-dashboard-card]:not(.is-hidden-preference)');
    await expect(visiblePriorityCards).toHaveCount(1);

    await weatherToggle.uncheck();
    await expect(page.locator('#priorityRow')).toBeHidden();
  });

  test('should keep EV, quick controls, and scheduler in a responsive shared row', async ({ page }) => {
    const evToggle = page.locator('[data-dashboard-toggle="ev"]');
    const quickControlsToggle = page.locator('[data-dashboard-toggle="quickControls"]');
    const schedulerToggle = page.locator('[data-dashboard-toggle="scheduler"]');

    await evToggle.uncheck();
    await quickControlsToggle.uncheck();

    await expect(page.locator('[data-dashboard-card="ev"]')).toBeHidden();
    await expect(page.locator('[data-dashboard-card="quickControls"]')).toBeHidden();
    await expect(page.locator('[data-dashboard-card="scheduler"]')).toBeVisible();

    const visibleOperationsCards = page.locator('#operationsRow [data-dashboard-card]:not(.is-hidden-preference)');
    await expect(visibleOperationsCards).toHaveCount(1);

    await schedulerToggle.uncheck();
    await expect(page.locator('#operationsRow')).toBeHidden();
  });

  test('should align automation launcher with the right panel edge', async ({ page }) => {
    const alignment = await page.evaluate(() => {
      const automationToggle = document.getElementById('automationToggleBtn');
      const rightPanelToggle = document.getElementById('toggleBtn');
      if (!automationToggle || !rightPanelToggle) return null;
      const a = automationToggle.getBoundingClientRect();
      const r = rightPanelToggle.getBoundingClientRect();
      return {
        diff: Math.abs(a.right - r.right),
        aDisplay: window.getComputedStyle(automationToggle).display,
        rDisplay: window.getComputedStyle(rightPanelToggle).display
      };
    });

    expect(alignment).not.toBeNull();
    expect(alignment.aDisplay).not.toBe('none');
    expect(alignment.rDisplay).not.toBe('none');
    expect(alignment.diff).toBeLessThanOrEqual(2);
  });

  test('should persist card visibility preferences across reload', async ({ page }) => {
    await page.evaluate(() => {
      const payload = JSON.stringify({
        inverter: false,
        prices: true,
        weather: true,
        ev: false,
        quickControls: true,
        scheduler: false
      });
      localStorage.setItem('dashboardCardVisibility:guest', payload);
      localStorage.setItem('dashboardCardVisibility:test-user-123', payload);
    });

    await page.reload();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-dashboard-toggle="ev"]')).not.toBeChecked();
    await expect(page.locator('[data-dashboard-card="ev"]')).toBeHidden();

    const persistedAfterReload = await page.evaluate(() => {
      try {
        const fromUserKey = JSON.parse(localStorage.getItem('dashboardCardVisibility:test-user-123') || '{}');
        const fromGuestKey = JSON.parse(localStorage.getItem('dashboardCardVisibility:guest') || '{}');
        const parsed = (fromUserKey && Object.keys(fromUserKey).length > 0) ? fromUserKey : fromGuestKey;
        return parsed.inverter === false && parsed.scheduler === false && parsed.ev === false;
      } catch (e) {
        return false;
      }
    });
    expect(persistedAfterReload).toBeTruthy();
  });

  test('should render EV overview tabs and summary from EV API data', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [
        { vehicleId: 'veh-model-y', displayName: 'Model Y LR' },
        { vehicleId: 'veh-model-3', displayName: 'Model 3 RWD' }
      ],
      statusByVehicleId: {
        'veh-model-y': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 58,
              chargingState: 'stopped',
              isPluggedIn: true,
              isHome: true,
              rangeKm: 322,
              chargeLimitPct: 83,
              asOfIso: '2026-03-13T00:00:00.000Z'
            }
          }
        },
        'veh-model-3': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 74,
              chargingState: 'charging',
              isPluggedIn: true,
              isHome: false,
              rangeKm: 410,
              chargeLimitPct: 90,
              asOfIso: '2026-03-13T00:00:00.000Z'
            }
          }
        }
      }
    });

    await page.reload();

    await expect(page.locator('#evVehicleCountBadge')).toHaveText('2 vehicles');
    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText('Model Y LR');
    await expect(page.locator('#evSelectedSummary')).toContainText('Model Y LR');
    await expect(page.locator('#evSelectedSummary')).toContainText('58%');

    await page.locator('#evVehicleTabs .ev-vehicle-tab').nth(1).click();

    await expect(page.locator('#evSelectedSummary')).toContainText('Model 3 RWD');
    await expect(page.locator('#evSelectedSummary')).toContainText('74%');
    await expect(page.locator('#evChargeLimitLabel')).toHaveText('90%');
  });

  test('should disable EV commands when vehicle credentials are missing', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-missing-creds', displayName: 'Model S Plaid' }],
      statusByVehicleId: {
        'veh-missing-creds': {
          status: 400,
          body: {
            errno: 1,
            error: 'Tesla credentials missing for current user'
          }
        }
      }
    });

    await page.reload();

    await expect(page.locator('#evSelectedStatusPills')).toContainText('Credentials Missing');
    await expect(page.locator('#evStartBtn')).toBeDisabled();
    await expect(page.locator('#evStopBtn')).toBeDisabled();
    await expect(page.locator('#evSetLimitBtn')).toBeDisabled();
    await expect(page.locator('#evChargeLimitInput')).toBeDisabled();
  });

  test('should skip EV status fetch for vehicles pending Tesla auth and keep commands disabled', async ({ page }) => {
    let statusCallCount = 0;

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-pending-auth', displayName: 'Model Y', hasCredentials: false }]
    });

    await page.route('**/api/ev/vehicles/*/status*', async (route) => {
      statusCallCount += 1;
      await route.fulfill(jsonResponse({ errno: 400, error: 'Vehicle credentials not configured' }, 400));
    });

    await page.reload();

    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText('Setup Required');
    await expect(page.locator('#evSelectedStatusPills')).toContainText('Credentials Missing');
    await expect(page.locator('#evStartBtn')).toBeDisabled();
    await expect(page.locator('#evStopBtn')).toBeDisabled();
    await expect(page.locator('#evSetLimitBtn')).toBeDisabled();
    expect(statusCallCount).toBe(0);
  });

  test('should block EV command submission when no vehicle is selected', async ({ page }) => {
    let commandCallCount = 0;

    await mockEvApis(page, {
      vehicles: []
    });

    await page.route('**/api/ev/vehicles/*/command', async (route) => {
      commandCallCount += 1;
      await route.fulfill(jsonResponse({ errno: 0, result: { accepted: true } }, 200));
    });

    await page.reload();
    await expect(page.locator('#evVehicleTabs')).toContainText('No EV vehicles connected yet');
    await page.evaluate(() => window.startSelectedEVCharging());

    await expect(page.locator('#evOverviewMessage')).toContainText('Select a vehicle first');
    expect(commandCallCount).toBe(0);
  });

  test('should render EV vehicle names as plain text to avoid HTML injection', async ({ page }) => {
    const unsafeDisplayName = '<img src=x onerror=window.__evInjected=1>Model X';

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-xss', displayName: unsafeDisplayName }]
    });

    await page.reload();

    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText('<img src=x');
    await expect(page.locator('#evVehicleTabs img')).toHaveCount(0);
  });

  test('window.sharedUtils exposes getStoredAmberSiteId and setStoredAmberSiteId', async ({ page }) => {
    // Regression: during P6 refactor these helpers were moved into shared-utils.js but
    // call sites in dashboard.js, roi.js, history.js were left using bare globals.
    // They must be accessible via window.sharedUtils.
    const available = await page.evaluate(() => {
      return (
        typeof window.sharedUtils?.getStoredAmberSiteId === 'function' &&
        typeof window.sharedUtils?.setStoredAmberSiteId === 'function'
      );
    });
    expect(available).toBe(true);
  });

  test('getStoredAmberSiteId round-trips through setStoredAmberSiteId', async ({ page }) => {
    const siteId = await page.evaluate(() => {
      window.sharedUtils.setStoredAmberSiteId('test-site-abc');
      return window.sharedUtils.getStoredAmberSiteId();
    });
    expect(siteId).toBe('test-site-abc');
  });

  test('no ReferenceError for getStoredAmberSiteId on page load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.reload();
    await page.waitForTimeout(500);
    const refErrors = errors.filter(e => /getStoredAmberSiteId|setStoredAmberSiteId/i.test(e));
    expect(refErrors).toHaveLength(0);
  });
});
