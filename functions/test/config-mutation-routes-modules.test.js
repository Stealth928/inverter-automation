'use strict';

const express = require('express');
const request = require('supertest');

const { registerConfigMutationRoutes } = require('../api/routes/config-mutations');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

function buildDeps(overrides = {}) {
  return {
    DEFAULT_TOPOLOGY_REFRESH_MS: 14400000,
    authenticateUser: (_req, _res, next) => next(),
    callWeatherAPI: jest.fn(async () => ({})),
    deepMerge: jest.fn((target, source) => Object.assign({}, target || {}, source || {})),
    deleteField: jest.fn(() => '__DELETE__'),
    db: null,
    getUserConfig: jest.fn(async () => ({})),
    isValidTimezone: jest.fn((tz) => typeof tz === 'string' && tz.startsWith('Australia/')),
    normalizeCouplingValue: jest.fn((value) => String(value || '').toLowerCase()),
    serverTimestamp: jest.fn(() => '__TS__'),
    setUserConfig: jest.fn(async () => undefined),
    updateUserConfig: jest.fn(async () => undefined),
    ...overrides
  };
}

describe('config mutation route module', () => {
  test('system topology route normalizes payload and saves to user config', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/system-topology')
      .send({
        coupling: 'AC',
        confidence: 2,
        evidence: { meterPower2: 0.8 },
        lastDetectedAt: 1700000000123,
        refreshAfterMs: 5000.9,
        source: 'manual'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.msg).toBe('System topology saved');
    expect(deps.setUserConfig).toHaveBeenCalledWith(
      'u-config',
      {
        systemTopology: {
          coupling: 'ac',
          confidence: 1,
          evidence: { meterPower2: 0.8 },
          lastDetectedAt: 1700000000123,
          refreshAfterMs: 5000,
          source: 'manual',
          updatedAt: '__TS__'
        }
      },
      { merge: true }
    );
  });

  test('telemetry mappings route normalizes payload and saves to user config', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/telemetry-mappings')
      .send({
        acSolarPowerVariable: ' meterPower2 '
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'Telemetry mappings saved',
      result: {
        acSolarPowerVariable: 'meterPower2'
      }
    });
    expect(deps.setUserConfig).toHaveBeenCalledWith(
      'u-config',
      {
        telemetryMappings: {
          acSolarPowerVariable: 'meterPower2',
          updatedAt: '__TS__'
        }
      },
      { merge: true }
    );
  });

  test('config save returns 400 for invalid payload', async () => {
    const deps = buildDeps();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config')
      .set('Content-Type', 'application/json')
      .send('null');

    expect(response.statusCode).toBe(400);
    expect(deps.setUserConfig).not.toHaveBeenCalled();
  });

  test('config save rejects Tesla status cache outside allowed bounds', async () => {
    const deps = buildDeps({
      getUserConfig: jest.fn(async () => ({ location: 'Sydney' }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config')
      .send({
        cache: {
          teslaStatus: 110000
        }
      });

    expect(response.statusCode).toBe(400);
    expect(String(response.body.error || '')).toMatch(/tesla status cache/i);
    expect(deps.setUserConfig).not.toHaveBeenCalled();
  });

  test('config save prioritizes browser timezone and skips weather lookup', async () => {
    const deps = buildDeps({
      getUserConfig: jest.fn(async () => ({
        defaults: { cooldownMinutes: 5 },
        location: 'Sydney',
        preferences: { weatherPlace: 'Sydney' }
      }))
    });
    deps.deepMerge.mockReturnValue({ merged: true });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config')
      .send({
        config: {
          browserTimezone: 'Australia/Sydney',
          location: 'Melbourne',
          preferences: {}
        }
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, msg: 'Config saved', result: { merged: true } });
    expect(deps.callWeatherAPI).not.toHaveBeenCalled();
    expect(deps.deepMerge).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'Sydney' }),
      expect.objectContaining({
        location: 'Melbourne',
        preferences: { weatherPlace: 'Melbourne' },
        timezone: 'Australia/Sydney'
      })
    );
    expect(deps.setUserConfig).toHaveBeenCalledWith('u-config', { merged: true }, { merge: true });
  });

  test('config save detects timezone from weather when needed', async () => {
    const deps = buildDeps({
      callWeatherAPI: jest.fn(async () => ({
        result: {
          place: { timezone: 'Australia/Melbourne' }
        }
      })),
      getUserConfig: jest.fn(async () => ({ location: 'Sydney' }))
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config')
      .send({ location: 'Melbourne' });

    expect(response.statusCode).toBe(200);
    expect(deps.callWeatherAPI).toHaveBeenCalledWith('Melbourne', 1, 'u-config');
    expect(deps.setUserConfig).toHaveBeenCalled();
    const savedConfig = deps.setUserConfig.mock.calls[0][1];
    expect(savedConfig.timezone).toBe('Australia/Melbourne');
    expect(savedConfig.location).toBe('Melbourne');
    expect(savedConfig.preferences.weatherPlace).toBe('Melbourne');
  });

  test('config save strips write-only provider secrets from persisted config', async () => {
    const deps = buildDeps({
      getUserConfig: jest.fn(async () => ({
        location: 'Sydney',
        alphaessAppSecret: 'SECRET-OLD',
        sungrowPassword: 'SG-PASS',
        sigenPassword: 'SIG-PASS'
      }))
    });
    deps.deepMerge.mockReturnValue({
      location: 'Brisbane',
      preferences: { weatherPlace: 'Brisbane' },
      timezone: 'Australia/Brisbane',
      alphaessAppSecret: 'SECRET-NEW',
      sungrowPassword: 'SG-PASS-NEW',
      sigenPassword: 'SIG-PASS-NEW'
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config')
      .send({
        config: {
          browserTimezone: 'Australia/Brisbane',
          location: 'Brisbane'
        }
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result).toEqual({
      location: 'Brisbane',
      preferences: { weatherPlace: 'Brisbane' },
      timezone: 'Australia/Brisbane'
    });
    expect(deps.setUserConfig).toHaveBeenCalledWith(
      'u-config',
      {
        location: 'Brisbane',
        preferences: { weatherPlace: 'Brisbane' },
        timezone: 'Australia/Brisbane'
      },
      { merge: true }
    );
  });

  test('clear credentials route enforces authenticate middleware', async () => {
    const deps = buildDeps({
      authenticateUser: (req, res, next) => {
        if (!req.headers.authorization) {
          return res.status(401).json({ errno: 401, error: 'Unauthorized' });
        }
        req.user = { uid: 'u-config' };
        return next();
      }
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      });
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/clear-credentials')
      .send({});

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
    expect(deps.updateUserConfig).not.toHaveBeenCalled();
  });

  test('clear credentials route clears credential fields and setup status', async () => {
    const deps = buildDeps({
      authenticateUser: (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      }
    });

    const app = buildApp((instance) => {
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/clear-credentials')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, msg: 'Credentials cleared successfully' });
    expect(deps.updateUserConfig).toHaveBeenCalledWith('u-config', {
      amberApiKey: '__DELETE__',
      alphaessAppId: '__DELETE__',
      alphaessAppSecret: '__DELETE__',
      alphaessSysSn: '__DELETE__',
      alphaessSystemSn: '__DELETE__',
      deviceProvider: 'foxess',
      deviceSn: '__DELETE__',
      foxessToken: '__DELETE__',
      sigenAccessToken: '__DELETE__',
      sigenDeviceSn: '__DELETE__',
      sigenPassword: '__DELETE__',
      sigenRefreshToken: '__DELETE__',
      sigenStationId: '__DELETE__',
      sigenTokenExpiry: '__DELETE__',
      sigenUsername: '__DELETE__',
      setupComplete: false,
      sungrowDeviceSn: '__DELETE__',
      sungrowPassword: '__DELETE__',
      sungrowToken: '__DELETE__',
      sungrowUid: '__DELETE__',
      sungrowUsername: '__DELETE__',
      updatedAt: '__TS__'
    });
  });

  test('clear credentials route deletes user secrets credentials doc when db is provided', async () => {
    const deleteCredentialsDoc = jest.fn(async () => undefined);
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({ delete: deleteCredentialsDoc }))
          }))
        }))
      }))
    };
    const deps = buildDeps({
      db,
      authenticateUser: (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      }
    });

    const app = buildApp((instance) => {
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/clear-credentials')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(deleteCredentialsDoc).toHaveBeenCalledTimes(1);
  });

  test('tour status route rejects empty update payload', async () => {
    const deps = buildDeps({
      authenticateUser: (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      }
    });

    const app = buildApp((instance) => {
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/tour-status')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'No valid fields to update' });
    expect(deps.updateUserConfig).not.toHaveBeenCalled();
  });

  test('tour status route persists valid fields', async () => {
    const deps = buildDeps({
      authenticateUser: (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      }
    });

    const app = buildApp((instance) => {
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/tour-status')
      .send({
        tourComplete: true,
        tourCompletedAt: 1700000000999
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, msg: 'Tour status updated' });
    expect(deps.updateUserConfig).toHaveBeenCalledWith('u-config', {
      tourComplete: true,
      tourCompletedAt: 1700000000999
    });
  });

  test('announcement dismiss route rejects missing id', async () => {
    const deps = buildDeps({
      authenticateUser: (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      }
    });

    const app = buildApp((instance) => {
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/announcement/dismiss')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Announcement ID is required' });
    expect(deps.updateUserConfig).not.toHaveBeenCalled();
  });

  test('announcement dismiss route normalizes and persists unique ids', async () => {
    const deps = buildDeps({
      authenticateUser: (req, _res, next) => {
        req.user = { uid: 'u-config' };
        next();
      },
      getUserConfig: jest.fn(async () => ({
        announcementDismissedIds: ['existing-note', ' release-note-1 ']
      }))
    });

    const app = buildApp((instance) => {
      registerConfigMutationRoutes(instance, deps);
    });

    const response = await request(app)
      .post('/api/config/announcement/dismiss')
      .send({ id: ' Release Note 1 ' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'Announcement dismissed',
      result: {
        id: 'release-note-1',
        announcementDismissedIds: ['existing-note', 'release-note-1']
      }
    });
    expect(deps.updateUserConfig).toHaveBeenCalledWith('u-config', {
      announcementDismissedIds: ['existing-note', 'release-note-1'],
      announcementLastDismissedAt: '__TS__'
    });
  });
});
