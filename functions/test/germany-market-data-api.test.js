'use strict';

function loadGermanyMarketModule() {
  let germanyMarketModule = null;
  jest.isolateModules(() => {
    germanyMarketModule = require('../api/germany-market-data');
  });
  return germanyMarketModule;
}

describe('germany market data api current snapshot reads', () => {
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
        marketId: 'DE',
        data: [
          {
            type: 'CurrentInterval',
            channelType: 'general',
            perKwh: 11.3,
            startTime: '2026-04-01T10:00:00.000Z',
            endTime: '2026-04-01T11:00:00.000Z'
          }
        ],
        metadata: {
          asOf: '2026-04-01T10:00:00.000Z',
          forecastHorizonMinutes: 240,
          isForecastComplete: true,
          source: 'entsoe'
        },
        storedAtIso: '2026-04-01T10:01:00.000Z'
      })
    };
    const docRef = {
      get: jest.fn(async () => storedSnapshotDoc),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn((name) => {
        expect(name).toBe('germanyMarketSnapshots');
        return {
          doc: jest.fn((marketId) => {
            expect(marketId).toBe('DE');
            return docRef;
          })
        };
      })
    };

    const germanyMarketModule = loadGermanyMarketModule();
    const api = germanyMarketModule.init({
      db,
      getConfig: () => ({
        automation: {
          cacheTtl: {
            germanyMarketData: 60000
          }
        }
      }),
      serverTimestamp: () => 'server-ts'
    });

    const first = await api.getCurrentPriceData({ marketId: 'DE', forceRefresh: true });
    const second = await api.getCurrentPriceData({ marketId: 'DE' });

    expect(first).toEqual({
      marketId: 'DE',
      data: [
        {
          type: 'CurrentInterval',
          channelType: 'general',
          perKwh: 11.3,
          startTime: '2026-04-01T10:00:00.000Z',
          endTime: '2026-04-01T11:00:00.000Z'
        }
      ],
      metadata: {
        asOf: '2026-04-01T10:00:00.000Z',
        forecastHorizonMinutes: 240,
        isForecastComplete: true,
        source: 'entsoe'
      }
    });
    expect(second).toEqual(first);
    expect(docRef.get).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('germany market data parsing helpers', () => {
  test('converts ENTSO-E EUR/MWh prices to cents per kWh', () => {
    const { convertEntsoeEurPerMwhToCentsPerKwh } = loadGermanyMarketModule();

    expect(convertEntsoeEurPerMwhToCentsPerKwh(57.1)).toBe(5.71);
    expect(convertEntsoeEurPerMwhToCentsPerKwh('65.0')).toBe(6.5);
    expect(convertEntsoeEurPerMwhToCentsPerKwh(-12.4)).toBe(-1.24);
    expect(convertEntsoeEurPerMwhToCentsPerKwh(null)).toBeNull();
  });

  test('parseEntsoePriceDocument converts XML points to sorted hourly intervals', () => {
    const { parseEntsoePriceDocument } = loadGermanyMarketModule();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <Publication_MarketDocument>
        <TimeSeries>
          <Period>
            <timeInterval>
              <start>2026-04-01T00:00Z</start>
              <end>2026-04-01T03:00Z</end>
            </timeInterval>
            <resolution>PT60M</resolution>
            <Point>
              <position>1</position>
              <price.amount>42.0</price.amount>
            </Point>
            <Point>
              <position>2</position>
              <price.amount>35.0</price.amount>
            </Point>
            <Point>
              <position>3</position>
              <price.amount>-10.0</price.amount>
            </Point>
          </Period>
        </TimeSeries>
      </Publication_MarketDocument>`;

    expect(parseEntsoePriceDocument(xml)).toEqual([
      {
        startIso: '2026-04-01T00:00:00.000Z',
        endIso: '2026-04-01T01:00:00.000Z',
        buyCentsPerKwh: 4.2,
        feedInCentsPerKwh: -4.2
      },
      {
        startIso: '2026-04-01T01:00:00.000Z',
        endIso: '2026-04-01T02:00:00.000Z',
        buyCentsPerKwh: 3.5,
        feedInCentsPerKwh: -3.5
      },
      {
        startIso: '2026-04-01T02:00:00.000Z',
        endIso: '2026-04-01T03:00:00.000Z',
        buyCentsPerKwh: -1,
        feedInCentsPerKwh: 1
      }
    ]);
  });

  test('buildCurrentPayload converts day-ahead intervals into current and forecast rows', () => {
    const { buildCurrentPayload } = loadGermanyMarketModule();
    const realDateNow = Date.now;
    Date.now = jest.fn(() => Date.parse('2026-04-01T01:30:00.000Z'));

    try {
      const payload = buildCurrentPayload('DE', [
        {
          startIso: '2026-04-01T01:00:00.000Z',
          endIso: '2026-04-01T02:00:00.000Z',
          buyCentsPerKwh: 5.1,
          feedInCentsPerKwh: -5.1
        },
        {
          startIso: '2026-04-01T02:00:00.000Z',
          endIso: '2026-04-01T03:00:00.000Z',
          buyCentsPerKwh: 2.6,
          feedInCentsPerKwh: -2.6
        }
      ], '2026-04-01T01:05:00.000Z');

      expect(payload.data).toEqual([
        expect.objectContaining({
          type: 'CurrentInterval',
          channelType: 'general',
          perKwh: 5.1,
          startTime: '2026-04-01T01:00:00.000Z',
          endTime: '2026-04-01T02:00:00.000Z',
          marketId: 'DE'
        }),
        expect.objectContaining({
          type: 'CurrentInterval',
          channelType: 'feedIn',
          perKwh: -5.1,
          startTime: '2026-04-01T01:00:00.000Z',
          endTime: '2026-04-01T02:00:00.000Z',
          marketId: 'DE'
        }),
        expect.objectContaining({
          type: 'ForecastInterval',
          channelType: 'general',
          perKwh: 2.6,
          startTime: '2026-04-01T02:00:00.000Z',
          endTime: '2026-04-01T03:00:00.000Z',
          marketId: 'DE'
        }),
        expect.objectContaining({
          type: 'ForecastInterval',
          channelType: 'feedIn',
          perKwh: -2.6,
          startTime: '2026-04-01T02:00:00.000Z',
          endTime: '2026-04-01T03:00:00.000Z',
          marketId: 'DE'
        })
      ]);
      expect(payload.metadata).toEqual({
        asOf: '2026-04-01T01:00:00.000Z',
        forecastHorizonMinutes: 120,
        isForecastComplete: true,
        source: 'entsoe'
      });
    } finally {
      Date.now = realDateNow;
    }
  });
});