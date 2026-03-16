'use strict';

const express = require('express');
const request = require('supertest');

const { registerAdminRoutes } = require('../api/routes/admin');

function createDeps(overrides = {}) {
  const deleteUser = jest.fn(async () => undefined);

  const deps = {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'admin-uid', email: 'admin@example.com' };
      return next();
    },
    requireAdmin: (_req, _res, next) => next(),
    googleApis: null,
    getRuntimeProjectId: jest.fn(() => 'test-project'),
    listMonitoringTimeSeries: jest.fn(async () => []),
    normalizeMetricErrorMessage: jest.fn(() => 'metric error'),
    fetchCloudBillingCost: jest.fn(async () => ({
      services: [],
      totalUsd: 0,
      accountId: null,
      raw: null
    })),
    sumSeriesValues: jest.fn(() => 0),
    estimateFirestoreCostFromUsage: jest.fn(() => ({
      services: [],
      totalUsd: 0
    })),
    db: {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          set: jest.fn(async () => undefined)
        })),
        where: jest.fn(() => ({})),
        add: jest.fn(async () => undefined)
      }))
    },
    admin: {
      auth: jest.fn(() => ({
        getUser: jest.fn(async () => ({ uid: 'target-uid', email: 'target@example.com', customClaims: {} })),
        setCustomUserClaims: jest.fn(async () => undefined),
        deleteUser
      }))
    },
    serverTimestamp: jest.fn(() => '__TS__'),
    deleteUserDataTree: jest.fn(async () => undefined),
    deleteCollectionDocs: jest.fn(async () => undefined),
    normalizeCouplingValue: jest.fn((value) => value || 'unknown'),
    isAdmin: jest.fn(async () => true),
    SEED_ADMIN_EMAIL: 'admin@example.com',
    __deleteUser: deleteUser
  };

  return { ...deps, ...overrides };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerAdminRoutes(app, deps);
  return app;
}

