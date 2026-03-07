'use strict';

/**
 * G4 exit criterion #5 — Amber caching sophistication preserved after adapter refactor.
 *
 * These tests prove that:
 *   1. Cache hits avoid repeat Amber API calls (no double-spend)
 *   2. Cache misses trigger a real API call and the result is stored
 *   3. In-flight deduplication prevents concurrent duplicate requests
 *   4. The amberTariffAdapter path uses the adapter's own cache, not a bypass
 *   5. Legacy API path respects getCachedAmberPricesCurrent / cacheAmberPricesCurrent cycle
 */

const {
  fetchAutomationAmberData
} = require('../lib/services/automation-cycle-data-service');

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

const SAMPLE_AMBER_PRICES = [
  { type: 'CurrentInterval', channelType: 'general', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:30:00Z', perKwh: 18.5, spikeStatus: 'none' }
];

function buildAmberApi(overrides = {}) {
  return {
    cacheAmberPricesCurrent: jest.fn(async () => undefined),
    cacheAmberSites: jest.fn(async () => undefined),
    callAmberAPI: jest.fn(async () => []),
    getCachedAmberPricesCurrent: jest.fn(async () => null),
    getCachedAmberSites: jest.fn(async () => null),
    ...overrides
  };
}

const BASE_CONFIG = { amberApiKey: 'test-key', amberSiteId: 'site-1' };
const BASE_OPTS = { userId: 'u1', userConfig: BASE_CONFIG };

// ---------------------------------------------------------------------------
// 1 — Cache hit avoids API call
// ---------------------------------------------------------------------------

describe('Amber caching — cache hit avoids API call', () => {
  test('returns cached prices without calling the API or caching again', async () => {
    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }]),
      getCachedAmberPricesCurrent: jest.fn(async () => SAMPLE_AMBER_PRICES)
    });

    const result = await fetchAutomationAmberData({ ...BASE_OPTS, amberAPI, amberPricesInFlight: new Map() });

    expect(result).toBe(SAMPLE_AMBER_PRICES);
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
    expect(amberAPI.cacheAmberPricesCurrent).not.toHaveBeenCalled();
  });

  test('site cache hit also avoids a second /sites API call', async () => {
    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }]),
      getCachedAmberPricesCurrent: jest.fn(async () => SAMPLE_AMBER_PRICES)
    });

    await fetchAutomationAmberData({ ...BASE_OPTS, amberAPI, amberPricesInFlight: new Map() });

    // callAmberAPI should NOT have been called for sites
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2 — Cache miss: fetches live data and stores it
// ---------------------------------------------------------------------------

describe('Amber caching — cache miss triggers API call and stores result', () => {
  test('fetches prices from API and caches them when no cache exists', async () => {
    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }]),
      getCachedAmberPricesCurrent: jest.fn(async () => null),
      callAmberAPI: jest.fn(async (path) => {
        if (path.includes('prices/current')) return SAMPLE_AMBER_PRICES;
        return [];
      })
    });

    const result = await fetchAutomationAmberData({ ...BASE_OPTS, amberAPI, amberPricesInFlight: new Map() });

    expect(result).toEqual(SAMPLE_AMBER_PRICES);
    expect(amberAPI.callAmberAPI).toHaveBeenCalledWith(
      expect.stringContaining('prices/current'),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(amberAPI.cacheAmberPricesCurrent).toHaveBeenCalledWith('site-1', SAMPLE_AMBER_PRICES, 'u1', expect.anything());
  });

  test('site cache miss fetches sites from API and caches them', async () => {
    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => null),
      getCachedAmberPricesCurrent: jest.fn(async () => SAMPLE_AMBER_PRICES),
      callAmberAPI: jest.fn(async (path) => {
        if (path === '/sites') return [{ id: 'site-1' }];
        return SAMPLE_AMBER_PRICES;
      })
    });

    await fetchAutomationAmberData({ ...BASE_OPTS, amberAPI, amberPricesInFlight: new Map() });

    expect(amberAPI.callAmberAPI).toHaveBeenCalledWith('/sites', expect.anything(), expect.anything(), expect.anything());
    expect(amberAPI.cacheAmberSites).toHaveBeenCalledWith('u1', [{ id: 'site-1' }]);
  });
});

// ---------------------------------------------------------------------------
// 3 — In-flight deduplication
// ---------------------------------------------------------------------------

