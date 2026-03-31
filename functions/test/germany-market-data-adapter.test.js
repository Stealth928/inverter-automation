'use strict';

const { createGermanyMarketDataTariffAdapter } = require('../lib/adapters/germany-market-data-adapter');

function buildGermanyMarketAPI(overrides = {}) {
  return {
    getCurrentPriceData: jest.fn(async () => ({
      marketId: 'DE',
      data: []
    })),
    getHistoricalPriceData: jest.fn(async () => ({
      marketId: 'DE',
      data: []
    })),
    listSupportedGermanyMarkets: jest.fn(() => [{ id: 'DE', provider: 'germany-market-data' }]),
    normalizeGermanyMarketId: jest.fn(() => 'DE'),
    ...overrides
  };
}

describe('germany market data tariff adapter', () => {
  test('getCurrentPrices builds normalized tariff snapshot from stored Germany rows', async () => {
    const germanyMarketAPI = buildGermanyMarketAPI({
      getCurrentPriceData: jest.fn(async () => ({
        marketId: 'DE',
        data: [
          {
            type: 'CurrentInterval',
            channelType: 'general',
            perKwh: 12.8,
            startTime: '2026-04-01T10:00:00.000Z',
            endTime: '2026-04-01T11:00:00.000Z'
          },
          {
            type: 'CurrentInterval',
            channelType: 'feedIn',
            perKwh: -12.8,
            startTime: '2026-04-01T10:00:00.000Z',
            endTime: '2026-04-01T11:00:00.000Z'
          },
          {
            type: 'ForecastInterval',
            channelType: 'general',
            perKwh: 9.4,
            startTime: '2026-04-01T11:00:00.000Z',
            endTime: '2026-04-01T12:00:00.000Z'
          },
          {
            type: 'ForecastInterval',
            channelType: 'feedIn',
            perKwh: -9.4,
            startTime: '2026-04-01T11:00:00.000Z',
            endTime: '2026-04-01T12:00:00.000Z'
          }
        ]
      }))
    });
    const adapter = createGermanyMarketDataTariffAdapter({ germanyMarketAPI });

    const snapshot = await adapter.getCurrentPrices({
      userConfig: { siteIdOrRegion: 'de' }
    });

    expect(snapshot).toEqual({
      buyCentsPerKwh: 12.8,
      feedInCentsPerKwh: 12.8,
      asOfIso: '2026-04-01T10:00:00.000Z',
      intervals: [
        {
          startIso: '2026-04-01T10:00:00.000Z',
          endIso: '2026-04-01T11:00:00.000Z',
          buyCentsPerKwh: 12.8,
          feedInCentsPerKwh: 12.8,
          renewablePct: null,
          source: 'actual'
        },
        {
          startIso: '2026-04-01T11:00:00.000Z',
          endIso: '2026-04-01T12:00:00.000Z',
          buyCentsPerKwh: 9.4,
          feedInCentsPerKwh: 9.4,
          renewablePct: null,
          source: 'forecast'
        }
      ],
      siteId: 'DE',
      marketId: 'DE'
    });
    expect(germanyMarketAPI.getCurrentPriceData).toHaveBeenCalledWith({
      userConfig: { siteIdOrRegion: 'de' },
      marketId: 'DE'
    });
  });

  test('normalizeProviderError maps timeout and upstream failures', () => {
    const adapter = createGermanyMarketDataTariffAdapter({ germanyMarketAPI: buildGermanyMarketAPI() });

    expect(adapter.normalizeProviderError({ errno: 408, error: 'timeout' })).toEqual({
      errno: 3403,
      error: 'timeout'
    });
    expect(adapter.normalizeProviderError({ status: 503 })).toEqual({
      errno: 3404,
      error: 'Germany market data upstream failure'
    });
  });

  test('getCurrentPriceData strips forceRefresh so Germany stays scheduler-backed', async () => {
    const germanyMarketAPI = buildGermanyMarketAPI();
    const adapter = createGermanyMarketDataTariffAdapter({ germanyMarketAPI });

    await adapter.getCurrentPriceData({
      forceRefresh: true,
      marketId: 'de',
      userConfig: { siteIdOrRegion: 'de' },
      userId: 'u-de'
    });

    expect(germanyMarketAPI.getCurrentPriceData).toHaveBeenCalledWith({
      marketId: 'DE',
      userConfig: { siteIdOrRegion: 'de' },
      userId: 'u-de'
    });
  });
});