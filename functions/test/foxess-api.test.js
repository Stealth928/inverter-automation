'use strict';

const { init: initFoxess } = require('../api/foxess');

describe('foxess api module', () => {
  let foxessAPI;
  let mockFetch;
  let mockIncrementApiCount;
  let previousFunctionsEmulator;
  let previousFirestoreEmulatorHost;

  beforeEach(() => {
    previousFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
    previousFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    mockIncrementApiCount = jest.fn(async () => undefined);
    foxessAPI = initFoxess({
      db: {},
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      getConfig: () => ({ foxess: { token: 'token-1', baseUrl: 'https://foxess.test' } }),
      incrementApiCount: mockIncrementApiCount
    });
    foxessAPI.resetCircuitState();
  });

  afterEach(() => {
    if (previousFunctionsEmulator === undefined) {
      delete process.env.FUNCTIONS_EMULATOR;
    } else {
      process.env.FUNCTIONS_EMULATOR = previousFunctionsEmulator;
    }
    if (previousFirestoreEmulatorHost === undefined) {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    } else {
      process.env.FIRESTORE_EMULATOR_HOST = previousFirestoreEmulatorHost;
    }
  });

  test('returns emulator scheduler responses without making network calls', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const result = await foxessAPI.callFoxESSAPI(
      '/op/v1/device/scheduler/enable',
      'POST',
      {
        deviceSN: 'FOX-EMU-1',
        groups: [{ id: 1 }]
      },
      { deviceSn: 'FOX-EMU-1' },
      'user-emu'
    );

    expect(result).toEqual(expect.objectContaining({
      errno: 0,
      msg: expect.stringContaining('emulator mode'),
      result: expect.objectContaining({
        accepted: true,
        deviceSN: 'FOX-EMU-1',
        groups: [{ id: 1 }]
      })
    }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockIncrementApiCount).toHaveBeenCalledWith('user-emu', 'foxess');
  });

  test('counts attempted requests before parsing the response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errno: 40402, msg: 'rate limit' })
    });

    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, {}, 'user-foxess');

    expect(result.errno).toBe(40402);
    expect(mockIncrementApiCount).toHaveBeenCalledWith('user-foxess', 'foxess');
  });

  test('opens the circuit after repeated upstream failures', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable'
    });

    const first = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, {}, 'user-circuit');
    const second = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, {}, 'user-circuit');
    const third = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, {}, 'user-circuit');
    const blocked = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, {}, 'user-circuit');

    expect(first.errno).toBe(503);
    expect(second.errno).toBe(503);
    expect(third.errno).toBe(503);
    expect(blocked).toEqual(expect.objectContaining({
      errno: 503,
      circuitState: 'open'
    }));
    expect(foxessAPI.getCircuitState()).toEqual(expect.objectContaining({
      name: 'foxess',
      state: 'open'
    }));
  });
});