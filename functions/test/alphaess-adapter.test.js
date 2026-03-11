'use strict';

const {
  AlphaEssDeviceAdapter,
  createAlphaEssDeviceAdapter,
  resolveSystemSn,
  alphaTimeToDisplay
} = require('../lib/adapters/alphaess-adapter');

function buildMockAlphaEssApi(overrides = {}) {
  return {
    callAlphaESSAPI: jest.fn(async () => ({ errno: 0, result: {} })),
    ...overrides
  };
}

function buildAdapter(apiOverrides = {}) {
  return createAlphaEssDeviceAdapter({
    alphaEssAPI: buildMockAlphaEssApi(apiOverrides),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  });
}

const BASE_CONTEXT = {
  systemSn: 'ALPHA-SN-001',
  userConfig: { alphaessSystemSn: 'ALPHA-SN-001', alphaessAppId: 'APP-1' },
  userId: 'user-alpha'
};

describe('alphaess adapter helpers', () => {
  test('resolveSystemSn supports direct and config-driven fields', () => {
    expect(resolveSystemSn({ systemSn: 'SYS-1' })).toBe('SYS-1');
    expect(resolveSystemSn({ userConfig: { alphaessSystemSn: 'SYS-2' } })).toBe('SYS-2');
    expect(resolveSystemSn({ userConfig: { alphaessSysSn: 'SYS-3' } })).toBe('SYS-3');
    expect(resolveSystemSn({ userConfig: { deviceSn: 'SYS-4' } })).toBe('SYS-4');
    expect(resolveSystemSn({})).toBeNull();
  });

  test('alphaTimeToDisplay formats compact timestamps', () => {
    expect(alphaTimeToDisplay('20260311101530')).toBe('2026-03-11 10:15:30');
    expect(alphaTimeToDisplay('2026-03-11T10:15:30Z')).toBe('2026-03-11 10:15:30');
  });
});

describe('AlphaEssDeviceAdapter constructor', () => {
  test('throws when alphaEssAPI is missing', () => {
    expect(() => new AlphaEssDeviceAdapter({})).toThrow(/alphaEssAPI/);
  });

  test('throws when alphaEssAPI lacks callAlphaESSAPI', () => {
    expect(() => new AlphaEssDeviceAdapter({ alphaEssAPI: {} })).toThrow(/callAlphaESSAPI/);
  });
});

