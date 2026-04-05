'use strict';

describe('amber api counting', () => {
  let amberApi;
  let incrementApiCount;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    incrementApiCount = jest.fn(async () => undefined);
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify([])
    }));
    global.fetch = fetchMock;

    const amberModule = require('../api/amber');
    amberApi = amberModule.init({
      db: {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              doc: jest.fn(() => ({
                get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
                set: jest.fn(async () => undefined)
              }))
            }))
          }))
        }))
      },
      logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      getConfig: () => ({
        amber: { apiKey: 'amber-key', baseUrl: 'https://amber.test' },
        automation: { cacheTtl: { amber: 60000 } }
      }),
      incrementApiCount
    });
  });

  test('counts each Amber history chunk request as an upstream call attempt', async () => {
    const expectedChunkCount = amberApi.splitRangeIntoChunks(
      '2026-01-01',
      '2026-03-15'
    ).length;

    await amberApi.fetchAmberHistoricalPricesActualOnly(
      'site-1',
      '2026-01-01',
      '2026-03-15',
      30,
      { amberApiKey: 'amber-key' },
      'u-amber'
    );

    expect(fetchMock).toHaveBeenCalledTimes(expectedChunkCount);
    expect(incrementApiCount).toHaveBeenCalledTimes(expectedChunkCount);
    expect(incrementApiCount).toHaveBeenNthCalledWith(1, 'u-amber', 'amber');
    expect(incrementApiCount).toHaveBeenNthCalledWith(2, 'u-amber', 'amber');
    expect(incrementApiCount).toHaveBeenNthCalledWith(expectedChunkCount, 'u-amber', 'amber');
  });
});