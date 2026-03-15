'use strict';

const express = require('express');
const request = require('supertest');

const { registerEVRoutes } = require('../api/routes/ev');
const teslaFleetAdapter = require('../lib/adapters/tesla-fleet-adapter');

jest.mock('../lib/adapters/tesla-fleet-adapter', () => {
  const actual = jest.requireActual('../lib/adapters/tesla-fleet-adapter');
  return {
    ...actual,
    getTeslaPartnerDomainPublicKey: jest.fn(actual.getTeslaPartnerDomainPublicKey),
    registerTeslaPartnerDomain: jest.fn(actual.registerTeslaPartnerDomain)
  };
});

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
    supportsChargingCommands: jest.fn(() => true),
    supportsWake: jest.fn(() => true),
    getCommandReadiness: jest.fn(async () => ({
      state: 'ready_direct',
      transport: 'direct',
      source: 'test',
      vehicleCommandProtocolRequired: false
    })),
    wakeVehicle: jest.fn(async () => ({ accepted: true, status: 'online', wakeState: 'online', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' })),
    startCharging: jest.fn(async () => ({ accepted: true, status: 'confirmed', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' })),
    stopCharging: jest.fn(async () => ({ accepted: true, status: 'confirmed', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' })),
    setChargeLimit: jest.fn(async () => ({ accepted: true, status: 'confirmed', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' })),
    setChargingAmps: jest.fn(async () => ({ accepted: true, status: 'confirmed', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' })),
    normalizeProviderError: jest.fn(err => ({ errno: 3800, error: err.message })),
    ...overrides
  };
}

function makeRegistry(adapter = makeAdapter()) {
  return {
    getEVProvider: jest.fn((key) => key === 'tesla' ? adapter : null)
  };
}

function makeEvUsageControl(overrides = {}) {
  return {
    assessRouteRequest: jest.fn(async () => ({ blocked: false, degraded: false, mode: 'off' })),
    recordTeslaApiCall: jest.fn(async () => {}),
    ...overrides
  };
}

function makeDeps(overrides = {}) {
  return {
    authenticateUser: makeAuth(),
    vehiclesRepo: makeVehiclesRepo(),
    adapterRegistry: makeRegistry(),
    evUsageControl: makeEvUsageControl(),
    incrementApiCount: jest.fn(async () => {}),
    getConfig: jest.fn(() => ({
      automation: {
        cacheTtl: {
          teslaStatus: 600000
        }
      }
    })),
    getUserConfig: jest.fn(async () => ({})),
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
    expect(res.body.result[0].hasCredentials).toBe(true);
  });

  test('marks hasCredentials=false when access token is missing', async () => {
    const vehicle = {
      vehicleId: 'v2',
      provider: 'tesla',
      displayName: 'Pending Tesla',
      credentials: { refreshToken: 'refresh-only' }
    };
    const deps = makeDeps({ vehiclesRepo: makeVehiclesRepo({ listVehicles: jest.fn(async () => [vehicle]) }) });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toHaveLength(1);
    expect(res.body.result[0].hasCredentials).toBe(false);
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

  test('normalizes Tesla VIN as canonical vehicleId when provided', async () => {
    const setVehicle = jest.fn(async () => {});
    const deps = makeDeps({ vehiclesRepo: makeVehiclesRepo({ setVehicle }) });
    const app = buildApp(deps);
    const res = await request(app).post('/api/ev/vehicles')
      .set('Authorization', 'Bearer tok')
      .send({
        provider: 'tesla',
        vin: '5yj3e1ea7jf000001',
        displayName: 'Model Y'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.result.vehicleId).toBe('5YJ3E1EA7JF000001');
    expect(res.body.result.vin).toBe('5YJ3E1EA7JF000001');
    expect(setVehicle).toHaveBeenCalledWith(
      'u-test',
      '5YJ3E1EA7JF000001',
      expect.objectContaining({
        provider: 'tesla',
        vin: '5YJ3E1EA7JF000001'
      })
    );
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
    const cached = { ...STUB_STATUS, source: 'cache', asOfIso: new Date().toISOString() };
    const evUsageControl = makeEvUsageControl();
    const incrementApiCount = jest.fn(async () => {});
    const deps = makeDeps({
      evUsageControl,
      incrementApiCount,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => cached)
      })
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('cache');
    expect(res.body.audit).toMatchObject({
      requestedLive: false,
      cacheFresh: true,
      teslaApiCalls: 0,
      teslaBillableApiCalls: 0
    });
    expect(evUsageControl.recordTeslaApiCall).not.toHaveBeenCalled();
    expect(incrementApiCount).not.toHaveBeenCalled();
  });

  test('uses Tesla cache default (10 minutes) when user-specific teslaStatus is not set', async () => {
    const adapter = makeAdapter();
    const cached = { ...STUB_STATUS, asOfIso: new Date(Date.now() - 180000).toISOString() }; // 3 minutes old
    const deps = makeDeps({
      getUserConfig: jest.fn(async () => ({ cache: {} })),
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => cached)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('cache');
    expect(adapter.getVehicleStatus).not.toHaveBeenCalled();
  });

  test('applies the same user Tesla cache TTL to all vehicles', async () => {
    const adapter = makeAdapter();
    const staleCached = { ...STUB_STATUS, asOfIso: new Date(Date.now() - 180000).toISOString() }; // 3 minutes old
    const getVehicle = jest.fn(async (_uid, vehicleId) => ({ vehicleId, provider: 'tesla' }));
    const getVehicleState = jest.fn(async () => staleCached);
    const getUserConfig = jest.fn(async () => ({ cache: { teslaStatus: 120000 } })); // 2 minutes
    const deps = makeDeps({
      getUserConfig,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle,
        getVehicleState,
        saveVehicleState: jest.fn(async () => {})
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);

    const resOne = await request(app).get('/api/ev/vehicles/v1/status').set('Authorization', 'Bearer tok');
    const resTwo = await request(app).get('/api/ev/vehicles/v2/status').set('Authorization', 'Bearer tok');

    expect(resOne.statusCode).toBe(200);
    expect(resTwo.statusCode).toBe(200);
    expect(resOne.body.source).toBe('live');
    expect(resTwo.body.source).toBe('live');
    expect(getUserConfig).toHaveBeenCalledWith('u-test');
    expect(adapter.getVehicleStatus).toHaveBeenCalledTimes(2);
  });

  test('fetches live status when live=1', async () => {
    const adapter = makeAdapter();
    const saveVehicleState = jest.fn(async () => {});
    const incrementApiCount = jest.fn(async () => {});
    const deps = makeDeps({
      incrementApiCount,
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
    expect(res.body.audit).toMatchObject({
      requestedLive: true,
      teslaApiCalls: 0,
      teslaBillableApiCalls: 0
    });
    expect(incrementApiCount).not.toHaveBeenCalled();
  });

  test('increments generic EV counter once for billable Tesla upstream activity within one status request', async () => {
    const incrementApiCount = jest.fn(async () => {});
    const evUsageControl = makeEvUsageControl();
    const adapter = makeAdapter({
      getVehicleStatus: jest.fn(async (_vehicleId, context) => {
        await context.recordTeslaApiCall({ category: 'auth', status: 200, billable: false });
        await context.recordTeslaApiCall({ category: 'data_request', status: 200, billable: true });
        return STUB_STATUS;
      })
    });
    const deps = makeDeps({
      incrementApiCount,
      evUsageControl,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null),
        saveVehicleState: jest.fn(async () => {})
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);

    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(200);
    expect(res.body.audit).toMatchObject({
      requestedLive: true,
      teslaApiCalls: 2,
      teslaBillableApiCalls: 1,
      teslaApiCallsByCategory: {
        auth: 1,
        data_request: 1
      }
    });
    expect(evUsageControl.recordTeslaApiCall).toHaveBeenCalledTimes(2);
    expect(incrementApiCount).toHaveBeenCalledTimes(1);
    expect(incrementApiCount).toHaveBeenCalledWith('u-test', 'ev');
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

  test('returns 429 when Tesla usage guard blocks live status request', async () => {
    const adapter = makeAdapter();
    const evUsageControl = makeEvUsageControl({
      assessRouteRequest: jest.fn(async () => ({
        blocked: true,
        statusCode: 429,
        errno: 429,
        reasonCode: 'rate_limit_exceeded',
        retryAfterSeconds: 12,
        error: 'Tesla EV rate limit exceeded for this vehicle; retry after 12s'
      }))
    });
    const deps = makeDeps({
      evUsageControl,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('12');
    expect(res.body.result.reasonCode).toBe('rate_limit_exceeded');
    expect(adapter.getVehicleStatus).not.toHaveBeenCalled();
  });

  test('returns cached status in degraded mode for live status requests', async () => {
    const cached = { ...STUB_STATUS, asOfIso: '2025-01-01T00:00:00.000Z' };
    const adapter = makeAdapter();
    const evUsageControl = makeEvUsageControl({
      assessRouteRequest: jest.fn(async () => ({
        blocked: false,
        degraded: true,
        mode: 'auto',
        reasonCode: 'vehicle_unit_limit_reached'
      }))
    });
    const deps = makeDeps({
      evUsageControl,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => cached)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('cache_degraded');
    expect(res.body.degraded).toBe(true);
    expect(res.body.reasonCode).toBe('vehicle_unit_limit_reached');
    expect(adapter.getVehicleStatus).not.toHaveBeenCalled();
  });

  test('returns 400 with reconnect guidance when Tesla provider auth is stale', async () => {
    const providerError = new Error('Unauthorized');
    providerError.status = 401;

    const adapter = makeAdapter({
      getVehicleStatus: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/reconnect tesla/i);
    expect(res.body.result.reasonCode).toBe('tesla_reconnect_required');
  });

  test('returns 429 with Retry-After when Tesla provider rate-limits live status', async () => {
    const providerError = new Error('Too Many Requests');
    providerError.status = 429;
    providerError.retryAfterMs = 12000;

    const adapter = makeAdapter({
      getVehicleStatus: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('12');
    expect(res.body.result.reasonCode).toBe('provider_rate_limited');
  });

  test('returns cached status when Tesla provider upstream is unavailable', async () => {
    const providerError = new Error('HTTP 500');
    providerError.status = 500;
    const cached = { ...STUB_STATUS, asOfIso: '2025-01-01T00:00:00.000Z' };

    const adapter = makeAdapter({
      getVehicleStatus: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => cached)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('cache_upstream_unavailable');
    expect(res.body.degraded).toBe(true);
    expect(res.body.reasonCode).toBe('tesla_upstream_unavailable');
  });

  test('returns 503 when Tesla provider upstream is unavailable and no cache exists', async () => {
    const providerError = new Error('HTTP 500');
    providerError.status = 500;
    providerError.retryAfterMs = 7000;

    const adapter = makeAdapter({
      getVehicleStatus: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('7');
    expect(res.body.result).toMatchObject({
      degraded: true,
      reasonCode: 'tesla_upstream_unavailable',
      retryAfterSeconds: 7
    });
  });

  test('maps message-only HTTP 500 Tesla errors to degraded 503 response', async () => {
    const providerError = new Error('Tesla token exchange failed (HTTP 500)');

    const adapter = makeAdapter({
      getVehicleStatus: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleState: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app).get('/api/ev/vehicles/v1/status?live=1').set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(503);
    expect(res.body.result.reasonCode).toBe('tesla_upstream_unavailable');
  });
});

// ─── GET /api/ev/vehicles/:vehicleId/command-readiness ───────────────────

describe('GET /api/ev/vehicles/:vehicleId/command-readiness', () => {
  test('returns 404 when vehicle not registered', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app)
      .get('/api/ev/vehicles/missing/command-readiness')
      .set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(404);
  });

  test('returns adapter command readiness with audit metadata', async () => {
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async (_vehicleId, context) => {
        await context.recordTeslaApiCall({ category: 'data_request', status: 200, billable: true });
        return {
          state: 'ready_direct',
          transport: 'direct',
          source: 'fleet_status',
          vehicleCommandProtocolRequired: false
        };
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'na', vin: '5YJ3E1EA7JF000001' }))
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app)
      .get('/api/ev/vehicles/v1/command-readiness')
      .set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(200);
    expect(res.body.result).toMatchObject({
      state: 'ready_direct',
      transport: 'direct',
      source: 'fleet_status'
    });
    expect(res.body.audit).toMatchObject({
      routeName: 'command_readiness',
      teslaApiCalls: 1,
      teslaBillableApiCalls: 1
    });
    expect(adapter.getCommandReadiness).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        region: 'na',
        vehicleVin: '5YJ3E1EA7JF000001',
        persistCredentials: expect.any(Function)
      })
    );
  });

  test('returns setup_required when credentials are missing', async () => {
    const adapter = makeAdapter();
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' })),
        getVehicleCredentials: jest.fn(async () => null)
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app)
      .get('/api/ev/vehicles/v1/command-readiness')
      .set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(200);
    expect(res.body.result).toMatchObject({
      state: 'setup_required',
      transport: 'none',
      reasonCode: 'vehicle_credentials_not_configured'
    });
    expect(adapter.getCommandReadiness).not.toHaveBeenCalled();
  });

  test('returns 400 with reconnect guidance when Tesla command readiness auth is stale', async () => {
    const providerError = new Error('Unauthorized');
    providerError.status = 401;
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' }))
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app)
      .get('/api/ev/vehicles/v1/command-readiness')
      .set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/reconnect tesla/i);
    expect(res.body.result.reasonCode).toBe('tesla_reconnect_required');
  });

  test('returns 403 with setup guidance when Tesla command readiness is forbidden for app permissions', async () => {
    const providerError = new Error('Forbidden: missing vehicle_charging_cmds scope');
    providerError.status = 403;
    const adapter = makeAdapter({
      getCommandReadiness: jest.fn(async () => {
        throw providerError;
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' }))
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);
    const res = await request(app)
      .get('/api/ev/vehicles/v1/command-readiness')
      .set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/permissions|vehicle approval|reconnect tesla/i);
    expect(res.body.result.reasonCode).toBe('tesla_permission_denied');
  });
});

describe('POST /api/ev/vehicles/:vehicleId/wake', () => {
  test('wakes a Tesla vehicle manually and returns audit metadata', async () => {
    const adapter = makeAdapter({
      wakeVehicle: jest.fn(async (_vehicleId, context) => {
        await context.recordTeslaApiCall({ category: 'wake', status: 200, billable: true });
        return { accepted: true, status: 'online', wakeState: 'online', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' };
      })
    });
    const deps = makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'na', vin: '5YJ3E1EA7JF000001' }))
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);

    const res = await request(app)
      .post('/api/ev/vehicles/v1/wake')
      .set('Authorization', 'Bearer tok');

    expect(res.statusCode).toBe(200);
    expect(res.body.result).toMatchObject({
      accepted: true,
      command: 'wakeVehicle',
      provider: 'tesla',
      vehicleId: 'v1',
      wakeState: 'online'
    });
    expect(res.body.audit).toMatchObject({
      routeName: 'wake_vehicle',
      teslaApiCalls: 1,
      teslaBillableApiCalls: 1,
      teslaApiCallsByCategory: {
        wake: 1
      }
    });
    expect(adapter.wakeVehicle).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        region: 'na',
        vehicleVin: '5YJ3E1EA7JF000001'
      })
    );
  });

  test('applies a stricter cooldown to repeated wake requests', async () => {
    const app = buildApp(makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla' }))
      })
    }));

    const first = await request(app)
      .post('/api/ev/vehicles/v1/wake')
      .set('Authorization', 'Bearer tok');
    const second = await request(app)
      .post('/api/ev/vehicles/v1/wake')
      .set('Authorization', 'Bearer tok');

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.body.result.reasonCode).toBe('wake_cooldown_active');
  });
});

// ─── POST /api/ev/vehicles/:vehicleId/command ────────────────────────────

describe('POST /api/ev/vehicles/:vehicleId/command', () => {
  function makeCommandDeps(adapterOverrides = {}, repoOverrides = {}, usageOverrides = {}) {
    const adapter = makeAdapter(adapterOverrides);
    const deps = makeDeps({
      evUsageControl: makeEvUsageControl(usageOverrides),
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'na', vin: '5YJ3E1EA7JF000001' })),
        ...repoOverrides
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    return { adapter, deps };
  }

  test('returns 400 for unknown command', async () => {
    const { deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'hackTheGibson' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/startCharging, stopCharging, setChargeLimit, setChargingAmps/);
  });

  test('returns 400 when setChargeLimit omits targetSocPct', async () => {
    const { deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'setChargeLimit' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/targetSocPct/);
  });

  test('returns 400 when setChargingAmps omits chargingAmps', async () => {
    const { deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'setChargingAmps' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/chargingAmps/);
  });

  test('dispatches startCharging and returns audit metadata', async () => {
    const incrementApiCount = jest.fn(async () => {});
    const evUsageControl = makeEvUsageControl();
    const adapter = makeAdapter({
      startCharging: jest.fn(async (_vehicleId, context) => {
        await context.recordTeslaApiCall({ category: 'command', status: 200, billable: true });
        return { accepted: true, status: 'confirmed', transport: 'direct', asOfIso: '2025-01-01T00:00:00.000Z' };
      })
    });
    const deps = makeDeps({
      incrementApiCount,
      evUsageControl,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'na', vin: '5YJ3E1EA7JF000001' }))
      }),
      adapterRegistry: makeRegistry(adapter)
    });
    const app = buildApp(deps);

    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(200);
    expect(res.body.result).toMatchObject({
      accepted: true,
      command: 'startCharging',
      provider: 'tesla',
      transport: 'direct',
      vehicleId: 'v1',
      status: 'confirmed'
    });
    expect(res.body.audit).toMatchObject({
      routeName: 'command_startCharging',
      teslaApiCalls: 1,
      teslaBillableApiCalls: 1,
      teslaApiCallsByCategory: {
        command: 1
      }
    });
    expect(evUsageControl.recordTeslaApiCall).toHaveBeenCalledTimes(1);
    expect(incrementApiCount).toHaveBeenCalledTimes(1);
    expect(adapter.startCharging).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({
        region: 'na',
        vehicleVin: '5YJ3E1EA7JF000001',
        commandReadiness: expect.objectContaining({ state: 'ready_direct' })
      })
    );
  });

  test('dispatches setChargeLimit with normalized limit payload', async () => {
    const { adapter, deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'setChargeLimit', targetSocPct: 80 });

    expect(res.statusCode).toBe(200);
    expect(adapter.setChargeLimit).toHaveBeenCalledWith(
      'v1',
      80,
      expect.objectContaining({ commandReadiness: expect.any(Object) })
    );
    expect(res.body.result.targetSocPct).toBe(80);
  });

  test('dispatches setChargingAmps with normalized amps payload', async () => {
    const { adapter, deps } = makeCommandDeps();
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'setChargingAmps', chargingAmps: 16 });

    expect(res.statusCode).toBe(200);
    expect(adapter.setChargingAmps).toHaveBeenCalledWith(
      'v1',
      16,
      expect.objectContaining({ commandReadiness: expect.any(Object) })
    );
    expect(res.body.result.chargingAmps).toBe(16);
  });

  test('returns 503 when Tesla command readiness requires proxy but none is available', async () => {
    const { adapter, deps } = makeCommandDeps({
      getCommandReadiness: jest.fn(async () => ({
        state: 'proxy_unavailable',
        transport: 'signed',
        source: 'fleet_status',
        reasonCode: 'signed_command_proxy_unavailable',
        vehicleCommandProtocolRequired: true
      }))
    });
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(503);
    expect(res.body.result.reasonCode).toBe('signed_command_proxy_unavailable');
    expect(adapter.startCharging).not.toHaveBeenCalled();
  });

  test('returns 403 when Tesla command readiness requires vehicle_cmds scope upgrade', async () => {
    const { adapter, deps } = makeCommandDeps({
      getCommandReadiness: jest.fn(async () => ({
        state: 'oauth_scope_upgrade_required',
        transport: 'signed',
        source: 'fleet_status',
        reasonCode: 'tesla_vehicle_cmds_scope_required',
        vehicleCommandProtocolRequired: true,
        missingScopes: ['vehicle_cmds']
      }))
    });
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(403);
    expect(res.body.result.reasonCode).toBe('tesla_vehicle_cmds_scope_required');
    expect(adapter.startCharging).not.toHaveBeenCalled();
  });

  test('returns 409 when Tesla virtual key pairing is missing', async () => {
    const error = new Error('vehicle rejected request: your public key has not been paired with the vehicle');
    error.isVirtualKeyMissing = true;
    const { deps } = makeCommandDeps({
      startCharging: jest.fn(async () => {
        throw error;
      })
    });
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(409);
    expect(res.body.result.reasonCode).toBe('missing_virtual_key');
  });

  test('returns 403 for Tesla command authorization failures instead of reconnect-required 400', async () => {
    const error = new Error('Unauthorized: missing vehicle command permission on this vehicle');
    error.status = 403;
    const { deps } = makeCommandDeps({
      setChargeLimit: jest.fn(async () => {
        throw error;
      })
    });
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'setChargeLimit', targetSocPct: 80 });

    expect(res.statusCode).toBe(403);
    expect(res.body.result.reasonCode).toBe('tesla_permission_denied');
  });

  test('returns 408 when signed command times out even if adapter marks proxy failure', async () => {
    const error = new Error('request timed out while waiting for Tesla command response');
    error.status = 408;
    error.transport = 'signed';
    error.isProxyFailure = true;
    error.reasonCode = 'signed_command_proxy_timeout';

    const { deps } = makeCommandDeps({
      setChargeLimit: jest.fn(async () => {
        throw error;
      })
    });
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'setChargeLimit', targetSocPct: 80 });

    expect(res.statusCode).toBe(408);
    expect(res.body.result.reasonCode).toBe('vehicle_offline');
  });

  test('returns 429 when command cooldown is active for repeated commands', async () => {
    const { deps } = makeCommandDeps();
    const app = buildApp(deps);

    const first = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });
    const second = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.body.result.reasonCode).toBe('command_cooldown_active');
  });

  test('returns cached result when the same commandId is replayed', async () => {
    const { adapter, deps } = makeCommandDeps();
    const app = buildApp(deps);

    const first = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging', commandId: 'cmd-123' });
    const second = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging', commandId: 'cmd-123' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body.result.duplicate).toBe(true);
    expect(adapter.startCharging).toHaveBeenCalledTimes(1);
  });

  test('returns 429 when Tesla usage guard blocks command requests', async () => {
    const { adapter, deps } = makeCommandDeps({}, {}, {
      assessRouteRequest: jest.fn(async () => ({
        blocked: true,
        statusCode: 429,
        errno: 429,
        reasonCode: 'rate_limit_exceeded',
        retryAfterSeconds: 8,
        error: 'Tesla EV rate limit exceeded for this vehicle; retry after 8s'
      }))
    });
    const app = buildApp(deps);
    const res = await request(app)
      .post('/api/ev/vehicles/v1/command')
      .set('Authorization', 'Bearer tok')
      .send({ command: 'startCharging' });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('8');
    expect(res.body.result.reasonCode).toBe('rate_limit_exceeded');
    expect(adapter.startCharging).not.toHaveBeenCalled();
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
    expect(res.body.result.url).toMatch(/prompt_missing_scopes=true/);
    expect(res.body.result.url).toMatch(/require_requested_scopes=true/);
  });
});

