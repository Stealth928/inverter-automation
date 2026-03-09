'use strict';

/**
 * Tests for functions/lib/adapters/sigenergy-adapter.js
 *
 * Covers:
 *   - Constructor guard (requires sigenEnergyAPI with callSigenEnergyAPI)
 *   - getCapabilities contract
 *   - getStatus (energy flow mapping + stub emulated response)
 *   - getWorkMode (mode integer → canonical name)
 *   - setWorkMode (canonical name → mode integer, unsupported mode rejection)
 *   - getSchedule / setSchedule / clearSchedule stubs
 *   - getHistory / getReport / getGeneration null returns
 *   - normalizeProviderError errno mapping
 */

const {
  SigenEnergyDeviceAdapter,
  createSigenEnergyDeviceAdapter,
  WORK_MODE_TO_SIGENERGY,
  SIGENERGY_TO_WORK_MODE,
  normalizeEnergyFlow,
  resolveStationId
} = require('../lib/adapters/sigenergy-adapter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockAPI(overrides = {}) {
  return {
    callSigenEnergyAPI: jest.fn(async () => ({ errno: 0, result: {} })),
    loginSigenergy:     jest.fn(async () => ({ errno: 0, result: { accessToken: 'tok' } })),
    ...overrides
  };
}

function buildAdapter(apiOverrides = {}) {
  return createSigenEnergyDeviceAdapter({
    sigenEnergyAPI: buildMockAPI(apiOverrides),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  });
}

const BASE_CONTEXT = {
  userConfig: { sigenUsername: 'u@example.com', sigenPassword: 'pass', sigenRegion: 'apac', sigenStationId: 'STA001' },
  userId: 'user1',
  stationId: 'STA001'
};

// ---------------------------------------------------------------------------
// Constructor guard
// ---------------------------------------------------------------------------

describe('SigenEnergyDeviceAdapter constructor', () => {
  test('throws when sigenEnergyAPI is missing', () => {
    expect(() => new SigenEnergyDeviceAdapter({})).toThrow(/sigenEnergyAPI/);
  });

  test('throws when callSigenEnergyAPI is not a function', () => {
    expect(() => new SigenEnergyDeviceAdapter({ sigenEnergyAPI: { callSigenEnergyAPI: 'not-a-fn' } }))
      .toThrow(/callSigenEnergyAPI/);
  });

  test('createSigenEnergyDeviceAdapter factory works', () => {
    const adapter = buildAdapter();
    expect(adapter).toBeInstanceOf(SigenEnergyDeviceAdapter);
  });
});

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

