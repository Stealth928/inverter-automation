'use strict';

const express = require('express');
const request = require('supertest');

const { registerConfigReadStatusRoutes } = require('../api/routes/config-read-status');

function createDbMock({ automationEnabled = false } = {}) {
  const userDocGet = jest.fn(async () => ({
    exists: true,
    data: () => ({ automationEnabled })
  }));
  const userDocSet = jest.fn(async () => undefined);

  return {
    db: {
      collection: jest.fn((name) => {
        if (name !== 'users') {
          throw new Error(`Unexpected collection: ${name}`);
        }
        return {
          doc: jest.fn(() => ({
            get: userDocGet,
            set: userDocSet
          }))
        };
      })
    },
    userDocGet,
    userDocSet
  };
}

function createDeps(overrides = {}) {
  const dbMock = createDbMock();

  return {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-config', email: 'config@example.com' };
      return next();
    },
    db: dbMock.db,
    DEFAULT_TOPOLOGY_REFRESH_MS: 4 * 60 * 60 * 1000,
    getAutomationTimezone: jest.fn(() => 'Australia/Sydney'),
    getCachedWeatherData: jest.fn(async () => null),
    getConfig: jest.fn(() => ({
      automation: {
        intervalMs: 60000,
        cacheTtl: { amber: 70000, inverter: 300000, weather: 1800000 }
      }
    })),
    getUserAutomationState: jest.fn(async () => ({ enabled: true })),
    getUserConfig: jest.fn(async () => ({
      automation: { intervalMs: 90000, inverterCacheTtlMs: 240000, blackoutWindows: [] },
      cache: { amber: 75000, weather: 1900000 },
      defaults: { cooldownMinutes: 3, durationMinutes: 12 }
    })),
    getUserRules: jest.fn(async () => ({ ruleA: { enabled: true } })),
    getUserTime: jest.fn(() => ({ hour: 10, minute: 30 })),
    logger: { debug: jest.fn(), warn: jest.fn() },
    normalizeCouplingValue: jest.fn((value) => {
      const v = String(value || '').toLowerCase();
      if (v === 'ac' || v === 'ac-coupled') return 'ac';
      if (v === 'dc' || v === 'dc-coupled') return 'dc';
      return 'unknown';
    }),
    setUserConfig: jest.fn(async () => undefined),
    __dbMock: dbMock,
    ...overrides
  };
}

function buildApp(deps, { globalAuth = true } = {}) {
  const app = express();
  app.use(express.json());
  if (globalAuth) {
    app.use('/api', deps.authenticateUser);
  }
  registerConfigReadStatusRoutes(app, deps);
  return app;
}

describe('config/status read route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerConfigReadStatusRoutes(app, {}))
      .toThrow('registerConfigReadStatusRoutes requires authenticateUser middleware');
  });

  test('config route returns 401 when user context is missing', async () => {
    const deps = createDeps();
    const app = buildApp(deps, { globalAuth: false });

    const response = await request(app).get('/api/config');

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('config route returns merged config envelope and cache header', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.config).toEqual({
      automation: { intervalMs: 90000 },
      cache: { amber: 75000, inverter: 240000, weather: 1900000 },
      defaults: { cooldownMinutes: 3, durationMinutes: 12 }
    });
    expect(response.headers['cache-control']).toContain('no-cache');
  });

  test('system-topology route returns normalized coupling and default refresh', async () => {
    const deps = createDeps({
      getUserConfig: jest.fn(async () => ({
        systemTopology: {
          coupling: 'ac-coupled',
          source: 'manual',
          confidence: 0.82
        }
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/system-topology')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        coupling: 'ac',
        isLikelyAcCoupled: true,
        source: 'manual',
        confidence: 0.82,
        lastDetectedAt: null,
        updatedAt: null,
        evidence: null,
        refreshAfterMs: 4 * 60 * 60 * 1000
      }
    });
  });

  test('tour-status route enforces authentication middleware', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/config/tour-status');

    expect(response.statusCode).toBe(401);
  });

  test('automation-status syncs automationEnabled and evaluates blackout windows', async () => {
    const dbMock = createDbMock({ automationEnabled: false });
    const deps = createDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({
        automation: {
          intervalMs: 120000,
          inverterCacheTtlMs: 210000,
          blackoutWindows: [{ start: '10:00', end: '11:00' }]
        },
        cache: { amber: 65000, weather: 1700000 },
        defaults: { cooldownMinutes: 6, durationMinutes: 22 },
        timezone: 'Australia/Sydney'
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/automation/status')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.inBlackout).toBe(true);
    expect(response.body.result.nextCheckIn).toBe(120000);
    expect(dbMock.userDocSet).toHaveBeenCalledWith(
      { automationEnabled: true },
      { merge: true }
    );
    expect(deps.setUserConfig).not.toHaveBeenCalled();
  });
});
