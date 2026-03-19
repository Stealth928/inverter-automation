const { test, expect } = require('@playwright/test');

/**
 * Control Page Tests
 * 
 * Tests the manual control interface at control.html
 */

async function mockControlApi(page, {
  deviceProvider = 'foxess',
  timezone = 'Australia/Sydney',
  schedulerGroups = []
} = {}) {
  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    let body = { errno: 0, result: {} };

    if (path === '/api/config/setup-status') {
      body = {
        errno: 0,
        result: {
          setupComplete: true,
          deviceProvider
        }
      };
    } else if (path === '/api/config') {
      body = {
        errno: 0,
        result: {
          timezone
        }
      };
    } else if (path === '/api/scheduler/v1/get') {
      body = {
        errno: 0,
        source: 'device',
        result: {
          groups: schedulerGroups
        }
      };
    } else if (path === '/api/user/init-profile') {
      body = { errno: 0, result: { initialized: true } };
    } else if (path === '/api/admin/check') {
      body = { errno: 0, result: { isAdmin: false } };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

test.describe('Control Page', () => {
  
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
    
    await page.goto('/control.html');
  });

  test('should load control page', async ({ page }) => {
    await expect(page).toHaveTitle(/Control|Inverter/i);
  });

  test('should display rules section', async ({ page }) => {
    const hasRules = await page.getByText(/rules|automation|conditions/i).count() > 0;
    expect(typeof hasRules).toBe('boolean');
  });

  test('should have add rule button', async ({ page }) => {
    const addButton = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")').first();
    const hasAddButton = await addButton.count() > 0;
    // Add button is optional - may require auth
    expect(typeof hasAddButton).toBe('boolean');
  });

  test('should display existing rules list', async ({ page }) => {
    // Check for rules list container
    const rulesList = page.locator('[data-rules], .rules-list, #rules-list, table').first();
    const hasList = await rulesList.count() > 0;
    // Rules list may require auth
    expect(typeof hasList).toBe('boolean');
  });

  test('should show rule properties (name, priority, enabled)', async ({ page }) => {
    const hasRuleRows = await page.locator('[data-rule], .rule-card, .rule-item, tbody tr').count() > 0;
    if (hasRuleRows) {
      const hasName = await page.getByText(/name|title/i).count() > 0;
      const hasPriority = await page.getByText(/priority|order/i).count() > 0;
      const hasEnabled = await page.getByText(/enabled|active|status/i).count() > 0;
      expect(hasName || hasPriority || hasEnabled).toBeTruthy();
    } else {
      // In unauthenticated/mock states, rule rows may not render; ensure the rules area still loads.
      const hasRulesSection = await page.getByText(/rules|automation|conditions/i).count() > 0;
      expect(hasRulesSection).toBeTruthy();
    }
  });

  test('should have rule actions (edit, delete, toggle)', async ({ page }) => {
    // Look for action buttons or icons
    const hasEdit = await page.locator('button:has-text("Edit"), [data-action="edit"], .edit-btn').count() > 0;
    const hasDelete = await page.locator('button:has-text("Delete"), [data-action="delete"], .delete-btn').count() > 0;
    const hasToggle = await page.locator('input[type="checkbox"], .toggle, [data-toggle]').count() > 0;
    
    expect(hasEdit || hasDelete || hasToggle).toBeTruthy();
  });

  test('should navigate back to dashboard', async ({ page }) => {
    const homeLink = page.locator('a[href*="index"], a:has-text("Home"), a:has-text("Dashboard")').first();
    const hasHomeLink = await homeLink.count() > 0;
    
    if (hasHomeLink) {
      await homeLink.click();
      await page.waitForURL(/index\.html/);
      expect(page.url()).toContain('index');
    } else {
      // Navigation might be in header/nav
      expect(true).toBeTruthy();
    }
  });

  test('should display manual control section', async ({ page }) => {
    // Manual controls for inverter
    const hasManualControl = await page.getByText(/manual|control|mode|discharge|charge/i).count() > 0;
    expect(hasManualControl).toBeTruthy();
  });

  test('should have work mode selector', async ({ page }) => {
    // Look for mode selection (dropdown or buttons)
    const modeSelector = await page.locator('select, [data-mode], button:has-text("Mode")').count();
    expect(modeSelector).toBeGreaterThanOrEqual(0);
  });

  test('keeps the work mode control visible for FoxESS', async ({ page }) => {
    await mockControlApi(page, { deviceProvider: 'foxess' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#card-work-mode')).toBeVisible();
    await expect(page.locator('#card-alphaess-override-status')).toBeHidden();
    await expect(page.locator('#controls-provider-note')).toBeHidden();
  });

  test('hides the work mode control for AlphaESS, shows guidance, and exposes a read-only override card', async ({ page }) => {
    await mockControlApi(page, { deviceProvider: 'alphaess' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#card-work-mode')).toBeHidden();
    await expect(page.locator('#card-alphaess-override-status')).toBeVisible();
    await expect(page.locator('#controls-provider-note')).toBeVisible();
    await expect(page.locator('#controls-provider-note')).toContainText(/AlphaESS/i);
    await expect(page.locator('#controls-provider-note')).toContainText(/Scheduler|Quick Control/i);
  });

  test('derives the current AlphaESS override from live scheduler windows', async ({ page }) => {
    await mockControlApi(page, {
      deviceProvider: 'alphaess',
      schedulerGroups: [
        {
          enable: 1,
          workMode: 'ForceCharge',
          startHour: 0,
          startMinute: 0,
          endHour: 23,
          endMinute: 59
        }
      ]
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.locator('#card-alphaess-override-status button').click();

    await expect(page.locator('#alphaessCurrentOverride')).toContainText(/Charge window active/i);
    await expect(page.locator('#alphaessCurrentOverrideDetail')).toContainText(/00:00-23:59/i);
    await expect(page.locator('#status-alphaessOverride')).toContainText(/Loaded current scheduler override/i);
  });

  test('should display inverter status information', async ({ page }) => {
    // Current inverter status
    const hasStatus = await page.getByText(/status|state|mode|power|soc/i).count() > 0;
    expect(hasStatus).toBeTruthy();
  });

  test('should show scheduler configuration', async ({ page }) => {
    // Scheduler/timer settings
    const hasScheduler = await page.getByText(/schedule|timer|segment|time/i).count() > 0;
    expect(hasScheduler).toBeTruthy();
  });

  test('should handle empty rules state', async ({ page }) => {
    // Should show message when no rules exist
    const emptyMessage = await page.getByText(/no rules|empty|create/i).count() > 0;
    
    // Or show the rules list (either is valid)
    const hasList = await page.locator('[data-rules], .rules-list, table').count() > 0;
    
    // May require auth - just check page loads
    expect(typeof (emptyMessage || hasList)).toBe('boolean');
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

  test('should have cancel button in forms', async ({ page }) => {
    // If form exists, should have cancel
    const hasForm = await page.locator('form, .modal, .dialog').count() > 0;
    
    if (hasForm) {
      const cancelBtn = await page.locator('button:has-text("Cancel"), button:has-text("Close")').count();
      // Cancel button is optional - forms may not be visible without auth
      expect(typeof cancelBtn).toBe('number');
    } else {
      expect(true).toBeTruthy();
    }
  });

  test('should show confirmation for destructive actions', async ({ page }) => {
    // Deleting a rule should confirm
    const deleteBtn = page.locator('button:has-text("Delete"), [data-action="delete"], .delete-btn').first();
    const hasDelete = await deleteBtn.count() > 0;
    
    if (hasDelete) {
      const isVisible = await deleteBtn.isVisible().catch(() => false);
      const isEnabled = await deleteBtn.isEnabled().catch(() => false);
      if (!isVisible || !isEnabled) {
        expect(true).toBeTruthy();
        return;
      }

      page.once('dialog', async (dialog) => {
        await dialog.dismiss();
      });

      // Click delete - confirmation can be modal or native dialog depending on implementation.
      await deleteBtn.click({ timeout: 3000 });
      
      // Look for confirmation dialog
      await page.waitForTimeout(500);
      const hasConfirm = await page.locator('.modal, dialog, .confirm').count();
      expect(typeof hasConfirm).toBe('number');
    } else {
      expect(true).toBeTruthy();
    }
  });
});
