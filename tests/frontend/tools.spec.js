const { test, expect } = require('@playwright/test');

test.describe('Public Tools', () => {
  test('homepage tools section exposes four live tools', async ({ page }) => {
    await page.goto('/index.html');

    await expect(page.locator('#tools .tool-card__cta[href="/battery-roi-calculator.html"]')).toHaveCount(1);
    await expect(page.locator('#tools .tool-card__cta[href="/battery-wear-estimator.html"]')).toHaveCount(1);
    await expect(page.locator('#tools .tool-card__cta[href="/market-insights/"]')).toHaveCount(1);
    await expect(page.locator('#tools .tool-card__cta[href="/rule-template-recommender/"]')).toHaveCount(1);
    await expect(page.locator('#tools .tool-card__badge--live')).toHaveCount(4);
    await expect(page.locator('#tools .tool-card')).toHaveCount(4);
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

  test('battery wear estimator switches scenarios and recomputes break-even results', async ({ page }) => {
    await page.goto('/battery-wear-estimator.html');

    const threshold = page.locator('#breakEvenThreshold');
    const initialThreshold = await threshold.textContent();

    await page.locator('#replacementValue').fill('12000');
    await page.locator('#lifetimeThroughputKwh').fill('28000');
    await page.locator('#arbitrageChargePriceCents').fill('6');
    await page.locator('#arbitrageLaterValueCents').fill('38');

    await expect(threshold).not.toHaveText(initialThreshold || '');
    await expect(page.locator('#wearCostPerCycle')).not.toHaveText('$0');
    await expect(page.locator('#verdictBody')).toContainText('spread');

    await page.getByRole('button', { name: 'Self-use vs export' }).click();
    await page.locator('#selfUseExportNowCents').fill('4');
    await page.locator('#selfUseAvoidedImportCents').fill('36');

    await expect(page.locator('#breakEvenThresholdSub')).toContainText('self-use versus export');
    await expect(page.locator('#verdictBody')).toContainText('storing solar');
  });

  test('rule template recommender produces an explainable starter pack and import handoff', async ({ page }) => {
    await page.goto('/rule-template-recommender/');

    await page.getByRole('button', { name: 'Earn more from exports' }).click();
    await page.getByRole('button', { name: 'Frequent export spikes' }).click();
    await page.locator('.rtr-question[data-question="behavior"] .rtr-option[data-value="aggressive"]').click();
    await page.getByRole('button', { name: 'Small reserve' }).click();
    await page.getByRole('button', { name: 'Tesla connected' }).click();
    await page.getByRole('button', { name: 'Intermediate' }).click();

    await expect(page.locator('#recommendationName')).toContainText('Export First');
    await expect(page.locator('#recommendationWhy')).toContainText('Amber');
    await expect(page.locator('#templateCardGrid')).toContainText('High Feed-in Export');
    await expect(page.locator('#templateCardGrid .rtr-rule-card')).toHaveCount(5);
    await expect(page.locator('#importStarterPackLink')).toHaveAttribute('href', /\/rules-library\.html\?recommend=/);

    await page.getByRole('button', { name: 'Show safer option' }).click();
    await expect(page.locator('#recommendationVariantLabel')).toContainText('safer');
  });
});
