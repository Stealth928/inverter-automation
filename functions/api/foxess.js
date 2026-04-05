/**
 * FoxESS API Client Module
 * Handles communication with FoxESS Cloud API with MD5 signature authentication
 * 
 * Key Features:
 * - MD5 signature generation with literal \r\n escape sequences
 * - Token cleaning (trim, remove whitespace, non-ASCII characters)
 * - Rate limit detection (errno 40402) - not counted toward quota
 * - 10-second timeout with AbortController
 * - Per-user API call tracking
 * 
 * NOTE: FoxESS scheduler operations have undocumented reordering behavior
 * See docs/FOXESS_SCHEDULER_REORDERING.md for details
 */

const crypto = require('crypto');
const { createUpstreamCircuitBreaker } = require('../lib/services/upstream-circuit-breaker');

// Module state - initialized via init()
let _db = null;
let logger = null;
let getConfig = null;
let incrementApiCount = null;
const foxessCircuitBreaker = createUpstreamCircuitBreaker({
  name: 'foxess',
  failureThreshold: 3,
  openWindowMs: 60000,
  logger: console
});

function isEmulatorRuntime() {
  return Boolean(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
}

function buildFoxessEmulatorResponse(apiPath, method, body = null, userConfig = {}) {
  const normalizedPath = String(apiPath || '').trim();
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const deviceSN = String(
    userConfig?.deviceSn
      || userConfig?.deviceSN
      || body?.deviceSN
      || 'EMULATOR-FOXESS'
  ).trim();

  if (normalizedPath === '/op/v1/device/scheduler/get') {
    return {
      errno: 0,
      msg: 'FoxESS emulator mode: returning mock scheduler state',
      result: {
        deviceSN,
        groups: []
      },
      raw: null
    };
  }

  if (normalizedPath === '/op/v1/device/scheduler/enable') {
    return {
      errno: 0,
      msg: 'FoxESS emulator mode: scheduler accepted',
      result: {
        deviceSN,
        accepted: true,
        groups: Array.isArray(body?.groups) ? body.groups : []
      },
      raw: null
    };
  }

  if (normalizedPath === '/op/v1/device/scheduler/set/flag') {
    return {
      errno: 0,
      msg: 'FoxESS emulator mode: scheduler flag updated',
      result: {
        deviceSN,
        enable: Number(body?.enable) === 0 ? 0 : 1
      },
      raw: null
    };
  }

  return {
    errno: 0,
    msg: 'FoxESS emulator mode: returning mock response',
    result: {
      _emulated: true,
      deviceSN,
      method: normalizedMethod,
      path: normalizedPath
    },
    raw: null
  };
}

function shouldTripFoxessCircuit(httpStatus, result = {}) {
  if (Number.isFinite(httpStatus) && httpStatus >= 500) {
    return true;
  }
  const errno = Number(result?.errno);
  return errno === 408 || errno === 500 || errno === 503 || errno === 504;
}

function buildFoxessCircuitOpenResponse(state = foxessCircuitBreaker.getState()) {
  return {
    errno: 503,
    error: 'FoxESS temporarily unavailable. Upstream protection is active; retry shortly.',
    circuitState: state.state,
    retryAfterMs: state.retryAfterMs || 0
  };
}

/**
 * Initialize module with dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - Firestore admin instance
 * @param {Object} deps.logger - Logger instance (console or custom)
 * @param {Function} deps.getConfig - Function to get configuration
 * @param {Function} deps.incrementApiCount - Function to increment API counter
 */
function init(deps) {
  _db = deps.db;
  logger = deps.logger || console;
  getConfig = deps.getConfig;
  incrementApiCount = deps.incrementApiCount;
  foxessCircuitBreaker.setLogger(logger);
  
  logger.info('[FoxESSAPI] Module initialized');
  
  return {
    generateFoxESSSignature,
    callFoxESSAPI,
    getCircuitState: () => foxessCircuitBreaker.getState(),
    resetCircuitState: () => foxessCircuitBreaker.reset()
  };
}

/**
 * Generate FoxESS API signature
 * NOTE: FoxESS expects literal backslash-r-backslash-n characters, NOT actual CRLF bytes
 * This matches the Postman collection which uses escaped \\r\\n
 * 
 * @param {string} apiPath - API path (without query parameters)
 * @param {string} token - FoxESS API token
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} MD5 signature hex string
 */
function generateFoxESSSignature(apiPath, token, timestamp) {
  // See CONFIGURATION.md -> "FoxESS API authentication / signature" for examples (curl, PowerShell, Node.js) and troubleshooting tips.
  const signaturePlain = `${apiPath}\\r\\n${token}\\r\\n${timestamp}`;
  const signature = crypto.createHash('md5').update(signaturePlain).digest('hex');
  return signature;
}

/**
 * Call FoxESS API with user's credentials
 * 
 * @param {string} apiPath - API path (e.g., '/op/v0/device/list')
 * @param {string} method - HTTP method ('GET', 'POST', etc.)
 * @param {Object|null} body - Request body for POST/PUT
 * @param {Object} userConfig - User configuration with foxessToken
 * @param {string|null} userId - User ID for API call tracking (optional)
 * @returns {Promise<Object>} { errno, msg, result, raw } or { errno, error }
 */
async function callFoxESSAPI(apiPath, method = 'GET', body = null, userConfig, userId = null) {
  if (isEmulatorRuntime()) {
    if (userId && incrementApiCount) {
      await incrementApiCount(userId, 'foxess').catch((error) => {
        logger.warn(`[FoxESSAPI] Failed to increment metrics: ${error?.message || error}`);
      });
    }
    logger.info('[FoxESSAPI] Emulator mode: returning mock response for path=' + apiPath);
    return buildFoxessEmulatorResponse(apiPath, method, body, userConfig);
  }

  const circuitGate = foxessCircuitBreaker.beforeRequest();
  if (!circuitGate.allowed) {
    return buildFoxessCircuitOpenResponse(foxessCircuitBreaker.getState());
  }

  const config = getConfig();
  let token = userConfig?.foxessToken || config.foxess.token;
  
  if (!token) {
    return { errno: 401, error: 'FoxESS token not configured' };
  }
  
  // Clean token - remove whitespace per Postman collection
  if (typeof token === 'string') {
    token = token.trim().replace(/\s+/g, '').replace(/[^\x20-\x7E]/g, '');
  }

  let timeout;
  
  try {
    if (userId && incrementApiCount) {
      await incrementApiCount(userId, 'foxess').catch((error) => {
        logger.warn(`[FoxESSAPI] Failed to increment metrics: ${error?.message || error}`);
      });
    }

    const timestamp = Date.now();
    
    // Split apiPath into base path for signature calculation
    // Signature should be calculated on the path WITHOUT query parameters
    const [basePath] = apiPath.split('?');
    const signature = generateFoxESSSignature(basePath, token, timestamp);
    
    const url = new URL(`${config.foxess.baseUrl}${apiPath}`);
    
    const options = {
      method: method,
      headers: {
        'token': token,
        'timestamp': timestamp.toString(),
        'signature': signature,
        'lang': 'en',
        'Content-Type': 'application/json'
      }
    };
    
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10000);
    options.signal = controller.signal;
    
    const response = await fetch(url, options);
    clearTimeout(timeout);
    const text = await response.text();

    if (response.ok === false) {
      if (shouldTripFoxessCircuit(response.status)) {
        foxessCircuitBreaker.recordFailure(`HTTP ${response.status}`);
      } else {
        foxessCircuitBreaker.recordSuccess();
      }
      return {
        errno: response.status >= 500 ? 503 : response.status,
        error: `FoxESS request failed with HTTP ${response.status}`,
        raw: text
      };
    }
    
    try {
      const result = JSON.parse(text);

      if (shouldTripFoxessCircuit(response.status, result)) {
        foxessCircuitBreaker.recordFailure(result?.error || result?.msg || `errno ${result?.errno}`);
      } else {
        foxessCircuitBreaker.recordSuccess();
      }
      
      return { ...result, raw: text };
    } catch (jsonError) {
      foxessCircuitBreaker.recordFailure('Invalid JSON response');
      logger.error(`[FoxESSAPI] Invalid JSON response: ${text.substring(0, 200)}`);
      return { errno: 500, error: 'FoxESS returned an unreadable response — please double-check your credentials and try again.', raw: text };
    }
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      foxessCircuitBreaker.recordFailure('Request timeout');
      logger.error('[FoxESSAPI] Request timeout');
      return { errno: 408, error: 'FoxESS took too long to respond. Check your internet connection and try again.' };
    }
    foxessCircuitBreaker.recordFailure(error);
    logger.error(`[FoxESSAPI] Error: ${error.message}`);
    const isNetworkErr = error.name === 'TypeError' || (error.message || '').toLowerCase().includes('fetch');
    return { errno: 500, error: isNetworkErr ? 'Could not reach FoxESS — check your internet connection and try again.' : error.message };
  }
}

module.exports = { init };
