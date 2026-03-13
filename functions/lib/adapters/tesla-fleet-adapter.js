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
const TESLA_AUTH_BASE_FALLBACK = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3';
const TESLA_FLEET_REGIONS = Object.freeze({
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com'
});
const TESLA_DEFAULT_REGION = 'na';
const TESLA_VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

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
const DEFAULT_HTTP_TIMEOUT_MS = 30000;

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

function normalizeVehicleId(vehicleId) {
  return String(vehicleId || '').trim().toUpperCase();
}

function normalizeTeslaVin(vin) {
  const normalized = normalizeVehicleId(vin);
  return TESLA_VIN_REGEX.test(normalized) ? normalized : '';
}

function resolveVehicleReference(vehicleId, context = {}) {
  const vin = normalizeTeslaVin(
    context?.vehicleVin ||
    context?.credentials?.vin ||
    vehicleId
  );
  if (vin) {
    return { id: vin, vin, kind: 'vin' };
  }

  const legacyId = String(
    context?.teslaVehicleId ||
    context?.credentials?.teslaVehicleId ||
    vehicleId ||
    ''
  ).trim();

  return { id: legacyId, vin: '', kind: 'legacy_id' };
}

function toNullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

function includesVehicleId(list, vehicleId) {
  if (!Array.isArray(list)) return false;
  const target = normalizeVehicleId(vehicleId);
  return list.some((item) => normalizeVehicleId(item) === target);
}

function readFleetVehicleInfo(responseEnvelope, vehicleId) {
  const vehicleInfo = responseEnvelope?.vehicle_info || responseEnvelope?.vehicleInfo || null;
  const target = normalizeVehicleId(vehicleId);
  if (!target || !vehicleInfo) return null;

  if (Array.isArray(vehicleInfo)) {
    return vehicleInfo.find((entry) => {
      const entryId = entry?.vin || entry?.vehicle_id || entry?.vehicleId || '';
      return normalizeVehicleId(entryId) === target;
    }) || null;
  }

  if (typeof vehicleInfo !== 'object') {
    return null;
  }

  const exact = vehicleInfo[vehicleId];
  if (exact && typeof exact === 'object') {
    return exact;
  }

  const matchingKey = Object.keys(vehicleInfo).find((key) => normalizeVehicleId(key) === target);
  return matchingKey ? vehicleInfo[matchingKey] : null;
}

function parseFleetStatusReadiness(responseData, vehicleId) {
  const envelope = responseData?.response || responseData || {};
  const info = readFleetVehicleInfo(envelope, vehicleId);

  const protocolRequired = toNullableBoolean(
    info?.vehicle_command_protocol_required ??
    info?.vehicleCommandProtocolRequired ??
    info?.command_protocol_required ??
    null
  );

  let keyPaired = toNullableBoolean(
    info?.key_paired ??
    info?.keyPaired ??
    null
  );

  if (keyPaired === null) {
    if (includesVehicleId(envelope?.key_paired_vins, vehicleId)) {
      keyPaired = true;
    } else if (includesVehicleId(envelope?.unpaired_vins, vehicleId)) {
      keyPaired = false;
    }
  }

  return { protocolRequired, keyPaired };
}

function toHeaderMap(headers) {
  if (!headers || typeof headers.forEach !== 'function') {
    return {};
  }
  const output = {};
  headers.forEach((value, key) => {
    output[String(key || '').toLowerCase()] = String(value || '');
  });
  return output;
}

