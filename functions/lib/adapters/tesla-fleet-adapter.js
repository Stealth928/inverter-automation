'use strict';

// ---------------------------------------------------------------------------
// Tesla Fleet API Adapter
// ---------------------------------------------------------------------------
// Implements the EVAdapter interface against Tesla's Fleet API.
// Docs: https://developer.tesla.com/docs/fleet-api
//
// Current product scope is Tesla connection plus status visibility only.
// OAuth2 tokens are stored per vehicle and refreshed transparently.
// ---------------------------------------------------------------------------

const {
  EVAdapter,
  normalizeCommandResult,
  normalizeVehicleStatus
} = require('./ev-adapter');

const TESLA_AUTH_BASE = 'https://auth.tesla.com/oauth2/v3';
const TESLA_AUTH_BASE_FALLBACK = 'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3';
const TESLA_AUTH_BASE_CN = 'https://auth.tesla.cn/oauth2/v3';
const TESLA_FLEET_REGIONS = Object.freeze({
  na: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  eu: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
  cn: 'https://fleet-api.prd.cn.vn.cloud.tesla.cn'
});
const TESLA_DEFAULT_REGION = 'na';
const TESLA_VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

const TESLA_REQUIRED_SCOPES = Object.freeze([
  'openid',
  'email',
  'offline_access',
  'vehicle_device_data',
  'vehicle_charging_cmds'
]);

const TESLA_DIRECT_CHARGING_COMMANDS = Object.freeze({
  startCharging: 'charge_start',
  stopCharging: 'charge_stop',
  setChargeLimit: 'set_charge_limit',
  setChargingAmps: 'set_charging_amps'
});

const TESLA_COMMAND_NOOP_REASONS = Object.freeze({
  charge_start: new Set(['complete', 'is_charging', 'requested']),
  charge_stop: new Set(['not_charging']),
  set_charge_limit: new Set(['already_set']),
  set_charging_amps: new Set(['already_set'])
});

const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 30000;

function normalizeRegion(region) {
  const normalized = String(region || '').trim().toLowerCase();
  return TESLA_FLEET_REGIONS[normalized] ? normalized : TESLA_DEFAULT_REGION;
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

function parseRetryAfterMs(headers = {}) {
  const raw = headers?.['retry-after'];
  if (raw === undefined || raw === null || raw === '') return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(0, Math.floor(numeric * 1000));
  }

  const parsedDateMs = Date.parse(String(raw));
  if (Number.isFinite(parsedDateMs)) {
    return Math.max(0, parsedDateMs - Date.now());
  }

  return null;
}

function parseRateLimitResetMs(headers = {}) {
  const raw =
    headers?.['ratelimit-reset'] ??
    headers?.['rate-limit-reset'] ??
    headers?.['x-ratelimit-reset'] ??
    null;
  if (raw === undefined || raw === null || raw === '') return null;

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric < 1e6) return Math.max(0, Math.floor(numeric * 1000));
  if (numeric < 1e12) return Math.max(0, Math.floor((numeric * 1000) - Date.now()));
  return Math.max(0, Math.floor(numeric - Date.now()));
}

function resolveRateLimitBackoffMs(headers = {}) {
  return (
    parseRetryAfterMs(headers) ??
    parseRateLimitResetMs(headers) ??
    DEFAULT_RETRY_DELAY_MS
  );
}

