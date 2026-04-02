'use strict';

const {
  findVariableData,
  getInverterDatas,
  getVariableValue,
  parseAutomationTelemetry
} = require('../lib/device-telemetry');

describe('device telemetry normalization helpers', () => {
  test('getInverterDatas returns empty array when payload is missing', () => {
    expect(getInverterDatas(null)).toEqual([]);
    expect(getInverterDatas({})).toEqual([]);
    expect(getInverterDatas({ result: [] })).toEqual([]);
  });

  test('findVariableData returns first matching alias entry', () => {
    const datas = [
      { variable: 'pvPower', value: 1800 },
      { variable: 'SoC_1', value: 72 },
      { variable: 'SoC1', value: 70 }
    ];

    const entry = findVariableData(datas, ['SoC', 'SoC1', 'SoC_1']);
    expect(entry).toEqual({ variable: 'SoC1', value: 70 });
  });

  test('getVariableValue returns fallback when alias is not present', () => {
    const datas = [{ variable: 'pvPower', value: 900 }];
    expect(getVariableValue(datas, ['SoC', 'SoC1'], null)).toBeNull();
    expect(getVariableValue(datas, ['SoC', 'SoC1'], 50)).toBe(50);
  });

  test('parseAutomationTelemetry resolves current known aliases', () => {
    const inverterData = {
      result: [{
        datas: [
          { variable: 'SoC_1', value: 61 },
          { variable: 'batTemperature_1', value: 30.4 },
          { variable: 'ambientTemperation', value: 25.1 }
        ]
      }]
    };

    expect(parseAutomationTelemetry(inverterData)).toEqual({
      soc: 61,
      batTemp: 30.4,
      ambientTemp: 25.1,
      inverterTemp: null
    });
  });

  test('parseAutomationTelemetry supports corrected ambientTemperature key', () => {
    const inverterData = {
      result: [{
        datas: [
          { variable: 'SoC', value: 88 },
          { variable: 'batTemperature', value: 28.7 },
          { variable: 'ambientTemperature', value: 22.5 }
        ]
      }]
    };

    expect(parseAutomationTelemetry(inverterData)).toEqual({
      soc: 88,
      batTemp: 28.7,
      ambientTemp: 22.5,
      inverterTemp: null
    });
  });

  test('parseAutomationTelemetry resolves inverter temperature aliases', () => {
    const inverterData = {
      result: [{
        datas: [
          { variable: 'SoC', value: 54 },
          { variable: 'batTemperature', value: 27.4 },
          { variable: 'ambientTemperation', value: 21.9 },
          { variable: 'invTemperation', value: 38.6 }
        ]
      }]
    };

    expect(parseAutomationTelemetry(inverterData)).toEqual({
      soc: 54,
      batTemp: 27.4,
      ambientTemp: 21.9,
      inverterTemp: 38.6
    });
  });
});