function maybeJsonParse(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function encodeHttpBody(headers, body) {
  if (body === undefined || body === null) return undefined;
  const contentType = String(headers?.['Content-Type'] || headers?.['content-type'] || '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams();
    Object.entries(body || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      params.append(String(key), String(value));
    });
    return params.toString();
  }
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

function resolveAuthBaseCandidates() {
  return Array.from(new Set([TESLA_AUTH_BASE, TESLA_AUTH_BASE_FALLBACK].filter(Boolean)));
}

async function postTeslaTokenRequest(httpClient, body, logger = null) {
  let lastResponse = null;
  let lastError = null;
  const authBases = resolveAuthBaseCandidates();

  for (let index = 0; index < authBases.length; index++) {
    const authBase = authBases[index];
    try {
      const response = await httpClient('POST', `${authBase}/token`, {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (response.status === 200 && response.data?.access_token) {
        return response;
      }

      lastResponse = response;
      const isRecoverable = response.status === 404 || response.status >= 500;
      if (isRecoverable && index < authBases.length - 1) {
        logger?.warn?.(
          'TeslaFleetAdapter',
          `Token request returned HTTP ${response.status} via ${authBase}; retrying fallback host`
        );
        continue;
      }
      break;
    } catch (err) {
      lastError = err;
      if (index < authBases.length - 1) {
        logger?.warn?.(
          'TeslaFleetAdapter',
          `Token request failed via ${authBase}; retrying fallback host`
        );
        continue;
      }
      throw err;
    }
  }

  if (lastResponse) {
    throw new Error(`Tesla token exchange failed (HTTP ${lastResponse.status})`);
  }
  throw lastError || new Error('Tesla token exchange failed');
}

/**
 * Default HTTP client for Tesla Fleet integration.
 * Contract: (method, url, opts?) => { status, data, headers }
 */
function createTeslaHttpClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_HTTP_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') {
    throw new Error('createTeslaHttpClient requires a fetch implementation');
  }

  return async function teslaHttpClient(method, url, opts = {}) {
    const upperMethod = String(method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    const body = encodeHttpBody(headers, opts.body);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutHandle = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(url, {
        method: upperMethod,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(controller ? { signal: controller.signal } : {})
      });

      const text = await response.text();
      const data = maybeJsonParse(text);
      return {
        status: response.status,
        data,
        headers: toHeaderMap(response.headers)
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };
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
    this._signedCommandClient = deps.signedCommandClient || deps.signingClient || null;
    this._signingClient = deps.signingClient || null;
    this._sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  _fleetBaseForContext(context) {
    const regionFromContext = context?.region || context?.credentials?.region || null;
    return getFleetBase(regionFromContext || this._region);
  }

  _supportsSignedCommands() {
    return Boolean(
      this._signedCommandClient &&
      typeof this._signedCommandClient.sendCommand === 'function'
    );
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

    const region = normalizeRegion(credentials?.region || this._region);
    const body = {
      grant_type: 'refresh_token',
      client_id: credentials.clientId,
      refresh_token: credentials.refreshToken,
      audience: getFleetBase(region),
      ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {})
    };

    let response;
    try {
      response = await postTeslaTokenRequest(this._http, body, this._logger);
    } catch (err) {
      throw new Error(`TeslaFleetAdapter: token refresh failed (${err.message})`, { cause: err });
    }

    const { access_token, refresh_token, expires_in, token_type, scope } = response.data;
    return {
      accessToken: access_token,
      refreshToken: refresh_token || credentials.refreshToken,
      expiresAtMs: Date.now() + (Number(expires_in) || 28800) * 1000,
      tokenType: token_type || 'Bearer',
      scope: String(scope || '')
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

  _isAuthError(error) {
    if (!error) return false;
    if (Number(error.status) === 401) return true;
    const message = String(error.message || '').toLowerCase();
    return /unauthor|token|expired/.test(message);
  }

  async _refreshContextCredentials(context) {
    const credentials = context?.credentials;
    if (!credentials || !credentials.refreshToken || !credentials.clientId) {
      return false;
    }

    const refreshed = await this.refreshAccessToken(credentials);
    Object.assign(credentials, refreshed);

    if (typeof context?.persistCredentials === 'function') {
      await context.persistCredentials({
        ...credentials
      });
    }

    this._logger.debug('TeslaFleetAdapter', 'Access token refreshed successfully');
    return true;
  }

  async getCommandReadiness(vehicleId, context = {}) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    if (!vehicleRef.vin) {
      return {
        vehicleId: String(vehicleId),
        vehicleVin: '',
        checkedAtIso: new Date().toISOString(),
        protocolRequired: null,
        keyPaired: null,
        supportsSignedCommands: this._supportsSignedCommands(),
        transportMode: this._supportsSignedCommands() ? 'signed_command' : 'legacy_rest',
        readyForCommands: false,
        blockingReasons: ['vin_required']
      };
    }

    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/fleet_status`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, {
        headers,
        body: { vins: [vehicleRef.vin] }
      })
    );

    const readiness = parseFleetStatusReadiness(response.data, vehicleRef.vin);
    const supportsSignedCommands = this._supportsSignedCommands();
    const blockingReasons = [];

    if (readiness.protocolRequired === true && !supportsSignedCommands) {
      blockingReasons.push('signed_command_required');
    }
    if (readiness.protocolRequired === true && supportsSignedCommands && readiness.keyPaired === false) {
      blockingReasons.push('virtual_key_not_paired');
    }

    return {
      vehicleId: String(vehicleId),
      vehicleVin: vehicleRef.vin,
      checkedAtIso: new Date().toISOString(),
      protocolRequired: readiness.protocolRequired,
      keyPaired: readiness.keyPaired,
      supportsSignedCommands,
      transportMode: supportsSignedCommands ? 'signed_command' : 'legacy_rest',
      readyForCommands: blockingReasons.length === 0,
      blockingReasons
    };
  }

  async _requestWithAuthRefresh(context, requestFn) {
    try {
      return await requestFn(this._authHeaders(context));
    } catch (err) {
      if (!this._isAuthError(err)) {
        throw err;
      }

      const refreshed = await this._refreshContextCredentials(context);
      if (!refreshed) {
        throw err;
      }

      return requestFn(this._authHeaders(context));
    }
  }

  // ---------------------------------------------------------------------------
  // EVAdapter interface
  // ---------------------------------------------------------------------------

  async getVehicleStatus(vehicleId, context) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/vehicle_data`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('GET', url, { headers })
    );

    const vehicleData = response.data?.response || response.data || {};
    return normalizeTeslaVehicleData(vehicleData);
  }

  _shouldUseSignedTransport(context = {}) {
    return (
      context?.forceSignedCommands === true ||
      context?.commandReadiness?.protocolRequired === true
    );
  }

  async _sendSignedCommand(command, vehicleId, context = {}, payload = {}) {
    if (!this._supportsSignedCommands()) {
      throw new Error('Tesla signed command transport is not configured');
    }
    const vehicleVin = normalizeTeslaVin(
      context?.vehicleVin ||
      context?.credentials?.vin ||
      vehicleId
    );
    if (!vehicleVin) {
      throw new Error('Tesla VIN is required for signed command transport');
    }
    const credentials = context?.credentials || {};
    if (!credentials.accessToken) {
      throw new Error('Tesla access token is required for signed command transport');
    }

    const response = await this._signedCommandClient.sendCommand({
      command,
      vehicleVin,
      payload,
      region: normalizeRegion(context?.region || credentials.region || this._region),
      credentials
    });

    return normalizeTeslaCommandResult(response || {}, command);
  }

  async startCharging(vehicleId, context, _options = {}) {
    if (this._shouldUseSignedTransport(context)) {
      return this._sendSignedCommand('charge_start', vehicleId, context, {});
    }
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/command/charge_start`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, { headers, body: {} })
    );
    return normalizeTeslaCommandResult(response.data?.response || response.data, 'charge_start');
  }

  async stopCharging(vehicleId, context) {
    if (this._shouldUseSignedTransport(context)) {
      return this._sendSignedCommand('charge_stop', vehicleId, context, {});
    }
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/command/charge_stop`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, { headers, body: {} })
    );
    return normalizeTeslaCommandResult(response.data?.response || response.data, 'charge_stop');
  }

  async setChargeLimit(vehicleId, context, limitPct) {
    const limit = Math.round(Number(limitPct));
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new Error(`TeslaFleetAdapter.setChargeLimit: invalid limit ${limitPct}`);
    }

    if (this._shouldUseSignedTransport(context)) {
      return this._sendSignedCommand('set_charge_limit', vehicleId, context, { percent: limit });
    }
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/command/set_charge_limit`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, { headers, body: { percent: limit } })
    );
    return normalizeTeslaCommandResult(response.data?.response || response.data, 'set_charge_limit');
  }

  async wakeVehicle(vehicleId, context) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/wake_up`;

    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, { headers, body: {} })
    );
    const state = response.data?.response?.state || response.data?.state || '';

    if (state === 'online') {
      return { woken: true, vehicleId: String(vehicleId) };
    }

    // If not immediately online, poll until online or timeout
    const deadline = Date.now() + WAKE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await this._sleep(WAKE_POLL_INTERVAL_MS);
      const pollResp = await this._requestWithAuthRefresh(
        context,
        (headers) => this._makeRequest(
          'GET',
          `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}`,
          { headers }
        )
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
  const {
    clientId,
    clientSecret = '',
    redirectUri,
    code,
    codeVerifier = '',
    region = TESLA_DEFAULT_REGION
  } = params;

  if (!clientId || !redirectUri || !code) {
    throw new Error('exchangeTeslaAuthCode: clientId, redirectUri, and code are required');
  }
  if (!httpClient || typeof httpClient !== 'function') {
    throw new Error('exchangeTeslaAuthCode: httpClient is required');
  }

  const body = {
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    audience: getFleetBase(region),
    ...(clientSecret && { client_secret: clientSecret }),
    ...(codeVerifier && { code_verifier: codeVerifier })
  };

  const response = await postTeslaTokenRequest(httpClient, body);

  const { access_token, refresh_token, expires_in, token_type, scope } = response.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAtMs: Date.now() + (Number(expires_in) || 28800) * 1000,
    tokenType: token_type || 'Bearer',
    scope: String(scope || '')
  };
}

