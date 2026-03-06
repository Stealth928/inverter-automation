'use strict';

const express = require('express');
const request = require('supertest');

const { registerSetupPublicRoutes } = require('../api/routes/setup-public');

function buildDeps(overrides = {}) {
  const sharedDoc = {
    get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
    set: jest.fn(async () => undefined)
  };

  const deps = {
    db: {
      collection: jest.fn((name) => {
        if (name !== 'shared') {
          throw new Error(`Unexpected collection: ${name}`);
        }
        return {
          doc: jest.fn((docId) => {
            if (docId !== 'serverConfig') {
              throw new Error(`Unexpected doc: ${docId}`);
            }
            return sharedDoc;
          })
        };
      })
    },
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { data: [{ deviceSN: 'SN-100' }] } }))
    },
    getConfig: jest.fn(() => ({
      automation: {
        intervalMs: 60000,
        cacheTtl: { amber: 60000, inverter: 300000, weather: 1800000 }
      }
    })),
    getUserConfig: jest.fn(async () => ({})),
    logger: { info: jest.fn() },
    serverTimestamp: jest.fn(() => 'server-ts'),
    setUserConfig: jest.fn(async () => undefined),
    tryAttachUser: jest.fn(async () => undefined),
    __sharedDoc: sharedDoc
  };

  return { ...deps, ...overrides, __sharedDoc: overrides.__sharedDoc || sharedDoc };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerSetupPublicRoutes(app, deps);
  return app;
}

describe('setup public route module', () => {
  const originalFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
  const originalFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

  afterEach(() => {
    if (originalFunctionsEmulator === undefined) {
      delete process.env.FUNCTIONS_EMULATOR;
    } else {
      process.env.FUNCTIONS_EMULATOR = originalFunctionsEmulator;
    }

    if (originalFirestoreEmulatorHost === undefined) {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    } else {
      process.env.FIRESTORE_EMULATOR_HOST = originalFirestoreEmulatorHost;
    }
  });

  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerSetupPublicRoutes(app, {}))
      .toThrow('registerSetupPublicRoutes requires Firestore db');
  });

  test('forgot-password returns 400 when email is missing', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: '   ' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Email is required' });
  });

  test('validate-keys returns structured errors when required fields are missing', async () => {
    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.errno).toBe(1);
    expect(response.body.failed_keys).toEqual(expect.arrayContaining(['device_sn', 'foxess_token']));
    expect(deps.setUserConfig).not.toHaveBeenCalled();
    expect(deps.__sharedDoc.set).not.toHaveBeenCalled();
  });

  test('validate-keys uses emulator shortcut and saves to shared config when unauthenticated', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        device_sn: 'SN-EMU-001',
        foxess_token: 'emu-token'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'Credentials validated successfully',
      result: { deviceSn: 'SN-EMU-001' }
    });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(deps.__sharedDoc.set).toHaveBeenCalledWith(expect.objectContaining({
      deviceSn: 'SN-EMU-001',
      foxessToken: 'emu-token',
      setupComplete: true
    }), { merge: true });
  });

  test('validate-keys saves to user config when tryAttachUser provides uid', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const deps = buildDeps({
      tryAttachUser: jest.fn(async (req) => {
        req.user = { uid: 'user-123' };
      })
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        device_sn: 'SN-U-001',
        foxess_token: 'token-u'
      });

    expect(response.statusCode).toBe(200);
    expect(deps.setUserConfig).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({ deviceSn: 'SN-U-001', foxessToken: 'token-u' }),
      { merge: true }
    );
    expect(deps.__sharedDoc.set).not.toHaveBeenCalled();
  });

  test('setup-status returns user config envelope when authenticated', async () => {
    const deps = buildDeps({
      tryAttachUser: jest.fn(async (req) => {
        req.user = { uid: 'user-1' };
      }),
      getUserConfig: jest.fn(async () => ({
        deviceSn: 'SN-1',
        foxessToken: 'token',
        amberApiKey: 'amber',
        setupComplete: true,
        automation: { intervalMs: 90000, inverterCacheTtlMs: 240000 },
        cache: { amber: 75000, weather: 1900000 },
        defaults: { cooldownMinutes: 3, durationMinutes: 12 },
        _source: 'user'
      }))
    });
    const app = buildApp(deps);

    const response = await request(app).get('/api/config/setup-status');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.setupComplete).toBe(true);
    expect(response.body.result.source).toBe('user');
    expect(response.body.result.config).toEqual({
      automation: { intervalMs: 90000 },
      cache: { amber: 75000, inverter: 240000, weather: 1900000 },
      defaults: { cooldownMinutes: 3, durationMinutes: 12 }
    });
  });
});
