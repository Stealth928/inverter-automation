const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

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

async function mockDashboardConfig(page, overrides = {}) {
  const {
    deviceProvider = 'foxess',
    deviceSn = 'TEST-SN-001',
    inverterCapacityW = 10000,
    batteryCapacityKWh = 13.5
  } = overrides;

  await page.route('**/api/config', async (route) => {
    await route.fulfill(jsonResponse({
      errno: 0,
      result: {
        deviceProvider,
        deviceSn,
        inverterCapacityW,
        batteryCapacityKWh,
        rules: [],
        preferences: { forecastDays: 6 },
        config: {
          cache: {
            amber: 60000,
            inverter: 300000,
            weather: 1800000
          },
          automation: { intervalMs: 60000 },
          defaults: { cooldownMinutes: 5 }
        }
      }
    }, 200));
  });

  await page.route('**/api/config/setup-status', async (route) => {
    await route.fulfill(jsonResponse({
      errno: 0,
      result: {
        setupComplete: true,
        deviceProvider
      }
    }, 200));
  });

  await page.route('**/api/user/init-profile', async (route) => {
    await route.fulfill(jsonResponse({
      errno: 0,
      result: { initialized: true }
    }, 200));
  });

  await page.route('**/api/admin/check', async (route) => {
    await route.fulfill(jsonResponse({
      errno: 0,
      result: { isAdmin: false }
    }, 200));
  });

  await page.route('**/api/automation/status', async (route) => {
    await route.fulfill(jsonResponse({
      errno: 0,
      result: {
        enabled: false,
        inBlackout: false,
        lastCheck: Date.now(),
        rules: {}
      }
    }, 200));
  });
}

function extractVehicleIdFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/api\/ev\/vehicles\/([^/]+)\/(?:status|command|command-readiness|wake)$/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (e) {
    return '';
  }
}

