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
          skipped: {
            disabledOrBlackout: 1,
            idempotent: 1,
            locked: 1,
            tooSoon: 2
          },
          failureByType: { api_rate_limit: 1 },
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
          skipped: {
            disabledOrBlackout: 0,
            idempotent: 0,
            locked: 0,
            tooSoon: 2
          },
          failureByType: { api_timeout: 2 },
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
          queueLagMs: { avgMs: 10, count: 3, maxMs: 20, minMs: 1 },
          cycleDurationMs: { avgMs: 40, count: 3, maxMs: 80, minMs: 10 }
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
          maxCycleDurationMs: 60000
        },
        measurements: {
          cyclesRun: 9,
          errors: 1,
          deadLetters: 1,
          errorRatePct: 11.11,
          deadLetterRatePct: 11.11,
          maxQueueLagMs: 120,
          maxCycleDurationMs: 400
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
      schedulerId: 'sched-1'
    }));
    expect(response.body.result.currentAlert).toEqual(expect.objectContaining({
      status: 'breach',
      runId: 'run-1',
      schedulerId: 'sched-1',
      breachedMetrics: ['errorRatePct']
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
