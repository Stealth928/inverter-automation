const { test, expect } = require('@playwright/test');

test.describe('SEO Metadata', () => {
  test('landing page exposes canonical, social, and structured data tags', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_AU');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://socratesautomation.com/images/screenshots/screen-1.png');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '3832');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '1516');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('meta[name="twitter:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/');
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', 'SoCrates dashboard showing automation rules and battery status');

    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    const ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "WebSite"');
    expect(ldJsonText).toContain('"@type": "Organization"');
    expect(ldJsonText).toContain('"@type": "WebPage"');
    expect(ldJsonText).toContain('"@type": "SoftwareApplication"');
  });

  test('landing page includes analytics instrumentation for CTA tracking', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('script[src="/js/marketing-analytics.js"]')).toHaveCount(1);

    const trackedCtaCount = await page.locator('[data-analytics-event]').count();
    expect(trackedCtaCount).toBeGreaterThanOrEqual(8);

    const analyticsState = await page.evaluate(() => window.__socratesMarketingAnalytics);
    expect(analyticsState).toBeTruthy();
    expect(typeof analyticsState.measurementId).toBe('string');
  });

  test('public battery ROI calculator is crawlable and instrumented', async ({ page }) => {
    await page.goto('/battery-roi-calculator.html');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/battery-roi-calculator.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_AU');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/battery-roi-calculator.html');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '2088');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '1201');
    await expect(page.locator('meta[name="twitter:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/battery-roi-calculator.html');
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', 'SoCrates battery ROI calculator workbench');
    await expect(page.locator('script[src="/js/marketing-analytics.js"]')).toHaveCount(1);

    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    const ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"WebApplication"');
    expect(ldJsonText).toContain('Battery ROI Calculator');
    expect(ldJsonText).toContain('"@type": "WebPage"');
  });

  test('internal pages are marked noindex', async ({ page }) => {
    const paths = [
      '/login.html',
      '/app.html',
      '/setup.html',
      '/settings.html',
      '/control.html',
      '/history.html',
      '/roi.html',
      '/rules-library.html',
      '/curtailment-discovery.html',
      '/reset-password.html',
      '/admin.html',
      '/test.html'
    ];

    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    }
  });
});
