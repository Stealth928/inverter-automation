'use strict';

const express = require('express');
const request = require('supertest');

const { registerConfigReadStatusRoutes } = require('../api/routes/config-read-status');

function createDbMock({
  automationEnabled = false,
  announcement = null,
  userProfile = null
} = {}) {
  const userDocGet = jest.fn(async () => ({
    exists: true,
    data: () => ({
      automationEnabled,
      ...(userProfile || {})
    })
  }));
  const userDocSet = jest.fn(async () => undefined);
  const sharedDocGet = jest.fn(async () => ({
    exists: announcement !== null,
    data: () => (announcement === null ? {} : { announcement })
  }));

  return {
    db: {
      collection: jest.fn((name) => {
        if (name === 'users') {
          return {
            doc: jest.fn(() => ({
              get: userDocGet,
              set: userDocSet
            }))
          };
        }
        if (name === 'shared') {
          return {
            doc: jest.fn(() => ({
              get: sharedDocGet
            }))
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      })
    },
    userDocGet,
    userDocSet,
    sharedDocGet
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
        cacheTtl: { amber: 70000, inverter: 300000, weather: 1800000, teslaStatus: 600000 }
      }
    })),
    getUserAutomationState: jest.fn(async () => ({ enabled: true })),
    getUserConfig: jest.fn(async () => ({
      automation: { intervalMs: 90000, inverterCacheTtlMs: 240000, blackoutWindows: [] },
      cache: { amber: 75000, weather: 1900000, teslaStatus: 840000 },
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
      cache: { amber: 75000, inverter: 240000, weather: 1900000, teslaStatus: 840000 },
      defaults: { cooldownMinutes: 3, durationMinutes: 12 }
    });
    expect(response.headers['cache-control']).toContain('no-cache');
  });

  test('config route strips write-only provider secrets from response payload', async () => {
    const deps = createDeps({
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'SYS-ALPHA-1',
        alphaessAppId: 'APP-1',
        alphaessAppSecret: 'SECRET-XYZ',
        sungrowPassword: 'SG-PASS',
        sigenPassword: 'SIG-PASS',
        defaults: { cooldownMinutes: 3, durationMinutes: 12 }
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result).toEqual(expect.objectContaining({
      deviceProvider: 'alphaess',
      alphaessSystemSn: 'SYS-ALPHA-1',
      alphaessAppId: 'APP-1'
    }));
    expect(response.body.result).not.toHaveProperty('alphaessAppSecret');
    expect(response.body.result).not.toHaveProperty('sungrowPassword');
    expect(response.body.result).not.toHaveProperty('sigenPassword');
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

  test('telemetry-mappings route returns normalized per-user mapping payload', async () => {
    const deps = createDeps({
      getUserConfig: jest.fn(async () => ({
        telemetryMappings: {
          acSolarPowerVariable: ' meterPower2 '
        }
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/telemetry-mappings')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        acSolarPowerVariable: 'meterPower2'
      }
    });
  });

  test('tour-status route enforces authentication middleware', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/config/tour-status');

    expect(response.statusCode).toBe(401);
  });

  test('announcement route returns normalized announcement for eligible users', async () => {
    const dbMock = createDbMock({
      announcement: {
        enabled: true,
        id: '  release-note-1 ',
        title: ' Platform update ',
        body: ' New market insights are live. ',
        severity: 'warning',
        showOnce: true,
        audience: {
          requireTourComplete: true,
          requireSetupComplete: true,
          minAccountAgeDays: 3
        }
      },
      userProfile: {
        createdAt: Date.now() - (7 * 24 * 60 * 60 * 1000)
      }
    });
    const deps = createDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({
        setupComplete: true,
        tourComplete: true,
        announcementDismissedIds: []
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/announcement')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        announcement: {
          enabled: true,
          id: 'release-note-1',
          title: 'Platform update',
          body: 'New market insights are live.',
          severity: 'warning',
          showOnce: true,
          audience: {
            requireTourComplete: true,
            requireSetupComplete: true,
            requireAutomationEnabled: false,
            minAccountAgeDays: 3,
            onlyIncludeUids: [],
            includeUids: [],
            excludeUids: []
          }
        }
      }
    });
  });

  test('announcement route suppresses show-once announcement after dismissal', async () => {
    const dbMock = createDbMock({
      announcement: {
        enabled: true,
        id: 'release-note-1',
        title: 'Platform update',
        body: 'New market insights are live.',
        showOnce: true,
        audience: {
          requireTourComplete: true,
          requireSetupComplete: true
        }
      }
    });
    const deps = createDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({
        setupComplete: true,
        tourComplete: true,
        announcementDismissedIds: ['release-note-1']
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/announcement')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { announcement: null } });
  });

  test('announcement route allows explicit include UID to bypass maturity filters', async () => {
    const dbMock = createDbMock({
      announcement: {
        enabled: true,
        id: 'release-note-2',
        title: 'Direct target',
        body: 'This should still show.',
        audience: {
          requireTourComplete: true,
          requireSetupComplete: true,
          requireAutomationEnabled: true,
          minAccountAgeDays: 60,
          onlyIncludeUids: [],
          includeUids: ['u-config']
        }
      },
      userProfile: {
        automationEnabled: false,
        createdAt: Date.now()
      }
    });
    const deps = createDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({
        setupComplete: false,
        tourComplete: false,
        announcementDismissedIds: []
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/announcement')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.result.announcement).toEqual(expect.objectContaining({
      id: 'release-note-2',
      title: 'Direct target'
    }));
  });

  test('announcement route suppresses users outside only-include allowlist before force-include checks', async () => {
    const dbMock = createDbMock({
      announcement: {
        enabled: true,
        id: 'exclusive-rollout-1',
        title: 'Exclusive rollout',
        body: 'Only the named allowlist should see this.',
        audience: {
          requireTourComplete: false,
          requireSetupComplete: false,
          onlyIncludeUids: ['different-user'],
          includeUids: ['u-config']
        }
      },
      userProfile: {
        createdAt: Date.now() - (30 * 24 * 60 * 60 * 1000)
      }
    });
    const deps = createDeps({
      db: dbMock.db,
      getUserConfig: jest.fn(async () => ({
        setupComplete: false,
        tourComplete: false,
        announcementDismissedIds: []
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/announcement')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { announcement: null } });
  });

  test('announcement route prefers automation state over stale profile automationEnabled mirror', async () => {
    const dbMock = createDbMock({
      automationEnabled: true,
      announcement: {
        enabled: true,
        id: 'automation-audience-1',
        title: 'Automation users only',
        body: 'Shown only when automation is currently enabled.',
        audience: {
          requireTourComplete: true,
          requireSetupComplete: true,
          requireAutomationEnabled: true
        }
      }
    });
    const deps = createDeps({
      db: dbMock.db,
      getUserAutomationState: jest.fn(async () => ({ enabled: false })),
      getUserConfig: jest.fn(async () => ({
        setupComplete: true,
        tourComplete: true,
        announcementDismissedIds: []
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/config/announcement')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { announcement: null } });
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
    expect(response.body.result.config.cache.teslaStatus).toBe(600000);
    expect(dbMock.userDocSet).toHaveBeenCalledWith(
      { automationEnabled: true },
      { merge: true }
    );
    expect(deps.setUserConfig).not.toHaveBeenCalled();
  });
});
