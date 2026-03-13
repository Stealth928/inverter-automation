'use strict';

const express = require('express');
const request = require('supertest');

const { registerEVRoutes } = require('../api/routes/ev');

// ─── Fakes ─────────────────────────────────────────────────────────────────

function makeAuth(uid = 'u-test') {
  return (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    req.user = { uid };
    return next();
  };
}

function makeVehiclesRepo(overrides = {}) {
  return {
    listVehicles: jest.fn(async () => []),
    getVehicle: jest.fn(async () => null),
    setVehicle: jest.fn(async (_uid, _id, v) => v),
    deleteVehicle: jest.fn(async () => true),
    getVehicleState: jest.fn(async () => null),
    saveVehicleState: jest.fn(async () => {}),
    getVehicleCredentials: jest.fn(async () => ({ accessToken: 'tok' })),
    setVehicleCredentials: jest.fn(async () => {}),
    ...overrides
  };
}

function makeTeslaTokenHttpClient(overrides = {}) {
  const defaults = {
    status: 200,
    data: {
      access_token: 'acc-1',
      refresh_token: 'ref-1',
      token_type: 'Bearer',
      scope: 'openid offline_access',
      expires_in: 3600
    },
    headers: {}
  };
  const response = { ...defaults, ...overrides };
  return jest.fn(async () => response);
}

const STUB_STATUS = {
  socPct: 75, chargingState: 'stopped', chargeLimitPct: 90,
  isPluggedIn: true, isHome: true, rangeKm: 300, asOfIso: '2025-01-01T00:00:00.000Z'
};

function makeAdapter(overrides = {}) {
  return {
    getVehicleStatus: jest.fn(async () => STUB_STATUS),
    getCommandReadiness: jest.fn(async () => ({ readyForCommands: true, blockingReasons: [] })),
    startCharging: jest.fn(async () => ({ commandId: 'cmd-1', status: 'confirmed', sentAtIso: '2025-01-01T00:00:00.000Z' })),
    stopCharging: jest.fn(async () => ({ commandId: 'cmd-2', status: 'confirmed', sentAtIso: '2025-01-01T00:00:00.000Z' })),
    setChargeLimit: jest.fn(async () => ({ commandId: 'cmd-3', status: 'confirmed', sentAtIso: '2025-01-01T00:00:00.000Z' })),
    wakeVehicle: jest.fn(async () => {}),
    normalizeProviderError: jest.fn(err => ({ errno: 3800, error: err.message })),
    ...overrides
  };
}

function makeRegistry(adapter = makeAdapter()) {
  return {
    getEVProvider: jest.fn((key) => key === 'tesla' ? adapter : null)
  };
}

function makeDeps(overrides = {}) {
  return {
    authenticateUser: makeAuth(),
    vehiclesRepo: makeVehiclesRepo(),
    adapterRegistry: makeRegistry(),
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerEVRoutes(app, deps);
  return app;
}

// ─── Guardrails ────────────────────────────────────────────────────────────

describe('registerEVRoutes — guardrails', () => {
  test('throws when app is missing', () => {
    expect(() => registerEVRoutes(null, makeDeps())).toThrow('registerEVRoutes requires an Express app');
  });
  test('throws when authenticateUser is missing', () => {
    const app = express();
    expect(() => registerEVRoutes(app, { vehiclesRepo: makeVehiclesRepo(), adapterRegistry: makeRegistry() }))
      .toThrow('registerEVRoutes requires authenticateUser()');
  });
  test('throws when vehiclesRepo is missing', () => {
    const app = express();
    expect(() => registerEVRoutes(app, { authenticateUser: makeAuth(), adapterRegistry: makeRegistry() }))
      .toThrow('registerEVRoutes requires a valid vehiclesRepo');
  });
  test('throws when adapterRegistry missing EV support', () => {
    const app = express();
    expect(() => registerEVRoutes(app, { authenticateUser: makeAuth(), vehiclesRepo: makeVehiclesRepo(), adapterRegistry: {} }))
      .toThrow('registerEVRoutes requires an adapterRegistry with EV provider support');
  });
});

// ─── GET /api/ev/vehicles ──────────────────────────────────────────────────

describe('GET /api/ev/vehicles', () => {
  test('returns 401 when unauthenticated', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app).get('/api/ev/vehicles');
    expect(res.statusCode).toBe(401);
  });

  test('returns empty list when no vehicles registered', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app).get('/api/ev/vehicles').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ errno: 0, result: [] });
  });

  test('returns vehicles from repo', async () => {
    const vehicle = {
      vehicleId: 'v1',
      provider: 'tesla',
      displayName: 'My EV',
      credentials: { accessToken: 'secret-token', refreshToken: 'secret-refresh' }
    };
    const deps = makeDeps({ vehiclesRepo: makeVehiclesRepo({ listVehicles: jest.fn(async () => [vehicle]) }) });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toHaveLength(1);
    expect(res.body.result[0].vehicleId).toBe('v1');
    expect(res.body.result[0].credentials).toBeUndefined();
  });
});

// ─── POST /api/ev/vehicles ────────────────────────────────────────────────

