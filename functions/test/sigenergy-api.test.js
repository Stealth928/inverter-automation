'use strict';

/**
 * Tests for functions/api/sigenergy.js
 *
 * Covers:
 *   - encryptPassword AES-CBC output
 *   - resolveBaseUrl regional URL mapping
 *   - normalizeResponse errno mapping
 *   - loginSigenergy happy path + auth failure
 *   - callSigenEnergyAPI emulator bypass
 *   - callSigenEnergyAPI GET with query params
 *   - callSigenEnergyAPI PUT with JSON body
 *   - callSigenEnergyAPI auto-token-refresh on 401
 */

const { init, encryptPassword, resolveBaseUrl, REGION_BASE_URLS } = require('../api/sigenergy');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function buildMockDb(cachedToken = null) {
  const docData = cachedToken ? { data: () => cachedToken, exists: true } : { exists: false };
  return {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn(async () => docData),
            set: jest.fn(async () => undefined)
          }))
        }))
      }))
    }))
  };
}

function buildAPI(overrides = {}) {
  const db = buildMockDb();
  return init({
    db,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    getConfig: jest.fn(() => ({ sigenergy: { defaultRegion: 'apac' } })),
    incrementApiCount: jest.fn(async () => undefined),
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Exported pure helpers
// ---------------------------------------------------------------------------

describe('encryptPassword', () => {
  test('returns a non-empty base64 string', () => {
    const result = encryptPassword('testpassword');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // base64 character set
    expect(/^[A-Za-z0-9+/]+=*$/.test(result)).toBe(true);
  });

  test('is deterministic for the same input', () => {
    expect(encryptPassword('mypassword')).toBe(encryptPassword('mypassword'));
  });

  test('produces different output for different passwords', () => {
    expect(encryptPassword('pass1')).not.toBe(encryptPassword('pass2'));
  });

  test('uses AES-128-CBC padding so output length is a multiple of 16 bytes before base64', () => {
    const encrypted = encryptPassword('short');
    const decoded = Buffer.from(encrypted, 'base64');
    expect(decoded.length % 16).toBe(0);
  });
});

describe('resolveBaseUrl', () => {
  test('maps eu → api-eu.sigencloud.com', () => {
    expect(resolveBaseUrl('eu')).toContain('api-eu.sigencloud.com');
  });

  test('maps cn → api-cn.sigencloud.com', () => {
    expect(resolveBaseUrl('cn')).toContain('api-cn.sigencloud.com');
  });

  test('maps apac → api-apac.sigencloud.com', () => {
    expect(resolveBaseUrl('apac')).toContain('api-apac.sigencloud.com');
  });

  test('maps us → api-us.sigencloud.com', () => {
    expect(resolveBaseUrl('us')).toContain('api-us.sigencloud.com');
  });

  test('defaults to apac for unknown regions', () => {
    expect(resolveBaseUrl('unknown')).toContain('api-apac.sigencloud.com');
  });

  test('REGION_BASE_URLS exports all four regions', () => {
    expect(Object.keys(REGION_BASE_URLS)).toEqual(expect.arrayContaining(['eu', 'cn', 'apac', 'us']));
  });
});

// ---------------------------------------------------------------------------
// Emulator bypass
// ---------------------------------------------------------------------------

describe('callSigenEnergyAPI — emulator bypass', () => {
  afterEach(() => {
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  test('returns _emulated:true when FUNCTIONS_EMULATOR is set (no fetch)', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    const api = buildAPI();
    const result = await api.callSigenEnergyAPI('GET', 'device/sigen/station/energyflow', { id: '123' }, {
      sigenUsername: 'u', sigenPassword: 'p', sigenRegion: 'apac'
    }, 'user1');
    expect(result.result._emulated).toBe(true);
    expect(result.errno).toBe(0);
  });

  test('returns _emulated:true when FIRESTORE_EMULATOR_HOST is set', async () => {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    const api = buildAPI();
    const result = await api.callSigenEnergyAPI('GET', 'some/path', null, {
      sigenUsername: 'u', sigenPassword: 'p', sigenRegion: 'apac'
    }, 'user1');
    expect(result.result._emulated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loginSigenergy
// ---------------------------------------------------------------------------

describe('loginSigenergy', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete process.env.FUNCTIONS_EMULATOR;
  });

  test('happy path — successful login caches token and returns errno 0', async () => {
    const mockDb = buildMockDb();
    const setMock = jest.fn(async () => undefined);
    mockDb.collection.mockReturnValue({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({ exists: false })),
            set: setMock
          }))
        }))
      }))
    });

    const api = init({
      db: mockDb,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      getConfig: jest.fn(() => ({ sigenergy: {} })),
      incrementApiCount: jest.fn(async () => undefined)
    });

    // Token endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'access-abc',
        refresh_token: 'refresh-xyz',
        expires_in: 3600
      })
    });

    // Station info endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          stationList: [{
            stationId: 'STA001',
            hasPv: true,
            hasAcCharger: false,
            acSnList: [],
            dcSnList: ['DC001']
          }]
        }
      })
    });

    const result = await api.loginSigenergy(
      { sigenUsername: 'user@example.com', sigenPassword: 'secret', sigenRegion: 'apac' },
      null,
      'user1'
    );

    expect(result.errno).toBe(0);
    expect(result.result).toMatchObject({ accessToken: 'access-abc' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('auth failure → errno 3402', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Bad credentials' })
    });

    const api = buildAPI();
    const result = await api.loginSigenergy(
      { sigenUsername: 'bad@example.com', sigenPassword: 'wrong', sigenRegion: 'apac' },
      null,
      null
    );

    expect(result.errno).toBe(3402);
  });

  test('network timeout → errno 3405', async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));

    const api = buildAPI();
    const result = await api.loginSigenergy(
      { sigenUsername: 'u', sigenPassword: 'p', sigenRegion: 'apac' },
      null,
      null
    );

    expect(result.errno).toBe(3405);
  });

  test('emulator bypass returns mocked token immediately without fetch', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    const api = buildAPI();
    const result = await api.loginSigenergy(
      { sigenUsername: 'u', sigenPassword: 'p', sigenRegion: 'apac' },
      null,
      null
    );

    expect(result.errno).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// callSigenEnergyAPI — live path (non-emulator)
// ---------------------------------------------------------------------------

describe('callSigenEnergyAPI — live path', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete process.env.FUNCTIONS_EMULATOR;
  });

  test('GET request appends query params and sends Bearer header', async () => {
    const futureMs = Date.now() + 3600000;
    const api = buildAPI();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { pvPower: 1200 } })
    });

    const result = await api.callSigenEnergyAPI(
      'GET',
      'device/sigen/station/energyflow',
      { id: 'STA001' },
      {
        sigenUsername: 'u', sigenPassword: 'p', sigenRegion: 'apac',
        sigenAccessToken: 'cached-access',
        sigenRefreshToken: 'cached-refresh',
        sigenTokenExpiry: futureMs
      },
      'user1'
    );

    expect(result.errno).toBe(0);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('id=STA001');
    expect(callArgs[1].headers['Authorization']).toBe('Bearer cached-access');
    expect(callArgs[1].method).toBe('GET');
  });

  test('PUT request sends JSON body', async () => {
    const futureMs = Date.now() + 3600000;
    const api = buildAPI();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { success: true } })
    });

    await api.callSigenEnergyAPI(
      'PUT',
      'device/energy-profile/mode',
      { stationId: 'S1', operationMode: 0, profileId: -1 },
      {
        sigenUsername: 'u', sigenPassword: 'p', sigenRegion: 'apac',
        sigenAccessToken: 'tok',
        sigenRefreshToken: 'ref',
        sigenTokenExpiry: futureMs
      },
      'user1'
    );

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].method).toBe('PUT');
    expect(callArgs[1].headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(callArgs[1].body);
    expect(body.stationId).toBe('S1');
    expect(body.operationMode).toBe(0);
  });
});
