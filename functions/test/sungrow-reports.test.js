'use strict';

/**
 * Tests for Sungrow getHistory / getReport / getGeneration adapter methods
 * and the provider-aware inverter-read + inverter-history route modules.
 */

const express = require('express');
const request = require('supertest');

const {
  SungrowDeviceAdapter,
  createSungrowDeviceAdapter,
  ENERGY_STAT_POINTS,
  msToSungrowTimestamp,
  sungrowTsToDisplay
} = require('../lib/adapters/sungrow-adapter');

const { registerInverterReadRoutes } = require('../api/routes/inverter-read');
const { registerInverterHistoryRoutes } = require('../api/routes/inverter-history');

// ─── Shared helpers ───────────────────────────────────────────────────────────

function buildMockSungrowAPI(overrides = {}) {
  return {
    callSungrowAPI: jest.fn(async () => ({ errno: 0, result: {} })),
    ...overrides
  };
}

function buildAdapter(apiOverrides = {}) {
  return createSungrowDeviceAdapter({
    sungrowAPI: buildMockSungrowAPI(apiOverrides),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  });
}

const BASE_CONTEXT = {
  deviceSN: 'SG-TEST-001',
  userConfig: { deviceProvider: 'sungrow', sungrowToken: 'tok', sungrowTokenExpiry: Date.now() + 9999 },
  userId: 'user-abc'
};

// Fake iSolarCloud history point response for one point
function makeHistPointResponse(pointId, unit, dataPoints) {
  return {
    errno: 0,
    result: {
      device_point_list: [
        {
          point_id: pointId,
          data_unit: unit,
          point_data: dataPoints.map(([ts, val]) => ({ time_stamp: ts, point_value: String(val) }))
        }
      ]
    }
  };
}

// Build a full history response with multiple points
function makeFullHistResponse(entries) {
  return {
    errno: 0,
    result: {
      device_point_list: entries.map(([pid, unit, pts]) => ({
        point_id: pid,
        data_unit: unit,
        point_data: pts.map(([ts, val]) => ({ time_stamp: ts, point_value: String(val) }))
      }))
    }
  };
}

// Build a stat response for one point with day-granularity data
function makeStatResponse(pointId, unit, dayEntries) {
  return {
    errno: 0,
    result: {
      device_point_list: [
        {
          point_id: pointId,
          data_unit: unit,
          point_data: dayEntries.map(([date, val]) => ({ time_stamp: date, point_value: String(val) }))
        }
      ]
    }
  };
}

// ─── msToSungrowTimestamp ─────────────────────────────────────────────────────

describe('msToSungrowTimestamp', () => {
  test('converts UTC ms to YYYYMMDDHHMMSS string', () => {
    // 2024-06-15 14:30:05 UTC
    const ms = Date.UTC(2024, 5, 15, 14, 30, 5);
    expect(msToSungrowTimestamp(ms)).toBe('20240615143005');
  });

  test('pads single-digit month/day/hour/min/sec', () => {
    // 2024-01-02 03:04:05 UTC
    const ms = Date.UTC(2024, 0, 2, 3, 4, 5);
    expect(msToSungrowTimestamp(ms)).toBe('20240102030405');
  });
});

// ─── sungrowTsToDisplay ───────────────────────────────────────────────────────

describe('sungrowTsToDisplay', () => {
  test('converts 14-char timestamp to display format', () => {
    expect(sungrowTsToDisplay('20240615143005')).toBe('2024-06-15 14:30:05');
  });

  test('returns short string unchanged', () => {
    expect(sungrowTsToDisplay('20240615')).toBe('20240615');
  });

  test('handles null/undefined gracefully', () => {
    expect(sungrowTsToDisplay(null)).toBe('');
    expect(sungrowTsToDisplay(undefined)).toBe('');
  });
});

// ─── getHistory ───────────────────────────────────────────────────────────────

