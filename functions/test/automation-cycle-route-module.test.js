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

function buildFreshTelemetryPayload(overrides = {}) {
  const baseFrame = {
    time: new Date().toISOString(),
    datas: [
      { variable: 'SoC', value: 55 },
      { variable: 'pvPower', value: 1200 },
      { variable: 'loadsPower', value: 900 },
      { variable: 'gridConsumptionPower', value: 200 },
      { variable: 'feedinPower', value: 0 }
    ]
  };
  return {
    errno: 0,
    result: [mergeObjects(baseFrame, overrides.frame || {})],
    ...overrides.topLevel
  };
}

function mergeObjects(target, source) {
  return { ...(target || {}), ...(source || {}) };
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
    evaluateActiveRuleEnergyCap: jest.fn(async () => ({ applicable: false, reached: false, statePatch: { activeEnergyTracking: null } })),
    evaluateRule: jest.fn(async () => ({ triggered: false, results: [] })),
    findValue: jest.fn(() => null),
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: {} }))
    },
    getAutomationTimezone: jest.fn(() => 'Australia/Sydney'),
    getCachedInverterData: jest.fn(async () => buildFreshTelemetryPayload()),
    getCachedInverterRealtimeData: jest.fn(async () => null),
    getCachedWeatherData: jest.fn(async () => null),
    getQuickControlState: jest.fn(async () => null),
    getUserAutomationState: jest.fn(async () => ({ enabled: true })),
    getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] } })),
    getUserRules: jest.fn(async () => ({})),
    getUserTime: jest.fn(() => ({ dayOfWeek: 1, hour: 12, minute: 0 })),
    isForecastTemperatureType: jest.fn(() => false),
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    emitAutomationNotification: jest.fn(async () => ({ sent: true })),
    saveUserAutomationState: jest.fn(async () => undefined),
    serverTimestamp: jest.fn(() => '__TS__'),
    setUserRule: jest.fn(async () => undefined),
    ...overrides
  };
}

