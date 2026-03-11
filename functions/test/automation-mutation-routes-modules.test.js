'use strict';

const express = require('express');
const request = require('supertest');

const { registerAutomationMutationRoutes } = require('../api/routes/automation-mutations');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

function compare(actual, operator, target, target2) {
  switch (operator) {
    case '>':
      return actual > target;
    case '>=':
      return actual >= target;
    case '<':
      return actual < target;
    case '<=':
      return actual <= target;
    case '==':
    case '=':
      return actual === target;
    case 'between':
      return actual >= target && actual <= target2;
    default:
      return false;
  }
}

function createDbMock({ curtailmentActive = false } = {}) {
  const stateGet = jest.fn(async () => (
    curtailmentActive
      ? { exists: true, data: () => ({ active: true }) }
      : { exists: false, data: () => ({ active: false }) }
  ));
  const stateSet = jest.fn(async () => undefined);

  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: stateGet,
            set: stateSet
          }))
        }))
      }))
    }))
  };

  return {
    db,
    stateGet,
    stateSet
  };
}

function buildDeps(overrides = {}) {
  const dbMock = createDbMock();

  return {
    addAutomationAuditEntry: jest.fn(async () => undefined),
    addHistoryEntry: jest.fn(async () => undefined),
    adapterRegistry: null,
    applyRuleAction: jest.fn(async () => ({ applied: true })),
    clearRulesLastTriggered: jest.fn(async () => undefined),
    compareValue: compare,
    db: dbMock.db,
    DEFAULT_TIMEZONE: 'Australia/Sydney',
    deleteUserRule: jest.fn(async () => undefined),
    evaluateTemperatureCondition: jest.fn(() => ({
      actual: 20,
      met: true,
      operator: '>',
      source: 'device',
      target: 10,
      type: 'ambient'
    })),
    evaluateTimeCondition: jest.fn(() => ({
      actualTime: '10:00',
      daysLabel: 'Mon',
      endTime: '17:00',
      met: true,
      startTime: '09:00'
    })),
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, msg: 'ok', result: {} }))
    },
    getAutomationAuditLogs: jest.fn(async () => []),
    getUserAutomationState: jest.fn(async () => ({ enabled: true })),
    getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DEFAULT' })),
    getUserRule: jest.fn(async () => ({ data: { action: { mode: 'SelfUse' } } })),
    getUserRules: jest.fn(async () => ({})),
    getUserTime: jest.fn(() => ({ dayOfWeek: 1, hour: 10, minute: 0 })),
    logger: { debug: jest.fn(), warn: jest.fn() },
    normalizeWeekdays: jest.fn((days) => days),
    saveUserAutomationState: jest.fn(async () => undefined),
    serverTimestamp: jest.fn(() => '__TS__'),
    setUserRule: jest.fn(async () => undefined),
    validateRuleActionForUser: jest.fn(() => null),
    ...overrides
  };
}

