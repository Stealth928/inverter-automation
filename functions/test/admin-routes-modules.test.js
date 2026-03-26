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
    buildFirestoreQuotaSummary: jest.fn(() => ({
      alerts: [],
      dailyFreeTier: { reads: 50000, writes: 20000, deletes: 20000 },
      generatedAt: '2026-03-25T00:00:00.000Z',
      metrics: [],
      overallStatus: 'healthy'
    })),
    getCacheMetricsSnapshot: jest.fn(() => ({
      startedAtMs: 1711324800000,
      totals: { reads: 0, hits: 0, misses: 0, errors: 0, writes: 0, hitRatePct: null, missRatePct: null },
      sources: []
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
        getUserByEmail: jest.fn(async (email) => ({ uid: `resolved-${String(email).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}`, email })),
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

function makeFetchHeaders(values = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    get: (key) => normalized[String(key).toLowerCase()] ?? null
  };
}

function makeFetchResponse(status, body, headers = {}) {
  const text = body == null
    ? ''
    : (typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeFetchHeaders(headers),
    text: jest.fn(async () => text)
  };
}

function makeQuerySnapshot(docs = []) {
  return {
    size: docs.length,
    docs,
    empty: docs.length === 0,
    forEach: (fn) => docs.forEach(fn)
  };
}

function makeDocSnapshot(id, data) {
  return {
    id,
    exists: true,
    data: () => data
  };
}

function makeRulesQuery(docs = []) {
  const snapshot = makeQuerySnapshot(docs);
  const query = {
    get: jest.fn(async () => snapshot)
  };
  query.limit = jest.fn(() => query);
  query.orderBy = jest.fn(() => query);
  return query;
}

describe('admin route module', () => {
  const originalGa4PropertyId = process.env.GA4_PROPERTY_ID;
  const originalGa4MeasurementId = process.env.GA4_MEASUREMENT_ID;

  afterEach(() => {
    if (typeof originalGa4PropertyId === 'string') {
      process.env.GA4_PROPERTY_ID = originalGa4PropertyId;
    } else {
      delete process.env.GA4_PROPERTY_ID;
    }

    if (typeof originalGa4MeasurementId === 'string') {
      process.env.GA4_MEASUREMENT_ID = originalGa4MeasurementId;
    } else {
      delete process.env.GA4_MEASUREMENT_ID;
    }
  });

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

  test('admin announcement returns normalized shared config payload', async () => {
    const sharedServerConfigDoc = {
      get: jest.fn(async () => ({
        exists: true,
        data: () => ({
          announcement: {
            enabled: true,
            id: 'Spring Launch 2026',
            title: '  New announcement  ',
            body: 'Line one\r\nLine two',
            severity: 'warning',
            showOnce: true,
            audience: {
              requireTourComplete: true,
              requireSetupComplete: false,
              requireAutomationEnabled: true,
              minAccountAgeDays: 7,
              onlyIncludeUids: ['delta'],
              includeUids: ['alpha', 'beta'],
              excludeUids: ['gamma']
            },
            updatedByEmail: 'admin@example.com'
          }
        })
      }))
    };

    const app = buildApp(createDeps({
      db: {
        collection: jest.fn((name) => {
          if (name !== 'shared') {
            return {
              doc: jest.fn(() => ({ set: jest.fn(async () => undefined) })),
              where: jest.fn(() => ({})),
              add: jest.fn(async () => undefined)
            };
          }
          return {
            doc: jest.fn((docId) => {
              if (docId !== 'serverConfig') throw new Error(`Unexpected shared doc: ${docId}`);
              return sharedServerConfigDoc;
            })
          };
        })
      }
    }));

    const response = await request(app)
      .get('/api/admin/announcement')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.result.announcement).toEqual(expect.objectContaining({
      enabled: true,
      id: 'spring-launch-2026',
      title: 'New announcement',
      body: 'Line one\nLine two',
      severity: 'warning',
      showOnce: true,
      updatedByEmail: 'admin@example.com',
      audience: {
        requireTourComplete: true,
        requireSetupComplete: false,
        requireAutomationEnabled: true,
        minAccountAgeDays: 7,
        onlyIncludeUids: ['delta'],
        includeUids: ['alpha', 'beta'],
        excludeUids: ['gamma']
      }
    }));
  });

  test('admin announcement saves normalized config into shared serverConfig', async () => {
    const set = jest.fn(async () => undefined);
    const get = jest.fn(async () => ({
      exists: true,
      data: () => ({
        announcement: {
          enabled: true,
          id: 'spring-launch-2026',
          title: 'New announcement',
          body: 'Hello users',
          severity: 'warning',
          showOnce: true,
          audience: {
            requireTourComplete: true,
            requireSetupComplete: true,
            requireAutomationEnabled: false,
            minAccountAgeDays: 14,
            onlyIncludeUids: ['user-z'],
            includeUids: ['user-a'],
            excludeUids: []
          },
          updatedAt: '__TS__',
          updatedByUid: 'admin-uid',
          updatedByEmail: 'admin@example.com'
        }
      })
    }));
    const sharedServerConfigDoc = { get, set };

    const app = buildApp(createDeps({
      db: {
        collection: jest.fn((name) => {
          if (name !== 'shared') {
            return {
              doc: jest.fn(() => ({ set: jest.fn(async () => undefined) })),
              where: jest.fn(() => ({})),
              add: jest.fn(async () => undefined)
            };
          }
          return {
            doc: jest.fn((docId) => {
              if (docId !== 'serverConfig') throw new Error(`Unexpected shared doc: ${docId}`);
              return sharedServerConfigDoc;
            })
          };
        })
      }
    }));

    const response = await request(app)
      .post('/api/admin/announcement')
      .set('Authorization', 'Bearer token')
      .send({
        announcement: {
          enabled: true,
          id: 'Spring Launch 2026',
          title: ' New announcement ',
          body: 'Hello users',
          severity: 'warning',
          showOnce: true,
          audience: {
            requireTourComplete: true,
            requireSetupComplete: true,
            minAccountAgeDays: 14,
            onlyIncludeUids: 'vip@example.com',
            includeUids: 'user-a\nlaunch@example.com',
            excludeUids: []
          }
        }
      });

    expect(response.statusCode).toBe(200);
    expect(set).toHaveBeenCalledWith({
      announcement: {
        enabled: true,
        id: 'spring-launch-2026',
        title: 'New announcement',
        body: 'Hello users',
        severity: 'warning',
        showOnce: true,
        audience: {
          requireTourComplete: true,
          requireSetupComplete: true,
          requireAutomationEnabled: false,
          minAccountAgeDays: 14,
          onlyIncludeUids: ['resolved-vip-example-com'],
          includeUids: ['user-a', 'resolved-launch-example-com'],
          excludeUids: []
        },
        updatedAt: '__TS__',
        updatedByUid: 'admin-uid',
        updatedByEmail: 'admin@example.com'
      }
    }, { merge: true });
    expect(response.body.result.announcement).toEqual(expect.objectContaining({
      id: 'spring-launch-2026',
      title: 'New announcement'
    }));
  });

  test('admin announcement rejects unknown email identifiers during audience resolution', async () => {
    const getUserByEmail = jest.fn(async () => {
      const error = new Error('User not found');
      error.code = 'auth/user-not-found';
      throw error;
    });

    const app = buildApp(createDeps({
      admin: {
        auth: jest.fn(() => ({
          getUser: jest.fn(async () => ({ uid: 'target-uid', email: 'target@example.com', customClaims: {} })),
          getUserByEmail,
          setCustomUserClaims: jest.fn(async () => undefined),
          deleteUser: jest.fn(async () => undefined)
        }))
      }
    }));

    const response = await request(app)
      .post('/api/admin/announcement')
      .set('Authorization', 'Bearer token')
      .send({
        announcement: {
          enabled: true,
          title: 'New announcement',
          showOnce: false,
          audience: {
            onlyIncludeUids: ['missing@example.com']
          }
        }
      });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'No user found for only include: missing@example.com'
    });
  });

  test('admin announcement rejects enabled show-once announcements without an id', async () => {
    const app = buildApp(createDeps());

    const response = await request(app)
      .post('/api/admin/announcement')
      .set('Authorization', 'Bearer token')
      .send({
        announcement: {
          enabled: true,
          title: 'Heads up',
          body: 'Important update',
          showOnce: true
        }
      });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Show-once announcements require an ID' });
  });

  test('dataworks ops returns cached GitHub diagnostics without refetching immediately', async () => {
    const nowMs = Date.now();
    const asOfIso = new Date(nowMs - (4 * 60 * 1000)).toISOString();
    const storedAtIso = new Date(nowMs - (3 * 60 * 1000)).toISOString();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeFetchResponse(200, {
        state: 'active',
        path: '.github/workflows/aemo-market-insights-delta.yml',
        html_url: 'https://github.com/example/repo/workflow'
      }, {
        'x-ratelimit-remaining': '59'
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        workflow_runs: [
          {
            id: 123,
            run_number: 7,
            status: 'completed',
            conclusion: 'failure',
            event: 'schedule',
            created_at: '2026-03-19T02:08:53Z',
            updated_at: '2026-03-19T02:10:43Z',
            html_url: 'https://github.com/example/repo/actions/runs/123',
            jobs_url: 'https://api.github.com/repos/example/repo/actions/runs/123/jobs'
          },
          {
            id: 122,
            run_number: 6,
            status: 'completed',
            conclusion: 'success',
            event: 'schedule',
            created_at: '2026-03-18T02:08:53Z',
            updated_at: '2026-03-18T02:10:43Z',
            html_url: 'https://github.com/example/repo/actions/runs/122',
            jobs_url: 'https://api.github.com/repos/example/repo/actions/runs/122/jobs'
          }
        ]
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        jobs: [
          {
            id: 1,
            name: 'delta-update-and-deploy',
            status: 'completed',
            conclusion: 'failure',
            steps: [
              { number: 6, name: 'Download latest AEMO monthly files', status: 'completed', conclusion: 'success' },
              { number: 8, name: 'Deploy Firebase hosting', status: 'completed', conclusion: 'failure' }
            ]
          }
        ]
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        generatedAt: '2026-03-19T02:10:43Z',
        git: {
          commit: 'abc1234567890defabc1234567890defabc12345',
          branch: 'main'
        }
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        sha: 'abc1234567890defabc1234567890defabc12345'
      }));

    const app = buildApp(createDeps({
      fetchImpl,
      db: {
        collection: jest.fn((name) => {
          if (name === 'aemoSnapshots') {
            return {
              get: jest.fn(async () => makeQuerySnapshot([
                makeDocSnapshot('NSW1', {
                  data: [{ type: 'CurrentInterval' }, { type: 'ForecastInterval' }],
                  metadata: { asOf: asOfIso, forecastHorizonMinutes: 1440, isForecastComplete: true },
                  storedAtIso,
                  schedule: { cadenceMinutes: 5, lagMinutes: 1, source: 'scheduler' }
                }),
                makeDocSnapshot('QLD1', {
                  data: [{ type: 'CurrentInterval' }, { type: 'ForecastInterval' }],
                  metadata: { asOf: asOfIso, forecastHorizonMinutes: 1440, isForecastComplete: true },
                  storedAtIso,
                  schedule: { cadenceMinutes: 5, lagMinutes: 1, source: 'scheduler' }
                }),
                makeDocSnapshot('SA1', {
                  data: [{ type: 'CurrentInterval' }, { type: 'ForecastInterval' }],
                  metadata: { asOf: asOfIso, forecastHorizonMinutes: 1440, isForecastComplete: true },
                  storedAtIso,
                  schedule: { cadenceMinutes: 5, lagMinutes: 1, source: 'scheduler' }
                }),
                makeDocSnapshot('TAS1', {
                  data: [{ type: 'CurrentInterval' }, { type: 'ForecastInterval' }],
                  metadata: { asOf: asOfIso, forecastHorizonMinutes: 1440, isForecastComplete: true },
                  storedAtIso,
                  schedule: { cadenceMinutes: 5, lagMinutes: 1, source: 'scheduler' }
                }),
                makeDocSnapshot('VIC1', {
                  data: [{ type: 'CurrentInterval' }, { type: 'ForecastInterval' }],
                  metadata: { asOf: asOfIso, forecastHorizonMinutes: 1440, isForecastComplete: true },
                  storedAtIso,
                  schedule: { cadenceMinutes: 5, lagMinutes: 1, source: 'scheduler' }
                })
              ]))
            };
          }
          return {
            doc: jest.fn(() => ({
              set: jest.fn(async () => undefined)
            })),
            where: jest.fn(() => ({})),
            add: jest.fn(async () => undefined)
          };
        })
      },
      githubDataworks: {
        owner: 'Stealth928',
        repo: 'inverter-automation',
        workflowId: 'aemo-market-insights-delta.yml',
        ref: 'main'
      }
    }));

    const firstResponse = await request(app)
      .get('/api/admin/dataworks/ops')
      .set('Authorization', 'Bearer token');

    const secondResponse = await request(app)
      .get('/api/admin/dataworks/ops')
      .set('Authorization', 'Bearer token');

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.body.errno).toBe(0);
    expect(firstResponse.body.result.workflow.state).toBe('active');
    expect(firstResponse.body.result.latestRun.conclusion).toBe('failure');
    expect(firstResponse.body.result.latestJob.steps[1].name).toBe('Deploy Firebase hosting');
    expect(firstResponse.body.result.releaseAlignment.matches).toBe(true);
    expect(firstResponse.body.result.liveAemo.status.label).toBe('Healthy');
    expect(firstResponse.body.result.liveAemo.freshRegions).toBe(5);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body.result.cache.hit).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  test('dataworks dispatch triggers workflow and writes admin audit entry when configured', async () => {
    const addMock = jest.fn(async () => undefined);
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeFetchResponse(200, {
        state: 'active',
        path: '.github/workflows/aemo-market-insights-delta.yml',
        html_url: 'https://github.com/example/repo/workflow'
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        workflow_runs: [
          {
            id: 123,
            run_number: 7,
            status: 'completed',
            conclusion: 'failure',
            event: 'schedule',
            created_at: '2026-03-19T02:08:53Z',
            updated_at: '2026-03-19T02:10:43Z',
            html_url: 'https://github.com/example/repo/actions/runs/123',
            jobs_url: 'https://api.github.com/repos/example/repo/actions/runs/123/jobs'
          }
        ]
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        jobs: [
          {
            id: 1,
            name: 'delta-update-and-deploy',
            status: 'completed',
            conclusion: 'failure',
            steps: []
          }
        ]
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        generatedAt: '2026-03-19T02:10:43Z',
        git: {
          commit: 'abc1234567890defabc1234567890defabc12345',
          branch: 'main'
        }
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        sha: 'abc1234567890defabc1234567890defabc12345'
      }))
      .mockResolvedValueOnce(makeFetchResponse(204, null));

    const app = buildApp(createDeps({
      fetchImpl,
      githubDataworks: {
        owner: 'Stealth928',
        repo: 'inverter-automation',
        workflowId: 'aemo-market-insights-delta.yml',
        ref: 'main',
        dispatchToken: 'token-123'
      },
      db: {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            set: jest.fn(async () => undefined)
          })),
          where: jest.fn(() => ({})),
          add: addMock
        }))
      }
    }));

    const response = await request(app)
      .post('/api/admin/dataworks/dispatch')
      .set('Authorization', 'Bearer token')
      .send({});

    expect(response.statusCode).toBe(202);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.accepted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dataworks_dispatch',
      workflowOwner: 'Stealth928',
      workflowRepo: 'inverter-automation',
      workflowId: 'aemo-market-insights-delta.yml',
      ref: 'main'
    }));
  });

  test('dataworks dispatch is blocked when live hosting release does not match configured ref', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeFetchResponse(200, {
        state: 'active',
        path: '.github/workflows/aemo-market-insights-delta.yml',
        html_url: 'https://github.com/example/repo/workflow'
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        workflow_runs: [
          {
            id: 123,
            run_number: 7,
            status: 'completed',
            conclusion: 'success',
            event: 'workflow_dispatch',
            created_at: '2026-03-19T02:08:53Z',
            updated_at: '2026-03-19T02:10:43Z',
            html_url: 'https://github.com/example/repo/actions/runs/123',
            jobs_url: 'https://api.github.com/repos/example/repo/actions/runs/123/jobs'
          }
        ]
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        jobs: [
          {
            id: 1,
            name: 'delta-update-and-deploy',
            status: 'completed',
            conclusion: 'success',
            steps: []
          }
        ]
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        generatedAt: '2026-03-19T02:10:43Z',
        git: {
          commit: 'live1234567890defabc1234567890defabc1234',
          branch: 'release/prod'
        }
      }))
      .mockResolvedValueOnce(makeFetchResponse(200, {
        sha: 'ref1234567890defabc1234567890defabc12345'
      }));

    const app = buildApp(createDeps({
      fetchImpl,
      githubDataworks: {
        owner: 'Stealth928',
        repo: 'inverter-automation',
        workflowId: 'aemo-market-insights-delta.yml',
        ref: 'main',
        dispatchToken: 'token-123'
      }
    }));

    const response = await request(app)
      .post('/api/admin/dataworks/dispatch')
      .set('Authorization', 'Bearer token')
      .send({});

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toMatch(/Deploy the current release first/);
    expect(response.body.result.releaseAlignment.status).toBe('mismatch');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
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

  test('behavior-metrics returns setup guidance when GA4 property id is not configured', async () => {
    delete process.env.GA4_PROPERTY_ID;
    delete process.env.GA4_MEASUREMENT_ID;

    const app = buildApp(createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        analyticsadmin: jest.fn(() => ({
          accountSummaries: {
            list: jest.fn(async () => ({ data: { accountSummaries: [] } }))
          },
          properties: {
            dataStreams: {
              list: jest.fn(async () => ({ data: { dataStreams: [] } }))
            }
          }
        })),
        analyticsdata: jest.fn(() => ({
          properties: {
            runReport: jest.fn()
          }
        }))
      }
    }));

    const response = await request(app)
      .get('/api/admin/behavior-metrics')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.configured).toBe(false);
    expect(response.body.result.setup.requiredEnv).toBe('GA4_PROPERTY_ID');
    expect(response.body.result.setup.measurementId).toBe('G-MWF4ZBMREE');
  });

  test('behavior-metrics prefers Firebase project analytics details before measurement-id discovery', async () => {
    delete process.env.GA4_PROPERTY_ID;
    delete process.env.GA4_MEASUREMENT_ID;

    const runReport = jest.fn()
      .mockResolvedValueOnce({
        data: {
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' },
            { name: 'userEngagementDuration' }
          ],
          rows: [{ metricValues: [{ value: '5' }, { value: '17' }, { value: '22' }, { value: '80' }] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          dimensionHeaders: [{ name: 'date' }],
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' }
          ],
          rows: [
            {
              dimensionValues: [{ value: '20260321' }],
              metricValues: [{ value: '5' }, { value: '17' }, { value: '22' }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          rowCount: 1,
          dimensionHeaders: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metricHeaders: [
            { name: 'screenPageViews' },
            { name: 'activeUsers' },
            { name: 'userEngagementDuration' }
          ],
          rows: [
            {
              dimensionValues: [{ value: '/admin.html' }, { value: 'Admin' }],
              metricValues: [{ value: '17' }, { value: '5' }, { value: '80' }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          dimensionHeaders: [{ name: 'eventName' }],
          metricHeaders: [{ name: 'eventCount' }, { name: 'activeUsers' }],
          rows: [
            {
              dimensionValues: [{ value: 'settings_save_all' }],
              metricValues: [{ value: '4' }, { value: '2' }]
            }
          ]
        }
      });
    const batchRunReports = jest.fn(async () => ({
      data: {
        reports: [
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          {
            dimensionHeaders: [{ name: 'date' }],
            metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
            rows: [
              {
                dimensionValues: [{ value: '20260321' }],
                metricValues: [{ value: '5' }, { value: '17' }]
              }
            ]
          }
        ]
      }
    }));

    const getAnalyticsDetails = jest.fn(async () => ({
      data: {
        analyticsProperty: { id: '456123789', displayName: 'Inverter Automation' },
        streamMappings: [
          {
            app: 'projects/test-project/webApps/1:test:web:123',
            streamId: '1234567',
            measurementId: 'G-MWF4ZBMREE'
          }
        ]
      }
    }));

    const analyticsAdminFactory = jest.fn(() => ({
      accountSummaries: { list: jest.fn() },
      properties: { dataStreams: { list: jest.fn() } }
    }));

    const app = buildApp(createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        firebase: jest.fn(() => ({
          projects: {
            getAnalyticsDetails
          }
        })),
        analyticsadmin: analyticsAdminFactory,
        analyticsdata: jest.fn(() => ({
          properties: {
            runReport,
            batchRunReports
          }
        }))
      }
    }));

    const response = await request(app)
      .get('/api/admin/behavior-metrics?days=30&limit=5')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.configured).toBe(true);
    expect(response.body.result.propertyId).toBe('456123789');
    expect(response.body.result.measurementId).toBe('G-MWF4ZBMREE');
    expect(response.body.result.propertySource).toBe('firebase-project-analytics');
    expect(response.body.result.mainPageOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'admin', label: 'Admin' })
    ]));
    expect(response.body.result.pageSeriesByKey.admin).toEqual([
      { date: '2026-03-21', activeUsers: 5, pageViews: 17, eventCount: 0 }
    ]);
    expect(response.body.result.mainPageOptions).toEqual([
      { key: 'admin', label: 'Admin' }
    ]);
    expect(getAnalyticsDetails).toHaveBeenCalledWith({
      name: 'projects/test-project/analyticsDetails'
    });
    expect(analyticsAdminFactory).not.toHaveBeenCalled();
    expect(batchRunReports).toHaveBeenCalledTimes(1);
    expect(batchRunReports).toHaveBeenCalledWith(expect.objectContaining({
      property: 'properties/456123789',
      requestBody: expect.objectContaining({
        requests: expect.any(Array)
      })
    }));
  });

  test('behavior-metrics can discover property id from GA4 measurement id', async () => {
    delete process.env.GA4_PROPERTY_ID;
    process.env.GA4_MEASUREMENT_ID = 'G-MWF4ZBMREE';

    const runReport = jest.fn()
      .mockResolvedValueOnce({
        data: {
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' },
            { name: 'userEngagementDuration' }
          ],
          rows: [{ metricValues: [{ value: '4' }, { value: '21' }, { value: '31' }, { value: '120' }] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          dimensionHeaders: [{ name: 'date' }],
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' }
          ],
          rows: [
            {
              dimensionValues: [{ value: '20260320' }],
              metricValues: [{ value: '4' }, { value: '21' }, { value: '31' }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          rowCount: 1,
          dimensionHeaders: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metricHeaders: [
            { name: 'screenPageViews' },
            { name: 'activeUsers' },
            { name: 'userEngagementDuration' }
          ],
          rows: [
            {
              dimensionValues: [{ value: '/admin.html' }, { value: 'Admin' }],
              metricValues: [{ value: '21' }, { value: '4' }, { value: '120' }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          dimensionHeaders: [{ name: 'eventName' }],
          metricHeaders: [{ name: 'eventCount' }, { name: 'activeUsers' }],
          rows: [
            {
              dimensionValues: [{ value: 'control_settings_save' }],
              metricValues: [{ value: '6' }, { value: '2' }]
            }
          ]
        }
      });
    const batchRunReports = jest.fn(async () => ({
      data: {
        reports: [
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          {
            dimensionHeaders: [{ name: 'date' }],
            metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
            rows: [
              {
                dimensionValues: [{ value: '20260320' }],
                metricValues: [{ value: '4' }, { value: '21' }]
              }
            ]
          }
        ]
      }
    }));

    const listAccountSummaries = jest.fn(async () => ({
      data: {
        accountSummaries: [
          {
            propertySummaries: [
              { property: 'properties/987654321' }
            ]
          }
        ]
      }
    }));
    const listDataStreams = jest.fn(async () => ({
      data: {
        dataStreams: [
          {
            webStreamData: {
              measurementId: 'G-MWF4ZBMREE'
            }
          }
        ]
      }
    }));

    const app = buildApp(createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        firebase: jest.fn(() => ({
          projects: {
            getAnalyticsDetails: jest.fn(async () => {
              throw new Error('Firebase analytics details lookup failed');
            })
          }
        })),
        analyticsadmin: jest.fn(() => ({
          accountSummaries: {
            list: listAccountSummaries
          },
          properties: {
            dataStreams: {
              list: listDataStreams
            }
          }
        })),
        analyticsdata: jest.fn(() => ({
          properties: {
            runReport,
            batchRunReports
          }
        }))
      }
    }));

    const response = await request(app)
      .get('/api/admin/behavior-metrics?days=30&limit=5')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.configured).toBe(true);
    expect(response.body.result.propertyId).toBe('987654321');
    expect(response.body.result.measurementId).toBe('G-MWF4ZBMREE');
    expect(response.body.result.propertySource).toBe('measurement-id-discovery');
    expect(listAccountSummaries).toHaveBeenCalledTimes(1);
    expect(listDataStreams).toHaveBeenCalledWith({
      parent: 'properties/987654321',
      pageSize: 50
    });
  });

  test('behavior-metrics returns aggregated GA4 usage and filters generic events', async () => {
    process.env.GA4_PROPERTY_ID = '123456789';

    const runReport = jest.fn()
      .mockResolvedValueOnce({
        data: {
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' },
            { name: 'userEngagementDuration' }
          ],
          rows: [
            {
              metricValues: [
                { value: '18' },
                { value: '146' },
                { value: '221' },
                { value: '932' }
              ]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          dimensionHeaders: [{ name: 'date' }],
          metricHeaders: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'eventCount' }
          ],
          rows: [
            {
              dimensionValues: [{ value: '20260318' }],
              metricValues: [{ value: '7' }, { value: '44' }, { value: '65' }]
            },
            {
              dimensionValues: [{ value: '20260319' }],
              metricValues: [{ value: '11' }, { value: '52' }, { value: '81' }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          rowCount: 3,
          dimensionHeaders: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metricHeaders: [
            { name: 'screenPageViews' },
            { name: 'activeUsers' },
            { name: 'userEngagementDuration' }
          ],
          rows: [
            {
              dimensionValues: [{ value: '/app.html' }, { value: 'Overview' }],
              metricValues: [{ value: '81' }, { value: '14' }, { value: '610' }]
            },
            {
              dimensionValues: [{ value: '/settings.html' }, { value: 'Settings' }],
              metricValues: [{ value: '32' }, { value: '8' }, { value: '214' }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          dimensionHeaders: [{ name: 'eventName' }],
          metricHeaders: [{ name: 'eventCount' }, { name: 'activeUsers' }],
          rows: [
            {
              dimensionValues: [{ value: 'page_view' }],
              metricValues: [{ value: '146' }, { value: '18' }]
            },
            {
              dimensionValues: [{ value: 'settings_save_all' }],
              metricValues: [{ value: '19' }, { value: '6' }]
            },
            {
              dimensionValues: [{ value: 'history_fetch_report' }],
              metricValues: [{ value: '12' }, { value: '5' }]
            }
          ]
        }
      });
    const batchRunReports = jest.fn(async () => ({
      data: {
        reports: [
          {
            dimensionHeaders: [{ name: 'date' }],
            metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
            rows: [
              {
                dimensionValues: [{ value: '20260318' }],
                metricValues: [{ value: '7' }, { value: '44' }]
              }
            ]
          },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] },
          {
            dimensionHeaders: [{ name: 'date' }],
            metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
            rows: [
              {
                dimensionValues: [{ value: '20260319' }],
                metricValues: [{ value: '8' }, { value: '32' }]
              }
            ]
          },
          { dimensionHeaders: [{ name: 'date' }], metricHeaders: [{ name: 'activeUsers' }, { name: 'screenPageViews' }], rows: [] }
        ]
      }
    }));

    const app = buildApp(createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        analyticsdata: jest.fn(() => ({
          properties: {
            runReport,
            batchRunReports
          }
        }))
      }
    }));

    const response = await request(app)
      .get('/api/admin/behavior-metrics?days=30&limit=5')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.configured).toBe(true);
    expect(response.body.result.propertyId).toBe('123456789');
    expect(response.body.result.summary).toEqual(expect.objectContaining({
      activeUsers: 18,
      pageViews: 146,
      eventCount: 221,
      customEventTypes: 2
    }));
    expect(response.body.result.pageSeries).toEqual([
      { date: '2026-03-18', activeUsers: 7, pageViews: 44, eventCount: 65 },
      { date: '2026-03-19', activeUsers: 11, pageViews: 52, eventCount: 81 }
    ]);
    expect(response.body.result.topPages[0]).toEqual(expect.objectContaining({
      path: '/app.html',
      title: 'Overview',
      pageViews: 81
    }));
    expect(response.body.result.topEvents.map((entry) => entry.eventName)).toEqual([
      'settings_save_all',
      'history_fetch_report'
    ]);
    expect(response.body.result.mainPageOptions).toEqual([
      { key: 'app', label: 'Dashboard' },
      { key: 'settings', label: 'Settings' }
    ]);
    expect(response.body.result.pageSeriesByKey.app).toEqual([
      { date: '2026-03-18', activeUsers: 7, pageViews: 44, eventCount: 0 },
      { date: '2026-03-19', activeUsers: 0, pageViews: 0, eventCount: 0 }
    ]);
    expect(response.body.result.pageSeriesByKey.settings).toEqual([
      { date: '2026-03-18', activeUsers: 0, pageViews: 0, eventCount: 0 },
      { date: '2026-03-19', activeUsers: 8, pageViews: 32, eventCount: 0 }
    ]);
    expect(runReport).toHaveBeenCalledTimes(4);
    expect(batchRunReports).toHaveBeenCalledTimes(1);
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
      })),
      buildFirestoreQuotaSummary: jest.fn(() => ({
        alerts: [
          {
            code: 'firestore_reads_watch',
            metric: 'reads',
            severity: 'watch',
            message: 'Reads last-24h usage is 72% of the daily free-tier allowance.'
          }
        ],
        dailyFreeTier: { reads: 50000, writes: 20000, deletes: 20000 },
        generatedAt: '2026-03-25T00:00:00.000Z',
        metrics: [
          {
            key: 'reads',
            label: 'Reads',
            dailyFreeTier: 50000,
            monthToDateAllowance: 1250000,
            monthToDateUsage: 710000,
            last24Hours: 36000,
            last24HoursUtilizationPct: 72,
            projectedMonthEnd: 880400,
            projectedMonthEndUtilizationPct: 56.8,
            status: 'watch'
          }
        ],
        overallStatus: 'watch'
      })),
      getCacheMetricsSnapshot: jest.fn(() => ({
        startedAtMs: 1711324800000,
        totals: { reads: 20, hits: 15, misses: 5, errors: 1, writes: 4, hitRatePct: 75, missRatePct: 25 },
        sources: [
          { source: 'weather', reads: 8, hits: 7, misses: 1, errors: 0, writes: 2, hitRatePct: 87.5, missRatePct: 12.5, lastSeenAtMs: 1711328400000 }
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
    expect(response.body.result.firestore.quota).toEqual(expect.objectContaining({
      overallStatus: 'watch',
      alerts: [expect.objectContaining({ code: 'firestore_reads_watch' })]
    }));
    expect(response.body.result.cache).toEqual(expect.objectContaining({
      totals: expect.objectContaining({ hitRatePct: 75 }),
      sources: [expect.objectContaining({ source: 'weather' })]
    }));
    expect(response.body.result.billing.projectMtdCostUsd).toBeCloseTo(4.23);
    expect(response.body.result.billing.projectServices).toHaveLength(3);
    expect(response.body.result.billing.projectBillingAccountId).toBe('123ABC');
    expect(response.body.result.warnings).toContain('Reads last-24h usage is 72% of the daily free-tier allowance.');
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

  test('api-health returns cached provider rollups with monitoring-based failure overlay', async () => {
    const formatDayKey = (offset) => {
      const date = new Date(Date.now() - (offset * 24 * 60 * 60 * 1000));
      return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
    };
    const dayTwoAgo = formatDayKey(2);
    const dayOneAgo = formatDayKey(1);
    const dayToday = formatDayKey(0);
    const metricDocs = new Map(Object.entries({
      [dayTwoAgo]: { foxess: 20, amber: 9, weather: 4, teslaFleet: { calls: { byCategory: { wake: 1, vehicleData: 2 } } } },
      [dayOneAgo]: { foxess: 24, amber: 11, weather: 5, teslaFleet: { calls: { byCategory: { wake: 1, command: 1, vehicleData: 2 } } } },
      [dayToday]: { foxess: 36, amber: 12, weather: 6, teslaFleet: { calls: { byCategory: { wake: 1, command: 2, vehicleData: 2 } } } }
    }));

    const deps = createDeps({
      googleApis: {
        auth: {
          GoogleAuth: jest.fn(() => ({}))
        },
        monitoring: jest.fn(() => ({}))
      },
      db: {
        collection: jest.fn((name) => {
          if (name !== 'metrics') {
            return {
              doc: jest.fn(() => ({ set: jest.fn(async () => undefined) })),
              where: jest.fn(() => ({})),
              add: jest.fn(async () => undefined)
            };
          }

          return {
            doc: jest.fn((docId) => ({
              get: jest.fn(async () => ({
                exists: metricDocs.has(docId),
                data: () => metricDocs.get(docId) || {}
              }))
            }))
          };
        })
      },
      listMonitoringTimeSeries: jest.fn(async ({ filter }) => {
        if (String(filter).includes('status!="ok"')) {
          return [
            { timestamp: `${dayOneAgo}T00:00:00.000Z`, value: 1 },
            { timestamp: `${dayToday}T00:00:00.000Z`, value: 2 }
          ];
        }
        if (String(filter).includes('execution_count')) {
          return [
            { timestamp: `${dayTwoAgo}T00:00:00.000Z`, value: 18 },
            { timestamp: `${dayOneAgo}T00:00:00.000Z`, value: 21 },
            { timestamp: `${dayToday}T00:00:00.000Z`, value: 25 }
          ];
        }
        return [];
      }),
      sumSeriesValues: jest.fn((series = []) => series.reduce((sum, point) => sum + Number(point.value || 0), 0))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/api-health?days=30')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.summary.totalCalls).toBe(139);
    expect(response.body.result.summary.dominantProvider).toEqual(expect.objectContaining({
      key: 'foxess',
      label: 'FoxESS'
    }));
    expect(response.body.result.monitoring).toEqual(expect.objectContaining({
      available: true,
      requestExecutionsTotal: 64,
      errorExecutionsTotal: 3
    }));
    expect(response.body.result.observability.alphaess).toEqual(expect.objectContaining({
      enabled: true,
      liveRealtimeLogging: 'suspicious-only',
      manualDiagnosticsLogging: 'always',
      extraProviderCallsPerRequest: 0,
      extraFirestoreWritesPerRequest: 0
    }));
    expect(response.body.result.providers[0]).toEqual(expect.objectContaining({
      key: 'foxess',
      totalCalls: 80
    }));
    expect(response.body.result.daily.find((row) => row.date === dayToday)).toEqual(expect.objectContaining({
      evBreakdown: expect.objectContaining({
        wake: 1,
        command: 2,
        vehicleData: 2
      })
    }));
    expect(response.body.result.alerts.some((alert) => alert.code === 'error_rate_watch')).toBe(true);
  });

  test('api-health reads Tesla breakdown from flat dotted metrics fields', async () => {
    const formatDayKey = (offset) => {
      const date = new Date(Date.now() - (offset * 24 * 60 * 60 * 1000));
      return date.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
    };
    const dayToday = formatDayKey(0);
    const metricDocs = new Map(Object.entries({
      [dayToday]: {
        foxess: 12,
        amber: 8,
        weather: 3,
        'teslaFleet.calls.total': 5,
        'teslaFleet.calls.billable': 5,
        'teslaFleet.calls.byCategory.wake': 1,
        'teslaFleet.calls.byCategory.command': 2,
        'teslaFleet.calls.byCategory.data_request': 2
      }
    }));

    const deps = createDeps({
      googleApis: null,
      db: {
        collection: jest.fn((name) => {
          if (name !== 'metrics') {
            return {
              doc: jest.fn(() => ({ set: jest.fn(async () => undefined) })),
              where: jest.fn(() => ({})),
              add: jest.fn(async () => undefined)
            };
          }

          return {
            doc: jest.fn((docId) => ({
              get: jest.fn(async () => ({
                exists: metricDocs.has(docId),
                data: () => metricDocs.get(docId) || {}
              }))
            }))
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/api-health?days=7')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.daily.find((row) => row.date === dayToday)).toEqual(expect.objectContaining({
      categories: expect.objectContaining({ ev: 5 }),
      evBreakdown: expect.objectContaining({
        wake: 1,
        command: 2,
        data_request: 2
      })
    }));
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
          avgQueueLagTotalMs: 180,
          avgQueueLagSamples: 5,
          avgCycleDurationTotalMs: 1100,
          avgCycleDurationSamples: 5,
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
          outlierRun: {
            dayKey: '2026-03-06',
            runId: 'run-daily-outlier',
            schedulerId: 'sched-daily',
            workerId: 'worker-daily',
            startedAtMs: 1500,
            completedAtMs: 1900,
            maxCycleDurationMs: 400,
            avgCycleDurationMs: 220,
            p95CycleDurationMs: 320,
            p99CycleDurationMs: 390,
            queueLagAvgMs: 36,
            queueLagMaxMs: 120,
            retries: 2,
            errors: 1,
            deadLetters: 1,
            skipped: {
              disabledOrBlackout: 1,
              idempotent: 1,
              locked: 1,
              tooSoon: 2
            },
            failureByType: { api_rate_limit: 1 },
            telemetryPauseReasons: { stale_telemetry: 2, frozen_telemetry: 1 },
            phaseTimingsMaxMs: {
              dataFetchMs: 70,
              ruleEvalMs: 45,
              actionApplyMs: 120,
              curtailmentMs: 35
            },
            slowestCycle: {
              userId: 'u-daily',
              cycleKey: 'u-daily_1',
              durationMs: 400,
              queueLagMs: 120,
              retriesUsed: 2,
              failureType: 'api_rate_limit',
              startedAtMs: 1500,
              completedAtMs: 1900
            }
          },
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
          avgQueueLagTotalMs: 120,
          avgQueueLagSamples: 4,
          avgCycleDurationTotalMs: 720,
          avgCycleDurationSamples: 4,
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
                      where: jest.fn(() => ({
                        orderBy: jest.fn(() => ({
                          limit: jest.fn(() => ({
                            get: runsGet
                          }))
                        }))
                      })),
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
      p95QueueLagMs: 120,
      maxCycleDurationMs: 400,
      maxTelemetryAgeMs: 1900000,
      p95CycleDurationMs: 320,
      p99CycleDurationMs: 390,
      avgQueueLagMs: 33,
      avgCycleDurationMs: 202,
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
    expect(response.body.result.currentSnapshot).toEqual(expect.objectContaining({
      runId: 'run-1',
      dayKey: '2026-03-06',
      schedulerId: 'sched-1',
      workerId: 'worker-1',
      cyclesRun: 2,
      errors: 0,
      deadLetters: 0,
      retries: 1,
      errorRatePct: 0,
      deadLetterRatePct: 0,
      avgQueueLagMs: 10,
      maxQueueLagMs: 20,
      avgCycleDurationMs: 40,
      maxCycleDurationMs: 80,
      maxTelemetryAgeMs: 1900000,
      p95CycleDurationMs: 70,
      p99CycleDurationMs: 79,
      phaseTimingsMaxMs: expect.objectContaining({
        dataFetchMs: 30,
        actionApplyMs: 12
      }),
      likelyCauses: expect.arrayContaining(['external_api_slowness_or_retries']),
      telemetryPauseReasons: expect.objectContaining({
        stale_telemetry: 1
      }),
      slo: expect.objectContaining({
        status: 'breach',
        breachedMetrics: ['errorRatePct']
      })
    }));
    expect(response.body.result.last24hSummary).toEqual(expect.objectContaining({
      runs: 0,
      cyclesRun: 0,
      errors: 0,
      deadLetters: 0,
      retries: 0,
      errorRatePct: 0,
      deadLetterRatePct: 0,
      avgQueueLagMs: 0,
      avgCycleDurationMs: 0,
      maxQueueLagMs: 0,
      maxCycleDurationMs: 0,
      maxTelemetryAgeMs: 0,
      latestRunId: null
    }));
    expect(response.body.result.diagnostics).toEqual(expect.objectContaining({
      tailLatency: expect.objectContaining({
        status: 'watch'
      }),
      last24hTailLatency: expect.objectContaining({
        status: 'healthy',
        observedRuns: 0,
        latestP99Ms: 0
      }),
      outlierRun: expect.objectContaining({
        runId: 'run-daily-outlier',
        workerId: 'worker-daily',
        maxCycleDurationMs: 400,
        phaseTimingsMaxMs: expect.objectContaining({
          dataFetchMs: 70,
          actionApplyMs: 120
        }),
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
        outlierRunStartedAtMs: 1500,
        outlierRunMaxMs: expect.objectContaining({
          dataFetchMs: 70,
          actionApplyMs: 120
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

  test('dead-letters returns recent items with top error counts', async () => {
    const deadLetterGet = jest.fn(async () => ({
      forEach: (callback) => {
        callback({
          id: 'dl-1',
          ref: { path: 'users/u-1/automation_dead_letters/dl-1' },
          data: () => ({
            cycleKey: 'u-1_1',
            createdAt: 1710000000000,
            expiresAt: 1710003600000,
            attempts: 3,
            error: 'FoxESS timeout'
          })
        });
        callback({
          id: 'dl-2',
          ref: { path: 'users/u-2/automation_dead_letters/dl-2' },
          data: () => ({
            cycleKey: 'u-2_1',
            createdAt: 1710000100000,
            expiresAt: 1710003700000,
            attempts: 3,
            error: 'FoxESS timeout'
          })
        });
      }
    }));

    const deps = createDeps({
      db: {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              orderBy: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn(async () => ({ forEach: () => {} })) })) }))
            }))
          }))
        })),
        collectionGroup: jest.fn((name) => {
          if (name !== 'automation_dead_letters') {
            throw new Error(`Unexpected collectionGroup: ${name}`);
          }
          return {
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                  get: deadLetterGet
                }))
              }))
            }))
          };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/dead-letters?days=7&limit=10')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.total).toBe(2);
    expect(response.body.result.topErrors).toEqual([
      { error: 'foxess timeout', count: 2 }
    ]);
    expect(response.body.result.items[0]).toEqual(expect.objectContaining({
      userId: 'u-1',
      cycleKey: 'u-1_1',
      attempts: 3
    }));
    expect(deadLetterGet).toHaveBeenCalledTimes(1);
  });

  test('dead-letter retry invokes automation cycle handler and deletes recovered item', async () => {
    const deadLetterDelete = jest.fn(async () => undefined);
    const deadLetterSet = jest.fn(async () => undefined);
    const deadLetterGet = jest.fn(async () => ({
      exists: true,
      data: () => ({ cycleKey: 'cycle-u1-123', attempts: 3, error: 'timeout' })
    }));
    const adminAuditAdd = jest.fn(async () => undefined);
    const deps = createDeps({
      db: {
        collection: jest.fn((name) => {
          if (name === 'users') {
            return {
              doc: jest.fn((uid) => ({
                collection: jest.fn((sub) => {
                  if (sub !== 'automation_dead_letters') throw new Error(`Unexpected subcollection: ${sub}`);
                  return {
                    doc: jest.fn((id) => {
                      expect(uid).toBe('u-1');
                      expect(id).toBe('dl-1');
                      return {
                        get: deadLetterGet,
                        delete: deadLetterDelete,
                        set: deadLetterSet
                      };
                    })
                  };
                })
              }))
            };
          }
          if (name === 'admin_audit') {
            return { add: adminAuditAdd };
          }
          return {
            doc: jest.fn(() => ({ set: jest.fn(async () => undefined) })),
            where: jest.fn(() => ({})),
            add: jest.fn(async () => undefined)
          };
        })
      },
      getAutomationCycleHandler: () => async (_req, res) => res.json({ errno: 0, result: { triggered: false } })
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/admin/dead-letters/u-1/dl-1/retry')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result).toEqual(expect.objectContaining({
      userId: 'u-1',
      deadLetterId: 'dl-1',
      cycleKey: 'cycle-u1-123',
      retried: true
    }));
    expect(deadLetterDelete).toHaveBeenCalledTimes(1);
    expect(deadLetterSet).not.toHaveBeenCalled();
    expect(adminAuditAdd).toHaveBeenCalledWith(expect.objectContaining({
      action: 'retry_dead_letter',
      targetUid: 'u-1',
      cycleKey: 'cycle-u1-123',
      success: true
    }));
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

  test('admin users page loads skip EV probes when summary is not requested', async () => {
    const makeQuerySnapshot = (docs = []) => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn)
    });
    const userProfiles = {
      'user-a': { email: 'a@example.com', role: 'user', automationEnabled: false },
      'user-b': { email: 'b@example.com', role: 'user', automationEnabled: true }
    };
    const vehicleProbe = jest.fn(() => {
      throw new Error('vehicles collection should not be queried for page-only loads');
    });

    const deps = createDeps({
      admin: {
        auth: jest.fn(() => ({
          listUsers: jest.fn(async () => ({
            users: Object.keys(userProfiles).map((uid, index) => ({
              uid,
              email: userProfiles[uid].email,
              metadata: {
                creationTime: '2026-01-01T00:00:00.000Z',
                lastSignInTime: `2026-03-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`
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
            doc: jest.fn(() => ({
              collection: jest.fn((subName) => {
                if (subName === 'rules') {
                  return { get: jest.fn(async () => makeQuerySnapshot([])) };
                }
                if (subName === 'config') {
                  return {
                    doc: jest.fn(() => ({
                      get: jest.fn(async () => ({
                        exists: true,
                        data: () => ({ deviceProvider: 'foxess', deviceSn: 'device-sn', foxessToken: 'foxess-token' })
                      }))
                    }))
                  };
                }
                if (subName === 'vehicles') {
                  return {
                    limit: vehicleProbe,
                    get: vehicleProbe
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
      .get('/api/admin/users?includeSummary=0&limit=2&page=1')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.summary).toBeNull();
    expect(vehicleProbe).not.toHaveBeenCalled();
    expect(response.body.result.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'user-a', hasEVConfigured: false }),
      expect.objectContaining({ uid: 'user-b', hasEVConfigured: false })
    ]));
  });

  test('admin users route reuses cached summary between requests', async () => {
    const makeQuerySnapshot = (docs = []) => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn)
    });
    const userProfiles = {
      'user-a': { email: 'a@example.com', role: 'user', automationEnabled: false },
      'user-b': { email: 'b@example.com', role: 'user', automationEnabled: true }
    };
    const configGet = jest.fn(async () => ({
      exists: true,
      data: () => ({ deviceProvider: 'foxess', deviceSn: 'device-sn', foxessToken: 'foxess-token' })
    }));

    const deps = createDeps({
      admin: {
        auth: jest.fn(() => ({
          listUsers: jest.fn(async () => ({
            users: Object.keys(userProfiles).map((uid, index) => ({
              uid,
              email: userProfiles[uid].email,
              metadata: {
                creationTime: '2026-01-01T00:00:00.000Z',
                lastSignInTime: `2026-03-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`
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
            doc: jest.fn(() => ({
              collection: jest.fn((subName) => {
                if (subName === 'rules') {
                  return { get: jest.fn(async () => makeQuerySnapshot([])) };
                }
                if (subName === 'config') {
                  return {
                    doc: jest.fn(() => ({
                      get: configGet
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

    const first = await request(app)
      .get('/api/admin/users?limit=1&page=1')
      .set('Authorization', 'Bearer token');

    expect(first.statusCode).toBe(200);
    expect(first.body.errno).toBe(0);
    expect(first.body.result.summary).toEqual(expect.objectContaining({ totalUsers: 2 }));
    expect(configGet).toHaveBeenCalledTimes(2);

    const second = await request(app)
      .get('/api/admin/users?limit=1&page=1')
      .set('Authorization', 'Bearer token');

    expect(second.statusCode).toBe(200);
    expect(second.body.errno).toBe(0);
    expect(second.body.result.summary).toEqual(expect.objectContaining({ totalUsers: 2 }));
    expect(configGet).toHaveBeenCalledTimes(3);
  });

  test('admin users route bounds detailed user scan concurrency during summary loads', async () => {
    const makeQuerySnapshot = (docs = []) => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn)
    });
    const userProfiles = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => {
        const uid = `user-${index + 1}`;
        return [uid, { email: `${uid}@example.com`, role: 'user', automationEnabled: false }];
      })
    );
    const activeConfigReads = { count: 0, max: 0 };
    const MAX_ALLOWED_ACTIVE_CONFIG_READS = 8;

    const delayedConfigGet = async () => {
      activeConfigReads.count += 1;
      activeConfigReads.max = Math.max(activeConfigReads.max, activeConfigReads.count);
      if (activeConfigReads.count > MAX_ALLOWED_ACTIVE_CONFIG_READS) {
        activeConfigReads.count -= 1;
        throw new Error('config read concurrency exceeded test threshold');
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
      activeConfigReads.count -= 1;
      return {
        exists: true,
        data: () => ({
          deviceProvider: 'foxess',
          deviceSn: 'device-sn',
          foxessToken: 'foxess-token'
        })
      };
    };

    const deps = createDeps({
      admin: {
        auth: jest.fn(() => ({
          listUsers: jest.fn(async () => ({
            users: Object.keys(userProfiles).map((uid, index) => ({
              uid,
              email: userProfiles[uid].email,
              metadata: {
                creationTime: '2026-01-01T00:00:00.000Z',
                lastSignInTime: `2026-03-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`
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
            doc: jest.fn(() => ({
              collection: jest.fn((subName) => {
                if (subName === 'rules') {
                  return { get: jest.fn(async () => makeQuerySnapshot([])) };
                }
                if (subName === 'config') {
                  return {
                    doc: jest.fn(() => ({
                      get: jest.fn(delayedConfigGet)
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
    expect(response.body.result.summary).toEqual(expect.objectContaining({
      totalUsers: 12,
      configured: expect.objectContaining({ count: 12 })
    }));
    expect(response.body.result.users).toHaveLength(12);
    expect(activeConfigReads.max).toBeLessThanOrEqual(MAX_ALLOWED_ACTIVE_CONFIG_READS);
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

  test('platform-stats reconstructs active history from deleted-user lifecycle snapshots', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-20T12:00:00.000Z'));

    try {
      const currentProfile = {
        email: 'current@example.com',
        role: 'user',
        automationEnabled: true
      };
      const currentConfig = {
        setupComplete: true,
        setupCompletedAt: '2026-01-06T00:00:00.000Z'
      };
      const currentRulesQuery = makeRulesQuery([]);
      const auditDocs = [
        {
          id: 'audit-1',
          data: () => ({
            action: 'delete_user',
            targetUid: 'deleted-user',
            timestamp: '2026-03-10T09:00:00.000Z',
            snapshot: {
              joinedAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
              configured: true,
              configuredAtMs: Date.parse('2026-01-02T00:00:00.000Z'),
              hasRules: true,
              firstRuleAtMs: Date.parse('2026-01-03T00:00:00.000Z')
            }
          })
        }
      ];

      const db = {
        collection: jest.fn((name) => {
          if (name === 'users') {
            return {
              get: jest.fn(async () => makeQuerySnapshot([
                { id: 'current-user', data: () => currentProfile }
              ])),
              doc: jest.fn((uid) => {
                if (uid !== 'current-user') {
                  throw new Error(`Unexpected user doc lookup: ${uid}`);
                }
                return {
                  collection: jest.fn((subName) => {
                    if (subName === 'config') {
                      return {
                        doc: jest.fn((docId) => {
                          if (docId !== 'main') throw new Error(`Unexpected config doc: ${docId}`);
                          return {
                            get: jest.fn(async () => ({ exists: true, data: () => currentConfig }))
                          };
                        })
                      };
                    }
                    if (subName === 'rules') {
                      return currentRulesQuery;
                    }
                    throw new Error(`Unexpected user subcollection: ${subName}`);
                  })
                };
              })
            };
          }

          if (name === 'admin_audit') {
            return {
              where: jest.fn((field, op, value) => {
                if (field !== 'action' || op !== '==' || value !== 'delete_user') {
                  throw new Error(`Unexpected audit query: ${field} ${op} ${value}`);
                }
                return {
                  get: jest.fn(async () => makeQuerySnapshot(auditDocs))
                };
              }),
              add: jest.fn(async () => undefined)
            };
          }

          throw new Error(`Unexpected collection lookup: ${name}`);
        })
      };

      const deps = createDeps({
        db,
        admin: {
          auth: jest.fn(() => ({
            listUsers: jest.fn(async () => ({
              users: [
                {
                  uid: 'current-user',
                  email: 'current@example.com',
                  metadata: {
                    creationTime: '2026-01-05T00:00:00.000Z',
                    lastSignInTime: '2026-03-19T10:00:00.000Z'
                  }
                }
              ],
              pageToken: undefined
            })),
            getUser: jest.fn(async () => ({ uid: 'target-uid', email: 'target@example.com', customClaims: {} })),
            setCustomUserClaims: jest.fn(async () => undefined),
            deleteUser: jest.fn(async () => undefined)
          }))
        }
      });
      const app = buildApp(deps);

      const response = await request(app)
        .get('/api/admin/platform-stats?days=20')
        .set('Authorization', 'Bearer token');

      expect(response.statusCode).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.summary).toEqual(expect.objectContaining({
        totalUsers: 1,
        configuredUsers: 1,
        usersWithRules: 0,
        mau: 1,
        automationActive: 1
      }));
      expect(response.body.result.warnings).toEqual([]);

      const trend = response.body.result.trend;
      expect(trend).toHaveLength(20);
      expect(trend[0]).toEqual(expect.objectContaining({
        date: '2026-03-01',
        totalUsers: 2,
        configuredUsers: 2,
        usersWithRules: 1,
        deletedUsers: 0
      }));
      expect(trend.find((point) => point.date === '2026-03-10')).toEqual(expect.objectContaining({
        totalUsers: 1,
        configuredUsers: 1,
        usersWithRules: 0,
        deletedUsers: 1
      }));
      expect(trend[trend.length - 1]).toEqual(expect.objectContaining({
        date: '2026-03-20',
        totalUsers: 1,
        configuredUsers: 1,
        usersWithRules: 0,
        deletedUsers: 1
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  test('user delete stores lifecycle snapshot in admin audit', async () => {
    const targetProfile = {
      email: 'target@example.com',
      role: 'user',
      automationEnabled: true,
      createdAt: '2026-02-01T00:00:00.000Z'
    };
    const targetConfig = {
      setupComplete: true,
      setupCompletedAt: '2026-02-02T00:00:00.000Z'
    };
    const targetRulesQuery = makeRulesQuery([
      {
        data: () => ({
          createdAt: '2026-02-10T00:00:00.000Z'
        })
      }
    ]);
    const auditAdd = jest.fn(async () => undefined);

    const db = {
      collection: jest.fn((name) => {
        if (name === 'users') {
          return {
            doc: jest.fn((uid) => {
              if (uid !== 'user-2') {
                throw new Error(`Unexpected user doc lookup: ${uid}`);
              }
              return {
                get: jest.fn(async () => ({ exists: true, data: () => targetProfile })),
                collection: jest.fn((subName) => {
                  if (subName === 'config') {
                    return {
                      doc: jest.fn((docId) => {
                        if (docId !== 'main') throw new Error(`Unexpected config doc: ${docId}`);
                        return {
                          get: jest.fn(async () => ({ exists: true, data: () => targetConfig }))
                        };
                      })
                    };
                  }
                  if (subName === 'rules') {
                    return targetRulesQuery;
                  }
                  throw new Error(`Unexpected user subcollection: ${subName}`);
                })
              };
            })
          };
        }

        if (name === 'admin_audit') {
          return {
            where: jest.fn(() => ({})),
            add: auditAdd
          };
        }

        throw new Error(`Unexpected collection lookup: ${name}`);
      })
    };

    const deleteUser = jest.fn(async () => undefined);
    const deps = createDeps({
      db,
      admin: {
        auth: jest.fn(() => ({
          getUser: jest.fn(async () => ({
            uid: 'user-2',
            email: 'target@example.com',
            metadata: {
              creationTime: '2026-02-01T00:00:00.000Z',
              lastSignInTime: '2026-03-01T00:00:00.000Z'
            },
            customClaims: {}
          })),
          setCustomUserClaims: jest.fn(async () => undefined),
          deleteUser
        }))
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/admin/users/user-2/delete')
      .set('Authorization', 'Bearer token')
      .send({ confirmText: 'DELETE' });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(deps.deleteUserDataTree).toHaveBeenCalledWith('user-2');
    expect(deleteUser).toHaveBeenCalledWith('user-2');
    expect(auditAdd).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete_user',
      adminUid: 'admin-uid',
      adminEmail: 'admin@example.com',
      targetUid: 'user-2',
      targetEmail: 'target@example.com',
      snapshot: {
        role: 'user',
        automationEnabled: true,
        joinedAtMs: Date.parse('2026-02-01T00:00:00.000Z'),
        lastSignInMs: Date.parse('2026-03-01T00:00:00.000Z'),
        configured: true,
        configuredAtMs: Date.parse('2026-02-02T00:00:00.000Z'),
        hasRules: true,
        firstRuleAtMs: Date.parse('2026-02-10T00:00:00.000Z')
      },
      timestamp: '__TS__'
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
