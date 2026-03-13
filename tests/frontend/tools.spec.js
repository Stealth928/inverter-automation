const { test, expect } = require('@playwright/test');

test.describe('Public Tools', () => {
  test('homepage tools section exposes one live calculator and marks the rest as coming soon', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('#tools .tool-card__cta[href="/battery-roi-calculator.html"]')).toHaveCount(1);
    await expect(page.locator('#tools .tool-card__cta--disabled')).toHaveCount(3);
    await expect(page.locator('#tools .tool-card__badge--live')).toHaveCount(1);
  });

  test('battery ROI calculator recomputes results when the scenario changes', async ({ page }) => {
    await page.goto('/battery-roi-calculator.html');

    const annualValue = page.locator('#annualBatteryValue');
    const initialAnnualValue = await annualValue.textContent();

    await page.locator('#chargeEnergyCostCents').fill('5');
    await page.locator('#dischargeValueCents').fill('42');
    await page.locator('#manualCaptureRate').fill('30');
    await page.locator('#automationCaptureRate').fill('90');
    await page.locator('#batterySystemCost').fill('12000');

    await expect(annualValue).not.toHaveText(initialAnnualValue || '');
    await expect(page.locator('#automationUpliftValue')).not.toHaveText('$0');
    await expect(page.locator('#simplePaybackValue')).toContainText('years');
    await expect(page.locator('#scenarioInsight')).not.toBeEmpty();
  });
});
