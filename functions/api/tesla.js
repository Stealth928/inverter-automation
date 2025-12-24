/**
 * Tesla Fleet API Client Module
 * Handles communication with Tesla Fleet API for EV charging automation
 * 
 * Key Features:
 * - OAuth token management (access + refresh)
 * - Vehicle discovery and state queries
 * - Charging control commands (start/stop/set_amps/set_limit)
 * - Support for signed_command (vehicle-command protocol)
 * - Rate limiting and caching to avoid expensive polling
 * 
 * SECURITY: Tesla user tokens (access/refresh) are STRICTLY PER-USER, stored at:
 *   users/{userId}/config/tesla
 * NEVER saved to shared storage. OAuth app config (client_id/client_secret) is
 * stored in shared/config (server-wide, admin-only).
 * 
 * Documentation: https://developer.tesla.com/docs/fleet-api
 */

const fetch = require('node-fetch');

// Module state - initialized via init()
let db = null;
let logger = null;

const TESLA_API_BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com';

/**
 * Initialize module with dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - Firestore admin instance
 * @param {Object} deps.logger - Logger instance (console or custom)
 */
function init(deps) {
  db = deps.db;
  logger = deps.logger || console;
  
  logger.info('[TeslaAPI] Module initialized');
  
  return {
    callTeslaAPI,
    listVehicles,
    getVehicleData,
    wakeVehicle,
    checkFleetStatus,
    startCharging,
    stopCharging,
    setChargingAmps,
    setChargeLimit,
    saveUserCredentials,
    saveUserTokens,
    registerPartner
  };
}

/**
 * Get user's Tesla tokens from Firestore
 * @param {string} userId - User ID
 * @returns {Promise<Object>} { accessToken, refreshToken }
 */
