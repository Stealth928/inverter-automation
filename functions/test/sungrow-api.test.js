'use strict';

/**
 * Tests for functions/api/sungrow.js
 * Covers sign generation, response normalization, loginSungrow paths, and
 * callSungrowAPI caching + error mapping.
 */

// We exercise the module internals through the exported init() API.
// fetch is mocked globally to intercept HTTP calls.

const { init: initSungrow } = require('../api/sungrow');

// ---------------------------------------------------------------------------
// Re-export helpers we can reach by calling init() twice (sign + md5 are
// returned even though they are also used internally).
// ---------------------------------------------------------------------------

let sungrowAPI;
let mockFetch;
let mockDb;
let mockGetConfig;
let mockIncrementApiCount;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;

  // Minimal Firestore mock
  mockDb = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            set: jest.fn(async () => undefined)
          }))
        }))
      }))
    }))
  };

  mockGetConfig = jest.fn(() => ({
    sungrow: {
      appKey: 'TESTKEY',
      appSecret: 'TESTSECRET',
      baseUrl: 'https://augateway.test'
    }
  }));

  mockIncrementApiCount = jest.fn(async () => undefined);

  sungrowAPI = initSungrow({
    db: mockDb,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    getConfig: mockGetConfig,
    incrementApiCount: mockIncrementApiCount
  });
  sungrowAPI.resetCircuitState();
});

afterEach(() => {
  delete process.env.FUNCTIONS_EMULATOR;
  delete process.env.FIRESTORE_EMULATOR_HOST;
});

// ---------------------------------------------------------------------------
// generateSungrowSign
// ---------------------------------------------------------------------------

describe('generateSungrowSign', () => {
  test('produces a 32-character hex MD5 string', () => {
    const sign = sungrowAPI.generateSungrowSign('KEY', 'SECRET', new Date('2025-01-15'));
    expect(typeof sign).toBe('string');
    expect(sign).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(sign)).toBe(true);
  });

  test('includes the date in the signed payload (different dates → different signs)', () => {
    const s1 = sungrowAPI.generateSungrowSign('KEY', 'SECRET', new Date('2025-01-15'));
    const s2 = sungrowAPI.generateSungrowSign('KEY', 'SECRET', new Date('2025-01-16'));
    expect(s1).not.toBe(s2);
  });

  test('is deterministic', () => {
    const d = new Date('2025-06-01');
    const sign1 = sungrowAPI.generateSungrowSign('K1', 'S1', d);
    const sign2 = sungrowAPI.generateSungrowSign('K1', 'S1', d);
    expect(sign1).toBe(sign2);
  });
});

// ---------------------------------------------------------------------------
// normalizeResponse (via callSungrowAPI path)
// ---------------------------------------------------------------------------

