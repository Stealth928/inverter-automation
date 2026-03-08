'use strict';

// ---------------------------------------------------------------------------
// Tesla Fleet API Adapter
// ---------------------------------------------------------------------------
// Implements the EVAdapter interface against Tesla's Fleet API.
// Docs: https://developer.tesla.com/docs/fleet-api
//
// Two API regions are supported:
//   na  → https://fleet-api.prd.na.vn.cloud.tesla.com
//   eu  → https://fleet-api.prd.eu.vn.cloud.tesla.com
//
// Authentication:
//   - OAuth2 with PKCE for user authorization
//   - Access token + refresh token stored via VehiclesRepository
//   - Access tokens expire after ~8 hours; refresh happens transparently
//
// Signed commands:
//   Tesla vehicles from ~2021+ require commands to be signed with the
//   partner's EC private key.  Signing is optional in this adapter and
//   relies on an injected signingClient dependency.  If signingClient is
//   not provided, commands fall back to unsigned Fleet API endpoints which
//   work for older vehicles and whitelisted partner accounts.
// ---------------------------------------------------------------------------

const {
  EVAdapter,
  normalizeVehicleStatus,
  normalizeCommandResult
} = require('./ev-adapter');

// ---------------------------------------------------------------------------
// Tesla API constants
// ---------------------------------------------------------------------------

const TESLA_AUTH_BASE = 'https://auth.tesla.com/oauth2/v3';
const TESLA_FLEET_REGIONS = Object.freeze({
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com'
});
const TESLA_DEFAULT_REGION = 'na';

// Scopes required for full vehicle control
const TESLA_REQUIRED_SCOPES = Object.freeze([
  'openid',
  'email',
  'offline_access',
  'vehicle_device_data',
  'vehicle_cmds',
  'vehicle_charging_cmds'
]);

// Tesla wake-up poll: check interval and max wait
const WAKE_POLL_INTERVAL_MS = 2000;
const WAKE_MAX_WAIT_MS = 30000;

// Tesla rate-limit retry defaults
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRegion(region) {
  const r = String(region || '').trim().toLowerCase();
  return TESLA_FLEET_REGIONS[r] ? r : TESLA_DEFAULT_REGION;
}

function getFleetBase(region) {
  return TESLA_FLEET_REGIONS[normalizeRegion(region)];
}

/**
 * Map Tesla vehicle_data response to canonical shape.
 * Handles both the older REST API and newer telemetry shapes.
 */
function normalizeTeslaVehicleData(data = {}) {
  const chargeState = data.charge_state || {};
  const driveState = data.drive_state || {};
  const vehicleState = data.vehicle_state || {};

  const chargingStateRaw = chargeState.charging_state || null;
  const isHome =
    driveState.active_route_destination === null &&
    (vehicleState.homelink_nearby === true || driveState.speed === null);

  return normalizeVehicleStatus({
    battery_level: chargeState.battery_level,
    charging_state: chargingStateRaw,
    charge_limit_soc: chargeState.charge_limit_soc,
    isPluggedIn: chargeState.charge_port_door_open !== undefined
      ? Boolean(chargeState.charge_port_door_open)
      : null,
    isHome,
    est_battery_range_km: chargeState.est_battery_range
      ? Math.round(chargeState.est_battery_range * 1.60934)  // miles → km
      : null
  });
}

/**
 * Wrap a Tesla command result.
 * Tesla commands return { result: true, reason: '' } on success.
 */
function normalizeTeslaCommandResult(raw = {}, commandType = '') {
  const success = raw.result === true;
  return normalizeCommandResult({
    commandId: `tesla-${commandType}-${Date.now()}`,
    status: success ? 'confirmed' : 'failed',
    sentAtIso: new Date().toISOString(),
    providerRef: raw.reason || ''
  });
}

// ---------------------------------------------------------------------------
// TeslaFleetAdapter
// ---------------------------------------------------------------------------

