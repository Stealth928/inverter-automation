/**
 * Firebase Cloud Functions for Inverter App
 * 
 * This module provides:
 * - API endpoints (proxied from frontend)
 * - Scheduled automation tasks
 * - Shared API caching (Amber, Weather, FoxESS)
 * - Per-user automation execution
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// ==================== CONFIGURATION ====================
// Secrets are stored in Firebase Functions config or Secret Manager
// Set via: firebase functions:config:set foxess.token="xxx" amber.api_key="xxx"
const getConfig = () => ({
  foxess: {
    token: functions.config().foxess?.token || process.env.FOXESS_TOKEN || '',
    baseUrl: functions.config().foxess?.base_url || 'https://www.foxesscloud.com'
  },
  amber: {
    apiKey: functions.config().amber?.api_key || process.env.AMBER_API_KEY || '',
    baseUrl: functions.config().amber?.base_url || 'https://api.amber.com.au/v1'
  },
  automation: {
    intervalMs: 60000,
    cacheTtl: {
      amber: 60000,      // 60 seconds
      inverter: 300000,  // 5 minutes
      weather: 1800000   // 30 minutes
    }
  }
});

// ==================== EXPRESS APP ====================
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ==================== AUTH MIDDLEWARE ====================
/**
 * Middleware to verify Firebase ID token
 */
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ errno: 401, error: 'Unauthorized: No token provided' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ errno: 401, error: 'Unauthorized: Invalid token' });
  }
};

// Attempt to attach Firebase user info without enforcing auth (used by public endpoints)
const tryAttachUser = async (req) => {
  if (req.user) {
    return req.user;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    return decodedToken;
  } catch (error) {
    console.warn('[Auth] Optional token attach failed:', error.message);
    return null;
  }
};

// ==================== UNPROTECTED ENDPOINTS (Before Auth Middleware) ====================

