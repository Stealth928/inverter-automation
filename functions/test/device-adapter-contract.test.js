'use strict';

const {
  DEVICE_VARIABLE_ALIASES,
  DeviceAdapter,
  extractDatasFrame,
  findVariableData,
  getNumericVariableValue,
  normalizeDeviceStatusPayload,
  validateDeviceAdapter
} = require('../lib/adapters/device-adapter');

describe('device adapter contract helpers', () => {
  test('extractDatasFrame supports nested result payload shape', () => {
    expect(extractDatasFrame({ result: [{ datas: [{ variable: 'SoC', value: 67 }] }] })).toEqual([
      { variable: 'SoC', value: 67 }
    ]);
    expect(extractDatasFrame({})).toEqual([]);
  });

  test('findVariableData resolves canonical aliases', () => {
    const datas = [
      { variable: 'SoC_1', value: 54 },
      { variable: 'pvPower', value: 2100 }
    ];

    expect(findVariableData(datas, DEVICE_VARIABLE_ALIASES.socPct)).toEqual({
      variable: 'SoC_1',
      value: 54
    });
    expect(findVariableData(datas, ['unknown'])).toBeNull();
  });

  test('getNumericVariableValue returns fallback for non-numeric values', () => {
    const datas = [
      { variable: 'loadPower', value: '1000' },
      { variable: 'gridPower', value: 'not-a-number' }
    ];

    expect(getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.loadPowerW)).toBe(1000);
    expect(getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.gridPowerW, null)).toBeNull();
  });

  test('normalizeDeviceStatusPayload maps known telemetry aliases', () => {
    const payload = {
      result: [{
        datas: [
          { variable: 'SoC1', value: 71 },
          { variable: 'batTemperature_1', value: 31.2 },
          { variable: 'ambientTemperation', value: 23.6 },
          { variable: 'pv_power', value: 2200 },
          { variable: 'load_power', value: 1800 },
          { variable: 'gridPower', value: -300 },
          { variable: 'feedInPower', value: 450 }
        ]
      }]
    };

    expect(normalizeDeviceStatusPayload(payload, '2026-03-07T12:00:00.000Z')).toEqual({
      socPct: 71,
      batteryTempC: 31.2,
      ambientTempC: 23.6,
      pvPowerW: 2200,
      loadPowerW: 1800,
      gridPowerW: -300,
      feedInPowerW: 450,
      observedAtIso: '2026-03-07T12:00:00.000Z'
    });
  });

  test('validateDeviceAdapter enforces required contract methods', () => {
    expect(() => validateDeviceAdapter({ getStatus() {} })).toThrow(/missing required methods/i);

    class DemoDeviceAdapter extends DeviceAdapter {
      async getStatus() { return {}; }
      async getCapabilities() { return {}; }
      async getSchedule() { return {}; }
      async setSchedule() { return {}; }
      async clearSchedule() { return {}; }
      async getWorkMode() { return {}; }
      async setWorkMode() { return {}; }
      normalizeProviderError(error) { return { errno: 3400, error: error.message }; }
    }

    expect(validateDeviceAdapter(new DemoDeviceAdapter())).toBe(true);
  });
});