describe('SungrowDeviceAdapter.getHistory', () => {
  test('throws when deviceSN is missing', async () => {
    const adapter = buildAdapter();
    await expect(adapter.getHistory({}, Date.now() - 3600000, Date.now()))
      .rejects.toThrow(/deviceSN/);
  });

  test('calls queryDeviceHistData with YYYYMMDDHHMMSS timestamps', async () => {
    const callSungrowAPI = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = buildAdapter({ callSungrowAPI });

    const begin = Date.UTC(2024, 5, 15, 10, 0, 0);
    const end   = Date.UTC(2024, 5, 15, 11, 0, 0);
    await adapter.getHistory(BASE_CONTEXT, begin, end);

    expect(callSungrowAPI).toHaveBeenCalledWith(
      'queryDeviceHistData',
      expect.objectContaining({
        device_sn: 'SG-TEST-001',
        start_time_stamp: '20240615100000',
        end_time_stamp:   '20240615110000',
        points_id: ['p83', 'p27', 'p10994', 'p86']
      }),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('maps p83 to both generationPower and pvPower (W → kW)', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () =>
        makeFullHistResponse([
          ['p83', 'W', [['20240615100500', 3000]]]
        ])
      )
    });

    const result = await adapter.getHistory(BASE_CONTEXT, Date.UTC(2024, 5, 15, 10, 0, 0), Date.UTC(2024, 5, 15, 11, 0, 0));

    expect(result.errno).toBe(0);
    const datas = result.result[0].datas;

    const genPwr = datas.find((d) => d.variable === 'generationPower');
    const pvPwr  = datas.find((d) => d.variable === 'pvPower');
    expect(genPwr).toBeDefined();
    expect(pvPwr).toBeDefined();
    expect(genPwr.data[0]).toEqual({ time: '2024-06-15 10:05:00', value: 3 });
    expect(pvPwr.data[0]).toEqual({ time: '2024-06-15 10:05:00', value: 3 });
    expect(genPwr.unit).toBe('kW');
  });

  test('maps p27 to loadsPower (W → kW)', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () =>
        makeFullHistResponse([['p27', 'W', [['20240615100500', 1500]]]])
      )
    });
    const result = await adapter.getHistory(BASE_CONTEXT, 0, 1);
    const loads = result.result[0].datas.find((d) => d.variable === 'loadsPower');
    expect(loads).toBeDefined();
    expect(loads.data[0].value).toBe(1.5);
  });

  test('splits positive p10994 into gridConsumptionPower only', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () =>
        makeFullHistResponse([['p10994', 'W', [['20240615100500', 2000]]]])
      )
    });
    const result = await adapter.getHistory(BASE_CONTEXT, 0, 1);
    const datas = result.result[0].datas;
    const grid  = datas.find((d) => d.variable === 'gridConsumptionPower');
    const feed  = datas.find((d) => d.variable === 'feedinPower');
    expect(grid.data[0].value).toBe(2);    // 2000 W → 2 kW
    expect(feed.data[0].value).toBe(0);    // no export
  });

  test('splits negative p10994 into feedinPower only', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () =>
        makeFullHistResponse([['p10994', 'W', [['20240615100500', -1800]]]])
      )
    });
    const result = await adapter.getHistory(BASE_CONTEXT, 0, 1);
    const datas = result.result[0].datas;
    const grid  = datas.find((d) => d.variable === 'gridConsumptionPower');
    const feed  = datas.find((d) => d.variable === 'feedinPower');
    expect(grid.data[0].value).toBe(0);
    expect(feed.data[0].value).toBe(1.8);  // -1800 W → 1.8 kW feed-in
  });

  test('returns correct FoxESS-shaped envelope with deviceSN', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () => ({ errno: 0, result: {} }))
    });
    const result = await adapter.getHistory(BASE_CONTEXT, 0, 1);
    expect(result.errno).toBe(0);
    expect(Array.isArray(result.result)).toBe(true);
    expect(result.result[0].deviceSN).toBe('SG-TEST-001');
    expect(Array.isArray(result.result[0].datas)).toBe(true);
  });

  test('propagates API error via normalizeProviderError', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () => ({ errno: 3303, error: 'Rate limited' }))
    });
    const result = await adapter.getHistory(BASE_CONTEXT, 0, 1);
    expect(result.errno).toBe(3303);
  });

  test('skips data points with null values', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () =>
        makeFullHistResponse([
          ['p83', 'W', [['20240615100000', 'NaN'], ['20240615100500', 2000]]]
        ])
      )
    });
    const result = await adapter.getHistory(BASE_CONTEXT, 0, 1);
    const gen = result.result[0].datas.find((d) => d.variable === 'generationPower');
    expect(gen.data).toHaveLength(1);
    expect(gen.data[0].value).toBe(2);
  });
});