describe('POST /api/ev/partner/register-domain', () => {
  afterEach(() => {
    teslaFleetAdapter.getTeslaPartnerDomainPublicKey.mockReset();
    teslaFleetAdapter.registerTeslaPartnerDomain.mockReset();
  });

  test('returns 400 when required body params are missing', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/register-domain')
      .set('Authorization', 'Bearer tok')
      .send({ clientId: 'client-1' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/clientId, clientSecret/);
  });

  test('registers Tesla partner domain derived from redirectUri', async () => {
    teslaFleetAdapter.registerTeslaPartnerDomain.mockResolvedValueOnce({
      registered: true,
      domain: 'socratesautomation.com',
      region: 'na'
    });
    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/register-domain')
      .set('Authorization', 'Bearer tok')
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://socratesautomation.com/settings.html',
        region: 'na'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      errno: 0,
      result: {
        registered: true,
        alreadyRegistered: false,
        domain: 'socratesautomation.com',
        region: 'na'
      }
    });
    expect(teslaFleetAdapter.registerTeslaPartnerDomain).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        domain: 'socratesautomation.com',
        region: 'na'
      }),
      expect.any(Function)
    );
  });

  test('treats public key conflict as already-registered when verification lookup fails', async () => {
    teslaFleetAdapter.registerTeslaPartnerDomain.mockRejectedValueOnce(
      new Error('Tesla partner registration failed: Validation failed: Public key hash has already been taken')
    );
    teslaFleetAdapter.getTeslaPartnerDomainPublicKey.mockRejectedValueOnce(
      new Error('Tesla partner public key lookup failed: not found')
    );
    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/register-domain')
      .set('Authorization', 'Bearer tok')
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://socratesautomation.com/settings.html',
        region: 'na'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      errno: 0,
      result: {
        registered: true,
        alreadyRegistered: true,
        verificationState: 'unverified_conflict',
        domain: 'socratesautomation.com',
        region: 'na'
      }
    });
  });

  test('treats public key conflict as success when the same app already owns the domain registration', async () => {
    teslaFleetAdapter.registerTeslaPartnerDomain.mockRejectedValueOnce(
      new Error('Tesla partner registration failed: Validation failed: Public key hash has already been taken')
    );
    teslaFleetAdapter.getTeslaPartnerDomainPublicKey.mockResolvedValueOnce({
      domain: 'socratesautomation.com',
      region: 'na',
      publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----'
    });

    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/register-domain')
      .set('Authorization', 'Bearer tok')
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://socratesautomation.com/settings.html',
        region: 'na'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      errno: 0,
      result: {
        registered: true,
        alreadyRegistered: true,
        verificationState: 'verified',
        domain: 'socratesautomation.com',
        region: 'na'
      }
    });
    expect(teslaFleetAdapter.getTeslaPartnerDomainPublicKey).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        domain: 'socratesautomation.com',
        region: 'na'
      }),
      expect.any(Function)
    );
  });
});

