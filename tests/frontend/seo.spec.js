const { test, expect } = require('@playwright/test');

test.describe('SEO Metadata', () => {
  test('landing page exposes canonical, social, and structured data tags', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
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
    expect(ldJsonText).toContain('"@type": "FAQPage"');
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
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
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
    expect(ldJsonText).toContain('"@type": "BreadcrumbList"');
    expect(ldJsonText).toContain('"@type": "FAQPage"');

    await expect(page.locator('#calculator-faq .faq-item')).toHaveCount(4);
  });

  test('robots and sitemap expose only public crawl targets', async ({ request }) => {
    const robotsResponse = await request.get('/robots.txt');
    expect(robotsResponse.ok()).toBeTruthy();
    const robotsText = await robotsResponse.text();
    expect(robotsText).toContain('Allow: /');
    expect(robotsText).toContain('Disallow: /api/');
    expect(robotsText).toContain('Sitemap: https://socratesautomation.com/sitemap.xml');

    const sitemapResponse = await request.get('/sitemap.xml');
    expect(sitemapResponse.ok()).toBeTruthy();
    const sitemapText = await sitemapResponse.text();
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/battery-roi-calculator.html</loc>');
    expect(sitemapText).not.toContain('/login.html');
    expect(sitemapText).not.toContain('/app.html');
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
      '/reset-password.html',
      '/admin.html',
      '/test.html'
    ];

    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    }
  });

  test('login page exposes explicit auth-page crawler and trust signals', async ({ page }) => {
    await page.goto('/login.html');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/login.html');
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive, max-snippet:0, max-image-preview:none, max-video-preview:0');
    await expect(page.locator('[data-auth-trust-note]')).toContainText('socratesautomation.com');
  });
});
