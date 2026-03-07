'use strict';

const {
  TeslaFleetAdapter,
  buildTeslaAuthUrl,
  exchangeTeslaAuthCode,
  normalizeTeslaVehicleData,
  TESLA_AUTH_BASE,
  TESLA_FLEET_REGIONS,
  TESLA_REQUIRED_SCOPES
} = require('../lib/adapters/tesla-fleet-adapter');
const { validateEVAdapter } = require('../lib/adapters/ev-adapter');

// ---------------------------------------------------------------------------
// Mock HTTP client factory
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1 — Constructor guard
// ---------------------------------------------------------------------------

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

  test('accepts EU region', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient(), region: 'eu' });
    expect(adapter._fleetBase).toBe(TESLA_FLEET_REGIONS.eu);
  });

  test('unknown region falls back to NA', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient(), region: 'ap' });
    expect(adapter._region).toBe('na');
  });
});

// ---------------------------------------------------------------------------
// 2 — EVAdapter contract
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — EVAdapter contract', () => {
  test('passes validateEVAdapter', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    expect(validateEVAdapter(adapter)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 — getVehicleStatus
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — getVehicleStatus', () => {
  test('calls vehicle_data endpoint and returns canonical status', async () => {
    const teslaResponse = {
      charge_state: {
        battery_level: 72,
        charging_state: 'Charging',
        charge_limit_soc: 90,
        charge_port_door_open: true,
        est_battery_range: 198 // miles
      },
      drive_state: { speed: null, active_route_destination: null },
      vehicle_state: { homelink_nearby: true }
    };
    const http = makeHttpClient({
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/vin123/vehicle_data`]: {
        status: 200,
        data: { response: teslaResponse }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const status = await adapter.getVehicleStatus('vin123', makeContext());

    expect(status.socPct).toBe(72);
    expect(status.chargingState).toBe('charging');
    expect(status.chargeLimitPct).toBe(90);
    expect(status.isPluggedIn).toBe(true);
    expect(status.rangeKm).toBeCloseTo(318.7, 0);
  });

  test('throws when accessToken is missing', async () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    await expect(adapter.getVehicleStatus('vin1', {})).rejects.toThrow(/accessToken is required/);
  });

  test('throws on 401 HTTP error', async () => {
    const http = makeHttpClient({
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/vin123/vehicle_data`]: {
        status: 401,
        data: { error: { message: 'Unauthorized' } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    await expect(adapter.getVehicleStatus('vin123', makeContext())).rejects.toThrow(/Unauthorized/);
  });
});

// ---------------------------------------------------------------------------
// 4 — startCharging
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — startCharging', () => {
  test('calls charge_start command and returns confirmed result', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/vin123/command/charge_start`]: {
        status: 200,
        data: { response: { result: true, reason: '' } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const result = await adapter.startCharging('vin123', makeContext());
    expect(result.status).toBe('confirmed');
    expect(result.commandId).toMatch(/^tesla-charge_start-/);
  });

  test('returns failed when Tesla result=false', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/vin123/command/charge_start`]: {
        status: 200,
        data: { response: { result: false, reason: 'already_charging' } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const result = await adapter.startCharging('vin123', makeContext());
    expect(result.status).toBe('failed');
    expect(result.providerRef).toBe('already_charging');
  });
});

// ---------------------------------------------------------------------------
// 5 — stopCharging
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — stopCharging', () => {
  test('calls charge_stop and returns confirmed', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/vin123/command/charge_stop`]: {
        status: 200,
        data: { response: { result: true, reason: '' } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const result = await adapter.stopCharging('vin123', makeContext());
    expect(result.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// 6 — setChargeLimit
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — setChargeLimit', () => {
  test('calls set_charge_limit with correct percent body', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/vin123/command/set_charge_limit`]: {
        status: 200,
        data: { response: { result: true, reason: '' } }
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    const result = await adapter.setChargeLimit('vin123', makeContext(), 80);
    expect(result.status).toBe('confirmed');

    const call = http.calls.find((c) => c.url.includes('set_charge_limit'));
    expect(call.opts.body.percent).toBe(80);
  });

  test('throws for invalid limit', async () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    await expect(adapter.setChargeLimit('vin1', makeContext(), 0)).rejects.toThrow(/invalid limit/);
    await expect(adapter.setChargeLimit('vin1', makeContext(), 101)).rejects.toThrow(/invalid limit/);
  });
});

