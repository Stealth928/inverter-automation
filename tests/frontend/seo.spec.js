const { test, expect } = require('@playwright/test');

test.describe('SEO Metadata', () => {
  test('landing page exposes canonical, social, and structured data tags', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page).toHaveTitle(/SoCrates.+Solar Battery Automation.+Live Pricing/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Rule-based solar battery automation for homes with live pricing, weather-aware rules, and Tesla EV integration. Free for the first 500 members.');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_AU');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /SoCrates.+Solar Battery Automation.+Live Pricing/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', 'Rule-based solar battery automation for homes. Automate charging, exporting, and EV charging around live pricing, tariffs, weather, and demand.');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://socratesautomation.com/images/screenshots/screen-1.png');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '3832');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '1516');
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', 'SoCrates dashboard showing live pricing, automation status, and battery state');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', /SoCrates.+Solar Battery Automation.+Live Pricing/);
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute('content', 'Rule-based solar battery automation for homes. Automate charging, exporting, and EV charging around live pricing, tariffs, weather, and demand.');
    await expect(page.locator('meta[name="twitter:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/');
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', 'SoCrates dashboard showing live pricing, automation status, and battery state');

    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    const ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "WebSite"');
    expect(ldJsonText).toContain('"@type": "Organization"');
    expect(ldJsonText).toContain('"@type": "WebPage"');
    expect(ldJsonText).toContain('"@type": "SoftwareApplication"');
    expect(ldJsonText).toContain('"@type": "FAQPage"');
    expect(ldJsonText).toContain('Live Pricing');
    expect(ldJsonText).toContain('AEMO live regional prices');
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

  test('landing page highlights the AEMO live prices rollout in copy and structured answers', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('.brand-strip')).toContainText('Live Pricing');
    await expect(page.locator('.brand-strip')).toContainText('Amber Electric');

    const pricingFaq = page.locator('.faq-item', {
      has: page.locator('summary', { hasText: 'Which electricity retailers / price feeds are supported?' })
    });
    await expect(pricingFaq).toContainText('AEMO live regional prices');
    await expect(pricingFaq).toContainText('Amber Electric');
    await expect(pricingFaq).toContainText('NSW, QLD, SA, TAS, and VIC');

    const structuredData = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(structuredData).toContain('AEMO live regional prices are now supported across NSW, QLD, SA, TAS, and VIC.');
    expect(structuredData).toContain('Amber Electric remains supported for customer-specific live and forecast pricing.');
  });

  test('landing page shows FoxESS and AlphaESS as supported today', async ({ page }) => {
    await page.goto('/index.html');

    const inverterFaq = page.locator('.faq-item', {
      has: page.locator('summary', { hasText: 'Which inverter brands are supported?' })
    });
    await expect(inverterFaq).toContainText('FoxESS');
    await expect(inverterFaq).toContainText('AlphaESS');
    await expect(inverterFaq).toContainText('are fully supported today');

    const structuredData = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(structuredData).toContain('FoxESS and AlphaESS are fully supported today.');
  });

  test('landing page describes automation cadence as configurable', async ({ page }) => {
    await page.goto('/index.html');

    const automationFeature = page.locator('.feature-card', {
      has: page.locator('h3', { hasText: 'Automation Engine' })
    });
    await expect(automationFeature).toContainText('cloud cadence you choose');

    const automationFaq = page.locator('.faq-item', {
      has: page.locator('summary', { hasText: 'How does automation work' })
    });
    await expect(automationFaq).toContainText('configurable cloud scheduler');
    await expect(automationFaq).toContainText('cadence you set');

    const structuredData = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(structuredData).toContain('configurable cloud scheduler that evaluates your rules in priority order on the cadence you set');
  });

  test('landing page links to the dedicated market insights preview from the tools section', async ({ page }) => {
    await page.goto('/index.html');

    const marketTool = page.locator('.tool-card', { has: page.locator('h3', { hasText: 'Market Snapshot' }) });
    await expect(marketTool).toHaveCount(1);
    await expect(marketTool.locator('a[href="/market-insights/"]')).toHaveCount(1);
    await expect(marketTool).toContainText('Same live pricing context now available inside SoCrates.');
  });

  test('landing page links to the battery wear estimator from the tools section', async ({ page }) => {
    await page.goto('/index.html');

    const wearTool = page.locator('.tool-card', { has: page.locator('h3', { hasText: 'Battery Wear Estimator' }) });
    await expect(wearTool).toHaveCount(1);
    await expect(wearTool.locator('a[href="/battery-wear-estimator.html"]')).toHaveCount(1);
    await expect(wearTool).toContainText('No fake battery health claims');
  });

  test('landing page links to the rule template recommender from the tools section', async ({ page }) => {
    await page.goto('/index.html');

    const recommenderTool = page.locator('.tool-card', { has: page.locator('h3', { hasText: 'Rule Template Recommender' }) });
    await expect(recommenderTool).toHaveCount(1);
    await expect(recommenderTool.locator('a[href="/rule-template-recommender/"]')).toHaveCount(1);
    await expect(recommenderTool).toContainText('Import stays in the authenticated rules library');
  });

  test('public market insights preview is crawlable and loads live market data', async ({ page }) => {
    await page.goto('/market-insights/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/market-insights/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/market-insights/');
    await expect(page.locator('script[src="/js/marketing-analytics.js"]')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('region worth chasing');

    await expect(page.locator('#previewFreshness')).not.toContainText('Loading market data', { timeout: 10000 });
    await expect(page.locator('#previewAvgPrice')).not.toHaveText('--');
    await expect(page.locator('#previewPeakPrice')).not.toHaveText('--');
    await expect(page.locator('#previewNegative')).not.toHaveText('--');
    await expect(page.locator('#previewVolatility')).not.toHaveText('--');
    await expect(page.locator('#previewRegionCards .mip-region-pick')).toHaveCount(5, { timeout: 10000 });

    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    const ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "Dataset"');
    expect(ldJsonText).toContain('"@type": "FAQPage"');
    expect(ldJsonText).toContain('Market Insights Preview');
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

  test('public battery wear estimator is crawlable and instrumented', async ({ page }) => {
    await page.goto('/battery-wear-estimator.html');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/battery-wear-estimator.html');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_AU');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/battery-wear-estimator.html');
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '2088');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '1201');
    await expect(page.locator('meta[name="twitter:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/battery-wear-estimator.html');
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveAttribute('content', 'SoCrates battery wear estimator workbench');
    await expect(page.locator('script[src="/js/marketing-analytics.js"]')).toHaveCount(1);

    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    const ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('Battery Wear Estimator');
    expect(ldJsonText).toContain('WebApplication');
    expect(ldJsonText).toContain('FAQPage');

    await expect(page.locator('#estimator-faq .faq-item')).toHaveCount(4);
  });

  test('rule template recommender is crawlable, instrumented, and maps into the rules library', async ({ page }) => {
    await page.goto('/rule-template-recommender/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/rule-template-recommender/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/rule-template-recommender/');
    await expect(page.locator('script[src="/js/marketing-analytics.js"]')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('Rule Template Recommender');

    const structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    const ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('Rule Template Recommender');
    expect(ldJsonText).toContain('WebApplication');
    expect(ldJsonText).toContain('FAQPage');

    await expect(page.locator('#questionRail .rtr-question')).toHaveCount(7);
    await expect(page.locator('#guardrailList li')).toHaveCount(6);
    await expect(page.locator('#templateCardGrid .rtr-rule-card')).toHaveCount(4);
    await expect(page.locator('#importStarterPackLink')).toHaveAttribute('href', /\/rules-library\.html\?recommend=/);
  });

  test('blog index and posts are crawlable with structured metadata', async ({ page }) => {
    await page.goto('/blog/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/blog/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://socratesautomation.com/blog/');
    await expect(page.locator('h1')).toContainText('SoCrates blog');

    let structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    let ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "CollectionPage"');
    expect(ldJsonText).toContain('"@type": "ItemList"');
    expect(ldJsonText).toContain('Amber SmartShift vs SoCrates: Keep Amber Pricing, Replace the Black Box');
    expect(ldJsonText).toContain('Home Battery Automation Options Compared: Manual Schedules, Home Assistant, Modbus and Managed Platforms');
    expect(ldJsonText).toContain('Battery Automation ROI: What Smarter Rules Actually Look Like');

    await page.goto('/amber-smartshift-vs-socrates/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/amber-smartshift-vs-socrates/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.locator('meta[property="article:published_time"]')).toHaveAttribute('content', '2026-03-28');
    await expect(page.locator('article h1')).toContainText('Amber SmartShift vs SoCrates: Keep Amber Pricing, Replace the Black Box');

    structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "BlogPosting"');
    expect(ldJsonText).toContain('"@type": "BreadcrumbList"');
    expect(ldJsonText).toContain('"@type": "FAQPage"');
    expect(ldJsonText).toContain('"datePublished": "2026-03-28"');

    await page.goto('/home-battery-automation-options-compared/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/home-battery-automation-options-compared/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.locator('meta[property="article:published_time"]')).toHaveAttribute('content', '2026-03-22');
    await expect(page.locator('article h1')).toContainText('Home Battery Automation Options Compared: Manual Schedules, Home Assistant, Modbus and Managed Platforms');

    structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "BlogPosting"');
    expect(ldJsonText).toContain('"@type": "BreadcrumbList"');
    expect(ldJsonText).toContain('"@type": "FAQPage"');
    expect(ldJsonText).toContain('"datePublished": "2026-03-22"');

    await page.goto('/battery-automation-roi-examples/');

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://socratesautomation.com/battery-automation-roi-examples/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.locator('meta[property="article:published_time"]')).toHaveAttribute('content', '2026-03-22');
    await expect(page.locator('article h1')).toContainText('Battery Automation ROI: What Smarter Rules Actually Look Like');

    structuredData = page.locator('script[type="application/ld+json"]');
    await expect(structuredData).toHaveCount(1);
    ldJsonText = await structuredData.first().textContent();
    expect(ldJsonText).toContain('"@type": "BlogPosting"');
    expect(ldJsonText).toContain('"@type": "BreadcrumbList"');
    expect(ldJsonText).toContain('"@type": "FAQPage"');
    expect(ldJsonText).toContain('"datePublished": "2026-03-22"');
  });

  test('robots and sitemap expose only public crawl targets', async ({ request }) => {
    const robotsResponse = await request.get('/robots.txt');
    expect(robotsResponse.ok()).toBeTruthy();
    const robotsText = await robotsResponse.text();
    expect(robotsText).toContain('Allow: /');
    expect(robotsText).toContain('Disallow: /api/');
    expect(robotsText).toContain('llms.txt');
    expect(robotsText).toContain('Sitemap: https://socratesautomation.com/sitemap.xml');

    const sitemapResponse = await request.get('/sitemap.xml');
    expect(sitemapResponse.ok()).toBeTruthy();
    const sitemapText = await sitemapResponse.text();
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/blog/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/amber-smartshift-vs-socrates/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/battery-automation-roi-examples/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/home-battery-automation-options-compared/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/battery-roi-calculator.html</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/battery-wear-estimator.html</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/market-insights/</loc>');
    expect(sitemapText).toContain('<loc>https://socratesautomation.com/rule-template-recommender/</loc>');
    expect(sitemapText).not.toContain('<loc>https://socratesautomation.com/market-insights.html</loc>');
    expect(sitemapText).not.toContain('/login.html');
    expect(sitemapText).not.toContain('/app.html');
  });

  test('llms discovery files summarise public content for answer engines', async ({ request }) => {
    const llmsResponse = await request.get('/llms.txt');
    expect(llmsResponse.ok()).toBeTruthy();
    const llmsText = await llmsResponse.text();
    expect(llmsText).toContain('SoCrates');
    expect(llmsText).toContain('/battery-wear-estimator.html');
    expect(llmsText).toContain('/market-insights/');
    expect(llmsText).toContain('/rule-template-recommender/');
    expect(llmsText).toContain('/amber-smartshift-vs-socrates/');
    expect(llmsText).not.toContain('/market-insights.html');
    expect(llmsText).toContain('/llms-full.txt');

    const llmsFullResponse = await request.get('/llms-full.txt');
    expect(llmsFullResponse.ok()).toBeTruthy();
    const llmsFullText = await llmsFullResponse.text();
    expect(llmsFullText).toContain('battery-roi-calculator.html');
    expect(llmsFullText).toContain('battery-wear-estimator.html');
    expect(llmsFullText).toContain('/market-insights/');
    expect(llmsFullText).toContain('/rule-template-recommender/');
    expect(llmsFullText).toContain('amber-smartshift-vs-socrates');
    expect(llmsFullText).toContain('home-battery-automation-options-compared');
    expect(llmsFullText).toContain('Do not rely on authenticated pages');
    expect(llmsFullText).toContain('full Market Insights application view remains behind login');
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
      '/market-insights.html',
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
