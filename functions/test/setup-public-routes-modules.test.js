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

  // ── Sungrow / SigenEnergy tests ──────────────────────────────────────────

  /**
   * Builds a flexible db mock that handles all provider credential paths:
   *   shared/serverConfig, shared/serverCredentials,
   *   users/{uid}/secrets/credentials
   */
  function buildFlexibleDb() {
    const makeDoc = () => ({
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      set: jest.fn(async () => undefined)
    });

    const serverConfigDoc = makeDoc();
    const serverCredentialsDoc = makeDoc();
    const userCredentialsDoc = makeDoc();

    const db = {
      collection: jest.fn((collName) => ({
        doc: jest.fn((docId) => {
          if (collName === 'shared' && docId === 'serverConfig') return serverConfigDoc;
          if (collName === 'shared' && docId === 'serverCredentials') return serverCredentialsDoc;
          // users/{uid}
          return {
            collection: jest.fn((subColl) => ({
              doc: jest.fn((subDocId) => {
                if (subColl === 'secrets' && subDocId === 'credentials') return userCredentialsDoc;
                return makeDoc();
              })
            }))
          };
        })
      }))
    };

    return { db, serverConfigDoc, serverCredentialsDoc, userCredentialsDoc };
  }

  test('validate-keys: Sungrow unauthenticated emulator saves non-sensitive config + password separately', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const { db, serverConfigDoc, serverCredentialsDoc } = buildFlexibleDb();
    const deps = buildDeps({ db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        sungrow_username: 'sg@example.com',
        sungrow_password: 'sg-secret',
        sungrow_device_sn: 'SN-SG-001'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'Sungrow credentials validated successfully',
      result: { deviceSn: 'SN-SG-001', provider: 'sungrow' }
    });

    // Non-sensitive config saved without password
    expect(serverConfigDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sungrowUsername: 'sg@example.com',
        sungrowDeviceSn: 'SN-SG-001',
        deviceProvider: 'sungrow'
      }),
      { merge: true }
    );
    expect(serverConfigDoc.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ sungrowPassword: expect.anything() }),
      expect.anything()
    );

    // Password stored in dedicated credentials doc
    expect(serverCredentialsDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ sungrowPassword: 'sg-secret' }),
      { merge: true }
    );
  });

  test('validate-keys: Sungrow authenticated emulator saves to setUserConfig + user secrets', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const { db, userCredentialsDoc } = buildFlexibleDb();
    const setUserConfig = jest.fn(async () => undefined);
    const deps = buildDeps({
      db,
      setUserConfig,
      tryAttachUser: jest.fn(async (req) => { req.user = { uid: 'user-sg-1' }; })
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        sungrow_username: 'sg@example.com',
        sungrow_password: 'sg-secret',
        sungrow_device_sn: 'SN-SG-001'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);

    // Non-sensitive fields saved via setUserConfig without password
    expect(setUserConfig).toHaveBeenCalledWith(
      'user-sg-1',
      expect.objectContaining({ sungrowUsername: 'sg@example.com', deviceProvider: 'sungrow' }),
      { merge: true }
    );
    const savedConfig = setUserConfig.mock.calls[0][1];
    expect(savedConfig).not.toHaveProperty('sungrowPassword');

    // Password saved to secrets subcollection
    expect(userCredentialsDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ sungrowPassword: 'sg-secret' }),
      { merge: true }
    );
  });

  test('validate-keys: SigenEnergy returns 400 when password is missing', async () => {
    const { db } = buildFlexibleDb();
    const deps = buildDeps({ db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({ sigenergy_username: 'sig@example.com' }); // missing sigenergy_password

    expect(response.statusCode).toBe(400);
    expect(response.body.errno).toBe(1);
    expect(response.body.failed_keys).toContain('sigenergy_password');
  });

  test('validate-keys: SigenEnergy unauthenticated emulator saves non-sensitive config + password separately', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const { db, serverConfigDoc, serverCredentialsDoc } = buildFlexibleDb();
    const deps = buildDeps({ db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        sigenergy_username: 'sig@example.com',
        sigenergy_password: 'sig-secret',
        sigenergy_region: 'apac'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'SigenEnergy credentials validated successfully',
      result: { region: 'apac', provider: 'sigenergy' }
    });

    // Non-sensitive config saved without password
    expect(serverConfigDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sigenUsername: 'sig@example.com',
        sigenRegion: 'apac',
        deviceProvider: 'sigenergy'
      }),
      { merge: true }
    );
    expect(serverConfigDoc.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ sigenPassword: expect.anything() }),
      expect.anything()
    );

    // Password stored in dedicated credentials doc
    expect(serverCredentialsDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ sigenPassword: 'sig-secret' }),
      { merge: true }
    );
  });
});
