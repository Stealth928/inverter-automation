/**
 * Sungrow iSolarCloud API Client Module
 * Handles communication with Sungrow iSolarCloud Open API (Australian gateway)
 *
 * Key Features:
 * - MD5 sign generation: MD5(appKey + YYYYMMDD + appSecret) — refreshed daily
 * - User token lifecycle: login → cache with expiry → auto-refresh
 * - Unified service-dispatch model (all calls POST to /openapi/service with "service" routing key)
 * - result_code "1" = success; all other values are errors
 * - 10-second request timeout with AbortController
 * - Per-user API call tracking
 * - Emulator bypass for local dev
 *
 * Gateway URLs:
 *   Australia:  https://augateway.isolarcloud.com
 *   Global:     https://gateway.isolarcloud.com.hk
 *
 * iSolarCloud Open API reference:
 *   https://isolarcloud.com.au/home/openapidoc  (requires developer account)
 *
 * NOTE: App credentials (appKey + appSecret) are server-side secrets stored in Firebase config:
 *   sungrow.app_key, sungrow.app_secret
 * User credentials (username + password) are stored per-user in Firestore.
 */

'use strict';

const crypto = require('crypto');
const { createUpstreamCircuitBreaker } = require('../lib/services/upstream-circuit-breaker');

// Module state — initialized via init()
let _db = null;
let logger = null;
let getConfig = null;
let incrementApiCount = null;
const sungrowCircuitBreaker = createUpstreamCircuitBreaker({
  name: 'sungrow',
  failureThreshold: 3,
  openWindowMs: 60000,
  logger: console
});

function shouldTripSungrowCircuit(httpStatus, normalized = {}) {
  if (Number.isFinite(httpStatus) && httpStatus >= 500) {
    return true;
  }
  return normalized.errno === 408 || normalized.errno === 500 || normalized.errno === 3304;
}

function buildSungrowCircuitOpenResponse(state = sungrowCircuitBreaker.getState()) {
  return {
    errno: 503,
    error: 'Sungrow temporarily unavailable. Upstream protection is active; retry shortly.',
    circuitState: state.state,
    retryAfterMs: state.retryAfterMs || 0
  };
}

/**
 * Generate Sungrow API signature.
 * Sign = MD5(appKey + YYYYMMDD + appSecret) — changes daily.
 *
 * @param {string} appKey   - Developer app key
 * @param {string} appSecret - Developer app secret
 * @param {Date}   [date]   - Date to use (defaults to now; injected for testing)
 * @returns {string} MD5 hex signature
 */
function generateSungrowSign(appKey, appSecret, date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const curDay = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return crypto.createHash('md5').update(`${appKey}${curDay}${appSecret}`).digest('hex');
}

/**
 * Generate MD5 hash of a plain string (used for password hashing).
 * @param {string} value
 * @returns {string} MD5 hex
 */
function md5(value) {
  return crypto.createHash('md5').update(String(value || '')).digest('hex');
}

/**
 * Initialize module with dependencies (mirrors foxess.js init pattern).
 * @param {Object} deps
 * @param {Object} deps.db                  - Firestore admin instance
 * @param {Object} [deps.logger]            - Logger (defaults to console)
 * @param {Function} deps.getConfig         - Function returning server config
 * @param {Function} deps.incrementApiCount - Function to increment API call counter
 * @returns {{ generateSungrowSign, callSungrowAPI, loginSungrow }}
 */
function init(deps) {
  _db = deps.db;
  logger = deps.logger || console;
  getConfig = deps.getConfig;
  incrementApiCount = deps.incrementApiCount;
  sungrowCircuitBreaker.setLogger(logger);

  logger.info('[SungrowAPI] Module initialized');

  return {
    generateSungrowSign,
    callSungrowAPI,
    loginSungrow,
    getCircuitState: () => sungrowCircuitBreaker.getState(),
    resetCircuitState: () => sungrowCircuitBreaker.reset()
  };
}

/**
 * Build the common request envelope for a Sungrow API call.
 *
 * @param {string} service     - iSolarCloud service name (e.g. "connect", "queryDeviceListByTokenAndType")
 * @param {Object} reqBody     - Service-specific request body
 * @param {string} appKey      - Developer app key
 * @param {string} appSecret   - Developer app secret
 * @param {string} [token]     - User session token (empty string for login)
 * @param {string} [uid]       - User ID from prior login (empty string for login)
 * @returns {Object} Full request body ready for JSON serialization
 */