describe('alphaess device adapter', () => {
  test('getStatus returns normalized power shape', async () => {
    const mockCall = jest.fn(async () => ({
      errno: 0,
      result: {
        soc: 76,
        batTemp: 29.5,
        temp: 23.1,
        ppv: 4200,
        pload: 1800,
        pgrid: -650,
        pbat: 1200
      }
    }));
    const adapter = createAlphaEssDeviceAdapter({
      alphaEssAPI: { callAlphaESSAPI: mockCall }
    });

    const status = await adapter.getStatus({
      ...BASE_CONTEXT,
      observedAtIso: '2026-03-11T09:00:00.000Z'
    });

    expect(status).toEqual(expect.objectContaining({
      socPct: 76,
      batteryTempC: 29.5,
      ambientTempC: 23.1,
      pvPowerW: 4200,
      loadPowerW: 1800,
      gridPowerW: 0,
      feedInPowerW: 650,
      batteryPowerW: 1200,
      observedAtIso: '2026-03-11T09:00:00.000Z',
      deviceSN: 'ALPHA-SN-001'
    }));
    expect(mockCall).toHaveBeenCalledWith(
      '/api/getLastPowerData',
      'GET',
      { sysSn: 'ALPHA-SN-001' },
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('getSchedule maps AlphaESS charge/discharge windows to groups', async () => {
    const mockCall = jest.fn(async (path) => {
      if (path === '/api/getChargeConfigInfo') {
        return {
          errno: 0,
          result: {
            gridCharge: 1,
            batHighCap: 95,
            timeChaf1: '01:30',
            timeChae1: '03:45',
            timeChaf2: '00:00',
            timeChae2: '00:00'
          }
        };
      }
      if (path === '/api/getDisChargeConfigInfo') {
        return {
          errno: 0,
          result: {
            ctrDis: 1,
            batUseCap: 20,
            timeDisf1: '18:00',
            timeDise1: '21:15',
            timeDisf2: '00:00',
            timeDise2: '00:00'
          }
        };
      }
      return { errno: 0, result: {} };
    });

    const adapter = createAlphaEssDeviceAdapter({
      alphaEssAPI: { callAlphaESSAPI: mockCall }
    });

    const result = await adapter.getSchedule(BASE_CONTEXT);
    expect(result.errno).toBe(0);
    expect(result.result.enable).toBe(true);
    expect(result.result.groups).toHaveLength(8);

    const chargeGroup = result.result.groups[0];
    expect(chargeGroup.enable).toBe(1);
    expect(chargeGroup.workMode).toBe('ForceCharge');
    expect(chargeGroup.startHour).toBe(1);
    expect(chargeGroup.startMinute).toBe(30);

    const dischargeGroup = result.result.groups[2];
    expect(dischargeGroup.enable).toBe(1);
    expect(dischargeGroup.workMode).toBe('ForceDischarge');
    expect(dischargeGroup.startHour).toBe(18);
    expect(dischargeGroup.endHour).toBe(21);
  });

  test('setSchedule translates groups and updates both AlphaESS endpoints', async () => {
    const mockCall = jest.fn(async (path, method, params) => {
      if (path === '/api/getChargeConfigInfo') {
        return { errno: 0, result: { batHighCap: 90, gridCharge: 0 } };
      }
      if (path === '/api/getDisChargeConfigInfo') {
        return { errno: 0, result: { batUseCap: 15, ctrDis: 0 } };
      }
      if (path === '/api/updateChargeConfigInfo') {
        expect(method).toBe('POST');
        expect(params).toEqual(expect.objectContaining({
          sysSn: 'ALPHA-SN-001',
          gridCharge: 1,
          timeChaf1: '02:00',
          timeChae1: '04:00'
        }));
        return { errno: 0, result: { ok: true } };
      }
      if (path === '/api/updateDisChargeConfigInfo') {
        expect(method).toBe('POST');
        expect(params).toEqual(expect.objectContaining({
          sysSn: 'ALPHA-SN-001',
          ctrDis: 1,
          timeDisf1: '19:15',
          timeDise1: '21:45'
        }));
        return { errno: 0, result: { ok: true } };
      }
      return { errno: 0, result: {} };
    });

    const adapter = createAlphaEssDeviceAdapter({
      alphaEssAPI: { callAlphaESSAPI: mockCall }
    });

    const result = await adapter.setSchedule(BASE_CONTEXT, [
      {
        enable: 1,
        workMode: 'ForceCharge',
        startHour: 2,
        startMinute: 0,
        endHour: 4,
        endMinute: 0,
        maxSoc: 92
      },
      {
        enable: 1,
        workMode: 'ForceDischarge',
        startHour: 19,
        startMinute: 15,
        endHour: 21,
        endMinute: 45,
        fdSoc: 20
      }
    ]);

    expect(result.errno).toBe(0);
    expect(mockCall).toHaveBeenCalledWith(
      '/api/updateChargeConfigInfo',
      'POST',
      expect.any(Object),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
    expect(mockCall).toHaveBeenCalledWith(
      '/api/updateDisChargeConfigInfo',
      'POST',
      expect.any(Object),
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('getHistory rejects windows longer than 7 days', async () => {
    const adapter = buildAdapter();
    const now = Date.now();
    const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);
    const result = await adapter.getHistory(BASE_CONTEXT, eightDaysAgo, now);

    expect(result.errno).toBe(3500);
    expect(String(result.error).toLowerCase()).toContain('7 days');
  });

  test('getHistory maps one day power rows to chart variables', async () => {
    const mockCall = jest.fn(async (path) => {
      if (path === '/api/getOneDayPowerBySn') {
        return {
          errno: 0,
          result: [{
            uploadTime: '20260311103000',
            ppv: 2100,
            pload: 1400,
            pgrid: -500,
            pbat: 300
          }]
        };
      }
      return { errno: 0, result: {} };
    });
    const adapter = createAlphaEssDeviceAdapter({
      alphaEssAPI: { callAlphaESSAPI: mockCall }
    });

    const date = Date.UTC(2026, 2, 11, 0, 0, 0);
    const result = await adapter.getHistory(BASE_CONTEXT, date, date + 60 * 1000, []);

    expect(result.errno).toBe(0);
    const frame = result.result[0];
    expect(frame.deviceSN).toBe('ALPHA-SN-001');
    const vars = frame.datas.map((d) => d.variable);
    expect(vars).toEqual(expect.arrayContaining([
      'generationPower',
      'loadsPower',
      'feedinPower',
      'batteryPower'
    ]));
  });

  test('getGeneration returns canonical totals', async () => {
    const mockCall = jest.fn(async () => ({
      errno: 0,
      result: {
        epvToday: 12.3456,
        epvMonth: 111.2222,
        epvYear: 999.8888,
        epvTotal: 5432.1234
      }
    }));
    const adapter = createAlphaEssDeviceAdapter({
      alphaEssAPI: { callAlphaESSAPI: mockCall }
    });

    const result = await adapter.getGeneration(BASE_CONTEXT);
    expect(result.errno).toBe(0);
    expect(result.result).toEqual({
      today: 12.346,
      month: 111.222,
      year: 999.889,
      cumulative: 5432.123,
      yearGeneration: 999.889
    });
  });

  test('setWorkMode returns unsupported response envelope', async () => {
    const adapter = buildAdapter();
    const result = await adapter.setWorkMode(BASE_CONTEXT, 'SelfUse');
    expect(result.errno).toBe(3500);
    expect(String(result.error).toLowerCase()).toContain('not directly supported');
  });
});
