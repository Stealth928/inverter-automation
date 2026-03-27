'use strict';

const express = require('express');
const request = require('supertest');

const { registerSetupPublicRoutes } = require('../api/routes/setup-public');

function buildDeps(overrides = {}) {
  const sharedDoc = {
    get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
    set: jest.fn(async () => undefined)
  };
  const userSecretsDoc = {
    get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
    set: jest.fn(async () => undefined)
  };

  const deps = {
    db: {
      collection: jest.fn((name) => {
        if (name === 'shared') {
          return {
            doc: jest.fn((docId) => {
              if (docId !== 'serverConfig') {
                throw new Error(`Unexpected doc: ${docId}`);
              }
              return sharedDoc;
            })
          };
        }
        if (name === 'users') {
          return {
            doc: jest.fn(() => ({
              collection: jest.fn((subName) => {
                if (subName !== 'secrets') {
                  throw new Error(`Unexpected users subcollection: ${subName}`);
                }
                return {
                  doc: jest.fn((docId) => {
                    if (docId !== 'credentials') {
                      throw new Error(`Unexpected users/secrets doc: ${docId}`);
                    }
                    return userSecretsDoc;
                  })
                };
              })
            }))
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      })
    },
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { data: [{ deviceSN: 'SN-100' }] } }))
    },
    alphaEssAPI: {
      listSystems: jest.fn(async () => ({ errno: 0, result: [{ sysSn: 'SYS-ALPHA-1' }] }))
    },
    getConfig: jest.fn(() => ({
      automation: {
        intervalMs: 60000,
        cacheTtl: { amber: 60000, inverter: 300000, weather: 1800000, teslaStatus: 600000 }
      }
    })),
    getUserConfigPublic: jest.fn(async () => ({})),
    getUserConfig: jest.fn(async () => ({})),
    logger: { info: jest.fn() },
    serverTimestamp: jest.fn(() => 'server-ts'),
    setUserConfig: jest.fn(async () => undefined),
    tryAttachUser: jest.fn(async () => undefined),
    __sharedDoc: sharedDoc,
    __userSecretsDoc: userSecretsDoc
  };
  const merged = {
    ...deps,
    ...overrides,
    __sharedDoc: overrides.__sharedDoc || sharedDoc,
    __userSecretsDoc: overrides.__userSecretsDoc || userSecretsDoc
  };
  if (!overrides.getUserConfigPublic && overrides.getUserConfig) {
    merged.getUserConfigPublic = overrides.getUserConfig;
  }
  if (!overrides.getUserConfig && overrides.getUserConfigPublic) {
    merged.getUserConfig = overrides.getUserConfigPublic;
  }
  return merged;
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

  test('validate-keys persists AEMO pricing selection during setup', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const deps = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        device_sn: 'SN-AEMO-001',
        foxess_token: 'emu-token',
        pricing_provider: 'aemo',
        aemo_region: 'VIC1',
        amber_api_key: 'ignored-amber-key'
      });

    expect(response.statusCode).toBe(200);
    expect(deps.__sharedDoc.set).toHaveBeenCalledWith(expect.objectContaining({
      deviceSn: 'SN-AEMO-001',
      foxessToken: 'emu-token',
      pricingProvider: 'aemo',
      aemoRegion: 'VIC1',
      siteIdOrRegion: 'VIC1',
      amberApiKey: ''
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
        cache: { amber: 75000, weather: 1900000, teslaStatus: 840000 },
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
      cache: { amber: 75000, inverter: 240000, weather: 1900000, teslaStatus: 840000 },
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

  test('validate-keys: AlphaESS returns 400 when app secret is missing', async () => {
    const { db } = buildFlexibleDb();
    const deps = buildDeps({ db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        alphaess_system_sn: 'SYS-ALPHA-1',
        alphaess_app_id: 'APP-1'
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.errno).toBe(1);
    expect(response.body.failed_keys).toContain('alphaess_app_secret');
  });

  test('validate-keys: AlphaESS performs live list check and rejects unknown system SN', async () => {
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;

    const { db } = buildFlexibleDb();
    const deps = buildDeps({
      db,
      alphaEssAPI: {
        listSystems: jest.fn(async () => ({
          errno: 0,
          result: [{ sysSn: 'SYS-ALPHA-OTHER' }]
        }))
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        alphaess_system_sn: 'SYS-ALPHA-1',
        alphaess_app_id: 'APP-123',
        alphaess_app_secret: 'SECRET-XYZ'
      });

    expect(deps.alphaEssAPI.listSystems).toHaveBeenCalledWith(
      expect.objectContaining({
        alphaessSystemSn: 'SYS-ALPHA-1',
        alphaessAppId: 'APP-123',
        alphaessAppSecret: 'SECRET-XYZ'
      }),
      null
    );
    expect(response.statusCode).toBe(400);
    expect(response.body.failed_keys).toContain('alphaess_system_sn');
  });

  test('validate-keys: AlphaESS rejects empty system scope from listSystems', async () => {
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;

    const { db } = buildFlexibleDb();
    const deps = buildDeps({
      db,
      alphaEssAPI: {
        listSystems: jest.fn(async () => ({
          errno: 0,
          result: []
        }))
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        alphaess_system_sn: 'SYS-ALPHA-1',
        alphaess_app_id: 'APP-123',
        alphaess_app_secret: 'SECRET-XYZ'
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.failed_keys).toContain('alphaess_system_sn');
    expect(String(response.body.errors?.alphaess_system_sn || '').toLowerCase()).toContain('no systems found');
  });

  test('validate-keys: AlphaESS unauthenticated emulator saves non-sensitive config + app secret separately', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const { db, serverConfigDoc, serverCredentialsDoc } = buildFlexibleDb();
    const deps = buildDeps({ db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/config/validate-keys')
      .send({
        alphaess_system_sn: 'SYS-ALPHA-1',
        alphaess_app_id: 'APP-123',
        alphaess_app_secret: 'SECRET-XYZ'
      });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'AlphaESS credentials validated successfully',
      result: { systemSn: 'SYS-ALPHA-1', provider: 'alphaess' }
    });

    expect(serverConfigDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        alphaessSystemSn: 'SYS-ALPHA-1',
        alphaessAppId: 'APP-123',
        deviceProvider: 'alphaess'
      }),
      { merge: true }
    );
    expect(serverConfigDoc.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ alphaessAppSecret: expect.anything() }),
      expect.anything()
    );

    expect(serverCredentialsDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({ alphaessAppSecret: 'SECRET-XYZ' }),
      { merge: true }
    );
  });

  test('setup-status: AlphaESS setupComplete requires app secret presence', async () => {
    const deps = buildDeps({
      tryAttachUser: jest.fn(async (req) => {
        req.user = { uid: 'user-alpha-status' };
      }),
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'SYS-ALPHA-1',
        alphaessAppId: 'APP-123',
        alphaessAppSecret: 'SECRET-XYZ'
      }))
    });
    const app = buildApp(deps);

    const response = await request(app).get('/api/config/setup-status');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.setupComplete).toBe(true);
    expect(response.body.result.hasAlphaEssAppSecret).toBe(true);
  });
});
