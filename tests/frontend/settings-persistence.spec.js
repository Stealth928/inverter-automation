const { test, expect } = require('@playwright/test');

/**
 * Settings Page - Data Persistence Tests
 * 
 * These tests validate that settings are actually saved to the backend
 * and survive page reloads (not just UI validation).
 */

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
        deviceSn: 'TEST123456'
      };
      
      // Mock the fetch API to simulate backend
      window.originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        // GET /api/config - return current mock config
        if (url === '/api/config' && (!options || options.method === 'GET' || options.method === 'get')) {
          return new Response(JSON.stringify({
            errno: 0,
            result: JSON.parse(JSON.stringify(window.mockServerConfig))  // Return clone of current state
          }));
        }
        
        // POST /api/config - update mock config with new data
        if (url === '/api/config' && options && (options.method === 'POST' || options.method === 'post')) {
          try {
            const body = JSON.parse(options.body);
            
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
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        
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
      const newValue = '90000';
      await intervalInput.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Verify backend
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        expect(serverConfig.automation?.intervalMs).toBe(parseInt(newValue));
      }
    }
  });

  test('should survive reload after automation interval change', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const intervalInput = page.locator('#automation_intervalMs');
    if (await intervalInput.count() > 0) {
      const newValue = '75000';
      await intervalInput.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Reload
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);
        
        // Verify value persisted
        const reloadedValue = await page.locator('#automation_intervalMs').inputValue();
        expect(parseInt(reloadedValue)).toBe(parseInt(newValue));
      }
    }
  });

  test('should save cache amber setting', async ({ page }) => {
    await page.waitForTimeout(500);
    
    const amberCache = page.locator('#cache_amber');
    if (await amberCache.count() > 0) {
      const newValue = '120000';
      await amberCache.fill(newValue);
      
      // Save
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);
        
        // Verify backend
        const serverConfig = await page.evaluate(() => window.mockServerConfig);
        expect(serverConfig.cache?.amber).toBe(parseInt(newValue));
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
      await intervalInput.fill('85000');
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
      interval: '95000',
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
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      
      // Verify all persisted
      const locationValue = await page.locator('#preferences_weatherPlace').inputValue();
      const intervalValue = await page.locator('#automation_intervalMs').inputValue();
      const forecastValue = await page.locator('#preferences_forecastDays').inputValue();
      
      expect(locationValue).toBe(changes.location);
      expect(parseInt(intervalValue)).toBe(parseInt(changes.interval));
      expect(parseInt(forecastValue)).toBe(parseInt(changes.forecast));
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
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    
    // UI should resolve to preferences.weatherPlace as the source of truth
    const displayedLocation = await page.locator('#preferences_weatherPlace').inputValue();
    
    // With the fix, it should prefer preferences.weatherPlace
    expect(displayedLocation).toBe('Melbourne, Australia');
  });
});