describe('POST /api/ev/vehicles', () => {
  test('returns 400 when vehicleId missing', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app).post('/api/ev/vehicles')
      .set('Authorization', 'Bearer tok').send({ provider: 'tesla' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/vehicleId/);
  });

  test('returns 400 when provider missing', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app).post('/api/ev/vehicles')
      .set('Authorization', 'Bearer tok').send({ vehicleId: 'v1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/provider/);
  });

  test('registers vehicle and returns 201', async () => {
    const setVehicle = jest.fn(async () => {});
    const deps = makeDeps({ vehiclesRepo: makeVehiclesRepo({ setVehicle }) });
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles')
      .set('Authorization', 'Bearer tok')
      .send({ vehicleId: 'v1', provider: 'tesla', displayName: 'My EV' });
    expect(res.statusCode).toBe(201);
    expect(res.body.result.vehicleId).toBe('v1');
    expect(setVehicle).toHaveBeenCalled();
  });
});

// ─── DELETE /api/ev/vehicles/:vehicleId ──────────────────────────────────

describe('DELETE /api/ev/vehicles/:vehicleId', () => {
  test('returns 200 on successful deletion', async () => {
    const deleteVehicle = jest.fn(async () => {});
    const deps = makeDeps({ vehiclesRepo: makeVehiclesRepo({ deleteVehicle }) });
    const app = buildApp(deps);
    const res = await request(app).delete('/api/ev/vehicles/v1').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ errno: 0, result: { deleted: true } });
    expect(deleteVehicle).toHaveBeenCalledWith('u-test', 'v1');
  });
});

// ─── GET /api/ev/vehicles/:vehicleId/status ──────────────────────────────

describe('GET /api/ev/vehicles/:vehicleId/status', () => {
  test('returns 404 when vehicle not registered', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app).get('/api/ev/vehicles/missing/status').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(404);
  });

  test('returns cached status when cache is populated and live=0', async () => {
    const cached = { ...STUB_STATUS, source: 'cache' };
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => cached)
      })
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('cache');
  });

  test('fetches live status when live=1', async () => {
    const adapter = makeAdapter();
    const saveVehicleState = jest.fn(async () => {});
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null),
        saveVehicleState
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('live');
    expect(adapter.getVehicleStatus).toHaveBeenCalled();
    expect(adapter.getVehicleStatus).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        region: 'na',
        persistCredentials: expect.any(Function)
      })
    );
    expect(saveVehicleState).toHaveBeenCalled();
  });

  test('returns 400 when vehicle credentials are missing', async () => {
    const adapter = makeAdapter();
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleCredentials: jest.fn(async () => null),
        getVehicleState: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/credentials/i);
    expect(adapter.getVehicleStatus).not.toHaveBeenCalled();
  });

  test('returns 400 when provider not in registry', async () => {
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'unknown-provider' })),
        getVehicleState: jest.fn(async () => null)
      })
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/unknown-provider/);
  });
});

// ─── POST /api/ev/vehicles/:vehicleId/command ────────────────────────────

