'use strict';

const amberModule = require('../api/amber');

function buildCacheDb(docs = {}) {
  return {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn((docId) => ({
            get: jest.fn(async () => {
              const data = docs[docId];
              return data
                ? { exists: true, data: () => data }
                : { exists: false, data: () => ({}) };
            }),
            set: jest.fn(async () => undefined)
          }))
        }))
      }))
    }))
  };
}

describe('amber api emulator historical pricing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  test('fetchAmberHistoricalPricesActualOnly synthesizes deterministic history in emulator mode', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const siteId = 'seed-site-foxess';
    const currentRows = [
      {
        startTime: '2026-04-02T09:30:00.000Z',
        endTime: '2026-04-02T10:00:00.000Z',
        channelType: 'general',
        perKwh: 31.5,
        renewables: 44,
        type: 'CurrentInterval'
      },
      {
        startTime: '2026-04-02T09:30:00.000Z',
        endTime: '2026-04-02T10:00:00.000Z',
        channelType: 'feedIn',
        perKwh: -8.7,
        renewables: 44,
        type: 'CurrentInterval'
      }
    ];
    const amberAPI = amberModule.init({
      db: buildCacheDb({
        [`amber_current_${siteId}`]: {
          siteId,
          prices: currentRows,
          cachedAt: { toMillis: () => Date.now() }
        }
      }),
      logger: { debug: jest.fn(), error: jest.fn() },
      getConfig: () => ({
        amber: { apiKey: '', baseUrl: 'https://amber.test' },
        automation: { cacheTtl: { amber: 60000 } }
      }),
      incrementApiCount: null,
      cacheMetrics: null
    });

    const result = await amberAPI.fetchAmberHistoricalPricesActualOnly(
      siteId,
      '2026-03-04',
      '2026-03-05',
      30,
      { timezone: 'Australia/Sydney' },
      'user-1'
    );

    expect(result.errno).toBe(0);
    expect(result._info.source).toBe('emulator_synth_actual_only');
    expect(result.result.length).toBeGreaterThan(0);
    expect(result.result.every((row) => new Date(row.startTime) <= new Date())).toBe(true);
    expect(result.result.some((row) => row.channelType === 'general' && row.perKwh > 0)).toBe(true);
    expect(result.result.some((row) => row.channelType === 'feedIn' && row.perKwh < 0)).toBe(true);
  });
});
