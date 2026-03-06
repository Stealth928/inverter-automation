'use strict';

const {
  applyTriggeredRuleAction,
  persistTriggeredRuleState
} = require('../lib/services/automation-cycle-action-service');

describe('automation cycle action service', () => {
  test('applyTriggeredRuleAction executes applyRuleAction and returns timing/result', async () => {
    const applyRuleAction = jest.fn(async () => ({ errno: 0, segment: { beginTime: '08:00' } }));

    const outcome = await applyTriggeredRuleAction({
      applyRuleAction,
      rule: { name: 'R1' },
      userConfig: { deviceSn: 'SN-1' },
      userId: 'u-1'
    });

    expect(applyRuleAction).toHaveBeenCalledWith('u-1', { name: 'R1' }, { deviceSn: 'SN-1' });
    expect(outcome.actionResult).toEqual({ errno: 0, segment: { beginTime: '08:00' } });
    expect(outcome.applyDurationMs).toEqual(expect.any(Number));
    expect(outcome.applyDurationMs).toBeGreaterThanOrEqual(0);
  });

  test('applyTriggeredRuleAction returns errno=-1 envelope when action throws', async () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const applyRuleAction = jest.fn(async () => {
      throw new Error('boom');
    });

    const outcome = await applyTriggeredRuleAction({
      applyRuleAction,
      errorLogLabel: '[Automation] Action exception:',
      logger,
      rule: { name: 'R2' },
      userConfig: {},
      userId: 'u-2'
    });

    expect(outcome.actionResult).toEqual({ errno: -1, msg: 'boom' });
    expect(logger.error).toHaveBeenCalledWith('[Automation] Action exception:', expect.any(Error));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('applyTriggeredRuleAction emits retry warning only when enabled', async () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const applyRuleAction = jest.fn(async () => ({ errno: 0, retrysFailed: true }));

    await applyTriggeredRuleAction({
      applyRuleAction,
      logger,
      rule: { name: 'R3' },
      userConfig: {},
      userId: 'u-3',
      warnOnPartialRetryFailure: true
    });

    expect(logger.warn).toHaveBeenCalledWith('[Automation] Some retries failed during atomic segment update');
  });

  test('persistTriggeredRuleState writes rule timestamp and automation snapshot', async () => {
    const saveUserAutomationState = jest.fn(async () => undefined);
    const serverTimestamp = jest.fn(() => '__TS__');
    const setUserRule = jest.fn(async () => undefined);

    await persistTriggeredRuleState({
      actionResult: { errno: 0, segment: { beginTime: '09:00' } },
      lastCheckMs: 5000,
      lastTriggeredMs: 4000,
      ruleId: 'rule-9',
      ruleName: 'Rule Nine',
      saveUserAutomationState,
      serverTimestamp,
      setUserRule,
      userId: 'u-9'
    });

    expect(setUserRule).toHaveBeenCalledWith(
      'u-9',
      'rule-9',
      { lastTriggered: '__TS__' },
      { merge: true }
    );
    expect(saveUserAutomationState).toHaveBeenCalledWith(
      'u-9',
      expect.objectContaining({
        activeRule: 'rule-9',
        activeRuleName: 'Rule Nine',
        activeSegmentEnabled: true,
        lastCheck: 5000,
        lastTriggered: 4000
      })
    );
  });
});
