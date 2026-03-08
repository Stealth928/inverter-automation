/**
 * SigenEnergy Cloud API Client Module
 * Handles communication with the SigenEnergy cloud API (sigencloud.com)
 *
 * Key Features:
 * - AES-128-CBC password encryption (hardcoded key/IV per SigenEnergy SDK: "sigensigensigenp")
 * - OAuth2 Bearer token lifecycle: login → cache with expiry → auto-refresh via refresh_token
 * - Bearer auth header on all subsequent API calls
 * - Multi-region support: eu, cn, apac, us
 * - Client credentials: "sigen" / "sigen" (public constants — NOT server secrets)
 * - 10-second request timeout with AbortController
 * - Per-user API call tracking
 * - Emulator bypass for local dev
 *
 * Regional base URLs:
 *   eu:   https://api-eu.sigencloud.com/
 *   cn:   https://api-cn.sigencloud.com/
 *   apac: https://api-apac.sigencloud.com/
 *   us:   https://api-us.sigencloud.com/
 *
 * OAuth2 flow (application/x-www-form-urlencoded):
 *   POST {base}auth/oauth/token
 *   Authorization: Basic base64("sigen:sigen")
 *   Body: username=...&password={aes_encrypted}&grant_type=password
 *
 * Station info (called after login to resolve stationId + device SNs):
 *   GET {base}device/owner/station/home
 *   Authorization: Bearer {accessToken}
 *
 * NOTE: No Firebase secrets needed — SigenEnergy OAuth client credentials are
 * public constants provided in their official Python SDK (OAUTH_CLIENT_ID/SECRET = "sigen").
 *
 * Error ranges:
 *   3400 - generic SigenEnergy error
 *   3401 - token invalid / expired
 *   3402 - authentication failure (wrong username / password)
 *   3403 - rate limited
 *   3404 - upstream server error
 *   3405 - request timeout
 */

'use strict';

const crypto = require('crypto');

// Module state — initialized via init()
let _db = null;
let logger = null;
let getConfig = null;
let incrementApiCount = null;

// SigenEnergy OAuth constants (public — same across all regions as per official SDK)
const OAUTH_CLIENT_ID = 'sigen';
const OAUTH_CLIENT_SECRET = 'sigen';
const PASSWORD_AES_KEY = 'sigensigensigenp';
const PASSWORD_AES_IV  = 'sigensigensigenp';

const REGION_BASE_URLS = Object.freeze({
  eu:   'https://api-eu.sigencloud.com/',
  cn:   'https://api-cn.sigencloud.com/',
  apac: 'https://api-apac.sigencloud.com/',
  us:   'https://api-us.sigencloud.com/'
});

/**
 * Encrypt a plain-text password using AES-128-CBC (PKCS7 padding).
 * This exact algorithm is specified in the SigenEnergy SDK.
 *
 * Key and IV are both the 16-byte string "sigensigensigenp".
 * @param {string} password
 * @returns {string} base64-encoded ciphertext
 */
function encryptPassword(password) {
  const key = Buffer.from(PASSWORD_AES_KEY, 'utf8');
  const iv  = Buffer.from(PASSWORD_AES_IV,  'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true); // PKCS7 (default)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(password, 'utf8')),
    cipher.final()
  ]);
  return encrypted.toString('base64');
}

/**
 * Resolve the regional base URL for a given region key.
 * Falls back to 'apac' (most common for Australian users).
 * @param {string} [region]
 * @returns {string} base URL with trailing slash
 */
function resolveBaseUrl(region) {
  const key = String(region || 'apac').toLowerCase().trim();
  return REGION_BASE_URLS[key] || REGION_BASE_URLS.apac;
}

/**
 * Build the Basic Authorization header value for OAuth token requests.
 * @returns {string} "Basic <base64(sigen:sigen)>"
 */
function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString('base64');
}

/**
 * Normalize an HTTP/JSON error or success from the SigenEnergy REST API.
 * SigenEnergy responses wrap data in { data: ..., code?: ... } or plain objects.
 *
 * @param {Object|null} raw - Parsed JSON response body
 * @param {number} httpStatus - HTTP status code
 * @returns {{ errno: number, result?: any, error?: string }}
 */
