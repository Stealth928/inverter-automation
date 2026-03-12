'use strict';

const {
  fetchAutomationAmberData,
  fetchAutomationInverterData,
  hasNestedDatasFrame,
  logAmberForecastSummary
} = require('../lib/services/automation-cycle-data-service');

function buildAmberApi(overrides = {}) {
  return {
    cacheAmberPricesCurrent: jest.fn(async () => undefined),
    cacheAmberSites: jest.fn(async () => undefined),
    callAmberAPI: jest.fn(async () => []),
    getCachedAmberPricesCurrent: jest.fn(async () => null),
    getCachedAmberSites: jest.fn(async () => null),
    ...overrides
  };
}

describe('automation cycle data service', () => {
  test('hasNestedDatasFrame checks expected response shape', () => {
    expect(hasNestedDatasFrame({ result: [{ datas: [] }] })).toBe(true);
    expect(hasNestedDatasFrame({ result: [{ data: [] }] })).toBe(false);
    expect(hasNestedDatasFrame(null)).toBe(false);
  });

  test('fetchAutomationInverterData returns primary cache payload when datas exists', async () => {
    const primaryPayload = { errno: 0, result: [{ datas: [{ variable: 'SoC', value: 70 }] }] };
    const getCachedInverterData = jest.fn(async () => primaryPayload);
    const getCachedInverterRealtimeData = jest.fn(async () => null);

    const result = await fetchAutomationInverterData({
      deviceSN: 'SN-1',
      getCachedInverterData,
      getCachedInverterRealtimeData,
      userConfig: { deviceSn: 'SN-1' },
      userId: 'u1'
    });

    expect(result).toBe(primaryPayload);
    expect(getCachedInverterRealtimeData).not.toHaveBeenCalled();
  });

  test('fetchAutomationInverterData builds full telemetry frame for non-fox providers', async () => {
    const getCachedInverterData = jest.fn(async () => null);
    const deviceAdapter = {
      getStatus: jest.fn(async () => ({
        observedAtIso: '2026-03-12T01:02:03.000Z',
        socPct: 66,
        batteryTempC: 24.2,
        ambientTempC: 20.1,
        pvPowerW: 4200,
        loadPowerW: 1700,
        gridPowerW: 300,
        feedInPowerW: 0
      }))
    };

    const result = await fetchAutomationInverterData({
      deviceAdapter,
      deviceSN: 'SN-SG-1',
      getCachedInverterData,
      provider: 'sungrow',
      userConfig: { provider: 'sungrow', deviceSn: 'SN-SG-1' },
      userId: 'u1'
    });

    expect(deviceAdapter.getStatus).toHaveBeenCalledWith({
      deviceSN: 'SN-SG-1',
      userConfig: { provider: 'sungrow', deviceSn: 'SN-SG-1' },
      userId: 'u1'
    });
    expect(getCachedInverterData).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      errno: 0,
      result: [expect.objectContaining({
        time: '2026-03-12T01:02:03.000Z',
        datas: expect.arrayContaining([
          { variable: 'SoC', value: 66 },
          { variable: 'pvPower', value: 4200 },
          { variable: 'loadsPower', value: 1700 },
          { variable: 'gridConsumptionPower', value: 300 },
          { variable: 'feedinPower', value: 0 },
          { variable: 'meterPower2', value: 300 }
        ])
      })]
    }));
  });

  test('fetchAutomationInverterData falls back to realtime cache when primary payload is invalid', async () => {
    const primaryPayload = { errno: 0, result: [{ data: [] }] };
    const realtimePayload = { errno: 0, result: [{ datas: [{ variable: 'SoC', value: 75 }] }] };
    const getCachedInverterData = jest.fn(async () => primaryPayload);
    const getCachedInverterRealtimeData = jest.fn(async () => realtimePayload);
    const logger = { log: jest.fn(), warn: jest.fn() };

    const result = await fetchAutomationInverterData({
      deviceSN: 'SN-1',
      getCachedInverterData,
      getCachedInverterRealtimeData,
      logger,
      userConfig: { deviceSn: 'SN-1' },
      userId: 'u1'
    });

    expect(result).toBe(realtimePayload);
    expect(getCachedInverterRealtimeData).toHaveBeenCalledWith('u1', 'SN-1', { deviceSn: 'SN-1' }, false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[Automation] Automation inverter cache missing datas structure (errno=%s), falling back to realtime cache',
      0
    );
  });

  test('fetchAutomationInverterData returns null when primary cache call throws', async () => {
    const getCachedInverterData = jest.fn(async () => {
      throw new Error('cache down');
    });
    const logger = { log: jest.fn(), warn: jest.fn() };

    const result = await fetchAutomationInverterData({
      deviceSN: 'SN-1',
      getCachedInverterData,
      logger,
      userConfig: { deviceSn: 'SN-1' },
      userId: 'u1'
    });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[Automation] Failed to get inverter data:', 'cache down');
  });

  test('fetchAutomationAmberData returns null when Amber credentials are not configured', async () => {
    const amberAPI = buildAmberApi();

    const result = await fetchAutomationAmberData({
      amberAPI,
      amberPricesInFlight: new Map(),
      userConfig: {},
      userId: 'u1'
    });

    expect(result).toBeNull();
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });

  test('fetchAutomationAmberData fetches and caches sites/prices on cache miss', async () => {
    const pricePayload = [{ channelType: 'general', perKwh: 30, type: 'ForecastInterval' }];
    const amberAPI = buildAmberApi({
      callAmberAPI: jest.fn(async (path) => {
        if (path === '/sites') return [{ id: 'site-1' }];
        if (path === '/sites/site-1/prices/current') return pricePayload;
        return [];
      })
    });
    const inFlight = new Map();
    const userConfig = { amberApiKey: 'abc123' };

    const result = await fetchAutomationAmberData({
      amberAPI,
      amberPricesInFlight: inFlight,
      userConfig,
      userId: 'u1'
    });

    expect(result).toEqual(pricePayload);
    expect(amberAPI.callAmberAPI).toHaveBeenNthCalledWith(1, '/sites', {}, userConfig, 'u1');
    expect(amberAPI.callAmberAPI).toHaveBeenNthCalledWith(
      2,
      '/sites/site-1/prices/current',
      { next: 288 },
      userConfig,
      'u1'
    );
    expect(amberAPI.cacheAmberSites).toHaveBeenCalledWith('u1', [{ id: 'site-1' }]);
    expect(amberAPI.cacheAmberPricesCurrent).toHaveBeenCalledWith('site-1', pricePayload, 'u1', userConfig);
    expect(inFlight.size).toBe(0);
  });

  test('fetchAutomationAmberData uses in-flight request when present', async () => {
    const inFlightData = [{ channelType: 'feedIn', perKwh: -5, type: 'ForecastInterval' }];
    const amberAPI = buildAmberApi({
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }])
    });
    const inFlight = new Map([['u1:site-1', Promise.resolve(inFlightData)]]);

    const result = await fetchAutomationAmberData({
      amberAPI,
      amberPricesInFlight: inFlight,
      userConfig: { amberApiKey: 'abc123' },
      userId: 'u1'
    });

    expect(result).toEqual(inFlightData);
    expect(amberAPI.callAmberAPI).not.toHaveBeenCalled();
  });

  test('fetchAutomationAmberData retries after failed in-flight request', async () => {
    const userConfig = { amberApiKey: 'abc123' };
    const prices = [{ channelType: 'general', perKwh: 12, type: 'ForecastInterval' }];
    const amberAPI = buildAmberApi({
      callAmberAPI: jest.fn(async () => prices),
      getCachedAmberSites: jest.fn(async () => [{ id: 'site-1' }])
    });
    const inFlight = new Map([['u1:site-1', Promise.reject(new Error('inflight fail'))]]);
    const logger = { log: jest.fn(), warn: jest.fn() };

    const result = await fetchAutomationAmberData({
      amberAPI,
      amberPricesInFlight: inFlight,
      logger,
      userConfig,
      userId: 'u1'
    });

    expect(result).toEqual(prices);
    expect(amberAPI.callAmberAPI).toHaveBeenCalledWith(
      '/sites/site-1/prices/current',
      { next: 288 },
      userConfig,
      'u1'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[Automation] In-flight request failed for u1, will retry:',
      'inflight fail'
    );
    expect(inFlight.size).toBe(0);
  });

  test('logAmberForecastSummary logs each forecast channel when data is present', () => {
    const logger = { log: jest.fn() };
    logAmberForecastSummary([
      { channelType: 'general', perKwh: 32, type: 'ForecastInterval' },
      { channelType: 'feedIn', perKwh: -7, type: 'ForecastInterval' }
    ], logger);

    expect(logger.log).toHaveBeenCalledTimes(2);
  });
});