// ---------------------------------------------------------------------------
// 7 — wakeVehicle
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — wakeVehicle', () => {
  test('returns woken=true immediately when wake_up responds with online state', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/vin123/wake_up`]: {
        status: 200,
        data: { response: { state: 'online' } }
      }
    });
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      sleep: async () => {}
    });
    const result = await adapter.wakeVehicle('vin123', makeContext());
    expect(result.woken).toBe(true);
    expect(result.vehicleId).toBe('vin123');
  });

  test('polls status and resolves when vehicle comes online', async () => {
    let pollCount = 0;
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/vin123/wake_up`]: {
        status: 200,
        data: { response: { state: 'asleep' } }
      },
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/vin123`]: () => {
        pollCount++;
        if (pollCount >= 2) {
          return { status: 200, data: { response: { state: 'online' } } };
        }
        return { status: 200, data: { response: { state: 'asleep' } } };
      }
    });
    const sleepCalls = [];
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      sleep: async (ms) => { sleepCalls.push(ms); }
    });
    const result = await adapter.wakeVehicle('vin123', makeContext());
    expect(result.woken).toBe(true);
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  test('throws when vehicle does not wake within deadline', async () => {
    // Simulate vehicle always returning asleep; deadline will expire quickly
    // by tightly controlling sleep calls
    let totalSleepMs = 0;
    const adapter = new TeslaFleetAdapter({
      httpClient: makeHttpClient({
        [`POST ${FLEET_NA_BASE}/api/1/vehicles/v1/wake_up`]: {
          status: 200, data: { response: { state: 'asleep' } }
        },
        [`GET ${FLEET_NA_BASE}/api/1/vehicles/v1`]: () => ({
          status: 200, data: { response: { state: 'asleep' } }
        })
      }),
      // Make each sleep actually advance beyond the 30s deadline
      sleep: async (ms) => {
        totalSleepMs += ms;
        // Override internal deadline by simulating lots of elapsed time
      }
    });

    // Temporarily reduce the wake timeout for this test via monkey-patching Date.now
    const origDateNow = Date.now;
    let mockTime = origDateNow();
    Date.now = () => {
      mockTime += 3000; // each call advances 3 seconds
      return mockTime;
    };

    try {
      await expect(adapter.wakeVehicle('v1', makeContext())).rejects.toThrow(/did not come online/);
    } finally {
      Date.now = origDateNow;
    }
  });
});

// ---------------------------------------------------------------------------
// 8 — normalizeProviderError
// ---------------------------------------------------------------------------

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
    const err = new Error('rate limit exceeded');
    err.status = 429;
    const result = adapter.normalizeProviderError(err);
    expect(result.errno).toBe(3429);
  });

  test('handles null error', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    const result = adapter.normalizeProviderError(null);
    expect(typeof result.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 9 — Retry on 429
// ---------------------------------------------------------------------------

describe('TeslaFleetAdapter — rate-limit retry', () => {
  test('retries on 429 and succeeds on next attempt', async () => {
    let callCount = 0;
    const http = async (method, url) => {
      callCount++;
      if (callCount < 2) {
        return { status: 429, data: {}, headers: { 'retry-after': '0' } };
      }
      return { status: 200, data: { response: { result: true, reason: '' } } };
    };
    http.calls = [];
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      sleep: async () => {}
    });
    const result = await adapter.startCharging('vin1', makeContext());
    expect(result.status).toBe('confirmed');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 10 — refreshAccessToken
// ---------------------------------------------------------------------------

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
  });

  test('throws when refreshToken is missing', async () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    await expect(adapter.refreshAccessToken({})).rejects.toThrow(/refreshToken is required/);
  });

  test('throws on non-200 response', async () => {
    const http = makeHttpClient({
      [`POST ${TESLA_AUTH_BASE}/token`]: { status: 401, data: {} }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });
    await expect(adapter.refreshAccessToken({ refreshToken: 'r', clientId: 'c' }))
      .rejects.toThrow(/token refresh failed/);
  });
});

// ---------------------------------------------------------------------------
// 11 — buildTeslaAuthUrl
// ---------------------------------------------------------------------------

describe('buildTeslaAuthUrl', () => {
  test('builds valid auth URL with required params', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'my-client',
      redirectUri: 'https://app.example.com/callback',
      state: 'xyz',
      codeChallenge: 'abc123',
      codeChallengeMethod: 'S256'
    });
    expect(url).toContain(`${TESLA_AUTH_BASE}/authorize`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=my-client');
    expect(url).toContain(encodeURIComponent('https://app.example.com/callback'));
    expect(url).toContain('code_challenge=abc123');
    expect(url).toContain('code_challenge_method=S256');
  });

  test('includes all required scopes in URL', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'client',
      redirectUri: 'https://localhost/cb'
    });
    for (const scope of TESLA_REQUIRED_SCOPES) {
      expect(url).toContain(encodeURIComponent(scope));
    }
  });

  test('throws when clientId or redirectUri is missing', () => {
    expect(() => buildTeslaAuthUrl({ clientId: 'c' })).toThrow(/clientId and redirectUri/);
    expect(() => buildTeslaAuthUrl({ redirectUri: 'r' })).toThrow(/clientId and redirectUri/);
  });

  test('uses EU audience when region=eu', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'c',
      redirectUri: 'https://localhost/cb'
    }, 'eu');
    expect(url).toContain(encodeURIComponent(TESLA_FLEET_REGIONS.eu));
  });
});

// ---------------------------------------------------------------------------
// 12 — exchangeTeslaAuthCode
// ---------------------------------------------------------------------------

describe('exchangeTeslaAuthCode', () => {
  test('exchanges code for tokens', async () => {
    const http = makeHttpClient({
      [`POST ${TESLA_AUTH_BASE}/token`]: {
        status: 200,
        data: { access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }
      }
    });
    const result = await exchangeTeslaAuthCode(
      { clientId: 'c', redirectUri: 'https://localhost/cb', code: 'authcode', codeVerifier: 'v' },
      http
    );
    expect(result.accessToken).toBe('acc');
    expect(result.refreshToken).toBe('ref');
    expect(result.expiresAtMs).toBeGreaterThan(Date.now());
  });

  test('throws on missing params', async () => {
    const http = makeHttpClient();
    await expect(exchangeTeslaAuthCode({ clientId: 'c', redirectUri: 'r' }, http))
      .rejects.toThrow(/code are required/);
  });

  test('throws on non-200 response', async () => {
    const http = makeHttpClient({
      [`POST ${TESLA_AUTH_BASE}/token`]: { status: 400, data: {} }
    });
    await expect(exchangeTeslaAuthCode({ clientId: 'c', redirectUri: 'r', code: 'x' }, http))
      .rejects.toThrow(/token exchange failed/);
  });
});

// ---------------------------------------------------------------------------
// 13 — normalizeTeslaVehicleData
// ---------------------------------------------------------------------------

describe('normalizeTeslaVehicleData', () => {
  test('maps charge_state fields to canonical shape', () => {
    const raw = {
      charge_state: {
        battery_level: 68,
        charging_state: 'Charging',
        charge_limit_soc: 95,
        charge_port_door_open: true,
        est_battery_range: 200
      },
      drive_state: {},
      vehicle_state: {}
    };
    const result = normalizeTeslaVehicleData(raw);
    expect(result.socPct).toBe(68);
    expect(result.chargingState).toBe('charging');
    expect(result.chargeLimitPct).toBe(95);
    expect(result.isPluggedIn).toBe(true);
    expect(result.rangeKm).toBeCloseTo(321.9, 0);
  });

  test('handles empty input gracefully', () => {
    const result = normalizeTeslaVehicleData({});
    expect(result.socPct).toBeNull();
    expect(result.chargingState).toBe('unknown');
  });
});