function buildRequestEnvelope(service, reqBody, appKey, appSecret, token = '', uid = '') {
  return {
    service,
    appkey: appKey,
    sign: generateSungrowSign(appKey, appSecret),
    sys_code: '900',
    token,
    uid,
    req_serial_num: `REQ_${Date.now()}`,
    reqBody
  };
}

/**
 * Normalize a raw iSolarCloud API response to the internal envelope format.
 * iSolarCloud uses result_code "1" for success; we normalize to errno=0 for success.
 *
 * @param {Object} raw - Parsed JSON response from Sungrow API
 * @returns {{ errno: number, result: any, error?: string, raw: Object }}
 */
function normalizeResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    return { errno: 500, error: 'Empty or non-JSON response from Sungrow API', raw };
  }
  const code = String(raw.result_code || '');
  if (code === '1') {
    return { errno: 0, result: raw.result_data, raw };
  }
  // Map known iSolarCloud error codes to our errno range (3300–3399)
  const numericCode = Number(code) || 0;
  const msg = raw.result_msg || raw.description || 'Sungrow API error';
  let errno = 3300; // generic Sungrow error
  if (code === '10011' || code === '10012' || msg.toLowerCase().includes('token')) {
    errno = 3301; // token invalid / expired
  } else if (code === '10007') {
    errno = 3302; // authentication failure
  } else if (code === '10002' || code === '10003') {
    errno = 3303; // rate limited / quota exceeded
  } else if (numericCode >= 500 || code === '10008') {
    errno = 3304; // upstream server error
  }
  return { errno, error: msg, resultCode: code, raw };
}

/**
 * Call the Sungrow iSolarCloud Open API.
 * All API operations use POST to /openapi/service with a service routing key.
 *
 * @param {string}      service    - Service routing key (e.g. "queryDeviceListByTokenAndType")
 * @param {Object}      reqBody    - Service-specific body object
 * @param {Object}      userConfig - User config with sungrowUsername, sungrowPassword, sungrowToken, sungrowUid
 * @param {string|null} userId     - Firebase user ID for API call counting
 * @returns {Promise<{ errno: number, result?: any, error?: string }>}
 */