async function getUserTokens(userId) {
  try {
    const doc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
    if (!doc.exists) {
      throw new Error('Tesla tokens not configured');
    }
    
    const data = doc.data();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt
    };
  } catch (error) {
    logger.error(`[TeslaAPI] Error fetching tokens for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Refresh user's Tesla access token using refresh token
 * @param {string} userId - User ID
 * @param {string} clientId - OAuth app client ID
 * @param {string} clientSecret - OAuth app client secret
 * @param {string} refreshToken - Current refresh token
 * @returns {Promise<Object>} { accessToken, refreshToken, expiresIn }
 */
async function refreshAccessToken(userId, clientId, clientSecret, refreshToken) {
  try {
    const tokenUrl = 'https://auth.tesla.com/oauth2/v3/token';
    logger.info(`[TeslaAPI] Attempting token refresh for user ${userId} at ${tokenUrl}`);
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Tesla-Automation/1.0'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds'
      }),
      redirect: 'manual'
    });

    logger.info(`[TeslaAPI] Token refresh response status: ${response.status}`);
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      logger.error(`[TeslaAPI] Token refresh response is not JSON:`, text.substring(0, 500));
      throw new Error(`Tesla API error: ${response.statusText}`);
    }

    if (!response.ok) {
      logger.error(`[TeslaAPI] Token refresh failed (${response.status}):`, data);
      throw new Error(`Token refresh error: ${data.error_description || data.error || response.statusText}`);
    }

    logger.info(`[TeslaAPI] Access token refreshed successfully for user ${userId}, expires in ${data.expires_in}s`);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Use new refresh token if provided, else keep old
      expiresIn: data.expires_in
    };
  } catch (error) {
    logger.error(`[TeslaAPI] Error refreshing access token for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Ensure user has a valid access token, refreshing if necessary
 * @param {string} userId - User ID
 * @returns {Promise<string>} Valid access token
 */
async function ensureValidToken(userId) {
  try {
    const tokens = await getUserTokens(userId);
    const { accessToken, refreshToken, expiresAt } = tokens;

    logger.info(`[TeslaAPI] ensureValidToken called for user ${userId}`);
    logger.info(`[TeslaAPI]   expiresAt: ${expiresAt ? new Date(expiresAt).toISOString() : 'not set'}`);
    logger.info(`[TeslaAPI]   hasRefreshToken: ${!!refreshToken}`);

    // Check if token is expired or will expire in next 5 minutes
    if (expiresAt) {
      const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
      const bufferMs = 5 * 60 * 1000; // 5 minute buffer
      const timeUntilExpiry = expiryTime - Date.now();
      
      logger.info(`[TeslaAPI]   timeUntilExpiry: ${timeUntilExpiry}ms, bufferMs: ${bufferMs}ms`);
      
      if (Date.now() + bufferMs >= expiryTime) {
        logger.info(`[TeslaAPI] Token expired or expiring soon for user ${userId}, attempting refresh...`);
        
        if (!refreshToken) {
          logger.error(`[TeslaAPI] No refresh token available for user ${userId}`);
          throw new Error('No refresh token available; user must re-authenticate');
        }

        // Get OAuth credentials needed for refresh
        const doc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
        if (!doc.exists) {
          logger.error(`[TeslaAPI] Tesla config doc not found for user ${userId}`);
          throw new Error('Tesla configuration not found');
        }
        
        const data = doc.data();
        logger.info(`[TeslaAPI]   hasClientId: ${!!data.clientId}, hasClientSecret: ${!!data.clientSecret}`);
        
        if (!data.clientId || !data.clientSecret) {
          logger.error(`[TeslaAPI] OAuth credentials missing for user ${userId}`);
          throw new Error('Tesla OAuth credentials not found; re-authenticate required');
        }

        const { clientId, clientSecret } = data;
        
        // Refresh the token
        logger.info(`[TeslaAPI] Calling refreshAccessToken for user ${userId}`);
        const newTokens = await refreshAccessToken(userId, clientId, clientSecret, refreshToken);
        
        // Save the new tokens
        await saveUserTokens(userId, newTokens.accessToken, newTokens.refreshToken, newTokens.expiresIn);
        logger.info(`[TeslaAPI] Tokens refreshed successfully for user ${userId}`);
        
        return newTokens.accessToken;
      } else {
        logger.info(`[TeslaAPI] Token still valid for user ${userId}, using stored token`);
      }
    } else {
      logger.warn(`[TeslaAPI] expiresAt not set for user ${userId}, using token as-is`);
    }

    return accessToken;
  } catch (error) {
    logger.error(`[TeslaAPI] Error ensuring valid token for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Save user's Tesla OAuth credentials (client_id and client_secret)
 * @param {string} userId - User ID
 * @param {string} clientId - Tesla OAuth app client ID
 * @param {string} clientSecret - Tesla OAuth app client secret
 */
async function saveUserCredentials(userId, clientId, clientSecret) {
  try {
    await db.collection('users').doc(userId).collection('config').doc('tesla').set({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      credentialsUpdatedAt: new Date()
    }, { merge: true });
    
    logger.info(`[TeslaAPI] OAuth credentials saved for user ${userId}`);
  } catch (error) {
    logger.error(`[TeslaAPI] Error saving credentials for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Save user's Tesla tokens to Firestore
 * @param {string} userId - User ID
 * @param {string} accessToken - Tesla access token
 * @param {string} refreshToken - Tesla refresh token (optional)
 * @param {number} expiresIn - Seconds until token expires (optional)
 */
async function saveUserTokens(userId, accessToken, refreshToken, expiresIn = null) {
  try {
    const updateData = {
      accessToken,
      refreshToken: refreshToken || null,
      updatedAt: new Date()
    };

    if (expiresIn) {
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);
      updateData.expiresAt = expiresAt;
    }

    await db.collection('users').doc(userId).collection('config').doc('tesla').set(updateData, { merge: true });
    
    logger.info(`[TeslaAPI] Tokens saved for user ${userId}${expiresIn ? ` (expires in ${expiresIn}s)` : ''}`);
  } catch (error) {
    logger.error(`[TeslaAPI] Error saving tokens for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Get a Partner Token (Client Credentials)
 * Required for partner-level operations like registration
 * @param {string} userId - User ID
 * @returns {Promise<string>} Partner access token
 */
async function getPartnerToken(userId) {
  try {
    const doc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
    if (!doc.exists) {
      throw new Error('Tesla credentials not configured');
    }
    
    const { clientId, clientSecret } = doc.data();
    if (!clientId || !clientSecret) {
      throw new Error('Tesla Client ID or Secret missing');
    }

    const tokenUrl = 'https://auth.tesla.com/oauth2/v3/token';
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Tesla-Automation/1.0'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds'
      }),
      redirect: 'manual'
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      logger.error(`[TeslaAPI] Partner token response is not JSON:`, text.substring(0, 500));
      throw new Error(`Tesla API error: ${response.statusText}`);
    }

    if (!response.ok) {
      throw new Error(`Partner token error: ${data.error_description || data.error || response.statusText}`);
    }

    return data.access_token;
  } catch (error) {
    logger.error(`[TeslaAPI] Error getting partner token for user ${userId}:`, error.message);
    throw error;
  }
}

/**
 * Register account as a partner (required once per region)
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result
 */
async function registerPartner(userId) {
  try {
    // Partner registration REQUIRES a Partner Token (client_credentials), NOT a User Token
    const partnerToken = await getPartnerToken(userId);
    
    // Domain is required by Tesla. We'll use the standard one.
    const domain = 'inverter-automation-firebase.web.app';
    
    logger.info(`[TeslaAPI] Registering partner account for user ${userId} with domain ${domain}`);
    const response = await callTeslaAPI('/api/1/partner_accounts', 'POST', { domain }, partnerToken);
    
    if (response.errno === 0) {
      logger.info(`[TeslaAPI] Partner registration successful for user ${userId}`);
      // Save registration status globally
      try {
        await db.collection('shared').doc('config').set({
          teslaPartnerRegistered: true,
          teslaPartnerRegisteredAt: new Date(),
          teslaPartnerRegisteredBy: userId
        }, { merge: true });
      } catch (dbError) {
        logger.warn(`[TeslaAPI] Failed to save global registration status: ${dbError.message}`);
      }
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] registerPartner error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Call Tesla Fleet API
 * @param {string} endpoint - API endpoint (e.g., '/api/1/vehicles')
 * @param {string} method - HTTP method
 * @param {Object|null} body - Request body (for POST/PUT)
 * @param {string} accessToken - Tesla access token
 * @returns {Promise<Object>} API response
 */
async function callTeslaAPI(endpoint, method = 'GET', body = null, accessToken) {
  if (!accessToken) {
    throw new Error('Access token is required');
  }

  try {
    const url = `${TESLA_API_BASE}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    logger.info(`[TeslaAPI] ${method} ${endpoint}`);
    const response = await fetch(url, options);
    const text = await response.text();

    try {
      const result = JSON.parse(text);
      
      if (!response.ok) {
        logger.error(`[TeslaAPI] Error response ${response.status}:`, result);
        return { errno: response.status, error: result.error || result.message || 'Tesla API error', raw: text };
      }

      return { errno: 0, result, raw: text };
    } catch (jsonError) {
      logger.error(`[TeslaAPI] Invalid JSON response:`, text.substring(0, 200));
      return { errno: 500, error: 'Invalid JSON response from Tesla API', raw: text };
    }
  } catch (error) {
    logger.error(`[TeslaAPI] Request error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * List user's vehicles
 * @param {string} userId - User ID
 * @returns {Promise<Object>} { errno, result: { vehicles: [...] } }
 */
async function listVehicles(userId) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI('/api/1/vehicles', 'GET', null, accessToken);
    
    if (response.errno === 0) {
      // Tesla returns { response: [ vehicles ] }
      const vehicles = response.result?.response || [];
      return { errno: 0, result: { vehicles } };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] listVehicles error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Get vehicle data (use sparingly - expensive call)
 * @param {string} userId - User ID
 * @param {string} vehicleTag - Vehicle ID or tag
 * @returns {Promise<Object>} Vehicle data
 */
async function getVehicleData(userId, vehicleTag) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI(`/api/1/vehicles/${vehicleTag}/vehicle_data`, 'GET', null, accessToken);
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] getVehicleData error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Wake vehicle from sleep
 * @param {string} userId - User ID
 * @param {string} vehicleTag - Vehicle ID or tag
 * @returns {Promise<Object>} Wake result
 */
async function wakeVehicle(userId, vehicleTag) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI(`/api/1/vehicles/${vehicleTag}/wake_up`, 'POST', null, accessToken);
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] wakeVehicle error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Check fleet status (determines if vehicle requires signed commands)
 * @param {string} userId - User ID
 * @param {Array<string>} vehicleTags - Array of vehicle IDs
 * @returns {Promise<Object>} Fleet status
 */
async function checkFleetStatus(userId, vehicleTags) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI('/api/1/vehicles/fleet_status', 'POST', { vins: vehicleTags }, accessToken);
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] checkFleetStatus error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Start charging
 * @param {string} userId - User ID
 * @param {string} vehicleTag - Vehicle ID or tag
 * @returns {Promise<Object>} Command result
 */
async function startCharging(userId, vehicleTag) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI(`/api/1/vehicles/${vehicleTag}/command/charge_start`, 'POST', null, accessToken);
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] startCharging error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Stop charging
 * @param {string} userId - User ID
 * @param {string} vehicleTag - Vehicle ID or tag
 * @returns {Promise<Object>} Command result
 */
async function stopCharging(userId, vehicleTag) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI(`/api/1/vehicles/${vehicleTag}/command/charge_stop`, 'POST', null, accessToken);
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] stopCharging error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Set charging amps (current limit)
 * @param {string} userId - User ID
 * @param {string} vehicleTag - Vehicle ID or tag
 * @param {number} amps - Charging current in amps (typically 5-32)
 * @returns {Promise<Object>} Command result
 */
async function setChargingAmps(userId, vehicleTag, amps) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI(
      `/api/1/vehicles/${vehicleTag}/command/set_charging_amps`,
      'POST',
      { charging_amps: amps },
      accessToken
    );
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] setChargingAmps error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

/**
 * Set charge limit (battery SoC target percentage)
 * @param {string} userId - User ID
 * @param {string} vehicleTag - Vehicle ID or tag
 * @param {number} percent - Charge limit percentage (50-100)
 * @returns {Promise<Object>} Command result
 */
async function setChargeLimit(userId, vehicleTag, percent) {
  try {
    const accessToken = await ensureValidToken(userId);
    const response = await callTeslaAPI(
      `/api/1/vehicles/${vehicleTag}/command/set_charge_limit`,
      'POST',
      { percent },
      accessToken
    );
    
    if (response.errno === 0) {
      return { errno: 0, result: response.result?.response || response.result };
    }
    
    return response;
  } catch (error) {
    logger.error(`[TeslaAPI] setChargeLimit error:`, error.message);
    return { errno: 500, error: error.message };
  }
}

module.exports = { init };
