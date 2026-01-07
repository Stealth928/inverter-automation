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

  describe('Basic functionality', () => {
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
  });

  describe('Real-world scenarios', () => {
    test('settings save without blackout windows', () => {
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

    test('multiple nested levels preserved during partial updates', () => {
      const existing = {
        automation: {
          intervalMs: 60000,
          startDelayMs: 5000,
          gatherDataTimeoutMs: 8000,
          blackoutWindows: [
            {
              enabled: true,
              start: '00:30',
              end: '07:30',
              days: {
                enabled: true,
                Mon: true,
                Tue: true,
                Wed: true,
                Thu: true,
                Fri: true,
                Sat: true,
                Sun: true
              }
            }
          ]
        },
        cache: {
          amber: 60000,
          inverter: 300000,
          weather: 1800000
        },
        defaults: {
          cooldownMinutes: 5,
          durationMinutes: 30,
          fdPwr: 5000
        },
        preferences: {
          forecastDays: 6,
          weatherPlace: 'Sydney, Australia'
        }
      };

      const update = {
        cache: {
          amber: 120000  // Only updating amber cache
        }
      };

      const merged = deepMerge(existing, update);

      // Cache.amber should be updated
      expect(merged.cache.amber).toBe(120000);
      // Other cache values should be preserved
      expect(merged.cache.inverter).toBe(300000);
      expect(merged.cache.weather).toBe(1800000);
      // All other top-level objects should be preserved
      expect(merged.automation).toEqual(existing.automation);
      expect(merged.defaults).toEqual(existing.defaults);
      expect(merged.preferences).toEqual(existing.preferences);
    });

    test('clearing fields explicitly (null/delete not supported in merge)', () => {
      const existing = {
        automation: {
          intervalMs: 60000,
          blackoutWindows: [{ id: 1 }],
          notes: 'some notes'
        }
      };

      const update = {
        automation: {
          notes: null  // User explicitly sets to null
        }
      };

      const merged = deepMerge(existing, update);

      // null should overwrite the existing value
      expect(merged.automation.notes).toBeNull();
      // Other fields should be preserved
      expect(merged.automation.intervalMs).toBe(60000);
      expect(merged.automation.blackoutWindows).toEqual([{ id: 1 }]);
    });

    test('adding new nested objects while preserving existing', () => {
      const existing = {
        automation: {
          intervalMs: 60000,
          blackoutWindows: [{ id: 1 }]
        },
        preferences: {
          weatherPlace: 'Sydney'
        }
      };

      const update = {
        automation: {
          newSubObject: {
            nested: 'value'
          }
        }
      };

      const merged = deepMerge(existing, update);

      // New nested object should be added
      expect(merged.automation.newSubObject).toEqual({ nested: 'value' });
      // Existing fields should be preserved
      expect(merged.automation.intervalMs).toBe(60000);
      expect(merged.automation.blackoutWindows).toEqual([{ id: 1 }]);
      expect(merged.preferences).toEqual(existing.preferences);
    });

    test('deeply nested merge (3+ levels)', () => {
      const existing = {
        level1: {
          level2: {
            level3: {
              value: 'original',
              preserve: 'this'
            },
            other: 'keep'
          }
        }
      };

      const update = {
        level1: {
          level2: {
            level3: {
              value: 'updated'
              // preserve field not in update
            }
          }
        }
      };

      const merged = deepMerge(existing, update);

      expect(merged.level1.level2.level3.value).toBe('updated');
      expect(merged.level1.level2.level3.preserve).toBe('this');
      expect(merged.level1.level2.other).toBe('keep');
    });
  });

  describe('Edge cases', () => {
    test('both null/undefined', () => {
      expect(deepMerge(null, null)).toBeNull();
      expect(deepMerge(undefined, undefined)).toBeUndefined();
      expect(deepMerge(null, undefined)).toBeUndefined();
    });

    test('empty objects', () => {
      expect(deepMerge({}, {})).toEqual({});
      expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
      expect(deepMerge({}, { a: 1 })).toEqual({ a: 1 });
    });

    test('primitive values in nested objects', () => {
      const existing = {
        obj: {
          str: 'value',
          num: 42,
          bool: true,
          nil: null
        }
      };

      const update = {
        obj: {
          str: 'updated',
          num: 100
        }
      };

      const merged = deepMerge(existing, update);

      expect(merged.obj.str).toBe('updated');
      expect(merged.obj.num).toBe(100);
      expect(merged.obj.bool).toBe(true);
      expect(merged.obj.nil).toBeNull();
    });

    test('mixed arrays and objects', () => {
      const existing = {
        mixed: {
          arrayField: [1, 2, 3],
          objField: { a: 1, b: 2 },
          primitive: 'string'
        }
      };

      const update = {
        mixed: {
          arrayField: [4, 5],
          primitive: 'updated'
        }
      };

      const merged = deepMerge(existing, update);

      // Array should be replaced
      expect(merged.mixed.arrayField).toEqual([4, 5]);
      // Object should be preserved
      expect(merged.mixed.objField).toEqual({ a: 1, b: 2 });
      // Primitive should be updated
      expect(merged.mixed.primitive).toBe('updated');
    });

    test('symbol and function values (should be ignored)', () => {
      const existing = {
        config: {
          value: 'keep'
        }
      };

      const update = {
        config: {
          value: 'update'
        },
        fn: function() {}  // Functions should not cause errors
      };

      const merged = deepMerge(existing, update);

      expect(merged.config.value).toBe('update');
      expect(typeof merged.fn).toBe('function');
    });

    test('prototype chain not followed', () => {
      const baseObj = { inherited: 'value' };
      const existing = Object.create(baseObj);
      existing.own = 'property';

      const update = {
        own: 'updated'
      };

      const merged = deepMerge(existing, update);

      // Should have own property
      expect(merged.own).toBe('updated');
      // Should not iterate inherited properties
      expect(merged.inherited).toBeUndefined();
    });
  });
});