describe('callSungrowAPI — response normalization', () => {
  test('maps result_code "1" → errno 0', async () => {
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({
        result_code: '1',
        result_data: { device_list: [] }
      })
    });

    const result = await sungrowAPI.callSungrowAPI(
      'queryDeviceListByTokenAndType',
      { device_type: '22' },
      { sungrowToken: 'tok', sungrowUid: 'uid1', sungrowTokenExpiry: Date.now() + 60000 },
      'user123'
    );

    expect(result.errno).toBe(0);
    expect(result.result).toEqual({ device_list: [] });
  });

  test('maps unknown error code → errno 3300', async () => {
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({
        result_code: 'NOMAP',
        result_msg: 'Unknown error'
      })
    });

    const result = await sungrowAPI.callSungrowAPI(
      'queryDeviceListByTokenAndType',
      {},
      { sungrowToken: 'tok', sungrowUid: 'uid1', sungrowTokenExpiry: Date.now() + 60000 },
      null
    );

    expect(result.errno).toBe(3300);
    expect(result.error).toBe('Unknown error');
  });

  test('token expired code maps → errno 3301', async () => {
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({ result_code: '10011', result_msg: 'Token expired' })
    });

    const result = await sungrowAPI.callSungrowAPI(
      'queryDeviceListByTokenAndType',
      {},
      { sungrowToken: 'tok', sungrowUid: 'uid1', sungrowTokenExpiry: Date.now() + 60000 },
      null
    );

    expect(result.errno).toBe(3301);
  });

  test('returns errno 3302 when app credentials are missing', async () => {
    mockGetConfig.mockReturnValueOnce({ sungrow: { appKey: '', appSecret: '', baseUrl: '' } });

    const result = await sungrowAPI.callSungrowAPI('anyService', {}, {}, null);
    expect(result.errno).toBe(3302);
    expect(result.error).toMatch(/app credentials/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns emulated response in emulator mode (non-connect service)', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const result = await sungrowAPI.callSungrowAPI(
      'queryRealTimeDataByTokenAndType',
      {},
      {},
      null
    );

    expect(result.errno).toBe(0);
    expect(result.result._emulated).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns errno 408 on request timeout (AbortError)', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortErr);

    const result = await sungrowAPI.callSungrowAPI(
      'queryDeviceListByTokenAndType',
      {},
      { sungrowToken: 't', sungrowUid: 'u', sungrowTokenExpiry: Date.now() + 99999 },
      null
    );

    expect(result.errno).toBe(408);
  });

  test('opens the circuit after repeated upstream server failures', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable'
    });

    const userConfig = {
      sungrowToken: 'tok',
      sungrowUid: 'uid1',
      sungrowTokenExpiry: Date.now() + 60000
    };

    const first = await sungrowAPI.callSungrowAPI('queryDeviceListByTokenAndType', {}, userConfig, 'user-circuit');
    const second = await sungrowAPI.callSungrowAPI('queryDeviceListByTokenAndType', {}, userConfig, 'user-circuit');
    const third = await sungrowAPI.callSungrowAPI('queryDeviceListByTokenAndType', {}, userConfig, 'user-circuit');
    const blocked = await sungrowAPI.callSungrowAPI('queryDeviceListByTokenAndType', {}, userConfig, 'user-circuit');

    expect(first.errno).toBe(503);
    expect(second.errno).toBe(503);
    expect(third.errno).toBe(503);
    expect(blocked).toEqual(expect.objectContaining({
      errno: 503,
      circuitState: 'open'
    }));
    expect(sungrowAPI.getCircuitState()).toEqual(expect.objectContaining({
      name: 'sungrow',
      state: 'open'
    }));
  });

  test('auto-triggers loginSungrow when token is expired', async () => {
    // First call = loginSungrow (connect service)
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({
        result_code: '1',
        result_data: { token: 'new_tok', uid: 'u99', expire_sec: 7200 }
      })
    });
    // Second call = the actual service
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({ result_code: '1', result_data: { ok: true } })
    });

    const result = await sungrowAPI.callSungrowAPI(
      'queryDeviceListByTokenAndType',
      {},
      {
        sungrowUsername: 'test@example.com',
        sungrowPassword: 'pass',
        sungrowToken: '',          // no token → force login
        sungrowTokenExpiry: 0
      },
      'uid1'
    );

    expect(result.errno).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // First fetch must be the login endpoint
    const firstCall = mockFetch.mock.calls[0];
    const firstBody = JSON.parse(firstCall[1].body);
    expect(firstBody.service).toBe('connect');
  });
});

// ---------------------------------------------------------------------------
// loginSungrow
// ---------------------------------------------------------------------------

describe('loginSungrow', () => {
  test('returns errno 3302 when credentials are missing', async () => {
    const result = await sungrowAPI.loginSungrow({}, null, null);
    expect(result.errno).toBe(3302);
    expect(result.error).toMatch(/username and password/i);
  });

  test('returns token on successful login', async () => {
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({
        result_code: '1',
        result_data: { token: 'abc123', uid: 'u1', expire_sec: 7200 }
      })
    });

    const result = await sungrowAPI.loginSungrow(
      { sungrowUsername: 'user@example.com', sungrowPassword: 'pw' },
      mockDb,
      'uid1'
    );

    expect(result.errno).toBe(0);
    expect(result.result.token).toBe('abc123');
    expect(result.result.uid).toBe('u1');
    expect(typeof result.result.expiryMs).toBe('number');
    expect(result.result.expiryMs).toBeGreaterThan(Date.now());
  });

  test('persists token to Firestore when db and userId provided', async () => {
    const setMock = jest.fn(async () => undefined);
    const dbWithSet = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({ set: setMock }))
          }))
        }))
      }))
    };

    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({
        result_code: '1',
        result_data: { token: 'tok42', uid: 'u2', expire_sec: 3600 }
      })
    });

    await sungrowAPI.loginSungrow(
      { sungrowUsername: 'user@x.com', sungrowPassword: 'secret' },
      dbWithSet,
      'uid99'
    );

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok42', uid: 'u2' }),
      { merge: false }
    );
  });

  test('propagates upstream error on failed login', async () => {
    mockFetch.mockResolvedValueOnce({
      text: async () => JSON.stringify({
        result_code: '10007',
        result_msg: 'Bad credentials'
      })
    });

    const result = await sungrowAPI.loginSungrow(
      { sungrowUsername: 'bad@x.com', sungrowPassword: 'wrong' },
      null,
      null
    );

    expect(result.errno).toBe(3302);
  });
});
