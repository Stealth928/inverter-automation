'use strict';

const {
  createAutomationRuleActionService,
  validateRuleActionForUser
} = require('../lib/services/automation-rule-action-service');

function addMinutes(hour, minute, addMins) {
  const total = hour * 60 + minute + addMins;
  return {
    hour: Math.floor(total / 60) % 24,
    minute: total % 60
  };
}

function buildDeps(overrides = {}) {
  return {
    addHistoryEntry: jest.fn(async () => undefined),
    addMinutes,
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: {} }))
    },
    getUserTime: jest.fn(() => ({ hour: 12, minute: 0 })),
    logger: { debug: jest.fn() },
    resolveAutomationTimezone: jest.fn(() => 'Australia/Sydney'),
    serverTimestamp: jest.fn(() => '__TS__'),
    sleep: jest.fn(async () => undefined),
    ...overrides
  };
}

describe('automation rule action service', () => {
  test('validateRuleActionForUser rejects invalid work mode', () => {
    const error = validateRuleActionForUser({ workMode: 'InvalidMode' }, {});
    expect(error).toContain('Invalid action.workMode');
  });

  test('validateRuleActionForUser enforces fdPwr bounds for power modes', () => {
    const missingPower = validateRuleActionForUser({ workMode: 'ForceCharge' }, {});
    expect(missingPower).toContain('action.fdPwr is required');

    const tooHigh = validateRuleActionForUser(
      { workMode: 'ForceDischarge', fdPwr: 20000 },
      { inverterCapacityW: 5000 }
    );
    expect(tooHigh).toContain('exceeds inverter capacity');
  });

  test('validateRuleActionForUser validates stopOnEnergyKwh only for supported work modes', () => {
    expect(validateRuleActionForUser({ workMode: 'ForceCharge', fdPwr: 5000, stopOnEnergyKwh: 15 }, {})).toBeNull();

    const unsupportedMode = validateRuleActionForUser({ workMode: 'SelfUse', stopOnEnergyKwh: 15 }, {});
    expect(unsupportedMode).toContain('only supported for workMode ForceCharge, ForceDischarge, or Feedin');

    const invalidCap = validateRuleActionForUser({ workMode: 'ForceDischarge', fdPwr: 5000, stopOnEnergyKwh: 0.05 }, {});
    expect(invalidCap).toContain('between 0.1 and 1000 kWh');
  });

  test('applyRuleAction returns validation error before API calls', async () => {
    const deps = buildDeps();
    const { applyRuleAction } = createAutomationRuleActionService(deps);

    const result = await applyRuleAction(
      'u-action-invalid',
      {
        name: 'Invalid Rule',
        action: { workMode: 'ForceCharge' }
      },
      { deviceSn: 'SN-1' }
    );

    expect(result.errno).toBe(400);
    expect(result.msg).toContain('fdPwr');
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('applyRuleAction caps midnight crossing to 23:59 and persists history', async () => {
    let getCount = 0;
    let enablePayload = null;

    const deps = buildDeps({
      getUserTime: jest.fn(() => ({ hour: 23, minute: 50 })),
      foxessAPI: {
        callFoxESSAPI: jest.fn(async (path, _method, payload) => {
          if (path === '/op/v1/device/scheduler/get') {
            getCount += 1;
            if (getCount === 1) {
              return { errno: 0, result: { groups: [] } };
            }
            return {
              errno: 0,
              result: {
                groups: [{
                  enable: 1,
                  startHour: 23,
                  startMinute: 50,
                  endHour: 23,
                  endMinute: 59,
                  workMode: 'SelfUse'
                }]
              }
            };
          }

          if (path === '/op/v1/device/scheduler/enable') {
            enablePayload = payload;
            return { errno: 0, msg: 'ok' };
          }

          if (path === '/op/v1/device/scheduler/set/flag') {
            return { errno: 0, msg: 'ok' };
          }

          return { errno: 0, result: {} };
        })
      }
    });

    const { applyRuleAction } = createAutomationRuleActionService(deps);
    const result = await applyRuleAction(
      'u-midnight',
      {
        name: 'Night Rule',
        action: { durationMinutes: 30, workMode: 'SelfUse' }
      },
      { deviceSn: 'SN-9' }
    );

    expect(result.errno).toBe(0);
    expect(result.retrysFailed).toBe(false);
    expect(enablePayload.groups[0]).toEqual(expect.objectContaining({
      startHour: 23,
      startMinute: 50,
      endHour: 23,
      endMinute: 59
    }));
    expect(deps.addHistoryEntry).toHaveBeenCalledWith(
      'u-midnight',
      expect.objectContaining({
        type: 'automation_action',
        segment: expect.objectContaining({ endHour: 23, endMinute: 59 })
      })
    );
    expect(deps.sleep).toHaveBeenCalledWith(3000);
  });

  test('applyRuleAction returns retrysFailed after three enable failures', async () => {
    const deps = buildDeps({
      foxessAPI: {
        callFoxESSAPI: jest.fn(async (path) => {
          if (path === '/op/v1/device/scheduler/get') {
            return { errno: 0, result: { groups: [] } };
          }
          if (path === '/op/v1/device/scheduler/enable') {
            return { errno: 503, msg: 'temporary failure' };
          }
          return { errno: 0, result: {} };
        })
      }
    });

    const { applyRuleAction } = createAutomationRuleActionService(deps);
    const result = await applyRuleAction(
      'u-retry-fail',
      {
        name: 'Retry Rule',
        action: { durationMinutes: 15, workMode: 'SelfUse' }
      },
      { deviceSn: 'SN-5' }
    );

    expect(result.errno).toBe(503);
    expect(result.retrysFailed).toBe(true);
    expect(
      deps.foxessAPI.callFoxESSAPI.mock.calls.filter((call) => call[0] === '/op/v1/device/scheduler/enable')
    ).toHaveLength(3);
    expect(deps.sleep).toHaveBeenCalledWith(1200);
    expect(deps.addHistoryEntry).not.toHaveBeenCalled();
  });
});