describe('POST /api/ev/partner/check-domain-access', () => {
  afterEach(() => {
    teslaFleetAdapter.getTeslaPartnerDomainPublicKey.mockReset();
  });

  test('returns 400 when required body params are missing', async () => {
    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/check-domain-access')
      .set('Authorization', 'Bearer tok')
      .send({ clientId: 'client-1' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/clientId, clientSecret/);
  });

  test('returns accessible=true when Tesla app has domain access', async () => {
    teslaFleetAdapter.getTeslaPartnerDomainPublicKey.mockResolvedValueOnce({
      domain: 'socratesautomation.com',
      region: 'na',
      publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----'
    });

    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/check-domain-access')
      .set('Authorization', 'Bearer tok')
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://socratesautomation.com/settings.html',
        region: 'na'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      errno: 0,
      result: {
        accessible: true,
        domain: 'socratesautomation.com',
        region: 'na',
        publicKeyPresent: true
      }
    });
  });

  test('returns accessible=false when Tesla app does not have access to the domain', async () => {
    teslaFleetAdapter.getTeslaPartnerDomainPublicKey.mockRejectedValueOnce(
      new Error('Tesla partner public key lookup failed: This account does not have access to socratesautomation.com')
    );

    const app = buildApp(makeDeps());
    const res = await request(app)
      .post('/api/ev/partner/check-domain-access')
      .set('Authorization', 'Bearer tok')
      .send({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUri: 'https://socratesautomation.com/settings.html',
        region: 'na'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(res.body.result).toEqual(expect.objectContaining({
      accessible: false,
      domain: 'socratesautomation.com',
      region: 'na',
      reasonCode: 'tesla_partner_domain_access_denied'
    }));
    expect(String(res.body.result.error || '')).toMatch(/does not have access to socratesautomation\.com/i);
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

  test('resolves vehicle lookup by VIN when vehicleId is omitted', async () => {
    const setVehicleCredentials = jest.fn(async () => {});
    const updateVehicle = jest.fn(async () => {});
    const httpClient = makeTeslaTokenHttpClient();
    const app = buildApp(makeDeps({
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async (_uid, id) => {
          if (id === '5YJ3E1EA7JF000001') {
            return { vehicleId: '5YJ3E1EA7JF000001', provider: 'tesla', region: 'na' };
          }
          return null;
        }),
        setVehicleCredentials,
        updateVehicle
      }),
      httpClient
    }));

    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({
        vin: '5yj3e1ea7jf000001',
        clientId: 'client-1',
        redirectUri: 'https://example.com/callback',
        code: 'auth-code',
        codeVerifier: 'verifier'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.result).toEqual(expect.objectContaining({
      stored: true,
      vehicleId: '5YJ3E1EA7JF000001',
      vin: '5YJ3E1EA7JF000001'
    }));
    expect(setVehicleCredentials).toHaveBeenCalledWith(
      'u-test',
      '5YJ3E1EA7JF000001',
      expect.objectContaining({
        vin: '5YJ3E1EA7JF000001'
      })
    );
    expect(updateVehicle).toHaveBeenCalledWith(
      'u-test',
      '5YJ3E1EA7JF000001',
      expect.objectContaining({ vin: '5YJ3E1EA7JF000001' })
    );
  });
});

// ─── Shared Tesla App Config helpers ───────────────────────────────────────

function makeDb(initialData = {}) {
  const store = {};
  for (const [k, v] of Object.entries(initialData)) store[k] = v;
  return {
    doc: jest.fn((path) => ({
      get: jest.fn(async () => {
        const data = store[path];
        return { exists: !!data, data: () => (data ? { ...data } : {}) };
      }),
      set: jest.fn(async (payload, options) => {
        if (options && options.merge) {
          store[path] = { ...(store[path] || {}), ...payload };
        } else {
          store[path] = payload;
        }
      })
    }))
  };
}

function makeRequireAdmin(isAdmin = true) {
  return (req, res, next) => {
    if (isAdmin) return next();
    return res.status(403).json({ errno: 403, error: 'Forbidden' });
  };
}

// ─── GET /api/ev/tesla-app-config ──────────────────────────────────────────

describe('GET /api/ev/tesla-app-config', () => {
  test('returns configured=false when no shared config doc exists', async () => {
    const db = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await request(app)
      .get('/api/ev/tesla-app-config')
      .set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ errno: 0, result: { configured: false } });
  });

  test('returns configured=true with clientId when shared config exists', async () => {
    const db = makeDb({
      'shared/teslaAppConfig': {
        clientId: 'shared-client-id',
        clientSecret: 'shared-secret',
        domain: 'example.com',
        domainRegistered: true
      }
    });
    const app = buildApp(makeDeps({ db }));
    const res = await request(app)
      .get('/api/ev/tesla-app-config')
      .set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      errno: 0,
      result: {
        configured: true,
        clientId: 'shared-client-id',
        domain: 'example.com',
        domainRegistered: true
      }
    });
    // clientSecret must never be returned to the client
    expect(res.body.result.clientSecret).toBeUndefined();
  });

  test('returns 401 when unauthenticated', async () => {
    const app = buildApp(makeDeps({ db: makeDb() }));
    const res = await request(app).get('/api/ev/tesla-app-config');
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /api/ev/tesla-app-config ─────────────────────────────────────────

describe('POST /api/ev/tesla-app-config', () => {
  test('admin can save shared config', async () => {
    const db = makeDb();
    const app = buildApp(makeDeps({ db, requireAdmin: makeRequireAdmin(true) }));
    const res = await request(app)
      .post('/api/ev/tesla-app-config')
      .set('Authorization', 'Bearer tok')
      .send({ clientId: 'new-client', clientSecret: 'new-secret', domain: 'MyDomain.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      errno: 0,
      result: { saved: true, clientId: 'new-client', domain: 'mydomain.com' }
    });
  });

  test('non-admin gets 403', async () => {
    const db = makeDb();
    const app = buildApp(makeDeps({ db, requireAdmin: makeRequireAdmin(false) }));
    const res = await request(app)
      .post('/api/ev/tesla-app-config')
      .set('Authorization', 'Bearer tok')
      .send({ clientId: 'new-client', clientSecret: 'new-secret' });
    expect(res.statusCode).toBe(403);
  });

  test('returns 400 when clientId is missing', async () => {
    const db = makeDb();
    const app = buildApp(makeDeps({ db, requireAdmin: makeRequireAdmin(true) }));
    const res = await request(app)
      .post('/api/ev/tesla-app-config')
      .set('Authorization', 'Bearer tok')
      .send({ clientSecret: 'secret-only' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/clientId/);
  });

  test('route not registered when requireAdmin is absent', async () => {
    const db = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await request(app)
      .post('/api/ev/tesla-app-config')
      .set('Authorization', 'Bearer tok')
      .send({ clientId: 'client' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── shared credential fallback ────────────────────────────────────────────

describe('shared Tesla app config fallback', () => {
  test('GET /api/ev/oauth/start uses shared clientId when not in query', async () => {
    const db = makeDb({
      'shared/teslaAppConfig': { clientId: 'shared-client-id' }
    });
    const app = buildApp(makeDeps({ db }));
    const res = await request(app)
      .get('/api/ev/oauth/start?redirectUri=https%3A%2F%2Fexample.com%2Fcb&codeChallenge=abc123')
      .set('Authorization', 'Bearer tok');
    expect(res.statusCode).toBe(200);
    expect(res.body.result.url).toMatch(/shared-client-id/);
  });

  test('POST /api/ev/oauth/callback uses shared credentials when not in body', async () => {
    const db = makeDb({
      'shared/teslaAppConfig': { clientId: 'shared-client', clientSecret: 'shared-secret' }
    });
    const setVehicleCredentials = jest.fn(async () => {});
    const httpClient = makeTeslaTokenHttpClient();
    const app = buildApp(makeDeps({
      db,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'na' })),
        setVehicleCredentials
      }),
      httpClient
    }));

    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({
        vehicleId: 'v1',
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
        clientId: 'shared-client',
        clientSecret: 'shared-secret'
      })
    );
  });

  test('POST /api/ev/oauth/callback still uses request body credentials when provided', async () => {
    const db = makeDb({
      'shared/teslaAppConfig': { clientId: 'shared-client', clientSecret: 'shared-secret' }
    });
    const setVehicleCredentials = jest.fn(async () => {});
    const httpClient = makeTeslaTokenHttpClient();
    const app = buildApp(makeDeps({
      db,
      vehiclesRepo: makeVehiclesRepo({
        getVehicle: jest.fn(async () => ({ vehicleId: 'v1', provider: 'tesla', region: 'na' })),
        setVehicleCredentials
      }),
      httpClient
    }));

    const res = await request(app)
      .post('/api/ev/oauth/callback')
      .set('Authorization', 'Bearer tok')
      .send({
        vehicleId: 'v1',
        clientId: 'body-client',
        clientSecret: 'body-secret',
        redirectUri: 'https://example.com/callback',
        code: 'auth-code',
        codeVerifier: 'verifier'
      });

    expect(res.statusCode).toBe(200);
    expect(setVehicleCredentials).toHaveBeenCalledWith(
      'u-test',
      'v1',
      expect.objectContaining({
        clientId: 'body-client',
        clientSecret: 'body-secret'
      })
    );
  });
});