// ─── getReport ────────────────────────────────────────────────────────────────

describe('SungrowDeviceAdapter.getReport', () => {
  test('throws when deviceSN is missing', async () => {
    const adapter = buildAdapter();
    await expect(adapter.getReport({}, 'month', 2024, 6))
      .rejects.toThrow(/deviceSN/);
  });

  test('calls queryDeviceStatPoints with stat_type day for month dimension', async () => {
    const callSungrowAPI = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = buildAdapter({ callSungrowAPI });
    await adapter.getReport(BASE_CONTEXT, 'month', 2024, 6);

    expect(callSungrowAPI).toHaveBeenCalledWith(
      'queryDeviceStatPoints',
      expect.objectContaining({
        stat_type:        'day',
        start_time_stamp: '20240601',
        end_time_stamp:   '20240630',
        point_ids:        Object.values(ENERGY_STAT_POINTS)
      }),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('calls queryDeviceStatPoints with stat_type month for year dimension', async () => {
    const callSungrowAPI = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = buildAdapter({ callSungrowAPI });
    await adapter.getReport(BASE_CONTEXT, 'year', 2024);

    expect(callSungrowAPI).toHaveBeenCalledWith(
      'queryDeviceStatPoints',
      expect.objectContaining({
        stat_type:        'month',
        start_time_stamp: '20240101',
        end_time_stamp:   '20241231'
      }),
      expect.anything(),
      expect.anything()
    );
  });

  test('maps all 5 FoxESS energy variables in result', async () => {
    const callSungrowAPI = jest.fn(async () => ({
      errno: 0,
      result: {
        device_point_list: [
          { point_id: 'p58', data_unit: 'kWh', point_data: [{ time_stamp: '20240601', point_value: '12.5' }] },
          { point_id: 'p91', data_unit: 'kWh', point_data: [{ time_stamp: '20240601', point_value: '3.2' }] },
          { point_id: 'p89', data_unit: 'kWh', point_data: [{ time_stamp: '20240601', point_value: '1.1' }] },
          { point_id: 'p90', data_unit: 'kWh', point_data: [{ time_stamp: '20240601', point_value: '4.0' }] },
          { point_id: 'p93', data_unit: 'kWh', point_data: [{ time_stamp: '20240601', point_value: '2.8' }] }
        ]
      }
    }));
    const adapter = buildAdapter({ callSungrowAPI });
    const result = await adapter.getReport(BASE_CONTEXT, 'month', 2024, 6);

    expect(result.errno).toBe(0);
    const vars = result.result.map((r) => r.variable);
    expect(vars).toEqual(expect.arrayContaining([
      'generation', 'feedin', 'gridConsumption', 'chargeEnergyToTal', 'dischargeEnergyToTal'
    ]));

    const gen = result.result.find((r) => r.variable === 'generation');
    expect(gen.unit).toBe('kWh');
    expect(gen.values).toEqual([12.5]);

    const feedin = result.result.find((r) => r.variable === 'feedin');
    expect(feedin.values).toEqual([3.2]);
  });

  test('returns empty values array when point has no data', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () => ({ errno: 0, result: {} }))
    });
    const result = await adapter.getReport(BASE_CONTEXT, 'month', 2024, 6);
    expect(result.errno).toBe(0);
    result.result.forEach((r) => expect(r.values).toEqual([]));
  });

  test('propagates API error via normalizeProviderError', async () => {
    const adapter = buildAdapter({
      callSungrowAPI: jest.fn(async () => ({ errno: 3301, error: 'Token expired' }))
    });
    const result = await adapter.getReport(BASE_CONTEXT, 'month', 2024, 6);
    expect(result.errno).toBe(3301);
  });
});

// ─── getGeneration ────────────────────────────────────────────────────────────

