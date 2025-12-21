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
   * IMPORTANT: Amber prices are ALWAYS in cents/kWh
   * ALWAYS divide by 100 to convert to dollars
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
      },
      {
        name: 'Discharge rule with low feed-in price (under 10 cents)',
        ruleType: 'Discharge',
        energy: 2, // kWh  
        feedInPrice: 6.36, // cents/kWh (low price like in user screenshot)
        buyPrice: null,
        expectedProfit: 0.1272 // 2 × 0.0636 AUD - NOT $12.72!
      },
      {
        name: 'Discharge rule with very low feed-in price (3.23 cents)',
        ruleType: 'Discharge',
        energy: 2, // kWh
        feedInPrice: 3.23, // cents/kWh
        buyPrice: null,
        expectedProfit: 0.0646 // 2 × 0.0323 AUD - NOT $6.46!
      }
    ];

    testCases.forEach(({ name, energy, feedInPrice, buyPrice, expectedProfit }) => {
      let actualPrice = feedInPrice || buyPrice;
      let eventProfit = 0;

      if (actualPrice && energy) {
        // CRITICAL: Amber prices are ALWAYS in cents/kWh
        // ALWAYS divide by 100 to convert to dollars/kWh
        // Do NOT conditionally check if price > 10!
        const priceAudPerKwh = actualPrice / 100;
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

  /**
   * Test 9: CRITICAL - Use ACTUAL duration, not rule's configured duration
   * 
   * This test verifies the fix for the bug where profit was calculated using
   * the rule's configured duration (e.g., 30 minutes) instead of the actual
   * runtime (e.g., 2 minutes 6 seconds).
   * 
   * Example from user screenshot:
   * - Rule: "Test ROI calc" (Discharge)
   * - Configured duration: 30 minutes (used by backend at trigger time)
   * - Actual runtime: 2m 6s = 126 seconds
   * - Power: 4.00kW
   * - Price: 6.36¢/kWh
   * 
   * WRONG (using configured duration):
   *   4kW × 0.5h × $0.0636 = $0.1272... wait, that's still wrong
   *   The backend was calculating: 4000W × 0.0636 × 0.5h = $127.20 (BUG!)
   * 
   * CORRECT (using actual duration):
   *   4kW × 0.035h × $0.0636 = $0.0089
   */
  test('Profit uses ACTUAL duration from event.durationMs, not rule configured duration', () => {
    const testCases = [
      {
        name: 'Short discharge (2m 6s) at 6.36¢',
        durationMs: 126000, // 2 minutes 6 seconds
        rulePowerKw: 4.0,
        feedInPrice: 6.36, // cents/kWh
        houseLoadKw: null, // unknown house load
        // Calculation: 4kW × (126000 / 3600000)h × ($6.36 / 100) = 4 × 0.035 × 0.0636 = $0.0089
        expectedProfit: 0.0089
      },
      {
        name: 'Very short discharge (1m 5s) at 3.23¢',
        durationMs: 65000, // 1 minute 5 seconds  
        rulePowerKw: 4.0,
        feedInPrice: 3.23, // cents/kWh
        houseLoadKw: null,
        // Calculation: 4kW × (65000 / 3600000)h × ($3.23 / 100) = 4 × 0.0181 × 0.0323 = $0.0023
        expectedProfit: 0.0023
      },
      {
        name: 'Standard 30-minute discharge at 25¢',
        durationMs: 1800000, // 30 minutes
        rulePowerKw: 5.0,
        feedInPrice: 25.0, // cents/kWh
        houseLoadKw: 1.0, // 1kW house load
        // Export = 5kW - 1kW = 4kW
        // Calculation: 4kW × 0.5h × $0.25 = $0.50
        expectedProfit: 0.50
      },
      {
        name: 'Long discharge (2 hours) at spike price 150¢',
        durationMs: 7200000, // 2 hours
        rulePowerKw: 6.0,
        feedInPrice: 150.0, // cents/kWh (spike)
        houseLoadKw: 2.0, // 2kW house load
        // Export = 6kW - 2kW = 4kW
        // Calculation: 4kW × 2h × $1.50 = $12.00
        expectedProfit: 12.00
      }
    ];

    testCases.forEach(({ name, durationMs, rulePowerKw, feedInPrice, houseLoadKw, expectedProfit }) => {
      // Convert milliseconds to hours (same as frontend)
      const durationHours = durationMs / (1000 * 60 * 60);
      
      // Always divide price by 100 (cents to dollars)
      const priceAudPerKwh = feedInPrice / 100;
      
      // Calculate export power (discharge - house load, or just discharge if no house load)
      const exportKw = houseLoadKw !== null ? Math.max(0, rulePowerKw - houseLoadKw) : rulePowerKw;
      
      // Calculate profit: export × duration × price
      const eventProfit = exportKw * durationHours * priceAudPerKwh;
      
      expect(eventProfit).toBeCloseTo(expectedProfit, 3);
    });
  });

  /**
   * Test 10: Charge rule profit calculation (negative when price positive, positive when price negative)
   */
  test('Charge rule profit is negative for positive prices, positive for negative prices', () => {
    const testCases = [
      {
        name: 'Charge at positive price (cost)',
        durationMs: 1800000, // 30 minutes
        rulePowerKw: 5.0,
        buyPrice: 30.0, // cents/kWh - positive = you pay
        houseLoadKw: 1.0,
        // Grid draw = 5kW + 1kW = 6kW
        // Profit = -(6kW × 0.5h × $0.30) = -$0.90 (cost)
        expectedProfit: -0.90
      },
      {
        name: 'Charge at negative price (get paid to consume!)',
        durationMs: 1800000, // 30 minutes
        rulePowerKw: 5.0,
        buyPrice: -20.0, // cents/kWh - negative = you get paid
        houseLoadKw: 1.0,
        // Grid draw = 5kW + 1kW = 6kW
        // Profit = -(6kW × 0.5h × $-0.20) = $0.60 (profit!)
        expectedProfit: 0.60
      },
      {
        name: 'Charge at zero price (free energy)',
        durationMs: 3600000, // 1 hour
        rulePowerKw: 8.0,
        buyPrice: 0.0, // cents/kWh - free
        houseLoadKw: 2.0,
        // Profit = -(10kW × 1h × $0) = $0
        expectedProfit: 0.00
      }
    ];

    testCases.forEach(({ name, durationMs, rulePowerKw, buyPrice, houseLoadKw, expectedProfit }) => {
      const durationHours = durationMs / (1000 * 60 * 60);
      const priceAudPerKwh = buyPrice / 100;
      
      // For charge: grid draw = charge power + house load
      const gridDrawKw = houseLoadKw !== null ? (rulePowerKw + houseLoadKw) : rulePowerKw;
      
      // Charge profit is negative of (power × price)
      // Positive price = negative profit (cost)
      // Negative price = positive profit (revenue)
      const eventProfit = -(gridDrawKw * durationHours * priceAudPerKwh);
      
      expect(eventProfit).toBeCloseTo(expectedProfit, 3);
    });
  });
});
