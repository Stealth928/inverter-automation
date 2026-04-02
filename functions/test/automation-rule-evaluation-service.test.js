'use strict';

const { createAutomationRuleEvaluationService } = require('../lib/services/automation-rule-evaluation-service');

function buildService(overrides = {}) {
  const deps = {
    evaluateTemperatureCondition: jest.fn(() => ({ met: false, reason: 'temperature not configured' })),
    evaluateTimeCondition: jest.fn(() => ({
      met: false,
      actualTime: '12:00',
      startTime: '00:00',
      endTime: '23:59',
      days: [],
      daysLabel: 'Every day',
      dayMatched: true
    })),
    getCurrentAmberPrices: jest.fn(() => ({ feedInPrice: 5.5, buyPrice: 15.2 })),
    getUserTime: jest.fn(() => ({ hour: 12, minute: 0, dayOfWeek: 1 })),
    logger: { debug: jest.fn() },
    parseAutomationTelemetry: jest.fn(() => ({ soc: 60, batTemp: 23, ambientTemp: 26, inverterTemp: 31 })),
    resolveAutomationTimezone: jest.fn(() => 'Australia/Sydney'),
    ...overrides
  };

  return {
    deps,
    service: createAutomationRuleEvaluationService(deps)
  };
}

describe('automation rule evaluation service', () => {
  test('throws when required dependencies are missing', () => {
    expect(() => createAutomationRuleEvaluationService({}))
      .toThrow('createAutomationRuleEvaluationService requires evaluateTemperatureCondition()');
  });

  test('compareValue supports scalar, array, and object between formats', () => {
    const { service } = buildService();

    expect(service.compareValue(10, '>', 5)).toBe(true);
    expect(service.compareValue(50, 'between', 40, 60)).toBe(true);
    expect(service.compareValue(50, 'between', [40, 60])).toBe(true);
    expect(service.compareValue(50, 'between', { min: 40, max: 60 })).toBe(true);
    expect(service.compareValue(20, 'between', { min: 40, max: 60 })).toBe(false);
  });

  test('evaluateRule returns triggered=true when enabled SoC condition is met', async () => {
    const { service, deps } = buildService({
      parseAutomationTelemetry: jest.fn(() => ({ soc: 72, batTemp: 20, ambientTemp: 22, inverterTemp: 29 }))
    });

    const result = await service.evaluateRule(
      'u-eval',
      'rule-1',
      {
        name: 'SoC Trigger',
        conditions: {
          soc: { enabled: true, op: '>=', value: 70 }
        }
      },
      { amber: [{ channelType: 'feedIn' }], weather: null },
      { result: { datas: [] } },
      { timezone: 'Australia/Sydney' }
    );

    expect(result.triggered).toBe(true);
    expect(result.results).toEqual([
      {
        condition: 'soc',
        met: true,
        actual: 72,
        operator: '>=',
        target: 70
      }
    ]);
    expect(deps.resolveAutomationTimezone).toHaveBeenCalledWith({ timezone: 'Australia/Sydney' });
  });

  test('evaluateRule returns no-conditions reason when no conditions are enabled', async () => {
    const { service } = buildService();

    const result = await service.evaluateRule(
      'u-eval',
      'rule-empty',
      {
        name: 'No Conditions',
        conditions: {}
      },
      { amber: [] },
      {},
      {}
    );

    expect(result).toEqual({
      triggered: false,
      reason: 'No conditions enabled',
      feedInPrice: 5.5,
      buyPrice: 15.2
    });
  });

  test('passes inverter temperature through to the temperature evaluator', async () => {
    const evaluateTemperatureCondition = jest.fn(() => ({
      met: true,
      actual: 48,
      operator: '>=',
      target: 45,
      target2: null,
      type: 'inverter',
      source: 'inverter',
      metric: null,
      dayOffset: 0
    }));
    const { service } = buildService({
      evaluateTemperatureCondition,
      parseAutomationTelemetry: jest.fn(() => ({ soc: 58, batTemp: 24, ambientTemp: 26, inverterTemp: 48 }))
    });

    const result = await service.evaluateRule(
      'u-eval',
      'rule-inverter-temp',
      {
        name: 'Inverter Temp Guard',
        conditions: {
          temperature: { enabled: true, type: 'inverter', operator: '>=', value: 45 }
        }
      },
      { amber: [] },
      {},
      {}
    );

    expect(evaluateTemperatureCondition).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inverter', operator: '>=', value: 45 }),
      expect.objectContaining({ batteryTemp: 24, ambientTemp: 26, inverterTemp: 48 })
    );
    expect(result.triggered).toBe(true);
    expect(result.results).toEqual([
      {
        condition: 'temperature',
        met: true,
        actual: 48,
        operator: '>=',
        target: 45,
        target2: null,
        type: 'inverter',
        source: 'inverter',
        metric: null,
        dayOffset: 0
      }
    ]);
  });

  test('forecastPrice averages mixed interval widths by covered minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-26T00:02:00.000Z'));

    try {
      const { service } = buildService();

      const result = await service.evaluateRule(
        'u-eval',
        'rule-forecast',
        {
          name: 'Weighted Forecast',
          conditions: {
            forecastPrice: {
              enabled: true,
              type: 'buy',
              lookAhead: 30,
              lookAheadUnit: 'minutes',
              checkType: 'average',
              operator: '<=',
              value: 30
            }
          }
        },
        {
          amber: [
            {
              type: 'ForecastInterval',
              channelType: 'general',
              perKwh: 100,
              startTime: '2026-03-26T00:00:00.000Z',
              endTime: '2026-03-26T00:05:00.000Z'
            },
            {
              type: 'ForecastInterval',
              channelType: 'general',
              perKwh: 20,
              startTime: '2026-03-26T00:05:00.000Z',
              endTime: '2026-03-26T00:35:00.000Z'
            }
          ]
        },
        {},
        {}
      );

      expect(result.triggered).toBe(true);
      expect(result.results).toEqual([
        {
          condition: 'forecastPrice',
          met: true,
          actual: '28.0',
          operator: '<=',
          target: 30,
          type: 'buy',
          lookAhead: '30m',
          lookAheadMinutes: 30,
          checkType: 'average',
          intervalsChecked: 2,
          intervalsAvailable: 2,
          coverageMinutes: 30,
          incomplete: false
        }
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('forecastPrice keeps standard Amber same-width averages unchanged', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-26T00:00:00.000Z'));

    try {
      const { service } = buildService();

      const result = await service.evaluateRule(
        'u-eval',
        'rule-amber-equal-width',
        {
          name: 'Amber Equal Width',
          conditions: {
            forecastPrice: {
              enabled: true,
              type: 'buy',
              lookAhead: 60,
              lookAheadUnit: 'minutes',
              checkType: 'average',
              operator: '==',
              value: 15
            }
          }
        },
        {
          amber: [
            {
              type: 'ForecastInterval',
              channelType: 'general',
              perKwh: 10,
              startTime: '2026-03-26T00:00:00.000Z',
              endTime: '2026-03-26T00:30:00.000Z'
            },
            {
              type: 'ForecastInterval',
              channelType: 'general',
              perKwh: 20,
              startTime: '2026-03-26T00:30:00.000Z',
              endTime: '2026-03-26T01:00:00.000Z'
            }
          ]
        },
        {},
        {}
      );

      expect(result.triggered).toBe(true);
      expect(result.results).toEqual([
        {
          condition: 'forecastPrice',
          met: true,
          actual: '15.0',
          operator: '==',
          target: 15,
          type: 'buy',
          lookAhead: '60m',
          lookAheadMinutes: 60,
          checkType: 'average',
          intervalsChecked: 2,
          intervalsAvailable: 2,
          coverageMinutes: 60,
          incomplete: false
        }
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('forecastPrice weights Amber feed-in averages by overlap and preserves feed-in sign handling', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-26T00:02:00.000Z'));

    try {
      const { service } = buildService();

      const result = await service.evaluateRule(
        'u-eval',
        'rule-amber-feed-in',
        {
          name: 'Amber Feed-In Weighted',
          conditions: {
            forecastPrice: {
              enabled: true,
              type: 'feedIn',
              lookAhead: 30,
              lookAheadUnit: 'minutes',
              checkType: 'average',
              operator: '>=',
              value: 13
            }
          }
        },
        {
          amber: [
            {
              type: 'ForecastInterval',
              channelType: 'feedIn',
              perKwh: -40,
              startTime: '2026-03-26T00:00:00.000Z',
              endTime: '2026-03-26T00:05:00.000Z'
            },
            {
              type: 'ForecastInterval',
              channelType: 'feedIn',
              perKwh: -10,
              startTime: '2026-03-26T00:05:00.000Z',
              endTime: '2026-03-26T00:35:00.000Z'
            }
          ]
        },
        {},
        {}
      );

      expect(result.triggered).toBe(true);
      expect(result.results).toEqual([
        {
          condition: 'forecastPrice',
          met: true,
          actual: '13.0',
          operator: '>=',
          target: 13,
          type: 'feedIn',
          lookAhead: '30m',
          lookAheadMinutes: 30,
          checkType: 'average',
          intervalsChecked: 2,
          intervalsAvailable: 2,
          coverageMinutes: 30,
          incomplete: false
        }
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