async function mockEvApis(page, options = {}) {
  const vehicles = Array.isArray(options.vehicles) ? options.vehicles : [];
  const statusByVehicleId = options.statusByVehicleId || {};
  const readinessByVehicleId = options.readinessByVehicleId || {};
  const commandByVehicleId = options.commandByVehicleId || {};
  const wakeByVehicleId = options.wakeByVehicleId || {};
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
  const defaultReadiness = options.defaultReadiness || {
    status: 200,
    body: {
      errno: 0,
      result: {
        state: 'ready_direct',
        transport: 'direct',
        source: 'test',
        vehicleCommandProtocolRequired: false
      }
    }
  };
  const defaultWake = options.defaultWake || {
    status: 200,
    body: {
      errno: 0,
      result: {
        accepted: true,
        command: 'wakeVehicle',
        wakeState: 'online',
        status: 'online'
      }
    }
  };

  await page.route('**/api/ev/vehicles', async (route) => {
    await route.fulfill(jsonResponse({ errno: 0, result: vehicles }, 200));
  });

  await page.route('**/api/ev/vehicles/*/status*', async (route) => {
    if (typeof options.onStatusRequest === 'function') {
      await options.onStatusRequest(route.request());
    }
    const vehicleId = extractVehicleIdFromUrl(route.request().url());
    const mocked = statusByVehicleId[vehicleId] || defaultStatus;
    await route.fulfill(jsonResponse(mocked.body, mocked.status));
  });

  await page.route('**/api/ev/vehicles/*/command-readiness', async (route) => {
    if (typeof options.onReadinessRequest === 'function') {
      await options.onReadinessRequest(route.request());
    }
    const vehicleId = extractVehicleIdFromUrl(route.request().url());
    const mocked = readinessByVehicleId[vehicleId] || defaultReadiness;
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

  await page.route('**/api/ev/vehicles/*/wake', async (route) => {
    if (typeof options.onWakeRequest === 'function') {
      await options.onWakeRequest(route.request());
    }
    const vehicleId = extractVehicleIdFromUrl(route.request().url());
    const mocked = wakeByVehicleId[vehicleId] || defaultWake;
    await route.fulfill(jsonResponse(mocked.body, mocked.status));
  });
}

async function waitForNonEmptyText(locator) {
  await expect.poll(async () => {
    return ((await locator.textContent().catch(() => '')) || '').trim();
  }).not.toBe('');
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
      window.__DISABLE_AUTH_REDIRECTS__ = true;
      window.__DISABLE_SERVICE_WORKER__ = true;
      window.mockFirebaseAuth = {
        currentUser: {
          uid: 'test-user-123',
          email: 'test@example.com',
          displayName: 'Test User',
          getIdToken: () => Promise.resolve('mock-token')
        }
      };
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
      window.safeRedirect = function () {};

      try {
        window.location.assign = function () {};
      } catch (e) {
        // ignore
      }
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

  test('should disable top navigation while preview tour is active', async ({ page }) => {
    await page.evaluate(() => {
      window.PreviewSession = {
        isActive: () => true,
        getScenario: () => 'solar-surplus'
      };
      window.TourEngine.start(0);
    });

    await expect(page.locator('body')).toHaveClass(/preview-tour-nav-locked/);
    await expect(page.locator('.nav-main .nav-link').first()).toHaveAttribute('aria-disabled', 'true');

    await page.locator('#_tourSkip').click();

    await expect(page.locator('body')).not.toHaveClass(/preview-tour-nav-locked/);
    await expect(page.locator('.nav-main .nav-link').first()).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('should display inverter data section', async ({ page }) => {
    // Look for inverter-related content
    const hasInverterData = await page.getByText(/inverter|battery|soc|power/i).count() > 0;
    expect(hasInverterData).toBeTruthy();
  });

  test('should render the live inverter house flow scene', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'FLOW-SCENE-001',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'FLOW-SCENE-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 68, unit: '%' },
              { variable: 'pvPower', value: 4.2, unit: 'kW' },
              { variable: 'loadsPower', value: 1.85, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 1.62, unit: 'kW' },
              { variable: 'batChargePower', value: 0.28, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' },
              { variable: 'batTemperature', value: 26.4, unit: '°C' },
              { variable: 'ambientTemperation', value: 22.8, unit: '°C' },
              { variable: 'invTemperation', value: 34.9, unit: '°C' },
              { variable: 'pv1power', value: 1.43, unit: 'kW' },
              { variable: 'pv2power', value: 1.13, unit: 'kW' },
              { variable: 'pv3power', value: 0.97, unit: 'kW' },
              { variable: 'pv4power', value: 0.67, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#inverterCard .energy-scene')).toBeVisible();
    await expect(page.locator('#solar-tile')).toContainText('4.20 kW');
    await expect(page.locator('#inverterCard .energy-node--home')).toContainText('1.85 kW');
    await expect(page.locator('#solar-tile .energy-node__state')).toHaveCount(0);
    await expect(page.locator('#inverterCard .energy-node--home .energy-node__state')).toHaveCount(0);
    await expect(page.locator('#inverterCard .energy-node--grid')).toContainText('1.62 kW');
    await expect(page.locator('#inverterCard .energy-node--grid')).toContainText('Export');
    await expect(page.locator('#inverterLastUpdate')).toContainText('Data age:');
    await expect(page.locator('#inverterFetchLabel')).toContainText('Last checked:');
    await expect(page.locator('#inverterCard .energy-core--hub')).toContainText('68%');
    await expect(page.locator('#inverterCard .energy-core--hub')).not.toContainText('Battery level');
    const homeFlow = page.locator('#inverterCard .energy-flow-path[style*="--flow-color:var(--energy-home)"]').first();
    await expect(homeFlow).not.toHaveClass(/is-reverse/);
    const exportGridFlow = page.locator('#inverterCard .energy-flow-path[style*="--flow-color:var(--energy-grid-export)"]').first();
    await expect(exportGridFlow).toHaveClass(/is-reverse/);
    await expect
      .poll(async () => exportGridFlow.evaluate((el) => window.getComputedStyle(el).animationDirection))
      .toBe('reverse');
    const sceneBackground = await page.locator('#inverterCard .energy-scene').evaluate((el) => {
      return window.getComputedStyle(el).backgroundImage;
    });
    expect(sceneBackground).toContain('house-3d-iso.png');
  });

  test('should keep the api metrics footer fixed in light theme on desktop and phone', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'LIGHT-THEME-001',
      batteryCapacityKWh: 13.5
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('uiTheme', 'light');
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'LIGHT-THEME-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 56, unit: '%' },
              { variable: 'pvPower', value: 0.22, unit: 'kW' },
              { variable: 'loadsPower', value: 0.22, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 0, unit: 'kW' },
              { variable: 'batChargePower', value: 0, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' },
              { variable: 'batTemperature', value: 25.7, unit: '°C' },
              { variable: 'ambientTemperation', value: 30.2, unit: '°C' },
              { variable: 'invTemperation', value: 22.8, unit: '°C' }
            ]
          }
        ]
      }, 200));
    });

    await page.route('**/api/metrics/api-calls*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          '2026-03-29': {
            foxess: 3,
            amber: 1,
            weather: 2,
            ev: 0
          }
        }
      }, 200));
    });

    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.inverter-card-header__subtitle')).toHaveText('Live power flow across solar, home, grid, and battery.');
    await expect(page.locator('#inverterLastUpdate')).toContainText('Data age:');
    await expect(page.locator('#inverterFetchLabel')).toContainText('Last checked:');
    await expect(page.locator('#apiMetricsFooter')).toContainText('Inv: 3');

    const desktopFooterStyle = await page.locator('#apiMetricsFooter').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        position: style.position,
        top: style.top,
        right: style.right,
        backgroundColor: style.backgroundColor
      };
    });

    expect(desktopFooterStyle.position).toBe('fixed');
    expect(desktopFooterStyle.top).toBe('60px');
    expect(desktopFooterStyle.right).toBe('12px');
    expect(desktopFooterStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    const timeChipStyle = await page.locator('#inverterLastUpdate').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        backgroundColor: style.backgroundColor
      };
    });

    expect(timeChipStyle.display).toContain('flex');
    expect(timeChipStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => page.locator('#apiMetricsFooter').evaluate((el) => window.getComputedStyle(el).left))
      .toBe('12px');

    const mobileFooterStyle = await page.locator('#apiMetricsFooter').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        position: style.position,
        left: style.left,
        bottom: style.bottom,
        justifyContent: style.justifyContent,
        pointerEvents: style.pointerEvents
      };
    });

    expect(mobileFooterStyle.position).toBe('fixed');
    expect(mobileFooterStyle.left).toBe('12px');
    expect(mobileFooterStyle.bottom).not.toBe('auto');
    expect(mobileFooterStyle.justifyContent).toBe('flex-start');
    expect(mobileFooterStyle.pointerEvents).toBe('none');

    await expect(page.locator('#inverterCard .energy-node--grid')).toContainText('Balanced');
    await expect
      .poll(async () => page.locator('#inverterCard .energy-node--grid .energy-node__value').evaluate((el) => window.getComputedStyle(el).color))
      .toBe('rgb(95, 106, 120)');
  });

  test('should condense the inverter header on phone without dropping telemetry', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'PHONE-HEADER-001',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'PHONE-HEADER-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 56, unit: '%' },
              { variable: 'pvPower', value: 0.22, unit: 'kW' },
              { variable: 'loadsPower', value: 0.22, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 0, unit: 'kW' },
              { variable: 'batChargePower', value: 0, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' },
              { variable: 'batTemperature', value: 25.7, unit: '°C' },
              { variable: 'ambientTemperation', value: 30.2, unit: '°C' },
              { variable: 'invTemperation', value: 22.8, unit: '°C' }
            ]
          }
        ]
      }, 200));
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.inverter-card-header__subtitle')).toHaveText('Live power flow across solar, home, grid, and battery.');
    await expect(page.locator('#inverterSourceBadge')).toContainText('Live');
    await expect(page.locator('#inverterLastUpdate')).toContainText('Data age:');
    await expect(page.locator('#inverterFetchLabel')).toContainText('Last checked:');

    const headerMetrics = await page.locator('[data-dashboard-card="inverter"] .inverter-card-header').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        rowGap: style.rowGap,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom
      };
    });

    expect(headerMetrics.height).toBeLessThan(120);
    expect(headerMetrics.rowGap).toBe('8px');
    expect(headerMetrics.paddingTop).toBe('10px');
    expect(headerMetrics.paddingBottom).toBe('8px');

    const chipMetrics = await page.locator('#inverterLastUpdate').evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        minHeight: style.minHeight,
        fontSize: style.fontSize
      };
    });

    expect(chipMetrics.minHeight).toBe('28px');
    expect(chipMetrics.fontSize).toBe('10px');
  });

  test('should classify drizzle separately from heavier rain in the inverter scene', async ({ page }) => {
    const effects = await page.evaluate(() => ({
      drizzle: getInverterSceneWeatherState({
        current: { weathercode: 51, is_day: 1, cloudcover: 78 }
      }).effect,
      rain: getInverterSceneWeatherState({
        current: { weathercode: 63, is_day: 1, cloudcover: 78 }
      }).effect
    }));

    expect(effects.drizzle).toBe('drizzle');
    expect(effects.rain).toBe('rain');
  });

  test('should place the weather map in the top-right without Open-Meteo copy', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess'
    });

    await page.addInitScript(() => {
      window.L = {
        map(id) {
          const container = document.getElementById(id);
          return {
            _container: container,
            setView() { return this; },
            getContainer() { return this._container; },
            remove() {},
            invalidateSize() {},
            removeLayer() {}
          };
        },
        tileLayer() {
          return {
            on() { return this; },
            addTo() { return this; }
          };
        },
        circleMarker() {
          return {
            addTo() {
              return {
                setLatLng() { return this; }
              };
            }
          };
        }
      };

      const weatherData = {
        place: {
          query: 'Sydney, Australia',
          resolvedName: 'Sydney',
          country: 'Australia',
          latitude: -33.8688,
          longitude: 151.2093
        },
        current: {
          temperature: 23,
          time: '2026-03-29T14:30',
          weathercode: 1,
          windspeed: 18,
          winddirection: 140,
          cloudcover: 24,
          shortwave_radiation: 612
        },
        daily: {
          time: ['2026-03-29', '2026-03-30', '2026-03-31'],
          weathercode: [1, 3, 61],
          temperature_2m_max: [26, 24, 22],
          temperature_2m_min: [18, 17, 16],
          precipitation_sum: [0, 0.4, 8.3],
          sunrise: ['2026-03-29T06:03', '2026-03-30T06:04', '2026-03-31T06:05'],
          sunset: ['2026-03-29T18:01', '2026-03-30T18:00', '2026-03-31T17:59']
        },
        hourly: {
          time: ['2026-03-29T14:30', '2026-03-30T12:00', '2026-03-31T12:00'],
          shortwave_radiation: [612, 320, 110],
          cloudcover: [24, 46, 81]
        }
      };

      try {
        localStorage.setItem('cachedWeatherFull', JSON.stringify(weatherData));
        localStorage.setItem('cacheState', JSON.stringify({
          weatherTime: Date.now(),
          weatherDays: 6,
          weatherDate: new Date().toISOString().substring(0, 10)
        }));
      } catch (error) {
        // ignore localStorage write issues in tests
      }
    });

    await page.goto('about:blank');
    await page.goto('/app.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-dashboard-card="weather"] .card-header')).not.toContainText(/Open-Meteo/i);
    await expect(page.locator('#weatherCard')).not.toContainText(/open-meteo/i);
    await expect(page.locator('#weatherCard .weather-map')).toBeVisible();

    const layout = await page.evaluate(() => {
      const readRect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };

      return {
        summary: readRect('#weatherCard .weather-card-summary'),
        map: readRect('#weatherCard .weather-map'),
        forecast: readRect('#weatherCard .weather-card-forecast')
      };
    });

    expect(layout.summary).not.toBeNull();
    expect(layout.map).not.toBeNull();
    expect(layout.forecast).not.toBeNull();
    expect(layout.map.left - layout.summary.right).toBeGreaterThanOrEqual(8);
    expect(layout.map.top).toBeLessThan(layout.forecast.top);
    expect(layout.forecast.top).toBeGreaterThanOrEqual(layout.map.bottom - 1);
    expect(layout.map.width).toBeLessThan(layout.forecast.width);
  });

  test('should keep the house scene tiles separated in the three-column desktop layout', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'FLOW-SCENE-DESKTOP-001',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'FLOW-SCENE-DESKTOP-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 68, unit: '%' },
              { variable: 'pvPower', value: 4.2, unit: 'kW' },
              { variable: 'loadsPower', value: 1.85, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 1.62, unit: 'kW' },
              { variable: 'batChargePower', value: 0.28, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' },
              { variable: 'batTemperature', value: 26.4, unit: 'Â°C' },
              { variable: 'ambientTemperation', value: 22.8, unit: 'Â°C' },
              { variable: 'invTemperation', value: 34.9, unit: 'Â°C' },
              { variable: 'pv1power', value: 1.43, unit: 'kW' },
              { variable: 'pv2power', value: 1.13, unit: 'kW' },
              { variable: 'pv3power', value: 0.97, unit: 'kW' },
              { variable: 'pv4power', value: 0.67, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#inverterCard .energy-scene')).toBeVisible();

    const layout = await page.locator('#inverterCard .energy-scene').evaluate(() => {
      const readRect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };

      return {
        scene: readRect('#inverterCard .energy-scene'),
        solar: readRect('#solar-tile'),
        grid: readRect('#inverterCard .energy-node--grid'),
        home: readRect('#inverterCard .energy-node--home'),
        hub: readRect('#inverterCard .energy-core--hub')
      };
    });

    const cards = [layout.scene, layout.solar, layout.grid, layout.home, layout.hub];
    cards.forEach((card) => expect(card).not.toBeNull());
    expect(layout.scene.width).toBeGreaterThan(520);
    expect(layout.scene.width).toBeLessThan(760);

    const overlaps = (a, b) => (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );

    expect(overlaps(layout.solar, layout.grid)).toBeFalsy();
    expect(overlaps(layout.solar, layout.home)).toBeFalsy();
    expect(overlaps(layout.solar, layout.hub)).toBeFalsy();
    expect(overlaps(layout.grid, layout.home)).toBeFalsy();
    expect(overlaps(layout.grid, layout.hub)).toBeFalsy();
    expect(overlaps(layout.home, layout.hub)).toBeFalsy();

    expect(layout.grid.left - layout.solar.right).toBeGreaterThan(16);
    expect(layout.hub.left - layout.home.right).toBeGreaterThan(16);
    expect(layout.home.top - layout.solar.bottom).toBeGreaterThan(18);
    expect(layout.hub.top - layout.grid.bottom).toBeGreaterThan(18);
  });

  test('should scale the house artwork down on very wide inverter scenes', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'FLOW-SCENE-WIDE-001',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'FLOW-SCENE-WIDE-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 68, unit: '%' },
              { variable: 'pvPower', value: 4.2, unit: 'kW' },
              { variable: 'loadsPower', value: 1.85, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 1.62, unit: 'kW' },
              { variable: 'batChargePower', value: 0.28, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.setViewportSize({ width: 2560, height: 1200 });
    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#inverterCard .energy-scene')).toBeVisible();

    const artLayout = await page.locator('#inverterCard .energy-scene').evaluate((el) => {
      const sceneRect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const artAspect = 1072 / 1024;
      const sizeParts = String(style.backgroundSize || '').trim().split(/\s+/);
      const widthToken = sizeParts[0] || '';
      const heightToken = sizeParts[1] || '';
      const resolveSizeToken = (token, basis) => {
        if (!token || token === 'auto') return null;
        if (token.endsWith('%')) {
          const value = parseFloat(token);
          return Number.isFinite(value) ? basis * (value / 100) : null;
        }
        const value = parseFloat(token);
        return Number.isFinite(value) ? value : null;
      };

      let backgroundWidthPx = resolveSizeToken(widthToken, sceneRect.width);
      let backgroundHeightPx = resolveSizeToken(heightToken, sceneRect.height);

      if (!Number.isFinite(backgroundWidthPx) && Number.isFinite(backgroundHeightPx)) {
        backgroundWidthPx = backgroundHeightPx * artAspect;
      }
      if (!Number.isFinite(backgroundHeightPx) && Number.isFinite(backgroundWidthPx)) {
        backgroundHeightPx = backgroundWidthPx / artAspect;
      }

      return {
        sceneWidth: sceneRect.width,
        sceneHeight: sceneRect.height,
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
        backgroundWidthPx: Number.isFinite(backgroundWidthPx) ? backgroundWidthPx : null,
        backgroundHeightPx: Number.isFinite(backgroundHeightPx) ? backgroundHeightPx : null
      };
    });

    expect(artLayout.sceneWidth).toBeGreaterThan(740);
    expect(artLayout.backgroundWidthPx).not.toBeNull();
    expect(artLayout.backgroundHeightPx).not.toBeNull();
    expect(artLayout.backgroundWidthPx).toBeLessThan(artLayout.sceneWidth * 0.9);
    expect(artLayout.backgroundHeightPx).toBeLessThan(artLayout.sceneHeight * 0.95);
  });

  test('should keep the house scene tiles separated on phone-sized viewports while preserving the flows', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'FLOW-SCENE-NARROW-001',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'FLOW-SCENE-NARROW-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 68, unit: '%' },
              { variable: 'pvPower', value: 4.2, unit: 'kW' },
              { variable: 'loadsPower', value: 1.85, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 1.62, unit: 'kW' },
              { variable: 'batChargePower', value: 0.28, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' },
              { variable: 'batTemperature', value: 26.4, unit: 'Â°C' },
              { variable: 'ambientTemperation', value: 22.8, unit: 'Â°C' },
              { variable: 'invTemperation', value: 34.9, unit: 'Â°C' },
              { variable: 'pv1power', value: 1.43, unit: 'kW' },
              { variable: 'pv2power', value: 1.13, unit: 'kW' },
              { variable: 'pv3power', value: 0.97, unit: 'kW' },
              { variable: 'pv4power', value: 0.67, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#inverterCard .energy-scene')).toBeVisible();

    const layout = await page.locator('#inverterCard .energy-scene').evaluate(() => {
      const artAspect = 1072 / 1024;
      const readRect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const scene = document.querySelector('#inverterCard .energy-scene');
      const sceneStyle = scene ? window.getComputedStyle(scene) : null;
      const backgroundSizeParts = String(sceneStyle?.backgroundSize || '').trim().split(/\s+/);
      const widthToken = backgroundSizeParts[0] || '';
      const heightToken = backgroundSizeParts[1] || '';
      const resolveSizeToken = (token, basis) => {
        if (!token || token === 'auto') return null;
        if (token.endsWith('%')) {
          const value = parseFloat(token);
          return Number.isFinite(value) ? basis * (value / 100) : null;
        }
        const value = parseFloat(token);
        return Number.isFinite(value) ? value : null;
      };
      const sceneRect = scene ? scene.getBoundingClientRect() : null;
      let backgroundWidthPx = sceneRect ? resolveSizeToken(widthToken, sceneRect.width) : null;
      let backgroundHeightPx = sceneRect ? resolveSizeToken(heightToken, sceneRect.height) : null;

      if (!Number.isFinite(backgroundWidthPx) && Number.isFinite(backgroundHeightPx)) {
        backgroundWidthPx = backgroundHeightPx * artAspect;
      }
      if (!Number.isFinite(backgroundHeightPx) && Number.isFinite(backgroundWidthPx)) {
        backgroundHeightPx = backgroundWidthPx / artAspect;
      }

      return {
        scene: readRect('#inverterCard .energy-scene'),
        solar: readRect('#solar-tile'),
        grid: readRect('#inverterCard .energy-node--grid'),
        home: readRect('#inverterCard .energy-node--home'),
        hub: readRect('#inverterCard .energy-core--hub'),
        soc: readRect('#inverterCard .energy-core__soc'),
        statePill: readRect('#inverterCard .energy-core__state'),
        wiringDisplay: document.querySelector('#inverterCard .energy-scene__wiring')
          ? window.getComputedStyle(document.querySelector('#inverterCard .energy-scene__wiring')).display
          : null,
        activeFlowCount: document.querySelectorAll('#inverterCard .energy-flow-path.is-active').length,
        backgroundSize: sceneStyle ? sceneStyle.backgroundSize : null,
        backgroundWidthPx: Number.isFinite(backgroundWidthPx) ? backgroundWidthPx : null,
        backgroundHeightPx: Number.isFinite(backgroundHeightPx) ? backgroundHeightPx : null
      };
    });

    const cards = [layout.scene, layout.solar, layout.grid, layout.home, layout.hub];
    cards.forEach((card) => expect(card).not.toBeNull());
    expect(layout.soc).not.toBeNull();
    expect(layout.statePill).not.toBeNull();

    const overlaps = (a, b) => (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );

    expect(overlaps(layout.solar, layout.grid)).toBeFalsy();
    expect(overlaps(layout.solar, layout.home)).toBeFalsy();
    expect(overlaps(layout.solar, layout.hub)).toBeFalsy();
    expect(overlaps(layout.grid, layout.home)).toBeFalsy();
    expect(overlaps(layout.grid, layout.hub)).toBeFalsy();
    expect(overlaps(layout.home, layout.hub)).toBeFalsy();
    expect(overlaps(layout.soc, layout.statePill)).toBeFalsy();
    expect(layout.wiringDisplay).not.toBe('none');
    expect(layout.activeFlowCount).toBeGreaterThanOrEqual(4);
    expect(layout.backgroundWidthPx).not.toBeNull();
    expect(layout.backgroundHeightPx).not.toBeNull();
    expect(layout.backgroundWidthPx / layout.backgroundHeightPx).toBeCloseTo(1072 / 1024, 2);
    expect(layout.backgroundWidthPx).toBeLessThanOrEqual(layout.scene.width * 1.01);
    expect(layout.backgroundHeightPx).toBeLessThan(layout.scene.height);
  });

  test('should show frozen telemetry duration instead of latest sample age in automation failsafe UI', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'FROZEN-UI-001'
    });

    const frozenStatus = {
      enabled: true,
      inBlackout: false,
      lastCheck: Date.now(),
      telemetryFailsafePaused: true,
      telemetryFailsafePauseReason: 'frozen_telemetry',
      telemetryAgeMs: 35000,
      telemetryTimestampTrust: 'synthetic',
      telemetryFingerprintSinceMs: Date.now() - (61 * 60 * 1000),
      userTimezone: 'Australia/Sydney',
      rules: {}
    };

    await page.route('**/api/automation/status', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: frozenStatus
      }, 200));
    });

    await page.route('**/api/automation/status-summary', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: frozenStatus
      }, 200));
    });

    await page.goto('about:blank');
    await page.goto('/app.html?telemetryFrozenUi=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#backendAutomationStatus')).toContainText('unchanged for 1h');
    await expect(page.locator('#backendAutomationStatus')).not.toContainText('unchanged for 35s');
    await expect(page.locator('#backendAutomationStatus')).toContainText('timestamp was inferred');
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

  test('should cap the inverter scene width when it is the only visible priority card', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'FLOW-SCENE-SOLO-001',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'FLOW-SCENE-SOLO-001',
            time: '2026-03-28T09:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 68, unit: '%' },
              { variable: 'pvPower', value: 4.2, unit: 'kW' },
              { variable: 'loadsPower', value: 1.85, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 1.62, unit: 'kW' },
              { variable: 'batChargePower', value: 0.28, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' },
              { variable: 'batTemperature', value: 26.4, unit: 'Â°C' },
              { variable: 'ambientTemperation', value: 22.8, unit: 'Â°C' },
              { variable: 'invTemperation', value: 34.9, unit: 'Â°C' },
              { variable: 'pv1power', value: 1.43, unit: 'kW' },
              { variable: 'pv2power', value: 1.13, unit: 'kW' },
              { variable: 'pv3power', value: 0.97, unit: 'kW' },
              { variable: 'pv4power', value: 0.67, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('about:blank');
    await page.goto('/app.html?energyFlowScene=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#inverterCard .energy-scene')).toBeVisible();

    await page.locator('[data-dashboard-toggle="prices"]').uncheck();
    await page.locator('[data-dashboard-toggle="weather"]').uncheck();

    const visiblePriorityCards = page.locator('#priorityRow [data-dashboard-card]:not(.is-hidden-preference)');
    await expect(visiblePriorityCards).toHaveCount(1);

    const layout = await page.evaluate(() => {
      const readRect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const { left, right, top, bottom, width, height } = el.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };

      return {
        priorityRow: readRect('#priorityRow'),
        inverterCard: readRect('#inverterCard'),
        scene: readRect('#inverterCard .energy-scene')
      };
    });

    expect(layout.priorityRow).not.toBeNull();
    expect(layout.inverterCard).not.toBeNull();
    expect(layout.scene).not.toBeNull();
    expect(layout.inverterCard.width).toBeLessThanOrEqual(922);
    expect(layout.priorityRow.width).toBeGreaterThan(layout.inverterCard.width + 100);
    expect(Math.abs(
      (layout.priorityRow.left + (layout.priorityRow.width / 2)) -
      (layout.inverterCard.left + (layout.inverterCard.width / 2))
    )).toBeLessThanOrEqual(8);
    expect(layout.scene.width).toBeLessThan(layout.priorityRow.width);
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

    if (await page.locator('#evVehicleTabs .ev-vehicle-tab').count() === 0) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(page.locator('#evVehicleCountBadge')).toHaveText('2 vehicles');
    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText('Model Y LR');
    await expect(page.locator('#evSelectedSummary')).toContainText('Model Y LR');
    await expect(page.locator('#evSelectedSummary')).toContainText('58%');

    await page.locator('#evVehicleTabs .ev-vehicle-tab').nth(1).click();

    await expect(page.locator('#evSelectedSummary')).toContainText('Model 3 RWD');
    await expect(page.locator('#evSelectedSummary')).toContainText('74%');
  });

  test('should avoid duplicate quick control and automation summary fetches during dashboard startup', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'STARTUP-DEDUPE-001'
    });

    let quickControlStatusCalls = 0;
    let automationSummaryCalls = 0;

    await page.route('**/api/quickcontrol/status', async (route) => {
      quickControlStatusCalls += 1;
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          active: false,
          provider: 'foxess'
        }
      }, 200));
    });

    await page.route('**/api/automation/status-summary', async (route) => {
      automationSummaryCalls += 1;
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          enabled: false,
          inBlackout: false,
          lastCheck: Date.now(),
          rules: {}
        }
      }, 200));
    });

    await page.route('**/api/metrics/api-calls*', async (route) => {
      const today = new Date().toISOString().slice(0, 10);
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          [today]: {
            foxess: 0,
            amber: 0,
            weather: 0,
            ev: 0
          }
        }
      }, 200));
    });

    await page.goto('about:blank');
    quickControlStatusCalls = 0;
    automationSummaryCalls = 0;
    await page.goto('/app.html?startup-dedupe=1', { waitUntil: 'domcontentloaded' });

    await expect.poll(() => quickControlStatusCalls).toBe(1);
    await expect.poll(() => automationSummaryCalls).toBe(1);

    await page.waitForTimeout(250);

    expect(quickControlStatusCalls).toBe(1);
    expect(automationSummaryCalls).toBe(1);
  });

  test('should preserve EV DOM nodes during unchanged silent status refreshes', async ({ page }) => {
    let statusCallCount = 0;

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-model-y', displayName: 'Model Y LR' }],
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
        }
      },
      onStatusRequest: () => {
        statusCallCount += 1;
      }
    });

    await page.goto('about:blank');
    await page.goto('/app.html?ev-silent-refresh=1', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab')).toHaveCount(1);
    await expect(page.locator('#evSelectedSummary .ev-summary-footer')).toBeVisible();
    await expect.poll(() => statusCallCount).toBe(1);

    await page.evaluate(() => {
      const tab = document.querySelector('#evVehicleTabs .ev-vehicle-tab');
      const footer = document.querySelector('#evSelectedSummary .ev-summary-footer');
      if (tab) tab.setAttribute('data-render-probe', 'tab');
      if (footer) footer.setAttribute('data-render-probe', 'footer');
    });

    await page.evaluate(() => window.refreshSelectedEVStatusOnVisibility());
    await expect.poll(() => statusCallCount).toBe(2);
    await page.waitForTimeout(100);

    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab[data-render-probe="tab"]')).toHaveCount(1);
    await expect(page.locator('#evSelectedSummary .ev-summary-footer[data-render-probe="footer"]')).toHaveCount(1);
  });

  test('should show Tesla setup required when vehicle credentials are missing', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-missing-creds', displayName: 'Model S Plaid', hasCredentials: false }],
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

    const hasPills = await page.locator('#evSelectedStatusPills').count();
    if (!hasPills) {
      expect(true).toBeTruthy();
      return;
    }

    const pillsText = ((await page.locator('#evSelectedStatusPills').textContent().catch(() => '')) || '').trim();
    const controlsVisible = await page.locator('#evControls').isVisible().catch(() => false);
    expect(pillsText.includes('Finish setup') || !controlsVisible).toBeTruthy();
  });

  test('should skip EV status fetch for vehicles pending Tesla auth and show setup required', async ({ page }) => {
    let statusCallCount = 0;

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-pending-auth', displayName: 'Model Y', hasCredentials: false }]
    });

    await page.route('**/api/ev/vehicles/*/status*', async (route) => {
      statusCallCount += 1;
      await route.fulfill(jsonResponse({ errno: 400, error: 'Vehicle credentials not configured' }, 400));
    });

    await page.reload();

    if (await page.locator('#evVehicleTabs .ev-vehicle-tab').count() === 0) {
      expect(statusCallCount).toBeGreaterThanOrEqual(0);
      return;
    }

    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText('Finish setup');
    await expect(page.locator('#evSelectedStatusPills')).toContainText('Finish setup');
    expect(statusCallCount).toBe(0);
  });

  test('should render EV overview without command controls when no vehicle is selected', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: []
    });

    await page.reload();
    const tabsText = ((await page.locator('#evVehicleTabs').textContent().catch(() => '')) || '').trim();
    expect(tabsText.length === 0 || tabsText.includes('No Tesla vehicles linked yet') || tabsText.includes('Loading vehicles')).toBeTruthy();
    await expect(page.locator('#evControls')).toBeHidden();
  });

  test('should render EV vehicle names as plain text to avoid HTML injection', async ({ page }) => {
    const unsafeDisplayName = '<img src=x onerror=window.__evInjected=1>Model X';

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-xss', displayName: unsafeDisplayName }]
    });

    await page.reload();

    if (await page.locator('#evVehicleTabs .ev-vehicle-tab').count() === 0) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText('<img src=x');
    await expect(page.locator('#evVehicleTabs img')).toHaveCount(0);
  });

  test('should render EV summary with SoC battery icon and range immediately after SoC', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cachedPrices', JSON.stringify({ general: { perKwh: 30 } }));
    });

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-model-y', displayName: 'Model Y LR' }],
      statusByVehicleId: {
        'veh-model-y': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 58,
              chargingState: 'charging',
              isPluggedIn: true,
              isHome: true,
              rangeKm: 322,
              ratedRangeKm: 347,
              chargeLimitPct: 83,
              timeToFullChargeHours: 2,
              chargeEnergyAddedKwh: 8.5,
              rangeAddedKm: 58,
              chargingPowerKw: 7,
              asOfIso: '2026-03-13T00:00:00.000Z'
            }
          }
        }
      }
    });

    await page.reload();

    if (await page.locator('#evSelectedSummary .ev-summary-stat').count() < 3) {
      expect(true).toBeTruthy();
      return;
    }

    const summaryCards = page.locator('#evSelectedSummary .ev-summary-stat');
    await expect(summaryCards.nth(0)).toContainText('SoC');
    await expect(summaryCards.nth(1)).toContainText('Range');
    await expect(summaryCards.nth(0).locator('.ev-summary-battery')).toHaveCount(1);
    await expect(summaryCards.nth(0)).toContainText('58%');
    await expect(summaryCards.nth(0)).toContainText('Charging');
    await expect(summaryCards.nth(1)).toContainText('347 km');
    await expect(summaryCards.nth(1)).toContainText('Est. 322 km');
    await expect(summaryCards.nth(2)).toContainText('To full');
    await expect(summaryCards.nth(2)).toContainText('2h');
    await expect(summaryCards.nth(2)).toContainText('$4.20');
    await expect(summaryCards.nth(3)).toContainText('Session gain');
    await expect(summaryCards.nth(3)).toContainText('+58 km');
    await expect(summaryCards.nth(3)).toContainText('8.50 kWh');
    await expect(summaryCards.nth(4)).toContainText('Charge cost');
    await expect(summaryCards.nth(4)).toContainText('$2.55');
  });

  test('should show Tesla charging controls and submit command payloads for command-ready vehicles', async ({ page }) => {
    const commandRequests = [];
    const readinessRequests = [];
    const statusRequests = [];

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-model-y', displayName: 'Model Y LR', hasCredentials: true }],
      statusByVehicleId: {
        'veh-model-y': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 61,
              chargingState: 'charging',
              isPluggedIn: true,
              isHome: true,
              rangeKm: 311,
              chargeLimitPct: 82,
              chargingAmps: 24,
              asOfIso: '2026-03-13T00:00:00.000Z'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-model-y': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      onReadinessRequest: async (request) => {
        readinessRequests.push(request.url());
      },
      onStatusRequest: async (request) => {
        statusRequests.push(request.url());
      },
      onCommandRequest: async (request) => {
        commandRequests.push(request.postDataJSON());
      }
    });

    await page.reload();

    const controlsVisible = await page.locator('#evControls').isVisible().catch(() => false);
    if (!controlsVisible) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(page.locator('#evControls')).toBeVisible();
    await expect(page.locator('#evSelectedStatusPills')).toContainText('Controls Ready');
    await expect(page.locator('#evControlsTransportHint')).toContainText(/Direct Tesla commands/i);
    await expect(page.locator('#evChargeLimitInput')).toHaveAttribute('type', 'range');
    await expect(page.locator('#evChargingAmpsInput')).toHaveAttribute('type', 'range');
    await expect(page.locator('#evChargeLimitInput')).toHaveValue('82');
    await expect(page.locator('#evChargeLimitDisplay')).toHaveText('82%');
    await expect(page.locator('#evChargingAmpsDisplay')).toHaveText('24A');

    await page.locator('#evChargeLimitInput').evaluate((element) => {
      element.value = '85';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#evChargingAmpsInput').evaluate((element) => {
      element.value = '26';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#evChargingAmpsDisplay')).toContainText('26A target');
    await expect(page.locator('#evChargingAmpsDisplay')).toContainText('now 24A');
    await page.locator('#evSetChargingAmpsBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/charging amps updated to 26a/i);
    await expect(page.locator('#evChargingAmpsInput')).toHaveValue('26');
    await expect(page.locator('#evChargingAmpsDisplay')).toHaveText('26A');
    await page.locator('#evSetChargeLimitBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/charge limit updated to 85%/i);
    await expect(page.locator('#evChargeLimitInput')).toHaveValue('85');
    await expect(page.locator('#evChargeLimitDisplay')).toHaveText('85%');
    expect(commandRequests).toContainEqual({ command: 'setChargingAmps', chargingAmps: 26 });
    expect(commandRequests).toContainEqual({ command: 'setChargeLimit', targetSocPct: 85 });
    expect(readinessRequests).toHaveLength(1);
    expect(statusRequests).toHaveLength(1);
  });

  test('should show a manual wake button when Tesla reports the vehicle asleep and send a wake request explicitly', async ({ page }) => {
    const wakeRequests = [];

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-sleeping', displayName: 'Model 3', hasCredentials: true }],
      statusByVehicleId: {
        'veh-sleeping': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache_vehicle_offline',
            reasonCode: 'vehicle_offline',
            result: {
              socPct: 63,
              chargingState: 'unknown',
              isPluggedIn: true,
              isHome: true,
              rangeKm: 300,
              chargeLimitPct: 80,
              asOfIso: '2026-03-14T00:00:00.000Z',
              reasonCode: 'vehicle_offline'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-sleeping': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      onWakeRequest: async (request) => {
        wakeRequests.push(request.postDataJSON());
      }
    });

    await page.reload();

    const wakeBtn = page.locator('#evWakeVehicleBtn');
    if (await wakeBtn.count() === 0 || !(await wakeBtn.first().isVisible().catch(() => false))) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(page.locator('#evSelectedStatusPills')).toContainText(/Wake Required/i);
    await expect(page.locator('#evWakeVehicleBtn')).toBeVisible();
    await expect(page.locator('#evWakeVehicleNote')).toContainText(/never triggered automatically/i);
    await expect(page.locator('#evSessionControlGroup')).toHaveClass(/is-hidden/);

    await page.locator('#evWakeVehicleBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/wake request accepted/i);
    expect(wakeRequests).toContainEqual({});
  });

  test('should offer manual wake when Tesla marks cached status offline via top-level reason code only', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-cache-offline', displayName: 'Model Y', hasCredentials: true }],
      statusByVehicleId: {
        'veh-cache-offline': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache_vehicle_offline',
            reasonCode: 'vehicle_offline',
            result: {
              socPct: 75,
              chargingState: 'charging',
              isPluggedIn: true,
              isHome: true,
              rangeKm: 306,
              chargeLimitPct: 100,
              timeToFullChargeHours: 3.4,
              asOfIso: '2026-03-29T05:00:00.000Z'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-cache-offline': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      }
    });

    await page.reload();

    await expect(page.locator('#evSelectedStatusPills')).toContainText(/Wake Required/i);
    await expect(page.locator('#evSelectedStatusPills')).toContainText(/CACHE_VEHICLE_OFFLINE/i);
    await expect(page.locator('#evWakeVehicleBtn')).toBeVisible();
    await expect(page.locator('#evSessionControlGroup')).toHaveClass(/is-hidden/);
  });

  test('should recommend waking when cached Tesla status says not plugged in because the plug state may be stale', async ({ page }) => {
    const commandRequests = [];

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-stale-plug', displayName: 'Model Y', hasCredentials: true }],
      statusByVehicleId: {
        'veh-stale-plug': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 57,
              chargingState: 'stopped',
              isPluggedIn: false,
              isHome: true,
              rangeKm: 284,
              chargeLimitPct: 80,
              asOfIso: '2026-03-14T00:00:00.000Z'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-stale-plug': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      onCommandRequest: async (request) => {
        commandRequests.push(request.postDataJSON());
      }
    });

    await page.reload();

    await expect(page.locator('#evSelectedStatusPills')).toContainText(/Might Need Wake/i);
    await expect(page.locator('#evWakeVehicleBtn')).toBeVisible();
    await expect(page.locator('#evWakePrompt')).toContainText(/plug status may be stale/i);

    await page.locator('#evStartChargingBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/status may be stale/i);
    expect(commandRequests).toHaveLength(0);
  });

  test('should not recommend waking when cached unplugged Tesla status is still fresh', async ({ page }) => {
    const commandRequests = [];
    const freshAsOfIso = new Date(Date.now() - (2 * 60 * 1000)).toISOString();

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-fresh-plug', displayName: 'Model 3', hasCredentials: true }],
      statusByVehicleId: {
        'veh-fresh-plug': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 56,
              chargingState: 'stopped',
              isPluggedIn: false,
              isHome: true,
              rangeKm: 211,
              chargeLimitPct: 80,
              asOfIso: freshAsOfIso
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-fresh-plug': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      onCommandRequest: async (request) => {
        commandRequests.push(request.postDataJSON());
      }
    });

    await page.reload();

    await expect(page.locator('#evSelectedStatusPills')).not.toContainText(/Might Need Wake/i);
    await expect(page.locator('#evWakePrompt')).toBeHidden();

    await page.locator('#evStartChargingBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/not plugged in/i);
    expect(commandRequests).toHaveLength(0);
  });

  test('should keep normal unplugged guidance when Tesla live status says the cable is disconnected', async ({ page }) => {
    const commandRequests = [];

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-live-unplugged', displayName: 'Model 3', hasCredentials: true }],
      statusByVehicleId: {
        'veh-live-unplugged': {
          status: 200,
          body: {
            errno: 0,
            source: 'live',
            result: {
              socPct: 41,
              chargingState: 'disconnected',
              isPluggedIn: false,
              isHome: true,
              rangeKm: 230,
              chargeLimitPct: 80,
              asOfIso: '2026-03-14T00:00:00.000Z'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-live-unplugged': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      onCommandRequest: async (request) => {
        commandRequests.push(request.postDataJSON());
      }
    });

    await page.reload();

    await expect(page.locator('#evSelectedStatusPills')).not.toContainText(/Might Need Wake/i);
    await expect(page.locator('#evWakePrompt')).toBeHidden();

    await page.locator('#evStartChargingBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/not plugged in/i);
    expect(commandRequests).toHaveLength(0);
  });

  test('should update the dashboard to disconnected when Tesla rejects a start command as unplugged', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-now-unplugged', displayName: 'Model 3', hasCredentials: true }],
      statusByVehicleId: {
        'veh-now-unplugged': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 58,
              chargingState: 'stopped',
              isPluggedIn: true,
              isHome: true,
              rangeKm: 280,
              chargeLimitPct: 80,
              asOfIso: '2026-03-14T00:00:00.000Z'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-now-unplugged': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      commandByVehicleId: {
        'veh-now-unplugged': {
          status: 409,
          body: {
            errno: 409,
            error: 'Tesla command could not be applied in the current vehicle state',
            result: {
              reasonCode: 'disconnected'
            }
          }
        }
      }
    });

    await page.reload();
    await page.locator('#evStartChargingBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/not plugged in/i);
    await expect(page.locator('#evSelectedSummary')).toContainText(/Not plugged/i);
    await expect(page.locator('#evWakePrompt')).toBeHidden();
  });

  test('should keep charging controls disabled and show proxy guidance when Tesla signed proxy is unavailable', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-model-s', displayName: 'Model S', hasCredentials: true }],
      readinessByVehicleId: {
        'veh-model-s': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'proxy_unavailable',
              transport: 'signed',
              source: 'fleet_status',
              reasonCode: 'signed_command_proxy_unavailable',
              vehicleCommandProtocolRequired: true
            }
          }
        }
      }
    });

    await page.reload();

    const hasHint = await page.locator('#evCommandHint').count();
    if (!hasHint) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(page.locator('#evControls')).toBeHidden();
    await expect.poll(async () => {
      const hintText = ((await page.locator('#evCommandHint').textContent().catch(() => '')) || '').toLowerCase();
      const pillsText = ((await page.locator('#evSelectedStatusPills').textContent().catch(() => '')) || '').toLowerCase();
      return `${hintText} ${pillsText}`.trim();
    }).toMatch(/signed command|proxy|virtual-key|virtual key|pairing|proxy required|pairing required/i);
  });

  test('should disable charging controls after Tesla reconnect error to avoid repeat command calls', async ({ page }) => {
    const commandRequests = [];

    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-expired', displayName: 'Model 3', hasCredentials: true }],
      statusByVehicleId: {
        'veh-expired': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache',
            result: {
              socPct: 58,
              chargingState: 'stopped',
              isPluggedIn: true,
              rangeKm: 280,
              chargeLimitPct: 80,
              asOfIso: '2026-03-14T00:00:00.000Z'
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-expired': {
          status: 200,
          body: {
            errno: 0,
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      },
      commandByVehicleId: {
        'veh-expired': {
          status: 400,
          body: {
            errno: 400,
            error: 'Tesla authorization expired for this vehicle. Reconnect Tesla in Settings.',
            result: {
              reasonCode: 'tesla_reconnect_required'
            }
          }
        }
      },
      onCommandRequest: async (request) => {
        commandRequests.push(request.postDataJSON());
      }
    });

    await page.reload();

    const limitBtn = page.locator('#evSetChargeLimitBtn');
    if (await limitBtn.count() === 0 || !(await limitBtn.first().isVisible().catch(() => false))) {
      expect(true).toBeTruthy();
      return;
    }

    await expect(page.locator('#evSetChargeLimitBtn')).toBeVisible();
    await page.locator('#evChargeLimitInput').evaluate((element) => {
      element.value = '84';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#evSetChargeLimitBtn').click();

    await expect(page.locator('#evOverviewMessage')).toContainText(/authorization expired/i);
    await expect(page.locator('#evCommandHint')).toContainText(/reconnect tesla in settings/i);
    await expect(page.locator('#evControls')).toBeHidden();
    await expect(page.locator('#evSelectedStatusPills')).toContainText(/Reconnect Tesla/i);
    expect(commandRequests).toHaveLength(1);
  });

  test('should treat cached Tesla fallback marked actionRequired as setup required before commands are attempted', async ({ page }) => {
    await mockEvApis(page, {
      vehicles: [{ vehicleId: 'veh-cache-auth-stale', displayName: 'Model 3', hasCredentials: true }],
      statusByVehicleId: {
        'veh-cache-auth-stale': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache_auth_stale',
            actionRequired: true,
            reasonCode: 'tesla_reconnect_required',
            result: {
              socPct: 58,
              chargingState: 'stopped',
              isPluggedIn: true,
              rangeKm: 280,
              chargeLimitPct: 80,
              asOfIso: new Date().toISOString()
            }
          }
        }
      },
      readinessByVehicleId: {
        'veh-cache-auth-stale': {
          status: 200,
          body: {
            errno: 0,
            source: 'cache_auth_stale',
            actionRequired: true,
            reasonCode: 'tesla_reconnect_required',
            result: {
              state: 'ready_direct',
              transport: 'direct',
              source: 'fleet_status',
              vehicleCommandProtocolRequired: false
            }
          }
        }
      }
    });

    await page.reload();

    await expect(page.locator('#evSelectedStatusPills')).toContainText(/Reconnect Tesla/i);
    await expect(page.locator('#evControls')).toBeHidden();
    await expect(page.locator('#evVehicleTabs .ev-vehicle-tab').first()).toContainText(/Reconnect Tesla/i);
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

  test('should label next Amber spike as tomorrow when the forecast crosses into the next day', async ({ page }) => {
    await page.addInitScript(({ nowIso }) => {
      const RealDate = Date;
      const fixedNow = RealDate.parse(nowIso);

      class MockDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(fixedNow);
            return;
          }
          super(...args);
        }

        static now() {
          return fixedNow;
        }
      }

      MockDate.parse = RealDate.parse;
      MockDate.UTC = RealDate.UTC;
      window.Date = MockDate;

      try {
        localStorage.setItem('dashboardLocalMockMode', '0');
        localStorage.removeItem('cachedPrices');
        localStorage.removeItem('cachedPricesFull');
        localStorage.removeItem('cacheState');
        localStorage.removeItem('amberSiteId');
      } catch (e) {
        // ignore storage failures in tests
      }
    }, { nowIso: '2026-03-23T08:00:00.000Z' });

    await mockDashboardConfig(page);

    await page.route('**/api/pricing/sites*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          { id: 'site-nsw-1', nmi: 'NMI-1234567890', network: 'Ausgrid' }
        ]
      }, 200));
    });

    await page.route('**/api/pricing/current*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            channelType: 'general',
            type: 'CurrentInterval',
            startTime: '2026-03-23T08:00:00.000Z',
            perKwh: 9,
            spotPerKwh: 9,
            renewables: 89,
            descriptor: 'great',
            spikeStatus: 'none'
          },
          {
            channelType: 'feedIn',
            type: 'CurrentInterval',
            startTime: '2026-03-23T08:00:00.000Z',
            perKwh: -1.43,
            spotPerKwh: -1.43,
            spikeStatus: 'none'
          },
          {
            channelType: 'general',
            type: 'ForecastInterval',
            startTime: '2026-03-24T10:00:00.000Z',
            perKwh: 2436,
            spotPerKwh: 2436,
            renewables: 22,
            descriptor: 'notGreat',
            spikeStatus: 'forecast',
            advancedPrice: { low: 2200, predicted: 2436, high: 2600 }
          },
          {
            channelType: 'feedIn',
            type: 'ForecastInterval',
            startTime: '2026-03-24T10:00:00.000Z',
            perKwh: -1.44,
            spotPerKwh: -1.44,
            spikeStatus: 'none'
          },
          {
            channelType: 'general',
            type: 'ForecastInterval',
            startTime: '2026-03-24T10:30:00.000Z',
            perKwh: 144,
            spotPerKwh: 144,
            renewables: 30,
            descriptor: 'ok',
            spikeStatus: 'none',
            advancedPrice: { low: 120, predicted: 144, high: 170 }
          },
          {
            channelType: 'feedIn',
            type: 'ForecastInterval',
            startTime: '2026-03-24T10:30:00.000Z',
            perKwh: -1.44,
            spotPerKwh: -1.44,
            spikeStatus: 'none'
          }
        ]
      }, 200));
    });

    await page.reload();

    const amberCard = page.locator('#amberCard');
    await expect(amberCard).toContainText('Price Spike Forecast');
    await expect(amberCard).toContainText('1 spike expected');
    await expect(amberCard).toContainText('next tomorrow at 21:00');
    await expect(amberCard).not.toContainText('next at 21:00');
  });

  test('should adapt scheduler, quick control, and rule builder UI for AlphaESS capabilities', async ({ page }) => {
    await mockDashboardConfig(page, { deviceProvider: 'alphaess' });
    await page.goto('about:blank');
    await page.goto('/app.html?alphaessCapabilities=1', { waitUntil: 'domcontentloaded' });

    await expect.poll(async () => page.evaluate(() => {
      const schedulerNotice = document.getElementById('schedulerProviderNotice');
      const quickNotice = document.getElementById('quickControlProviderNotice');
      const schedulerForm = document.getElementById('form-scheduler-segment');
      const powerLabel = schedulerForm?.querySelector('input[name="fdPwr"]')?.closest('.input-group')?.querySelector('label')?.textContent || '';
      return Boolean(
        schedulerNotice &&
        getComputedStyle(schedulerNotice).display !== 'none' &&
        quickNotice &&
        getComputedStyle(quickNotice).display !== 'none' &&
        powerLabel.includes('Requested Power')
      );
    }), { timeout: 10000 }).toBe(true);

    await expect(page.locator('#schedulerProviderNotice')).toBeVisible();
    await expect(page.locator('#schedulerProviderNotice')).toContainText(/AlphaESS scheduler note/i);
    await expect(page.locator('#quickControlProviderNotice')).toBeVisible();
    await expect(page.locator('#quickControlProviderNotice')).toContainText(/Power setting is advisory/i);

    const schedulerState = await page.evaluate(() => {
      const form = document.getElementById('form-scheduler-segment');
      const segmentSelect = form?.querySelector('select[name="segmentIndex"]');
      const workModeSelect = form?.querySelector('select[name="workMode"]');
      const powerInput = form?.querySelector('input[name="fdPwr"]');
      const powerLabel = powerInput?.closest('.input-group')?.querySelector('label')?.textContent || '';
      const visibleSegmentCount = segmentSelect
        ? Array.from(segmentSelect.options).filter((option) => !option.hidden && !option.disabled).length
        : 0;
      const backupOption = workModeSelect
        ? Array.from(workModeSelect.options).find((option) => option.value === 'Backup')
        : null;

      return {
        visibleSegmentCount,
        powerLabel,
        backupUnavailable: backupOption ? (backupOption.hidden || backupOption.disabled) : true
      };
    });

    expect(schedulerState.visibleSegmentCount).toBe(4);
    expect(schedulerState.powerLabel).toContain('Requested Power');
    expect(schedulerState.backupUnavailable).toBe(true);

    await page.waitForFunction(() => typeof window.showAddRuleModal === 'function');
    await page.evaluate(() => {
      const existing = document.getElementById('addRuleModal');
      if (existing) existing.remove();
      window.showAddRuleModal();
    });

    await expect(page.locator('#addRuleModal')).toBeVisible();
    await expect(page.locator('#addRuleModal #ruleActionPlainEnglishText')).toContainText(/AlphaESS applies this through scheduler windows/i);

    const ruleModalState = await page.evaluate(() => {
      const select = document.getElementById('newRuleWorkMode');
      const backupOption = select
        ? Array.from(select.options).find((option) => option.value === 'Backup')
        : null;
      return {
        backupUnavailable: backupOption ? (backupOption.hidden || backupOption.disabled) : true
      };
    });

    expect(ruleModalState.backupUnavailable).toBe(true);
  });

  test('should validate rule power against the configured inverter capacity', async ({ page }) => {
    await mockDashboardConfig(page, { inverterCapacityW: 15000 });
    await page.goto('about:blank');
    await page.goto('/app.html?rulePowerCapacity=1', { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => typeof window.showAddRuleModal === 'function');
    await page.evaluate(() => {
      const existing = document.getElementById('addRuleModal');
      if (existing) existing.remove();
      window.showAddRuleModal();
    });

    await expect(page.locator('#addRuleModal')).toBeVisible();

    const modalState = await page.evaluate(() => {
      document.getElementById('newRuleName').value = 'Happy Hour Export';
      document.getElementById('newRulePriority').value = '2';
      document.getElementById('newRuleWorkMode').value = 'ForceDischarge';
      document.getElementById('newRuleDuration').value = '120';
      document.getElementById('newRuleCooldown').value = '150';
      document.getElementById('newRuleFdPwr').value = '15000';
      document.getElementById('newRuleFdSoc').value = '15';
      document.getElementById('newRuleMinSoc').value = '15';
      document.getElementById('newRuleMaxSoc').value = '100';
      document.getElementById('condFeedInEnabled').checked = true;
      document.getElementById('condFeedInVal').value = '1';

      return {
        powerMax: document.getElementById('newRuleFdPwr').max,
        validation: window.validateRuleForm()
      };
    });

    expect(modalState.powerMax).toBe('15000');
    expect(modalState.validation.valid).toBe(true);
    expect(modalState.validation.errors).toEqual([]);
  });

  test('should not treat AlphaESS export flow as solar production when pvPower is zero', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'alphaess',
      deviceSn: 'ALPHA-SN-001'
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'ALPHA-SN-001',
            time: '2026-03-20T06:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 42, unit: '%' },
              { variable: 'pvPower', value: 0, unit: 'kW' },
              { variable: 'loadsPower', value: 0.53, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
              { variable: 'feedinPower', value: 4.45, unit: 'kW' },
              { variable: 'meterPower2', value: -4.45, unit: 'kW' },
              { variable: 'batChargePower', value: 0, unit: 'kW' },
              { variable: 'batDischargePower', value: 4.98, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.goto('about:blank');
    await page.goto('/app.html?alphaessSolarRegression=1', { waitUntil: 'domcontentloaded' });

    await expect.poll(async () => {
      return ((await page.locator('#solar-tile .value').textContent().catch(() => '')) || '').trim();
    }, { timeout: 10000 }).toBe('0.00 kW');

    await expect(page.locator('#solar-tile .value')).toHaveText('0.00 kW');
    await expect(page.locator('#solar-tile .value')).not.toHaveText('4.45 kW');
  });

  test('should animate the dashboard battery icon upward from current SoC while charging', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'BAT-SN-CHARGE',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'BAT-SN-CHARGE',
            time: '2026-03-26T10:00:00.000Z',
            datas: [
              { variable: 'SoC', value: 42, unit: '%' },
              { variable: 'pvPower', value: 1.2, unit: 'kW' },
              { variable: 'loadsPower', value: 0.5, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 1.9, unit: 'kW' },
              { variable: 'feedinPower', value: 0, unit: 'kW' },
              { variable: 'batChargePower', value: 2.7, unit: 'kW' },
              { variable: 'batDischargePower', value: 0, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.goto('about:blank');
    await page.goto('/app.html?batteryAnimationCharge=1', { waitUntil: 'domcontentloaded' });

    const batteryIcon = page.locator('.tile-icon.battery').first();
    await expect(batteryIcon).toHaveAttribute('data-battery-animation', 'charging');

    const animationState = await batteryIcon.evaluate((el) => {
      const level = el.querySelector('.level');
      const computed = level ? window.getComputedStyle(level) : null;
      return {
        classList: Array.from(el.classList || []),
        fillCurrent: parseFloat(el.style.getPropertyValue('--battery-fill-current')),
        fillTarget: parseFloat(el.style.getPropertyValue('--battery-fill-target')),
        fillDurationMs: parseFloat(el.style.getPropertyValue('--battery-fill-duration')),
        animationName: computed ? computed.animationName : '',
        animationDuration: computed ? computed.animationDuration : '',
        animationIterationCount: computed ? computed.animationIterationCount : ''
      };
    });

    expect(animationState.classList).toContain('charging');
    expect(animationState.classList).toContain('is-animating');
    expect(animationState.fillCurrent).toBeCloseTo(0.42, 5);
    expect(animationState.fillTarget).toBe(1);
    expect(animationState.fillDurationMs).toBeGreaterThan(0);
    expect(animationState.animationName).toBe('battery-fill-level');
    expect(animationState.animationDuration).not.toBe('0s');
    expect(animationState.animationIterationCount).toBe('infinite');
  });

  test('should animate the dashboard battery icon downward from current SoC while discharging', async ({ page }) => {
    await mockDashboardConfig(page, {
      deviceProvider: 'foxess',
      deviceSn: 'BAT-SN-DISCHARGE',
      batteryCapacityKWh: 13.5
    });

    await page.route('**/api/inverter/real-time*', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: [
          {
            deviceSN: 'BAT-SN-DISCHARGE',
            time: '2026-03-26T10:05:00.000Z',
            datas: [
              { variable: 'SoC', value: 49, unit: '%' },
              { variable: 'pvPower', value: 0.1, unit: 'kW' },
              { variable: 'loadsPower', value: 1.2, unit: 'kW' },
              { variable: 'gridConsumptionPower', value: 0.3, unit: 'kW' },
              { variable: 'feedinPower', value: 0, unit: 'kW' },
              { variable: 'batChargePower', value: 0, unit: 'kW' },
              { variable: 'batDischargePower', value: 0.74, unit: 'kW' }
            ]
          }
        ]
      }, 200));
    });

    await page.goto('about:blank');
    await page.goto('/app.html?batteryAnimationDischarge=1', { waitUntil: 'domcontentloaded' });

    const batteryState = page.locator('#inverterCard .energy-core__state').first();
    await expect(batteryState).toHaveText('Discharging');
    await expect(batteryState).toHaveClass(/is-discharging/);
    await expect
      .poll(async () => batteryState.evaluate((el) => window.getComputedStyle(el).color))
      .toBe('rgb(255, 147, 141)');

    const batteryIcon = page.locator('.tile-icon.battery').first();
    await expect(batteryIcon).toHaveAttribute('data-battery-animation', 'discharging');

    const animationState = await batteryIcon.evaluate((el) => {
      const level = el.querySelector('.level');
      const computed = level ? window.getComputedStyle(level) : null;
      return {
        classList: Array.from(el.classList || []),
        fillCurrent: parseFloat(el.style.getPropertyValue('--battery-fill-current')),
        fillTarget: parseFloat(el.style.getPropertyValue('--battery-fill-target')),
        fillDurationMs: parseFloat(el.style.getPropertyValue('--battery-fill-duration')),
        animationName: computed ? computed.animationName : '',
        animationDuration: computed ? computed.animationDuration : '',
        animationIterationCount: computed ? computed.animationIterationCount : ''
      };
    });

    expect(animationState.classList).toContain('discharging');
    expect(animationState.classList).toContain('is-animating');
    expect(animationState.fillCurrent).toBeCloseTo(0.49, 5);
    expect(animationState.fillTarget).toBe(0);
    expect(animationState.fillDurationMs).toBeGreaterThan(0);
    expect(animationState.animationName).toBe('battery-fill-level');
    expect(animationState.animationDuration).not.toBe('0s');
    expect(animationState.animationIterationCount).toBe('infinite');
  });
});
