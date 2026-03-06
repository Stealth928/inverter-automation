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
    parseAutomationTelemetry: jest.fn(() => ({ soc: 60, batTemp: 23, ambientTemp: 26 })),
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
      parseAutomationTelemetry: jest.fn(() => ({ soc: 72, batTemp: 20, ambientTemp: 22 }))
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
});
