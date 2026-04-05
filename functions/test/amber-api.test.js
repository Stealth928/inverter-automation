'use strict';

const amberModule = require('../api/amber');

function buildHttpResponse(status, body, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === 'content-type') {
          return typeof body === 'string' ? 'text/plain' : 'application/json';
        }
        return null;
      }
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

function buildFreshAmberApi(fetchImpl, docs = {}) {
  const previousFetch = global.fetch;
  jest.resetModules();
  global.fetch = fetchImpl;
  const freshAmberModule = require('../api/amber');
  const amberAPI = freshAmberModule.init({
    db: buildCacheDb(docs),
    logger: { debug: jest.fn(), error: jest.fn() },
    getConfig: () => ({
      amber: { apiKey: 'config-key', baseUrl: 'https://amber.test' },
      automation: { cacheTtl: { amber: 60000 } }
    }),
    incrementApiCount: null,
    cacheMetrics: null
  });

  return {
    amberAPI,
    freshAmberModule,
    restore() {
      global.fetch = previousFetch;
    }
  };
}

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
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.resetModules();
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

  test('fetchAmberHistoricalPricesActualOnly chunks provider requests to seven days', async () => {
    const fetchImpl = jest.fn(async (url) => {
      const parsed = new URL(String(url));
      const startDate = parsed.searchParams.get('startDate');
      const endDate = parsed.searchParams.get('endDate');
      return buildHttpResponse(200, [{
        startTime: `${startDate}T00:00:00.000Z`,
        endTime: `${endDate}T00:30:00.000Z`,
        channelType: 'general',
        perKwh: 21,
        type: 'CurrentInterval'
      }]);
    });
    const { amberAPI, restore } = buildFreshAmberApi(fetchImpl);

    try {
      const result = await amberAPI.fetchAmberHistoricalPricesActualOnly(
        'site-1',
        '2024-03-07',
        '2024-03-15',
        30,
        { amberApiKey: 'user-key' },
        'user-1'
      );

      expect(result.errno).toBe(0);
      expect(result.result).toHaveLength(2);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(amberAPI.AMBER_HISTORICAL_MAX_DAYS_PER_REQUEST).toBe(7);
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
        'https://amber.test/sites/site-1/prices?startDate=2024-03-07&endDate=2024-03-13&resolution=30',
        'https://amber.test/sites/site-1/prices?startDate=2024-03-14&endDate=2024-03-15&resolution=30'
      ]);
    } finally {
      restore();
    }
  });

  test('fetchAmberHistoricalPricesWithCache returns provider errors instead of empty results', async () => {
    const fetchImpl = jest.fn(async (url) => {
      const parsed = new URL(String(url));
      const startDate = parsed.searchParams.get('startDate');
      if (startDate === '2024-03-14') {
        return buildHttpResponse(422, 'Range requested is too large. Maximum 7 days.');
      }
      return buildHttpResponse(200, [{
        startTime: `${startDate}T00:00:00.000Z`,
        endTime: `${startDate}T00:30:00.000Z`,
        channelType: 'general',
        perKwh: 21,
        type: 'CurrentInterval'
      }]);
    });
    const { amberAPI, restore } = buildFreshAmberApi(fetchImpl);

    try {
      const result = await amberAPI.fetchAmberHistoricalPricesWithCache(
        'site-1',
        '2024-03-07',
        '2024-03-15',
        30,
        { amberApiKey: 'user-key' },
        'user-1'
      );

      expect(result).toMatchObject({
        errno: 422,
        error: 'Range requested is too large. Maximum 7 days.',
        chunk: {
          start: '2024-03-14',
          end: '2024-03-15'
        }
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });
});
