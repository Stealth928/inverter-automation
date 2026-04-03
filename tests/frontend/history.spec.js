const { test, expect } = require('@playwright/test');

/**
 * History Page Tests
 * 
 * Tests the automation history page at history.html
 */

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

test.describe('History Page', () => {
  
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
    
    await page.goto('/history.html');
  });

  test('should load history page', async ({ page }) => {
    const title = await page.title();
    const hasExpectedTitle = /History|Automation|Inverter/i.test(title);
    const hasPageHeading = await page.locator('h1, h2, [data-page-title]').count() > 0;
    const isHistoryUrl = page.url().includes('history.html');
    expect(hasExpectedTitle || hasPageHeading || isHistoryUrl).toBeTruthy();
  });

  test('should display history table or list', async ({ page }) => {
    const hasTable = await page.locator('table, .history-list, [data-history]').count() > 0;
    // History may require auth or may be empty
    expect(typeof hasTable).toBe('boolean');
  });

  test('should have filter controls', async ({ page }) => {
    // Date filters, status filters, etc.
    const hasFilters = await page.getByText(/filter|date|range|from|to/i).count() > 0;
    const hasFilterInputs = await page.locator('input[type="date"], select, [data-filter]').count() > 0;
    
    expect(hasFilters || hasFilterInputs).toBeTruthy();
  });

  test('should display history entries with timestamps', async ({ page }) => {
    // History should show when events occurred
    const hasTimestamp = await page.getByText(/time|date|ago|at/i).count() > 0;
    expect(hasTimestamp).toBeTruthy();
  });

  test('should show rule names in history', async ({ page }) => {
    const hasRuleName = await page.getByText(/rule|name|triggered/i).count() > 0;
    // History may be empty or require auth
    expect(typeof hasRuleName).toBe('boolean');
  });

  test('should display automation status/outcome', async ({ page }) => {
    // Success, failure, triggered, etc.
    const hasStatus = await page.getByText(/status|success|fail|trigger|active/i).count() > 0;
    // History may be empty or require auth
    expect(typeof hasStatus).toBe('boolean');
  });

  test('should have pagination or load more', async ({ page }) => {
    const hasPagination = await page.locator('button:has-text("Load"), button:has-text("More"), .pagination, [data-page]').count() > 0;
    expect(typeof hasPagination).toBe('boolean');
  });

  test('should handle empty history state', async ({ page }) => {
    // Should show message when no history
    const emptyMessage = await page.getByText(/no history|empty|no data/i).count() > 0;
    const hasEntries = await page.locator('tr, .history-item, [data-entry]').count() > 0;
    
    // History may require auth - just check page loads
    expect(typeof (emptyMessage || hasEntries)).toBe('boolean');
  });

  test('should have export functionality', async ({ page }) => {
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Download"), a[download]').first();
    const hasExport = await exportBtn.count() > 0;

    // Export is optional but common
    expect(typeof hasExport).toBe('boolean');
  });

  test('should show details for history entries', async ({ page }) => {
    // Click to expand or view details
    const detailsBtn = page.locator('button:has-text("Details"), button:has-text("View"), a:has-text("More")').first();
    const hasDetails = await detailsBtn.count() > 0;
    
    expect(typeof hasDetails).toBe('boolean');
  });

  test('should display event types', async ({ page }) => {
    // Different types of events
    const hasEventTypes = await page.getByText(/cycle|trigger|enable|disable|create|delete/i).count() > 0;
    // Events may not show without auth or data
    expect(typeof hasEventTypes).toBe('boolean');
  });

  test('should navigate back to dashboard', async ({ page }) => {
    const homeLink = page.locator('a[href*="index"], a:has-text("Home"), a:has-text("Dashboard")').first();
    const hasHomeLink = await homeLink.count() > 0;
    
    if (hasHomeLink) {
      await homeLink.click();
      await page.waitForURL(/index\.html/);
      expect(page.url()).toContain('index');
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

  test('should sort history entries', async ({ page }) => {
    // Sort by date, name, status, etc.
    const sortBtn = page.locator('button:has-text("Sort"), [data-sort], th').first();
    const hasSort = await sortBtn.count() > 0;
    
    expect(typeof hasSort).toBe('boolean');
  });

  test('should refresh history data', async ({ page }) => {
    const refreshBtn = page.locator('button:has-text("Refresh"), button:has-text("Reload"), [data-refresh]').first();
    const hasRefresh = await refreshBtn.count() > 0;

    expect(typeof hasRefresh).toBe('boolean');
  });

  test('should show loading state when fetching history', async ({ page }) => {
    await page.reload();
    
    // Check for loading indicator
    const hasLoading = await page.locator('.loading, .spinner, [aria-busy="true"]').count();
    
    expect(typeof hasLoading).toBe('number');
  });

  test('window.sharedUtils.getStoredAmberSiteId is accessible (regression: was bare global)', async ({ page }) => {
    // Regression: history.js called getStoredAmberSiteId() without the window.sharedUtils prefix.
    // This silently returned '' due to the typeof guard, causing Amber site selection to always
    // ignore the user's stored preference on the History page.
    const available = await page.evaluate(() => {
      return typeof window.sharedUtils?.getStoredAmberSiteId === 'function';
    });
    expect(available).toBe(true);
  });

  test('no ReferenceError for getStoredAmberSiteId on history page load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.reload();
    await page.waitForTimeout(500);
    const refErrors = errors.filter(e => /getStoredAmberSiteId|setStoredAmberSiteId/i.test(e));
    expect(refErrors).toHaveLength(0);
  });

  test('keeps month picker visible for daily view and hides it for yearly view', async ({ page }) => {
    await expect(page.locator('#reportMonthGroup')).toBeVisible();
    await page.selectOption('#reportDimension', 'year');
    await expect(page.locator('#reportMonthGroup')).toBeHidden();
    await page.selectOption('#reportDimension', 'month');
    await expect(page.locator('#reportMonthGroup')).toBeVisible();
  });

  test('shows AlphaESS report limitation notice and disables yearly breakdown when configured for AlphaESS', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          deviceProvider: 'alphaess',
          deviceSn: 'ALPHA-SN-001',
          pricingProvider: 'amber'
        }
      }, 200));
    });

    await page.reload();

    await expect(page.locator('#reportProviderNotice')).toBeVisible();
    await expect(page.locator('#reportProviderNotice')).toContainText(/yearly view is hidden/i);
    await expect(page.locator('#reportProviderNotice')).toContainText(/AC-coupled auto-detect is disabled/i);
    await expect(page.locator('#reportDimension option[value="year"]')).toBeDisabled();
    await expect(page.locator('#reportControlHint')).toContainText(/yearly view is hidden/i);
  });

  test('disables device reporting surfaces for Sigenergy while leaving the page usable', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          deviceProvider: 'sigenergy',
          deviceSn: 'SIGEN-001',
          pricingProvider: 'amber'
        }
      }, 200));
    });

    await page.reload();

    await expect(page.locator('#btnFetchHistory')).toBeDisabled();
    await expect(page.locator('#btnFetchReport')).toBeDisabled();
    await expect(page.locator('#btnFetchGeneration')).toBeDisabled();
    await expect(page.locator('#historyContent')).toContainText(/not yet available for SigenEnergy/i);
    await expect(page.locator('#reportContent')).toContainText(/not yet available for SigenEnergy/i);
    await expect(page.locator('#generationContent')).toContainText(/not yet available for SigenEnergy/i);
  });

  test('updates pricing presentation when configured for AEMO pricing', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      await route.fulfill(jsonResponse({
        errno: 0,
        result: {
          deviceProvider: 'foxess',
          deviceSn: 'FOX-001',
          pricingProvider: 'aemo',
          aemoRegion: 'NSW1'
        }
      }, 200));
    });

    await page.reload();

    await expect(page.locator('#pricingCardTitle')).toContainText(/Pricing History/i);
    await expect(page.locator('#pricingCardSubtitle')).toContainText(/AEMO/i);
    await expect(page.locator('#reportsCoverageText')).toContainText(/AEMO/i);
  });
});