describe('automation cycle route module', () => {
  test('registerAutomationCycleRoute returns handler reference for scheduler reuse', () => {
    const app = express();
    const deps = buildDeps();

    const handler = registerAutomationCycleRoute(app, deps);
    expect(typeof handler).toBe('function');
  });

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
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        reason: 'Automation disabled',
        segmentsCleared: true,
        skipped: true,
        cycleDurationMs: expect.any(Number),
        phaseTimingsMs: expect.objectContaining({
          dataFetchMs: expect.any(Number),
          ruleEvalMs: expect.any(Number),
          actionApplyMs: expect.any(Number),
          curtailmentMs: expect.any(Number)
        })
      })
    }));
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-disabled',
      expect.objectContaining({
        activeRule: null,
        activeRuleName: null,
        activeEnergyTracking: null,
        activeSegment: null,
        activeSegmentEnabled: false,
        lastCheck: expect.any(Number),
        telemetryFailsafePaused: false,
        telemetryFailsafePauseReason: null,
        telemetryFingerprint: null,
        telemetryFingerprintSinceMs: null
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
      expect.objectContaining({
        lastCheck: expect.any(Number),
        telemetryFailsafePaused: false,
        telemetryFailsafePauseReason: null
      })
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
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        reason: 'No rules configured',
        skipped: true,
        cycleDurationMs: expect.any(Number),
        phaseTimingsMs: expect.objectContaining({
          dataFetchMs: expect.any(Number),
          ruleEvalMs: expect.any(Number),
          actionApplyMs: expect.any(Number),
          curtailmentMs: expect.any(Number)
        })
      })
    }));
    expect(deps.getUserRules).toHaveBeenCalledWith('u-cycle-rules', { enabledOnly: true });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-rules',
      expect.objectContaining({
        inBlackout: false,
        lastCheck: expect.any(Number),
        telemetryFailsafePaused: false,
        telemetryFailsafePauseReason: null
      })
    );
  });

  test('emits curtailment transition notification when curtailment state changes', async () => {
    const deps = buildDeps({
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-CURT-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      })),
      evaluateRule: jest.fn(async () => ({ triggered: false, conditions: [] })),
      checkAndApplyCurtailment: jest.fn(async () => ({
        enabled: true,
        adjusted: true,
        stateChanged: true,
        action: 'activated',
        currentPrice: -2.5,
        priceThreshold: 0
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-curtailment-notify' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(deps.emitAutomationNotification).toHaveBeenCalledWith(
      'u-cycle-curtailment-notify',
      expect.objectContaining({
        eventType: 'curtailment_activated',
        preferenceScope: 'curtailment'
      })
    );
  });

  test('clears segments and exits when clearSegmentsOnNextCycle flag is set', async () => {
    const deps = buildDeps({
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ clearSegmentsOnNextCycle: true, enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-FLAG-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: { enabled: true, name: 'Rule A', priority: 1 }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-clear-flag' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        skipped: true,
        reason: 'Rule was disabled - segments cleared',
        segmentsCleared: true,
        cycleDurationMs: expect.any(Number),
        phaseTimingsMs: expect.objectContaining({
          dataFetchMs: expect.any(Number),
          ruleEvalMs: expect.any(Number),
          actionApplyMs: expect.any(Number),
          curtailmentMs: expect.any(Number)
        })
      })
    }));
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/enable',
      'POST',
      expect.objectContaining({
        deviceSN: 'SN-FLAG-1',
        groups: expect.any(Array)
      }),
      expect.objectContaining({ deviceSn: 'SN-FLAG-1' }),
      'u-cycle-clear-flag'
    );
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-clear-flag',
      expect.objectContaining({
        clearSegmentsOnNextCycle: false,
        telemetryFailsafePaused: false,
        telemetryFailsafePauseReason: null
      })
    );
  });

  test('gracefully degrades when weather fetch rejects during data fan-out', async () => {
    const deps = buildDeps({
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-WEATHER-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Weather Rule',
          priority: 1,
          conditions: {
            solarRadiation: { enabled: true, lookAhead: 6, lookAheadUnit: 'hours' }
          }
        }
      })),
      getCachedWeatherData: jest.fn(async () => {
        throw new Error('weather upstream failed');
      }),
      evaluateRule: jest.fn(async () => ({ triggered: false, conditions: [] })),
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-weather-degrade' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        triggered: false,
        rulesEvaluated: 1,
        cycleDurationMs: expect.any(Number)
      })
    }));
    expect(deps.getCachedWeatherData).toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Weather fetch degraded: weather upstream failed'));
    expect(deps.evaluateRule).toHaveBeenCalled();
  });

  test('returns non-200 when segment apply fails so scheduler can retry/fail the cycle', async () => {
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({
        triggered: true,
        conditions: [{ passed: true }]
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-ERR-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      })),
      applyRuleAction: jest.fn(async () => ({ errno: 503, msg: 'Upstream timeout' }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-action-fail' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 503,
      error: expect.stringContaining('Action apply failed')
    }));
    expect(deps.applyRuleAction).toHaveBeenCalled();
    expect(deps.addAutomationAuditEntry).not.toHaveBeenCalled();
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-action-fail',
      expect.objectContaining({
        activeRule: 'ruleA',
        activeRuleName: 'Rule A',
        activeSegmentEnabled: false,
        lastActionResult: expect.objectContaining({ errno: 503 })
      })
    );
    expect(deps.emitAutomationNotification).toHaveBeenCalledWith(
      'u-cycle-action-fail',
      expect.objectContaining({
        eventType: 'cycle_failure',
        preferenceScope: 'highSignalAutomation'
      })
    );
  });

  test('maps upstream action auth failures to a non-auth HTTP status', async () => {
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({
        triggered: true,
        conditions: [{ passed: true }]
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-ERR-401' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceDischarge', durationMinutes: 30, fdPwr: 2500, fdSoc: 20, minSocOnGrid: 20 }
        }
      })),
      applyRuleAction: jest.fn(async () => ({ errno: 401, msg: 'FoxESS token rejected' }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-action-auth-fail' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 502,
      error: expect.stringContaining('Action apply failed')
    }));
    expect(deps.applyRuleAction).toHaveBeenCalled();
  });

  test('cancels an active rule when its stop-on-energy cap is reached and preserves cooldown timing', async () => {
    const deps = buildDeps({
      evaluateActiveRuleEnergyCap: jest.fn(async () => ({
        applicable: true,
        condition: {
          condition: 'energyCap',
          met: false,
          actual: 15.1,
          operator: '<',
          target: 15,
          direction: 'export',
          unit: 'kWh',
          reason: 'Stop cap reached: exported 15.100 of 15.000 kWh'
        },
        reached: true,
        statePatch: {
          activeEnergyTracking: {
            direction: 'export',
            progressKwh: 15.1,
            ruleId: 'ruleA',
            targetKwh: 15
          }
        }
      })),
      evaluateRule: jest.fn(async () => ({
        triggered: true,
        results: [{ condition: 'feedInPrice', met: true, actual: 25, operator: '>=', target: 20 }]
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({
        activeRule: 'ruleA',
        activeRuleName: 'Rule A',
        activeSegmentEnabled: true,
        enabled: true
      })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-CAP-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          cooldownMinutes: 5,
          action: { workMode: 'ForceDischarge', durationMinutes: 30, fdPwr: 5000, stopOnEnergyKwh: 15 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-cap-stop' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        triggered: false,
        rulesEvaluated: 1
      })
    }));
    expect(deps.evaluateActiveRuleEnergyCap).toHaveBeenCalledWith(expect.objectContaining({
      ruleId: 'ruleA',
      userId: 'u-cycle-cap-stop'
    }));
    expect(deps.serverTimestamp).toHaveBeenCalled();
    expect(deps.setUserRule).toHaveBeenCalledWith('u-cycle-cap-stop', 'ruleA', { lastTriggered: '__TS__' }, { merge: true });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-cap-stop',
      expect.objectContaining({
        activeRule: null,
        activeRuleName: null,
        activeEnergyTracking: null,
        activeSegment: null,
        activeSegmentEnabled: false
      })
    );
    expect(deps.addAutomationAuditEntry).toHaveBeenCalledWith(
      'u-cycle-cap-stop',
      expect.objectContaining({
        evaluationResults: expect.arrayContaining([
          expect.objectContaining({ condition: 'energyCap', met: false, target: 15 })
        ]),
        triggered: false
      })
    );
  });

  test('cancels an active rule on normal condition failure and still clears cooldown immediately', async () => {
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({
        triggered: false,
        results: [{ condition: 'feedInPrice', met: false, actual: 5, operator: '>=', target: 20 }]
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({
        activeRule: 'ruleA',
        activeRuleName: 'Rule A',
        activeSegmentEnabled: true,
        enabled: true
      })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-NORMAL-CANCEL-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          cooldownMinutes: 5,
          conditions: {
            feedInPrice: { enabled: true, operator: '>=', value: 20 }
          },
          action: { workMode: 'ForceDischarge', durationMinutes: 30, fdPwr: 5000, stopOnEnergyKwh: 15 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-normal-cancel' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app)
      .post('/api/automation/cycle')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        triggered: false,
        rulesEvaluated: 1
      })
    }));
    expect(deps.evaluateActiveRuleEnergyCap).not.toHaveBeenCalled();
    expect(deps.serverTimestamp).not.toHaveBeenCalled();
    expect(deps.setUserRule).toHaveBeenCalledWith('u-cycle-normal-cancel', 'ruleA', { lastTriggered: null }, { merge: true });
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-normal-cancel',
      expect.objectContaining({
        activeRule: null,
        activeRuleName: null,
        activeEnergyTracking: null,
        activeSegment: null,
        activeSegmentEnabled: false
      })
    );
  });

  test('healthy cycle without trigger performs a single state write', async () => {
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({
        triggered: false,
        conditions: [{ passed: false }]
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-HEALTH-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-single-write' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app).post('/api/automation/cycle').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        triggered: false,
        telemetry: expect.objectContaining({
          status: 'healthy',
          pauseReason: null
        })
      })
    }));
    expect(deps.saveUserAutomationState).toHaveBeenCalledTimes(1);
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-single-write',
      expect.objectContaining({
        inBlackout: false,
        lastCheck: expect.any(Number),
        telemetryFailsafePaused: false,
        telemetryHealthStatus: 'healthy'
      })
    );
  });

  test('scheduler-preloaded context avoids redundant state, config, and rule reads', async () => {
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({
        triggered: false,
        conditions: [{ passed: false }]
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-PRELOAD-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-preload' };
        req.schedulerContext = {
          userConfig: { automation: { blackoutWindows: [] }, deviceSn: 'SN-PRELOAD-1' },
          rules: {
            ruleA: {
              enabled: true,
              name: 'Rule A',
              priority: 1,
              action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
            }
          },
          state: { enabled: true },
          userId: 'u-cycle-preload'
        };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app).post('/api/automation/cycle').send({});

    expect(response.statusCode).toBe(200);
    expect(deps.getUserAutomationState).not.toHaveBeenCalled();
    expect(deps.getUserConfig).not.toHaveBeenCalled();
    expect(deps.getUserRules).not.toHaveBeenCalled();
  });

  test('skips cycle when telemetry timestamp is older than 30 minutes', async () => {
    const staleIso = new Date(Date.now() - (31 * 60 * 1000)).toISOString();
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({ triggered: true })),
      getCachedInverterData: jest.fn(async () => buildFreshTelemetryPayload({
        frame: { time: staleIso }
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({ enabled: true })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-STALE-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-stale' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app).post('/api/automation/cycle').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        skipped: true,
        reason: 'stale_telemetry',
        curtailment: expect.objectContaining({
          enabled: false
        }),
        telemetry: expect.objectContaining({
          status: 'paused',
          pauseReason: 'stale_telemetry',
          ageMs: expect.any(Number),
          freshnessMaxAgeMs: 30 * 60 * 1000
        })
      })
    }));
    expect(deps.evaluateRule).not.toHaveBeenCalled();
    expect(deps.applyRuleAction).not.toHaveBeenCalled();
    expect(deps.checkAndApplyCurtailment).toHaveBeenCalledWith(
      'u-cycle-stale',
      expect.objectContaining({ deviceSn: 'SN-STALE-1' }),
      null
    );
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-stale',
      expect.objectContaining({
        telemetryFailsafePaused: true,
        telemetryFailsafePauseReason: 'stale_telemetry',
        telemetryHealthStatus: 'paused'
      })
    );
    expect(deps.emitAutomationNotification).toHaveBeenCalledWith(
      'u-cycle-stale',
      expect.objectContaining({
        eventType: 'telemetry_pause',
        preferenceScope: 'highSignalAutomation'
      })
    );
  });

  test('skips cycle when telemetry appears frozen for over 60 minutes', async () => {
    const fingerprint = JSON.stringify({
      socPct: 55,
      pvPowerW: 1200,
      loadPowerW: 900,
      gridPowerW: 200,
      feedInPowerW: 0
    });
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({ triggered: true })),
      getCachedInverterData: jest.fn(async () => buildFreshTelemetryPayload({
        topLevel: { telemetryTimestampTrust: 'synthetic' }
      })),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({
        enabled: true,
        telemetryFingerprint: fingerprint,
        telemetryFingerprintSinceMs: Date.now() - (61 * 60 * 1000)
      })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-FROZEN-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-frozen' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app).post('/api/automation/cycle').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        skipped: true,
        reason: 'frozen_telemetry',
        curtailment: expect.objectContaining({
          enabled: false
        }),
        telemetry: expect.objectContaining({
          status: 'paused',
          pauseReason: 'frozen_telemetry',
          fingerprintAgeMs: expect.any(Number),
          timestampTrust: 'synthetic',
          frozen: true,
          frozenMaxAgeMs: 60 * 60 * 1000
        })
      })
    }));
    expect(deps.evaluateRule).not.toHaveBeenCalled();
    expect(deps.applyRuleAction).not.toHaveBeenCalled();
    expect(deps.checkAndApplyCurtailment).toHaveBeenCalledWith(
      'u-cycle-frozen',
      expect.objectContaining({ deviceSn: 'SN-FROZEN-1' }),
      null
    );
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-frozen',
      expect.objectContaining({
        telemetryFailsafePaused: true,
        telemetryFailsafePauseReason: 'frozen_telemetry',
        telemetryHealthStatus: 'paused'
      })
    );
  });

  test('continues cycle when telemetry is steady but source timestamp is trusted', async () => {
    const fingerprint = JSON.stringify({
      socPct: 55,
      pvPowerW: 1200,
      loadPowerW: 900,
      gridPowerW: 200,
      feedInPowerW: 0
    });
    const deps = buildDeps({
      evaluateRule: jest.fn(async () => ({ triggered: false, conditions: [] })),
      getCachedInverterData: jest.fn(async () => buildFreshTelemetryPayload()),
      getQuickControlState: jest.fn(async () => null),
      getUserAutomationState: jest.fn(async () => ({
        enabled: true,
        telemetryFingerprint: fingerprint,
        telemetryFingerprintSinceMs: Date.now() - (61 * 60 * 1000)
      })),
      getUserConfig: jest.fn(async () => ({ automation: { blackoutWindows: [] }, deviceSn: 'SN-STEADY-1' })),
      getUserRules: jest.fn(async () => ({
        ruleA: {
          enabled: true,
          name: 'Rule A',
          priority: 1,
          action: { workMode: 'ForceCharge', durationMinutes: 30, minSocOnGrid: 0 }
        }
      }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-cycle-steady' };
        next();
      });
      registerAutomationCycleRoute(instance, deps);
    });

    const response = await request(app).post('/api/automation/cycle').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        triggered: false,
        telemetry: expect.objectContaining({
          status: 'healthy',
          pauseReason: null,
          timestampTrust: 'source'
        })
      })
    }));
    expect(deps.evaluateRule).toHaveBeenCalled();
    expect(deps.saveUserAutomationState).toHaveBeenCalledWith(
      'u-cycle-steady',
      expect.objectContaining({
        telemetryFailsafePaused: false,
        telemetryFailsafePauseReason: null,
        telemetryHealthStatus: 'healthy',
        telemetryTimestampTrust: 'source'
      })
    );
  });
});
