const { test, expect, devices } = require('@playwright/test');

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

  test('homepage inverter preview stays within the mobile status card and sets sky state', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone SE'] });
    const page = await context.newPage();

    await page.goto('/index.html');
    await expect(page.locator('#heroEnergyScene')).toBeVisible();

    const layout = await page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      };
      const card = document.querySelector('.product-card--status');
      const scene = document.querySelector('#heroEnergyScene');
      const nodes = [
        document.querySelector('#heroSolarNode'),
        document.querySelector('#heroGridNode'),
        document.querySelector('#heroHomeNode'),
        document.querySelector('#heroHub')
      ].map((node) => rect(node));

      return {
        viewportWidth: window.innerWidth,
        card: rect(card),
        scene: rect(scene),
        nodes,
        phase: scene.getAttribute('data-sky-phase'),
        orbX: getComputedStyle(scene).getPropertyValue('--scene-orb-x').trim()
      };
    });

    expect(layout.scene.width).toBeLessThanOrEqual(layout.card.width);
    expect(layout.scene.right).toBeLessThanOrEqual(layout.card.right + 1);
    expect(layout.scene.right).toBeLessThanOrEqual(layout.viewportWidth);
    layout.nodes.forEach((nodeRect) => {
      expect(nodeRect.left).toBeGreaterThanOrEqual(layout.scene.left - 1);
      expect(nodeRect.right).toBeLessThanOrEqual(layout.scene.right + 1);
      expect(nodeRect.top).toBeGreaterThanOrEqual(layout.scene.top - 1);
      expect(nodeRect.bottom).toBeLessThanOrEqual(layout.scene.bottom + 1);
    });
    expect(['day', 'night']).toContain(layout.phase);
    expect(layout.orbX).not.toBe('');

    await context.close();
  });

  test('shared sky helper keeps the orb on a top track and peaks at mid-cycle', async ({ page }) => {
    await page.goto('/index.html');

    const samples = await page.evaluate(() => {
      const getState = window.SoCratesSceneSky.getState;
      const baseWindow = { sunrise: '06:00', sunset: '18:00' };

      return {
        dawn: getState({ ...baseWindow, currentTime: '06:00' }),
        noon: getState({ ...baseWindow, currentTime: '12:00' }),
        dusk: getState({ ...baseWindow, currentTime: '17:30' }),
        evening: getState({ ...baseWindow, currentTime: '18:30' }),
        midnight: getState({ ...baseWindow, currentTime: '00:00' }),
        predawn: getState({ ...baseWindow, currentTime: '05:30' })
      };
    });

    expect(samples.dawn.phase).toBe('day');
    expect(samples.noon.phase).toBe('day');
    expect(samples.midnight.phase).toBe('night');

    expect(samples.dawn.orbX).toBeGreaterThan(samples.noon.orbX);
    expect(samples.noon.orbX).toBeGreaterThan(samples.dusk.orbX);
    expect(samples.evening.orbX).toBeGreaterThan(samples.midnight.orbX);
    expect(samples.midnight.orbX).toBeGreaterThan(samples.predawn.orbX);

    expect(samples.dawn.orbY).toBeCloseTo(samples.noon.orbY, 3);
    expect(samples.noon.orbY).toBeCloseTo(samples.dusk.orbY, 3);
    expect(samples.evening.orbY).toBeCloseTo(samples.midnight.orbY, 3);
    expect(samples.midnight.orbY).toBeCloseTo(samples.predawn.orbY, 3);
    expect(samples.noon.orbY).toBeLessThan(14);
    expect(samples.midnight.orbY).toBeLessThan(14);

    expect(samples.noon.orbSize).toBeGreaterThan(samples.dawn.orbSize);
    expect(samples.noon.orbSize).toBeGreaterThan(samples.dusk.orbSize);
    expect(samples.midnight.orbSize).toBeGreaterThan(samples.evening.orbSize);
    expect(samples.midnight.orbSize).toBeGreaterThan(samples.predawn.orbSize);

    expect(samples.dawn.dayGlowOpacity).toBeLessThan(samples.noon.dayGlowOpacity);
    expect(samples.dawn.starsOpacity).toBe(0);
    expect(samples.midnight.starsOpacity).toBeGreaterThan(samples.evening.starsOpacity);
  });

  test('shared sky helper attenuates the sky under bad weather', async ({ page }) => {
    await page.goto('/index.html');

    const samples = await page.evaluate(() => {
      const getState = window.SoCratesSceneSky.getState;
      const dayBase = { sunrise: '06:00', sunset: '18:00', currentTime: '12:00' };
      const nightBase = { sunrise: '06:00', sunset: '18:00', currentTime: '00:00' };

      return {
        clearDay: getState({ ...dayBase, weatherEffect: 'clear' }),
        cloudyDay: getState({ ...dayBase, weatherEffect: 'cloudy' }),
        drizzleDay: getState({ ...dayBase, weatherEffect: 'drizzle' }),
        rainDay: getState({ ...dayBase, weatherEffect: 'rain' }),
        snowDay: getState({ ...dayBase, weatherEffect: 'snow' }),
        stormDay: getState({ ...dayBase, weatherEffect: 'storm' }),
        clearNight: getState({ ...nightBase, weatherEffect: 'clear' }),
        fogNight: getState({ ...nightBase, weatherEffect: 'fog' }),
        stormNight: getState({ ...nightBase, weatherEffect: 'storm' })
      };
    });

    expect(samples.cloudyDay.orbOpacity).toBeLessThan(samples.clearDay.orbOpacity);
    expect(samples.drizzleDay.orbOpacity).toBeLessThan(samples.clearDay.orbOpacity);
    expect(samples.rainDay.orbOpacity).toBeLessThan(samples.drizzleDay.orbOpacity);
    expect(samples.snowDay.orbOpacity).toBeLessThan(samples.clearDay.orbOpacity);
    expect(samples.stormDay.orbOpacity).toBeLessThan(samples.cloudyDay.orbOpacity);
    expect(samples.cloudyDay.dayGlowOpacity).toBeLessThan(samples.clearDay.dayGlowOpacity);
    expect(samples.drizzleDay.dayGlowOpacity).toBeLessThan(samples.cloudyDay.dayGlowOpacity);
    expect(samples.rainDay.dayGlowOpacity).toBeLessThan(samples.drizzleDay.dayGlowOpacity);
    expect(samples.snowDay.dayGlowOpacity).toBeLessThan(samples.clearDay.dayGlowOpacity);
    expect(samples.stormDay.dayGlowOpacity).toBeLessThan(samples.cloudyDay.dayGlowOpacity);
    expect(samples.cloudyDay.orbBlur).toBeGreaterThan(samples.clearDay.orbBlur);
    expect(samples.drizzleDay.orbBlur).toBeGreaterThan(samples.cloudyDay.orbBlur);
    expect(samples.rainDay.orbBlur).toBeGreaterThan(samples.drizzleDay.orbBlur);
    expect(samples.snowDay.orbBlur).toBeGreaterThan(samples.clearDay.orbBlur);
    expect(samples.stormDay.orbBlur).toBeGreaterThan(samples.cloudyDay.orbBlur);

    expect(samples.fogNight.starsOpacity).toBeLessThan(samples.clearNight.starsOpacity);
    expect(samples.stormNight.starsOpacity).toBeLessThan(samples.fogNight.starsOpacity);
    expect(samples.fogNight.orbOpacity).toBeLessThan(samples.clearNight.orbOpacity);
    expect(samples.stormNight.orbOpacity).toBeLessThan(samples.fogNight.orbOpacity);
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