function normalizeResponse(raw, httpStatus) {
  if (!raw || typeof raw !== 'object') {
    return { errno: 3400, error: 'Empty or non-JSON response from SigenEnergy API', raw };
  }

  // HTTP 401 → auth error
  if (httpStatus === 401) {
    return { errno: 3401, error: raw.message || raw.error || 'SigenEnergy token invalid or expired' };
  }

  // HTTP 429 → rate limited
  if (httpStatus === 429) {
    return { errno: 3403, error: 'SigenEnergy API rate limited' };
  }

  // HTTP 5xx → server error
  if (httpStatus >= 500) {
    return { errno: 3404, error: raw.message || 'SigenEnergy upstream server error' };
  }

  // HTTP 400 → usually bad credentials during login
  if (httpStatus === 400) {
    return { errno: 3402, error: raw.message || raw.error_description || 'SigenEnergy authentication failed' };
  }

  // Generic non-2xx
  if (httpStatus >= 400) {
    return { errno: 3400, error: raw.message || raw.error || `SigenEnergy API error (HTTP ${httpStatus})` };
  }

  // 2xx — extract inner data
  const data = raw.data !== undefined ? raw.data : raw;
  return { errno: 0, result: data, raw };
}

function normalizeStationId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeSnList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

/**
 * Initialize the module with live dependencies (mirrors foxess.js / sungrow.js init pattern).
 * Called twice in index.js: once with stubs at load time, then again with real deps.
 *
 * @param {Object} deps
 * @param {Object} deps.db                  - Firestore admin instance
 * @param {Object} [deps.logger]            - Logger (defaults to console)
 * @param {Function} deps.getConfig         - Function returning server config
 * @param {Function} deps.incrementApiCount - Function to increment API call counter
 * @returns {{ loginSigenergy, callSigenEnergyAPI, encryptPassword }}
 */
function init(deps) {
  _db = deps.db;
  logger = deps.logger || console;
  getConfig = deps.getConfig;
  incrementApiCount = deps.incrementApiCount;

  logger.info('[SigenEnergyAPI] Module initialized');

  return {
    loginSigenergy,
    callSigenEnergyAPI,
    encryptPassword
  };
}

/**
 * Authenticate with the SigenEnergy OAuth2 endpoint.
 * Persists accessToken + refreshToken to Firestore (users/{userId}/cache/sigenToken) when userId provided.
 *
 * @param {Object}      userConfig - Requires sigenUsername, sigenPassword, sigenRegion
 * @param {Object|null} db         - Firestore admin instance
 * @param {string|null} userId     - Firebase user ID
 * @returns {Promise<{ errno: number, result?: { accessToken, refreshToken, expiry, stationId, dcSnList, acSnList }, error?: string }>}
 */
async function loginSigenergy(userConfig, db, userId) {
  const isEmulator = !!(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
  if (isEmulator) {
    logger.info('[SigenEnergyAPI] Emulator mode: skipping live SigenEnergy login');
    return {
      errno: 0,
      result: {
        accessToken:  'emulated-access-token',
        refreshToken: 'emulated-refresh-token',
        expiryMs:     Date.now() + 3600000,
        region:       String(userConfig?.sigenRegion || 'apac'),
        stationId:    'emulated-station-id',
        dcSnList:     [],
        acSnList:     []
      }
    };
  }

  const serverConfig = getConfig ? getConfig() : {};
  const defaultRegion = serverConfig?.sigenergy?.defaultRegion || 'apac';
  const region   = String(userConfig?.sigenRegion || defaultRegion).toLowerCase();
  const username = String(userConfig?.sigenUsername || '').trim();
  const password = String(userConfig?.sigenPassword || '').trim();

  if (!username || !password) {
    return { errno: 3402, error: 'SigenEnergy username and password are required' };
  }

  const baseUrl = resolveBaseUrl(region);
  const tokenUrl = `${baseUrl}auth/oauth/token`;
  const encryptedPassword = encryptPassword(password);

  const body = new URLSearchParams({
    username,
    password: encryptedPassword,
    grant_type: 'password'
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuthHeader()
      },
      body: body.toString(),
      signal: controller.signal
    });
    clearTimeout(timeout);

    let parsed;
    try {
      parsed = await response.json();
    } catch {
      return { errno: 3400, error: 'SigenEnergy login returned unreadable response' };
    }

    if (!response.ok) {
      const normalized = normalizeResponse(parsed, response.status);
      return normalized;
    }

    const data = parsed.data || parsed;
    const accessToken  = String(data.access_token  || '');
    const refreshToken = String(data.refresh_token || '');
    const expiresIn    = Number(data.expires_in || 3600);

    if (!accessToken) {
      return { errno: 3402, error: 'SigenEnergy login succeeded but no access token returned' };
    }

    const expiryMs = Date.now() + expiresIn * 1000 - 60000; // 1-min safety margin

    // Fetch station info to get stationId + device SNs
    const stationResult = await _fetchStationInfo(baseUrl, accessToken);
    if (stationResult.errno !== 0) {
      return stationResult;
    }

    const station = stationResult.result;

    // Persist token cache to Firestore
    if (_db && userId && accessToken) {
      try {
        await _db
          .collection('users')
          .doc(userId)
          .collection('cache')
          .doc('sigenToken')
          .set({
            accessToken,
            refreshToken,
            expiryMs,
            region,
            stationId: station.stationId,
            dcSnList: station.dcSnList,
            acSnList: station.acSnList,
            updatedAt: new Date()
          }, { merge: false });
      } catch (e) {
        logger.warn('[SigenEnergyAPI] Failed to persist token to Firestore: ' + e.message);
      }
    }

    return {
      errno: 0,
      result: {
        accessToken,
        refreshToken,
        expiryMs,
        region,
        stationId: station.stationId,
        dcSnList:  station.dcSnList,
        acSnList:  station.acSnList
      }
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return { errno: 3405, error: 'SigenEnergy login timed out' };
    }
    return { errno: 3400, error: error.message || 'SigenEnergy login failed' };
  }
}

