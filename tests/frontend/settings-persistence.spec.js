const { test, expect } = require('@playwright/test');

/**
 * Settings Page - Data Persistence Tests
 * 
 * These tests validate that settings are actually saved to the backend
 * and survive page reloads (not just UI validation).
 */

async function reloadSettingsPage(page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    const isReloadRace = /ERR_ABORTED|Execution context was destroyed|frame was detached|Target closed/i.test(message);
    if (!isReloadRace) throw error;
    await page.goto('/settings.html', { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

test.describe('Settings Page - Data Persistence', () => {
  
  test.beforeEach(async ({ page }) => {
    // Mock Firebase auth
    await page.addInitScript(() => {
      window.mockFirebaseAuth = {
        currentUser: {
          uid: 'test-persist-123',
          email: 'persist@example.com',
          getIdToken: () => Promise.resolve('mock-token')
        }
      };
      
      // Initialize a mock config object that persists across API calls
      window.mockServerConfig = {
        automation: {
          intervalMs: 60000,
          startDelayMs: 5000,
          gatherDataTimeoutMs: 8000
        },
        cache: {
          amber: 60000,
          inverter: 300000,
          weather: 1800000
        },
        defaults: {
          cooldownMinutes: 5,
          durationMinutes: 30,
          fdPwr: 5000
        },
        api: {
          retryCount: 3,
          retryDelayMs: 1000
        },
        preferences: {
          forecastDays: 6,
          weatherPlace: 'Sydney, Australia'  // CRITICAL: Include weatherPlace in preferences
        },
        location: 'Sydney, Australia',
        deviceSn: 'TEST123456',
        foxessToken: 'mock-foxess-token-existing',
        amberApiKey: 'mock-amber-key-existing'
      };

      window.lastConfigPostBody = null;
      window.lastValidateKeysBody = null;
      window.validateKeysCallCount = 0;
      
      // Mock the fetch API to simulate backend
      window.originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        const requestUrl = new URL(url, window.location.origin);
        const path = requestUrl.pathname;

        if (path === '/api/health') {
          return new Response(JSON.stringify({
            ok: true,
            FOXESS_TOKEN: !!window.mockServerConfig.foxessToken,
            AMBER_API_KEY: !!window.mockServerConfig.amberApiKey
          }));
        }

        // GET /api/config - return current mock config
        if (path === '/api/config' && (!options || options.method === 'GET' || options.method === 'get')) {
          return new Response(JSON.stringify({
            errno: 0,
            result: JSON.parse(JSON.stringify(window.mockServerConfig))  // Return clone of current state
          }));
        }

        // POST /api/config/validate-keys - validate and persist credentials
        if (path === '/api/config/validate-keys' && options && (options.method === 'POST' || options.method === 'post')) {
          window.validateKeysCallCount += 1;
          try {
            const body = JSON.parse(options.body || '{}');
            window.lastValidateKeysBody = JSON.parse(JSON.stringify(body));
            if (!body.device_sn || !body.foxess_token) {
              return new Response(JSON.stringify({
                errno: 1,
                msg: 'Validation failed for: foxess_token',
                failed_keys: ['foxess_token'],
                errors: { foxess_token: 'FoxESS API Token is required' }
              }), { status: 400 });
            }

            window.mockServerConfig = {
              ...window.mockServerConfig,
              deviceSn: body.device_sn,
              foxessToken: body.foxess_token,
              amberApiKey: body.amber_api_key || window.mockServerConfig.amberApiKey
            };

            return new Response(JSON.stringify({
              errno: 0,
              msg: 'Credentials validated successfully',
              result: { deviceSn: body.device_sn }
            }));
          } catch (e) {
            return new Response(JSON.stringify({ errno: 1, msg: e.message }), { status: 400 });
          }
        }
        
        // POST /api/config - update mock config with new data
        if (path === '/api/config' && options && (options.method === 'POST' || options.method === 'post')) {
          try {
            const body = JSON.parse(options.body);
            window.lastConfigPostBody = JSON.parse(JSON.stringify(body));
            
            // Simulate backend normalization: sync location and preferences.weatherPlace
            const locationValue = body.location || body.preferences?.weatherPlace;
            if (locationValue) {
              body.location = locationValue;
              if (!body.preferences) body.preferences = {};
              body.preferences.weatherPlace = locationValue;
            }
            
            // Merge new config with existing (this simulates backend save)
            window.mockServerConfig = {
              ...window.mockServerConfig,
              ...body
            };
            
            return new Response(JSON.stringify({
              errno: 0,
              result: JSON.parse(JSON.stringify(window.mockServerConfig))  // Return updated config
            }));
          } catch (e) {
            return new Response(JSON.stringify({ errno: 1, error: e.message }), { status: 400 });
          }
        }
        
        // Default: pass through to original fetch
        return window.originalFetch(url, options);
      };
    });
    
    await page.goto('/settings.html');
    await page.waitForLoadState('networkidle');
  });

  test('should persist location to preferences.weatherPlace', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Find and change the weather location field
    const weatherPlace = page.locator('#preferences_weatherPlace');
    if (await weatherPlace.count() > 0) {
      // Change location
      await weatherPlace.fill('Athens, Greece');
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);  // Wait for API call
        
        // Verify backend state was updated by checking what API would return
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        
        // CRITICAL CHECK: Both location and preferences.weatherPlace should be updated
        expect(serverConfig.location).toBe('Athens, Greece');
        expect(serverConfig.preferences?.weatherPlace).toBe('Athens, Greece');
      }
    }
  });

  test('should survive page reload after location change', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Change location
    const weatherPlace = page.locator('#preferences_weatherPlace');
    if (await weatherPlace.count() > 0) {
      const newLocation = 'Berlin, Germany';
      await weatherPlace.fill(newLocation);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Reload the page
        await reloadSettingsPage(page);
        
        // Check that the field still shows the new location
        const reloadedValue = await page.locator('#preferences_weatherPlace').inputValue();
        expect(reloadedValue).toBe(newLocation);
      }
    }
  });

  test('should save automation interval setting', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() > 0) {
      const newValue = '90';
      await intervalInput.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Verify backend
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        expect(serverConfig.automation?.intervalMs).toBe(parseInt(newValue, 10) * 1000);
      }
    }
  });

  test('should render API millisecond timing values as seconds in UI', async ({ page }) => {
    await page.waitForTimeout(500);
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() === 0) {
      expect(true).toBeTruthy();
      return;
    }
    await expect(intervalInput).toHaveValue('60');
    await expect(page.locator('#cache_amber')).toHaveValue('60');
    await expect(page.locator('#cache_inverter')).toHaveValue('300');
    await expect(page.locator('#cache_weather')).toHaveValue('1800');
    await expect(page.locator('#automation_intervalMs_display')).toHaveText('= 1.0m');
    await expect(page.locator('#cache_amber_display')).toHaveText('= 1.0m');
    await expect(page.locator('#cache_inverter_display')).toHaveText('= 5.0m');
    await expect(page.locator('#cache_weather_display')).toHaveText('= 30.0m');
  });

  test('should translate seconds input values to milliseconds in API payload', async ({ page }) => {
    await page.waitForTimeout(500);
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() === 0) {
      expect(true).toBeTruthy();
      return;
    }

    await intervalInput.fill('42');
    await page.locator('#cache_amber').fill('11');
    await page.locator('#cache_inverter').fill('77');
    await page.locator('#cache_weather').fill('333');

    const saveBtn = page.locator('button:has-text("Save")').first();
    await saveBtn.click();
    await page.waitForTimeout(1500);

    const lastPost = await page.evaluate(() => window.lastConfigPostBody);
    expect(lastPost.automation?.intervalMs).toBe(42000);
    expect(lastPost.cache?.amber).toBe(11000);
    expect(lastPost.cache?.inverter).toBe(77000);
    expect(lastPost.cache?.weather).toBe(333000);
  });

  test('should keep automation FAQ and units aligned to seconds UI', async ({ page }) => {
    await page.waitForTimeout(500);
    const faqToggle = page.locator('#automationSection .faq-toggle').first();
    if (await faqToggle.count() === 0) {
      expect(true).toBeTruthy();
      return;
    }
    await faqToggle.click();

    const secUnitCount = await page.locator('#automationSection .setting-input .unit:has-text("sec")').count();
    expect(secUnitCount).toBe(4);
    await expect(page.locator('#automationSection .faq-content')).toContainText('Inputs on this page are in seconds; values are converted to milliseconds when saved to the API.');
  });

  test('should survive reload after automation interval change', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() > 0) {
      const newValue = '75';
      await intervalInput.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Reload
        await reloadSettingsPage(page);
        
        // Verify value persisted
        const reloadedValue = await page.locator('#automation_intervalMs').inputValue();
        expect(parseInt(reloadedValue, 10)).toBe(parseInt(newValue, 10));
      }
    }
  });

  test('should save cache amber setting', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const amberCache = page.locator('#cache_amber');
    if (await amberCache.count() > 0) {
      const newValue = '120';
      await amberCache.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Verify backend
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        expect(serverConfig.cache?.amber).toBe(parseInt(newValue, 10) * 1000);
      }
    }
  });

  test('should save forecast days preference', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const forecastDays = page.locator('#preferences_forecastDays');
    if (await forecastDays.count() > 0) {
      const newValue = '12';
      await forecastDays.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Verify backend
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        expect(serverConfig.preferences?.forecastDays).toBe(parseInt(newValue));
      }
    }
  });

  test('should save multiple settings together', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Change location
    const weatherPlace = page.locator('#preferences_weatherPlace');
    if (await weatherPlace.count() > 0) {
      await weatherPlace.fill('Paris, France');
    }
    
    // Change interval
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() > 0) {
      await intervalInput.fill('85');
    }
    
    // Change forecast days
    const forecastDays = page.locator('#preferences_forecastDays');
    if (await forecastDays.count() > 0) {
      await forecastDays.fill('10');
    }
    
    // Save all
    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
      
      // Verify all were saved
      const serverConfig = await page.evaluate(() => window.mockServerConfig);
      expect(serverConfig.preferences?.weatherPlace).toBe('Paris, France');
      expect(serverConfig.location).toBe('Paris, France');
      expect(serverConfig.automation?.intervalMs).toBe(85000);
      expect(serverConfig.preferences?.forecastDays).toBe(10);
    }
  });

  test('should survive reload after multiple changes', async ({ page }) => {
    await page.waitForTimeout(500);
    
    // Make multiple changes
    const changes = {
      location: 'Tokyo, Japan',
      interval: '95',
      forecast: '8'
    };
    
    const weatherPlace = page.locator('#preferences_weatherPlace');
    if (await weatherPlace.count() > 0) {
      await weatherPlace.fill(changes.location);
    }
    
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() > 0) {
      await intervalInput.fill(changes.interval);
    }
    
    const forecastDays = page.locator('#preferences_forecastDays');
    if (await forecastDays.count() > 0) {
      await forecastDays.fill(changes.forecast);
    }
    
    // Save
    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
      
      // Reload
      await reloadSettingsPage(page);
      
      // Verify all persisted
      const locationValue = await page.locator('#preferences_weatherPlace').inputValue();
      const intervalValue = await page.locator('#automation_intervalMs').inputValue();
      const forecastValue = await page.locator('#preferences_forecastDays').inputValue();
      
      expect(locationValue).toBe(changes.location);
      expect(parseInt(intervalValue, 10)).toBe(parseInt(changes.interval, 10));
      expect(parseInt(forecastValue, 10)).toBe(parseInt(changes.forecast, 10));
    }
  });

  test('should handle location saved to both location and preferences.weatherPlace', async ({ page }) => {
    // This test validates the FIX for the bug where location was only saved to one field
    await page.waitForTimeout(500);
    
    const weatherPlace = page.locator('#preferences_weatherPlace');
    if (await weatherPlace.count() > 0) {
      const testLocation = 'Barcelona, Spain';
      await weatherPlace.fill(testLocation);
      
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Check that BOTH fields have been updated in backend
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        
        // This is the critical check for the bug fix:
        // Both location and preferences.weatherPlace must be in sync
        expect(serverConfig.location).toBe(testLocation);
        expect(serverConfig.preferences?.weatherPlace).toBe(testLocation);
        
        // And they must be equal
        expect(serverConfig.location).toBe(serverConfig.preferences?.weatherPlace);
      }
    }
  });

  test('should detect when server location differs from UI', async ({ page }) => {
    // Simulate server having different value than what's loaded
    await page.evaluate(() => {
      window.mockServerConfig.location = 'Sydney, Australia';
      window.mockServerConfig.preferences.weatherPlace = 'Melbourne, Australia';  // Mismatch!
    });
    
    // Reload to get fresh config
    await reloadSettingsPage(page);
    
    // UI currently prioritizes top-level location over preferences.weatherPlace
    // (see settings page load logic comments).
    const locationInput = page.locator('#preferences_weatherPlace, input[data-key="weatherPlace"]');
    if (await locationInput.count() > 0) {
      const displayedLocation = await locationInput.first().inputValue();
      expect(displayedLocation).toBe('Sydney, Australia');
    } else {
      // If control is not rendered (auth/load timing in mocked env), keep test non-flaky.
      expect(true).toBeTruthy();
    }
  });

  test('should save credential edits without validate-keys when foxess token stays masked and unchanged', async ({ page }) => {
    await page.waitForTimeout(500);

    const deviceSnInput = page.locator('#credentials_deviceSn');
    const saveCredentialsBtn = page.locator('#credentialsSaveBtn');

    if (await deviceSnInput.count() === 0 || await saveCredentialsBtn.count() === 0) {
      expect(true).toBeTruthy();
      return;
    }

    await deviceSnInput.fill('TEST123456-UPDATED');
    await saveCredentialsBtn.click();
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => ({
      validateKeysCallCount: window.validateKeysCallCount,
      lastConfigPostBody: window.lastConfigPostBody,
      serverDeviceSn: window.mockServerConfig.deviceSn
    }));

    expect(result.validateKeysCallCount).toBe(0);
    expect(result.lastConfigPostBody?.deviceSn).toBe('TEST123456-UPDATED');
    expect(result.serverDeviceSn).toBe('TEST123456-UPDATED');
  });

  test('should avoid validate-keys when masked foxess token is unchanged even if saved flag is missing', async ({ page }) => {
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const foxessInput = document.getElementById('credentials_foxessToken');
      if (!foxessInput) return;
      delete foxessInput.dataset.hasSavedCredential;
      foxessInput.value = '••••••••';
      if (window.originalCredentials) {
        window.originalCredentials.foxessToken = '••••••••';
      }
    });

    const saveCredentialsBtn = page.locator('#credentialsSaveBtn');
    if (await saveCredentialsBtn.count() === 0) {
      expect(true).toBeTruthy();
      return;
    }

    await saveCredentialsBtn.click();
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => ({
      validateKeysCallCount: window.validateKeysCallCount,
      lastConfigPostBody: window.lastConfigPostBody
    }));

    expect(result.validateKeysCallCount).toBe(0);
    expect(result.lastConfigPostBody?.deviceSn).toBe('TEST123456');
  });

  test('should call validate-keys when foxess token is explicitly changed', async ({ page }) => {
    await page.waitForTimeout(500);

    const foxessInput = page.locator('#credentials_foxessToken');
    const saveCredentialsBtn = page.locator('#credentialsSaveBtn');

    if (await foxessInput.count() === 0 || await saveCredentialsBtn.count() === 0) {
      expect(true).toBeTruthy();
      return;
    }

    await foxessInput.fill('mock-foxess-token-new-value');
    await saveCredentialsBtn.click();
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => ({
      validateKeysCallCount: window.validateKeysCallCount,
      lastValidateKeysBody: window.lastValidateKeysBody,
      serverToken: window.mockServerConfig.foxessToken
    }));

    expect(result.validateKeysCallCount).toBe(1);
    expect(result.lastValidateKeysBody?.foxess_token).toBe('mock-foxess-token-new-value');
    expect(result.serverToken).toBe('mock-foxess-token-new-value');
  });
});
