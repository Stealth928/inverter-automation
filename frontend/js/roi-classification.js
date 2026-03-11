(function initRoiClassification(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ROIClassification = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildRoiClassification() {
  'use strict';

  const NORMALIZED_MODE_TO_RULE_TYPE = Object.freeze({
    forcecharge: 'Charge',
    forcedischarge: 'Discharge',
    feedin: 'Discharge',
    selfuse: 'Self Use',
    backup: 'Backup'
  });

  function normalizeWorkModeToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function classifyFromWorkMode(workMode) {
    const token = normalizeWorkModeToken(workMode);
    if (!token) return null;
    const ruleType = NORMALIZED_MODE_TO_RULE_TYPE[token];
    if (!ruleType) return null;

    return {
      isChargeRule: token === 'forcecharge',
      isFeedinRule: token === 'forcedischarge' || token === 'feedin',
      ruleType
    };
  }

  function findTriggeredRuleName(startAllRules) {
    const safeRules = Array.isArray(startAllRules) ? startAllRules : [];
    const triggered = safeRules.find((rule) => rule && rule.triggered);
    return triggered && triggered.name ? String(triggered.name) : null;
  }

  function inferFromRuleName(ruleName) {
    const text = String(ruleName || '').trim().toLowerCase();
    if (!text) {
      return null;
    }

    if (text.includes('self use') || text.includes('self-use') || text.includes('selfuse')) {
      return { isChargeRule: false, isFeedinRule: false, ruleType: 'Self Use' };
    }
    if (text.includes('backup')) {
      return { isChargeRule: false, isFeedinRule: false, ruleType: 'Backup' };
    }
    if (
      text.includes('discharge') ||
      text.includes('feed in') ||
      text.includes('feed-in') ||
      text.includes('feedin') ||
      text.includes('export') ||
      text.includes('empty')
    ) {
      return { isChargeRule: false, isFeedinRule: true, ruleType: 'Discharge' };
    }
    if (text.includes('charge')) {
      return { isChargeRule: true, isFeedinRule: false, ruleType: 'Charge' };
    }

    return { isChargeRule: false, isFeedinRule: false, ruleType: 'Unknown' };
  }

  function resolveRoiEventClassification(event = {}) {
    const fromRoiSnapshot = classifyFromWorkMode(event?.roiSnapshot?.workMode);
    if (fromRoiSnapshot) {
      return fromRoiSnapshot;
    }

    const fromAction = classifyFromWorkMode(event?.action?.workMode);
    if (fromAction) {
      return fromAction;
    }

    const triggeredRuleName = findTriggeredRuleName(event.startAllRules) || event.ruleName || null;
    const fromName = inferFromRuleName(triggeredRuleName);
    if (fromName) {
      return fromName;
    }

    return {
      isChargeRule: false,
      isFeedinRule: false,
      ruleType: 'Unknown'
    };
  }

  return {
    resolveRoiEventClassification
  };
});
