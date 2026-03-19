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

  test('renders dates as dd-mm-yyyy across daily and monthly views', async ({ page }) => {
    const ddmmyyyy = /\b\d{2}-\d{2}-\d{4}\b/;
    await page.goto('/market-insights.html');

    await expect(page.locator('#freshnessBadge')).toContainText(/Updated \d{2}-\d{2}-\d{4}/);

    const firstTrendHit = page.locator('#trendChart .hit-target').first();
    await expect(firstTrendHit).toBeVisible();
    await firstTrendHit.hover();
    await expect(page.locator('#trendChart .mi-tooltip.is-visible')).toContainText(ddmmyyyy);

    const firstTile = page.locator('#heatmap .mi-heat').first();
    await expect(firstTile).toBeVisible();
    const firstTileTitle = await firstTile.getAttribute('title');
    expect(firstTileTitle || '').toMatch(ddmmyyyy);

    await firstTile.click();
    await expect(page.locator('#detailPane')).toContainText(ddmmyyyy);
    await expect(page.locator('#rankingList .mi-rank-row').first()).toContainText(ddmmyyyy);

    await page.locator('#granToggle [data-value="monthly"]').click();
    await expect(page.locator('#granToggle [data-value="monthly"]')).toHaveClass(/is-active/);

    const monthlyAxisHasDate = await page.evaluate(() => {
      const root = document.querySelector('#monthlyChart');
      if (!root) return false;
      const rx = /\b\d{2}-\d{2}-\d{4}\b/;
      return Array.from(root.querySelectorAll('svg text')).some((n) => rx.test((n.textContent || '').trim()));
    });
    expect(monthlyAxisHasDate).toBe(true);

    const firstMonthlyBar = page.locator('#monthlyChart .mi-bar-hit').first();
    await expect(firstMonthlyBar).toBeVisible();
    await firstMonthlyBar.hover();
    await expect(page.locator('#monthlyTooltip.is-visible')).toContainText(ddmmyyyy);
  });

  test('keeps trend chart compact and tooltip inside bounds on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/market-insights.html');

    const trendChart = page.locator('#trendChart');
    const trendSvg = page.locator('#trendChart svg');
    await expect(trendChart).toBeVisible();
    await expect(trendSvg).toBeVisible();
    await expect(page.locator('#trendChart .hit-target').first()).toBeVisible();

    const chartBox = await trendChart.boundingBox();
    const svgBox = await trendSvg.boundingBox();
    expect(chartBox).not.toBeNull();
    expect(svgBox).not.toBeNull();
    expect(svgBox.height / chartBox.height).toBeGreaterThan(0.9);

    await page.locator('#trendChart .hit-target').last().hover();
    const tooltip = page.locator('#trendChart .mi-tooltip.is-visible');
    await expect(tooltip).toBeVisible();

    const relativeBounds = await page.evaluate(() => {
      const chart = document.querySelector('#trendChart');
      const tip = chart?.querySelector('.mi-tooltip.is-visible');
      if (!chart || !tip) return null;
      const c = chart.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      return {
        left: t.left - c.left,
        top: t.top - c.top,
        right: c.right - t.right,
        bottom: c.bottom - t.bottom
      };
    });
    expect(relativeBounds).not.toBeNull();
    expect(relativeBounds.left).toBeGreaterThanOrEqual(-0.5);
    expect(relativeBounds.top).toBeGreaterThanOrEqual(-0.5);
    expect(relativeBounds.right).toBeGreaterThanOrEqual(-0.5);
    expect(relativeBounds.bottom).toBeGreaterThanOrEqual(-0.5);
  });

  test('keeps the price range KPI inside its card on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/market-insights.html');

    const rangeLines = page.locator('#kpiRange .mi-kpi__range-line');
    await expect(rangeLines).toHaveCount(2);
    await expect(rangeLines.first()).toBeVisible();

    const overflow = await page.evaluate(() => {
      const value = document.getElementById('kpiRange');
      if (!value) return null;
      return Array.from(value.querySelectorAll('.mi-kpi__range-line')).map((line) => ({
        scrollWidth: line.scrollWidth,
        clientWidth: line.clientWidth
      }));
    });

    expect(overflow).not.toBeNull();
    overflow.forEach((line) => {
      expect(line.scrollWidth - line.clientWidth).toBeLessThanOrEqual(1);
    });
  });
});