async function callSungrowAPI(service, reqBody, userConfig, userId = null) {
  const circuitGate = sungrowCircuitBreaker.beforeRequest();
  if (!circuitGate.allowed) {
    return buildSungrowCircuitOpenResponse(sungrowCircuitBreaker.getState());
  }

  const config = getConfig();

  const appKey = config.sungrow?.appKey || process.env.SUNGROW_APP_KEY || '';
  const appSecret = config.sungrow?.appSecret || process.env.SUNGROW_APP_SECRET || '';
  const baseUrl = config.sungrow?.baseUrl || 'https://augateway.isolarcloud.com';

  if (!appKey || !appSecret) {
    return { errno: 3302, error: 'Sungrow app credentials not configured on server (sungrow.app_key / sungrow.app_secret)' };
  }

  // In emulator mode, skip live API calls
  const isEmulator = !!(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
  if (isEmulator && service !== 'connect') {
    logger.info('[SungrowAPI] Emulator mode: returning mock response for service=' + service);
    return { errno: 0, result: { _emulated: true }, raw: null };
  }

  // Resolve or refresh user token
  let token = userConfig?.sungrowToken || '';
  let uid = userConfig?.sungrowUid || '';

  // If no token cached, or token expired, attempt auto-login
  const tokenExpiry = userConfig?.sungrowTokenExpiry || 0;
  const needsLogin = !token || Date.now() >= tokenExpiry;

  if (needsLogin && service !== 'connect') {
    const loginResult = await loginSungrow(userConfig, _db, userId);
    if (loginResult.errno !== 0) {
      return loginResult;
    }
    token = loginResult.result.token;
    uid = loginResult.result.uid;
  }

  const body = buildRequestEnvelope(service, reqBody, appKey, appSecret, token, uid);
  const url = `${baseUrl}/openapi/service`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    if (userId && incrementApiCount) {
      await incrementApiCount(userId, 'sungrow').catch((error) => {
        logger.warn('[SungrowAPI] Failed to increment metrics: ' + (error?.message || error));
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await response.text();

    if (response.ok === false) {
      if (response.status >= 500) {
        sungrowCircuitBreaker.recordFailure(`HTTP ${response.status}`);
      } else {
        sungrowCircuitBreaker.recordSuccess();
      }
      return {
        errno: response.status >= 500 ? 503 : response.status,
        error: `Sungrow request failed with HTTP ${response.status}`,
        raw: text
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      sungrowCircuitBreaker.recordFailure('Invalid JSON response');
      logger.error('[SungrowAPI] Invalid JSON response: ' + text.substring(0, 200));
      return { errno: 500, error: 'Sungrow returned an unreadable response', raw: text };
    }

    const normalized = normalizeResponse(parsed);

    if (shouldTripSungrowCircuit(response.status, normalized)) {
      sungrowCircuitBreaker.recordFailure(normalized.error || `errno ${normalized.errno}`);
    } else {
      sungrowCircuitBreaker.recordSuccess();
    }

    logger.info('[SungrowAPI] service=' + service + ' errno=' + normalized.errno, true);
    return normalized;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      sungrowCircuitBreaker.recordFailure('Request timeout');
      logger.error('[SungrowAPI] Request timeout');
      return { errno: 408, error: 'Sungrow took too long to respond. Check your internet connection.' };
    }
    sungrowCircuitBreaker.recordFailure(error);
    logger.error('[SungrowAPI] Fetch error: ' + error.message);
    const isNetworkErr = error.name === 'TypeError' || (error.message || '').toLowerCase().includes('fetch');
    return {
      errno: 500,
      error: isNetworkErr
        ? 'Could not reach Sungrow iSolarCloud — check your internet connection.'
        : error.message
    };
  }
}

/**
 * Authenticate with iSolarCloud and return a user session token.
 * Persists the token to Firestore (users/{userId}/cache/sungrowToken) when userId is provided.
 *
 * Sungrow user password must be sent as MD5 hash per API spec.
 *
 * @param {Object}      userConfig - Requires sungrowUsername + sungrowPassword
 * @param {Object|null} db         - Firestore admin instance (for token persistence)
 * @param {string|null} userId     - Firebase user ID (for token persistence)
 * @returns {Promise<{ errno: number, result?: { token, uid, expirySec }, error?: string }>}
 */
async function loginSungrow(userConfig, db, userId) {
  const config = getConfig();
  const appKey = config.sungrow?.appKey || process.env.SUNGROW_APP_KEY || '';
  const appSecret = config.sungrow?.appSecret || process.env.SUNGROW_APP_SECRET || '';
  const baseUrl = config.sungrow?.baseUrl || 'https://augateway.isolarcloud.com';

  const username = userConfig?.sungrowUsername || '';
  const password = userConfig?.sungrowPassword || '';

  if (!appKey || !appSecret) {
    return { errno: 3302, error: 'Sungrow app credentials not configured on server' };
  }
  if (!username || !password) {
    return { errno: 3302, error: 'Sungrow username and password are required' };
  }

  const body = buildRequestEnvelope(
    'connect',
    {
      user_account: username,
      user_password: md5(password),
      login_type: '1',
      agreement_latest_signed_flag: 1,
      country_code: 'AU'
    },
    appKey,
    appSecret
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${baseUrl}/openapi/service`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await response.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { errno: 500, error: 'Sungrow login returned unreadable response' };
    }

    const normalized = normalizeResponse(parsed);
    if (normalized.errno !== 0) {
      return normalized;
    }

    const data = normalized.result || {};
    const token = String(data.token || '');
    const uid = String(data.uid || data.user_id || '');
    const expireSec = Number(data.expire_sec || data.expire_time || 7200);
    const expiryMs = Date.now() + expireSec * 1000 - 60000; // 1-minute safety margin

    // Persist token to Firestore cache so subsequent calls don't need to re-login
    if (db && userId && token) {
      try {
        await db
          .collection('users')
          .doc(userId)
          .collection('cache')
          .doc('sungrowToken')
          .set({ token, uid, expiryMs, updatedAt: new Date() }, { merge: false });
      } catch (e) {
        logger.warn('[SungrowAPI] Failed to persist token to Firestore: ' + e.message);
      }
    }

    return { errno: 0, result: { token, uid, expireSec, expiryMs } };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return { errno: 408, error: 'Sungrow login timed out' };
    }
    return { errno: 500, error: error.message || 'Sungrow login failed' };
  }
}

module.exports = { init };