describe('admin route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerAdminRoutes(app, {}))
      .toThrow('registerAdminRoutes requires authenticateUser middleware');
  });

  test('admin check enforces authentication middleware', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/admin/check');

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('admin check returns isAdmin result', async () => {
    const deps = createDeps({
      isAdmin: jest.fn(async () => true)
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/check')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { isAdmin: true } });
  });

  test('firestore-metrics returns 503 when googleapis is unavailable', async () => {
    const deps = createDeps({
      googleApis: null
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/firestore-metrics')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      errno: 503,
      error: 'googleapis dependency not available on server'
    });
  });

  test('firestore-metrics returns separate project cost and firestore doc-ops estimate fields', async () => {
    const deps = createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        monitoring: jest.fn(() => ({}))
      },
      listMonitoringTimeSeries: jest.fn(async () => []),
      sumSeriesValues: jest.fn(() => 0),
      fetchCloudBillingCost: jest.fn(async () => ({
        services: [
          { service: 'Cloud Functions', costUsd: 2.24 },
          { service: 'Cloud Firestore', costUsd: 1.98 },
          { service: 'Non-Firebase Services', costUsd: 0.01 }
        ],
        totalUsd: 4.23,
        accountId: '123ABC',
        raw: {}
      })),
      estimateFirestoreCostFromUsage: jest.fn(() => ({
        totalUsd: 1.98,
        isEstimate: true,
        services: [
          { service: 'Cloud Firestore reads', costUsd: 0.49 },
          { service: 'Cloud Firestore writes', costUsd: 1.45 },
          { service: 'Cloud Firestore deletes', costUsd: 0.04 }
        ]
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/firestore-metrics')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.firestore.estimatedDocOpsCostUsd).toBeCloseTo(1.98);
    expect(response.body.result.firestore.estimatedDocOpsBreakdown).toHaveLength(3);
    expect(response.body.result.billing.projectMtdCostUsd).toBeCloseTo(4.23);
    expect(response.body.result.billing.projectServices).toHaveLength(3);
    expect(response.body.result.billing.projectBillingAccountId).toBe('123ABC');
    // Backward-compatible fields retained
    expect(response.body.result.billing.estimatedMtdCostUsd).toBeCloseTo(4.23);
    expect(response.body.result.billing.services).toHaveLength(3);
  });

  test('firestore-metrics falls back to firestore doc-ops estimate when project billing is unavailable', async () => {
    const deps = createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        monitoring: jest.fn(() => ({}))
      },
      listMonitoringTimeSeries: jest.fn(async () => []),
      sumSeriesValues: jest.fn(() => 0),
      fetchCloudBillingCost: jest.fn(async () => {
        const err = new Error('billing reports unavailable');
        err.isBillingReportsUnavailable = true;
        throw err;
      }),
      estimateFirestoreCostFromUsage: jest.fn(() => ({
        totalUsd: 1.62,
        isEstimate: true,
        services: [
          { service: 'Cloud Firestore reads', costUsd: 1.25 },
          { service: 'Cloud Firestore writes', costUsd: 0.37 }
        ]
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/firestore-metrics')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.firestore.estimatedDocOpsCostUsd).toBeCloseTo(1.62);
    expect(response.body.result.billing.projectMtdCostUsd).toBeCloseTo(1.62);
    expect(response.body.result.billing.projectCostIsEstimate).toBe(true);
    expect(response.body.result.billing.projectCostSource).toBe('firestore-doc-ops-estimate');
    expect(response.body.result.billing.estimatedMtdCostUsd).toBeCloseTo(1.62);
    expect(response.body.result.billing.costSource).toBe('firestore-doc-ops-estimate');
    expect(response.body.result.warnings).toContain(
      'Project-level billing unavailable. Showing Firestore doc-op estimate only for reads/writes/deletes.'
    );
  });

  test('scheduler-metrics returns aggregate daily view with optional recent runs', async () => {
    const buildSnapshot = (docs) => ({
      size: docs.length,
      docs,
      forEach: (fn) => docs.forEach(fn)
    });

    const dailyDocs = [
      {
        id: '2026-03-06',
        data: () => ({
          dayKey: '2026-03-06',
          runs: 3,
          totalEnabledUsers: 9,
          cycleCandidates: 7,
          cyclesRun: 5,
          deadLetters: 1,
          errors: 1,
          retries: 2,
          maxQueueLagMs: 120,
          maxCycleDurationMs: 400,
          maxTelemetryAgeMs: 1900000,
          p95CycleDurationMs: 320,
          p99CycleDurationMs: 390,
          phaseTimingsMaxMs: {
            dataFetchMs: 70,
            ruleEvalMs: 45,
            actionApplyMs: 120,
            curtailmentMs: 35
          },
          skipped: {
            disabledOrBlackout: 1,
            idempotent: 1,
            locked: 1,
            tooSoon: 2
          },
          failureByType: { api_rate_limit: 1 },
          telemetryPauseReasons: { stale_telemetry: 2, frozen_telemetry: 1 },
          slo: {
            status: 'breach'
          }
        })
      },
      {
        id: '2026-03-05',
        data: () => ({
          dayKey: '2026-03-05',
          runs: 2,
          totalEnabledUsers: 8,
          cycleCandidates: 6,
          cyclesRun: 4,
          deadLetters: 0,
          errors: 0,
          retries: 1,
          maxQueueLagMs: 100,
          maxCycleDurationMs: 300,
          maxTelemetryAgeMs: 1700000,
          p95CycleDurationMs: 260,
          p99CycleDurationMs: 280,
          phaseTimingsMaxMs: {
            dataFetchMs: 60,
            ruleEvalMs: 40,
            actionApplyMs: 90,
            curtailmentMs: 20
          },
          skipped: {
            disabledOrBlackout: 0,
            idempotent: 0,
            locked: 0,
            tooSoon: 2
          },
          failureByType: { api_timeout: 2 },
          telemetryPauseReasons: { stale_telemetry: 1 },
          slo: {
            status: 'healthy'
          }
        })
      }
    ];

    const runDocs = [
      {
        id: 'run-1',
        data: () => ({
          runId: 'run-1',
          schedulerId: 'sched-1',
          workerId: 'worker-1',
          dayKey: '2026-03-06',
          startedAtMs: 1000,
          completedAtMs: 1200,
          durationMs: 200,
          totalEnabledUsers: 3,
          cycleCandidates: 3,
          cyclesRun: 2,
          deadLetters: 0,
          errors: 0,
          retries: 1,
          skipped: { disabledOrBlackout: 0, idempotent: 1, locked: 0, tooSoon: 0 },
          failureByType: { api_timeout: 1 },
          queueLagMs: { avgMs: 10, count: 3, maxMs: 20, minMs: 1, p95Ms: 18, p99Ms: 19 },
          cycleDurationMs: { avgMs: 40, count: 3, maxMs: 80, minMs: 10, p95Ms: 70, p99Ms: 79 },
          telemetryAgeMs: { avgMs: 1200000, count: 3, maxMs: 1900000, minMs: 600000, p95Ms: 1800000, p99Ms: 1900000 },
          telemetryPauseReasons: { stale_telemetry: 1 },
          phaseTimingsMs: {
            dataFetchMs: { avgMs: 18, count: 3, maxMs: 30, minMs: 10, p95Ms: 28, p99Ms: 29 },
            ruleEvalMs: { avgMs: 9, count: 3, maxMs: 16, minMs: 4, p95Ms: 15, p99Ms: 15 },
            actionApplyMs: { avgMs: 7, count: 3, maxMs: 12, minMs: 2, p95Ms: 11, p99Ms: 11 },
            curtailmentMs: { avgMs: 4, count: 3, maxMs: 9, minMs: 1, p95Ms: 8, p99Ms: 8 }
          },
          slowCycleSamples: [
            {
              userId: 'u-1',
              cycleKey: 'u-1_1',
              queueLagMs: 10,
              cycleDurationMs: 80,
              retriesUsed: 1,
              startedAtMs: 1000,
              completedAtMs: 1080,
              success: true
            }
          ]
        })
      }
    ];

    const dailyGet = jest.fn(async () => buildSnapshot(dailyDocs));
    const runsGet = jest.fn(async () => buildSnapshot(runDocs));
    const currentAlertGet = jest.fn(async () => ({
      exists: true,
      data: () => ({
        dayKey: '2026-03-06',
        runId: 'run-1',
        schedulerId: 'sched-1',
        status: 'breach',
        breachedMetrics: ['errorRatePct'],
        watchMetrics: [],
        monitoredAtMs: 1234,
        thresholds: {
          errorRatePct: 1,
          deadLetterRatePct: 0.2,
          maxQueueLagMs: 120000,
          maxCycleDurationMs: 20000,
          maxTelemetryAgeMs: 1800000,
          p99CycleDurationMs: 10000,
          tailP99CycleDurationMs: 10000,
          tailWindowMinutes: 15,
          tailMinRuns: 10
        },
        measurements: {
          cyclesRun: 9,
          errors: 1,
          deadLetters: 1,
          errorRatePct: 11.11,
          deadLetterRatePct: 11.11,
          maxQueueLagMs: 120,
          maxCycleDurationMs: 400,
          maxTelemetryAgeMs: 1900000,
          p95CycleDurationMs: 320,
          p99CycleDurationMs: 390
        },
        tailLatency: {
          metric: 'sustainedP99CycleDurationMs',
          status: 'watch',
          thresholdMs: 10000,
          windowMinutes: 15,
          minRuns: 10,
          observedRuns: 10,
          runsAboveThreshold: 8,
          ratioAboveThreshold: 0.8
        }
      })
    }));

    const deps = createDeps({
      db: {
        collection: jest.fn((name) => {
          if (name !== 'metrics') {
            throw new Error(`Unexpected collection: ${name}`);
          }
          return {
            doc: jest.fn((docId) => {
              if (docId !== 'automationScheduler') {
                throw new Error(`Unexpected metrics doc: ${docId}`);
              }
              return {
                collection: jest.fn((subName) => {
                  if (subName === 'daily') {
                    return {
                      orderBy: jest.fn(() => ({
                        limit: jest.fn(() => ({
                          get: dailyGet
                        }))
                      }))
                    };
                  }
                  if (subName === 'runs') {
                    return {
                      orderBy: jest.fn(() => ({
                        limit: jest.fn(() => ({
                          get: runsGet
                        }))
                      }))
                    };
                  }
                  if (subName === 'alerts') {
                    return {
                      doc: jest.fn((alertDocId) => {
                        if (alertDocId !== 'current') {
                          throw new Error(`Unexpected scheduler metrics alert doc: ${alertDocId}`);
                        }
                        return {
                          get: currentAlertGet
                        };
                      })
                    };
                  }
                  throw new Error(`Unexpected scheduler metrics collection: ${subName}`);
                })
              };
            })
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/scheduler-metrics?days=14&includeRuns=1&runLimit=10')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.summary).toEqual(expect.objectContaining({
      runs: 5,
      cyclesRun: 9,
      deadLetters: 1,
      errors: 1,
      retries: 3,
      maxQueueLagMs: 120,
      maxCycleDurationMs: 400,
      maxTelemetryAgeMs: 1900000,
      p95CycleDurationMs: 320,
      p99CycleDurationMs: 390,
      phaseTimingsMaxMs: {
        dataFetchMs: 70,
        ruleEvalMs: 45,
        actionApplyMs: 120,
        curtailmentMs: 35
      },
      errorRatePct: 11.11
    }));
    expect(response.body.result.summary.skipped).toEqual({
      disabledOrBlackout: 1,
      idempotent: 1,
      locked: 1,
      tooSoon: 4
    });
    expect(response.body.result.summary.failureByType).toEqual({
      api_rate_limit: 1,
      api_timeout: 2
    });
    expect(response.body.result.summary.telemetryPauseReasons).toEqual({
      stale_telemetry: 3,
      frozen_telemetry: 1
    });
    expect(response.body.result.soak).toEqual(expect.objectContaining({
      daysRequested: 14,
      daysWithData: 2,
      healthyDays: 1,
      watchDays: 0,
      breachDays: 1,
      latestDayKey: '2026-03-06',
      latestStatus: 'breach',
      status: 'breach'
    }));
    expect(response.body.result.soak.readiness).toEqual(expect.objectContaining({
      hasMinimumDays: false,
      hasNoBreachDays: false,
      latestStatusIsHealthy: false,
      readyForCloseout: false
    }));
    expect(response.body.result.daily.map((entry) => entry.dayKey)).toEqual(['2026-03-05', '2026-03-06']);
    expect(response.body.result.includeRuns).toBe(true);
    expect(response.body.result.runLimit).toBe(10);
    expect(response.body.result.recentRuns).toHaveLength(1);
    expect(response.body.result.recentRuns[0]).toEqual(expect.objectContaining({
      runId: 'run-1',
      schedulerId: 'sched-1',
      workerId: 'worker-1',
      cycleDurationMs: expect.objectContaining({
        p95Ms: 70,
        p99Ms: 79
      }),
      telemetryAgeMs: expect.objectContaining({
        maxMs: 1900000
      }),
      phaseTimingsMs: expect.objectContaining({
        dataFetchMs: expect.objectContaining({ maxMs: 30 }),
        actionApplyMs: expect.objectContaining({ maxMs: 12 })
      })
    }));
    expect(response.body.result.currentAlert).toEqual(expect.objectContaining({
      status: 'breach',
      runId: 'run-1',
      schedulerId: 'sched-1',
      breachedMetrics: ['errorRatePct'],
      thresholds: expect.objectContaining({
        maxTelemetryAgeMs: 1800000
      }),
      measurements: expect.objectContaining({
        maxTelemetryAgeMs: 1900000
      }),
      tailLatency: expect.objectContaining({
        status: 'watch'
      })
    }));
    expect(response.body.result.diagnostics).toEqual(expect.objectContaining({
      tailLatency: expect.objectContaining({
        status: 'watch'
      }),
      outlierRun: expect.objectContaining({
        runId: 'run-1',
        workerId: 'worker-1',
        likelyCauses: expect.arrayContaining(['external_api_slowness_or_retries'])
      }),
      telemetryPauseReasons: expect.objectContaining({
        stale_telemetry: 3,
        frozen_telemetry: 1
      }),
      phaseTimings: expect.objectContaining({
        latestRunStartedAtMs: 1000,
        latestRunMaxMs: expect.objectContaining({
          dataFetchMs: 30,
          actionApplyMs: 12
        }),
        windowMaxMs: expect.objectContaining({
          dataFetchMs: 70,
          ruleEvalMs: 45,
          actionApplyMs: 120,
          curtailmentMs: 35
        })
      })
    }));
    expect(dailyGet).toHaveBeenCalledTimes(1);
    expect(runsGet).toHaveBeenCalledTimes(1);
    expect(currentAlertGet).toHaveBeenCalledTimes(1);
  });

  test('scheduler-metrics skips runs query when includeRuns is not enabled', async () => {
    const buildSnapshot = (docs) => ({
      size: docs.length,
      docs,
      forEach: (fn) => docs.forEach(fn)
    });

    const dailyGet = jest.fn(async () => buildSnapshot([]));
    const runsGet = jest.fn(async () => buildSnapshot([]));

    const deps = createDeps({
      db: {
        collection: jest.fn((name) => {
          if (name !== 'metrics') {
            throw new Error(`Unexpected collection: ${name}`);
          }
          return {
            doc: jest.fn(() => ({
              collection: jest.fn((subName) => {
                if (subName === 'daily') {
                  return {
                    orderBy: jest.fn(() => ({
                      limit: jest.fn(() => ({
                        get: dailyGet
                      }))
                    }))
                  };
                }
                if (subName === 'runs') {
                  return {
                    orderBy: jest.fn(() => ({
                      limit: jest.fn(() => ({
                        get: runsGet
                      }))
                    }))
                  };
                }
                if (subName === 'alerts') {
                  return {
                    doc: jest.fn(() => ({
                      get: jest.fn(async () => ({
                        exists: false,
                        data: () => ({})
                      }))
                    }))
                  };
                }
                throw new Error(`Unexpected scheduler metrics collection: ${subName}`);
              })
            }))
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/scheduler-metrics')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.includeRuns).toBe(false);
    expect(response.body.result.runLimit).toBe(0);
    expect(response.body.result.recentRuns).toEqual([]);
    expect(response.body.result.soak).toEqual(expect.objectContaining({
      daysRequested: 14,
      daysWithData: 0,
      status: 'insufficient_data'
    }));
    expect(response.body.result.soak.readiness.readyForCloseout).toBe(false);
    expect(dailyGet).toHaveBeenCalledTimes(1);
    expect(runsGet).not.toHaveBeenCalled();
  });

  test('user stats resolves AlphaESS credential presence from secrets doc', async () => {
    const metricsGet = jest.fn(async () => ({
      size: 0,
      docs: [],
      forEach: () => {}
    }));
    const automationGet = jest.fn(async () => ({
      exists: true,
      data: () => ({ enabled: false })
    }));
    const rulesGet = jest.fn(async () => ({ size: 0 }));
    const configGet = jest.fn(async () => ({
      exists: true,
      data: () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-SN-1',
        alphaessAppId: 'alpha-app-id',
        setupComplete: false
      })
    }));
    const secretsGet = jest.fn(async () => ({
      exists: true,
      data: () => ({
        alphaessAppSecret: 'super-secret'
      })
    }));

    const userDocRef = {
      collection: jest.fn((subName) => {
        if (subName === 'metrics') {
          return {
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: metricsGet
              }))
            }))
          };
        }
        if (subName === 'automation') {
          return {
            doc: jest.fn(() => ({
              get: automationGet
            }))
          };
        }
        if (subName === 'rules') {
          return {
            get: rulesGet
          };
        }
        if (subName === 'config') {
          return {
            doc: jest.fn((docId) => {
              if (docId !== 'main') throw new Error(`Unexpected config doc: ${docId}`);
              return { get: configGet };
            })
          };
        }
        if (subName === 'secrets') {
          return {
            doc: jest.fn((docId) => {
              if (docId !== 'credentials') throw new Error(`Unexpected secrets doc: ${docId}`);
              return { get: secretsGet };
            })
          };
        }
        throw new Error(`Unexpected user subcollection: ${subName}`);
      })
    };

    const deps = createDeps({
      db: {
        collection: jest.fn((name) => {
          if (name !== 'users') {
            throw new Error(`Unexpected collection: ${name}`);
          }
          return {
            doc: jest.fn(() => userDocRef)
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/users/user-alpha/stats')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.configSummary).toEqual(expect.objectContaining({
      deviceProvider: 'alphaess',
      hasAlphaEssAppId: true,
      hasAlphaEssAppSecret: true
    }));
    expect(response.body.result.configSummary.providerAccess).toEqual(expect.objectContaining({
      credentialLabel: 'App Credentials',
      hasCredential: true
    }));
    expect(response.body.result.configSummary.alphaessAppSecret).toBeUndefined();
    expect(configGet).toHaveBeenCalledTimes(1);
    expect(secretsGet).toHaveBeenCalledTimes(1);
  });

  test('admin users summary includes EV configured coverage from vehicle existence probes', async () => {
    const userProfiles = {
      'user-1': { email: 'one@example.com', role: 'user', automationEnabled: true },
      'user-2': { email: 'two@example.com', role: 'user', automationEnabled: false }
    };
    const configByUid = {
      'user-1': {
        deviceProvider: 'foxess',
        deviceSn: 'FOX-1',
        foxessToken: 'tok-1',
        amberApiKey: 'amber-1',
        inverterCapacityW: 5000,
        location: 'Adelaide, Australia',
        systemTopology: { coupling: 'dc' }
      },
      'user-2': {
        deviceProvider: 'sungrow',
        sungrowUsername: 'sungrow-user',
        sungrowDeviceSn: 'SUN-1',
        inverterCapacityW: 8000,
        location: 'Melbourne, Australia',
        systemTopology: { coupling: 'ac' }
      }
    };
    const vehicleCountByUid = { 'user-1': 1, 'user-2': 0 };

    const makeQuerySnapshot = (docs = []) => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn)
    });

    const deps = createDeps({
      admin: {
        auth: jest.fn(() => ({
          listUsers: jest.fn(async () => ({
            users: [
              { uid: 'user-1', email: 'one@example.com', metadata: { creationTime: '2026-01-01T00:00:00.000Z', lastSignInTime: '2026-03-01T08:00:00.000Z' } },
              { uid: 'user-2', email: 'two@example.com', metadata: { creationTime: '2026-01-02T00:00:00.000Z', lastSignInTime: '2026-03-02T08:00:00.000Z' } }
            ],
            pageToken: undefined
          }))
        }))
      },
      db: {
        collection: jest.fn((name) => {
          if (name !== 'users') {
            throw new Error(`Unexpected collection: ${name}`);
          }

          return {
            get: jest.fn(async () => makeQuerySnapshot(Object.entries(userProfiles).map(([uid, data]) => ({
              id: uid,
              data: () => data
            })))),
            doc: jest.fn((uid) => ({
              collection: jest.fn((subName) => {
                if (subName === 'rules') {
                  return {
                    get: jest.fn(async () => makeQuerySnapshot([]))
                  };
                }
                if (subName === 'config') {
                  return {
                    doc: jest.fn((docId) => {
                      if (docId !== 'main') throw new Error(`Unexpected config doc: ${docId}`);
                      return {
                        get: jest.fn(async () => ({
                          exists: true,
                          data: () => configByUid[uid]
                        }))
                      };
                    })
                  };
                }
                if (subName === 'vehicles') {
                  return {
                    limit: jest.fn(() => ({
                      get: jest.fn(async () => makeQuerySnapshot(
                        vehicleCountByUid[uid] > 0
                          ? [{ id: `vehicle-${uid}`, data: () => ({ provider: 'tesla' }) }]
                          : []
                      ))
                    }))
                  };
                }
                if (subName === 'secrets') {
                  return {
                    doc: jest.fn(() => ({
                      get: jest.fn(async () => ({ exists: false, data: () => ({}) }))
                    }))
                  };
                }
                throw new Error(`Unexpected subcollection: ${subName}`);
              })
            }))
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.summary.evConfigured).toEqual(expect.objectContaining({
      available: true,
      count: 1,
      percentage: 50
    }));
    expect(response.body.result.summary.notes).toContain(
      'EV-linked percentage uses a single-document existence probe per user rather than a full vehicle scan.'
    );
    expect(response.body.result.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'user-1', hasEVConfigured: true }),
      expect.objectContaining({ uid: 'user-2', hasEVConfigured: false })
    ]));
  });

  test('admin users route paginates table rows by last sign-in without recomputing summary', async () => {
    const makeQuerySnapshot = (docs = []) => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn)
    });
    const userProfiles = {
      'user-a': { email: 'a@example.com', role: 'user', automationEnabled: false },
      'user-b': { email: 'b@example.com', role: 'user', automationEnabled: false },
      'user-c': { email: 'c@example.com', role: 'user', automationEnabled: false }
    };
    const lastSignIns = {
      'user-a': '2026-03-01T08:00:00.000Z',
      'user-b': '2026-03-03T08:00:00.000Z',
      'user-c': '2026-03-02T08:00:00.000Z'
    };

    const deps = createDeps({
      admin: {
        auth: jest.fn(() => ({
          listUsers: jest.fn(async () => ({
            users: Object.keys(userProfiles).map((uid) => ({
              uid,
              email: userProfiles[uid].email,
              metadata: {
                creationTime: '2026-01-01T00:00:00.000Z',
                lastSignInTime: lastSignIns[uid]
              }
            })),
            pageToken: undefined
          }))
        }))
      },
      db: {
        collection: jest.fn((name) => {
          if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
          return {
            get: jest.fn(async () => makeQuerySnapshot(Object.entries(userProfiles).map(([uid, data]) => ({ id: uid, data: () => data })))),
            doc: jest.fn((uid) => ({
              collection: jest.fn((subName) => {
                if (subName === 'rules') {
                  return { get: jest.fn(async () => makeQuerySnapshot([])) };
                }
                if (subName === 'config') {
                  return {
                    doc: jest.fn(() => ({
                      get: jest.fn(async () => ({ exists: true, data: () => ({ deviceProvider: 'foxess' }) }))
                    }))
                  };
                }
                if (subName === 'vehicles') {
                  return {
                    limit: jest.fn(() => ({ get: jest.fn(async () => makeQuerySnapshot([])) }))
                  };
                }
                if (subName === 'secrets') {
                  return {
                    doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false, data: () => ({}) })) }))
                  };
                }
                throw new Error(`Unexpected subcollection: ${subName}`);
              })
            }))
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/users?limit=1&page=2&includeSummary=0')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.summary).toBeNull();
    expect(response.body.result.pagination).toEqual(expect.objectContaining({
      page: 2,
      pageSize: 1,
      totalUsers: 3,
      totalPages: 3,
      showAll: false,
      sortingScope: 'current-page'
    }));
    expect(response.body.result.users).toHaveLength(1);
    expect(response.body.result.users[0]).toEqual(expect.objectContaining({ uid: 'user-c' }));
  });

  test('admin users route tolerates unexpected per-user row failures', async () => {
    const makeQuerySnapshot = (docs = []) => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn)
    });
    const brokenProfile = { email: 'broken@example.com', role: 'user' };
    Object.defineProperty(brokenProfile, 'automationEnabled', {
      enumerable: true,
      get() {
        throw new ReferenceError('_req is not defined');
      }
    });

    const deps = createDeps({
      admin: {
        auth: jest.fn(() => ({
          listUsers: jest.fn(async () => ({
            users: [{
              uid: 'user-broken',
              email: 'broken@example.com',
              metadata: {
                creationTime: '2026-01-01T00:00:00.000Z',
                lastSignInTime: '2026-03-03T08:00:00.000Z'
              }
            }],
            pageToken: undefined
          }))
        }))
      },
      db: {
        collection: jest.fn((name) => {
          if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
          return {
            get: jest.fn(async () => makeQuerySnapshot([{ id: 'user-broken', data: () => brokenProfile }])),
            doc: jest.fn(() => ({
              collection: jest.fn((subName) => {
                if (subName === 'rules') {
                  return { get: jest.fn(async () => makeQuerySnapshot([])) };
                }
                if (subName === 'config') {
                  return {
                    doc: jest.fn(() => ({
                      get: jest.fn(async () => ({ exists: true, data: () => ({ deviceProvider: 'foxess' }) }))
                    }))
                  };
                }
                if (subName === 'vehicles') {
                  return {
                    limit: jest.fn(() => ({ get: jest.fn(async () => makeQuerySnapshot([])) }))
                  };
                }
                if (subName === 'secrets') {
                  return {
                    doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false, data: () => ({}) })) }))
                  };
                }
                throw new Error(`Unexpected subcollection: ${subName}`);
              })
            }))
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.users).toEqual([
      expect.objectContaining({
        uid: 'user-broken',
        configured: false,
        automationEnabled: false,
        hasEVConfigured: false,
        rulesCount: 0
      })
    ]);
    expect(response.body.result.summary).toEqual(expect.objectContaining({
      totalUsers: 1,
      configured: expect.objectContaining({ count: 0 }),
      automationActive: expect.objectContaining({ count: 0 }),
      evConfigured: expect.objectContaining({ count: 0 })
    }));
  });

  test('role update validates allowed roles', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/admin/users/user-2/role')
      .set('Authorization', 'Bearer token')
      .send({ role: 'super-admin' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'Role must be "admin" or "user"'
    });
  });

  test('user delete validates confirmation text', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/admin/users/user-2/delete')
      .set('Authorization', 'Bearer token')
      .send({ confirmText: 'NOPE' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'Confirmation text must be DELETE'
    });
    expect(deps.deleteUserDataTree).not.toHaveBeenCalled();
    expect(deps.__deleteUser).not.toHaveBeenCalled();
  });
});
