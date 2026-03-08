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

const STUB_STATUS = {
  socPct: 75, chargingState: 'stopped', chargeLimitPct: 90,
  isPluggedIn: true, isHome: true, rangeKm: 300, asOfIso: '2025-01-01T00:00:00.000Z'
};

function makeAdapter(overrides = {}) {
  return {
    getVehicleStatus: jest.fn(async () => STUB_STATUS),
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
    const vehicle = { vehicleId: 'v1', provider: 'tesla', displayName: 'My EV' };
    const deps = makeDeps({ vehiclesRepo: makeVehiclesRepo({ listVehicles: jest.fn(async () => [vehicle]) }) });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toHaveLength(1);
    expect(res.body.result[0].vehicleId).toBe('v1');
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
    expect(saveVehicleState).toHaveBeenCalled();
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
  function makeCommandDeps() {
    const adapter = makeAdapter();
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
