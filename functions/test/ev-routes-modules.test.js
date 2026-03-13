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
