'use strict';

describe('aemo api current snapshot reads', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
  });

  test('getCurrentPriceData reads stored snapshot only and ignores forceRefresh for upstream fetches', async () => {
    global.fetch = jest.fn(() => {
      throw new Error('Unexpected upstream fetch');
    });

    const storedSnapshotDoc = {
      exists: true,
      data: () => ({
        regionId: 'NSW1',
        data: [
          {
            type: 'CurrentInterval',
            channelType: 'general',
            perKwh: 88.4,
            startTime: '2026-03-26T00:00:00.000Z',
            endTime: '2026-03-26T00:05:00.000Z'
          }
        ],
        metadata: {
          asOf: '2026-03-26T00:00:00.000Z',
          forecastHorizonMinutes: 60,
          isForecastComplete: true,
          source: 'aemo'
        },
        storedAtIso: '2026-03-26T00:01:00.000Z'
      })
    };
    const docRef = {
      get: jest.fn(async () => storedSnapshotDoc),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn((name) => {
        expect(name).toBe('aemoSnapshots');
        return {
          doc: jest.fn((regionId) => {
            expect(regionId).toBe('NSW1');
            return docRef;
          })
        };
      })
    };

    let api = null;
    jest.isolateModules(() => {
      const aemoModule = require('../api/aemo');
      api = aemoModule.init({
        db,
        getConfig: () => ({
          automation: {
            cacheTtl: {
              aemo: 60000
            }
          }
        }),
        serverTimestamp: () => 'server-ts'
      });
    });

    const first = await api.getCurrentPriceData({ regionId: 'NSW1', forceRefresh: true });
    const second = await api.getCurrentPriceData({ regionId: 'NSW1' });

    expect(first).toEqual({
      regionId: 'NSW1',
      data: [
        {
          type: 'CurrentInterval',
          channelType: 'general',
          perKwh: 88.4,
          startTime: '2026-03-26T00:00:00.000Z',
          endTime: '2026-03-26T00:05:00.000Z'
        }
      ],
      metadata: {
        asOf: '2026-03-26T00:00:00.000Z',
        forecastHorizonMinutes: 60,
        isForecastComplete: true,
        source: 'aemo'
      }
    });
    expect(second).toEqual(first);
    expect(docRef.get).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('getCurrentPriceData returns empty stored shape when no snapshot exists', async () => {
    global.fetch = jest.fn(() => {
      throw new Error('Unexpected upstream fetch');
    });

    const docRef = {
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => docRef)
      }))
    };

    let api = null;
    jest.isolateModules(() => {
      const aemoModule = require('../api/aemo');
      api = aemoModule.init({
        db,
        getConfig: () => ({ automation: { cacheTtl: { aemo: 60000 } } }),
        serverTimestamp: () => 'server-ts'
      });
    });

    const result = await api.getCurrentPriceData({ regionId: 'TAS1' });

    expect(result).toEqual({
      regionId: 'TAS1',
      data: [],
      metadata: {
        asOf: null,
        forecastHorizonMinutes: 0,
        isForecastComplete: false,
        source: 'aemo'
      }
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
