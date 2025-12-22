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

// Module state - initialized via init()
let db = null;
let logger = null;
let getConfig = null;
let incrementApiCount = null;

/**
 * Initialize module with dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - Firestore admin instance
 * @param {Object} deps.logger - Logger instance (console or custom)
 * @param {Function} deps.getConfig - Function to get configuration
 * @param {Function} deps.incrementApiCount - Function to increment API counter
 */
function init(deps) {
  db = deps.db;
  logger = deps.logger || console;
  getConfig = deps.getConfig;
  incrementApiCount = deps.incrementApiCount;
  
  logger.info('[FoxESSAPI] Module initialized');
  
  return {
    generateFoxESSSignature,
    callFoxESSAPI
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
  const config = getConfig();
  let token = userConfig?.foxessToken || config.foxess.token;
  
  if (!token) {
    return { errno: 401, error: 'FoxESS token not configured' };
  }
  
  // Clean token - remove whitespace per Postman collection
  if (typeof token === 'string') {
    token = token.trim().replace(/\s+/g, '').replace(/[^\x20-\x7E]/g, '');
  }
  
  // NOTE: API counter is now incremented AFTER the call, only for successful responses
  // This prevents counting rate-limited or failed requests
  
  try {
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
    const timeout = setTimeout(() => controller.abort(), 10000);
    options.signal = controller.signal;
    
    const response = await fetch(url, options);
    clearTimeout(timeout);
    const text = await response.text();
    
    try {
      const result = JSON.parse(text);
      
      // Only count the API call if it was actually processed (not rate-limited)
      // errno 40402 = rate limit exceeded - don't count these as they didn't consume quota
      if (result.errno !== 40402 && userId && incrementApiCount) {
        await incrementApiCount(userId, 'foxess');
      }
      
      return { ...result, raw: text };
    } catch (jsonError) {
      logger.error(`[FoxESSAPI] Invalid JSON response: ${text.substring(0, 200)}`);
      return { errno: 500, error: 'Invalid JSON response from FoxESS', raw: text };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('[FoxESSAPI] Request timeout');
      return { errno: 408, error: 'Request timeout' };
    }
    logger.error(`[FoxESSAPI] Error: ${error.message}`);
    return { errno: 500, error: error.message };
  }
}

module.exports = { init };