describe('SungrowDeviceAdapter.getGeneration', () => {
  test('throws when deviceSN is missing', async () => {
    const adapter = buildAdapter();
    await expect(adapter.getGeneration({})).rejects.toThrow(/deviceSN/);
  });

  test('makes two queryDeviceStatPoints calls (day + month stat_type)', async () => {
    const callSungrowAPI = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = buildAdapter({ callSungrowAPI });
    await adapter.getGeneration(BASE_CONTEXT);

    expect(callSungrowAPI).toHaveBeenCalledTimes(2);
    const [call1, call2] = callSungrowAPI.mock.calls;

    expect(call1[1]).toEqual(expect.objectContaining({ stat_type: 'day' }));
    expect(call2[1]).toEqual(expect.objectContaining({ stat_type: 'month' }));
  });

  test('derives today, month, year from stat data', async () => {
    const now = new Date();
    const y  = now.getUTCFullYear();
    const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(now.getUTCDate()).padStart(2, '0');
    const todayKey = `${y}${mo}${dy}`;

    const callSungrowAPI = jest.fn()
      .mockResolvedValueOnce({
        // Call 1: daily stats for this month
        errno: 0,
        result: {
          device_point_list: [{
            point_id: 'p58',
            data_unit: 'kWh',
            point_data: [
              { time_stamp: `${y}${mo}01`, point_value: '8.5' },
              { time_stamp: todayKey,      point_value: '11.2' }
            ]
          }]
        }
      })
      .mockResolvedValueOnce({
        // Call 2: monthly stats for this year
        errno: 0,
        result: {
          device_point_list: [{
            point_id: 'p58',
            data_unit: 'kWh',
            point_data: [
              { time_stamp: `${y}01`, point_value: '200' },
              { time_stamp: `${y}${mo}`, point_value: '450' }
            ]
          }]
        }
      });

    const adapter = buildAdapter({ callSungrowAPI });
    const result = await adapter.getGeneration(BASE_CONTEXT);

    expect(result.errno).toBe(0);
    expect(result.result.today).toBe(11.2);            // today's value
    expect(result.result.month).toBeCloseTo(19.7, 2);  // 8.5 + 11.2
    expect(result.result.year).toBeCloseTo(650, 1);    // 200 + 450
    expect(result.result.yearGeneration).toBeCloseTo(650, 1);
    expect(result.result.cumulative).toBeCloseTo(650, 1);
  });

  test('falls back to month total for year when year call fails', async () => {
    const callSungrowAPI = jest.fn()
      .mockResolvedValueOnce({
        errno: 0,
        result: {
          device_point_list: [{
            point_id: 'p58',
            data_unit: 'kWh',
            point_data: [{ time_stamp: '20240601', point_value: '50' }]
          }]
        }
      })
      .mockResolvedValueOnce({ errno: 3304, error: 'Upstream error' });

    const adapter = buildAdapter({ callSungrowAPI });
    const result = await adapter.getGeneration(BASE_CONTEXT);

    // Year should fall back to month total
    expect(result.errno).toBe(0);
    expect(result.result.month).toBe(50);
    expect(result.result.year).toBe(50); // fallback
  });

  test('returns errno error when first (month) call fails', async () => {
    const callSungrowAPI = jest.fn()
      .mockResolvedValueOnce({ errno: 3303, error: 'Rate limited' });

    const adapter = buildAdapter({ callSungrowAPI });
    const result = await adapter.getGeneration(BASE_CONTEXT);
    expect(result.errno).toBe(3303);
  });
});

// ─── DeviceAdapter base class defaults ───────────────────────────────────────

describe('DeviceAdapter optional method defaults', () => {
  const { DeviceAdapter } = require('../lib/adapters/device-adapter');

  class MinimalAdapter extends DeviceAdapter {
    async getStatus() { return {}; }
    async getCapabilities() { return {}; }
    async getSchedule() { return {}; }
    async setSchedule() { return {}; }
    async clearSchedule() { return {}; }
    async getWorkMode() { return {}; }
    async setWorkMode() { return {}; }
    normalizeProviderError() { return { errno: 0 }; }
  }

  test('getHistory returns null by default', async () => {
    const a = new MinimalAdapter();
    await expect(a.getHistory()).resolves.toBeNull();
  });

  test('getReport returns null by default', async () => {
    const a = new MinimalAdapter();
    await expect(a.getReport()).resolves.toBeNull();
  });

  test('getGeneration returns null by default', async () => {
    const a = new MinimalAdapter();
    await expect(a.getGeneration()).resolves.toBeNull();
  });
});