// Health check (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Password reset (no auth required)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ errno: 400, error: 'Email is required' });
    }
    
    console.log(`[Auth] Password reset requested for: ${email}`);
    res.json({ 
      errno: 0, 
      msg: 'If this email exists, a password reset link has been sent. Please check your email.' 
    });
  } catch (error) {
    console.error('[Auth] Password reset error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Validate API credentials during setup (no auth required for initial validation)
app.post('/api/config/validate-keys', async (req, res) => {
  try {
    await tryAttachUser(req);
    const { device_sn, foxess_token, amber_api_key } = req.body;
    const errors = {};
    const failed_keys = [];
    
    // For unauthenticated setup, just validate the FoxESS token without saving
    // Once user is authenticated, they can complete setup via authenticated endpoint
    if (foxess_token && device_sn) {
      console.log(`[Validation] Testing FoxESS token`);
      const testConfig = { foxessToken: foxess_token, deviceSn: device_sn };
      const foxResult = await callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, testConfig, null);
      
      console.log(`[Validation] FoxESS API response:`, foxResult);
      
      if (!foxResult || foxResult.errno !== 0) {
        failed_keys.push('foxess_token');
        errors.foxess_token = foxResult?.msg || foxResult?.error || 'Invalid FoxESS token or API error';
      } else {
        // Check if device SN exists in the response
        const devices = foxResult.result?.data || [];
        const deviceFound = devices.some(d => d.deviceSN === device_sn);
        if (!deviceFound && devices.length > 0) {
          failed_keys.push('device_sn');
          errors.device_sn = `Device SN not found. Available: ${devices.map(d => d.deviceSN).join(', ')}`;
        } else if (!deviceFound && devices.length === 0) {
          // No devices returned - might be a token issue
          failed_keys.push('foxess_token');
          errors.foxess_token = 'No devices found. Please check your FoxESS token.';
        }
      }
    } else {
      if (!device_sn) {
        failed_keys.push('device_sn');
        errors.device_sn = 'Device Serial Number is required';
      }
      if (!foxess_token) {
        failed_keys.push('foxess_token');
        errors.foxess_token = 'FoxESS API Token is required';
      }
    }
    
    // If validation passed and user is authenticated, save config
    if (failed_keys.length === 0 && req.user?.uid) {
      const configData = {
        deviceSn: device_sn,
        foxessToken: foxess_token,
        amberApiKey: amber_api_key || '',
        setupComplete: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('users').doc(req.user.uid).collection('config').doc('main').set(configData, { merge: true });
      console.log(`[Validation] Config saved successfully for user ${req.user.uid}`);
    }
    
    if (failed_keys.length > 0) {
      return res.status(400).json({
        errno: 1,
        msg: `Validation failed for: ${failed_keys.join(', ')}`,
        failed_keys,
        errors
      });
    }
    
    res.json({ errno: 0, msg: 'Credentials validated successfully', result: { deviceSn: device_sn } });
  } catch (error) {
    console.error('[Validation] Error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Check if user setup is complete (no auth required for initial check during setup flow)
app.get('/api/config/setup-status', async (req, res) => {
  try {
    await tryAttachUser(req);
    // If user is authenticated (has ID token), check their Firestore config
    if (req.user?.uid) {
      const config = await getUserConfig(req.user.uid);
      const setupComplete = !!(config?.setupComplete && config?.deviceSn && config?.foxessToken);
      return res.json({ errno: 0, result: { setupComplete, hasDeviceSn: !!config?.deviceSn, hasFoxessToken: !!config?.foxessToken, hasAmberKey: !!config?.amberApiKey } });
    }
    
    // Unauthenticated user - setup not complete
    res.json({ errno: 0, result: { setupComplete: false, hasDeviceSn: false, hasFoxessToken: false, hasAmberKey: false } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Apply auth middleware to remaining API routes
app.use('/api', authenticateUser);

// ==================== PROTECTED ENDPOINTS (After Auth Middleware) ====================

// Health check with auth
app.get('/api/health/auth', (req, res) => {
  res.json({ ok: true, user: req.user.uid });
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate FoxESS API signature
 */
function generateFoxESSSignature(apiPath, token, timestamp) {
  const signaturePlain = `${apiPath}\\r\\n${token}\\r\\n${timestamp}`;
  return crypto.createHash('md5').update(signaturePlain).digest('hex');
}

/**
 * Call FoxESS API with user's credentials
 */
async function callFoxESSAPI(apiPath, method = 'GET', body = null, userConfig, userId = null) {
  const config = getConfig();
  const token = userConfig?.foxessToken || config.foxess.token;
  
  if (!token) {
    return { errno: 401, error: 'FoxESS token not configured' };
  }
  
  // Track API call if userId provided
  if (userId) {
    incrementApiCount(userId, 'foxess').catch(() => {});
  }
  
  try {
    const timestamp = Date.now();
    const signature = generateFoxESSSignature(apiPath, token, timestamp);
    
    const url = new URL(`${config.foxess.baseUrl}${apiPath}`);
    
    const options = {
      method: method,
      headers: {
        'X-Access-Token': token,
        'X-Timestamp': timestamp.toString(),
        'X-Signature': signature,
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
      return JSON.parse(text);
    } catch (err) {
      return { errno: -1, msg: 'Non-JSON response', raw: text };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { errno: 408, msg: 'Request timeout' };
    }
    return { errno: 500, msg: error.message };
  }
}

/**
 * Call Amber API
 */
async function callAmberAPI(path, queryParams = {}, userConfig, userId = null) {
  const config = getConfig();
  const apiKey = userConfig?.amberApiKey || config.amber.apiKey;
  
  if (!apiKey) {
    return { errno: 401, error: 'Amber API key not configured' };
  }
  
  // Track API call if userId provided
  if (userId) {
    incrementApiCount(userId, 'amber').catch(() => {});
  }
  
  const url = new URL(`${config.amber.baseUrl}${path}`);
  Object.keys(queryParams).forEach(k => {
    if (queryParams[k] !== undefined && queryParams[k] !== null) {
      url.searchParams.set(k, String(queryParams[k]));
    }
  });
  
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  };
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(url.toString(), { headers, signal: controller.signal });
    clearTimeout(timeout);
    const text = await resp.text();
    
    try {
      return JSON.parse(text);
    } catch (e) {
      return { errno: -1, error: 'Non-JSON response', raw: text };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { errno: 408, error: 'Request timeout' };
    }
    return { errno: 500, error: error.message };
  }
}

/**
 * Call Weather API (Open-Meteo)
 */
async function callWeatherAPI(place = 'Sydney', days = 3, userId = null) {
  // Track API call if userId provided
  if (userId) {
    incrementApiCount(userId, 'weather').catch(() => {});
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    // Geocode place
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en`;
    const geoResp = await fetch(geoUrl, { signal: controller.signal });
    const geoJson = await geoResp.json();
    
    let latitude, longitude, resolvedName, country;
    if (geoJson?.results?.length > 0) {
      const g = geoJson.results[0];
      latitude = g.latitude;
      longitude = g.longitude;
      resolvedName = g.name;
      country = g.country;
    } else {
      // Fallback to Sydney
      latitude = -33.9215;
      longitude = 151.0390;
      resolvedName = place;
      country = 'AU';
    }
    
    // Get forecast
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation,precipitation_probability,weathercode&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&current_weather=true&temperature_unit=celsius&timezone=auto&forecast_days=${days}`;
    const forecastResp = await fetch(forecastUrl, { signal: controller.signal });
    const forecastJson = await forecastResp.json();
    clearTimeout(timeout);
    
    return {
      source: 'open-meteo',
      place: { query: place, resolvedName, country, latitude, longitude },
      current: forecastJson.current_weather || null,
      hourly: forecastJson.hourly || null,
      daily: forecastJson.daily || null,
      raw: forecastJson
    };
  } catch (error) {
    return { errno: 500, error: error.message };
  }
}

/**
 * Get user config from Firestore
 */
async function getUserConfig(userId) {
  try {
    const configDoc = await db.collection('users').doc(userId).collection('config').doc('main').get();
    if (configDoc.exists) {
      return configDoc.data();
    }
    return null;
  } catch (error) {
    console.error('Error getting user config:', error);
    return null;
  }
}

/**
 * Get user automation state from Firestore
 */
async function getUserAutomationState(userId) {
  try {
    const stateDoc = await db.collection('users').doc(userId).collection('automation').doc('state').get();
    if (stateDoc.exists) {
      return stateDoc.data();
    }
    return {
      enabled: true,
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    };
  } catch (error) {
    console.error('Error getting automation state:', error);
    return null;
  }
}

/**
 * Save user automation state to Firestore
 */
async function saveUserAutomationState(userId, state) {
  try {
    await db.collection('users').doc(userId).collection('automation').doc('state').set(state, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving automation state:', error);
    return false;
  }
}

/**
 * Get user automation rules from Firestore
 */
async function getUserRules(userId) {
  try {
    const rulesSnapshot = await db.collection('users').doc(userId).collection('rules').get();
    const rules = {};
    rulesSnapshot.forEach(doc => {
      rules[doc.id] = doc.data();
    });
    return rules;
  } catch (error) {
    console.error('Error getting user rules:', error);
    return {};
  }
}

/**
 * Add entry to user history
 */
async function addHistoryEntry(userId, entry) {
  try {
    await db.collection('users').doc(userId).collection('history').add({
      ...entry,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error adding history entry:', error);
    return false;
  }
}

// ==================== API ENDPOINTS ====================

// Get user config
app.get('/api/config', async (req, res) => {
  try {
    const config = await getUserConfig(req.user.uid);
    res.json({ errno: 0, result: config || {} });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Save user config
app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    await db.collection('users').doc(req.user.uid).collection('config').doc('main').set(config, { merge: true });
    res.json({ errno: 0, msg: 'Config saved' });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get automation state
app.get('/api/automation/status', async (req, res) => {
  try {
    const state = await getUserAutomationState(req.user.uid);
    const rules = await getUserRules(req.user.uid);
    res.json({
      errno: 0,
      result: {
        ...state,
        rules,
        serverTime: Date.now(),
        nextCheckIn: getConfig().automation.intervalMs
      }
    });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Toggle automation
app.post('/api/automation/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    await saveUserAutomationState(req.user.uid, { enabled: !!enabled });
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Create/update automation rule
app.post('/api/automation/rule/create', async (req, res) => {
  try {
    const { name, enabled, priority, conditions, action, cooldownMinutes } = req.body;
    
    if (!name) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    const ruleId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rule = {
      name,
      enabled: enabled !== false,
      priority: priority || 50,
      conditions: conditions || {},
      action: action || {},
      cooldownMinutes: cooldownMinutes || 5,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set(rule, { merge: true });
    res.json({ errno: 0, result: { ruleId, ...rule } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Delete automation rule
app.post('/api/automation/rule/delete', async (req, res) => {
  try {
    const { ruleName } = req.body;
    
    if (!ruleName) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    const ruleId = ruleName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).delete();
    res.json({ errno: 0, result: { deleted: ruleName } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get automation history
app.get('/api/automation/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const historySnapshot = await db.collection('users').doc(req.user.uid)
      .collection('history')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const history = [];
    historySnapshot.forEach(doc => {
      history.push({ id: doc.id, ...doc.data() });
    });
    
    res.json({ errno: 0, result: history });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Inverter endpoints (proxy to FoxESS)
app.get('/api/inverter/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

app.get('/api/inverter/real-time', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    const result = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
      sn,
      variables: ['generationPower', 'pvPower', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC', 'batTemperature', 'ambientTemperation']
    }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Amber endpoints
app.get('/api/amber/sites', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await callAmberAPI('/sites', {}, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

app.get('/api/amber/prices', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const siteId = req.query.siteId;
    
    if (!siteId) {
      return res.status(400).json({ errno: 400, error: 'Site ID is required' });
    }
    
    const result = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 1 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Weather endpoint
app.get('/api/weather', async (req, res) => {
  try {
    const place = req.query.place || 'Sydney';
    const days = parseInt(req.query.days || '3', 10);
    const result = await callWeatherAPI(place, days, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Scheduler endpoints
app.get('/api/scheduler/v1/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    const result = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: sn }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

app.post('/api/scheduler/v1/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;
    const groups = req.body.groups || [];
    const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups }, userConfig, req.user.uid);
    
    // Log action to history
    await addHistoryEntry(req.user.uid, {
      type: 'scheduler_update',
      action: 'manual',
      groups,
      result: result.errno === 0 ? 'success' : 'failed'
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== API METRICS (USER-SPECIFIC) ====================

/**
 * Increment API call count for a user
 */
async function incrementApiCount(userId, apiType) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const docRef = db.collection('users').doc(userId).collection('metrics').doc(today);
  
  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      const data = doc.exists ? doc.data() : { foxess: 0, amber: 0, weather: 0 };
      data[apiType] = (data[apiType] || 0) + 1;
      data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(docRef, data, { merge: true });
    });
  } catch (error) {
    console.error('Error incrementing API count:', error);
  }
}

/**
 * Get API call metrics for a user
 */
app.get('/api/metrics/api-calls', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '7', 10);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    
    const metricsSnapshot = await db.collection('users').doc(req.user.uid)
      .collection('metrics')
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
      .limit(days)
      .get();
    
    const result = {};
    metricsSnapshot.forEach(doc => {
      result[doc.id] = {
        foxess: doc.data().foxess || 0,
        amber: doc.data().amber || 0,
        weather: doc.data().weather || 0
      };
    });
    
    // Fill in missing days with zeros
    for (let i = 0; i < days; i++) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      if (!result[key]) {
        result[key] = { foxess: 0, amber: 0, weather: 0 };
      }
    }
    
    res.json({ errno: 0, result });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== EXPORT EXPRESS APP AS CLOUD FUNCTION (2nd Gen) ====================
// Use the supported chaining API to set region and runtime options.
exports.api = functions.region('us-central1').runWith({ memory: '512MB' }).https.onRequest(app);

// ==================== SCHEDULED AUTOMATION ====================
/**
 * Scheduled function that runs every minute
 * Fetches shared API data (Amber, Weather) and processes automation for all active users
 * Note: Using Firestore document trigger instead of Cloud Scheduler for 1st Gen compatibility
 */
// Scheduled automation is handled by the backend server.js in 1st Gen
// Cloud Functions here only provides the API proxy and per-user endpoints

/**
 * Update shared cache with latest API data
 */
async function updateSharedCache() {
  const now = Date.now();
  const config = getConfig();
  
  try {
    // Check if cache is stale
    const cacheDoc = await db.collection('cache').doc('shared').get();
    const cache = cacheDoc.exists ? cacheDoc.data() : {};
    
    // Update Amber cache if stale
    if (!cache.amberUpdatedAt || (now - cache.amberUpdatedAt) > config.automation.cacheTtl.amber) {
      console.log('[Cache] Updating Amber prices...');
      const amberData = await callAmberAPI('/sites', {}, {});
      if (Array.isArray(amberData) && amberData.length > 0) {
        const siteId = amberData[0].id;
        const prices = await callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 1 }, {});
        await db.collection('cache').doc('shared').set({
          amber: prices,
          amberUpdatedAt: now
        }, { merge: true });
      }
    }
    
    // Update Weather cache if stale
    if (!cache.weatherUpdatedAt || (now - cache.weatherUpdatedAt) > config.automation.cacheTtl.weather) {
      console.log('[Cache] Updating Weather...');
      const weatherData = await callWeatherAPI('Sydney', 3);
      await db.collection('cache').doc('shared').set({
        weather: weatherData,
        weatherUpdatedAt: now
      }, { merge: true });
    }
  } catch (error) {
    console.error('[Cache] Error updating shared cache:', error);
  }
}

/**
 * Process automation for a single user
 */
async function processUserAutomation(userId) {
  try {
    // Get user's automation state
    const state = await getUserAutomationState(userId);
    if (!state || !state.enabled) {
      return; // Automation disabled for this user
    }
    
    // Get user's config and rules
    const userConfig = await getUserConfig(userId);
    const rules = await getUserRules(userId);
    
    if (Object.keys(rules).length === 0) {
      return; // No rules configured
    }
    
    // Get shared cache data
    const cacheDoc = await db.collection('cache').doc('shared').get();
    const cache = cacheDoc.exists ? cacheDoc.data() : {};
    
    // Get user's inverter data
    let inverterData = null;
    if (userConfig?.deviceSn) {
      inverterData = await callFoxESSAPI('/op/v0/device/real/query', 'POST', {
        sn: userConfig.deviceSn,
        variables: ['SoC', 'batTemperature', 'ambientTemperation', 'pvPower', 'loadsPower']
      }, userConfig);
    }
    
    // Evaluate rules (sorted by priority)
    const sortedRules = Object.entries(rules)
      .filter(([_, rule]) => rule.enabled)
      .sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
    
    for (const [ruleId, rule] of sortedRules) {
      const result = await evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig);
      if (result.triggered) {
        console.log(`[Automation] User ${userId}: Rule '${rule.name}' triggered`);
        break; // First triggered rule wins
      }
    }
    
    // Update last check time
    await saveUserAutomationState(userId, { lastCheck: Date.now() });
    
  } catch (error) {
    console.error(`[Automation] Error processing user ${userId}:`, error);
  }
}

/**
 * Evaluate a single automation rule
 */
async function evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig) {
  // TODO: Implement full rule evaluation logic
  // This is a simplified version - expand based on your existing server.js logic
  
  const conditions = rule.conditions || {};
  let allMet = true;
  
  // Check SoC condition
  if (conditions.soc?.enabled && inverterData?.result) {
    const socData = inverterData.result[0]?.datas?.find(d => d.variable === 'SoC');
    const soc = socData?.value;
    if (soc !== null) {
      const met = compareValue(soc, conditions.soc.operator, conditions.soc.value);
      if (!met) allMet = false;
    }
  }
  
  // Check price conditions
  if (conditions.feedInPrice?.enabled && Array.isArray(cache.amber)) {
    const feedIn = cache.amber.find(ch => ch.channelType === 'feedIn' && ch.type === 'CurrentInterval');
    if (feedIn) {
      const price = -feedIn.perKwh;
      const met = compareValue(price, conditions.feedInPrice.operator, conditions.feedInPrice.value);
      if (!met) allMet = false;
    }
  }
  
  // If all conditions met, apply action
  if (allMet && Object.keys(conditions).length > 0) {
    await applyRuleAction(userId, rule, userConfig);
    await addHistoryEntry(userId, {
      type: 'rule_triggered',
      ruleName: rule.name,
      ruleId,
      action: rule.action
    });
    return { triggered: true };
  }
  
  return { triggered: false };
}

/**
 * Compare a value using an operator
 */
function compareValue(actual, operator, target) {
  if (actual === null || actual === undefined) return false;
  switch (operator) {
    case '>': return actual > target;
    case '>=': return actual >= target;
    case '<': return actual < target;
    case '<=': return actual <= target;
    case '==': return actual == target;
    case '!=': return actual != target;
    default: return false;
  }
}

/**
 * Apply a rule's action
 */
async function applyRuleAction(userId, rule, userConfig) {
  // TODO: Implement scheduler update logic
  // This should create/update scheduler segments based on rule.action
  console.log(`[Automation] Applying action for user ${userId}:`, rule.action);
}

// ==================== USER CREATION TRIGGER ====================
/**
 * When a new user is created, initialize their Firestore documents
 * NOTE: This trigger is called manually from the frontend after sign-up
 * In future, we can use Firebase Auth triggers if available
 */
app.post('/api/auth/init-user', async (req, res) => {
  try {
    const userId = req.user.uid;
    const { email, displayName } = req.user;
    
    // Create user profile
    await db.collection('users').doc(userId).set({
      email,
      displayName: displayName || '',
      photoURL: req.user.photoURL || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Create default config
    await db.collection('users').doc(userId).collection('config').doc('main').set({
      deviceSn: '',
      foxessToken: '',
      amberApiKey: '',
      amberSiteId: '',
      weatherPlace: 'Sydney',
      automation: {
        intervalMs: 60000,
        enabled: true
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Create default automation state
    await db.collection('users').doc(userId).collection('automation').doc('state').set({
      enabled: false, // Disabled by default until user configures
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    }, { merge: true });
    
    console.log(`[Auth] User ${userId} initialized successfully`);
    res.json({ errno: 0, msg: 'User initialized' });
  } catch (error) {
    console.error('[Auth] Error initializing user:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== USER DELETION TRIGGER ====================
/**
 * When a user is deleted, clean up their Firestore documents
 * NOTE: This endpoint should be called before deleting the Firebase Auth user
 */
app.post('/api/auth/cleanup-user', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`[Auth] Cleaning up user: ${userId}`);
    
    // Delete user's subcollections
    const subcollections = ['config', 'automation', 'rules', 'history', 'notifications', 'metrics'];
    for (const subcol of subcollections) {
      const snapshot = await db.collection('users').doc(userId).collection(subcol).get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    
    // Delete user document
    await db.collection('users').doc(userId).delete();
    
    console.log(`[Auth] User ${userId} data cleaned up successfully`);
    res.json({ errno: 0, msg: 'User data deleted' });
  } catch (error) {
    console.error(`[Auth] Error cleaning up user:`, error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});
