const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

function makeDailyRow(date, meanRRP, maxRRP) {
  const period = Number(date.slice(0, 7).replace('-', ''));
  const minRRP = Math.max(meanRRP - 25, -50);
  return {
    region: 'NSW',
    period,
    date,
    rowCount: 48,
    meanRRP,
    minRRP,
    maxRRP,
    p05RRP: minRRP + 5,
    p25RRP: meanRRP - 8,
    p50RRP: meanRRP - 2,
    p75RRP: meanRRP + 6,
    p90RRP: meanRRP + 12,
    p95RRP: meanRRP + 18,
    meanDemand: 8200,
    minDemand: 7600,
    maxDemand: 8900,
    negativeRRPCount: meanRRP < 0 ? 2 : 0,
    stdRRP: 18,
    volatilityRRP: maxRRP - minRRP,
    expectedRowCount: 48,
    missingRowCount: 0,
    coveragePct: 100,
    qualityScore: 100,
    hourCount: 24,
    hourCoveragePct: 100,
    peakHour: 18,
    peakHourRRP: maxRRP,
    offPeakMeanRRP: meanRRP - 4,
    hoursAboveP95: 1
  };
}

function buildExactThirtyDayFixture() {
  const daily = [];
  const start = new Date('2026-02-01T00:00:00Z');
  const end = new Date('2026-03-18T00:00:00Z');
  let idx = 0;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1), idx += 1) {
    const date = d.toISOString().slice(0, 10);
    const inTrueThirtyDayWindow = date >= '2026-02-17';
    const meanRRP = inTrueThirtyDayWindow
      ? 40 + ((idx - 16) * 2.4)
      : 155 - (idx * 5.5);
    const maxRRP = idx < 4 ? 1200 + (idx * 150) : meanRRP + 55;
    daily.push(makeDailyRow(date, Number(meanRRP.toFixed(2)), Number(maxRRP.toFixed(2))));
  }

  const monthly = [
    {
      region: 'NSW',
      period: 202602,
      meanRRP: 91.4,
      minRRP: -10,
      maxRRP: 1650,
      p50RRP: 82.5,
      p95RRP: 210,
      negativeRRPCount: 8,
      rowCount: 28,
      volatilityRRP: 1660,
      highRRPEventCount: 4
    },
    {
      region: 'NSW',
      period: 202603,
      meanRRP: 76.8,
      minRRP: 12,
      maxRRP: 170,
      p50RRP: 74.3,
      p95RRP: 128,
      negativeRRPCount: 0,
      rowCount: 18,
      volatilityRRP: 158,
      highRRPEventCount: 0
    }
  ];

  return {
    index: {
      generatedAt: '2026-03-18T12:43:13.761Z',
      sourceGeneratedAt: '2026-03-18T11:52:19.072Z',
      regions: ['NSW'],
      files: { NSW: '/data/aemo-market-insights/NSW.json' },
      defaults: {
        regions: ['NSW'],
        granularity: 'daily',
        preset: '30d',
        qualityScoreMin: 0,
        thresholdQuantile: 95
      },
      bounds: {
        minDate: '2026-02-01',
        maxDate: '2026-03-18',
        minPeriod: 202602,
        maxPeriod: 202603
      },
      counts: { daily: daily.length, monthly: monthly.length }
    },
    region: {
      region: 'NSW',
      generatedAt: '2026-03-18T12:43:13.697Z',
      sourceGeneratedAt: '2026-03-18T11:52:19.072Z',
      latestDate: '2026-03-18',
      latestPeriod: 202603,
      daily,
      monthly
    }
  };
}

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

  test('30 day preset uses the exact daily window and keeps the summary aligned with the chart', async ({ page }) => {
    const fixture = buildExactThirtyDayFixture();

    await page.route('**/data/aemo-market-insights/index.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture.index)
      });
    });

    await page.route('**/data/aemo-market-insights/NSW.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture.region)
      });
    });

    await page.goto('/market-insights.html');

    const hits = page.locator('#trendChart .hit-target');
    await expect(hits).toHaveCount(30);

    await hits.first().hover();
    await expect(page.locator('#trendChart .mi-tooltip.is-visible')).toContainText('17-02-2026');

    await hits.last().hover();
    await expect(page.locator('#trendChart .mi-tooltip.is-visible')).toContainText('18-03-2026');

    const summary = page.locator('#summaryBanner .mi-summary__text');
    await expect(summary).toContainText('last 30 days');
    await expect(summary).toContainText('No days exceeded the $300/MWh spike threshold');
    await expect(summary).toContainText(/finished higher/i);
    await expect(summary).not.toContainText(/1200\.00|1350\.00|1500\.00|1650\.00/);
  });
});
