'use strict';

const {
  AmberTariffAdapter,
  createAmberTariffAdapter,
  normalizeAmberIntervals
} = require('../lib/adapters/amber-adapter');

function buildAmberApi(overrides = {}) {
  return {
    cacheAmberPricesCurrent: jest.fn(async () => undefined),
    cacheAmberSites: jest.fn(async () => undefined),
    callAmberAPI: jest.fn(async () => []),
    fetchAmberHistoricalPricesActualOnly: jest.fn(async () => ({ errno: 0, result: [] })),
    fetchAmberHistoricalPricesWithCache: jest.fn(async () => ({ errno: 0, result: [] })),
    getCachedAmberPricesCurrent: jest.fn(async () => null),
    getCachedAmberSites: jest.fn(async () => null),
    ...overrides
  };
}

describe('amber tariff adapter', () => {
  test('normalizeAmberIntervals merges channel rows into canonical interval entries', () => {
    const intervals = normalizeAmberIntervals([
      {
        channelType: 'general',
        endTime: '2026-03-07T00:30:00.000Z',
        perKwh: 29.1,
        startTime: '2026-03-07T00:00:00.000Z',
        type: 'CurrentInterval'
      },
      {
        channelType: 'feedIn',
        endTime: '2026-03-07T00:30:00.000Z',
        perKwh: -8.4,
        startTime: '2026-03-07T00:00:00.000Z',
        type: 'CurrentInterval'
      }
    ]);

    expect(intervals).toEqual([
      {
        startIso: '2026-03-07T00:00:00.000Z',
        endIso: '2026-03-07T00:30:00.000Z',
        buyCentsPerKwh: 29.1,
        feedInCentsPerKwh: 8.4,
        renewablePct: null,
        source: 'actual'
      }
    ]);
  });

  test('getCurrentPriceData returns cache result when present', async () => {
    const cachedRows = [{ channelType: 'general', perKwh: 31.0, type: 'CurrentInterval' }];
    const amberAPI = buildAmberApi({
      getCachedAmberPricesCurrent: jest.fn(async () => cachedRows)
    });
    const adapter = createAmberTariffAdapter({
      amberAPI,
      amberPricesInFlight: new Map(),
      logger: { warn: jest.fn() }
    });

    const result = await adapter.getCurrentPriceData({
      userConfig: { amberApiKey: 'key', amberSiteId: 'site-a' },
      userId: 'u1'
    });

    expect(result).toEqual({
      siteId: 'site-a',
      data: cachedRows
    });
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });

  test('getCurrentPrices resolves site via /sites and caches fetched rows', async () => {
    const priceRows = [
      { channelType: 'general', perKwh: 28.5, type: 'CurrentInterval', startTime: '2026-03-07T00:00:00Z', endTime: '2026-03-07T00:30:00Z' },
      { channelType: 'feedIn', perKwh: -7.1, type: 'CurrentInterval', startTime: '2026-03-07T00:00:00Z', endTime: '2026-03-07T00:30:00Z' }
    ];
    const amberAPI = buildAmberApi({
      callAmberAPI: jest.fn(async (path) => {
        if (path === '/sites') return [{ id: 'site-1' }];
        if (path === '/sites/site-1/prices/current') return priceRows;
        return [];
      })
    });
    const adapter = new AmberTariffAdapter({
      amberAPI,
      amberPricesInFlight: new Map(),
      logger: { warn: jest.fn() }
    });

    const snapshot = await adapter.getCurrentPrices({
      userConfig: { amberApiKey: 'key' },
      userId: 'u1'
    });

    expect(snapshot.siteId).toBe('site-1');
    expect(snapshot.buyCentsPerKwh).toBe(28.5);
    expect(snapshot.feedInCentsPerKwh).toBe(7.1);
    expect(snapshot.intervals).toHaveLength(1);
    expect(amberAPI.cacheAmberSites).toHaveBeenCalledWith('u1', [{ id: 'site-1' }]);
    expect(amberAPI.cacheAmberPricesCurrent).toHaveBeenCalledWith('site-1', priceRows, 'u1', { amberApiKey: 'key' });
  });

  test('getHistoricalPrices uses cached historical API helper when available', async () => {
    const historyRows = [
      { channelType: 'general', perKwh: 22, type: 'ForecastInterval', startTime: '2026-03-06T00:00:00Z', endTime: '2026-03-06T00:30:00Z' },
      { channelType: 'feedIn', perKwh: -6, type: 'ForecastInterval', startTime: '2026-03-06T00:00:00Z', endTime: '2026-03-06T00:30:00Z' }
    ];
    const amberAPI = buildAmberApi({
      fetchAmberHistoricalPricesWithCache: jest.fn(async () => ({
        errno: 0,
        result: historyRows
      }))
    });
    const adapter = createAmberTariffAdapter({
      amberAPI,
      amberPricesInFlight: new Map(),
      logger: { warn: jest.fn() }
    });

    const snapshot = await adapter.getHistoricalPrices(
      {
        siteId: 'site-2',
        userConfig: { amberApiKey: 'key' },
        userId: 'u2'
      },
      '2026-03-06T00:00:00.000Z',
      '2026-03-06T23:59:59.000Z',
      30
    );

    expect(snapshot.siteId).toBe('site-2');
    expect(snapshot.intervals).toHaveLength(1);
    expect(snapshot.intervals[0]).toEqual({
      startIso: '2026-03-06T00:00:00Z',
      endIso: '2026-03-06T00:30:00Z',
      buyCentsPerKwh: 22,
      feedInCentsPerKwh: 6,
      renewablePct: null,
      source: 'forecast'
    });
    expect(amberAPI.fetchAmberHistoricalPricesWithCache).toHaveBeenCalledWith(
      'site-2',
      '2026-03-06',
      '2026-03-06',
      30,
      { amberApiKey: 'key' },
      'u2'
    );
  });

  test('normalizeProviderError maps known Amber error classes', () => {
    const adapter = createAmberTariffAdapter({
      amberAPI: buildAmberApi(),
      amberPricesInFlight: new Map()
    });

    expect(adapter.normalizeProviderError({ errno: 429, error: 'retry later' })).toEqual({
      errno: 3201,
      error: 'retry later'
    });
    expect(adapter.normalizeProviderError({ errno: 401 })).toEqual({
      errno: 3202,
      error: 'Amber provider authentication failed'
    });
  });
});
