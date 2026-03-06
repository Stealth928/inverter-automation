'use strict';

const { buildAllRuleEvaluationsForAudit } = require('../lib/services/automation-audit-service');

describe('automation audit service', () => {
  test('buildAllRuleEvaluationsForAudit maps evaluation details to audit shape', () => {
    const evaluationResults = [{
      details: {
        buyPrice: 21.5,
        feedInPrice: 8.4,
        results: [{
          actual: 75,
          condition: 'soc',
          met: true,
          operator: '>=',
          target: 60
        }]
      },
      result: 'triggered',
      rule: 'Charge Rule'
    }];

    const sortedRules = [
      ['charge_rule', { name: 'Charge Rule', priority: 1 }]
    ];

    const mapped = buildAllRuleEvaluationsForAudit(evaluationResults, sortedRules);

    expect(mapped).toEqual([{
      buyPrice: 21.5,
      conditions: [{
        met: true,
        name: 'soc',
        rule: 'soc >= 60',
        value: '75'
      }],
      feedInPrice: 8.4,
      name: 'Charge Rule',
      ruleId: 'charge_rule',
      triggered: true
    }]);
  });

  test('buildAllRuleEvaluationsForAudit handles missing details safely', () => {
    const evaluationResults = [{
      result: 'not_met',
      rule: 'Fallback Rule'
    }];

    const mapped = buildAllRuleEvaluationsForAudit(evaluationResults, []);

    expect(mapped).toEqual([{
      buyPrice: null,
      conditions: [],
      feedInPrice: null,
      name: 'Fallback Rule',
      ruleId: 'Fallback Rule',
      triggered: false
    }]);
  });

  test('buildAllRuleEvaluationsForAudit returns empty array for invalid input', () => {
    expect(buildAllRuleEvaluationsForAudit(null, null)).toEqual([]);
    expect(buildAllRuleEvaluationsForAudit(undefined, [])).toEqual([]);
  });
});
