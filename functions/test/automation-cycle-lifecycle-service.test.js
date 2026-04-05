'use strict';

const {
  buildClearedActiveRuleState,
  buildContinuingEvaluationResult,
  buildCooldownEvaluationResult,
  buildTriggeredRuleState,
  buildTriggeredRuleSummary,
  evaluateRuleCooldown,
  normalizeLastTriggeredMs
} = require('../lib/services/automation-cycle-lifecycle-service');

describe('automation cycle lifecycle service', () => {
  test('evaluateRuleCooldown skips inactive rule when still in cooldown', () => {
    const nowMs = 1000000;

    const result = evaluateRuleCooldown({
      cooldownMinutes: 5,
      isActiveRule: false,
      lastTriggered: nowMs - (2 * 60 * 1000),
      nowMs
    });

    expect(result.shouldSkipForCooldown).toBe(true);
    expect(result.cooldownRemainingSeconds).toBe(180);
  });

  test('evaluateRuleCooldown does not skip active rule during cooldown window', () => {
    const nowMs = 1000000;

    const result = evaluateRuleCooldown({
      cooldownMinutes: 5,
      isActiveRule: true,
      lastTriggered: nowMs - (2 * 60 * 1000),
      nowMs
    });

    expect(result.shouldSkipForCooldown).toBe(false);
    expect(result.isCooldownExpired).toBe(false);
    expect(result.activeForSeconds).toBe(120);
  });

  test('normalizeLastTriggeredMs parses Firestore timestamp objects', () => {
    expect(normalizeLastTriggeredMs({ _seconds: 1710 }, 123)).toBe(1710000);
    expect(normalizeLastTriggeredMs({ seconds: 8 }, 123)).toBe(8000);
  });

  test('normalizeLastTriggeredMs preserves legacy malformed-object fallback to zero', () => {
    expect(normalizeLastTriggeredMs({ unexpected: true }, 999)).toBe(0);
  });

  test('buildClearedActiveRuleState supports disabling lastCheck writes', () => {
    const state = buildClearedActiveRuleState({ includeLastCheck: false });

    expect(state).toEqual({
      activeRule: null,
      activeRuleName: null,
      activeEnergyTracking: null,
      activeSegment: null,
      activeSegmentEnabled: false
    });
  });

  test('buildTriggeredRuleState builds persisted active-rule snapshot', () => {
    const actionResult = {
      errno: 0,
      segment: { beginTime: '08:00' }
    };

    expect(buildTriggeredRuleState({
      activeEnergyTracking: { progressKwh: 0, ruleId: 'r-1' },
      actionResult,
      lastCheckMs: 1000,
      lastTriggeredMs: 900,
      ruleId: 'r-1',
      ruleName: 'Rule One'
    })).toEqual({
      activeRule: 'r-1',
      activeRuleName: 'Rule One',
      activeEnergyTracking: { progressKwh: 0, ruleId: 'r-1' },
      activeSegment: { beginTime: '08:00' },
      activeSegmentEnabled: true,
      inBlackout: false,
      lastActionResult: actionResult,
      lastCheck: 1000,
      lastTriggered: 900
    });
  });

  test('buildTriggeredRuleSummary and evaluation helpers emit expected envelopes', () => {
    expect(buildTriggeredRuleSummary({
      isNewTrigger: true,
      rule: { name: 'R1', priority: 1 },
      ruleId: 'rule-1'
    })).toEqual({
      isNewTrigger: true,
      name: 'R1',
      priority: 1,
      ruleId: 'rule-1',
      status: 'new_trigger'
    });

    expect(buildCooldownEvaluationResult('R2', 45)).toEqual({
      remaining: 45,
      result: 'cooldown',
      rule: 'R2'
    });

    expect(buildContinuingEvaluationResult({
      activeForSeconds: 12,
      cooldownRemainingSeconds: 33,
      details: { triggered: true },
      ruleName: 'R3'
    })).toEqual({
      activeFor: 12,
      cooldownRemaining: 33,
      details: { triggered: true },
      result: 'continuing',
      rule: 'R3'
    });
  });
});
