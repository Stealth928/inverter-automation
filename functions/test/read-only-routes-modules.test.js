'use strict';

const express = require('express');
const request = require('supertest');

const { registerDeviceReadRoutes } = require('../api/routes/device-read');
const { registerDiagnosticsReadRoutes } = require('../api/routes/diagnostics-read');
const { registerInverterHistoryRoutes } = require('../api/routes/inverter-history');
const { registerInverterReadRoutes } = require('../api/routes/inverter-read');
const { registerMetricsRoutes } = require('../api/routes/metrics');
const { registerPricingRoutes } = require('../api/routes/pricing');
const { registerSchedulerReadRoutes } = require('../api/routes/scheduler-read');
const { registerWeatherRoutes } = require('../api/routes/weather');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

describe('read-only route modules', () => {
  test('pricing routes return safe empty list when unauthenticated', async () => {
    const amberPricesInFlight = new Map();
    const amberAPI = {
      callAmberAPI: jest.fn(),
      cacheAmberPricesCurrent: jest.fn(),
      cacheAmberSites: jest.fn(),
      getCachedAmberPricesCurrent: jest.fn(),
      getCachedAmberSites: jest.fn()
    };

    const app = buildApp((instance) => {
      registerPricingRoutes(instance, {
        amberAPI,
        amberPricesInFlight,
        authenticateUser: (_req, res, _next) => res.status(401).json({ errno: 401, error: 'Unauthorized' }),
        getUserConfig: jest.fn(),
        incrementApiCount: jest.fn(),
        logger: { debug: jest.fn(), warn: jest.fn() },
        tryAttachUser: jest.fn(async (req) => { req.user = null; })
      });
    });

    const sites = await request(app).get('/api/amber/sites');
    expect(sites.statusCode).toBe(200);
    expect(sites.body).toEqual({ errno: 0, result: [] });

    const pricingSites = await request(app).get('/api/pricing/sites');
    expect(pricingSites.statusCode).toBe(200);
    expect(pricingSites.body).toEqual({ errno: 0, result: [] });

    const pricesCurrent = await request(app).get('/api/amber/prices/current');
    expect(pricesCurrent.statusCode).toBe(200);
    expect(pricesCurrent.body).toEqual({ errno: 0, result: [] });

    const pricingCurrent = await request(app).get('/api/pricing/current');
    expect(pricingCurrent.statusCode).toBe(200);
    expect(pricingCurrent.body).toEqual({ errno: 0, result: [] });
  });

  test('metrics routes return global zero-filled envelope when db is unavailable', async () => {
    const app = buildApp((instance) => {
      registerMetricsRoutes(instance, {
        db: null,
        getAusDateKey: (date) => date.toISOString().slice(0, 10),
        tryAttachUser: jest.fn(async () => null)
      });
    });

    const response = await request(app)
      .get('/api/metrics/api-calls')
      .query({ days: 2, scope: 'global' });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(Object.keys(response.body.result)).toHaveLength(2);
    Object.values(response.body.result).forEach((value) => {
      expect(value).toEqual(expect.objectContaining({ inverter: 0, foxess: 0, amber: 0, weather: 0, ev: 0 }));
      expect(value.inverterByProvider).toEqual(expect.objectContaining({ foxess: 0, sungrow: 0, sigenergy: 0, alphaess: 0 }));
    });
  });

  test('metrics routes enforce auth for user-scoped requests', async () => {
    const db = {
      collection: jest.fn()
    };

    const app = buildApp((instance) => {
      registerMetricsRoutes(instance, {
        db,
        getAusDateKey: (date) => date.toISOString().slice(0, 10),
        tryAttachUser: jest.fn(async (req) => {
          req.user = null;
          return null;
        })
      });
    });

    const response = await request(app)
      .get('/api/metrics/api-calls')
      .query({ scope: 'user', days: 3 });

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized: user scope requested' });
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('metrics routes return user metrics when user scope is requested', async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const metricsSnapshot = {
      forEach: (callback) => {
        callback({
          id: todayKey,
          data: () => ({ foxess: 7, amber: 5, weather: 3 })
        });
      }
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            get: jest.fn(async () => metricsSnapshot)
          }))
        }))
      }))
    };

    const app = buildApp((instance) => {
      registerMetricsRoutes(instance, {
        db,
        getAusDateKey: (date) => date.toISOString().slice(0, 10),
        tryAttachUser: jest.fn(async (req) => {
          req.user = { uid: 'u-metrics' };
          return req.user;
        })
      });
    });

    const response = await request(app)
      .get('/api/metrics/api-calls')
      .query({ scope: 'user', days: 1 });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result[todayKey]).toEqual(expect.objectContaining({
      inverter: 7,
      foxess: 7,
      amber: 5,
      weather: 3,
      ev: 0
    }));
    expect(response.body.result[todayKey].inverterByProvider).toEqual(expect.objectContaining({
      foxess: 7,
      sungrow: 0,
      sigenergy: 0,
      alphaess: 0
    }));
  });

  test('metrics routes expose EV counter from teslaFleet usage metrics', async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const metricsSnapshot = {
      forEach: (callback) => {
        callback({
          id: todayKey,
          data: () => ({
            foxess: 2,
            amber: 1,
            weather: 1,
            teslaFleet: {
              calls: {
                billable: 9,
                total: 12
              }
            }
          })
        });
      }
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            get: jest.fn(async () => metricsSnapshot)
          }))
        }))
      }))
    };

    const app = buildApp((instance) => {
      registerMetricsRoutes(instance, {
        db,
        getAusDateKey: (date) => date.toISOString().slice(0, 10),
        tryAttachUser: jest.fn(async (req) => {
          req.user = { uid: 'u-metrics' };
          return req.user;
        })
      });
    });

    const response = await request(app)
      .get('/api/metrics/api-calls')
      .query({ scope: 'user', days: 1 });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result[todayKey]).toEqual(expect.objectContaining({
      inverter: 2,
      amber: 1,
      weather: 1,
      ev: 9
    }));
  });

  test('metrics routes normalize fractional counters and support lowercase teslafleet payloads', async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const metricsSnapshot = {
      forEach: (callback) => {
        callback({
          id: todayKey,
          data: () => ({
            inverter: 584.456,
            amber: 512.2,
            weather: 58.6,
            teslafleet: {
              calls: {
                total: 3.2
              }
            }
          })
        });
      }
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            get: jest.fn(async () => metricsSnapshot)
          }))
        }))
      }))
    };

    const app = buildApp((instance) => {
      registerMetricsRoutes(instance, {
        db,
        getAusDateKey: (date) => date.toISOString().slice(0, 10),
        tryAttachUser: jest.fn(async (req) => {
          req.user = { uid: 'u-metrics' };
          return req.user;
        })
      });
    });

    const response = await request(app)
      .get('/api/metrics/api-calls')
      .query({ scope: 'user', days: 1 });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result[todayKey]).toEqual(expect.objectContaining({
      inverter: 584,
      amber: 512,
      weather: 59,
      ev: 3
    }));
  });

  test('pricing current endpoint returns cached prices when available', async () => {
    const amberPricesInFlight = new Map();
    const amberAPI = {
      callAmberAPI: jest.fn(),
      cacheAmberPricesCurrent: jest.fn(),
      cacheAmberSites: jest.fn(),
      getCachedAmberPricesCurrent: jest.fn(async () => [{ perKwh: 0.27, channelType: 'general' }]),
      getCachedAmberSites: jest.fn()
    };
    const getUserConfig = jest.fn(async () => ({
      amberApiKey: 'amber-key',
      amberSiteId: 'site-1'
    }));

    const app = buildApp((instance) => {
      registerPricingRoutes(instance, {
        amberAPI,
        amberPricesInFlight,
        authenticateUser: (_req, res, _next) => res.status(401).json({ errno: 401, error: 'Unauthorized' }),
        getUserConfig,
        incrementApiCount: jest.fn(),
        logger: { debug: jest.fn(), warn: jest.fn() },
        tryAttachUser: jest.fn(async (req) => {
          req.user = { uid: 'u-price' };
          return req.user;
        })
      });
    });

    const response = await request(app).get('/api/pricing/current');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: [{ perKwh: 0.27, channelType: 'general' }]
    });
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
    expect(getUserConfig).toHaveBeenCalledWith('u-price');
  });

  test('pricing current endpoint ignores forceRefresh and serves cache in emulator mode', async () => {
    const previousFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
    const previousFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FUNCTIONS_EMULATOR = 'true';

    try {
      const amberPricesInFlight = new Map();
      const amberAPI = {
        callAmberAPI: jest.fn(),
        cacheAmberPricesCurrent: jest.fn(),
        cacheAmberSites: jest.fn(),
        getCachedAmberPricesCurrent: jest.fn(async () => [{ perKwh: 0.31, channelType: 'general' }]),
        getCachedAmberSites: jest.fn()
      };
      const getUserConfig = jest.fn(async () => ({
        amberApiKey: 'amber-key',
        amberSiteId: 'site-1'
      }));

      const app = buildApp((instance) => {
        registerPricingRoutes(instance, {
          amberAPI,
          amberPricesInFlight,
          authenticateUser: (_req, res, _next) => res.status(401).json({ errno: 401, error: 'Unauthorized' }),
          getUserConfig,
          incrementApiCount: jest.fn(),
          logger: { debug: jest.fn(), warn: jest.fn() },
          tryAttachUser: jest.fn(async (req) => {
            req.user = { uid: 'u-price' };
            return req.user;
          })
        });
      });

      const response = await request(app)
        .get('/api/pricing/current')
        .query({ forceRefresh: 'true' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        errno: 0,
        result: [{ perKwh: 0.31, channelType: 'general' }]
      });
      expect(amberAPI.getCachedAmberPricesCurrent).toHaveBeenCalledWith('site-1', 'u-price', {
        amberApiKey: 'amber-key',
        amberSiteId: 'site-1'
      });
      expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
    } finally {
      if (previousFunctionsEmulator === undefined) {
        delete process.env.FUNCTIONS_EMULATOR;
      } else {
        process.env.FUNCTIONS_EMULATOR = previousFunctionsEmulator;
      }
      if (previousFirestoreEmulatorHost === undefined) {
        delete process.env.FIRESTORE_EMULATOR_HOST;
      } else {
        process.env.FIRESTORE_EMULATOR_HOST = previousFirestoreEmulatorHost;
      }
    }
  });

  test('pricing actual endpoint honors authentication middleware and returns matching interval', async () => {
    const amberPricesInFlight = new Map();
    const targetTimestamp = new Date(Date.now() - 60 * 60 * 1000);
    const matchingInterval = {
      channelType: 'feedIn',
      endTime: new Date(targetTimestamp.getTime() + 5 * 60 * 1000).toISOString(),
      perKwh: 0.31,
      startTime: new Date(targetTimestamp.getTime() - 5 * 60 * 1000).toISOString(),
      type: 'ActualInterval'
    };
    const amberAPI = {
      callAmberAPI: jest.fn(async () => [matchingInterval]),
      cacheAmberPricesCurrent: jest.fn(),
      cacheAmberSites: jest.fn(),
      getCachedAmberPricesCurrent: jest.fn(),
      getCachedAmberSites: jest.fn()
    };
    const getUserConfig = jest.fn(async () => ({
      amberApiKey: 'amber-key',
      amberSiteId: 'site-1'
    }));

    const authenticateUser = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-price-auth' };
      return next();
    };

    const app = buildApp((instance) => {
      registerPricingRoutes(instance, {
        amberAPI,
        amberPricesInFlight,
        authenticateUser,
        getUserConfig,
        incrementApiCount: jest.fn(),
        logger: { debug: jest.fn(), warn: jest.fn() },
        tryAttachUser: jest.fn(async () => null)
      });
    });

    const unauthorized = await request(app)
      .get('/api/pricing/actual')
      .query({ timestamp: targetTimestamp.toISOString() });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await request(app)
      .get('/api/pricing/actual')
      .set('Authorization', 'Bearer token')
      .query({ timestamp: targetTimestamp.toISOString() });

    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).toEqual({ errno: 0, result: matchingInterval });

    const legacyAlias = await request(app)
      .get('/api/amber/prices/actual')
      .set('Authorization', 'Bearer token')
      .query({ timestamp: targetTimestamp.toISOString() });
    expect(legacyAlias.statusCode).toBe(200);
    expect(legacyAlias.body).toEqual({ errno: 0, result: matchingInterval });
  });

  test('pricing routes reject unsupported provider values', async () => {
    const amberPricesInFlight = new Map();
    const amberAPI = {
      callAmberAPI: jest.fn(),
      cacheAmberPricesCurrent: jest.fn(),
      cacheAmberSites: jest.fn(),
      getCachedAmberPricesCurrent: jest.fn(),
      getCachedAmberSites: jest.fn()
    };

    const app = buildApp((instance) => {
      registerPricingRoutes(instance, {
        amberAPI,
        amberPricesInFlight,
        authenticateUser: (_req, _res, next) => next(),
        getUserConfig: jest.fn(),
        incrementApiCount: jest.fn(),
        logger: { debug: jest.fn(), warn: jest.fn() },
        tryAttachUser: jest.fn(async () => null)
      });
    });

    const response = await request(app)
      .get('/api/pricing/sites')
      .query({ provider: 'flat-rate' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'Unsupported pricing provider: flat-rate',
      result: []
    });
  });

  test('weather routes proxy cached weather helper response', async () => {
    const mockWeatherResult = { errno: 0, result: { source: 'open-meteo' } };
    const getCachedWeatherData = jest.fn(async () => mockWeatherResult);

    const app = buildApp((instance) => {
      registerWeatherRoutes(instance, {
        getCachedWeatherData,
        tryAttachUser: jest.fn(async (req) => {
          req.user = { uid: 'u-weather' };
          return req.user;
        })
      });
    });

    const response = await request(app)
      .get('/api/weather')
      .query({ place: 'Sydney', days: 3, forceRefresh: 'true' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(mockWeatherResult);
    expect(getCachedWeatherData).toHaveBeenCalledWith('u-weather', 'Sydney', 3, true);
  });

  test('weather routes use anonymous fallback when no user is attached', async () => {
    const mockWeatherResult = { errno: 0, result: { source: 'open-meteo' } };
    const getCachedWeatherData = jest.fn(async () => mockWeatherResult);

    const app = buildApp((instance) => {
      registerWeatherRoutes(instance, {
        getCachedWeatherData,
        tryAttachUser: jest.fn(async () => null)
      });
    });

    const response = await request(app)
      .get('/api/weather')
      .query({ place: 'Melbourne', days: 5 });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(mockWeatherResult);
    expect(getCachedWeatherData).toHaveBeenCalledWith('anonymous', 'Melbourne', 5, false);
  });

  test('inverter routes list endpoint proxies device list request', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: [{ sn: 'SN-1' }] }))
    };
    const getUserConfig = jest.fn(async () => ({ deviceSn: 'SN-1' }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getCachedInverterRealtimeData: jest.fn(),
        getUserConfig,
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/inverter/list');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: [{ sn: 'SN-1' }] });
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/list',
      'POST',
      { currentPage: 1, pageSize: 10 },
      { deviceSn: 'SN-1' },
      'u-inverter'
    );
  });

  test('inverter real-time endpoint returns 400 when device SN is missing', async () => {
    const getCachedInverterRealtimeData = jest.fn();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({})),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Device SN not configured' });
    expect(getCachedInverterRealtimeData).not.toHaveBeenCalled();
  });

  test('inverter real-time endpoint uses cached helper with forceRefresh flag', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({ errno: 0, result: { activePower: 2.1 } }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-2' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .get('/api/inverter/real-time')
      .query({ forceRefresh: 'true' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { activePower: 2.1 } });
    expect(getCachedInverterRealtimeData).toHaveBeenCalledWith(
      'u-inverter',
      'SN-2',
      { deviceSn: 'SN-2' },
      true,
      expect.objectContaining({
        route: 'inverter-real-time',
        userEmail: null,
        alphaessLogMode: 'suspicious-only'
      })
    );
  });

  test('inverter real-time endpoint uses shared realtime cache for AlphaESS providers', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'ALPHA-SN-1',
        time: '2026-03-11T10:15:00.000Z',
        datas: [
          { variable: 'SoC', value: 61, unit: '%' },
          { variable: 'pvPower', value: 4.2, unit: 'kW' },
          { variable: 'loadsPower', value: 1.7, unit: 'kW' },
          { variable: 'gridConsumptionPower', value: 0.3, unit: 'kW' },
          { variable: 'feedinPower', value: 0, unit: 'kW' },
          { variable: 'meterPower2', value: 0.3, unit: 'kW' },
          { variable: 'batTemperature', value: 28.5, unit: 'C' },
          { variable: 'ambientTemperation', value: 22.2, unit: 'C' },
          { variable: 'batChargePower', value: 1.2, unit: 'kW' },
          { variable: 'batDischargePower', value: 0, unit: 'kW' }
        ]
      }],
      alphaessDiagnostics: {
        provider: 'alphaess',
        suspicious: false
      }
    }));
    const logger = { log: jest.fn(), warn: jest.fn() };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-SN-1'
        })),
        logger,
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result[0].deviceSN).toBe('ALPHA-SN-1');
    const datas = response.body.result[0].datas || [];
    const chargePoint = datas.find((entry) => entry.variable === 'batChargePower');
    expect(response.body.result[0].datas).toEqual(expect.arrayContaining([
      expect.objectContaining({ variable: 'SoC', value: 61, unit: '%' }),
      expect.objectContaining({ variable: 'pvPower', value: 4.2, unit: 'kW' }),
      expect.objectContaining({ variable: 'loadsPower', value: 1.7, unit: 'kW' }),
      expect.objectContaining({ variable: 'batChargePower', value: 1.2, unit: 'kW' })
    ]));
    expect(chargePoint).toEqual(expect.objectContaining({ variable: 'batChargePower', value: 1.2, unit: 'kW' }));
    expect(getCachedInverterRealtimeData).toHaveBeenCalledWith('u-alpha', 'ALPHA-SN-1', {
      deviceProvider: 'alphaess',
      alphaessSystemSn: 'ALPHA-SN-1'
    }, false, {
      route: 'inverter-real-time',
      userEmail: null,
      logger,
      alphaessLogMode: 'suspicious-only'
    });
    expect(response.body.alphaessDiagnostics).toEqual(expect.objectContaining({
      provider: 'alphaess',
      suspicious: false
    }));
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('inverter real-time endpoint inverts AlphaESS battery sign for AC-coupled topology', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'ALPHA-SN-1',
        time: '2026-03-11T10:15:00.000Z',
        datas: [
          { variable: 'SoC', value: 61, unit: '%' },
          { variable: 'pvPower', value: 0, unit: 'kW' },
          { variable: 'loadsPower', value: 1.7, unit: 'kW' },
          { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
          { variable: 'feedinPower', value: 2.4, unit: 'kW' },
          { variable: 'meterPower2', value: -2.4, unit: 'kW' },
          { variable: 'batChargePower', value: 0, unit: 'kW' },
          { variable: 'batDischargePower', value: 1.2, unit: 'kW' }
        ]
      }],
      alphaessDiagnostics: {
        provider: 'alphaess',
        suspicious: false
      }
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-SN-1',
          systemTopology: {
            coupling: 'ac',
            source: 'manual'
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    const datas = response.body.result[0].datas || [];
    const chargePoint = datas.find((entry) => entry.variable === 'batChargePower');
    const dischargePoint = datas.find((entry) => entry.variable === 'batDischargePower');
    expect(chargePoint).toEqual(expect.objectContaining({ variable: 'batChargePower', value: 0, unit: 'kW' }));
    expect(dischargePoint).toEqual(expect.objectContaining({ variable: 'batDischargePower', value: 1.2, unit: 'kW' }));
  });

  test('inverter real-time endpoint includes AlphaESS diagnostics and warns on suspicious telemetry', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'AL5002021090044',
        time: '2026-03-25T00:38:55.576Z',
        datas: [
          { variable: 'SoC', value: 96, unit: '%' },
          { variable: 'pvPower', value: 1.751, unit: 'kW' },
          { variable: 'loadsPower', value: -19.82, unit: 'kW' },
          { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
          { variable: 'feedinPower', value: 0.015, unit: 'kW' },
          { variable: 'batChargePower', value: 1.7558, unit: 'kW' },
          { variable: 'batDischargePower', value: 0, unit: 'kW' }
        ]
      }],
      alphaessDiagnostics: {
        provider: 'alphaess',
        route: 'inverter-real-time',
        userId: 'u-alpha-suspicious',
        userEmail: 'william@acct.com.au',
        deviceSN: 'AL5002021090044',
        suspicious: true,
        anomalies: ['negative-load-power', 'small-feed-in-value-may-be-watts', 'power-unit-normalization-ambiguity'],
        flowBalance: {
          selected: {
            residualKw: 19.8408
          }
        }
      }
    }));
    const logger = { log: jest.fn(), warn: jest.fn() };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha-suspicious', email: 'william@acct.com.au' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'AL5002021090044'
        })),
        logger,
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.alphaessDiagnostics).toEqual(expect.objectContaining({
      provider: 'alphaess',
      route: 'inverter-real-time',
      userId: 'u-alpha-suspicious',
      userEmail: 'william@acct.com.au',
      deviceSN: 'AL5002021090044',
      suspicious: true,
      anomalies: expect.arrayContaining(['negative-load-power', 'small-feed-in-value-may-be-watts', 'power-unit-normalization-ambiguity'])
    }));
    expect(response.body.alphaessDiagnostics.flowBalance.selected).toEqual(expect.objectContaining({
      residualKw: expect.any(Number)
    }));
    expect(getCachedInverterRealtimeData).toHaveBeenCalledWith('u-alpha-suspicious', 'AL5002021090044', {
      deviceProvider: 'alphaess',
      alphaessSystemSn: 'AL5002021090044'
    }, false, {
      route: 'inverter-real-time',
      userEmail: 'william@acct.com.au',
      logger,
      alphaessLogMode: 'suspicious-only'
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('inverter real-time endpoint honors explicit AlphaESS battery sign override', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'ALPHA-SN-1',
        time: '2026-03-11T10:25:00.000Z',
        datas: [
          { variable: 'SoC', value: 57, unit: '%' },
          { variable: 'pvPower', value: 0, unit: 'kW' },
          { variable: 'loadsPower', value: 1.6, unit: 'kW' },
          { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
          { variable: 'feedinPower', value: 2.2, unit: 'kW' },
          { variable: 'meterPower2', value: -2.2, unit: 'kW' },
          { variable: 'batChargePower', value: 1.2, unit: 'kW' },
          { variable: 'batDischargePower', value: 0, unit: 'kW' }
        ]
      }],
      alphaessDiagnostics: {
        provider: 'alphaess',
        suspicious: false
      }
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-SN-1',
          alphaessBatteryPowerSign: 'normal',
          systemTopology: {
            coupling: 'ac',
            source: 'manual'
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    const datas = response.body.result[0].datas || [];
    const chargePoint = datas.find((entry) => entry.variable === 'batChargePower');
    const dischargePoint = datas.find((entry) => entry.variable === 'batDischargePower');
    expect(chargePoint).toEqual(expect.objectContaining({ variable: 'batChargePower', value: 1.2, unit: 'kW' }));
    expect(dischargePoint).toEqual(expect.objectContaining({ variable: 'batDischargePower', value: 0, unit: 'kW' }));
  });

  test('inverter real-time endpoint infers AlphaESS sign inversion from flow balance when topology fallback is wrong', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'ALPHA-SN-1',
        time: '2026-03-13T13:27:57.885Z',
        datas: [
          { variable: 'SoC', value: 91.2, unit: '%' },
          { variable: 'pvPower', value: 0, unit: 'kW' },
          { variable: 'loadsPower', value: 0.448, unit: 'kW' },
          { variable: 'gridConsumptionPower', value: 0, unit: 'kW' },
          { variable: 'feedinPower', value: 0, unit: 'kW' },
          { variable: 'meterPower2', value: 0, unit: 'kW' },
          { variable: 'batChargePower', value: 0, unit: 'kW' },
          { variable: 'batDischargePower', value: 0.448, unit: 'kW' }
        ]
      }],
      alphaessDiagnostics: {
        provider: 'alphaess',
        suspicious: false
      }
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-SN-1',
          systemTopology: {
            coupling: 'dc',
            source: 'auto'
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    const datas = response.body.result[0].datas || [];
    const chargePoint = datas.find((entry) => entry.variable === 'batChargePower');
    const dischargePoint = datas.find((entry) => entry.variable === 'batDischargePower');
    expect(chargePoint).toEqual(expect.objectContaining({ variable: 'batChargePower', value: 0, unit: 'kW' }));
    expect(dischargePoint).toEqual(expect.objectContaining({ variable: 'batDischargePower', value: 0.448, unit: 'kW' }));
  });

  test('inverter real-time endpoint preserves provider-specific power semantics for non-alpha adapters', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'SIGEN-STATION-1',
        time: '2026-03-11T11:20:00.000Z',
        datas: [
          { variable: 'SoC', value: 54 },
          { variable: 'pvPower', value: 2.5 },
          { variable: 'loadsPower', value: 1.9 },
          { variable: 'gridConsumptionPower', value: 0.4 },
          { variable: 'feedinPower', value: 0 },
          { variable: 'meterPower2', value: 0.4 },
          { variable: 'batChargePower', value: 0 },
          { variable: 'batDischargePower', value: 0.8 }
        ]
      }]
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-sigen' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'sigenergy',
          sigenStationId: 'SIGEN-STATION-1'
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result[0].deviceSN).toBe('SIGEN-STATION-1');
    const datas = response.body.result[0].datas || [];
    const pvPoint = datas.find((entry) => entry.variable === 'pvPower');
    const loadPoint = datas.find((entry) => entry.variable === 'loadsPower');
    const dischargePoint = datas.find((entry) => entry.variable === 'batDischargePower');
    expect(pvPoint).toEqual(expect.objectContaining({ variable: 'pvPower', value: 2.5 }));
    expect(loadPoint).toEqual(expect.objectContaining({ variable: 'loadsPower', value: 1.9 }));
    expect(dischargePoint).toEqual(expect.objectContaining({ variable: 'batDischargePower', value: 0.8 }));
    expect(pvPoint).not.toHaveProperty('unit');
    expect(loadPoint).not.toHaveProperty('unit');
    expect(getCachedInverterRealtimeData).toHaveBeenCalledWith('u-sigen', 'SIGEN-STATION-1', {
      deviceProvider: 'sigenergy',
      sigenStationId: 'SIGEN-STATION-1'
    }, false, {
      route: 'inverter-real-time',
      userEmail: null,
      logger: expect.any(Object),
      alphaessLogMode: 'suspicious-only'
    });
  });

  test('inverter discover-variables endpoint dispatches to non-FoxESS adapter when provider is configured', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({ errno: 0, result: { shouldNotBeUsed: true } }));
    const foxessAPI = { callFoxESSAPI: jest.fn() };
    const adapterGetStatus = jest.fn(async () => ({
      socPct: 64,
      batteryTempC: 27.8,
      ambientTempC: 21.9,
      pvPowerW: 3500,
      loadPowerW: 2100,
      gridPowerW: 120,
      feedInPowerW: 0,
      batteryPowerW: -600,
      observedAtIso: '2026-03-12T03:30:00.000Z'
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha-discover' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => ({
            getStatus: adapterGetStatus
          }))
        },
        foxessAPI,
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-DISCOVER-1'
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/discover-variables');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result).toEqual(expect.arrayContaining([
      'SoC',
      'pvPower',
      'loadsPower',
      'gridConsumptionPower',
      'feedinPower',
      'meterPower2',
      'batChargePower',
      'batDischargePower'
    ]));
    expect(adapterGetStatus).toHaveBeenCalledWith({
      deviceSN: 'ALPHA-DISCOVER-1',
      userConfig: {
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-DISCOVER-1'
      },
      userId: 'u-alpha-discover'
    });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('inverter real-time endpoint auto-persists inferred topology when missing', async () => {
    const realtimePayload = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'pvPower', value: 0 },
            { variable: 'meterPower2', value: 850 }
          ]
        }
      ]
    };
    const getCachedInverterRealtimeData = jest.fn(async () => realtimePayload);
    const setUserConfig = jest.fn(async () => undefined);
    const serverTimestamp = jest.fn(() => ({ __serverTimestamp: true }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-2' })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig,
        serverTimestamp
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(realtimePayload);
    expect(setUserConfig).toHaveBeenCalledTimes(1);
    expect(setUserConfig).toHaveBeenCalledWith(
      'u-inverter',
      expect.objectContaining({
        systemTopology: expect.objectContaining({
          coupling: 'ac',
          source: 'auto',
          confidence: expect.any(Number),
          refreshAfterMs: 4 * 60 * 60 * 1000,
          lastDetectedAt: expect.any(Number),
          updatedAt: { __serverTimestamp: true },
          evidence: expect.objectContaining({
            heuristic: 'pvPower~0 && |meterPower2|>0',
            pvPower: 0
          })
        })
      }),
      { merge: true }
    );
  });

  test('inverter real-time endpoint infers AC topology with negative meterPower2 export', async () => {
    const realtimePayload = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'pvPower', value: 0 },
            { variable: 'meterPower2', value: -850 }
          ]
        }
      ]
    };
    const getCachedInverterRealtimeData = jest.fn(async () => realtimePayload);
    const setUserConfig = jest.fn(async () => undefined);
    const serverTimestamp = jest.fn(() => ({ __serverTimestamp: true }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-NEG' })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig,
        serverTimestamp
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(realtimePayload);
    expect(setUserConfig).toHaveBeenCalledWith(
      'u-inverter',
      expect.objectContaining({
        systemTopology: expect.objectContaining({
          coupling: 'ac',
          evidence: expect.objectContaining({
            heuristic: 'pvPower~0 && |meterPower2|>0'
          })
        })
      }),
      { merge: true }
    );
  });

  test('inverter real-time endpoint does not overwrite manual topology selection', async () => {
    const realtimePayload = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'pvPower', value: 0 },
            { variable: 'meterPower2', value: 900 }
          ]
        }
      ]
    };
    const getCachedInverterRealtimeData = jest.fn(async () => realtimePayload);
    const setUserConfig = jest.fn(async () => undefined);

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceSn: 'SN-2',
          systemTopology: {
            coupling: 'dc',
            source: 'manual',
            refreshAfterMs: 4 * 60 * 60 * 1000,
            lastDetectedAt: Date.now()
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig,
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');
    expect(response.statusCode).toBe(200);
    expect(setUserConfig).not.toHaveBeenCalled();
  });

  test('inverter real-time endpoint skips topology write when auto topology is fresh and unchanged', async () => {
    const realtimePayload = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'pvPower', value: 0.01 },
            { variable: 'meterPower2', value: 0.7 }
          ]
        }
      ]
    };
    const getCachedInverterRealtimeData = jest.fn(async () => realtimePayload);
    const setUserConfig = jest.fn(async () => undefined);

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceSn: 'SN-2',
          systemTopology: {
            coupling: 'ac',
            source: 'auto',
            refreshAfterMs: 4 * 60 * 60 * 1000,
            lastDetectedAt: Date.now()
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig,
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');
    expect(response.statusCode).toBe(200);
    expect(setUserConfig).not.toHaveBeenCalled();
  });

  test('inverter real-time endpoint appends mapped AC solar and total solar fields when configured', async () => {
    const realtimePayload = {
      errno: 0,
      result: [
        {
          datas: [
            { variable: 'pvPower', value: 1.2 },
            { variable: 'meterPower2', value: 0.8 }
          ]
        }
      ]
    };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter-map' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData: jest.fn(async () => realtimePayload),
        getUserConfig: jest.fn(async () => ({
          deviceSn: 'SN-MAP',
          telemetryMappings: {
            acSolarPowerVariable: 'meterPower2'
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    expect(response.body.result[0].datas).toEqual(expect.arrayContaining([
      expect.objectContaining({ variable: 'acSolarPower', value: 0.8, unit: 'kW' }),
      expect.objectContaining({ variable: 'solarPowerTotal', value: 2, unit: 'kW' })
    ]));
  });

  test('inverter real-time endpoint ignores AC solar mapping for providers without raw source mapping support', async () => {
    const getCachedInverterRealtimeData = jest.fn(async () => ({
      errno: 0,
      msg: 'Operation successful',
      result: [{
        deviceSN: 'ALPHA-MAP-1',
        time: '2026-03-20T00:20:00.000Z',
        datas: [
          { variable: 'SoC', value: 68, unit: '%' },
          { variable: 'pvPower', value: 0, unit: 'kW' },
          { variable: 'loadsPower', value: 1.8, unit: 'kW' },
          { variable: 'gridConsumptionPower', value: 0.6, unit: 'kW' },
          { variable: 'feedinPower', value: 0, unit: 'kW' },
          { variable: 'meterPower2', value: 0.6, unit: 'kW' },
          { variable: 'batChargePower', value: 0, unit: 'kW' },
          { variable: 'batDischargePower', value: 1.2, unit: 'kW' }
        ]
      }],
      alphaessDiagnostics: {
        provider: 'alphaess',
        suspicious: false
      }
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-alpha-map-ignored' };
        next();
      });
      registerInverterReadRoutes(instance, {
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => null)
        },
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getCachedInverterRealtimeData,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-MAP-1',
          telemetryMappings: {
            acSolarPowerVariable: 'meterPower2'
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() },
        setUserConfig: jest.fn(async () => undefined),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true }))
      });
    });

    const response = await request(app).get('/api/inverter/real-time');

    expect(response.statusCode).toBe(200);
    const datas = response.body.result[0].datas || [];
    expect(datas).toEqual(expect.arrayContaining([
      expect.objectContaining({ variable: 'meterPower2', value: 0.6, unit: 'kW' })
    ]));
    expect(datas.find((entry) => entry.variable === 'acSolarPower')).toBeUndefined();
    expect(datas.find((entry) => entry.variable === 'solarPowerTotal')).toBeUndefined();
  });

  test('inverter generation endpoint enriches yearly generation from report data', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path) => {
        if (path.startsWith('/op/v0/device/generation?sn=')) {
          return { errno: 0, result: { day: 4.2, month: 112.5 } };
        }
        if (path === '/op/v0/device/report/query') {
          return {
            errno: 0,
            result: [
              { variable: 'generation', values: [0, 0] },
              { variable: 'generationPower', values: [12.3, 8.7] }
            ]
          };
        }
        return { errno: 0, result: [] };
      })
    };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-inverter' };
        next();
      });
      registerInverterReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getCachedInverterRealtimeData: jest.fn(),
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-3' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/inverter/generation');

    expect(response.statusCode).toBe(200);
    expect(response.body.result.year).toBeCloseTo(21.0);
    expect(response.body.result.yearGeneration).toBeCloseTo(21.0);
  });

  test('inverter history endpoint enforces auth middleware', async () => {
    const authenticateUser = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-history' };
      return next();
    };

    const app = buildApp((instance) => {
      registerInverterHistoryRoutes(instance, {
        authenticateUser,
        db: { collection: jest.fn() },
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getUserConfig: jest.fn(async () => ({})),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/inverter/history');
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('inverter history endpoint returns cached response for single-range request', async () => {
    const cachedResult = { errno: 0, result: [{ datas: [{ variable: 'pvPower', data: [] }] }] };
    const docRef = {
      delete: jest.fn(async () => undefined),
      get: jest.fn(async () => ({
        data: () => ({ timestamp: Date.now(), data: cachedResult }),
        exists: true
      })),
      set: jest.fn(async () => undefined)
    };
    const cacheCollection = { doc: jest.fn(() => docRef) };
    const userDoc = { collection: jest.fn(() => cacheCollection) };
    const usersCollection = { doc: jest.fn(() => userDoc) };
    const db = { collection: jest.fn(() => usersCollection) };
    const foxessAPI = { callFoxESSAPI: jest.fn() };

    const app = buildApp((instance) => {
      registerInverterHistoryRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-history' };
          next();
        },
        db,
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-HIST' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .get('/api/inverter/history')
      .query({ begin: 1700000000, end: 1700003600 });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(cachedResult);
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(cacheCollection.doc).toHaveBeenCalledWith('history_SN-HIST_1700000000000_1700003600000');
  });

  test('inverter history endpoint appends mapped AC solar and total series when configured', async () => {
    const cachedResult = {
      errno: 0,
      result: [{
        datas: [
          {
            variable: 'pvPower',
            data: [
              { time: '2026-03-20 10:00:00', value: 1.1 },
              { time: '2026-03-20 10:05:00', value: 1.3 }
            ]
          },
          {
            variable: 'meterPower2',
            data: [
              { time: '2026-03-20 10:00:00', value: 0.7 },
              { time: '2026-03-20 10:05:00', value: 0.6 }
            ]
          }
        ]
      }]
    };
    const docRef = {
      delete: jest.fn(async () => undefined),
      get: jest.fn(async () => ({
        data: () => ({ timestamp: Date.now(), data: cachedResult }),
        exists: true
      })),
      set: jest.fn(async () => undefined)
    };
    const cacheCollection = { doc: jest.fn(() => docRef) };
    const userDoc = { collection: jest.fn(() => cacheCollection) };
    const usersCollection = { doc: jest.fn(() => userDoc) };
    const db = { collection: jest.fn(() => usersCollection) };

    const app = buildApp((instance) => {
      registerInverterHistoryRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-history-map' };
          next();
        },
        db,
        foxessAPI: { callFoxESSAPI: jest.fn() },
        getUserConfig: jest.fn(async () => ({
          deviceSn: 'SN-HIST',
          telemetryMappings: {
            acSolarPowerVariable: 'meterPower2'
          }
        })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .get('/api/inverter/history')
      .query({ begin: 1700000000, end: 1700003600 });

    expect(response.statusCode).toBe(200);
    const datas = response.body.result[0].datas || [];
    const acSolarSeries = datas.find((entry) => entry.variable === 'acSolarPower');
    const solarTotalSeries = datas.find((entry) => entry.variable === 'solarPowerTotal');
    expect(acSolarSeries.data).toEqual([
      { time: '2026-03-20 10:00:00', value: 0.7 },
      { time: '2026-03-20 10:05:00', value: 0.6 }
    ]);
    expect(solarTotalSeries.data).toEqual([
      { time: '2026-03-20 10:00:00', value: 1.8 },
      { time: '2026-03-20 10:05:00', value: 1.9 }
    ]);
  });

  test('inverter history endpoint fetches and caches single-range response on cache miss', async () => {
    const docRef = {
      delete: jest.fn(async () => undefined),
      get: jest.fn(async () => ({ data: () => ({}), exists: false })),
      set: jest.fn(async () => undefined)
    };
    const cacheCollection = { doc: jest.fn(() => docRef) };
    const userDoc = { collection: jest.fn(() => cacheCollection) };
    const usersCollection = { doc: jest.fn(() => userDoc) };
    const db = { collection: jest.fn(() => usersCollection) };
    const foxessResult = { errno: 0, result: [{ datas: [], deviceSN: 'SN-HIST' }] };
    const foxessAPI = { callFoxESSAPI: jest.fn(async () => foxessResult) };

    const app = buildApp((instance) => {
      registerInverterHistoryRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-history' };
          next();
        },
        db,
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-HIST' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .get('/api/inverter/history')
      .query({ begin: 1700000000, end: 1700003600 });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(foxessResult);
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/history/query',
      'POST',
      expect.objectContaining({
        begin: 1700000000000,
        end: 1700003600000,
        sn: 'SN-HIST'
      }),
      { deviceSn: 'SN-HIST' },
      'u-history'
    );
    expect(docRef.set).toHaveBeenCalledTimes(1);
  });

  test('device read routes enforce required moduleSN for module signal endpoint', async () => {
    const foxessAPI = { callFoxESSAPI: jest.fn() };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-device' };
        next();
      });
      registerDeviceReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DEVICE' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/module/signal');

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'moduleSN parameter is required' });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('device read routes return 400 when battery soc get has no device SN', async () => {
    const foxessAPI = { callFoxESSAPI: jest.fn() };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-device' };
        next();
      });
      registerDeviceReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig: jest.fn(async () => ({})),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/device/battery/soc/get');

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Device SN not configured' });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('device read routes workmode get proxies using configured device SN', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { value: 0 } }))
    };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-device' };
        next();
      });
      registerDeviceReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DEVICE' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/device/workmode/get');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { value: 0 } });
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/get',
      'POST',
      { key: 'WorkMode', sn: 'SN-DEVICE' },
      { deviceSn: 'SN-DEVICE' },
      'u-device'
    );
  });

  test('device read routes workmode get preserves provider-native mode metadata for non-FoxESS adapters', async () => {
    const getWorkMode = jest.fn(async () => ({
      errno: 0,
      result: {
        workMode: 'ForceDischarge',
        raw: 2003
      }
    }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-sungrow' };
        next();
      });
      registerDeviceReadRoutes(instance, {
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI: { callFoxESSAPI: jest.fn() },
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => ({ getWorkMode }))
        },
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'sungrow',
          sungrowDeviceSn: 'SG-001'
        })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/device/workmode/get');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        workMode: 'ForceDischarge',
        raw: 2003,
        provider: 'sungrow',
        displayName: 'Force Discharge',
        value: 2003,
        legacyValue: null
      }
    });
    expect(getWorkMode).toHaveBeenCalledWith({
      deviceSN: 'SG-001',
      userConfig: {
        deviceProvider: 'sungrow',
        sungrowDeviceSn: 'SG-001'
      },
      userId: 'u-sungrow'
    });
  });

  test('device status check returns diagnostic summary envelope', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path) => {
        if (path === '/op/v0/device/list') {
          return {
            errno: 0,
            result: {
              data: [{ sn: 'SN-DEVICE', deviceName: 'Fox H1', deviceType: 'Inverter' }]
            }
          };
        }
        if (path.startsWith('/op/v0/device/real-time?sn=')) {
          return { errno: 0, result: { data: { pvPower: 2.3 } } };
        }
        if (path === '/op/v0/device/setting/get') {
          return { errno: 0, result: { key: 'ExportLimit', value: 5000 } };
        }
        return { errno: 0, result: {} };
      })
    };

    const app = buildApp((instance) => {
      registerDeviceReadRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-device' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DEVICE' })),
        logger: { log: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).get('/api/device/status/check');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.deviceFound).toBe(true);
    expect(response.body.result.deviceInfo).toEqual({
      sn: 'SN-DEVICE',
      deviceName: 'Fox H1',
      deviceType: 'Inverter'
    });
    expect(response.body.result.diagnosticSummary.potentialIssues).toEqual([]);
  });

  test('diagnostics read routes enforce required key for device setting get', async () => {
    const foxessAPI = { callFoxESSAPI: jest.fn() };

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DIAG' }))
      });
    });

    const response = await request(app)
      .post('/api/device/setting/get')
      .send({ sn: 'SN-DIAG' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Missing required parameter: key' });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('diagnostics read routes proxy device setting get response', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { key: 'ExportLimit', value: 5000 } }))
    };

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DIAG' }))
      });
    });

    const response = await request(app)
      .post('/api/device/setting/get')
      .send({ key: 'ExportLimit' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { key: 'ExportLimit', value: 5000 } });
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/get',
      'POST',
      { key: 'ExportLimit', sn: 'SN-DIAG' },
      { deviceSn: 'SN-DIAG' },
      'u-diagnostics'
    );
  });

  test('diagnostics read routes all-data returns topology hints', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => ({
        errno: 0,
        result: [
          {
            datas: [
              { variable: 'pvPower', value: 0.0 },
              { variable: 'meterPower2', value: 0.8 },
              { variable: 'batChargePower', value: 1.2 },
              { variable: 'gridConsumptionPower', value: 0.0 }
            ]
          }
        ]
      }))
    };

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DIAG' }))
      });
    });

    const response = await request(app).post('/api/inverter/all-data').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.topologyHints).toEqual(expect.objectContaining({
      likelyTopology: 'AC-coupled (external PV via meter)'
    }));
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/real/query',
      'POST',
      expect.objectContaining({
        sn: 'SN-DIAG',
        variables: expect.any(Array)
      }),
      { deviceSn: 'SN-DIAG' },
      'u-diagnostics'
    );
  });

  test('diagnostics read routes expose configured and recommended AC solar mapping hints', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => ({
        errno: 0,
        result: [
          {
            datas: [
              { variable: 'pvPower', value: 0.0 },
              { variable: 'meterPower2', value: 0.9 },
              { variable: 'batChargePower', value: 1.0 },
              { variable: 'gridConsumptionPower', value: 0.0 }
            ]
          }
        ]
      }))
    };

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({
          deviceSn: 'SN-DIAG',
          telemetryMappings: {
            acSolarPowerVariable: 'meterPower2'
          }
        }))
      });
    });

    const response = await request(app).post('/api/inverter/all-data').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.topologyHints).toEqual(expect.objectContaining({
      configuredAcSolarVariable: 'meterPower2',
      recommendedAcSolarVariable: 'meterPower2',
      acSolarPower: 0.9,
      solarPowerTotal: 0.9
    }));
  });

  test('diagnostics read routes all-data dispatches to adapter for non-FoxESS providers', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: [] }))
    };
    const adapterGetStatus = jest.fn(async () => ({
      socPct: 73,
      batteryTempC: 29.1,
      ambientTempC: 23.4,
      pvPowerW: 0,
      loadPowerW: 1800,
      gridPowerW: 200,
      feedInPowerW: 0,
      batteryPowerW: -1200,
      observedAtIso: '2026-03-12T04:20:00.000Z'
    }));

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => ({
            getStatus: adapterGetStatus
          }))
        },
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics-alpha' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-DIAG-1',
          systemTopology: { coupling: 'ac', source: 'manual' }
        }))
      });
    });

    const response = await request(app).post('/api/inverter/all-data').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result[0].deviceSN).toBe('ALPHA-DIAG-1');
    expect(response.body.result[0].datas).toEqual(expect.arrayContaining([
      expect.objectContaining({ variable: 'pvPower', value: 0, unit: 'kW' }),
      expect.objectContaining({ variable: 'batDischargePower', value: 1.2, unit: 'kW' }),
      expect.objectContaining({ variable: 'gridConsumptionPower', value: 0.2, unit: 'kW' })
    ]));
    expect(response.body.topologyHints).toEqual(expect.objectContaining({
      likelyTopology: 'Unknown (check during solar production hours)'
    }));
    expect(adapterGetStatus).toHaveBeenCalledWith({
      deviceSN: 'ALPHA-DIAG-1',
      userConfig: {
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-DIAG-1',
        systemTopology: { coupling: 'ac', source: 'manual' }
      },
      userId: 'u-diagnostics-alpha'
    });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('diagnostics read routes include AlphaESS diagnostics and warn for suspicious payloads', async () => {
    const adapterGetStatus = jest.fn(async () => ({
      socPct: 96,
      batteryTempC: 0,
      ambientTempC: 0,
      pvPowerW: 1751,
      loadPowerW: -19820,
      gridPowerW: 0,
      feedInPowerW: 15,
      batteryPowerW: 1755.8,
      observedAtIso: '2026-03-25T00:38:55.576Z'
    }));
    const logger = { log: jest.fn(), warn: jest.fn() };

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => ({
            getStatus: adapterGetStatus
          }))
        },
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics-alpha-suspicious', email: 'william@acct.com.au' };
          next();
        },
        foxessAPI: {
          callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: [] }))
        },
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'AL5002021090044'
        })),
        logger
      });
    });

    const response = await request(app).post('/api/inverter/all-data').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.alphaessDiagnostics).toEqual(expect.objectContaining({
      provider: 'alphaess',
      route: 'diagnostics-all-data',
      userId: 'u-diagnostics-alpha-suspicious',
      suspicious: true,
      anomalies: expect.arrayContaining(['negative-load-power', 'small-feed-in-value-may-be-watts', 'power-unit-normalization-ambiguity'])
    }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[AlphaESSDiagnostics]'));
  });

  test('diagnostics read routes suppress AC mapping hints for providers without raw source mapping support', async () => {
    const adapterGetStatus = jest.fn(async () => ({
      socPct: 73,
      batteryTempC: 29.1,
      ambientTempC: 23.4,
      pvPowerW: 0,
      loadPowerW: 1800,
      gridPowerW: 900,
      feedInPowerW: 0,
      batteryPowerW: -1200,
      observedAtIso: '2026-03-12T04:20:00.000Z'
    }));

    const app = buildApp((instance) => {
      registerDiagnosticsReadRoutes(instance, {
        adapterRegistry: {
          getDeviceProvider: jest.fn(() => ({
            getStatus: adapterGetStatus
          }))
        },
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-diagnostics-alpha-map' };
          next();
        },
        foxessAPI: {
          callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: [] }))
        },
        getUserConfig: jest.fn(async () => ({
          deviceProvider: 'alphaess',
          alphaessSystemSn: 'ALPHA-DIAG-2',
          telemetryMappings: {
            acSolarPowerVariable: 'meterPower2'
          }
        }))
      });
    });

    const response = await request(app).post('/api/inverter/all-data').send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.topologyHints).toEqual(expect.objectContaining({
      configuredAcSolarVariable: null,
      recommendedAcSolarVariable: null,
      acSolarPower: null,
      solarPowerTotal: null
    }));
  });

  test('scheduler read routes return defaults when device SN is unavailable', async () => {
    const foxessAPI = { callFoxESSAPI: jest.fn() };
    const getUserConfig = jest.fn(async () => ({}));

    const app = buildApp((instance) => {
      registerSchedulerReadRoutes(instance, {
        foxessAPI,
        getUserConfig,
        tryAttachUser: jest.fn(async () => null)
      });
    });

    const response = await request(app).get('/api/scheduler/v1/get');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.source).toBe('defaults');
    expect(response.body.result.enable).toBe(false);
    expect(response.body.result.groups).toHaveLength(10);
    expect(response.body.result.groups[0]).toEqual(expect.objectContaining({
      enable: 0,
      workMode: 'SelfUse'
    }));
    expect(getUserConfig).toHaveBeenCalledWith(undefined);
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('scheduler read routes proxy device scheduler and tag source', async () => {
    const foxessAPIResult = {
      errno: 0,
      result: {
        groups: [{ enable: 1, startHour: 1, startMinute: 30, endHour: 2, endMinute: 0 }],
        enable: true
      }
    };
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async () => foxessAPIResult)
    };
    const getUserConfig = jest.fn(async () => ({ deviceSn: 'SN-CFG' }));

    const app = buildApp((instance) => {
      registerSchedulerReadRoutes(instance, {
        foxessAPI,
        getUserConfig,
        tryAttachUser: jest.fn(async (req) => {
          req.user = { uid: 'u-scheduler' };
          return req.user;
        })
      });
    });

    const response = await request(app)
      .get('/api/scheduler/v1/get')
      .query({ sn: 'SN-OVERRIDE' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        groups: [{ enable: 1, startHour: 1, startMinute: 30, endHour: 2, endMinute: 0 }],
        enable: true
      },
      source: 'device'
    });
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/get',
      'POST',
      { deviceSN: 'SN-OVERRIDE' },
      { deviceSn: 'SN-CFG' },
      'u-scheduler'
    );
  });
});
