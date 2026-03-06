'use strict';

function normalizeConditionForAudit(condition = {}) {
  return {
    name: condition.condition,
    met: condition.met,
    value: condition.actual !== undefined ? String(condition.actual) : (condition.reason || 'N/A'),
    rule: `${condition.condition} ${condition.operator || ''} ${condition.target || ''}`
  };
}

function buildAllRuleEvaluationsForAudit(evaluationResults, sortedRules) {
  const safeEvaluationResults = Array.isArray(evaluationResults) ? evaluationResults : [];
  const safeSortedRules = Array.isArray(sortedRules) ? sortedRules : [];

  return safeEvaluationResults.map((evalResult) => {
    const ruleData = safeSortedRules.find(([_id, rule]) => rule?.name === evalResult.rule);
    const [evalRuleId] = ruleData || [null];
    const rawConditions = Array.isArray(evalResult?.details?.results) ? evalResult.details.results : [];

    return {
      name: evalResult.rule,
      ruleId: evalRuleId || evalResult.rule,
      triggered: evalResult.result === 'triggered' || evalResult.result === 'continuing',
      feedInPrice: evalResult?.details?.feedInPrice !== undefined && evalResult?.details?.feedInPrice !== null ? evalResult.details.feedInPrice : null,
      buyPrice: evalResult?.details?.buyPrice !== undefined && evalResult?.details?.buyPrice !== null ? evalResult.details.buyPrice : null,
      conditions: rawConditions.map((condition) => normalizeConditionForAudit(condition))
    };
  });
}

module.exports = {
  buildAllRuleEvaluationsForAudit
};