function classifyTeslaApiCallCategory(method, url, categoryHint = '') {
  const hinted = String(categoryHint || '').trim().toLowerCase();
  if (hinted) return hinted;

  const normalizedMethod = String(method || '').trim().toUpperCase();
  const normalizedUrl = String(url || '').trim();
  let pathname = normalizedUrl;
  try {
    pathname = new URL(normalizedUrl).pathname || normalizedUrl;
  } catch {
    pathname = normalizedUrl;
  }
  const path = String(pathname || '').toLowerCase();

  if (/\/api\/1\/vehicles\/[^/]+\/command\//.test(path)) return 'command';
  if (path.endsWith('/wake_up')) return 'wake';
  if (path.endsWith('/fleet_status')) return 'data_request';
  if (path.endsWith('/vehicle_data')) return 'data_request';
  if (normalizedMethod === 'GET' && /\/api\/1\/vehicles\/[^/]+$/.test(path)) return 'data_request';
  if (path.includes('/oauth2/v3/token')) return 'auth';
  return 'other';
}

function normalizeTeslaCommandReason(reason) {
  return String(reason || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toFiniteInt(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
}

function isTeslaBillableStatus(statusCode) {
  const numeric = Number(statusCode);
  return Number.isFinite(numeric) && numeric >= 200 && numeric < 300;
}

function extractFleetStatusEntry(payload, vehicleVin) {
  const normalizedVin = normalizeTeslaVin(vehicleVin);
  const candidates = [];

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }
  if (Array.isArray(payload?.response)) {
    candidates.push(...payload.response);
  }
  if (Array.isArray(payload?.results)) {
    candidates.push(...payload.results);
  }
  if (Array.isArray(payload?.vehicles)) {
    candidates.push(...payload.vehicles);
  }
  if (normalizedVin && payload && typeof payload === 'object' && payload[normalizedVin] && typeof payload[normalizedVin] === 'object') {
    candidates.push(payload[normalizedVin]);
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    candidates.push(payload);
    if (payload.response && typeof payload.response === 'object' && !Array.isArray(payload.response)) {
      candidates.push(payload.response);
    }
  }

  const matchingEntry = candidates.find((entry) => {
    const candidateVin = normalizeTeslaVin(entry?.vin || entry?.vehicle_vin || entry?.vehicleId || '');
    return normalizedVin && candidateVin === normalizedVin;
  });
  return matchingEntry || candidates.find((entry) => entry && typeof entry === 'object') || null;
}

function buildTeslaCommandReadiness(raw = {}, options = {}) {
  const hasSignedCommandProxy = Boolean(options?.hasSignedCommandProxy);
  const vehicleCommandProtocolRequired = raw?.vehicle_command_protocol_required === true;
  const vehicleVin = normalizeTeslaVin(raw?.vin || options?.vehicleVin || '');
  const totalNumberOfKeys = toFiniteInt(raw?.total_number_of_keys, null);
  const firmwareVersion = String(raw?.firmware_version || '').trim() || null;
  const source = String(options?.source || 'fleet_status').trim() || 'fleet_status';

  let state = 'ready_direct';
  let transport = 'direct';
  let reasonCode = '';

  if (vehicleCommandProtocolRequired) {
    transport = 'signed';
    if (!vehicleVin) {
      state = 'read_only';
      reasonCode = 'vin_required_for_signed_commands';
    } else if (!hasSignedCommandProxy) {
      state = 'proxy_unavailable';
      reasonCode = 'signed_command_proxy_unavailable';
    } else {
      state = 'ready_signed';
    }
  }

  return {
    state,
    transport,
    source,
    vehicleVin: vehicleVin || null,
    vehicleCommandProtocolRequired,
    totalNumberOfKeys,
    firmwareVersion,
    ...(reasonCode ? { reasonCode } : {})
  };
}

function isVehicleCommandProtocolRequiredError(error) {
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  return (
    Number(error?.status) === 422 ||
    /vehicle_command_protocol_required/.test(message) ||
    /not_a_json_request/.test(message) ||
    /use the vehicle command protocol/.test(message) ||
    /requires signed command/.test(message)
  );
}

function isVirtualKeyMissingError(error) {
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  return /missing_key|public key has not been paired|no private key available|key has not been paired/.test(message);
}

function isProxyFailureError(error) {
  return Boolean(error?.isProxyFailure) || /proxy/.test(String(error?.message || '').toLowerCase());
}

function getTeslaAuthorizeBase(region = TESLA_DEFAULT_REGION) {
  return normalizeRegion(region) === 'cn' ? TESLA_AUTH_BASE_CN : TESLA_AUTH_BASE;
}

function resolveAuthBaseCandidates(region = TESLA_DEFAULT_REGION) {
  if (normalizeRegion(region) === 'cn') {
    return [TESLA_AUTH_BASE_CN];
  }
  return Array.from(new Set([TESLA_AUTH_BASE, TESLA_AUTH_BASE_FALLBACK].filter(Boolean)));
}

async function postTeslaTokenRequest(httpClient, body, logger = null, region = TESLA_DEFAULT_REGION) {
  let lastResponse = null;
  let lastError = null;
  const authBases = resolveAuthBaseCandidates(region);

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
    } catch (error) {
      lastError = error;
      if (index < authBases.length - 1) {
        logger?.warn?.(
          'TeslaFleetAdapter',
          `Token request failed via ${authBase}; retrying fallback host`
        );
        continue;
      }
      throw error;
    }
  }

  if (lastResponse) {
    throw new Error(`Tesla token exchange failed (HTTP ${lastResponse.status})`);
  }
  throw lastError || new Error('Tesla token exchange failed');
}

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
    const timeoutHandle = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, {
        method: upperMethod,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(controller ? { signal: controller.signal } : {})
      });

      const text = await response.text();
      return {
        status: response.status,
        data: maybeJsonParse(text),
        headers: toHeaderMap(response.headers)
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };
}

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
      ? Math.round(chargeState.est_battery_range * 1.60934)
      : null
  });
}

