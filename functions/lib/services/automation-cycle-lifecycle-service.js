'use strict';

const { toFiniteNumber } = require('./number-utils');

function normalizeLastTriggeredMs(lastTriggered, fallbackMs) {
  if (lastTriggered && typeof lastTriggered === 'object') {
    if (typeof lastTriggered.toMillis === 'function') {
      const millis = Number(lastTriggered.toMillis());
      if (Number.isFinite(millis)) {
        return millis;
      }
    }

    const seconds = toFiniteNumber(lastTriggered._seconds ?? lastTriggered.seconds, NaN);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }

    // Preserve legacy behavior for malformed timestamp objects.
    return 0;
  }

  if (lastTriggered === undefined || lastTriggered === null) {
    return fallbackMs;
  }

  return toFiniteNumber(lastTriggered, fallbackMs);
}

function evaluateRuleCooldown(options = {}) {
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const cooldownMinutes = toFiniteNumber(options.cooldownMinutes, 5);
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const isActiveRule = options.isActiveRule === true;
  const lastTriggered = options.lastTriggered;
  const hasLastTriggered = lastTriggered !== undefined && lastTriggered !== null;
  const lastTriggeredMs = normalizeLastTriggeredMs(lastTriggered, nowMs);
  const elapsedMs = nowMs - lastTriggeredMs;
  const cooldownRemainingSeconds = Math.max(0, Math.round((cooldownMs - elapsedMs) / 1000));

  return {
    activeForSeconds: Math.round(elapsedMs / 1000),
    cooldownMs,
    cooldownRemainingSeconds,
    hasLastTriggered,
    isCooldownExpired: elapsedMs >= cooldownMs,
    lastTriggeredMs,
    shouldSkipForCooldown: !isActiveRule && hasLastTriggered && elapsedMs < cooldownMs
  };
}

function buildCooldownEvaluationResult(ruleName, cooldownRemainingSeconds) {
  return {
    rule: ruleName,
    result: 'cooldown',
    remaining: cooldownRemainingSeconds
  };
}

function buildContinuingEvaluationResult(options = {}) {
  return {
    rule: options.ruleName,
    result: 'continuing',
    activeFor: options.activeForSeconds,
    cooldownRemaining: options.cooldownRemainingSeconds,
    details: options.details
  };
}

function buildClearedActiveRuleState(options = {}) {
  const includeLastCheck = options.includeLastCheck !== false;
  const state = {
    activeRule: null,
    activeRuleName: null,
    activeEnergyTracking: null,
    activeSegment: null,
    activeSegmentEnabled: false
  };

  if (includeLastCheck) {
    state.lastCheck = toFiniteNumber(options.lastCheckMs, Date.now());
  }

  if (Object.prototype.hasOwnProperty.call(options, 'inBlackout')) {
    state.inBlackout = options.inBlackout;
  }

  return state;
}

function buildTriggeredRuleState(options = {}) {
  return {
    lastCheck: toFiniteNumber(options.lastCheckMs, Date.now()),
    lastTriggered: toFiniteNumber(options.lastTriggeredMs, Date.now()),
    activeRule: options.ruleId,
    activeRuleName: options.ruleName,
    activeEnergyTracking: Object.prototype.hasOwnProperty.call(options, 'activeEnergyTracking')
      ? (options.activeEnergyTracking || null)
      : null,
    activeSegment: options.actionResult?.segment || null,
    activeSegmentEnabled: options.actionResult?.errno === 0,
    inBlackout: false,
    lastActionResult: options.actionResult
  };
}

function buildTriggeredRuleSummary(options = {}) {
  const rule = options.rule && typeof options.rule === 'object' ? options.rule : {};
  const isNewTrigger = options.isNewTrigger === true;

  return {
    ruleId: options.ruleId,
    ...rule,
    isNewTrigger,
    status: isNewTrigger ? 'new_trigger' : 'continuing'
  };
}

module.exports = {
  buildClearedActiveRuleState,
  buildContinuingEvaluationResult,
  buildCooldownEvaluationResult,
  buildTriggeredRuleState,
  buildTriggeredRuleSummary,
  evaluateRuleCooldown,
  normalizeLastTriggeredMs
};
