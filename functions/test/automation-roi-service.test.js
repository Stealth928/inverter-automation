'use strict';

const {
  extractHouseLoadWatts,
  findValue,
  normalizeInverterDatas
} = require('../lib/services/automation-roi-service');

describe('automation roi service', () => {
  test('findValue matches exact and includes keys', () => {
    const datas = [
      { variable: 'somethingElse', value: 1 },
      { variable: 'loadsPower', value: 2.5 }
    ];

    expect(findValue(datas, ['loadspower'])).toBe(2.5);
    expect(findValue(datas, ['load'])).toBe(2.5);
  });

  test('normalizeInverterDatas handles frame datas arrays', () => {
    const inverterData = {
      errno: 0,
      result: [
        { datas: [{ variable: 'a', value: 1 }] },
        { datas: [{ variable: 'b', value: 2 }] }
      ]
    };

    expect(normalizeInverterDatas(inverterData)).toEqual([
      { variable: 'a', value: 1 },
      { variable: 'b', value: 2 }
    ]);
  });

  test('extractHouseLoadWatts converts kW payload to watts', () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const inverterData = {
      errno: 0,
      result: [
        { datas: [{ variable: 'loadsPower', value: 2.545 }] }
      ]
    };

    const result = extractHouseLoadWatts(inverterData, logger);

    expect(result).toEqual({ houseLoadW: 2545 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('extractHouseLoadWatts keeps direct watt payload unchanged', () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const inverterData = {
      errno: 0,
      result: [
        { key: 'load_active_power', value: 1320 }
      ]
    };

    const result = extractHouseLoadWatts(inverterData, logger);

    expect(result).toEqual({ houseLoadW: 1320 });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('extractHouseLoadWatts returns null and logs when load is missing', () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const inverterData = {
      errno: 0,
      result: [
        { datas: [{ variable: 'pvPower', value: 2500 }] }
      ]
    };

    const result = extractHouseLoadWatts(inverterData, logger);

    expect(result).toEqual({ houseLoadW: null });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('FAILED to extract house load'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Variables present in data'));
  });

  test('extractHouseLoadWatts logs invalid inverterData inputs', () => {
    const logger = { error: jest.fn(), warn: jest.fn() };

    const result = extractHouseLoadWatts(null, logger);

    expect(result).toEqual({ houseLoadW: null });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('inverterData invalid'));
  });
});