describe('Amber caching — in-flight deduplication', () => {
  test('uses existing in-flight promise instead of making a duplicate API call', async () => {
    const inflightPrices = [...SAMPLE_AMBER_PRICES];
    const inflightKey = 'u1:site-1';
    const amberPricesInFlight = new Map([
      [inflightKey, Promise.resolve(inflightPrices)]
    ]);

    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }]),
      getCachedAmberPricesCurrent: jest.fn(async () => null)
    });

    const result = await fetchAutomationAmberData({ ...BASE_OPTS, amberAPI, amberPricesInFlight });

    expect(result).toBe(inflightPrices);
    // No new API call should have been made
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });

  test('falls through to API call when in-flight promise rejects', async () => {
    const inflightKey = 'u1:site-1';
    const amberPricesInFlight = new Map([
      [inflightKey, Promise.reject(new Error('in-flight failed'))]
    ]);

    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }]),
      getCachedAmberPricesCurrent: jest.fn(async () => null),
      callAmberAPI: jest.fn(async () => SAMPLE_AMBER_PRICES)
    });

    const logger = { log: jest.fn(), warn: jest.fn() };
    const result = await fetchAutomationAmberData({ ...BASE_OPTS, amberAPI, amberPricesInFlight, logger });

    // Should have fallen through to real API call
    expect(amberAPI.callAmberAPI).toHaveBeenCalled();
    expect(result).toEqual(SAMPLE_AMBER_PRICES);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('In-flight request failed for'),
      expect.any(String)
    );
  });
});

// ---------------------------------------------------------------------------
// 4 — Amber adapter path uses adapter's own cache, not a bypass
// ---------------------------------------------------------------------------

describe('Amber caching — amberTariffAdapter path', () => {
  test('uses adapter getCurrentPriceData and does not call amberAPI directly', async () => {
    const amberAPI = buildAmberApi();
    const adapterResult = { data: SAMPLE_AMBER_PRICES };

    const amberTariffAdapter = {
      getCurrentPriceData: jest.fn(async () => adapterResult)
    };

    const result = await fetchAutomationAmberData({
      ...BASE_OPTS,
      amberAPI,
      amberPricesInFlight: new Map(),
      amberTariffAdapter
    });

    expect(result).toBe(SAMPLE_AMBER_PRICES);
    expect(amberTariffAdapter.getCurrentPriceData).toHaveBeenCalledWith(
      expect.objectContaining({ userConfig: expect.objectContaining({ amberApiKey: 'test-key' }) })
    );
    // The raw amberAPI.callAmberAPI should not have been called
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });

  test('falls back to legacy amberAPI path when adapter throws', async () => {
    const amberTariffAdapter = {
      getCurrentPriceData: jest.fn(async () => { throw new Error('adapter down'); })
    };

    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }]),
      getCachedAmberPricesCurrent: jest.fn(async () => SAMPLE_AMBER_PRICES)
    });

    const logger = { log: jest.fn(), warn: jest.fn() };
    const result = await fetchAutomationAmberData({
      ...BASE_OPTS,
      amberAPI,
      amberPricesInFlight: new Map(),
      amberTariffAdapter,
      logger
    });

    expect(result).toBe(SAMPLE_AMBER_PRICES);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Amber adapter fetch failed'),
      expect.any(String)
    );
  });

  test('adapter result without .data wrapper is returned directly', async () => {
    const amberAPI = buildAmberApi();
    const amberTariffAdapter = {
      getCurrentPriceData: jest.fn(async () => SAMPLE_AMBER_PRICES)
    };

    const result = await fetchAutomationAmberData({
      ...BASE_OPTS,
      amberAPI,
      amberPricesInFlight: new Map(),
      amberTariffAdapter
    });

    expect(result).toBe(SAMPLE_AMBER_PRICES);
  });
});

// ---------------------------------------------------------------------------
// 5 — No credentials → no API calls at all
// ---------------------------------------------------------------------------

describe('Amber caching — missing credentials are a hard gate', () => {
  test('returns null and makes zero API calls when amberApiKey is absent', async () => {
    const amberAPI = buildAmberApi();
    const result = await fetchAutomationAmberData({
      userId: 'u1',
      userConfig: {},
      amberAPI,
      amberPricesInFlight: new Map()
    });
    expect(result).toBeNull();
    expect(amberAPI.getCachedAmberSites).not.toHaveBeenCalled();
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });
});
