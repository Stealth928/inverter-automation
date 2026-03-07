'use strict';

const {
  createFoxessDeviceAdapter,
  resolveDeviceSN
} = require('../lib/adapters/foxess-adapter');

function buildFoxessApi(overrides = {}) {
  return {
    callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: [] })),
    ...overrides
  };
}

describe('foxess device adapter', () => {
  test('resolveDeviceSN supports direct and config-driven fields', () => {
    expect(resolveDeviceSN({ deviceSN: 'SN-1' })).toBe('SN-1');
    expect(resolveDeviceSN({ userConfig: { deviceSn: 'SN-2' } })).toBe('SN-2');
    expect(resolveDeviceSN({})).toBeNull();
  });

  test('getStatus returns canonical status shape from FoxESS telemetry payload', async () => {
    const foxessAPI = buildFoxessApi({
      callFoxESSAPI: jest.fn(async () => ({
        errno: 0,
        result: [{
          datas: [
            { variable: 'SoC_1', value: 68 },
            { variable: 'batTemperature_1', value: 30.8 },
            { variable: 'ambientTemperation', value: 22.4 },
            { variable: 'pvPower', value: 2500 },
            { variable: 'loadsPower', value: 1900 },
            { variable: 'gridConsumptionPower', value: 420 },
            { variable: 'feedinPower', value: 210 }
          ]
        }]
      }))
    });
    const adapter = createFoxessDeviceAdapter({ foxessAPI });

    const status = await adapter.getStatus({
      deviceSN: 'SN-STATUS',
      observedAtIso: '2026-03-07T10:00:00.000Z',
      userConfig: { deviceSn: 'SN-STATUS' },
      userId: 'u1'
    });

    expect(status).toEqual(expect.objectContaining({
      socPct: 68,
      batteryTempC: 30.8,
      ambientTempC: 22.4,
      pvPowerW: 2500,
      loadPowerW: 1900,
      gridPowerW: 420,
      feedInPowerW: 210,
      observedAtIso: '2026-03-07T10:00:00.000Z',
      deviceSN: 'SN-STATUS'
    }));
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/real/query',
      'POST',
      expect.objectContaining({
        sn: 'SN-STATUS',
        variables: expect.any(Array)
      }),
      { deviceSn: 'SN-STATUS' },
      'u1'
    );
  });

  test('clearSchedule sends disabled scheduler groups through scheduler enable API', async () => {
    const foxessAPI = buildFoxessApi();
    const adapter = createFoxessDeviceAdapter({ foxessAPI });

    await adapter.clearSchedule({
      deviceSN: 'SN-CLEAR',
      groupCount: 10,
      userConfig: { deviceSn: 'SN-CLEAR' },
      userId: 'u2'
    });

    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/enable',
      'POST',
      expect.objectContaining({
        deviceSN: 'SN-CLEAR',
        groups: expect.any(Array)
      }),
      { deviceSn: 'SN-CLEAR' },
      'u2'
    );
    const groups = foxessAPI.callFoxESSAPI.mock.calls[0][2].groups;
    expect(groups).toHaveLength(10);
    expect(groups[0]).toEqual(expect.objectContaining({
      enable: 0,
      workMode: 'SelfUse'
    }));
  });

  test('normalizeProviderError maps rate-limit and auth failures', () => {
    const adapter = createFoxessDeviceAdapter({ foxessAPI: buildFoxessApi() });
    expect(adapter.normalizeProviderError({ errno: 40402 })).toEqual({
      errno: 3201,
      error: 'FoxESS rate limited'
    });
    expect(adapter.normalizeProviderError({ errno: 401 })).toEqual({
      errno: 3202,
      error: 'FoxESS authentication failed'
    });
  });
});
