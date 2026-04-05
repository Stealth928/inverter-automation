'use strict';

const { buildTriggeredRuleState } = require('./automation-cycle-lifecycle-service');
const { toFiniteNumber } = require('./number-utils');

async function applyTriggeredRuleAction(options = {}) {
  const applyRuleAction = options.applyRuleAction;
  const logger = options.logger || console;
  const userId = options.userId;
  const rule = options.rule;
  const userConfig = options.userConfig;
  const warnOnPartialRetryFailure = options.warnOnPartialRetryFailure === true;
  const errorLogLabel = options.errorLogLabel || '[Automation] Action failed:';

  if (typeof applyRuleAction !== 'function') {
    throw new Error('applyTriggeredRuleAction requires applyRuleAction()');
  }

  const applyStartMs = Date.now();
  let actionResult = null;
  try {
    actionResult = await applyRuleAction(userId, rule, userConfig);
  } catch (error) {
    if (logger && typeof logger.error === 'function') {
      logger.error(errorLogLabel, error);
    }
    actionResult = { errno: -1, msg: error.message || 'Action failed' };
  }

  if (warnOnPartialRetryFailure && actionResult?.retrysFailed && logger && typeof logger.warn === 'function') {
    logger.warn('[Automation] Some retries failed during atomic segment update');
  }

  return {
    actionResult,
    applyDurationMs: Date.now() - applyStartMs
  };
}

async function persistTriggeredRuleState(options = {}) {
  const saveUserAutomationState = options.saveUserAutomationState;
  const serverTimestamp = options.serverTimestamp;
  const setUserRule = options.setUserRule;
  const userId = options.userId;
  const ruleId = options.ruleId;
  const ruleName = options.ruleName;
  const actionResult = options.actionResult;
  const lastCheckMs = toFiniteNumber(options.lastCheckMs, Date.now());
  const lastTriggeredMs = toFiniteNumber(options.lastTriggeredMs, Date.now());

  if (typeof saveUserAutomationState !== 'function') {
    throw new Error('persistTriggeredRuleState requires saveUserAutomationState()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('persistTriggeredRuleState requires serverTimestamp()');
  }
  if (typeof setUserRule !== 'function') {
    throw new Error('persistTriggeredRuleState requires setUserRule()');
  }
  if (!ruleId) {
    throw new Error('persistTriggeredRuleState requires ruleId');
  }

  await setUserRule(userId, ruleId, {
    lastTriggered: serverTimestamp()
  }, { merge: true });

  await saveUserAutomationState(
    userId,
    buildTriggeredRuleState({
      activeEnergyTracking: options.activeEnergyTracking,
      actionResult,
      lastCheckMs,
      lastTriggeredMs,
      ruleId,
      ruleName
    })
  );
}

module.exports = {
  applyTriggeredRuleAction,
  persistTriggeredRuleState
};
