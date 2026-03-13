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
  'vehicle_device_data'
]);

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

  if (path.endsWith('/vehicle_data')) return 'data_request';
  if (normalizedMethod === 'GET' && /\/api\/1\/vehicles\/[^/]+$/.test(path)) return 'data_request';
  if (path.includes('/oauth2/v3/token')) return 'auth';
  return 'other';
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
        const billable = statusCode > 0 && statusCode < 500;
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
          const billable = statusCode > 0 && statusCode < 500;
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