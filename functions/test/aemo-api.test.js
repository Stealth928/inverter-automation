'use strict';

function loadAemoModule() {
  let aemoModule = null;
  jest.isolateModules(() => {
    jest.doMock('unzipper', () => ({
      Open: {
        buffer: jest.fn(async () => ({ files: [] }))
      }
    }), { virtual: true });
    jest.doMock('csv-parse/sync', () => ({
      parse: jest.fn(() => [[]])
    }), { virtual: true });
    aemoModule = require('../api/aemo');
  });
  return aemoModule;
}

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

    const aemoModule = loadAemoModule();
    const api = aemoModule.init({
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

    const aemoModule = loadAemoModule();
    const api = aemoModule.init({
      db,
      getConfig: () => ({ automation: { cacheTtl: { aemo: 60000 } } }),
      serverTimestamp: () => 'server-ts'
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

describe('aemo price unit normalization', () => {
  test('converts AEMO RRP from $/MWh to c/kWh', () => {
    const { convertAemoRrpToCentsPerKwh } = loadAemoModule();

    expect(convertAemoRrpToCentsPerKwh(57.1)).toBe(5.71);
    expect(convertAemoRrpToCentsPerKwh('65.0')).toBe(6.5);
    expect(convertAemoRrpToCentsPerKwh(-12.4)).toBe(-1.24);
    expect(convertAemoRrpToCentsPerKwh(null)).toBeNull();
  });

  test('buildCurrentPayload converts dispatch and predispatch rows to cents per kWh without expanding native AEMO intervals', () => {
    const { buildCurrentPayload } = loadAemoModule();

    const payload = buildCurrentPayload(
      'NSW1',
      [
        {
          REGIONID: 'NSW1',
          SETTLEMENTDATE: '2026/03/26 20:00:00',
          RRP: '57.1',
          LASTCHANGED: '2026/03/26 20:00:10'
        }
      ],
      [
        {
          REGIONID: 'NSW1',
          SETTLEMENTDATE: '2026/03/26 20:00:00',
          TOTALDEMAND: '8123.4',
          DEMANDFORECAST: '8200.1',
          CLEAREDSUPPLY: '8194.0'
        }
      ],
      [
        {
          REGIONID: 'NSW1',
          DATETIME: '2026/03/26 20:30:00',
          PERIODID: '1',
          RRP: '65.0',
          LASTCHANGED: '2026/03/26 20:00:20'
        }
      ],
      [
        {
          REGIONID: 'NSW1',
          DATETIME: '2026/03/26 20:30:00',
          PERIODID: '1',
          TOTALDEMAND: '8300.0',
          DEMANDFORECAST: '8350.0',
          CLEAREDSUPPLY: '8364.0'
        }
      ]
    );

    const currentGeneral = payload.data.find((row) => row.type === 'CurrentInterval' && row.channelType === 'general');
    const currentFeedIn = payload.data.find((row) => row.type === 'CurrentInterval' && row.channelType === 'feedIn');
    const forecastGeneral = payload.data.find((row) => row.type === 'ForecastInterval' && row.channelType === 'general');
    const forecastFeedIn = payload.data.find((row) => row.type === 'ForecastInterval' && row.channelType === 'feedIn');

    expect(currentGeneral).toMatchObject({
      startTime: '2026-03-26T09:55:00.000Z',
      endTime: '2026-03-26T10:00:00.000Z',
      perKwh: 5.71,
      spotPerKwh: 5.71,
      demand: 8123.4,
      demandForecast: 8200.1,
      generation: 8194
    });
    expect(currentFeedIn).toMatchObject({
      startTime: '2026-03-26T09:55:00.000Z',
      endTime: '2026-03-26T10:00:00.000Z',
      perKwh: -5.71,
      spotPerKwh: -5.71
    });
    expect(forecastGeneral).toMatchObject({
      startTime: '2026-03-26T10:00:00.000Z',
      endTime: '2026-03-26T10:30:00.000Z',
      perKwh: 6.5,
      spotPerKwh: 6.5,
      demand: 8300,
      demandForecast: 8350,
      generation: 8364
    });
    expect(forecastFeedIn).toMatchObject({
      startTime: '2026-03-26T10:00:00.000Z',
      endTime: '2026-03-26T10:30:00.000Z',
      perKwh: -6.5,
      spotPerKwh: -6.5
    });
    expect(payload.data).toHaveLength(4);
    expect(payload.metadata).toEqual({
      asOf: '2026-03-26T10:00:00.000Z',
      forecastHorizonMinutes: 30,
      isForecastComplete: true,
      source: 'aemo'
    });
  });

  test('buildHistoricalLegacyRows converts monthly price-and-demand rows to cents per kWh', () => {
    const { buildHistoricalLegacyRows } = loadAemoModule();

    const rows = buildHistoricalLegacyRows(
      'NSW1',
      [
        {
          REGION: 'NSW1',
          SETTLEMENTDATE: '2026/03/26 20:00:00',
          PERIODTYPE: 'TRADE',
          RRP: '71.2',
          TOTALDEMAND: '7900.5'
        }
      ],
      '2026-03-26T09:55:00.000Z',
      '2026-03-26T10:10:00.000Z'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      channelType: 'general',
      startTime: '2026-03-26T09:55:00.000Z',
      endTime: '2026-03-26T10:00:00.000Z',
      perKwh: 7.12,
      spotPerKwh: 7.12
    });
    expect(rows[1]).toMatchObject({
      channelType: 'feedIn',
      startTime: '2026-03-26T09:55:00.000Z',
      endTime: '2026-03-26T10:00:00.000Z',
      perKwh: -7.12,
      spotPerKwh: -7.12
    });
  });
});
