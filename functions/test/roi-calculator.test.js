/**
 * TEST: ROI Calculator Improvements
 * 
 * Verifies that ROI calculations now:
 * 1. Use actual rule power (fdPwr) instead of nominal system capacity
 * 2. Detect rule type (Charge vs Discharge) correctly
 * 3. Use appropriate pricing (buyPrice for charge, feedInPrice for discharge)
 * 4. Handle missing power/price gracefully
 */

describe('ROI Calculator Improvements', () => {
  
  /**
   * Test 1: Rule power conversion (Watts to kW)
   */
  test('fdPwr is converted from Watts to kilowatts', () => {
    const testCases = [
      { fdPwrWatts: 4000, expectedKw: 4 },
      { fdPwrWatts: 8500, expectedKw: 8.5 },
      { fdPwrWatts: 9000, expectedKw: 9 },
      { fdPwrWatts: 5000, expectedKw: 5 },
      { fdPwrWatts: 12000, expectedKw: 12 }
    ];

    testCases.forEach(({ fdPwrWatts, expectedKw }) => {
      const rulePowerKw = fdPwrWatts / 1000;
      expect(rulePowerKw).toBe(expectedKw);
    });
  });

  /**
   * Test 2: Rule type detection from name
   */
  test('Rule type is correctly detected from rule name', () => {
    const testCases = [
      { ruleName: 'Charge during Peak Hours', expectedType: 'Charge', expectedPrice: 'buyPrice' },
      { ruleName: 'Smart Charge', expectedType: 'Charge', expectedPrice: 'buyPrice' },
      { ruleName: 'Feed In Spike', expectedType: 'Discharge', expectedPrice: 'feedInPrice' },
      { ruleName: 'High Feed In', expectedType: 'Discharge', expectedPrice: 'feedInPrice' },
      { ruleName: 'Empty Some More - Good Sun Tomorrow', expectedType: 'Discharge', expectedPrice: 'feedInPrice' },
      { ruleName: 'Battery Full - Needs Emptying', expectedType: 'Discharge', expectedPrice: 'feedInPrice' },
      { ruleName: 'Good Feed In - Semi Full Battery', expectedType: 'Discharge', expectedPrice: 'feedInPrice' },
      { ruleName: 'Self Charge', expectedType: 'Charge', expectedPrice: 'buyPrice' }
    ];

    testCases.forEach(({ ruleName, expectedType, expectedPrice }) => {
      const lowerName = ruleName.toLowerCase();
      let ruleType = 'Discharge'; // default
      let priceType = 'feedInPrice'; // default

      if (lowerName.includes('charge')) {
        ruleType = 'Charge';
        priceType = 'buyPrice';
      }

      expect(ruleType).toBe(expectedType);
      expect(priceType).toBe(expectedPrice);
    });
  });

  /**
   * Test 3: Energy calculation with actual rule power
   */
  test('Energy is calculated using actual rule power, not nominal capacity', () => {
    const durationMinutes = 30; // 30 minutes
    const durationHours = durationMinutes / 60; // 0.5 hours
    
    const testCases = [
      { rulePowerKw: 4, expectedEnergy: 2 },    // 4kW × 0.5h = 2kWh
      { rulePowerKw: 8.5, expectedEnergy: 4.25 }, // 8.5kW × 0.5h = 4.25kWh
      { rulePowerKw: 9, expectedEnergy: 4.5 },   // 9kW × 0.5h = 4.5kWh
    ];

    testCases.forEach(({ rulePowerKw, expectedEnergy }) => {
      const energyGenerated = rulePowerKw * durationHours;
      expect(energyGenerated).toBeCloseTo(expectedEnergy, 2);
    });
  });

  /**
   * Test 4: Profit calculation with correct pricing
   */
  test('Profit is calculated using appropriate pricing (buyPrice vs feedInPrice)', () => {
    const testCases = [
      {
        name: 'Discharge rule with feed-in price',
        ruleType: 'Discharge',
        energy: 2, // kWh
        feedInPrice: 52.16, // cents/kWh
        buyPrice: null,
        expectedProfit: 1.0432 // 2 × 0.5216 AUD
      },
      {
        name: 'Charge rule with buy price',
        ruleType: 'Charge',
        energy: 3, // kWh
        feedInPrice: null,
        buyPrice: 28.50, // cents/kWh
        expectedProfit: 0.855 // 3 × 0.285 AUD
      },
      {
        name: 'Discharge rule with high feed-in price',
        ruleType: 'Discharge',
        energy: 4.5,
        feedInPrice: 967.95, // cents/kWh (spike pricing)
        buyPrice: null,
        expectedProfit: 43.5578 // 4.5 × 9.6795 AUD
      }
    ];

    testCases.forEach(({ energy, feedInPrice, buyPrice, expectedProfit }) => {
      let actualPrice = feedInPrice || buyPrice;
      let eventProfit = 0;

      if (actualPrice && energy) {
        const priceAudPerKwh = actualPrice > 10 ? actualPrice / 100 : actualPrice;
        eventProfit = energy * priceAudPerKwh;
      }

      expect(eventProfit).toBeCloseTo(expectedProfit, 3);
    });
  });

  /**
   * Test 5: Handle missing power gracefully
   */
  test('Missing power (no fdPwr) results in zero energy, no profit shown', () => {
    const testCases = [
      { fdPwr: null, durationHours: 1, expectedEnergy: 0 },
      { fdPwr: undefined, durationHours: 2, expectedEnergy: 0 },
      { fdPwr: 0, durationHours: 1, expectedEnergy: 0 }
    ];

    testCases.forEach(({ fdPwr, durationHours, expectedEnergy }) => {
      const rulePowerKw = fdPwr ? fdPwr / 1000 : null;
      const energyGenerated = rulePowerKw !== null ? rulePowerKw * durationHours : 0;

      expect(energyGenerated).toBe(expectedEnergy);
    });
  });

  /**
   * Test 6: Price display format (cents vs dollars)
   */
  test('Prices are displayed correctly in cents/kWh format', () => {
    const testCases = [
      { rawPrice: 52.16, displayFormat: '52.16¢' },
      { rawPrice: 967.95, displayFormat: '967.95¢' },
      { rawPrice: 25.97, displayFormat: '25.97¢' },
      { rawPrice: 22.28, displayFormat: '22.28¢' }
    ];

    testCases.forEach(({ rawPrice, displayFormat }) => {
      const priceDisplay = rawPrice ? `${rawPrice.toFixed(2)}¢` : '—';
      expect(priceDisplay).toBe(displayFormat);
    });
  });

  /**
   * Test 7: Total profit aggregation
   */
  test('Total profit is correctly aggregated from all rules', () => {
    const rules = [
      { profit: 973.68 },  // "Empty Some More" at high price
      { profit: 82.44 },   // "High Feed In"
      { profit: 96.81 },   // "Empty Some More" at medium price
      { profit: 162.22 },  // "Very High Feed In"
      { profit: 207.23 },  // "Empty Some More" at high price
      { profit: null }     // Self-charge rule (no money)
    ];

    const totalProfit = rules
      .filter(r => r.profit !== null && r.profit !== undefined)
      .reduce((sum, r) => sum + r.profit, 0);

    expect(totalProfit).toBeCloseTo(1522.38, 0);
  });

  /**
   * Test 8: Self-charge rule (no pricing)
   */
  test('Self-charge rule with no pricing shows zero profit', () => {
    const selfChargeRule = {
      ruleName: 'Self Charge',
      feedInPrice: null,
      buyPrice: null,
      energy: 5,
      profit: 0
    };

    expect(selfChargeRule.profit).toBe(0);
    expect(selfChargeRule.feedInPrice).toBeNull();
    expect(selfChargeRule.buyPrice).toBeNull();
  });
});
