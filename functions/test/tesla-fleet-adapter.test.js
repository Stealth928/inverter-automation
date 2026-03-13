'use strict';

const {
  TeslaFleetAdapter,
  buildTeslaAuthUrl,
  exchangeTeslaAuthCode,
  normalizeTeslaVehicleData,
  TESLA_AUTH_BASE,
  TESLA_AUTH_BASE_CN,
  TESLA_FLEET_REGIONS,
  TESLA_REQUIRED_SCOPES
} = require('../lib/adapters/tesla-fleet-adapter');
const { validateEVAdapter } = require('../lib/adapters/ev-adapter');

function makeHttpClient(responseMap = {}) {
  const calls = [];

  async function httpClient(method, url, opts = {}) {
    calls.push({ method, url, opts });
    const key = `${method} ${url}`;
    const response = responseMap[key];
    if (response === undefined) {
      return { status: 200, data: {} };
    }
    if (typeof response === 'function') {
      return response({ method, url, opts });
    }
    return response;
  }

  httpClient.calls = calls;
  return httpClient;
}

const FLEET_NA_BASE = TESLA_FLEET_REGIONS.na;

function makeContext(token = 'test-access-token') {
  return { credentials: { accessToken: token, clientId: 'client123', refreshToken: 'ref456' } };
}

describe('TeslaFleetAdapter — constructor', () => {
  test('throws when httpClient is not provided', () => {
    expect(() => new TeslaFleetAdapter({})).toThrow(/requires an httpClient/);
  });

  test('accepts valid httpClient', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    expect(adapter).toBeDefined();
  });

  test('defaults to NA region', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    expect(adapter._region).toBe('na');
    expect(adapter._fleetBase).toBe(FLEET_NA_BASE);
  });

  test('accepts China region', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient(), region: 'cn' });
    expect(adapter._fleetBase).toBe(TESLA_FLEET_REGIONS.cn);
  });
});

describe('TeslaFleetAdapter — EVAdapter contract', () => {
  test('passes validateEVAdapter', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    expect(validateEVAdapter(adapter)).toBe(true);
  });
});