// ─── inverter-read.js provider dispatch ──────────────────────────────────────

function buildInverterReadApp({ adapterRegistry = null, adapterOverrides = {} } = {}) {
  const app = express();
  app.use(express.json());

  const mockUserConfig = {
    deviceProvider: adapterRegistry ? 'sungrow' : 'foxess',
    deviceSn: 'DEV-001',
    sungrowToken: 'tok',
    sungrowTokenExpiry: Date.now() + 9999
  };

  const getUserConfig = jest.fn(async () => mockUserConfig);
  const authenticateUser = (req, _res, next) => { req.user = { uid: 'uid1' }; next(); };

  const foxessAPI = {
    callFoxESSAPI: jest.fn(async (path) => {
      if (path.includes('report/query')) return { errno: 0, result: [{ variable: 'generation', unit: 'kWh', values: [1, 2, 3] }] };
      if (path.includes('generation')) return { errno: 0, result: { today: 5, month: 50, year: 200, cumulative: 500, yearGeneration: 200 } };
      return { errno: 0, result: null };
    })
  };

  const getCachedInverterRealtimeData = jest.fn(async () => ({ errno: 0, result: [] }));

  registerInverterReadRoutes(app, {
    foxessAPI,
    getUserConfig,
    getCachedInverterRealtimeData,
    authenticateUser,
    adapterRegistry,
    logger: { warn: jest.fn(), info: jest.fn() }
  });

  return { app, foxessAPI, getUserConfig };
}

describe('inverter-read.js /api/inverter/report — provider dispatch', () => {
  test('FoxESS path: calls foxessAPI when no adapterRegistry', async () => {
    const { app, foxessAPI } = buildInverterReadApp({ adapterRegistry: null });
    const res = await request(app).get('/api/inverter/report?dimension=month&year=2024&month=6');
    expect(res.statusCode).toBe(200);
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/report/query', 'POST', expect.objectContaining({ dimension: 'month' }), expect.anything(), expect.anything()
    );
  });

  test('Sungrow path: calls adapter.getReport and bypasses foxessAPI', async () => {
    const getReport = jest.fn(async () => ({
      errno: 0,
      result: [{ variable: 'generation', unit: 'kWh', values: [10, 20] }]
    }));
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({ getReport }))
    };
    const { app, foxessAPI } = buildInverterReadApp({ adapterRegistry });
    const res = await request(app).get('/api/inverter/report?dimension=month&year=2024&month=6');

    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(getReport).toHaveBeenCalledWith(
      expect.objectContaining({ deviceSN: 'DEV-001' }),
      'month', 2024, 6
    );
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('Sungrow path: adapter.getReport returning null returns 400 (not supported)', async () => {
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({ getReport: async () => null }))
    };
    const { app, foxessAPI } = buildInverterReadApp({ adapterRegistry });
    const res = await request(app).get('/api/inverter/report');
    expect(res.statusCode).toBe(400);
    expect(res.body.errno).toBe(400);
    expect(res.body.error).toMatch(/Not supported for provider/);
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });
});

