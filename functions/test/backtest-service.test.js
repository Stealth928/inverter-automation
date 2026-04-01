'use strict';

const {
  collectUnsupportedConditions,
  normalizeTariffPlanModel,
  simulateRuleSet
} = require('../lib/services/backtest-service');

describe('backtest service helpers', () => {
  test('collectUnsupportedConditions flags EV and temperature history rules', () => {
    const issues = collectUnsupportedConditions({
      rules: {
        ev_rule: {
          name: 'EV rule',
          conditions: {
            evVehicleSoC: { enabled: true }
          }
        },
        temp_rule: {
          name: 'Temp rule',
          conditions: {
            temperature: { enabled: true, type: 'battery', operator: '>', value: 35 }
          }
        }
      }
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: 'ev_rule',
        reason: 'EV conditions are not supported in Stage 1 backtesting'
      }),
      expect.objectContaining({
        ruleId: 'temp_rule',
        reason: 'Battery, ambient, and inverter temperature history is not supported in Stage 1 backtesting'
      })
    ]));
  });

  test('normalizeTariffPlanModel keeps only valid windows', () => {
    const plan = normalizeTariffPlanModel({
      name: 'Flat plan',
      timezone: 'Australia/Sydney',
      dailySupplyCharge: 120,
      importWindows: [
        { startTime: '00:00', endTime: '23:59', centsPerKwh: 30 },
        { startTime: 'bad', endTime: '23:59', centsPerKwh: 30 }
      ],
      exportWindows: [
        { startTime: '00:00', endTime: '23:59', centsPerKwh: 10 }
      ]
    });

    expect(plan).toEqual(expect.objectContaining({
      name: 'Flat plan',
      timezone: 'Australia/Sydney',
      dailySupplyCharge: 120
    }));
    expect(plan.importWindows).toHaveLength(1);
    expect(plan.exportWindows).toHaveLength(1);
  });

  test('simulateRuleSet respects priority order and first-match wins', () => {
    const baseConditions = {
      solarRadiation: { enabled: false },
      cloudCover: { enabled: false },
      forecastPrice: { enabled: false },
      time: { enabled: false },
      temperature: { enabled: false },
      soc: { enabled: false }
    };
    const result = simulateRuleSet({
      scenario: {
        id: 'scenario-1',
        name: 'Priority test',
        ruleSetSnapshot: {
          rules: {
            charge_first: {
              name: 'Charge first',
              enabled: true,
              priority: 1,
              cooldownMinutes: 30,
              conditions: {
                ...baseConditions,
                buyPrice: { enabled: true, operator: '<=', value: 30 },
                feedInPrice: { enabled: false }
              },
              action: {
                workMode: 'ForceCharge',
                durationMinutes: 30,
                fdPwr: 5000,
                fdSoc: 100,
                minSocOnGrid: 20,
                maxSoc: 100
              }
            },
            discharge_second: {
              name: 'Discharge second',
              enabled: true,
              priority: 2,
              cooldownMinutes: 30,
              conditions: {
                ...baseConditions,
                buyPrice: { enabled: false },
                feedInPrice: { enabled: true, operator: '>=', value: 0 }
              },
              action: {
                workMode: 'ForceDischarge',
                durationMinutes: 30,
                fdPwr: 5000,
                fdSoc: 20,
                minSocOnGrid: 20,
                maxSoc: 100
              }
            }
          }
        }
      },
      userConfig: {
        timezone: 'Australia/Sydney',
        batteryCapacityKWh: 10,
        inverterCapacityW: 5000,
        defaults: { minSocOnGrid: 20 },
        automation: { blackoutWindows: [] }
      },
      gridMs: [
        Date.parse('2026-01-15T00:00:00.000Z'),
        Date.parse('2026-01-15T00:05:00.000Z')
      ],
      stepMs: 5 * 60 * 1000,
      inputSeries: {
        solarKw: [0, 0],
        loadKw: [0, 0]
      },
      weatherIndices: {
        hourlyIndex: [],
        dailyMap: new Map()
      },
      tariffLookup: {
        dailySupplyCharge: 0,
        lookup: jest.fn(() => ({
          buyCentsPerKwh: 20,
          feedInCentsPerKwh: 5
        })),
        window: jest.fn(() => [])
      },
      initialSocPct: 50,
      timezone: 'Australia/Sydney'
    });

    expect(result.triggerCount).toBe(1);
    expect(result.winningRuleMix[0]).toEqual(expect.objectContaining({
      ruleId: 'charge_first',
      triggerCount: 1,
      activeIntervals: 2
    }));
  });
});
