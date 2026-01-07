/**
 * Test deep merge function for config preservation
 */

describe('deepMerge', () => {
  // Extract the deepMerge function for testing
  function deepMerge(target, source) {
    if (!target) return source;
    if (!source) return target;
    
    const output = { ...target };
    
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (
          source[key] && 
          typeof source[key] === 'object' && 
          !Array.isArray(source[key]) &&
          target[key] && 
          typeof target[key] === 'object' && 
          !Array.isArray(target[key])
        ) {
          output[key] = deepMerge(target[key], source[key]);
        } else {
          output[key] = source[key];
        }
      }
    }
    
    return output;
  }

  test('preserves nested fields not present in source', () => {
    const existing = {
      automation: {
        intervalMs: 60000,
        blackoutWindows: [{ start: '00:30', end: '07:30', enabled: true }]
      },
      curtailment: {
        enabled: true,
        priceThreshold: 0.3
      },
      location: 'Sydney'
    };

    const update = {
      automation: {
        intervalMs: 30000  // Only updating intervalMs
      },
      location: 'Melbourne'
    };

    const merged = deepMerge(existing, update);

    // Should preserve blackoutWindows
    expect(merged.automation.blackoutWindows).toEqual([{ start: '00:30', end: '07:30', enabled: true }]);
    // Should update intervalMs
    expect(merged.automation.intervalMs).toBe(30000);
    // Should preserve curtailment entirely
    expect(merged.curtailment).toEqual({ enabled: true, priceThreshold: 0.3 });
    // Should update location
    expect(merged.location).toBe('Melbourne');
  });

  test('overwrites arrays instead of merging them', () => {
    const existing = {
      automation: {
        blackoutWindows: [{ id: 1 }, { id: 2 }]
      }
    };

    const update = {
      automation: {
        blackoutWindows: [{ id: 3 }]
      }
    };

    const merged = deepMerge(existing, update);

    // Arrays should be replaced, not merged
    expect(merged.automation.blackoutWindows).toEqual([{ id: 3 }]);
    expect(merged.automation.blackoutWindows.length).toBe(1);
  });

  test('handles empty update gracefully', () => {
    const existing = {
      automation: { intervalMs: 60000 },
      curtailment: { enabled: true }
    };

    const update = {};

    const merged = deepMerge(existing, update);

    // Should preserve all existing fields
    expect(merged).toEqual(existing);
  });

  test('handles null/undefined gracefully', () => {
    expect(deepMerge(null, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  test('preserves new top-level fields', () => {
    const existing = {
      automation: { intervalMs: 60000 }
    };

    const update = {
      newField: 'test',
      automation: { startDelayMs: 5000 }
    };

    const merged = deepMerge(existing, update);

    expect(merged.newField).toBe('test');
    expect(merged.automation.intervalMs).toBe(60000);
    expect(merged.automation.startDelayMs).toBe(5000);
  });

  test('real-world scenario: settings save without blackout windows', () => {
    // Simulate: user has blackout windows + curtailment saved
    const existingConfig = {
      deviceSn: 'TEST123',
      foxessToken: 'token123',
      amberApiKey: 'amber123',
      location: 'Sydney',
      timezone: 'Australia/Sydney',
      automation: {
        intervalMs: 60000,
        startDelayMs: 5000,
        gatherDataTimeoutMs: 8000,
        blackoutWindows: [
          {
            enabled: true,
            start: '00:30',
            end: '07:30',
            days: { enabled: true, Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true, Sun: true }
          }
        ]
      },
      curtailment: {
        enabled: true,
        priceThreshold: 0.3
      },
      cache: {
        amber: 60000,
        inverter: 300000,
        weather: 1800000
      }
    };

    // Simulate: settings.html saves config without including blackoutWindows/curtailment
    // (because they're managed in a separate UI section that doesn't send them)
    const partialUpdate = {
      location: 'Melbourne',  // User only changed location
      timezone: 'Australia/Melbourne',
      automation: {
        intervalMs: 60000,
        startDelayMs: 5000,
        gatherDataTimeoutMs: 8000
        // blackoutWindows intentionally missing!
      },
      cache: {
        amber: 60000,
        inverter: 300000,
        weather: 1800000
      }
      // curtailment intentionally missing!
    };

    const merged = deepMerge(existingConfig, partialUpdate);

    // CRITICAL: blackoutWindows and curtailment should be preserved
    expect(merged.automation.blackoutWindows).toBeDefined();
    expect(merged.automation.blackoutWindows.length).toBe(1);
    expect(merged.automation.blackoutWindows[0].start).toBe('00:30');
    expect(merged.automation.blackoutWindows[0].end).toBe('07:30');
    
    expect(merged.curtailment).toBeDefined();
    expect(merged.curtailment.enabled).toBe(true);
    expect(merged.curtailment.priceThreshold).toBe(0.3);

    // And location should be updated
    expect(merged.location).toBe('Melbourne');
    expect(merged.timezone).toBe('Australia/Melbourne');
  });
});