class TeslaFleetAdapter extends EVAdapter {
  constructor(deps = {}) {
    super();

    if (!deps.httpClient || typeof deps.httpClient !== 'function') {
      throw new Error('TeslaFleetAdapter requires an httpClient dependency');
    }

    this._http = deps.httpClient;
    this._region = normalizeRegion(deps.region);
    this._fleetBase = getFleetBase(this._region);
    this._logger = deps.logger || { debug: () => {}, warn: () => {}, error: () => {} };
    this._sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this._onApiCall = typeof deps.onApiCall === 'function' ? deps.onApiCall : null;
    this._signedCommandProxyUrl = String(
      deps.signedCommandProxyUrl ||
      process.env.TESLA_SIGNED_COMMAND_PROXY_URL ||
      ''
    ).trim().replace(/\/+$/, '');
    this._signedCommandProxyToken = String(
      deps.signedCommandProxyToken ||
      process.env.TESLA_SIGNED_COMMAND_PROXY_TOKEN ||
      ''
    ).trim();
  }

  supportsCommands() {
    return true;
  }

  supportsChargingCommands() {
    return true;
  }

  supportsWake() {
    return true;
  }

  _fleetBaseForContext(context) {
    const regionFromContext = context?.region || context?.credentials?.region || null;
    return getFleetBase(regionFromContext || this._region);
  }