describe('POST /api/ev/vehicles/:vehicleId/command', () => {
  function makeCommandDeps(adapter = makeAdapter()) {
    return {
      deps: makeDeps({
        vehiclesRepo: makeVehiclesRepo({
          getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
          appendCommand: jest.fn(async () => {}),
          updateCommand: jest.fn(async () => {}),
          getCommand: jest.fn(async () => null),
          listCommands: jest.fn(async () => [])
        }),
        adapterRegistry: makeRegistry(adapter)
      }),
      adapter
    };
  }

  test('returns 400 for unknown command', async () => {
    const { deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok').send({ command: 'hackTheGibson' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/startCharging|stopCharging/);
  });

  test('returns 400 for setChargeLimit without targetSocPct', async () => {
    const { deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok').send({ command: 'setChargeLimit' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/targetSocPct/);
  });

  test('returns 404 when vehicle not registered', async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/missing/command')
      .set('Authorization', 'Bearer tok').send({ command: 'startCharging' });
    expect(res.statusCode).toBe(404);
  });

  test('dispatches startCharging and returns result', async () => {
    const { deps, adapter } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok').send({ command: 'startCharging' });
    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(adapter.startCharging).toHaveBeenCalled();
  });

  test('dispatches stopCharging and returns result', async () => {
    const { deps, adapter } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok').send({ command: 'stopCharging' });
    expect(res.statusCode).toBe(200);
    expect(adapter.stopCharging).toHaveBeenCalled();
  });

  test('dispatches setChargeLimit and returns result', async () => {
    const { deps, adapter } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok').send({ command: 'setChargeLimit', targetSocPct: 80 });
    expect(res.statusCode).toBe(200);
    expect(adapter.setChargeLimit).toHaveBeenCalled();
  });

  test('returns 400 when command credentials missing', async () => {
    const { deps, adapter } = makeCommandDeps();
    deps.vehiclesRepo.getVehicleCredentials = jest.fn(async () => null);
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok').send({ command: 'startCharging' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/credentials/i);
    expect(adapter.startCharging).not.toHaveBeenCalled();
  });

  test('returns 412 when Tesla command readiness reports signed-command setup missing', async () => {
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async () => ({
        readyForCommands: false,
        protocolRequired: true,
        keyPaired: false,
        supportsSignedCommands: false,
        blockingReasons: ['signed_command_required']
      }))
    });
    const { deps } = makeCommandDeps(adapter);
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(412);
    expect(res.body.error).toMatch(/signed command setup required/i);
    expect(res.body.result.readiness).toEqual(expect.objectContaining({
      protocolRequired: true,
      supportsSignedCommands: false,
      readyForCommands: false
    }));
    expect(adapter.startCharging).not.toHaveBeenCalled();
  });

  test('returns 412 with readiness payload when virtual key is not paired', async () => {
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async () => ({
        readyForCommands: false,
        protocolRequired: true,
        keyPaired: false,
        supportsSignedCommands: true,
        blockingReasons: ['virtual_key_not_paired']
      }))
    });
    const { deps } = makeCommandDeps(adapter);
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'stopCharging' });

    expect(res.statusCode).toBe(412);
    expect(res.body.error).toMatch(/virtual key must be paired/i);
    expect(res.body).toMatchObject({
      errno: 412,
      result: {
        readiness: {
          readyForCommands: false,
          protocolRequired: true,
          keyPaired: false,
          supportsSignedCommands: true,
          blockingReasons: ['virtual_key_not_paired']
        }
      }
    });
    expect(adapter.stopCharging).not.toHaveBeenCalled();
  });

  test('returns generic 412 readiness error when blocker reason is unknown', async () => {
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async () => ({
        readyForCommands: false,
        blockingReasons: ['vehicle_asleep']
      }))
    });
    const { deps } = makeCommandDeps(adapter);
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(412);
    expect(res.body.error).toMatch(/not ready to accept ev commands/i);
    expect(res.body.result.readiness).toEqual(expect.objectContaining({
      readyForCommands: false,
      blockingReasons: ['vehicle_asleep']
    }));
    expect(adapter.startCharging).not.toHaveBeenCalled();
  });

  test('continues command flow when readiness preflight fails unexpectedly', async () => {
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async () => {
        throw new Error('fleet_status unavailable');
      })
    });
    const { deps } = makeCommandDeps(adapter);
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(200);
    expect(adapter.startCharging).toHaveBeenCalled();
  });
});

// ─── GET /api/ev/oauth/start ──────────────────────────────────────────────

describe('GET /api/ev/oauth/start', () => {
  test('returns 400 when required query params missing', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app).get('/api/ev/oauth/start?clientId=c1')
      .set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/redirectUri|codeChallenge/);
  });

  test('returns Tesla auth URL for valid params', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app)
      .get('/api/ev/oauth/start?clientId=my-client&redirectUri=https%3A%2F%2Fexample.com%2Fcb&codeChallenge=abc123')
      .set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.result.url).toMatch(/tesla\.com/);
    expect(res.body.result.url).toMatch(/my-client/);
  });
});

// ─── POST /api/ev/oauth/callback ───────────────────────────────────────────

describe('POST /api/ev/oauth/callback', () => {
  test('returns 400 when required body params are missing', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({ clientId: 'c1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/vehicleId|codeVerifier/);
  });

  test('returns 404 when vehicle is not registered', async () => {
    const app = buildApp(makeDeps({
      vehiclesRepo: makeVehiclesRepo({ getVehicle: jest.fn(async () => null) })
    }));
    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({
        vehicleId: 'v1',
        clientId: 'client-1',
        redirectUri: 'https://example.com/callback',
        code: 'auth-code',
        codeVerifier: 'verifier'
      });
    expect(res.statusCode).toBe(404);
  });

  test('returns 400 when vehicle provider is not tesla', async () => {
    const app = buildApp(makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'stub' }))
      })
    }));
    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({
        vehicleId: 'v1',
        clientId: 'client-1',
        redirectUri: 'https://example.com/callback',
        code: 'auth-code',
        codeVerifier: 'verifier'
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/tesla provider only/i);
  });

  test('exchanges auth code and stores canonical token fields', async () => {
    const setVehicleCredentials = jest.fn(async () => {});
    const httpClient = makeTeslaTokenHttpClient();
    const app = buildApp(makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'eu' })),
        setVehicleCredentials
      }),
      httpClient
    }));

    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({
        vehicleId: 'v1',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://example.com/callback',
        code: 'auth-code',
        codeVerifier: 'verifier'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ errno: 0, result: { stored: true, vehicleId: 'v1' } });
    expect(setVehicleCredentials).toHaveBeenCalledWith(
      'u-test',
      'v1',
      expect.objectContaining({
        provider: 'tesla',
        region: 'eu',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        accessToken: 'acc-1',
        refreshToken: 'ref-1',
        tokenType: 'Bearer',
        scope: 'openid offline_access'
      })
    );
    const saved = setVehicleCredentials.mock.calls[0][2];
    expect(saved.expiresAtMs).toEqual(expect.any(Number));
    expect(saved.expiresAtMs).toBeGreaterThan(Date.now());
  });
});