describe('TeslaFleetAdapter — getVehicleStatus', () => {
  test('calls vehicle_data endpoint and returns canonical status', async () => {
    const teslaResponse = {
      charge_state: {
        battery_level: 72,
        charging_state: 'Charging',
        charge_limit_soc: 90,
        charge_port_door_open: true,
        est_battery_range: 198
      },
      drive_state: { speed: null, active_route_destination: null },
      vehicle_state: { homelink_nearby: true }
    };
    const http = makeHttpClient({
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/vehicle_data`]: {
        status: 200,
        data: { response: teslaResponse }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const status = await adapter.getVehicleStatus('5YJ3E1EA7JF000001', makeContext());

    expect(status.socPct).toBe(72);
    expect(status.chargingState).toBe('charging');
    expect(status.chargeLimitPct).toBe(90);
    expect(status.isPluggedIn).toBe(true);
    expect(status.rangeKm).toBeCloseTo(318.7, 0);
  });

  test('emits Tesla call accounting payload via per-request recorder', async () => {
    const recordTeslaApiCall = jest.fn(async () => {});
    const http = makeHttpClient({
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/vehicle_data`]: {
        status: 200,
        data: { response: { charge_state: {} } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    await adapter.getVehicleStatus('5YJ3E1EA7JF000001', {
      ...makeContext(),
      recordTeslaApiCall
    });

    expect(recordTeslaApiCall).toHaveBeenCalledWith(expect.objectContaining({
      category: 'data_request',
      status: 200,
      billable: true
    }));
  });

  test('throws when accessToken is missing', async () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    await expect(adapter.getVehicleStatus('vin1', {})).rejects.toThrow(/accessToken is required/);
  });

  test('throws on 401 HTTP error', async () => {
    const http = makeHttpClient({
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/vehicle_data`]: {
        status: 401,
        data: { error: { message: 'Unauthorized' } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    await expect(
      adapter.getVehicleStatus('5YJ3E1EA7JF000001', { credentials: { accessToken: 'test-access-token' } })
    ).rejects.toThrow(/Unauthorized/);
  });

  test('refreshes expired token on 401 and retries request once', async () => {
    const teslaResponse = {
      charge_state: { battery_level: 65, charging_state: 'Charging', charge_limit_soc: 85, charge_port_door_open: true, est_battery_range: 200 },
      drive_state: { speed: null, active_route_destination: null },
      vehicle_state: { homelink_nearby: true }
    };

    const http = jest.fn(async (method, url, opts = {}) => {
      if (method === 'GET' && url === `${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/vehicle_data`) {
        if (opts.headers.Authorization === 'Bearer old-token') {
          return { status: 401, data: { error: { message: 'Unauthorized' } }, headers: {} };
        }
        if (opts.headers.Authorization === 'Bearer new-token') {
          return { status: 200, data: { response: teslaResponse }, headers: {} };
        }
      }

      if (method === 'POST' && /\/oauth2\/v3\/token$/.test(url)) {
        return {
          status: 200,
          data: {
            access_token: 'new-token',
            refresh_token: 'new-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 'openid offline_access vehicle_device_data'
          },
          headers: {}
        };
      }

      return { status: 500, data: { error: 'unexpected test request' }, headers: {} };
    });

    const persistCredentials = jest.fn(async () => {});
    const context = {
      credentials: {
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        clientId: 'client123',
        clientSecret: 'secret123'
      },
      persistCredentials
    };
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const status = await adapter.getVehicleStatus('5YJ3E1EA7JF000001', context);

    expect(status.socPct).toBe(65);
    expect(context.credentials.accessToken).toBe('new-token');
    expect(context.credentials.refreshToken).toBe('new-refresh');
    expect(persistCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        tokenType: 'Bearer',
        scope: 'openid offline_access vehicle_device_data'
      })
    );
  });
});

describe('TeslaFleetAdapter — normalizeProviderError', () => {
  test('returns canonical error envelope with provider: tesla', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    const result = adapter.normalizeProviderError(new Error('connection timeout'));
    expect(result.errno).toBe(3800);
    expect(result.error).toBe('connection timeout');
    expect(result.provider).toBe('tesla');
  });

  test('returns errno 3429 for rate-limit errors', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    const error = new Error('rate limit exceeded');
    error.status = 429;
    const result = adapter.normalizeProviderError(error);
    expect(result.errno).toBe(3429);
  });
});

describe('TeslaFleetAdapter — rate-limit retry', () => {
  test('retries on 429 and succeeds on next attempt', async () => {
    let callCount = 0;
    const http = async () => {
      callCount += 1;
      if (callCount < 2) {
        return { status: 429, data: {}, headers: { 'retry-after': '0' } };
      }
      return { status: 200, data: { response: { charge_state: {} } }, headers: {} };
    };
    http.calls = [];
    const adapter = new TeslaFleetAdapter({ httpClient: http, sleep: async () => {} });
    const result = await adapter.getVehicleStatus('vin1', makeContext());
    expect(result.chargingState).toBe('unknown');
    expect(callCount).toBe(2);
  });

  test('retries at most once when Tesla keeps returning 429', async () => {
    let callCount = 0;
    const http = async () => {
      callCount += 1;
      return { status: 429, data: { error: 'Too Many Requests' }, headers: { 'retry-after': '0' } };
    };
    const adapter = new TeslaFleetAdapter({ httpClient: http, sleep: async () => {} });
    await expect(adapter.getVehicleStatus('vin1', makeContext())).rejects.toThrow(/too many requests/i);
    expect(callCount).toBe(2);
  });

  test('uses RateLimit-Reset header when Retry-After is absent', async () => {
    let callCount = 0;
    const sleepCalls = [];
    const http = async () => {
      callCount += 1;
      if (callCount === 1) {
        return { status: 429, data: {}, headers: { 'ratelimit-reset': '7' } };
      }
      return { status: 200, data: { response: { charge_state: {} } }, headers: {} };
    };
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      sleep: async (ms) => { sleepCalls.push(ms); }
    });

    await adapter.getVehicleStatus('vin1', makeContext());
    expect(sleepCalls[0]).toBe(7000);
  });
});

describe('TeslaFleetAdapter — refreshAccessToken', () => {
  test('exchanges refresh token for new access token', async () => {
    const http = makeHttpClient({
      [`POST ${TESLA_AUTH_BASE}/token`]: {
        status: 200,
        data: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 28800
        }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const result = await adapter.refreshAccessToken({
      refreshToken: 'old-refresh',
      clientId: 'client123'
    });
    expect(result.accessToken).toBe('new-access');
    expect(result.refreshToken).toBe('new-refresh');
    expect(result.expiresAtMs).toBeGreaterThan(Date.now());
    const tokenCall = http.calls.find((call) => /\/token$/.test(call.url));
    expect(tokenCall.opts.body.audience).toBe(TESLA_FLEET_REGIONS.na);
  });

  test('throws when refreshToken is missing', async () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    await expect(adapter.refreshAccessToken({})).rejects.toThrow(/refreshToken is required/);
  });
});

describe('buildTeslaAuthUrl', () => {
  test('builds valid auth URL with required params', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'client123',
      redirectUri: 'https://example.com/callback',
      state: 'xyz',
      codeChallenge: 'abc123'
    });
    expect(url.startsWith(`${TESLA_AUTH_BASE}/authorize?`)).toBe(true);
    expect(url).toContain('client_id=client123');
    expect(url).toContain(encodeURIComponent('https://example.com/callback'));
    expect(url).toContain('code_challenge=abc123');
    expect(url).toContain('code_challenge_method=S256');
  });

  test('uses status-only scopes', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'client123',
      redirectUri: 'https://example.com/callback',
      codeChallenge: 'abc123'
    });
    expect(url).toContain('vehicle_device_data');
    expect(url).not.toContain('vehicle_cmds');
    expect(url).not.toContain('vehicle_charging_cmds');
    expect(TESLA_REQUIRED_SCOPES).toEqual(['openid', 'email', 'offline_access', 'vehicle_device_data']);
  });

  test('uses China auth base for cn region', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'client123',
      redirectUri: 'https://example.com/callback'
    }, 'cn');
    expect(url.startsWith(`${TESLA_AUTH_BASE_CN}/authorize?`)).toBe(true);
  });
});

describe('exchangeTeslaAuthCode', () => {
  test('exchanges auth code for tokens', async () => {
    const http = makeHttpClient({
      [`POST ${TESLA_AUTH_BASE}/token`]: {
        status: 200,
        data: {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'openid offline_access vehicle_device_data'
        }
      }
    });

    const result = await exchangeTeslaAuthCode({
      clientId: 'client123',
      redirectUri: 'https://example.com/callback',
      code: 'auth-code',
      codeVerifier: 'verifier'
    }, http);

    expect(result.accessToken).toBe('access-1');
    expect(result.refreshToken).toBe('refresh-1');
    expect(result.tokenType).toBe('Bearer');
  });
});

describe('normalizeTeslaVehicleData', () => {
  test('maps Tesla payload into canonical vehicle status', () => {
    const result = normalizeTeslaVehicleData({
      charge_state: {
        battery_level: 50,
        charging_state: 'Stopped',
        charge_limit_soc: 80,
        charge_port_door_open: false,
        est_battery_range: 100
      },
      drive_state: { speed: null, active_route_destination: null },
      vehicle_state: { homelink_nearby: true }
    });

    expect(result).toMatchObject({
      socPct: 50,
      chargingState: 'stopped',
      chargeLimitPct: 80,
      isPluggedIn: false,
      isHome: true
    });
  });
});