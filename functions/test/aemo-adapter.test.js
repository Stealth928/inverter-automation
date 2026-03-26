'use strict';

const { createAemoTariffAdapter } = require('../lib/adapters/aemo-adapter');

function buildAemoAPI(overrides = {}) {
  return {
    getCurrentPriceData: jest.fn(async () => ({
      regionId: 'NSW1',
      data: []
    })),
    getHistoricalPriceData: jest.fn(async () => ({
      regionId: 'NSW1',
      data: []
    })),
    listSupportedAemoRegions: jest.fn(() => [{ id: 'NSW1', provider: 'aemo' }]),
    normalizeAemoRegion: jest.fn((value) => String(value || '').trim().toUpperCase() || null),
    ...overrides
  };
}

describe('aemo tariff adapter', () => {
  test('getCurrentPrices builds normalized tariff snapshot from stored AEMO rows', async () => {
    const aemoAPI = buildAemoAPI({
      getCurrentPriceData: jest.fn(async () => ({
        regionId: 'NSW1',
        data: [
          {
            type: 'CurrentInterval',
            channelType: 'general',
            perKwh: 95.7,
            startTime: '2026-03-26T00:00:00.000Z',
            endTime: '2026-03-26T00:05:00.000Z'
          },
          {
            type: 'CurrentInterval',
            channelType: 'feedIn',
            perKwh: -12.4,
            startTime: '2026-03-26T00:00:00.000Z',
            endTime: '2026-03-26T00:05:00.000Z'
          },
          {
            type: 'ForecastInterval',
            channelType: 'general',
            perKwh: 80.2,
            startTime: '2026-03-26T00:05:00.000Z',
            endTime: '2026-03-26T00:35:00.000Z'
          },
          {
            type: 'ForecastInterval',
            channelType: 'feedIn',
            perKwh: -10.1,
            startTime: '2026-03-26T00:05:00.000Z',
            endTime: '2026-03-26T00:35:00.000Z'
          }
        ]
      }))
    });
    const adapter = createAemoTariffAdapter({ aemoAPI });

    const snapshot = await adapter.getCurrentPrices({
      userConfig: { aemoRegion: 'nsw1' }
    });

    expect(snapshot).toEqual({
      buyCentsPerKwh: 95.7,
      feedInCentsPerKwh: 12.4,
      asOfIso: '2026-03-26T00:00:00.000Z',
      intervals: [
        {
          startIso: '2026-03-26T00:00:00.000Z',
          endIso: '2026-03-26T00:05:00.000Z',
          buyCentsPerKwh: 95.7,
          feedInCentsPerKwh: 12.4,
          renewablePct: null,
          source: 'actual'
        },
        {
          startIso: '2026-03-26T00:05:00.000Z',
          endIso: '2026-03-26T00:35:00.000Z',
          buyCentsPerKwh: 80.2,
          feedInCentsPerKwh: 10.1,
          renewablePct: null,
          source: 'forecast'
        }
      ],
      siteId: 'NSW1',
      regionId: 'NSW1'
    });
    expect(aemoAPI.getCurrentPriceData).toHaveBeenCalledWith({
      userConfig: { aemoRegion: 'nsw1' },
      regionId: 'NSW1'
    });
  });

  test('normalizeProviderError maps timeout and upstream failures', () => {
    const adapter = createAemoTariffAdapter({ aemoAPI: buildAemoAPI() });

    expect(adapter.normalizeProviderError({ errno: 408, error: 'timeout' })).toEqual({
      errno: 3303,
      error: 'timeout'
    });
    expect(adapter.normalizeProviderError({ status: 503 })).toEqual({
      errno: 3304,
      error: 'AEMO provider upstream failure'
    });
  });

  test('getCurrentPriceData strips forceRefresh so AEMO stays scheduler-backed', async () => {
    const aemoAPI = buildAemoAPI();
    const adapter = createAemoTariffAdapter({ aemoAPI });

    await adapter.getCurrentPriceData({
      forceRefresh: true,
      regionId: 'nsw1',
      userConfig: { aemoRegion: 'nsw1' },
      userId: 'u-aemo'
    });

    expect(aemoAPI.getCurrentPriceData).toHaveBeenCalledWith({
      regionId: 'NSW1',
      userConfig: { aemoRegion: 'nsw1' },
      userId: 'u-aemo'
    });
  });
});