describe('automation mutation route module', () => {
  test('toggle route restores curtailment and persists enabled=false', async () => {
    const dbMock = createDbMock({ curtailmentActive: true });
    const deps = buildDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-TOGGLE' }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-toggle' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/toggle')
      .send({ enabled: false });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { enabled: false } });
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/set',
      'POST',
      { key: 'ExportLimit', sn: 'SN-TOGGLE', value: 12000 },
      { deviceSn: 'SN-TOGGLE' },
      'u-toggle'
    );
    expect(dbMock.stateSet).toHaveBeenCalledWith({
      active: false,
      disabledByAutomationToggle: true,
      lastDeactivated: expect.any(Number),
      lastPrice: null
    });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith('u-toggle', { enabled: false });
  });

  test('toggle route clears curtailment state without FoxESS API for non-FoxESS providers', async () => {
    const dbMock = createDbMock({ curtailmentActive: true });
    const deps = buildDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-TOGGLE-1'
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-toggle-alpha' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/toggle')
      .send({ enabled: false });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { enabled: false } });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(dbMock.stateSet).toHaveBeenCalledWith(expect.objectContaining({
      active: false,
      disabledByAutomationToggle: true,
      disabledReason: 'automation_toggle'
    }));
  });

  test('enable route resets segmentsCleared when enabling', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-enable' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/enable')
      .send({ enabled: true });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { enabled: true } });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith('u-enable', {
      enabled: true,
      segmentsCleared: false
    });
  });

  test('trigger route validates ruleName', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-trigger' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/trigger')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Rule name is required' });
  });

  test('reset route clears state and rule cooldowns', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-reset' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/reset')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: 'Automation state reset' });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith('u-reset', {
      activeRule: null,
      lastCheck: null,
      lastTriggered: null
    });
    expect(deps.clearRulesLastTriggered).toHaveBeenCalledWith('u-reset');
  });

  test('cancel route returns 400 when device SN is missing', async () => {
    const deps = buildDeps({
      getUserConfig: jest.fn(async () => ({}))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cancel' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cancel')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Device SN not configured' });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('cancel route clears schedule, disables scheduler flag, verifies and logs history', async () => {
    const deps = buildDeps({
      foxessAPI: {
        callFoxESSAPI: jest.fn(async (path, _method, payload) => {
          if (path === '/op/v1/device/scheduler/enable') {
            return { errno: 0, msg: 'ok', result: { groups: payload.groups } };
          }
          if (path === '/op/v1/device/scheduler/set/flag') {
            return { errno: 0, result: { enable: payload.enable } };
          }
          if (path === '/op/v1/device/scheduler/get') {
            return { errno: 0, result: { groups: [{ enable: 0 }], enable: false } };
          }
          return { errno: 0, result: {} };
        })
      },
      getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-CANCEL' }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cancel' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cancel')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      flagResult: { errno: 0, result: { enable: 0 } },
      msg: 'ok',
      verify: { groups: [{ enable: 0 }], enable: false }
    });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith('u-cancel', { activeRule: null });
    expect(deps.addHistoryEntry).toHaveBeenCalledWith('u-cancel', {
      timestamp: '__TS__',
      type: 'automation_cancel'
    });

    const setCall = deps.foxessAPI.callFoxESSAPI.mock.calls.find(
      (call) => call[0] === '/op/v1/device/scheduler/enable'
    );
    expect(setCall[2].deviceSN).toBe('SN-CANCEL');
    expect(setCall[2].groups).toHaveLength(8);
  });

  test('cancel route dispatches to adapter for non-FoxESS providers', async () => {
    const clearSchedule = jest.fn(async () => ({ errno: 0, msg: 'adapter cleared', result: { ok: true } }));
    const getSchedule = jest.fn(async () => ({ errno: 0, result: { groups: [{ enable: 0 }], enable: false } }));
    const deps = buildDeps({
      adapterRegistry: {
        getDeviceProvider: jest.fn(() => ({ clearSchedule, getSchedule }))
      },
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-CANCEL-1'
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cancel-alpha' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cancel')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      flagResult: null,
      msg: 'adapter cleared',
      verify: { groups: [{ enable: 0 }], enable: false }
    });
    expect(clearSchedule).toHaveBeenCalledWith({
      deviceSN: 'ALPHA-CANCEL-1',
      userConfig: {
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-CANCEL-1'
      },
      userId: 'u-cancel-alpha'
    });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('rule create validates cooldown range', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-rule-create' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/rule/create')
      .send({
        action: {},
        cooldownMinutes: 0,
        name: 'Rule A'
      });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'cooldownMinutes must be an integer between 1 and 1440'
    });
    expect(deps.setUserRule).not.toHaveBeenCalled();
  });

  test('rule update disables active rule, clears segments, records audit, and saves merged update', async () => {
    const deps = buildDeps({
      getUserAutomationState: jest.fn(async () => ({
        activeRule: 'my_rule',
        activeRuleName: 'My Rule',
        lastTriggered: 1000
      })),
      getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-RULE' })),
      getUserRule: jest.fn(async () => ({ data: { action: { mode: 'SelfUse', power: 1000 } } }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-rule-update' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/rule/update')
      .send({
        action: { power: 2000 },
        enabled: false,
        ruleName: 'my rule'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);

    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/enable',
      'POST',
      expect.objectContaining({
        deviceSN: 'SN-RULE',
        groups: expect.any(Array)
      }),
      { deviceSn: 'SN-RULE' },
      'u-rule-update'
    );
    expect(deps.addAutomationAuditEntry).toHaveBeenCalledWith(
      'u-rule-update',
      expect.objectContaining({
        reason: 'Rule disabled by user',
        ruleId: 'my_rule',
        triggered: false
      })
    );
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith('u-rule-update', {
      activeRule: null,
      activeRuleName: null,
      activeSegment: null,
      activeSegmentEnabled: false
    });
    expect(deps.setUserRule).toHaveBeenCalledWith(
      'u-rule-update',
      'my_rule',
      expect.objectContaining({
        action: { mode: 'SelfUse', power: 2000 },
        enabled: false,
        lastTriggered: null,
        updatedAt: '__TS__'
      }),
      { merge: true }
    );
  });

  test('rule update on non-FoxESS clears active segments via adapter', async () => {
    const clearSchedule = jest.fn(async () => ({ errno: 0, msg: 'adapter cleared' }));
    const getSchedule = jest.fn(async () => ({ errno: 0, result: { groups: [], enable: false } }));
    const deps = buildDeps({
      adapterRegistry: {
        getDeviceProvider: jest.fn(() => ({ clearSchedule, getSchedule }))
      },
      getUserAutomationState: jest.fn(async () => ({
        activeRule: 'my_rule',
        activeRuleName: 'My Rule',
        lastTriggered: 1000
      })),
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-RULE-1'
      })),
      getUserRule: jest.fn(async () => ({ data: { action: { mode: 'SelfUse', power: 1000 } } }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-rule-update-alpha' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/rule/update')
      .send({
        action: { power: 2000 },
        enabled: false,
        ruleName: 'my rule'
      });

    expect(response.statusCode).toBe(200);
    expect(clearSchedule).toHaveBeenCalledWith({
      deviceSN: 'ALPHA-RULE-1',
      userConfig: {
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-RULE-1'
      },
      userId: 'u-rule-update-alpha'
    });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('rule end route rejects missing identifiers', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-rule-end' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/rule/end')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'ruleId or ruleName is required' });
  });

  test('automation test route returns first matching rule', async () => {
    const deps = buildDeps({
      getUserRules: jest.fn(async () => ({
        charge_rule: {
          action: { mode: 'ForceCharge' },
          conditions: { feedInPrice: { enabled: true, operator: '>', value: 10 } },
          enabled: true,
          name: 'Charge Rule',
          priority: 1
        },
        fallback_rule: {
          action: { mode: 'SelfUse' },
          conditions: {},
          enabled: true,
          name: 'Fallback Rule',
          priority: 2
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-rule-test' };
        next();
      });
      registerAutomationMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/test')
      .send({
        mockData: {
          feedInPrice: 15
        }
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.triggered).toBe(true);
    expect(response.body.result).toEqual({
      action: { mode: 'ForceCharge' },
      priority: 1,
      ruleId: 'charge_rule',
      ruleName: 'Charge Rule'
    });
    expect(response.body.allResults).toHaveLength(1);
  });
});
