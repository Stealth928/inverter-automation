const { test, expect } = require('@playwright/test');

async function readPricePair(page) {
  return page.evaluate(() => ({
    buy: parseFloat((document.getElementById('heroPrice')?.textContent || '').replace(/[^\d.-]/g, '')),
    feedIn: parseFloat((document.getElementById('heroFeedInPrice')?.textContent || '').replace(/[^\d.-]/g, ''))
  }));
}

test.describe('Landing Hero Cohesion', () => {
  test('keeps pricing, inverter, weather, and forecast states believable across the demo timeline', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => Boolean(window.__heroDemo));

    const timeline = await page.evaluate(() => window.__heroDemo.getTimeline());
    expect(timeline.length).toBeGreaterThanOrEqual(12);

    timeline.forEach((state) => {
      expect(state.buyPrice).toBeGreaterThanOrEqual(state.feedInPrice);
      if (state.weatherSolarWm2 === 0) {
        expect(state.solarKw).toBeLessThanOrEqual(0.05);
      }
      if (state.ruleAction === 'export') {
        expect(state.batteryMode).toBe('discharge');
        expect(state.batteryPowerKw).toBeGreaterThan(0);
      }
    });

    await page.evaluate(() => window.__heroDemo.renderState(0));
    await expect(page.locator('#heroSolarKw')).toHaveText('0.00 kW');
    await expect(page.locator('#heroWeatherPlace')).toContainText('12:00am');
    await expect(page.locator('#heroWeatherSolar')).toContainText('0 W/m²');
    await expect(page.locator('#heroRule')).toContainText('Overnight Solar Planning Charge');
    let prices = await readPricePair(page);
    expect(prices.buy).toBeGreaterThanOrEqual(prices.feedIn);

    await page.evaluate(() => window.__heroDemo.renderState(6));
    await expect(page.locator('#heroSolarKw')).toHaveText('4.40 kW');
    await expect(page.locator('#heroPowerState')).toHaveText('Charging');
    await expect(page.locator('#heroWeatherSolar')).toContainText('612 W/m²');
    await expect(page.locator('#heroWeatherCards')).toContainText('Sunny');
    prices = await readPricePair(page);
    expect(prices.buy).toBeGreaterThanOrEqual(prices.feedIn);

    await page.evaluate(() => window.__heroDemo.renderState(10));
    await expect(page.locator('#heroPowerState')).toHaveText('Exporting');
    await expect(page.locator('#heroGridLabel')).toHaveText('Grid Export');
    await expect(page.locator('#heroWeatherPlace')).toContainText('8:00pm');
    await expect(page.locator('#heroWeatherSolar')).toContainText('0 W/m²');
    await expect(page.locator('#heroPriceForecastRow .is-current strong')).toHaveText('12.6¢');
    prices = await readPricePair(page);
    expect(prices.buy).toBeGreaterThanOrEqual(prices.feedIn);
  });
});