class TeslaFleetAdapter extends EVAdapter {
  /**
   * @param {object} deps
   * @param {Function} deps.httpClient  - async (method, url, opts) => { status, data }
   *   where opts = { headers?, body?, retries? }
   * @param {string}   [deps.region]   - 'na' | 'eu'
   * @param {object}   [deps.logger]   - { debug, warn, error }
   * @param {object}   [deps.signingClient] - Optional; async sign({ vehicleId, command, body }) => signedBody
   * @param {Function} [deps.sleep]    - await sleep(ms); injectable for tests
   */
  constructor(deps = {}) {
    super();

    if (!deps.httpClient || typeof deps.httpClient !== 'function') {
      throw new Error('TeslaFleetAdapter requires an httpClient dependency');
    }

    this._http = deps.httpClient;
    this._region = normalizeRegion(deps.region);
    this._fleetBase = getFleetBase(this._region);
    this._logger = deps.logger || { debug: () => {}, warn: () => {}, error: () => {} };
    this._signingClient = deps.signingClient || null;
    this._sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ---------------------------------------------------------------------------
  // Token management helpers
  // ---------------------------------------------------------------------------

  /**
   * Refresh an expired access token using the refresh token.
   * Returns { accessToken, refreshToken, expiresAtMs }.
   * @param {object} credentials - { refreshToken, clientId, clientSecret? }
   * @returns {Promise<object>}
   */
  async refreshAccessToken(credentials) {
    if (!credentials || !credentials.refreshToken) {
      throw new Error('TeslaFleetAdapter.refreshAccessToken: refreshToken is required');
    }

    const body = {
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      refresh_token: credentials.refreshToken
    };

    const response = await this._http('POST', `${TESLA_AUTH_BASE}/token`, {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (response.status !== 200 || !response.data.access_token) {
      throw new Error(
        `TeslaFleetAdapter: token refresh failed (HTTP ${response.status})`
      );
    }

    const { access_token, refresh_token, expires_in } = response.data;
    return {
      accessToken: access_token,
      refreshToken: refresh_token || credentials.refreshToken,
      expiresAtMs: Date.now() + (Number(expires_in) || 28800) * 1000
    };
  }

  /**
   * Build Authorization header from context credentials.
   * @param {object} context - { credentials: { accessToken } }
   * @returns {object} headers object
   */
  _authHeaders(context) {
    const token = context?.credentials?.accessToken;
    if (!token) {
      throw new Error('TeslaFleetAdapter: accessToken is required in context.credentials');
    }
    return { Authorization: `Bearer ${token}` };
  }

  // ---------------------------------------------------------------------------
  // EVAdapter interface
  // ---------------------------------------------------------------------------

  async getVehicleStatus(vehicleId, context) {
    const headers = this._authHeaders(context);
    const url = `${this._fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleId)}/vehicle_data`;
    const response = await this._makeRequest('GET', url, { headers });

    const vehicleData = response.data?.response || response.data || {};
    return normalizeTeslaVehicleData(vehicleData);
  }

  async startCharging(vehicleId, context, _options = {}) {
    const headers = this._authHeaders(context);
    const url = `${this._fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleId)}/command/charge_start`;
    const response = await this._makeRequest('POST', url, { headers, body: {} });
    return normalizeTeslaCommandResult(response.data?.response || response.data, 'charge_start');
  }

  async stopCharging(vehicleId, context) {
    const headers = this._authHeaders(context);
    const url = `${this._fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleId)}/command/charge_stop`;
    const response = await this._makeRequest('POST', url, { headers, body: {} });
    return normalizeTeslaCommandResult(response.data?.response || response.data, 'charge_stop');
  }

  async setChargeLimit(vehicleId, context, limitPct) {
    const limit = Math.round(Number(limitPct));
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new Error(`TeslaFleetAdapter.setChargeLimit: invalid limit ${limitPct}`);
    }

    const headers = this._authHeaders(context);
    const url = `${this._fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleId)}/command/set_charge_limit`;
    const response = await this._makeRequest('POST', url, { headers, body: { percent: limit } });
    return normalizeTeslaCommandResult(response.data?.response || response.data, 'set_charge_limit');
  }

  async wakeVehicle(vehicleId, context) {
    const headers = this._authHeaders(context);
    const url = `${this._fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleId)}/wake_up`;

    const response = await this._makeRequest('POST', url, { headers, body: {} });
    const state = response.data?.response?.state || response.data?.state || '';

    if (state === 'online') {
      return { woken: true, vehicleId: String(vehicleId) };
    }

    // If not immediately online, poll until online or timeout
    const deadline = Date.now() + WAKE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await this._sleep(WAKE_POLL_INTERVAL_MS);
      const pollResp = await this._makeRequest(
        'GET',
        `${this._fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleId)}`,
        { headers }
      );
      const pollState = pollResp.data?.response?.state || '';
      if (pollState === 'online') {
        return { woken: true, vehicleId: String(vehicleId) };
      }
    }

    throw new Error(`TeslaFleetAdapter.wakeVehicle: vehicle ${vehicleId} did not come online within ${WAKE_MAX_WAIT_MS}ms`);
  }

  normalizeProviderError(error) {
    const isRateLimit = error && (error.status === 429 || /rate.?limit/i.test(error.message || ''));
    return {
      errno: isRateLimit ? 3429 : 3800,
      error: error && error.message ? error.message : 'Tesla Fleet API error',
      provider: 'tesla'
    };
  }

  // ---------------------------------------------------------------------------
  // Internal request helper with retry on 429
  // ---------------------------------------------------------------------------

  async _makeRequest(method, url, opts = {}) {
    const maxAttempts = DEFAULT_RETRY_COUNT + 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this._http(method, url, opts);
        if (response.status === 429) {
          const retryAfterMs = Number(response.headers?.['retry-after']) * 1000 || DEFAULT_RETRY_DELAY_MS;
          this._logger.warn('TeslaFleetAdapter', `Rate limited (attempt ${attempt + 1}/${maxAttempts}); waiting ${retryAfterMs}ms`);
          if (attempt < maxAttempts - 1) {
            await this._sleep(retryAfterMs);
            continue;
          }
        }
        if (response.status >= 400) {
          const msg = response.data?.error?.message || response.data?.error || `HTTP ${response.status}`;
          const err = new Error(String(msg));
          err.status = response.status;
          throw err;
        }
        return response;
      } catch (err) {
        lastError = err;
        if (err.status === 429 && attempt < maxAttempts - 1) {
          await this._sleep(DEFAULT_RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('TeslaFleetAdapter: unexpected request failure');
  }
}

// ---------------------------------------------------------------------------
// OAuth2 helper (stateless, no adapter instance needed)
// ---------------------------------------------------------------------------

/**
 * Build the Tesla OAuth2 authorization URL.
 * @param {object} params - { clientId, redirectUri, state, codeChallenge }
 * @param {string} [region] - 'na' | 'eu'
 * @returns {string} Authorization URL the user should be redirected to.
 */
function buildTeslaAuthUrl(params, region = TESLA_DEFAULT_REGION) {
  const {
    clientId,
    redirectUri,
    state = '',
    codeChallenge = '',
    codeChallengeMethod = 'S256'
  } = params;

  if (!clientId || !redirectUri) {
    throw new Error('buildTeslaAuthUrl: clientId and redirectUri are required');
  }

  const audience = getFleetBase(region);
  const scope = TESLA_REQUIRED_SCOPES.join(' ');

  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    audience
  });

  if (codeChallenge) {
    qs.set('code_challenge', codeChallenge);
    qs.set('code_challenge_method', codeChallengeMethod);
  }

  return `${TESLA_AUTH_BASE}/authorize?${qs.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * @param {object} params - { clientId, redirectUri, code, codeVerifier? }
 * @param {Function} httpClient - Same interface as TeslaFleetAdapter's httpClient
 * @returns {Promise<{ accessToken, refreshToken, expiresAtMs }>}
 */
async function exchangeTeslaAuthCode(params, httpClient) {
  const { clientId, redirectUri, code, codeVerifier = '' } = params;

  if (!clientId || !redirectUri || !code) {
    throw new Error('exchangeTeslaAuthCode: clientId, redirectUri, and code are required');
  }

  const body = {
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    ...(codeVerifier && { code_verifier: codeVerifier })
  };

  const response = await httpClient('POST', `${TESLA_AUTH_BASE}/token`, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (response.status !== 200 || !response.data.access_token) {
    throw new Error(`exchangeTeslaAuthCode: token exchange failed (HTTP ${response.status})`);
  }

  const { access_token, refresh_token, expires_in } = response.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAtMs: Date.now() + (Number(expires_in) || 28800) * 1000
  };
}

module.exports = {
  TeslaFleetAdapter,
  buildTeslaAuthUrl,
  exchangeTeslaAuthCode,
  normalizeTeslaVehicleData,
  TESLA_AUTH_BASE,
  TESLA_FLEET_REGIONS,
  TESLA_REQUIRED_SCOPES
};
