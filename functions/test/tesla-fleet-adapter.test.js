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

const TEST_SCOPED_ACCESS_TOKEN = 'eyJhbGciOiJub25lIn0.eyJzY3AiOlsib3BlbmlkIiwiZW1haWwiLCJvZmZsaW5lX2FjY2VzcyIsInZlaGljbGVfZGV2aWNlX2RhdGEiLCJ2ZWhpY2xlX2NtZHMiLCJ2ZWhpY2xlX2NoYXJnaW5nX2NtZHMiXX0.';

function makeContext(token = TEST_SCOPED_ACCESS_TOKEN) {
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

  test('reports charging command support', () => {
    const adapter = new TeslaFleetAdapter({ httpClient: makeHttpClient() });
    expect(adapter.supportsCommands()).toBe(true);
    expect(adapter.supportsChargingCommands()).toBe(true);
    expect(adapter.supportsWake()).toBe(true);
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
        battery_range: 212,
        est_battery_range: 198,
        time_to_full_charge: 1.5,
        charge_energy_added: 9.3,
        charge_miles_added_rated: 38,
        charger_power: 7,
        charger_actual_current: 24
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
    expect(status.ratedRangeKm).toBeCloseTo(341.1, 0);
    expect(status.timeToFullChargeHours).toBe(1.5);
    expect(status.chargeEnergyAddedKwh).toBe(9.3);
    expect(status.rangeAddedKm).toBeCloseTo(61.2, 0);
    expect(status.chargingPowerKw).toBe(7);
    expect(status.chargingAmps).toBe(24);
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

describe('TeslaFleetAdapter — getCommandReadiness', () => {
  test('returns signed readiness when fleet_status requires Vehicle Command Protocol and proxy is configured', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/fleet_status`]: {
        status: 200,
        data: {
          response: [
            {
              vin: '5YJ3E1EA7JF000001',
              vehicle_command_protocol_required: true,
              total_number_of_keys: 4,
              firmware_version: '2026.2.1'
            }
          ]
        },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      signedCommandProxyUrl: 'https://tesla-proxy.example.com'
    });

    const readiness = await adapter.getCommandReadiness('5YJ3E1EA7JF000001', makeContext());

    expect(readiness).toMatchObject({
      state: 'ready_signed',
      transport: 'signed',
      source: 'fleet_status',
      vehicleCommandProtocolRequired: true,
      totalNumberOfKeys: 4,
      firmwareVersion: '2026.2.1'
    });
    expect(http.calls[0].opts.body).toEqual({ vins: ['5YJ3E1EA7JF000001'] });
  });

  test('returns oauth_scope_upgrade_required when VCP is required and token is missing vehicle_cmds', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/fleet_status`]: {
        status: 200,
        data: {
          response: [
            {
              vin: '5YJ3E1EA7JF000001',
              vehicle_command_protocol_required: true,
              total_number_of_keys: 4,
              firmware_version: '2026.2.1'
            }
          ]
        },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      signedCommandProxyUrl: 'https://tesla-proxy.example.com'
    });

    const readiness = await adapter.getCommandReadiness('5YJ3E1EA7JF000001', {
      ...makeContext(),
      credentials: {
        accessToken: 'eyJhbGciOiJub25lIn0.eyJzY3AiOlsib3BlbmlkIiwiZW1haWwiLCJvZmZsaW5lX2FjY2VzcyIsInZlaGljbGVfZGV2aWNlX2RhdGEiLCJ2ZWhpY2xlX2NoYXJnaW5nX2NtZHMiXX0.',
        vin: '5YJ3E1EA7JF000001'
      }
    });

    expect(readiness).toMatchObject({
      state: 'oauth_scope_upgrade_required',
      transport: 'signed',
      vehicleCommandProtocolRequired: true,
      reasonCode: 'tesla_vehicle_cmds_scope_required',
      missingScopes: ['vehicle_cmds']
    });
  });

  test('returns proxy_unavailable when VCP is required but no proxy is configured', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/fleet_status`]: {
        status: 200,
        data: {
          response: [
            {
              vin: '5YJ3E1EA7JF000001',
              vehicle_command_protocol_required: true
            }
          ]
        },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const readiness = await adapter.getCommandReadiness('5YJ3E1EA7JF000001', makeContext());

    expect(readiness).toMatchObject({
      state: 'proxy_unavailable',
      transport: 'signed',
      vehicleCommandProtocolRequired: true,
      reasonCode: 'signed_command_proxy_unavailable'
    });
  });

  test('returns read_only when fleet_status is unavailable for non-auth failures', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/fleet_status`]: {
        status: 408,
        data: { error: 'vehicle offline' },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const readiness = await adapter.getCommandReadiness('5YJ3E1EA7JF000001', makeContext());

    expect(readiness).toMatchObject({
      state: 'read_only',
      transport: 'none',
      source: 'fleet_status_unavailable',
      reasonCode: 'command_readiness_unavailable'
    });
  });

  test('throws when fleet_status returns auth failure so callers can block commands', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/fleet_status`]: {
        status: 401,
        data: { error: { message: 'Unauthorized' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    await expect(adapter.getCommandReadiness('5YJ3E1EA7JF000001', {
      credentials: { accessToken: 'test-access-token' }
    })).rejects.toThrow(/unauthorized/i);
  });
});

describe('TeslaFleetAdapter — charging commands', () => {
  test('startCharging calls direct charge_start endpoint and returns confirmed result', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/fleet_status`]: {
        status: 404,
        data: { error: 'missing route stub' },
        headers: {}
      },
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/command/charge_start`]: {
        status: 200,
        data: { response: { result: true, reason: '' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const result = await adapter.startCharging('5YJ3E1EA7JF000001', {
      ...makeContext(),
      commandReadiness: {
        state: 'ready_direct',
        transport: 'direct',
        source: 'test',
        vehicleCommandProtocolRequired: false
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      command: 'charge_start',
      status: 'confirmed',
      transport: 'direct',
      provider: 'tesla'
    });
  });

  test('startCharging retries through signed proxy when direct command reports VCP requirement', async () => {
    const proxyBase = 'https://tesla-proxy.example.com';
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/command/charge_start`]: {
        status: 422,
        data: { error: { message: 'vehicle_command_protocol_required' } },
        headers: {}
      },
      [`POST ${proxyBase}/api/1/vehicles/5YJ3E1EA7JF000001/command/charge_start`]: {
        status: 200,
        data: { response: { result: true, reason: '' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({
      httpClient: http,
      signedCommandProxyUrl: proxyBase
    });

    const result = await adapter.startCharging('5YJ3E1EA7JF000001', {
      ...makeContext(),
      vehicleVin: '5YJ3E1EA7JF000001',
      commandReadiness: {
        state: 'ready_direct',
        transport: 'direct',
        source: 'assumed_fleet_status_unavailable',
        vehicleCommandProtocolRequired: null
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      transport: 'signed',
      command: 'charge_start'
    });
    expect(http.calls.map((call) => call.url)).toEqual([
      `${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/command/charge_start`,
      `${proxyBase}/api/1/vehicles/5YJ3E1EA7JF000001/command/charge_start`
    ]);
  });

  test('stopCharging treats Tesla not_charging result as noop success', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/command/charge_stop`]: {
        status: 200,
        data: { response: { result: false, reason: 'not_charging' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const result = await adapter.stopCharging('5YJ3E1EA7JF000001', {
      ...makeContext(),
      commandReadiness: {
        state: 'ready_direct',
        transport: 'direct',
        source: 'test',
        vehicleCommandProtocolRequired: false
      }
    });

    expect(result).toMatchObject({
      accepted: true,
      status: 'noop',
      noop: true,
      command: 'charge_stop'
    });
  });

  test('setChargeLimit sends percent body and validates Tesla range', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/command/set_charge_limit`]: {
        status: 200,
        data: { response: { result: true, reason: '' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const result = await adapter.setChargeLimit('5YJ3E1EA7JF000001', 80, {
      ...makeContext(),
      commandReadiness: {
        state: 'ready_direct',
        transport: 'direct',
        source: 'test',
        vehicleCommandProtocolRequired: false
      }
    });

    expect(result.status).toBe('confirmed');
    const call = http.calls.find((entry) => entry.url.includes('set_charge_limit'));
    expect(call.opts.body).toEqual({ percent: 80 });
    await expect(
      adapter.setChargeLimit('5YJ3E1EA7JF000001', 49, makeContext())
    ).rejects.toThrow(/invalid limit/i);
  });

  test('setChargingAmps sends charging_amps body and validates range', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/command/set_charging_amps`]: {
        status: 200,
        data: { response: { result: true, reason: '' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const result = await adapter.setChargingAmps('5YJ3E1EA7JF000001', 16, {
      ...makeContext(),
      commandReadiness: {
        state: 'ready_direct',
        transport: 'direct',
        source: 'test',
        vehicleCommandProtocolRequired: false
      }
    });

    expect(result.status).toBe('confirmed');
    const call = http.calls.find((entry) => entry.url.includes('set_charging_amps'));
    expect(call.opts.body).toEqual({ charging_amps: 16 });
    await expect(
      adapter.setChargingAmps('5YJ3E1EA7JF000001', 0, makeContext())
    ).rejects.toThrow(/invalid charging amps/i);
  });
});

describe('TeslaFleetAdapter — wakeVehicle', () => {
  test('calls wake_up endpoint and reports wake state', async () => {
    const http = makeHttpClient({
      [`POST ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/wake_up`]: {
        status: 200,
        data: { response: { state: 'online' } },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    const result = await adapter.wakeVehicle('5YJ3E1EA7JF000001', makeContext());

    expect(result).toMatchObject({
      accepted: true,
      command: 'wakeVehicle',
      status: 'online',
      wakeState: 'online',
      transport: 'direct'
    });
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
    expect(url).toContain('prompt_missing_scopes=true');
    expect(url).toContain('require_requested_scopes=true');
  });

  test('uses status-only scopes', () => {
    const url = buildTeslaAuthUrl({
      clientId: 'client123',
      redirectUri: 'https://example.com/callback',
      codeChallenge: 'abc123'
    });
    expect(url).toContain('vehicle_device_data');
    expect(url).toContain('vehicle_cmds');
    expect(url).toContain('vehicle_charging_cmds');
    expect(TESLA_REQUIRED_SCOPES).toEqual(['openid', 'email', 'offline_access', 'vehicle_device_data', 'vehicle_cmds', 'vehicle_charging_cmds']);
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

describe('TeslaFleetAdapter — billing classification', () => {
  test('marks 4xx Tesla responses as non-billable in emitted metrics', async () => {
    const recordTeslaApiCall = jest.fn(async () => {});
    const http = makeHttpClient({
      [`GET ${FLEET_NA_BASE}/api/1/vehicles/5YJ3E1EA7JF000001/vehicle_data`]: {
        status: 408,
        data: { error: 'vehicle offline' },
        headers: {}
      }
    });
    const adapter = new TeslaFleetAdapter({ httpClient: http });

    await expect(adapter.getVehicleStatus('5YJ3E1EA7JF000001', {
      ...makeContext(),
      recordTeslaApiCall
    })).rejects.toThrow(/vehicle offline/i);

    expect(recordTeslaApiCall).toHaveBeenCalledWith(expect.objectContaining({
      status: 408,
      billable: false
    }));
  });
});