/**
 * Fetch station info — called during login to resolve stationId + device SNs.
 * GET {base}device/owner/station/home
 *
 * @param {string} baseUrl
 * @param {string} accessToken
 * @returns {Promise<{ errno: number, result?: Object, error?: string }>}
 */
async function _fetchStationInfo(baseUrl, accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${baseUrl}device/owner/station/home`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    let parsed;
    try { parsed = await response.json(); } catch { return { errno: 3400, error: 'SigenEnergy station info returned unreadable response' }; }

    if (!response.ok) return normalizeResponse(parsed, response.status);

    const data = parsed.data || parsed;
    return {
      errno: 0,
      result: {
        stationId:       normalizeStationId(data.stationId),
        hasPv:           data.hasPv           || false,
        hasEv:           data.hasEv           || false,
        hasAcCharger:    data.hasAcCharger    || false,
        acSnList:        normalizeSnList(data.acSnList),
        dcSnList:        normalizeSnList(data.dcSnList),
        onGrid:          data.onGrid          !== false,
        pvCapacity:      data.pvCapacity      || 0,
        batteryCapacity: data.batteryCapacity || 0
      }
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') return { errno: 3405, error: 'SigenEnergy station info timed out' };
    return { errno: 3400, error: error.message || 'SigenEnergy station info failed' };
  }
}

/**
 * Refresh an expired access token using the stored refresh token.
 * Updates Firestore cache.
 *
 * @param {string} baseUrl
 * @param {string} refreshToken
 * @param {string|null} userId
 * @returns {Promise<{ errno: number, result?: { accessToken, expiryMs }, error?: string }>}
 */
async function _refreshToken(baseUrl, refreshToken, userId) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${baseUrl}auth/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuthHeader()
      },
      body: body.toString(),
      signal: controller.signal
    });
    clearTimeout(timeout);

    let parsed;
    try { parsed = await response.json(); } catch { return { errno: 3401, error: 'SigenEnergy token refresh returned unreadable response' }; }
    if (!response.ok) return normalizeResponse(parsed, response.status);

    const data = parsed.data || parsed;
    const newAccessToken  = String(data.access_token  || '');
    const newRefreshToken = String(data.refresh_token || refreshToken);
    const expiresIn       = Number(data.expires_in    || 3600);
    if (!newAccessToken) return { errno: 3401, error: 'SigenEnergy token refresh: no access token in response' };

    const expiryMs = Date.now() + expiresIn * 1000 - 60000;

    if (_db && userId) {
      try {
        await _db.collection('users').doc(userId).collection('cache').doc('sigenToken')
          .set({ accessToken: newAccessToken, refreshToken: newRefreshToken, expiryMs, updatedAt: new Date() }, { merge: true });
      } catch (e) {
        logger.warn('[SigenEnergyAPI] Failed to persist refreshed token: ' + e.message);
      }
    }

    return { errno: 0, result: { accessToken: newAccessToken, refreshToken: newRefreshToken, expiryMs } };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') return { errno: 3405, error: 'SigenEnergy token refresh timed out' };
    return { errno: 3401, error: error.message || 'SigenEnergy token refresh failed' };
  }
}

/**
 * Make an authenticated HTTP request to the SigenEnergy REST API.
 * Handles token auto-refresh and re-login if token has expired.
 *
 * @param {string}      method      - HTTP method (GET, POST, PUT, DELETE)
 * @param {string}      path        - URL path relative to regional base (e.g. "device/sigen/station/energyflow")
 * @param {Object|null} [params]    - Query string params (for GET) or JSON body (for POST/PUT)
 * @param {Object}      userConfig  - User config with sigenUsername, sigenPassword, sigenRegion, sigenAccessToken, sigenRefreshToken, sigenTokenExpiry, sigenStationId
 * @param {string|null} [userId]    - Firebase user ID for API call counting
 * @returns {Promise<{ errno: number, result?: any, error?: string }>}
 */
async function callSigenEnergyAPI(method, path, params, userConfig, userId) {
  const isEmulator = !!(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
  if (isEmulator) {
    logger.info('[SigenEnergyAPI] Emulator mode: returning mock response for path=' + path);
    return { errno: 0, result: { _emulated: true }, raw: null };
  }

  const region  = String(userConfig?.sigenRegion || 'apac').toLowerCase();
  const baseUrl = resolveBaseUrl(region);

  // Resolve token — refresh if expired, re-login if no refresh token
  let accessToken  = userConfig?.sigenAccessToken  || '';
  let refreshToken = userConfig?.sigenRefreshToken || '';
  let expiryMs     = Number(userConfig?.sigenTokenExpiry || 0);
  let tokenExpired = !accessToken || Date.now() >= expiryMs;

  // If no valid token in userConfig, check the Firestore token cache before triggering a full re-login.
  // This avoids a re-login on every automation cycle when the token isn't serialised into userConfig.
  if (tokenExpired && _db && userId) {
    try {
      const cacheDoc = await _db
        .collection('users').doc(userId)
        .collection('cache').doc('sigenToken')
        .get();
      if (cacheDoc.exists) {
        const cached = cacheDoc.data() || {};
        if (cached.accessToken && Date.now() < Number(cached.expiryMs || 0)) {
          accessToken  = cached.accessToken;
          refreshToken = cached.refreshToken || refreshToken;
          expiryMs     = cached.expiryMs;
          tokenExpired = false; // cached token still valid
        } else if (cached.refreshToken && !refreshToken) {
          refreshToken = cached.refreshToken; // use cached refresh token in upcoming refresh attempt
        }
      }
    } catch (e) {
      logger.warn('[SigenEnergyAPI] Could not read token cache: ' + e.message);
    }
  }

  if (tokenExpired) {
    if (refreshToken) {
      const refreshResult = await _refreshToken(baseUrl, refreshToken, userId);
      if (refreshResult.errno !== 0) {
        // Refresh failed — attempt full re-login
        const loginResult = await loginSigenergy(userConfig, _db, userId);
        if (loginResult.errno !== 0) return loginResult;
        accessToken = loginResult.result.accessToken;
      } else {
        accessToken = refreshResult.result.accessToken;
      }
    } else {
      const loginResult = await loginSigenergy(userConfig, _db, userId);
      if (loginResult.errno !== 0) return loginResult;
      accessToken = loginResult.result.accessToken;
    }
  }

  // Build request URL
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  let url = `${baseUrl}${normalizedPath}`;

  const httpMethod = (method || 'GET').toUpperCase();
  let body;
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  if (httpMethod === 'GET' && params && typeof params === 'object') {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    if (qs) url = `${url}?${qs}`;
  } else if ((httpMethod === 'POST' || httpMethod === 'PUT') && params) {
    body = JSON.stringify(params);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { method: httpMethod, headers, body, signal: controller.signal });
    clearTimeout(timeoutId);

    let parsed;
    try { parsed = await response.json(); } catch {
      logger.error('[SigenEnergyAPI] Invalid JSON for path=' + path);
      return { errno: 3400, error: 'SigenEnergy returned an unreadable response' };
    }

    const normalized = normalizeResponse(parsed, response.status);

    if (normalized.errno !== 3403 && userId && incrementApiCount) {
      await incrementApiCount(userId, 'sigenergy');
    }

    logger.info(`[SigenEnergyAPI] ${httpMethod} ${path} errno=${normalized.errno}`, true);
    return normalized;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      logger.error('[SigenEnergyAPI] Request timeout for path=' + path);
      return { errno: 3405, error: 'SigenEnergy took too long to respond' };
    }
    logger.error('[SigenEnergyAPI] Fetch error: ' + error.message);
    return { errno: 3400, error: error.message || 'SigenEnergy API call failed' };
  }
}

module.exports = { init, encryptPassword, resolveBaseUrl, REGION_BASE_URLS };
