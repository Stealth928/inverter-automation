'use strict';

const { createWeatherService } = require('../lib/services/weather-service');

function createWeatherCacheDb({ cacheDocExists = false, cacheDocData = null } = {}) {
  const weatherDocRef = {
    get: jest.fn(async () => ({
      exists: cacheDocExists,
      data: () => cacheDocData
    })),
    set: jest.fn(async () => undefined)
  };

  const cacheCollectionRef = {
    doc: jest.fn((docId) => {
      if (docId !== 'weather') throw new Error(`Unexpected cache doc: ${docId}`);
      return weatherDocRef;
    })
  };

  const userDocRef = {
    collection: jest.fn((name) => {
      if (name !== 'cache') throw new Error(`Unexpected user subcollection: ${name}`);
      return cacheCollectionRef;
    })
  };

  const usersCollectionRef = {
    doc: jest.fn(() => userDocRef)
  };

  return {
    db: {
      collection: jest.fn((name) => {
        if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
        return usersCollectionRef;
      })
    },
    weatherDocRef
  };
}

function createGeoResponse(results) {
  return {
    json: jest.fn(async () => ({ results }))
  };
}

function createForecastResponse(payload) {
  return {
    json: jest.fn(async () => payload)
  };
}

describe('weather service module', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('throws when required dependencies are missing', () => {
    expect(() => createWeatherService({}))
      .toThrow('createWeatherService requires Firestore db');
  });

  test('callWeatherAPI prioritizes Australian geocode result and clamps days', async () => {
    const { db } = createWeatherCacheDb();
    const incrementApiCount = jest.fn(async () => undefined);
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(createGeoResponse([
        { country_code: 'FJ', latitude: -17.79, longitude: 177.41, name: 'Narara', country: 'Fiji' },
        { country_code: 'AU', latitude: -33.39, longitude: 151.33, name: 'Narara', country: 'Australia' }
      ]))
      .mockResolvedValueOnce(createForecastResponse({
        timezone: 'Australia/Sydney',
        current_weather: { temperature: 24 },
        hourly: { time: ['t1'] },
        daily: { time: ['d1'] }
      }));

    const service = createWeatherService({
      db,
      fetchImpl,
      getConfig: () => ({ automation: { cacheTtl: { weather: 1800000 } } }),
      incrementApiCount,
      setUserConfig: jest.fn(async () => undefined),
      logger: console
    });

    const result = await service.callWeatherAPI('Narara', 99, 'user-1');

    expect(result.errno).toBe(0);
    expect(result.result.place.country).toBe('Australia');
    expect(result.result.place.latitude).toBe(-33.39);
    expect(result.result.place.fallback).toBe(false);
    expect(result.result.forecastDays).toBe(16);
    expect(incrementApiCount).toHaveBeenCalledWith('user-1', 'weather');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('callWeatherAPI falls back to Sydney when geocode returns no results', async () => {
    const { db } = createWeatherCacheDb();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(createGeoResponse([]))
      .mockResolvedValueOnce(createForecastResponse({
        timezone: 'Australia/Sydney',
        current_weather: null,
        hourly: null,
        daily: null
      }));

    const service = createWeatherService({
      db,
      fetchImpl,
      getConfig: () => ({ automation: { cacheTtl: { weather: 1800000 } } }),
      incrementApiCount: jest.fn(async () => undefined),
      setUserConfig: jest.fn(async () => undefined),
      logger: console
    });

    const result = await service.callWeatherAPI('UnknownPlace', 2, null);

    expect(result.errno).toBe(0);
    expect(result.result.place.fallback).toBe(true);
    expect(result.result.place.fallbackReason).toBe('location_not_found');
    expect(result.result.place.fallbackResolvedName).toBe('Sydney NSW');
    expect(result.result.place.latitude).toBe(-33.9215);
    expect(result.result.place.longitude).toBe(151.039);
  });

  test('getCachedWeatherData returns cache hit when cache is fresh and place matches', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000000);
    const cachePayload = {
      data: {
        errno: 0,
        result: {
          daily: {
            time: ['2026-03-06', '2026-03-07', '2026-03-08']
          }
        }
      },
      timestamp: 999000,
      cachedDays: 3,
      cachedPlace: 'Sydney'
    };

    const { db, weatherDocRef } = createWeatherCacheDb({
      cacheDocExists: true,
      cacheDocData: cachePayload
    });

    const fetchImpl = jest.fn();
    const setUserConfig = jest.fn(async () => undefined);

    const service = createWeatherService({
      db,
      fetchImpl,
      getConfig: () => ({ automation: { cacheTtl: { weather: 1800000 } } }),
      incrementApiCount: jest.fn(async () => undefined),
      setUserConfig,
      logger: console
    });

    const result = await service.getCachedWeatherData('user-2', 'sydney', 3, false);

    expect(result.__cacheHit).toBe(true);
    expect(result.__cacheAgeMs).toBe(1000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(weatherDocRef.set).not.toHaveBeenCalled();
    expect(setUserConfig).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  test('getCachedWeatherData refreshes cache when place changes and persists timezone', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2000000);
    const { db, weatherDocRef } = createWeatherCacheDb({
      cacheDocExists: true,
      cacheDocData: {
        data: {
          errno: 0,
          result: {
            daily: {
              time: ['2026-03-06', '2026-03-07', '2026-03-08']
            }
          }
        },
        timestamp: 1999500,
        cachedDays: 3,
        cachedPlace: 'Melbourne'
      }
    });

    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(createGeoResponse([
        { country_code: 'AU', latitude: -33.86, longitude: 151.2, name: 'Sydney', country: 'Australia' }
      ]))
      .mockResolvedValueOnce(createForecastResponse({
        timezone: 'Australia/Sydney',
        current_weather: { temperature: 22 },
        hourly: { time: ['t1'] },
        daily: { time: ['d1', 'd2', 'd3'] }
      }));

    const setUserConfig = jest.fn(async () => undefined);

    const service = createWeatherService({
      db,
      fetchImpl,
      getConfig: () => ({ automation: { cacheTtl: { weather: 1800000 } } }),
      incrementApiCount: jest.fn(async () => undefined),
      setUserConfig,
      logger: console
    });

    const result = await service.getCachedWeatherData('user-3', 'Sydney', 3, false);

    expect(result.__cacheHit).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(setUserConfig).toHaveBeenCalledWith('user-3', { timezone: 'Australia/Sydney' }, { merge: true });
    expect(weatherDocRef.set).toHaveBeenCalledTimes(1);

    const [cacheWrite] = weatherDocRef.set.mock.calls[0];
    expect(cacheWrite.cachedPlace).toBe('Sydney');
    expect(cacheWrite.cachedDays).toBe(3);

    nowSpy.mockRestore();
  });

  test('callWeatherAPI opens the circuit after repeated upstream failures', async () => {
    const { db } = createWeatherCacheDb();
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, json: jest.fn(async () => ({})) }));

    const service = createWeatherService({
      db,
      fetchImpl,
      getConfig: () => ({ automation: { cacheTtl: { weather: 1800000 } } }),
      incrementApiCount: jest.fn(async () => undefined),
      setUserConfig: jest.fn(async () => undefined),
      logger: console
    });

    const first = await service.callWeatherAPI('Sydney', 2, 'user-open-1');
    const second = await service.callWeatherAPI('Sydney', 2, 'user-open-1');
    const third = await service.callWeatherAPI('Sydney', 2, 'user-open-1');
    const blocked = await service.callWeatherAPI('Sydney', 2, 'user-open-1');

    expect(first.errno).toBe(500);
    expect(second.errno).toBe(500);
    expect(third.errno).toBe(500);
    expect(blocked.errno).toBe(503);
    expect(service.getCircuitState()).toEqual(expect.objectContaining({
      name: 'weather',
      state: 'open'
    }));
  });
});