describe('getCapabilities', () => {
  test('scheduler is false (TOU not yet implemented)', async () => {
    const caps = await buildAdapter().getCapabilities();
    expect(caps.scheduler).toBe(false);
  });

  test('workMode is true', async () => {
    const caps = await buildAdapter().getCapabilities();
    expect(caps.workMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  test('throws when stationId is not available', async () => {
    await expect(buildAdapter().getStatus({ userConfig: {}, userId: 'u1' }))
      .rejects.toThrow(/stationId/);
  });

  test('calls energyflow endpoint with correct stationId query param', async () => {
    const mockCall = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({ callSigenEnergyAPI: mockCall }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    await adapter.getStatus(BASE_CONTEXT);

    expect(mockCall).toHaveBeenCalledWith(
      'GET',
      'device/sigen/station/energyflow',
      { id: 'STA001' },
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('returns canonical status shape on emulated response', async () => {
    const mockCall = jest.fn(async () => ({
      errno: 0,
      result: { _emulated: true }
    }));
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({ callSigenEnergyAPI: mockCall }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    const status = await adapter.getStatus(BASE_CONTEXT);
    // Should have canonical fields (even if null from emulated response)
    expect(status).toHaveProperty('socPct');
    expect(status).toHaveProperty('pvPowerW');
    expect(status).toHaveProperty('gridPowerW');
    expect(status).toHaveProperty('batteryPowerW');
    expect(status).toHaveProperty('observedAtIso');
  });

  test('propagates adapter error when callSigenEnergyAPI returns non-zero errno', async () => {
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({
        callSigenEnergyAPI: jest.fn(async () => ({ errno: 3401, error: 'Token expired' }))
      }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    await expect(adapter.getStatus(BASE_CONTEXT)).rejects.toMatchObject({ errno: 3401 });
  });
});

// ---------------------------------------------------------------------------
// normalizeEnergyFlow helper
// ---------------------------------------------------------------------------

describe('normalizeEnergyFlow', () => {
  test('returns null-filled shape for null/empty input', () => {
    const result = normalizeEnergyFlow(null, '2025-01-01T00:00:00.000Z', 'STA001');
    expect(result.socPct).toBeNull();
    expect(result.pvPowerW).toBeNull();
    expect(result.observedAtIso).toBe('2025-01-01T00:00:00.000Z');
    expect(result.deviceSN).toBe('STA001');
  });

  test('derives gridPowerW from positive gridPower (importing)', () => {
    const result = normalizeEnergyFlow({ gridPower: 500, pvPower: 200, batterySoc: 80 });
    expect(result.gridPowerW).toBe(500);
    expect(result.feedInPowerW).toBe(0);
  });

  test('derives feedInPowerW from negative gridPower (exporting)', () => {
    const result = normalizeEnergyFlow({ gridPower: -300 });
    expect(result.feedInPowerW).toBe(300);
    expect(result.gridPowerW).toBe(0);
  });

  test('maps pvPower / batterySoc / battPower fields', () => {
    const result = normalizeEnergyFlow({ pvPower: 1200, batterySoc: 72, battPower: -500, loadPower: 700 });
    expect(result.pvPowerW).toBe(1200);
    expect(result.socPct).toBe(72);
    expect(result.batteryPowerW).toBe(-500);
    expect(result.loadPowerW).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// getWorkMode
// ---------------------------------------------------------------------------

describe('getWorkMode', () => {
  test('throws when stationId is missing', async () => {
    await expect(buildAdapter().getWorkMode({})).rejects.toThrow(/stationId/);
  });

  test('maps currentMode 0 → SelfUse', async () => {
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({
        callSigenEnergyAPI: jest.fn(async () => ({
          errno: 0,
          result: { currentMode: 0 }
        }))
      }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    const result = await adapter.getWorkMode(BASE_CONTEXT);
    expect(result.errno).toBe(0);
    expect(result.result.workMode).toBe('SelfUse');
    expect(result.result.raw).toBe(0);
  });

  test('maps currentMode 5 → Feedin', async () => {
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({
        callSigenEnergyAPI: jest.fn(async () => ({
          errno: 0,
          result: { currentMode: 5 }
        }))
      }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    const result = await adapter.getWorkMode(BASE_CONTEXT);
    expect(result.result.workMode).toBe('Feedin');
  });

  test('falls back to SelfUse for unknown mode integer', async () => {
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({
        callSigenEnergyAPI: jest.fn(async () => ({
          errno: 0,
          result: { currentMode: 99 }
        }))
      }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    const result = await adapter.getWorkMode(BASE_CONTEXT);
    expect(result.result.workMode).toBe('SelfUse');
  });
});

// ---------------------------------------------------------------------------
// setWorkMode
// ---------------------------------------------------------------------------

describe('setWorkMode', () => {
  test('throws when stationId is missing', async () => {
    await expect(buildAdapter().setWorkMode({}, 'SelfUse')).rejects.toThrow(/stationId/);
  });

  test('throws for unsupported mode (ForceCharge)', async () => {
    await expect(buildAdapter().setWorkMode(BASE_CONTEXT, 'ForceCharge'))
      .rejects.toThrow(/ForceCharge/);
  });

  test('sends PUT with operationMode 0 for SelfUse', async () => {
    const mockCall = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({ callSigenEnergyAPI: mockCall }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    await adapter.setWorkMode(BASE_CONTEXT, 'SelfUse');

    expect(mockCall).toHaveBeenCalledWith(
      'PUT',
      'device/energy-profile/mode',
      { stationId: 'STA001', operationMode: 0, profileId: -1 },
      BASE_CONTEXT.userConfig,
      BASE_CONTEXT.userId
    );
  });

  test('sends PUT with operationMode 5 for Feedin', async () => {
    const mockCall = jest.fn(async () => ({ errno: 0, result: {} }));
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({ callSigenEnergyAPI: mockCall }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    await adapter.setWorkMode(BASE_CONTEXT, 'Feedin');

    const callArgs = mockCall.mock.calls[0];
    expect(callArgs[2].operationMode).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Stubs: getSchedule / setSchedule / clearSchedule
// ---------------------------------------------------------------------------

describe('schedule stubs', () => {
  test('getSchedule returns empty stub without calling API', async () => {
    const mockCall = jest.fn();
    const adapter = createSigenEnergyDeviceAdapter({
      sigenEnergyAPI: buildMockAPI({ callSigenEnergyAPI: mockCall }),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });

    const result = await adapter.getSchedule(BASE_CONTEXT);
    expect(result.errno).toBe(0);
    expect(result.result._stub).toBe(true);
    expect(result.result.groups).toEqual([]);
    expect(mockCall).not.toHaveBeenCalled();
  });

  test('setSchedule returns no-op stub', async () => {
    const result = await buildAdapter().setSchedule(BASE_CONTEXT, [{ foo: 'bar' }]);
    expect(result.errno).toBe(0);
    expect(result.result._stub).toBe(true);
  });

  test('clearSchedule delegates to setSchedule stub', async () => {
    const result = await buildAdapter().clearSchedule(BASE_CONTEXT);
    expect(result.errno).toBe(0);
    expect(result.result._stub).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// null returns for history / report / generation
// ---------------------------------------------------------------------------

describe('history/report/generation — null returns', () => {
  test('getHistory returns null', async () => {
    expect(await buildAdapter().getHistory(BASE_CONTEXT)).toBeNull();
  });

  test('getReport returns null', async () => {
    expect(await buildAdapter().getReport(BASE_CONTEXT)).toBeNull();
  });

  test('getGeneration returns null', async () => {
    expect(await buildAdapter().getGeneration(BASE_CONTEXT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeProviderError
// ---------------------------------------------------------------------------

describe('normalizeProviderError', () => {
  const adapter = buildAdapter();

  test.each([
    [3401, 3401],
    [3402, 3402],
    [3403, 3403],
    [3404, 3404],
    [3405, 3405],
    [9999, 3400]  // unknown → generic 3400
  ])('errno %i → normalized errno %i', (input, expected) => {
    const result = adapter.normalizeProviderError({ errno: input });
    expect(result.errno).toBe(expected);
  });

  test('passes through error message', () => {
    const result = adapter.normalizeProviderError({ errno: 3401, error: 'Token invalid' });
    expect(result.error).toBe('Token invalid');
  });
});

// ---------------------------------------------------------------------------
// Work mode mapping constants
// ---------------------------------------------------------------------------

describe('work mode constants', () => {
  test('WORK_MODE_TO_SIGENERGY covers SelfUse and Feedin', () => {
    expect(WORK_MODE_TO_SIGENERGY.SelfUse).toBe(0);
    expect(WORK_MODE_TO_SIGENERGY.Feedin).toBe(5);
  });

  test('SIGENERGY_TO_WORK_MODE covers 0 and 5', () => {
    expect(SIGENERGY_TO_WORK_MODE[0]).toBe('SelfUse');
    expect(SIGENERGY_TO_WORK_MODE[5]).toBe('Feedin');
  });
});

// ---------------------------------------------------------------------------
// resolveStationId helper
// ---------------------------------------------------------------------------

describe('resolveStationId', () => {
  test('picks up stationId from context directly', () => {
    expect(resolveStationId({ stationId: 'ABC' })).toBe('ABC');
  });

  test('falls back to userConfig.sigenStationId', () => {
    expect(resolveStationId({ userConfig: { sigenStationId: 'XYZ' } })).toBe('XYZ');
  });

  test('returns null when nothing is set', () => {
    expect(resolveStationId({})).toBeNull();
  });
});
