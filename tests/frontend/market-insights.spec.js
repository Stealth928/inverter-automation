const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test.describe('Market Insights Page', () => {
  test('loads market insights dashboard and renders primary surfaces', async ({ page }) => {
    await page.goto('/market-insights.html');

    await expect(page).toHaveTitle(/Market Insights/i);
    await expect(page.getByRole('heading', { name: /AEMO Market Insights/i })).toBeVisible();
    await expect(page.locator('#freshnessBadge')).toBeVisible();
    await expect(page.locator('.mi-kpi')).toHaveCount(6);
    await expect(page.locator('#trendChart')).toBeVisible();
    await expect(page.locator('#monthlyChart')).toBeVisible();
  });

  test('region chips are interactive', async ({ page }) => {
    await page.goto('/market-insights.html');
    const chips = page.locator('#regionChips .mi-chip');
    await expect(chips).not.toHaveCount(0);
    await expect(chips.first()).toBeVisible();
  });

  test('opens day detail from the heatmap', async ({ page }) => {
    await page.goto('/market-insights.html');
    const firstTile = page.locator('#heatmap .mi-heat').first();
    await firstTile.click();
    await expect(page.locator('#detailPane')).not.toContainText(/Click a tile/i);
  });

  test('navigation pane is present', async ({ page }) => {
    await page.goto('/market-insights.html');
    await expect(page.locator('nav.nav-main')).toBeVisible();
    await expect(page.locator('nav.nav-main .nav-link')).not.toHaveCount(0);
  });
});