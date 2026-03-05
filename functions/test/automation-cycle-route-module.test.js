'use strict';

const express = require('express');
const request = require('supertest');

const { registerAutomationCycleRoute } = require('../api/routes/automation-cycle');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

function buildDeps(overrides = {}) {
  return {
    addAutomationAuditEntry: jest.fn(async () => undefined),
    amberAPI: {
      cacheAmberPricesCurrent: jest.fn(async () => undefined),
      cacheAmberSites: jest.fn(async () => undefined),
      callAmberAPI: jest.fn(async () => []),
      getCachedAmberPricesCurrent: jest.fn(async () => null),
      getCachedAmberSites: jest.fn(async () => null)
    },
    amberPricesInFlight: new Map(),
    applyRuleAction: jest.fn(async () => ({ errno: 0 })),
    checkAndApplyCurtailment: jest.fn(async () => ({ enabled: false })),
    cleanupExpiredQuickControl: jest.fn(async () => undefined),
    evaluateRule: jest.fn(async () => ({ triggered: false, results: [] })),
    findValue: jest.fn(() => null),
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: {} }))
    },
    getAutomationTimezone: jest.fn(() => 'Australia/Sydney'),
    getCachedInverterData: jest.fn(async () => null),
    getCachedInverterRealtimeData: jest.fn(async () => null),
    getCachedWeatherData: jest.fn(async () => null),
    getQuickControlState: jest.fn(async () => null),
    getUserAutomationState: jest.fn(async () => ({ enabled: true })),
    getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] } })),
    getUserRules: jest.fn(async () => ({})),
    getUserTime: jest.fn(() => ({ dayOfWeek: 1, hour: 12, minute: 0 })),
    isForecastTemperatureType: jest.fn(() => false),
    logger: { debug: jest.fn(), warn: jest.fn() },
    saveUserAutomationState: jest.fn(async () => undefined),
    serverTimestamp: jest.fn(() => '__TS__'),
    setUserRule: jest.fn(async () => undefined),
    ...overrides
  };
}

describe('automation cycle route module', () => {
  test('returns automation-disabled skip response when state.enabled is false', async () => {
    const deps = buildDeps({
      getUserAutomationState: jest.fn(async () => ({
        activeRule: null,
        enabled: false,
        segmentsCleared: true
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-disabled' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        reason: 'Automation disabled',
        segmentsCleared: true,
        skipped: true
      }
    });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-disabled',
      expect.objectContaining({
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false,
        lastCheck: expect.any(Number)
      })
    );
  });

  test('returns quick-control-active skip response', async () => {
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const deps = buildDeps({
      getQuickControlState: jest.fn(async () => ({
        active: true,
        expiresAt,
        power: 4200,
        type: 'charge'
      })),
      getUserAutomationState: jest.fn(async () => ({ enabled: true }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-quick' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.skipped).toBe(true);
    expect(response.body.result.reason).toBe('Quick control active');
    expect(response.body.result.quickControl).toEqual(expect.objectContaining({
      power: 4200,
      type: 'charge'
    }));
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-quick',
      expect.objectContaining({ lastCheck: expect.any(Number) })
    );
  });

  test('returns no-rules-configured skip response when user has zero rules', async () => {
    const deps = buildDeps({
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] } })),
      getUserRules: jest.fn(async () => ({}))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-rules' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: { reason: 'No rules configured', skipped: true }
    });
    expect(deps.getUserRules).toHaveBeenCalledWith('u-cycle-rules');
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-rules',
      expect.objectContaining({
        inBlackout: false,
        lastCheck: expect.any(Number)
      })
    );
  });
});
