'use strict';

const express = require('express');
const request = require('supertest');

const { registerAutomationHistoryRoutes } = require('../api/routes/automation-history');

function createDeps(overrides = {}) {
  return {
    getAutomationAuditLogs: jest.fn(async () => []),
    getUserHistoryEntries: jest.fn(async () => []),
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: 'u-history' };
    next();
  });
  registerAutomationHistoryRoutes(app, deps);
  return app;
}

describe('automation history route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerAutomationHistoryRoutes(app, {}))
      .toThrow('registerAutomationHistoryRoutes requires getAutomationAuditLogs()');
  });

  test('history route returns entries with parsed limit', async () => {
    const getUserHistoryEntries = jest.fn(async () => [{ type: 'automation_action' }]);
    const deps = createDeps({ getUserHistoryEntries });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/automation/history')
      .query({ limit: '25' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: [{ type: 'automation_action' }] });
    expect(getUserHistoryEntries).toHaveBeenCalledWith('u-history', 25);
  });

  test('audit route rejects invalid explicit date range', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/automation/audit')
      .query({ startDate: 'bad-date', endDate: '2026-03-06' });

    expect(response.statusCode).toBe(400);
    expect(response.body.errno).toBe(400);
    expect(response.body.error).toContain('Invalid date format');
  });

  test('audit route builds complete rule event from on/off pair', async () => {
    const startEpoch = Date.now() - 60000;
    const endEpoch = startEpoch + 30000;
    const auditLogs = [
      {
        epochMs: endEpoch,
        activeRuleBefore: 'rule-1',
        activeRuleAfter: null,
        evaluationResults: [{ condition: 'soc', met: false }],
        allRuleEvaluations: [{ name: 'Rule One', matched: false }]
      },
      {
        epochMs: startEpoch,
        triggered: true,
        activeRuleBefore: null,
        activeRuleAfter: 'rule-1',
        ruleName: 'Rule One',
        ruleId: 'rule-1',
        evaluationResults: [{ condition: 'soc', met: true }],
        allRuleEvaluations: [{ name: 'Rule One', matched: true }],
        actionTaken: { type: 'forceCharge' },
        roiSnapshot: { estimatedRevenue: 1.2 }
      }
    ];
    const getAutomationAuditLogs = jest.fn(async () => auditLogs);
    const deps = createDeps({ getAutomationAuditLogs });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/automation/audit')
      .query({ days: '1' });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.count).toBe(2);
    expect(response.body.result.eventsCount).toBe(1);
    expect(response.body.result.ruleEvents[0]).toEqual(expect.objectContaining({
      type: 'complete',
      ruleId: 'rule-1',
      ruleName: 'Rule One',
      startTime: startEpoch,
      endTime: endEpoch,
      durationMs: endEpoch - startEpoch
    }));
  });

  test('audit route emits ongoing event when rule has no end event yet', async () => {
    const startEpoch = Date.now() - 120000;
    const auditLogs = [
      {
        epochMs: startEpoch,
        triggered: true,
        activeRuleBefore: null,
        activeRuleAfter: 'rule-ongoing',
        ruleName: 'Rule Ongoing',
        ruleId: 'rule-ongoing',
        evaluationResults: [{ condition: 'price', met: true }],
        allRuleEvaluations: [{ name: 'Rule Ongoing', matched: true }],
        actionTaken: { type: 'forceDischarge' },
        roiSnapshot: { estimatedRevenue: 0.7 }
      }
    ];
    const getAutomationAuditLogs = jest.fn(async () => auditLogs);
    const deps = createDeps({ getAutomationAuditLogs });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/automation/audit')
      .query({ days: '1' });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.eventsCount).toBe(1);
    expect(response.body.result.ruleEvents[0]).toEqual(expect.objectContaining({
      type: 'ongoing',
      ruleId: 'rule-ongoing',
      ruleName: 'Rule Ongoing',
      startTime: startEpoch,
      endTime: null
    }));
  });
});
