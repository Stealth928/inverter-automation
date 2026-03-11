'use strict';

const { init: initAlphaEss, generateAlphaEssSign } = require('../api/alphaess');

describe('alphaess api module', () => {
  let alphaEssAPI;
  let mockFetch;
  let mockGetConfig;
  let mockIncrementApiCount;
  let logger;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    mockGetConfig = jest.fn(() => ({
      alphaess: {
        appId: 'APP-123',
        appSecret: 'SECRET-456',
        baseUrl: 'https://openapi.alphaess.test'
      }
    }));
    mockIncrementApiCount = jest.fn(async () => undefined);
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    alphaEssAPI = initAlphaEss({
      db: null,
      logger,
      getConfig: mockGetConfig,
      incrementApiCount: mockIncrementApiCount
    });
  });

  afterEach(() => {
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  test('generateAlphaEssSign returns deterministic sha512 hex', () => {
    const sign1 = generateAlphaEssSign('A', 'B', 1234567890);
    const sign2 = generateAlphaEssSign('A', 'B', 1234567890);
    const sign3 = generateAlphaEssSign('A', 'C', 1234567890);

    expect(sign1).toBe(sign2);
    expect(sign1).not.toBe(sign3);
    expect(sign1).toHaveLength(128);
    expect(/^[0-9a-f]{128}$/.test(sign1)).toBe(true);
  });

  test('callAlphaESSAPI returns success payload for code=200', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: [{ sysSn: 'SYS-1' }]
      })
    });

    const result = await alphaEssAPI.callAlphaESSAPI('/api/getEssList', 'GET', null, {}, 'u1');

    expect(result.errno).toBe(0);
    expect(result.result).toEqual([{ sysSn: 'SYS-1' }]);
    expect(mockIncrementApiCount).toHaveBeenCalledWith('u1', 'alphaess');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/getEssList'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          appId: 'APP-123',
          sign: expect.any(String),
          timeStamp: expect.any(String)
        })
      })
    );
  });

  test('callAlphaESSAPI maps sign failures to errno 3501', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({
        code: 6007,
        msg: 'Sign check error'
      })
    });

    const result = await alphaEssAPI.callAlphaESSAPI('/api/getEssList', 'GET', null, {}, null);
    expect(result.errno).toBe(3501);
    expect(String(result.error).toLowerCase()).toContain('sign');
  });

  test('callAlphaESSAPI maps 429 to errno 3503 and does not increment usage', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 429,
      text: async () => JSON.stringify({
        code: 429,
        msg: 'Too many requests'
      })
    });

    const result = await alphaEssAPI.callAlphaESSAPI('/api/getEssList', 'GET', null, {}, 'u1');
    expect(result.errno).toBe(3503);
    expect(mockIncrementApiCount).not.toHaveBeenCalled();
  });

  test('callAlphaESSAPI returns emulator response in emulator mode', async () => {
    process.env.FUNCTIONS_EMULATOR = 'true';

    const result = await alphaEssAPI.callAlphaESSAPI('/api/getEssList', 'GET', null, {}, 'u1');
    expect(result.errno).toBe(0);
    expect(result.result).toEqual(expect.objectContaining({ _emulated: true, path: '/api/getEssList' }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('callAlphaESSAPI returns errno 3502 when app credentials are missing', async () => {
    mockGetConfig.mockReturnValueOnce({ alphaess: { appId: '', appSecret: '', baseUrl: '' } });
    const result = await alphaEssAPI.callAlphaESSAPI('/api/getEssList', 'GET', null, {}, null);

    expect(result.errno).toBe(3502);
    expect(String(result.error).toLowerCase()).toContain('credentials');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('listSystems normalizes wrapped payload to array', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({
        code: 200,
        data: {
          list: [{ sysSn: 'SYS-A' }, { sysSn: 'SYS-B' }]
        }
      })
    });

    const result = await alphaEssAPI.listSystems({}, null);
    expect(result.errno).toBe(0);
    expect(result.result).toEqual([{ sysSn: 'SYS-A' }, { sysSn: 'SYS-B' }]);
  });
});