  _emitApiCallMetric(opts = {}, payload = {}) {
    const perRequestHandler = typeof opts?.onApiCall === 'function' ? opts.onApiCall : null;
    const handler = perRequestHandler || this._onApiCall;
    if (typeof handler !== 'function') return;

    try {
      const result = handler(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          this._logger.warn('TeslaFleetAdapter', `API metric handler rejected: ${error?.message || error}`);
        });
      }
    } catch (error) {
      this._logger.warn('TeslaFleetAdapter', `API metric handler threw: ${error?.message || error}`);
    }
  }

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
      response = await postTeslaTokenRequest(this._http, body, this._logger, region);
    } catch (error) {
      throw new Error(`TeslaFleetAdapter: token refresh failed (${error.message})`, { cause: error });
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
      await context.persistCredentials({ ...credentials });
    }

    this._logger.debug('TeslaFleetAdapter', 'Access token refreshed successfully');
    return true;
  }

  async _requestWithAuthRefresh(context, requestFn) {
    try {
      return await requestFn(this._authHeaders(context));
    } catch (error) {
      if (!this._isAuthError(error)) {
        throw error;
      }

      const refreshed = await this._refreshContextCredentials(context);
      if (!refreshed) {
        throw error;
      }

      return requestFn(this._authHeaders(context));
    }
  }

  async getVehicleStatus(vehicleId, context) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/vehicle_data`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('GET', url, {
        headers,
        categoryHint: 'data_request',
        onApiCall: context?.recordTeslaApiCall
      })
    );

    const vehicleData = response.data?.response || response.data || {};
    return normalizeTeslaVehicleData(vehicleData);
  }

  _hasSignedCommandProxy() {
    return Boolean(this._signedCommandProxyUrl);
  }

  async getCommandReadiness(vehicleId, context = {}) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    if (!vehicleRef.vin) {
      return {
        state: 'ready_direct',
        transport: 'direct',
        source: 'assumed_no_vin',
        vehicleVin: null,
        vehicleCommandProtocolRequired: null,
        totalNumberOfKeys: null,
        firmwareVersion: null
      };
    }

    const url = `${fleetBase}/api/1/vehicles/fleet_status`;
    try {
      const response = await this._requestWithAuthRefresh(
        context,
        (headers) => this._makeRequest('POST', url, {
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: { vins: [vehicleRef.vin] },
          categoryHint: 'data_request',
          onApiCall: context?.recordTeslaApiCall
        })
      );
      const entry = extractFleetStatusEntry(response.data?.response ?? response.data, vehicleRef.vin) || {};
      return buildTeslaCommandReadiness(entry, {
        source: 'fleet_status',
        vehicleVin: vehicleRef.vin,
        hasSignedCommandProxy: this._hasSignedCommandProxy()
      });
    } catch (error) {
      this._logger.warn('TeslaFleetAdapter', `Command readiness lookup failed for ${vehicleRef.vin}: ${error?.message || error}`);
      if (this._isAuthError(error) || Number(error?.status) === 429 || Number(error?.status) >= 500 || isProxyFailureError(error)) {
        throw error;
      }
      return {
        state: 'read_only',
        transport: 'none',
        source: 'fleet_status_unavailable',
        vehicleVin: vehicleRef.vin,
        vehicleCommandProtocolRequired: null,
        totalNumberOfKeys: null,
        firmwareVersion: null,
        reasonCode: 'command_readiness_unavailable',
        warning: String(error?.message || 'fleet_status_unavailable')
      };
    }
  }

  _normalizeCommandResponse(commandPath, rawResponse, transport, readiness) {
    const response = rawResponse?.response || rawResponse || {};
    const reasonText = String(response?.reason || response?.error || '').trim();
    const reasonCode = normalizeTeslaCommandReason(reasonText);
    const noopReasons = TESLA_COMMAND_NOOP_REASONS[commandPath] || null;
    const isNoop = response?.result !== true && noopReasons && noopReasons.has(reasonCode);

    if (response?.result !== true && !isNoop) {
      const error = new Error(reasonText || `${commandPath} failed`);
      error.reasonCode = reasonCode || 'command_failed';
      error.transport = transport;
      error.commandPath = commandPath;
      error.readinessState = readiness?.state || '';
      if (isVehicleCommandProtocolRequiredError(error)) {
        error.isVehicleCommandProtocolRequired = true;
      }
      if (isVirtualKeyMissingError(error)) {
        error.isVirtualKeyMissing = true;
      }
      throw error;
    }

    return normalizeCommandResult({
      accepted: true,
      command: commandPath,
      status: isNoop ? 'noop' : 'confirmed',
      provider: 'tesla',
      transport,
      noop: isNoop,
      providerRef: reasonText,
      ...(reasonCode ? { reasonCode } : {}),
      readinessState: readiness?.state,
      vehicleCommandProtocolRequired: readiness?.vehicleCommandProtocolRequired
    });
  }

  _proxyHeaders(baseHeaders = {}) {
    return {
      ...baseHeaders,
      ...(this._signedCommandProxyToken
        ? { 'X-Tesla-Proxy-Token': this._signedCommandProxyToken }
        : {})
    };
  }

  async _sendDirectCommand(commandPath, vehicleId, context = {}, payload = {}, readiness = null) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/command/${commandPath}`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, {
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: payload,
        categoryHint: 'command',
        onApiCall: context?.recordTeslaApiCall
      })
    );
    return this._normalizeCommandResponse(commandPath, response.data, 'direct', readiness);
  }

  async _sendSignedCommand(commandPath, vehicleId, context = {}, payload = {}, readiness = null) {
    if (!this._hasSignedCommandProxy()) {
      const error = new Error('Tesla signed command proxy is not configured');
      error.status = 503;
      error.reasonCode = 'signed_command_proxy_unavailable';
      error.isProxyFailure = true;
      throw error;
    }

    const vehicleRef = resolveVehicleReference(vehicleId, context);
    if (!vehicleRef.vin) {
      const error = new Error('Tesla VIN is required for signed commands');
      error.status = 400;
      error.reasonCode = 'vin_required_for_signed_commands';
      throw error;
    }

    const url = `${this._signedCommandProxyUrl}/api/1/vehicles/${encodeURIComponent(vehicleRef.vin)}/command/${commandPath}`;
    try {
      const response = await this._requestWithAuthRefresh(
        context,
        (headers) => this._makeRequest('POST', url, {
          headers: this._proxyHeaders({
            ...headers,
            'Content-Type': 'application/json'
          }),
          body: payload,
          categoryHint: 'command',
          onApiCall: context?.recordTeslaApiCall
        })
      );
      return this._normalizeCommandResponse(commandPath, response.data, 'signed', readiness);
    } catch (error) {
      error.isProxyFailure = isProxyFailureError(error) || Number(error?.status) >= 500;
      throw error;
    }
  }

  async _executeChargingCommand(commandName, vehicleId, context = {}, payload = {}) {
    const commandPath = TESLA_DIRECT_CHARGING_COMMANDS[commandName];
    if (!commandPath) {
      throw new Error(`TeslaFleetAdapter: unsupported command ${commandName}`);
    }

    const readiness = context?.commandReadiness || await this.getCommandReadiness(vehicleId, context);

    if (readiness?.state === 'proxy_unavailable') {
      const error = new Error('Tesla vehicle requires signed commands, but the signed-command proxy is not configured');
      error.status = 503;
      error.reasonCode = readiness.reasonCode || 'signed_command_proxy_unavailable';
      error.isProxyFailure = true;
      throw error;
    }

    if (readiness?.state === 'read_only') {
      const error = new Error('Tesla charging commands are not ready for this vehicle');
      error.status = 409;
      error.reasonCode = readiness.reasonCode || 'tesla_command_not_ready';
      throw error;
    }

    if (readiness?.transport === 'signed') {
      return this._sendSignedCommand(commandPath, vehicleId, context, payload, readiness);
    }

    try {
      return await this._sendDirectCommand(commandPath, vehicleId, context, payload, readiness);
    } catch (error) {
      if (this._hasSignedCommandProxy() && isVehicleCommandProtocolRequiredError(error)) {
        return this._sendSignedCommand(commandPath, vehicleId, context, payload, {
          ...readiness,
          state: 'ready_signed',
          transport: 'signed',
          vehicleCommandProtocolRequired: true
        });
      }
      if (isVehicleCommandProtocolRequiredError(error)) {
        error.reasonCode = error.reasonCode || 'signed_command_proxy_required';
        error.isProxyFailure = true;
      }
      if (isVirtualKeyMissingError(error)) {
        error.reasonCode = error.reasonCode || 'missing_virtual_key';
        error.isVirtualKeyMissing = true;
      }
      throw error;
    }
  }

  async startCharging(vehicleId, context = {}) {
    return this._executeChargingCommand('startCharging', vehicleId, context, {});
  }

  async stopCharging(vehicleId, context = {}) {
    return this._executeChargingCommand('stopCharging', vehicleId, context, {});
  }

  async setChargeLimit(vehicleId, limitPct, context = {}) {
    const limit = Math.round(Number(limitPct));
    if (!Number.isFinite(limit) || limit < 50 || limit > 100) {
      throw new Error(`TeslaFleetAdapter.setChargeLimit: invalid limit ${limitPct}`);
    }
    return this._executeChargingCommand('setChargeLimit', vehicleId, context, { percent: limit });
  }

  async setChargingAmps(vehicleId, chargingAmps, context = {}) {
    const amps = Math.round(Number(chargingAmps));
    if (!Number.isFinite(amps) || amps < 1 || amps > 48) {
      throw new Error(`TeslaFleetAdapter.setChargingAmps: invalid charging amps ${chargingAmps}`);
    }
    return this._executeChargingCommand('setChargingAmps', vehicleId, context, { charging_amps: amps });
  }

  async wakeVehicle(vehicleId, context = {}) {
    const vehicleRef = resolveVehicleReference(vehicleId, context);
    const fleetBase = this._fleetBaseForContext(context);
    const url = `${fleetBase}/api/1/vehicles/${encodeURIComponent(vehicleRef.id)}/wake_up`;
    const response = await this._requestWithAuthRefresh(
      context,
      (headers) => this._makeRequest('POST', url, {
        headers,
        categoryHint: 'wake',
        onApiCall: context?.recordTeslaApiCall
      })
    );

    const payload = response.data?.response || response.data || {};
    const wakeState = String(payload?.state || payload?.vehicle_state || '').trim().toLowerCase();
    return {
      accepted: true,
      command: 'wakeVehicle',
      status: wakeState === 'online' ? 'online' : 'requested',
      provider: 'tesla',
      transport: 'direct',
      wakeState: wakeState || 'requested',
      asOfIso: new Date().toISOString()
    };
  }

  normalizeProviderError(error) {
    const isRateLimit = error && (error.status === 429 || /rate.?limit/i.test(error.message || ''));
    return {
      errno: isRateLimit ? 3429 : 3800,
      error: error && error.message ? error.message : 'Tesla Fleet API error',
      provider: 'tesla'
    };
  }

  async _makeRequest(method, url, opts = {}) {
    const maxAttempts = DEFAULT_RETRY_COUNT + 1;
    let lastError = null;
    const category = classifyTeslaApiCallCategory(method, url, opts?.categoryHint);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this._http(method, url, opts);
        const statusCode = Number(response?.status) || 0;
        const billable = isTeslaBillableStatus(statusCode);
        this._emitApiCallMetric(opts, {
          category,
          method: String(method || '').toUpperCase(),
          url: String(url || ''),
          status: statusCode,
          billable,
          attempt: attempt + 1
        });

        if (response.status === 429) {
          const retryAfterMs = resolveRateLimitBackoffMs(response.headers || {});
          this._logger.warn(
            'TeslaFleetAdapter',
            `Rate limited (attempt ${attempt + 1}/${maxAttempts}); waiting ${retryAfterMs}ms`
          );
          if (attempt < maxAttempts - 1) {
            await this._sleep(retryAfterMs);
            continue;
          }
        }
        if (response.status >= 400) {
          const message = response.data?.error?.message || response.data?.error || `HTTP ${response.status}`;
          const error = new Error(String(message));
          error.status = response.status;
          error.retryAfterMs = resolveRateLimitBackoffMs(response.headers || {});
          error.__teslaCallMetricLogged = true;
          throw error;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (error.status === 429 && attempt < maxAttempts - 1) {
          const retryAfterMs = Number(error.retryAfterMs) > 0
            ? Math.floor(Number(error.retryAfterMs))
            : DEFAULT_RETRY_DELAY_MS;
          await this._sleep(retryAfterMs);
          continue;
        }
        if (!error.__teslaCallMetricLogged) {
          const statusCode = Number(error?.status) || 0;
          const billable = isTeslaBillableStatus(statusCode);
          this._emitApiCallMetric(opts, {
            category,
            method: String(method || '').toUpperCase(),
            url: String(url || ''),
            status: statusCode,
            billable,
            attempt: attempt + 1,
            error: String(error?.message || 'Request failed')
          });
        }
        throw error;
      }
    }

    throw lastError || new Error('TeslaFleetAdapter: unexpected request failure');
  }
}

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

  return `${getTeslaAuthorizeBase(region)}/authorize?${qs.toString()}`;
}

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

  const response = await postTeslaTokenRequest(httpClient, body, null, region);
  const { access_token, refresh_token, expires_in, token_type, scope } = response.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAtMs: Date.now() + (Number(expires_in) || 28800) * 1000,
    tokenType: token_type || 'Bearer',
    scope: String(scope || '')
  };
}

module.exports = {
  TeslaFleetAdapter,
  createTeslaHttpClient,
  buildTeslaAuthUrl,
  exchangeTeslaAuthCode,
  normalizeTeslaVehicleData,
  normalizeTeslaVin,
  TESLA_AUTH_BASE,
  TESLA_AUTH_BASE_FALLBACK,
  TESLA_AUTH_BASE_CN,
  TESLA_FLEET_REGIONS,
  TESLA_REQUIRED_SCOPES
};