function createTeslaSignedCommandClient(options = {}) {
  const endpoint = String(options.endpoint || '').trim().replace(/\/+$/, '');
  if (!endpoint) return null;

  const authToken = String(options.authToken || '').trim();
  const httpClient = options.httpClient || createTeslaHttpClient(options);
  const logger = options.logger || { debug: () => {}, warn: () => {}, error: () => {} };

  return {
    async sendCommand({ command, vehicleVin, payload = {}, region = TESLA_DEFAULT_REGION, credentials = {} }) {
      const vin = normalizeTeslaVin(vehicleVin);
      if (!vin) {
        throw new Error('Tesla signed command client requires a valid VIN');
      }
      const accessToken = String(credentials.accessToken || '').trim();
      if (!accessToken) {
        throw new Error('Tesla signed command client requires access token');
      }
      const requestHeaders = {
        'Content-Type': 'application/json'
      };
      if (authToken) {
        requestHeaders.Authorization = `Bearer ${authToken}`;
      }

      const response = await httpClient('POST', `${endpoint}/command`, {
        headers: requestHeaders,
        body: {
          command: String(command || '').trim(),
          vehicleVin: vin,
          region: normalizeRegion(region),
          payload,
          accessToken
        }
      });

      if (!response || Number(response.status) >= 400) {
        const errorMessage =
          response?.data?.error?.message ||
          response?.data?.error ||
          `Signed command proxy returned HTTP ${response?.status || 500}`;
        throw new Error(String(errorMessage));
      }

      logger.debug('TeslaFleetAdapter', `Signed command dispatched via proxy for VIN ${vin}`);
      const data = response.data?.response || response.data || {};
      return {
        result: data.result === undefined ? true : Boolean(data.result),
        reason: String(data.reason || '')
      };
    }
  };
}

module.exports = {
  TeslaFleetAdapter,
  createTeslaHttpClient,
  createTeslaSignedCommandClient,
  buildTeslaAuthUrl,
  exchangeTeslaAuthCode,
  normalizeTeslaVehicleData,
  normalizeTeslaVin,
  TESLA_AUTH_BASE,
  TESLA_AUTH_BASE_FALLBACK,
  TESLA_FLEET_REGIONS,
  TESLA_REQUIRED_SCOPES
};
