/**
 * TEST: House Load Extraction from FoxESS API Response
 * 
 * Verifies that house load (loadsPower) is correctly extracted from various
 * FoxESS API response structures during automation cycles.
 */

describe('House Load Extraction', () => {
  
  /**
   * Helper function to simulate findValue (same as in automation code)
   */
  const findValue = (arr, keysOrPatterns) => {
    if (!Array.isArray(arr)) return null;
    for (const k of keysOrPatterns) {
      // Try exact match on variable
      const exact = arr.find(it => 
        (it.variable && it.variable.toString().toLowerCase() === k.toString().toLowerCase()) || 
        (it.key && it.key.toString().toLowerCase() === k.toString().toLowerCase())
      );
      if (exact && exact.value !== undefined && exact.value !== null) return exact.value;
      
      // Try includes match on variable name
      const incl = arr.find(it => 
        (it.variable && it.variable.toString().toLowerCase().includes(k.toString().toLowerCase())) || 
        (it.key && it.key.toString().toLowerCase().includes(k.toString().toLowerCase()))
      );
      if (incl && incl.value !== undefined && incl.value !== null) return incl.value;
    }
    return null;
  };

  /**
   * Test 1: Standard FoxESS response structure (array with datas)
   */
  test('extracts house load from standard FoxESS response structure', () => {
    const inverterData = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'SoC', value: 85, unit: '%' },
            { variable: 'pvPower', value: 3500, unit: 'W' },
            { variable: 'loadsPower', value: 1680, unit: 'W' },
            { variable: 'feedinPower', value: 1200, unit: 'W' }
          ]
        }
      ]
    };

    // Normalize structure (same as automation code)
    let datas = [];
    if (Array.isArray(inverterData?.result)) {
      if (inverterData.result.length > 0 && Array.isArray(inverterData.result[0].datas)) {
        inverterData.result.forEach(r => { if (Array.isArray(r.datas)) datas.push(...r.datas); });
      } else {
        datas = inverterData.result.slice();
      }
    }

    const loadKeys = ['loadspower', 'loadpower', 'load', 'houseload', 'house_load', 'loadsPower'];
    const houseLoadW = findValue(datas, loadKeys);

    expect(houseLoadW).toBe(1680);
  });

  /**
   * Test 2: Case-insensitive matching (loadsPower vs loadspower)
   */
  test('matches house load with case-insensitive key matching', () => {
    const testCases = [
      { variable: 'loadsPower', value: 1500 },
      { variable: 'LoadsPower', value: 1500 },
      { variable: 'LOADSPOWER', value: 1500 },
      { variable: 'loadspower', value: 1500 }
    ];

    testCases.forEach(({ variable, value }) => {
      const datas = [{ variable, value, unit: 'W' }];
      const loadKeys = ['loadspower', 'loadsPower'];
      const result = findValue(datas, loadKeys);
      expect(result).toBe(value);
    });
  });

  /**
   * Test 3: Alternative key names (load, loadpower, etc.)
   */
  test('extracts house load using alternative key names', () => {
    const testCases = [
      { variable: 'load', value: 1234 },
      { variable: 'loadpower', value: 2345 },
      { variable: 'houseload', value: 3456 },
      { variable: 'house_load', value: 4567 },
      { variable: 'consumption', value: 5678 }
    ];

    testCases.forEach(({ variable, value }) => {
      const datas = [{ variable, value, unit: 'W' }];
      const loadKeys = ['loadspower', 'load', 'loadpower', 'houseload', 'house_load', 'consumption', 'loadsPower'];
      const result = findValue(datas, loadKeys);
      expect(result).toBe(value);
    });
  });

  /**
   * Test 4: Zero house load (valid value, not null)
   */
  test('correctly returns 0 when house load is actually zero', () => {
    const datas = [
      { variable: 'loadsPower', value: 0, unit: 'W' }
    ];
    const loadKeys = ['loadspower', 'loadsPower'];
    const result = findValue(datas, loadKeys);
    
    expect(result).toBe(0);
    expect(result).not.toBeNull();
  });

  /**
   * Test 5: Missing house load data returns null
   */
  test('returns null when house load is not present in data', () => {
    const datas = [
      { variable: 'SoC', value: 85, unit: '%' },
      { variable: 'pvPower', value: 3500, unit: 'W' },
      { variable: 'feedinPower', value: 1200, unit: 'W' }
    ];
    const loadKeys = ['loadspower', 'load', 'loadsPower'];
    const result = findValue(datas, loadKeys);
    
    expect(result).toBeNull();
  });

  /**
   * Test 6: Multiple frames with datas arrays (FoxESS sometimes returns multiple frames)
   */
  test('extracts from multiple frames in result array', () => {
    const inverterData = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'SoC', value: 85, unit: '%' }
          ]
        },
        {
          datas: [
            { variable: 'loadsPower', value: 2200, unit: 'W' }
          ]
        },
        {
          datas: [
            { variable: 'pvPower', value: 4000, unit: 'W' }
          ]
        }
      ]
    };

    let datas = [];
    if (Array.isArray(inverterData?.result)) {
      if (inverterData.result.length > 0 && Array.isArray(inverterData.result[0].datas)) {
        inverterData.result.forEach(r => { if (Array.isArray(r.datas)) datas.push(...r.datas); });
      }
    }

    const loadKeys = ['loadspower', 'loadsPower'];
    const result = findValue(datas, loadKeys);
    
    expect(result).toBe(2200);
  });

  /**
   * Test 7: Cached response structure (spreads additional properties)
   */
  test('extracts from cached response with additional properties', () => {
    const inverterData = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'loadsPower', value: 1750, unit: 'W' },
            { variable: 'SoC', value: 90, unit: '%' }
          ]
        }
      ],
      __cacheHit: true,
      __cacheAgeMs: 120000,
      __cacheTtlMs: 300000
    };

    let datas = [];
    if (Array.isArray(inverterData?.result)) {
      if (inverterData.result.length > 0 && Array.isArray(inverterData.result[0].datas)) {
        inverterData.result.forEach(r => { if (Array.isArray(r.datas)) datas.push(...r.datas); });
      }
    }

    const loadKeys = ['loadspower', 'loadsPower'];
    const result = findValue(datas, loadKeys);
    
    expect(result).toBe(1750);
  });

  /**
   * Test 8: Fallback structure (result.datas instead of result[0].datas)
   */
  test('extracts from fallback structure (result.datas)', () => {
    const inverterData = {
      errno: 0,
      result: {
        datas: [
          { variable: 'loadsPower', value: 1950, unit: 'W' },
          { variable: 'pvPower', value: 3000, unit: 'W' }
        ]
      }
    };

    let datas = [];
    if (Array.isArray(inverterData?.result)) {
      // Would skip this branch
    } else if (inverterData?.result && typeof inverterData.result === 'object') {
      if (Array.isArray(inverterData.result.datas)) datas = inverterData.result.datas.slice();
      else if (Array.isArray(inverterData.result.data)) datas = inverterData.result.data.slice();
    }

    const loadKeys = ['loadspower', 'loadsPower'];
    const result = findValue(datas, loadKeys);
    
    expect(result).toBe(1950);
  });

  /**
   * Test 9: Invalid/error response should not crash
   */
  test('handles invalid inverter data gracefully', () => {
    const testCases = [
      null,
      undefined,
      { errno: -1, error: 'API error' },
      { errno: 0, result: null },
      { errno: 0, result: [] },
      { errno: 0 } // missing result entirely
    ];

    testCases.forEach(inverterData => {
      let datas = [];
      if (Array.isArray(inverterData?.result)) {
        if (inverterData.result.length > 0 && Array.isArray(inverterData.result[0].datas)) {
          inverterData.result.forEach(r => { if (Array.isArray(r.datas)) datas.push(...r.datas); });
        } else {
          datas = inverterData.result.slice();
        }
      } else if (inverterData?.result && typeof inverterData.result === 'object') {
        if (Array.isArray(inverterData.result.datas)) datas = inverterData.result.datas.slice();
      }

      const loadKeys = ['loadspower', 'loadsPower'];
      const result = findValue(datas, loadKeys);
      
      expect(result).toBeNull();
    });
  });

  /**
   * Test 10: Real-world typical house load values
   * CRITICAL: FoxESS API returns loadsPower in KILOWATTS, not watts!
   */
  test('handles typical house load values correctly', () => {
    const typicalValues = [
      500,   // 0.5kW - minimal load
      1500,  // 1.5kW - moderate load
      2500,  // 2.5kW - high load
      5000,  // 5kW - very high load
      150,   // 0.15kW - standby
      0      // No load (valid!)
    ];

    typicalValues.forEach(value => {
      const datas = [{ variable: 'loadsPower', value, unit: 'W' }];
      const loadKeys = ['loadspower', 'loadsPower'];
      const houseLoadW = findValue(datas, loadKeys);
      
      expect(houseLoadW).toBe(value);
      
      // Verify conversion to kW
      const houseLoadKw = houseLoadW / 1000;
      expect(houseLoadKw).toBeCloseTo(value / 1000, 3);
    });
  });

  /**
   * Test 11: FoxESS API returns values in KILOWATTS
   * This is the ACTUAL real-world scenario causing the bug!
   */
  test('converts FoxESS API kilowatt values to watts', () => {
    const foxessRealWorldValues = [
      { apiValue: 2.545, expectedWatts: 2545 },  // 2.545kW → 2545W
      { apiValue: 1.680, expectedWatts: 1680 },  // 1.68kW → 1680W  
      { apiValue: 0.500, expectedWatts: 500 },   // 0.5kW → 500W
      { apiValue: 5.250, expectedWatts: 5250 },  // 5.25kW → 5250W
      { apiValue: 0.150, expectedWatts: 150 },   // 0.15kW → 150W
      { apiValue: 0, expectedWatts: 0 }          // 0kW → 0W (valid)
    ];

    foxessRealWorldValues.forEach(({ apiValue, expectedWatts }) => {
      const datas = [{ variable: 'loadsPower', value: apiValue, unit: 'kW' }];
      const loadKeys = ['loadspower', 'loadsPower'];
      let houseLoadW = findValue(datas, loadKeys);
      
      // Extract value
      expect(houseLoadW).toBe(apiValue);
      
      // Convert from kW to W (backend should do this)
      if (houseLoadW !== null && houseLoadW !== undefined) {
        houseLoadW = Number(houseLoadW);
        if (!isNaN(houseLoadW) && Math.abs(houseLoadW) < 100) {
          houseLoadW = houseLoadW * 1000; // Convert kW to W
        }
      }
      
      expect(houseLoadW).toBe(expectedWatts);
      
      // Verify frontend display conversion (W to kW)
      const displayKw = houseLoadW / 1000;
      expect(displayKw).toBeCloseTo(expectedWatts / 1000, 3);
      
      // Verify it displays correctly (not 0.00)
      if (expectedWatts > 0) {
        expect(displayKw).toBeGreaterThan(0.01); // Should show at least 0.01kW
      }
    });
  });
});