describe('inverter-read.js /api/inverter/generation — provider dispatch', () => {
  test('FoxESS path: calls foxessAPI when no adapterRegistry', async () => {
    const { app, foxessAPI } = buildInverterReadApp({ adapterRegistry: null });
    const res = await request(app).get('/api/inverter/generation');
    expect(res.statusCode).toBe(200);
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      expect.stringContaining('/op/v0/device/generation'), 'GET', null, expect.anything(), expect.anything()
    );
  });

  test('Sungrow path: calls adapter.getGeneration and bypasses foxessAPI', async () => {
    const getGeneration = jest.fn(async () => ({
      errno: 0,
      result: { today: 12, month: 300, year: 1500, cumulative: 5000, yearGeneration: 1500 }
    }));
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({ getGeneration }))
    };
    const { app, foxessAPI } = buildInverterReadApp({ adapterRegistry });
    const res = await request(app).get('/api/inverter/generation');

    expect(res.statusCode).toBe(200);
    expect(res.body.result.today).toBe(12);
    expect(getGeneration).toHaveBeenCalled();
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('Sungrow path: adapter.getGeneration returning null returns 400 (not supported)', async () => {
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({ getGeneration: async () => null }))
    };
    const { app, foxessAPI } = buildInverterReadApp({ adapterRegistry });
    const res = await request(app).get('/api/inverter/generation');
    expect(res.statusCode).toBe(400);
    expect(res.body.errno).toBe(400);
    expect(res.body.error).toMatch(/Not supported for provider/);
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });
});

// ─── inverter-history.js provider dispatch ────────────────────────────────────

function buildInverterHistoryApp({ adapterRegistry = null } = {}) {
  const app = express();
  app.use(express.json());

  const mockUserConfig = {
    deviceProvider: adapterRegistry ? 'sungrow' : 'foxess',
    deviceSn: 'DEV-001',
    sungrowToken: 'tok',
    sungrowTokenExpiry: Date.now() + 9999
  };

  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({ exists: false })),
            set: jest.fn(async () => {}),
            delete: jest.fn(async () => {})
          }))
        }))
      }))
    }))
  };

  const foxessAPI = {
    callFoxESSAPI: jest.fn(async () => ({
      errno: 0,
      result: [{ datas: [{ variable: 'pvPower', unit: 'kW', data: [] }], deviceSN: 'DEV-001' }]
    }))
  };

  const authenticateUser = (req, _res, next) => { req.user = { uid: 'uid1' }; next(); };
  const getUserConfig = jest.fn(async () => mockUserConfig);

  registerInverterHistoryRoutes(app, {
    authenticateUser,
    db,
    foxessAPI,
    getUserConfig,
    adapterRegistry,
    logger: { warn: jest.fn(), info: jest.fn() }
  });

  return { app, foxessAPI };
}

describe('inverter-history.js /api/inverter/history — provider dispatch', () => {
  test('FoxESS path: calls foxessAPI when no adapterRegistry', async () => {
    const { app, foxessAPI } = buildInverterHistoryApp({ adapterRegistry: null });
    const begin = Date.now() - 3600000;
    const end   = Date.now();
    const res = await request(app).get(`/api/inverter/history?begin=${begin}&end=${end}`);
    expect(res.statusCode).toBe(200);
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalled();
  });

  test('Sungrow path: calls adapter.getHistory and bypasses foxessAPI', async () => {
    const getHistory = jest.fn(async () => ({
      errno: 0,
      result: [{
        deviceSN: 'DEV-001',
        datas: [
          { variable: 'generationPower', unit: 'kW', data: [{ time: '2024-06-15 10:00:00', value: 3.0 }] }
        ]
      }]
    }));
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({ getHistory }))
    };
    const { app, foxessAPI } = buildInverterHistoryApp({ adapterRegistry });
    const begin = Date.now() - 3600000;
    const end   = Date.now();
    const res = await request(app).get(`/api/inverter/history?begin=${begin}&end=${end}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ deviceSN: 'DEV-001' }),
      expect.any(Number),
      expect.any(Number)
    );
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('Sungrow path falls back to FoxESS when adapter.getHistory returns null', async () => {
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({ getHistory: async () => null }))
    };
    const { app, foxessAPI } = buildInverterHistoryApp({ adapterRegistry });
    const res = await request(app).get('/api/inverter/history');
    expect(res.statusCode).toBe(200);
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalled();
  });

  test('returns 500 when adapter.getHistory throws', async () => {
    const adapterRegistry = {
      getDeviceProvider: jest.fn(() => ({
        getHistory: jest.fn(async () => { throw new Error('iSolarCloud timeout'); })
      }))
    };
    const { app } = buildInverterHistoryApp({ adapterRegistry });
    const res = await request(app).get('/api/inverter/history');
    expect(res.statusCode).toBe(500);
    expect(res.body.errno).toBe(500);
  });
});
