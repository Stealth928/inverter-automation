/**
 * Firebase Cloud Functions for Inverter App
 * Version: 2.3.0 - Timezone Support (Auto-detect from weather location)
 * 
 * This module provides:
 * - API endpoints (proxied from frontend)
 * - Scheduled automation tasks
 * - Shared API caching (Amber, Weather, FoxESS)
 * - Per-user automation execution
 * - Multi-timezone support for global users
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const amberModule = require('./api/amber');
let googleApis = null;
try {
  ({ google: googleApis } = require('googleapis'));
} catch (e) {
  console.warn('[Init] googleapis package not available; admin cost metrics endpoint will be disabled');
}

// Initialize Firebase Admin SDK (guarded to avoid double-initialize in tests)
if (!admin.apps || admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
// Helper to safely access serverTimestamp() when running against emulators
const serverTimestamp = () => {
  try {
    return (admin && admin.firestore && admin.firestore.FieldValue) ? admin.firestore.FieldValue.serverTimestamp() : new Date();
  } catch (e) {
    return new Date();
  }
};

// Helper to safely access FieldValue.delete() when running against emulators
const deleteField = () => {
  try {
    return (admin && admin.firestore && admin.firestore.FieldValue) ? admin.firestore.FieldValue.delete() : null;
  } catch (e) {
    return null;
  }
};

/**
 * Deep merge two objects, preserving nested fields from target that aren't in source
 * This is critical for config updates to prevent accidentally clearing nested settings
 * @param {Object} target - Existing config (from Firestore)
 * @param {Object} source - New config (from user update)
 * @returns {Object} Merged config with all fields preserved
 */
function deepMerge(target, source) {
  // Handle null/undefined
  if (!target) return source;
  if (!source) return target;
  
  const output = { ...target };
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      // If both are objects (and not arrays), recurse
      if (
        source[key] && 
        typeof source[key] === 'object' && 
        !Array.isArray(source[key]) &&
        target[key] && 
        typeof target[key] === 'object' && 
        !Array.isArray(target[key])
      ) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        // Otherwise, use the source value (arrays and primitives overwrite)
        output[key] = source[key];
      }
    }
  }
  
  return output;
}

// Initialize API modules with dependencies
const amberAPI = amberModule.init({
  db,
  logger: null, // Will be defined below
  getConfig: null, // Will be defined below
  incrementApiCount: null // Will be defined below
});

// Import shared state from amber module (used for concurrency control)
const { amberPricesInFlight } = amberModule;

const foxessModule = require('./api/foxess');
const foxessAPI = foxessModule.init({
  db,
  logger: null, // Will be defined below
  getConfig: null, // Will be defined below
  incrementApiCount: null // Will be defined below
});

const authModule = require('./api/auth');
const authAPI = authModule.init({
  admin,
  logger: null // Will be defined below
});

// For 2nd Gen runtime: ensure pubsub is available
// This handles test environments where pubsub might not be fully initialized
if (typeof functions.pubsub === 'undefined' || typeof functions.pubsub.schedule !== 'function') {
  console.warn('[Init] Firebase pubsub not available in current environment, using fallback');
}

// ==================== CONFIGURATION ====================
// Secrets are stored in Firebase Functions config or Secret Manager
// Set via: firebase functions:config:set foxess.token="xxx" amber.api_key="xxx"
const getConfig = () => {
  let ffConfig = {};
  try {
    ffConfig = functions.config() || {};
  } catch (e) {
    // functions.config() may not be available in 2nd gen runtimes.
    ffConfig = {};
  }

  return {
    foxess: {
      token: (ffConfig.foxess && ffConfig.foxess.token) || process.env.FOXESS_TOKEN || '',
      baseUrl: (ffConfig.foxess && ffConfig.foxess.base_url) || process.env.FOXESS_BASE_URL || 'https://www.foxesscloud.com'
    },
    amber: {
      apiKey: (ffConfig.amber && ffConfig.amber.api_key) || process.env.AMBER_API_KEY || '',
      baseUrl: (ffConfig.amber && ffConfig.amber.base_url) || process.env.AMBER_BASE_URL || 'https://api.amber.com.au/v1'
    },
    automation: {
      intervalMs: 60000,
      timeZone: 'Australia/Sydney',
      cacheTtl: {
        amber: 60000,      // 60 seconds
        inverter: 300000,  // 5 minutes
        weather: 1800000   // 30 minutes
      }
    }
  };
};

// Default timezone constant derived from config (can be overridden via functions.config())
// NOTE: This is computed once at module load time. If timezone is changed via Firebase config,
// the service must be redeployed for the change to take effect. Users in different timezones
// will use their stored config.timezone value, falling back to this default.
const DEFAULT_TIMEZONE = (getConfig().automation && getConfig().automation.timeZone) || 'Australia/Sydney';

// ==================== LOGGING CONFIGURATION ====================
// Control logging verbosity via environment variables
const DEBUG = process.env.DEBUG === 'true';
const VERBOSE = process.env.VERBOSE === 'true';
const VERBOSE_API = process.env.VERBOSE_API === 'true';

// Centralized logger utility for consistent formatting and easy control
const logger = {
  error: (tag, message) => {
    console.error(`[${tag}] ${message}`);
  },
  warn: (tag, message) => {
    console.warn(`[${tag}] ${message}`);
  },
  info: (tag, message, onlyIfVerbose = false) => {
    if (!onlyIfVerbose || VERBOSE) {
      console.log(`[${tag}] ${message}`);
    }
  },
  debug: (tag, message) => {
    if (DEBUG) {
      console.log(`[${tag}] [DEBUG] ${message}`);
    }
  }
};

// ==================== CACHED INVERTER DATA HELPER ====================
/**
 * Get inverter data with per-user Firestore cache.
 * Respects TTL (default 5 minutes, configurable via user config).
 * Only fetches fresh data if cache is expired.
 */
async function getCachedInverterData(userId, deviceSN, userConfig, forceRefresh = false) {
  const config = getConfig();
  // Use user's custom TTL if set, otherwise fall back to default
  const ttlMs = (userConfig?.automation?.inverterCacheTtlMs) || config.automation.cacheTtl.inverter;
  
  try {
    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter').get();
      if (cacheDoc.exists) {
        const { data, timestamp } = cacheDoc.data();
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs) {
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
      }
    }
    
    // Fetch fresh data from FoxESS
    const data = await foxessAPI.callFoxESSAPI('/op/v0/device/real/query', 'POST', {
      sn: deviceSN,
      variables: ['SoC', 'batTemperature', 'ambientTemperation', 'pvPower', 'loadsPower', 'gridConsumptionPower', 'feedinPower']
    }, userConfig, userId);
    
    // Store in cache if successful
    if (data?.errno === 0) {
      await db.collection('users').doc(userId).collection('cache').doc('inverter').set({
        data,
        timestamp: Date.now(),
        ttlMs,
        ttl: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000) // Firestore TTL in seconds
      }, { merge: true }).catch(cacheErr => {
        console.warn(`[Cache] Failed to store inverter cache: ${cacheErr.message}`);
      });
    }
    
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    console.error(`[Cache] Error in getCachedInverterData: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}

// ==================== CACHED REAL-TIME INVERTER DATA ====================
/**
 * Get full real-time inverter data with per-user Firestore cache.
 * Includes all variables needed for the dashboard display.
 * Respects TTL (default 5 minutes for real-time, configurable via user config).
 */
async function getCachedInverterRealtimeData(userId, deviceSN, userConfig, forceRefresh = false) {
  const config = getConfig();
  // Use user's custom TTL if set, otherwise fall back to default (5 min for real-time data)
  const ttlMs = (userConfig?.automation?.inverterRealtimeCacheTtlMs) || config.automation.cacheTtl.inverter || 300000;
  
  try {
    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter-realtime').get();
      if (cacheDoc.exists) {
        const { data, timestamp } = cacheDoc.data();
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs) {
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
      }
    }
    
    // Fetch fresh data from FoxESS with all required variables
    const data = await foxessAPI.callFoxESSAPI('/op/v0/device/real/query', 'POST', {
      sn: deviceSN,
      variables: ['generationPower', 'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power', 'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt', 'pv1Current', 'pv2Current', 'pv3Current', 'pv4Current', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC', 'batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation']
    }, userConfig, userId);
    
    // Store in cache if successful
    if (data?.errno === 0) {
      await db.collection('users').doc(userId).collection('cache').doc('inverter-realtime').set({
        data,
        timestamp: Date.now(),
        ttlMs,
        ttl: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000) // Firestore TTL in seconds
      }, { merge: true }).catch(cacheErr => {
        console.warn(`[Cache] Failed to store inverter realtime cache: ${cacheErr.message}`);
      });
    }
    
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    console.error(`[Cache] Error in getCachedInverterRealtimeData: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}
// ==================== AUTOMATION AUDIT LOG HELPERS ====================
/**
 * Log a single automation cycle to the audit trail.
 * Stores in users/{uid}/automationAudit/{docId} with 48-hour TTL.
 */
async function addAutomationAuditEntry(userId, cycleData) {
  try {
    const docId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const auditEntry = {
      timestamp: serverTimestamp(),
      epochMs: Date.now(),
      cycleId: cycleData.cycleId || docId,
      
      // Evaluation results
      triggered: cycleData.triggered || false,
      ruleName: cycleData.ruleName || null,
      ruleId: cycleData.ruleId || null,
      rulesEvaluated: cycleData.rulesEvaluated || 0,
      
      // Condition evaluation details
      evaluationResults: cycleData.evaluationResults || [],
      allRuleEvaluations: cycleData.allRuleEvaluations || [], // NEW: All rule evaluations for complete context
      
      // Action taken (if any)
      actionTaken: cycleData.actionTaken || null,
      segmentApplied: cycleData.segmentApplied || null,
      
      // ⭐ NEW: ROI snapshot with house load
      roiSnapshot: cycleData.roiSnapshot || null,
      
      // Cache info
      inverterCacheHit: cycleData.inverterCacheHit || false,
      inverterCacheAgeMs: cycleData.inverterCacheAgeMs || null,
      
      // Timing
      cycleDurationMs: cycleData.cycleDurationMs || 0,
      
      // State transitions
      activeRuleBefore: cycleData.activeRuleBefore || null,
      activeRuleAfter: cycleData.activeRuleAfter || null,
      
      // Errors
      error: cycleData.error || null,
      
      // TTL for 7-day auto-cleanup (Firestore TTL policy must be enabled)
      // Extended from 48 hours to allow ROI analysis over a week of data
      ttl: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000)
    };
    
    await db.collection('users').doc(userId).collection('automationAudit').doc(docId).set(auditEntry);
  } catch (err) {
    console.warn(`[Audit] Failed to log automation entry: ${err.message}`);
  }
}

/**
 * Get recent automation audit logs (last 7 days).
 * Returns entries sorted by timestamp descending.
 */
async function getAutomationAuditLogs(userId, limitEntries = 100) {
  try {
    const snapshot = await db
      .collection('users').doc(userId).collection('automationAudit')
      .orderBy('epochMs', 'desc')
      .limit(limitEntries)
      .get();
    
    const entries = [];
    snapshot.forEach(doc => {
      entries.push({ docId: doc.id, ...doc.data() });
    });
    
    return entries;
  } catch (err) {
    console.error(`[Audit] Failed to retrieve audit logs: ${err.message}`);
    return [];
  }
}

// ==================== EXPRESS APP ====================
const app = express();
app.use(cors({ origin: true }));
// Simple request logger (controlled by VERBOSE_API environment variable)
app.use((req, res, next) => {
  try {
    if (VERBOSE_API) {
      logger.debug('API', `${req.method} ${req.path}`);
    }
  } catch (e) { /* ignore logging errors */ }
  next();
});
// Capture raw request body (for debugging) and provide a more helpful error when JSON parsing fails
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf && buf.toString ? buf.toString() : '';
  }
}));

// JSON parse error handler - return structured JSON instead of generic 500
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error('[API] Invalid JSON body:', err.message, 'rawBody=', req.rawBody && req.rawBody.slice ? req.rawBody.slice(0, 1000) : req.rawBody);
    return res.status(400).json({ errno: 400, error: 'Invalid JSON body', raw: req.rawBody && req.rawBody.slice ? req.rawBody.slice(0, 1000) : req.rawBody });
  }
  next(err);
});

// ==================== AUTH MIDDLEWARE ====================
// All authentication helpers live in api/auth.js (initialized above)
const authenticateUser = (req, res, next) => authAPI.authenticateUser(req, res, next);
const tryAttachUser = (req) => authAPI.tryAttachUser(req);

// ==================== ADMIN ROLE SYSTEM ====================
// Seed admin: sardanapalos928@hotmail.com is always treated as admin.
// Additional admins can be promoted via the admin panel (stored in Firestore).
const SEED_ADMIN_EMAIL = 'sardanapalos928@hotmail.com';

/**
 * Check whether the authenticated user is an admin.
 * Admin status is determined by:
 *   1. Matching the seed admin email, OR
 *   2. Having role: 'admin' in users/{uid} Firestore doc
 * Results are cached on req._isAdmin for the duration of the request.
 */
async function isAdmin(req) {
  if (req._isAdmin !== undefined) return req._isAdmin;
  if (!req.user) { req._isAdmin = false; return false; }
  const email = (req.user.email || '').toLowerCase();
  if (email === SEED_ADMIN_EMAIL) { req._isAdmin = true; return true; }
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data = userDoc.exists ? userDoc.data() : {};
    req._isAdmin = data.role === 'admin';
  } catch (e) {
    console.warn('[Admin] Error checking admin role:', e.message);
    req._isAdmin = false;
  }
  return req._isAdmin;
}

/**
 * Middleware: require admin role. Must be used AFTER authenticateUser.
 */
const requireAdmin = async (req, res, next) => {
  const admin = await isAdmin(req);
  if (!admin) {
    return res.status(403).json({ errno: 403, error: 'Admin access required' });
  }
  next();
};

// Health check (no auth required)
app.get('/api/health', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userId = req.user?.uid;
    
    // Check if user is authenticated and has tokens saved
    let foxessTokenPresent = false;
    let amberApiKeyPresent = false;
    
    if (userId) {
      try {
        const configDoc = await db.collection('users').doc(userId).collection('config').doc('main').get();
        const config = configDoc.data() || {};
        foxessTokenPresent = !!config.foxessToken;
        amberApiKeyPresent = !!config.amberApiKey;
      } catch (e) {
        console.warn('[Health] Failed to check config:', e.message);
      }
    }
    
    res.json({ 
      ok: true,
      FOXESS_TOKEN: foxessTokenPresent,
      AMBER_API_KEY: amberApiKeyPresent
    });
  } catch (error) {
    console.error('[Health] Error:', error);
    res.json({ 
      ok: true,
      FOXESS_TOKEN: false,
      AMBER_API_KEY: false
    });
  }
});

// Password reset (no auth required)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ errno: 400, error: 'Email is required' });
    }
    
    logger.info('Auth', `Password reset requested for: ${email}`, true);
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
    const { device_sn, foxess_token, amber_api_key, weather_place } = req.body;
    const errors = {};
    const failed_keys = [];
    
    // For unauthenticated setup, just validate the FoxESS token without saving
    // Once user is authenticated, they can complete setup via authenticated endpoint
    if (foxess_token && device_sn) {
      logger.info('Validation', `Testing FoxESS token`, true);
      const testConfig = { foxessToken: foxess_token, deviceSn: device_sn };
      const foxResult = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, testConfig, null);
      
      // Log only status, not full response (may contain sensitive device data)
      logger.info('Validation', `FoxESS API response: errno=${foxResult?.errno}, devices=${foxResult?.result?.data?.length || 0}`, true);
      
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
    
    // If validation passed, persist config.
    // - If the caller is authenticated, save under their user document.
    // - If unauthenticated (setup flow), save to a shared server config doc so hosting deployments
    //   can persist runtime credentials across requests (useful for single-instance installs).
    if (failed_keys.length === 0) {
      const configData = {
        deviceSn: device_sn,
        foxessToken: foxess_token,
        amberApiKey: amber_api_key || '',
        location: weather_place || 'Sydney',  // Save location for timezone detection
        inverterCapacityW: (typeof req.body.inverter_capacity_w === 'number' && req.body.inverter_capacity_w > 0) ? Math.round(req.body.inverter_capacity_w) : 10000,
        batteryCapacityKWh: (typeof req.body.battery_capacity_kwh === 'number' && req.body.battery_capacity_kwh > 0) ? req.body.battery_capacity_kwh : 41.93,
        setupComplete: true,
        updatedAt: serverTimestamp()
      };

      if (req.user?.uid) {
        await db.collection('users').doc(req.user.uid).collection('config').doc('main').set(configData, { merge: true });
        logger.info('Validation', `Config saved successfully for user ${req.user.uid}`, true);
      } else {
        // Persist to shared server config so the setup flow completes for unauthenticated users
        await db.collection('shared').doc('serverConfig').set(configData, { merge: true });
        logger.info('Validation', 'Config saved to shared serverConfig (unauthenticated setup flow)', true);
      }
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
    
    const serverConfig = getConfig();
    
    // If user is authenticated (has ID token), check their Firestore config
    if (req.user?.uid) {
      const userConfig = await getUserConfig(req.user.uid);
      
      // Treat setupComplete as true if explicitly set OR if both critical fields are present
      const setupComplete = !!((userConfig?.setupComplete === true) || (userConfig?.deviceSn && userConfig?.foxessToken));
      
      // Include cache TTL configuration for frontend
      const config = {
        automation: {
          intervalMs: (userConfig?.automation?.intervalMs) || serverConfig.automation.intervalMs
        },
        cache: {
          amber: (userConfig?.cache?.amber) || serverConfig.automation.cacheTtl.amber,
          inverter: (userConfig?.automation?.inverterCacheTtlMs) || serverConfig.automation.cacheTtl.inverter,
          weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather
        },
        defaults: {
          cooldownMinutes: (userConfig?.defaults?.cooldownMinutes) || 5,
          durationMinutes: (userConfig?.defaults?.durationMinutes) || 30
        }
      };
      
      return res.json({ 
        errno: 0, 
        result: { 
          setupComplete, 
          hasDeviceSn: !!userConfig?.deviceSn, 
          hasFoxessToken: !!userConfig?.foxessToken, 
          hasAmberKey: !!userConfig?.amberApiKey, 
          source: userConfig?._source || 'user',
          config  // Include user-specific config with TTLs
        } 
      });
    }
    
    // Unauthenticated user - fall back to shared server config (if present)
    try {
      const sharedDoc = await db.collection('shared').doc('serverConfig').get();
      if (sharedDoc.exists) {
        const cfg = sharedDoc.data() || {};
        const setupComplete = !!(cfg.setupComplete && cfg.deviceSn && cfg.foxessToken);
        
        // Include server default config
        const config = {
          automation: { intervalMs: serverConfig.automation.intervalMs },
          cache: serverConfig.automation.cacheTtl,
          defaults: { cooldownMinutes: 5, durationMinutes: 30 }
        };
        
        return res.json({ 
          errno: 0, 
          result: { 
            setupComplete, 
            hasDeviceSn: !!cfg.deviceSn, 
            hasFoxessToken: !!cfg.foxessToken, 
            hasAmberKey: !!cfg.amberApiKey, 
            source: 'shared',
            config  // Include server config with TTLs
          } 
        });
      }
    } catch (e) {
      console.warn('[Setup Status] Error reading shared server config:', e.message || e);
    }

    // No shared config found - setup not complete, but include server defaults
    const config = {
      automation: { intervalMs: serverConfig.automation.intervalMs },
      cache: serverConfig.automation.cacheTtl,
      defaults: { cooldownMinutes: 5, durationMinutes: 30 }
    };
    res.json({ 
      errno: 0, 
      result: { 
        setupComplete: false, 
        hasDeviceSn: false, 
        hasFoxessToken: false, 
        hasAmberKey: false,
        config  // Include server defaults
      } 
    });
  } catch (error) {
    console.error('[Setup Status] Error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Amber sites (allow unauthenticated calls - return empty list when no user)
app.get('/api/amber/sites', async (req, res) => {
  try {
    // Attach optional user if provided, but don't require auth
    await tryAttachUser(req);
    const userId = req.user?.uid;
    const debug = req.query.debug === 'true';
    

    if (!userId) {
      // No user signed in - safe empty response for UI
      const response = { errno: 0, result: [] };
      if (debug) response._debug = 'Not authenticated';
      return res.json(response);
    }

    const userConfig = await getUserConfig(userId);
    const hasKey = userConfig?.amberApiKey;

    if (!userConfig || !hasKey) {
      const response = { errno: 0, result: [] };
      if (debug) {
        response._debug = `Config issue: userConfig=${!!userConfig}, hasAmberKey=${hasKey}`;
      }
      return res.json(response);
    }

    // Try cache first
    let cachedSites = await amberAPI.getCachedAmberSites(userId);
    if (cachedSites) {
      return res.json({ errno: 0, result: cachedSites, _cached: true });
    }

    // Cache miss - call API
    incrementApiCount(userId, 'amber').catch(err => console.warn('[Amber] Failed to log API call:', err.message));
    const result = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId, true);


    let sites = [];
    if (result && result.data && Array.isArray(result.data)) sites = result.data;
    else if (result && result.sites && Array.isArray(result.sites)) sites = result.sites;
    else if (Array.isArray(result)) sites = result;
    
    // Store in cache for future requests
    if (sites.length > 0) {
      await amberAPI.cacheAmberSites(userId, sites);
    }

    if (sites.length > 0) {
      return res.json({ errno: 0, result: sites });
    }
    
    // If there's an error from Amber API, pass it through with debug info if requested
    if (result && result.errno && result.errno !== 0) {
      const response = { errno: 0, result: [] };
      if (debug) response._debug = `Amber API error: ${result.error || result.msg}`;
      return res.json(response);
    }
    
    return res.json({ errno: 0, result: [] });
  } catch (e) {
    console.error('[Amber] Pre-auth /sites error:', e && e.message ? e.message : e);
    const response = { errno: 0, result: [] };
    if (req.query.debug === 'true') response._debug = `Exception: ${e?.message || String(e)}`;
    return res.json(response);
  }
});

// Public-friendly endpoint for current prices (mirror of /api/amber/prices but accepts
// the '/current' path which the frontend sometimes uses). Returns safe JSON when unauthenticated.
app.get('/api/amber/prices/current', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userId = req.user?.uid;
    if (!userId) return res.json({ errno: 0, result: [] });

    const userConfig = await getUserConfig(userId);
    if (!userConfig || !userConfig.amberApiKey) {
      return res.json({ errno: 0, result: [] });
    }

    let siteId = req.query.siteId || userConfig.amberSiteId;
    const next = Number(req.query.next || '1') || 1;
    const forceRefresh = req.query.forceRefresh === 'true' || req.query.force === 'true';

    if (!siteId) {
      // Try to fetch sites and use the first one if not configured
      const sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
      if (Array.isArray(sites) && sites.length > 0) {
        siteId = sites[0].id;
      }
    }

    if (!siteId) return res.status(400).json({ errno: 400, error: 'Site ID is required', result: [] });

    // Try cache first for current prices (unless force refresh requested)
    let result = null;
    if (!forceRefresh) {
      result = await amberAPI.getCachedAmberPricesCurrent(siteId, userId, userConfig);
    }
    
    if (!result) {
      const inflightKey = `${userId}:${siteId}`;
      
      // Check if another request is already fetching this data
      if (amberPricesInFlight.has(inflightKey)) {
        try {
          result = await amberPricesInFlight.get(inflightKey);
        } catch (err) {
          logger.warn('Amber', `In-flight request failed for ${userId}: ${err.message}`);
        }
      }
      
      // If still no data (first request or in-flight failed), fetch it
      if (!result) {
        const fetchPromise = amberAPI.callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next }, userConfig, userId)
          .then(async (data) => {
            if (Array.isArray(data) && data.length > 0) {
              await amberAPI.cacheAmberPricesCurrent(siteId, data, userId, userConfig);
            }
            return data;
          })
          .finally(() => {
            amberPricesInFlight.delete(inflightKey);
          });
        
        amberPricesInFlight.set(inflightKey, fetchPromise);
        result = await fetchPromise;
      }
    }
    
    // Normalize response to wrapped format
    if (Array.isArray(result)) {
      return res.json({ errno: 0, result });
    }
    // If already wrapped, return as-is
    if (result?.errno !== undefined) {
      return res.json(result);
    }
    // Fallback: wrap whatever we got (ensure array)
    return res.json({ errno: 0, result: result || [] });
  } catch (e) {
    console.error('[Amber] /prices/current error (pre-auth):', e && e.message ? e.message : e);
    return res.json({ errno: 0, result: [] });
  }
});

// Amber prices (standard endpoint) - Allow unauthenticated access (returns empty if no user)
app.get('/api/amber/prices', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userId = req.user?.uid;
    
    if (!userId) {
      // No user signed in - safe empty response for UI
      return res.json({ errno: 0, result: [] });
    }

    const userConfig = await getUserConfig(userId);
    if (!userConfig || !userConfig.amberApiKey) {
      return res.status(400).json({ errno: 400, error: 'Amber not configured', result: [] });
    }
    let siteId = req.query.siteId || userConfig.amberSiteId;
    
    if (!siteId) {
      // Try to fetch sites and use the first one if not configured
      const sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
      if (Array.isArray(sites) && sites.length > 0) {
        siteId = sites[0].id;
      }
    }
    
    if (!siteId) {
      return res.status(400).json({ errno: 400, error: 'Site ID is required' });
    }
    
    // Check if caller wants only actual (non-forecast) prices
    const actualOnly = req.query.actual_only === 'true';
    
    // If the caller provided startDate/endDate, treat this as a historical range
    // request and use intelligent caching to avoid repeated API calls.
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    if (startDate || endDate) {
      const resolution = req.query.resolution || 30;
      
      
      // If actualOnly is set, check if this is a recent date range
      // For dates older than 3 days, use cache since they're definitely materialized
      // For recent dates (today, yesterday, day before), fetch fresh to avoid forecast
      if (actualOnly) {
        const endDateObj = new Date(endDate);
        const now = new Date();
        const daysSinceEnd = Math.floor((now - endDateObj) / (1000 * 60 * 60 * 24));
        
        if (daysSinceEnd > 3) {
          // Old data - safe to use cache (it's all materialized)
          const result = await amberAPI.fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId);
          return res.json(result);
        } else {
          // Recent data - fetch fresh to avoid forecast pollution
          const result = await amberAPI.fetchAmberHistoricalPricesActualOnly(siteId, startDate, endDate, resolution, userConfig, userId);
          return res.json(result);
        }
      }
      
      // Default: use cache
      const result = await amberAPI.fetchAmberHistoricalPricesWithCache(siteId, startDate, endDate, resolution, userConfig, userId);
      return res.json(result);
    }

    // Default behavior: return the current forecast/prices
    const result = await amberAPI.callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 1 }, userConfig, userId);
    res.json(result);
  } catch (error) {
    console.warn('[Amber] Error fetching prices:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * Get actual (settled) Amber prices for a specific timestamp
 * Used by ROI calculator to get accurate prices for completed rules
 * Only works for timestamps within last 7 days (Amber API limitation)
 */
app.get('/api/amber/prices/actual', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    
    if (!userConfig || !userConfig.amberApiKey) {
      return res.status(400).json({ errno: 400, error: 'Amber not configured' });
    }
    
    let siteId = req.query.siteId || userConfig.amberSiteId;
    const timestamp = req.query.timestamp; // ISO 8601 timestamp
    
    if (!siteId) {
      // Try to fetch sites and use the first one if not configured
      const sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
      if (Array.isArray(sites) && sites.length > 0) {
        siteId = sites[0].id;
      }
    }
    
    if (!siteId) {
      return res.status(400).json({ errno: 400, error: 'Site ID is required' });
    }
    
    if (!timestamp) {
      return res.status(400).json({ errno: 400, error: 'Timestamp is required' });
    }
    
    // Parse timestamp and check if within 7-day window
    const targetTime = new Date(timestamp);
    const now = new Date();
    const ageMs = now.getTime() - targetTime.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    if (isNaN(targetTime.getTime())) {
      return res.status(400).json({ errno: 400, error: 'Invalid timestamp format' });
    }
    
    if (ageDays > 7) {
      logger.debug('Amber Actual', `Timestamp ${timestamp} is ${ageDays.toFixed(2)} days old (>7 days) - outside Amber data retention`);
      return res.json({ errno: 0, result: null, reason: 'outside_retention_window', ageDays: ageDays.toFixed(2) });
    }
    
    if (ageMs < 5 * 60 * 1000) {
      logger.debug('Amber Actual', `Timestamp ${timestamp} is only ${(ageMs / 60000).toFixed(1)} minutes old - price may not be settled yet`);
      return res.json({ errno: 0, result: null, reason: 'too_recent', ageMinutes: (ageMs / 60000).toFixed(1) });
    }
    
    // Calculate date for the timestamp (Amber uses date-based queries)
    const targetDate = targetTime.toISOString().split('T')[0]; // YYYY-MM-DD
    
    logger.debug('Amber Actual', `Fetching actual prices for ${targetDate} (timestamp: ${timestamp}, age: ${ageDays.toFixed(2)} days)`);
    
    // Fetch prices for that date (we'll filter to the specific interval)
    // Use the same resolution as the user's billing interval (5 or 30 minutes)
    const resolution = req.query.resolution || 30;
    
    try {
      const result = await amberAPI.callAmberAPI(
        `/sites/${encodeURIComponent(siteId)}/prices`,
        { startDate: targetDate, endDate: targetDate, resolution },
        userConfig,
        userId
      );
      
      if (!result || (result.errno && result.errno !== 0)) {
        console.warn(`[Amber Actual] API error: ${result?.error || 'unknown'}`);
        return res.json({ errno: result?.errno || 500, error: result?.error || 'API call failed', result: null });
      }
      
      // Extract prices array
      let prices = [];
      if (Array.isArray(result)) {
        prices = result;
      } else if (result.result && Array.isArray(result.result)) {
        prices = result.result;
      }
      
      if (prices.length === 0) {
        logger.debug('Amber Actual', `No prices returned for ${targetDate}`);
        return res.json({ errno: 0, result: null, reason: 'no_data' });
      }
      
      // Filter to find the interval containing our timestamp
      // Amber prices have startTime and endTime fields
      const matchingInterval = prices.find(price => {
        const intervalStart = new Date(price.startTime);
        const intervalEnd = new Date(price.endTime);
        return targetTime >= intervalStart && targetTime <= intervalEnd;
      });
      
      if (!matchingInterval) {
        logger.debug('Amber Actual', `No matching interval found for ${timestamp} in ${prices.length} price intervals`);
        return res.json({ errno: 0, result: null, reason: 'no_matching_interval' });
      }
      
      // Return the actual price data
      logger.debug('Amber Actual', `Found matching interval: type=${matchingInterval.type}, channel=${matchingInterval.channelType}, price=${matchingInterval.perKwh}c/kWh`);
      
      res.json({
        errno: 0,
        result: matchingInterval
      });
    } catch (error) {
      console.warn('[Amber Actual] Error fetching actual prices:', error.message);
      res.status(500).json({ errno: 500, error: error.message });
    }
  } catch (error) {
    console.warn('[Amber Actual] Error in route handler:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Metrics (platform global or per-user). Allow unauthenticated callers to read global metrics by default.
app.get('/api/metrics/api-calls', async (req, res) => {
  // Parse days outside try block so it's available in catch
  const days = Math.max(1, Math.min(30, parseInt(req.query.days || '7', 10)));
  
  try {
    // Attach optional user (don't require auth globally here)
    await tryAttachUser(req);

    const scope = String(req.query.scope || 'global');

    if (!db) {
      const result = {};
      const endDate = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(endDate);
        d.setDate(d.getDate() - i);
        const key = getAusDateKey(d);
        result[key] = { foxess: 0, amber: 0, weather: 0 };
      }
      return res.json({ errno: 0, result });
    }

    const endDate = new Date();

    if (scope === 'user') {
      const userId = req.user?.uid;
      if (!userId) {
        console.warn(`[Metrics] User scope requested but no userId - returning 401`);
        return res.status(401).json({ errno: 401, error: 'Unauthorized: user scope requested' });
      }

      // Query without orderBy to avoid needing a composite index
      // Get all metrics docs for the user and filter/sort in code
      const metricsSnapshot = await db.collection('users').doc(userId)
        .collection('metrics')
        .get();

      const result = {};
      const allDocs = [];
      metricsSnapshot.forEach(doc => {
        const d = doc.data() || {};
        allDocs.push({
          id: doc.id,
          foxess: Number(d.foxess || 0),
          amber: Number(d.amber || 0),
          weather: Number(d.weather || 0)
        });
      });

      // Sort by date descending (YYYY-MM-DD format sorts alphabetically)
      allDocs.sort((a, b) => b.id.localeCompare(a.id));

      // Take only the most recent N days
      allDocs.slice(0, days).forEach(doc => {
        result[doc.id] = {
          foxess: doc.foxess,
          amber: doc.amber,
          weather: doc.weather
        };
      });

      // Fill in missing days with zeros (Australia/Sydney local date)
      for (let i = 0; i < days; i++) {
        const d = new Date(endDate);
        d.setDate(d.getDate() - i);
        const key = getAusDateKey(d);
        if (!result[key]) result[key] = { foxess: 0, amber: 0, weather: 0 };
      }

      return res.json({ errno: 0, result });

    }

    // Global scope: read top-level `metrics` collection for each date
    const result = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const key = getAusDateKey(d);

      const doc = await db.collection('metrics').doc(key).get();
      const data = doc.exists ? doc.data() : null;
      result[key] = {
        foxess: Number(data?.foxess || 0),
        amber: Number(data?.amber || 0),
        weather: Number(data?.weather || 0)
      };
    }

    res.json({ errno: 0, result });
  } catch (error) {
    console.error('[Metrics] Error in /api/metrics/api-calls (pre-auth):', error && error.message);
    const result = {};
    const endDate = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const key = getAusDateKey(d);
      result[key] = { foxess: 0, amber: 0, weather: 0 };
    }
    return res.json({ errno: 0, result });
  }
});

// ==================== TESLA OAUTH ENDPOINTS (Before Auth Middleware) ====================
// These endpoints must be before app.use('/api', authenticateUser) because:
// 1. oauth-authorize manually verifies the token from query param
// 2. oauth-callback receives redirect from Tesla (no auth headers)

// OAuth authorize endpoint - redirects to Tesla
// Note: This endpoint receives idToken as query param since redirects don't send Authorization headers
// It manually handles authentication to support query param tokens
app.get('/api/tesla/oauth-authorize', async (req, res) => {
  try {
    // Manually authenticate using query param token
    const { idToken, clientId } = req.query;
    if (!idToken) {
      return res.status(401).json({ errno: 401, error: 'No authentication token provided' });
    }
    
    if (!clientId) {
      return res.status(400).json({ errno: 400, error: 'clientId is required in query params' });
    }
    
    let user;
    try {
      user = await admin.auth().verifyIdToken(idToken);
    } catch (tokenError) {
      console.error('[Tesla] Token verification failed:', tokenError.message);
      return res.status(401).json({ errno: 401, error: 'Invalid or expired token' });
    }
    
    // Check if user is authorized for Tesla
    const allowedEmail = 'sardanapalos928@hotmail.com';
    if (user.email !== allowedEmail) {
      return res.status(403).json({ 
        errno: 403, 
        error: 'Access denied. Tesla integration is currently restricted to authorized users.' 
      });
    }
    
    // Generate state token for CSRF protection
    const stateToken = crypto.randomBytes(32).toString('hex');
    const state = Buffer.from(JSON.stringify({ 
      userId: user.uid, 
      clientId: clientId.trim(),  // Store clientId in state for use in callback
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    })).toString('base64');
    
    // Tesla OAuth authorize URL
    const teslaAuthUrl = 'https://auth.tesla.com/oauth2/v3/authorize';
    // Get the original host from the referer or use X-Forwarded-Host header
    // When called from Firebase Hosting, X-Forwarded-Host will be the Firebase domain
    // If not available, use a hardcoded Firebase domain since that's where OAuth will redirect to
    const host = req.get('X-Forwarded-Host') || req.get('referer')?.split('/')[2] || 'inverter-automation-firebase.web.app';
    const redirectUri = `https://${host}/api/tesla/oauth-callback`;
    // Tesla Fleet API scopes: vehicle_device_data (read), vehicle_cmds (control), vehicle_charging_cmds (charging), offline_access (refresh tokens)
    const scope = 'openid vehicle_device_data vehicle_cmds vehicle_charging_cmds offline_access';
    
    const authorizeUrl = `${teslaAuthUrl}?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scope)}&` +
      `state=${encodeURIComponent(state)}`;
    
    logger.debug('Tesla', `User ${user.uid} initiating OAuth flow`);
    res.redirect(authorizeUrl);
  } catch (error) {
    console.error('[Tesla] oauth-authorize error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// OAuth callback endpoint - handles redirect from Tesla
app.get('/api/tesla/oauth-callback', async (req, res) => {
  try {
    const { code, state, error: teslaError } = req.query;
    
    // Check for errors from Tesla
    if (teslaError) {
      console.error('[Tesla] OAuth error from Tesla:', teslaError);
      return res.redirect(`/tesla-integration.html?oauth_error=${encodeURIComponent(teslaError)}`);
    }
    
    if (!code || !state) {
      console.error('[Tesla] Missing code or state in callback');
      return res.redirect('/tesla-integration.html?oauth_error=missing_code_or_state');
    }
    
    // Decode and verify state
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      
      // Verify state has required fields
      if (!stateData.userId || !stateData.timestamp || !stateData.nonce) {
        console.error('[Tesla] State missing required fields:', stateData);
        return res.redirect('/tesla-integration.html?oauth_error=invalid_state_format');
      }
      
      // Check state age (15 minutes max)
      const stateAge = Date.now() - stateData.timestamp;
      if (stateAge > 15 * 60 * 1000) {
        console.error('[Tesla] State token expired:', stateAge / 1000, 'seconds old');
        return res.redirect('/tesla-integration.html?oauth_error=state_expired');
      }
      
      logger.debug('Tesla', `Valid state token for user ${stateData.userId}`);
    } catch (e) {
      console.error('[Tesla] Invalid state token:', e);
      return res.redirect('/tesla-integration.html?oauth_error=invalid_state');
    }
    
    const userId = stateData.userId;
    const clientId = stateData.clientId;  // Retrieved from state token
    
    logger.debug('Tesla', `oauth-callback received, attempting token exchange for user ${userId}`);
    
    // Get user's client secret from Firestore
    let clientSecret = '';
    try {
      const userTeslaConfig = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
      if (userTeslaConfig.exists) {
        clientSecret = userTeslaConfig.data().clientSecret;
      }
    } catch (err) {
      console.warn('[Tesla] Error fetching user Tesla config:', err.message);
    }
    
    if (!clientId || !clientSecret) {
      console.error('[Tesla] Missing Tesla clientSecret for user or clientId in state');
      return res.redirect(`/tesla-integration.html?oauth_error=${encodeURIComponent('User Tesla credentials not configured')}`);
    }
    
    // Exchange authorization code for tokens
    // Get the original host from X-Forwarded-Host or use hardcoded Firebase domain
    const host = req.get('X-Forwarded-Host') || 'inverter-automation-firebase.web.app';
    const redirectUri = `https://${host}/api/tesla/oauth-callback`;
    const tokenUrl = 'https://auth.tesla.com/oauth2/v3/token';
    
    logger.debug('Tesla', `Token exchange - redirectUri: ${redirectUri}, clientId: ${clientId}`);
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Tesla-Automation/1.0'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      }),
      redirect: 'manual'  // Don't follow redirects - handle manually if needed
    });
    
    let tokenData;
    const responseText = await tokenResponse.text();
    
    logger.debug('Tesla', `Token endpoint response status: ${tokenResponse.status} ${tokenResponse.statusText}`);
    console.log(`[Tesla] Response headers:`, {
      contentType: tokenResponse.headers.get('content-type'),
      contentLength: tokenResponse.headers.get('content-length')
    });
    console.log(`[Tesla] Response body (first 1000 chars):`, responseText.substring(0, 1000));
    
    try {
      tokenData = JSON.parse(responseText);
    } catch (parseError) {
      // If response is not JSON, it's likely an HTML error page from Tesla
      console.error('[Tesla] Token response is not JSON:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        headers: Object.fromEntries(tokenResponse.headers),
        body: responseText.substring(0, 500)
      });
      console.error('[Tesla] Full request details:', {
        redirect_uri: redirectUri,
        client_id: clientId,
        code: code.substring(0, 50) + '...'
      });
      return res.redirect(`/tesla-integration.html?oauth_error=${encodeURIComponent('Tesla API error: ' + tokenResponse.statusText)}`);
    }
    
    if (!tokenResponse.ok) {
      const errorDetail = tokenData.error_description || tokenData.error || 'Unknown error';
      console.error('[Tesla] Token exchange failed:', {
        status: tokenResponse.status,
        error: tokenData.error,
        description: tokenData.error_description,
        raw: tokenData
      });
      console.error('[Tesla] FORBIDDEN details:', {
        client_id_starts_with: clientId.substring(0, 10),
        client_secret_starts_with: clientSecret.substring(0, 10),
        redirect_uri: redirectUri,
        code_starts_with: code.substring(0, 20)
      });
      return res.redirect(`/tesla-integration.html?oauth_error=${encodeURIComponent('Token exchange failed: ' + errorDetail)}`);
    }
    
    if (!tokenData.access_token) {
      console.error('[Tesla] No access token in response:', tokenData);
      return res.redirect('/tesla-integration.html?oauth_error=no_access_token');
    }
    
    logger.debug('Tesla', `Successfully exchanged code for tokens (access_token: ${tokenData.access_token.substring(0, 20)}..., refresh_token: ${tokenData.refresh_token ? 'present' : 'missing'})`);
    
    // Save tokens to Firestore
    try {
      await teslaAPI.saveUserTokens(
        userId,
        tokenData.access_token,
        tokenData.refresh_token || null,
        tokenData.expires_in || null
      );
      logger.debug('Tesla', `Tokens saved for user ${userId}`);
    } catch (saveError) {
      console.error('[Tesla] Failed to save tokens:', saveError);
      return res.redirect(`/tesla-integration.html?oauth_error=${encodeURIComponent('Failed to save tokens')}`);
    }
    
    // Redirect back to tesla-integration page with success
    res.redirect('/tesla-integration.html?oauth_success=true');
  } catch (error) {
    console.error('[Tesla] oauth-callback error:', error);
    res.redirect(`/tesla-integration.html?oauth_error=${encodeURIComponent(error.message)}`);
  }
});

// ==================== ADMIN API ENDPOINTS ====================
// All admin routes use authenticateUser + requireAdmin explicitly so they
// are registered before the catch-all app.use('/api', authenticateUser).

function getRuntimeProjectId() {
  try {
    return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || admin.app().options.projectId || null;
  } catch (e) {
    return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || null;
  }
}

function getPointNumericValue(point) {
  if (!point || !point.value) return 0;
  const value = point.value;
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  if (typeof value.int64Value === 'string') return Number(value.int64Value) || 0;
  if (typeof value.int64Value === 'number') return value.int64Value;
  if (typeof value.distributionValue?.count === 'number') return value.distributionValue.count;
  return 0;
}

async function listMonitoringTimeSeries({
  monitoring,
  projectId,
  filter,
  startTime,
  endTime,
  aligner = 'ALIGN_SUM',
  alignmentPeriod = '3600s'
}) {
  const name = `projects/${projectId}`;
  let pageToken = undefined;
  const pointByTimestamp = new Map();

  do {
    const response = await monitoring.projects.timeSeries.list({
      name,
      filter,
      'interval.startTime': startTime.toISOString(),
      'interval.endTime': endTime.toISOString(),
      'aggregation.alignmentPeriod': alignmentPeriod,
      'aggregation.perSeriesAligner': aligner,
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      'aggregation.groupByFields': [],
      view: 'FULL',
      pageSize: 1000,
      pageToken
    });

    const timeSeries = response?.data?.timeSeries || [];
    for (const series of timeSeries) {
      const points = series?.points || [];
      for (const point of points) {
        const ts = point?.interval?.endTime || point?.interval?.startTime;
        if (!ts) continue;
        const current = pointByTimestamp.get(ts) || 0;
        pointByTimestamp.set(ts, current + getPointNumericValue(point));
      }
    }

    pageToken = response?.data?.nextPageToken || undefined;
  } while (pageToken);

  return Array.from(pointByTimestamp.entries())
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function sumSeriesValues(series) {
  return series.reduce((sum, point) => sum + (Number(point.value) || 0), 0);
}

function normalizeMetricErrorMessage(error) {
  const raw = String(error?.message || error || 'metric unavailable');
  const stripped = raw.split('If a metric was created recently')[0].trim();
  return stripped.replace(/\s+/g, ' ');
}

async function getRuntimeServiceAccountEmail(projectId) {
  const fallback = `${projectId || 'PROJECT_NUMBER'}-compute@developer.gserviceaccount.com`;
  try {
    const metadataResp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        timeout: 1500
      }
    );
    if (metadataResp.ok) {
      const email = String(await metadataResp.text()).trim();
      if (email) return email;
    }
  } catch (e) {
    // local emulator / tests will not have metadata server
  }

  return fallback;
}

/**
 * Estimate Firestore MTD cost from usage counts using GCP published pricing.
 * Reads:   $0.06 / 100K  (50K/day free tier)
 * Writes:  $0.18 / 100K  (20K/day free tier)
 * Deletes: $0.02 / 100K  (20K/day free tier)
 * Does NOT include storage, Auth, Functions, egress, etc.
 * Returns { totalUsd, services: [{service, costUsd}], isEstimate: true }
 */
function estimateFirestoreCostFromUsage(readsMtd, writesMtd, deletesMtd, nowDate) {
  const dayOfMonth = Math.max(1, nowDate.getUTCDate());
  const freeReads   = 50000 * dayOfMonth;
  const freeWrites  = 20000 * dayOfMonth;
  const freeDeletes = 20000 * dayOfMonth;

  const billableReads   = Math.max(0, readsMtd   - freeReads);
  const billableWrites  = Math.max(0, writesMtd  - freeWrites);
  const billableDeletes = Math.max(0, deletesMtd - freeDeletes);

  const readCost   = (billableReads   / 100000) * 0.06;
  const writeCost  = (billableWrites  / 100000) * 0.18;
  const deleteCost = (billableDeletes / 100000) * 0.02;

  return {
    totalUsd: readCost + writeCost + deleteCost,
    isEstimate: true,
    services: [
      { service: 'Cloud Firestore reads',   costUsd: readCost },
      { service: 'Cloud Firestore writes',  costUsd: writeCost },
      { service: 'Cloud Firestore deletes', costUsd: deleteCost }
    ]
  };
}

/**
 * Fetch MTD cost per service from the Cloud Billing API.
 * Requires roles/billing.viewer on the billing account for the service account.
 * Throws with err.isBillingIamError = true on 403.
 * Returns { services: [{service, costUsd}], totalUsd, accountId }
 */
async function fetchCloudBillingCost(projectId) {
  if (!googleApis) throw new Error('googleapis not available');
  const runtimeServiceAccount = await getRuntimeServiceAccountEmail(projectId);

  const auth = new googleApis.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-billing.readonly']
  });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = tokenResp.token;

  // Step 1: resolve billing account for this project
  const billingInfoResp = await fetch(
    `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (billingInfoResp.status === 403) {
    const bodyText = await billingInfoResp.text().catch(() => '');
    const disabledApi = /SERVICE_DISABLED|Cloud Billing API has not been used|cloudbilling\.googleapis\.com/i.test(bodyText);
    if (disabledApi) {
      const err = new Error(
        'BILLING_API_DISABLED: Enable cloudbilling.googleapis.com for this project, then retry.'
      );
      err.isBillingApiDisabled = true;
      throw err;
    }
    const err = new Error(
      'BILLING_IAM: Grant roles/billing.viewer on the billing account to the Functions service account ' +
      `(${runtimeServiceAccount}). ` +
      'See GCP IAM → Billing Account → Add Principal.'
    );
    err.isBillingIamError = true;
    throw err;
  }
  if (!billingInfoResp.ok) {
    throw new Error(`billingInfo: ${billingInfoResp.status} ${billingInfoResp.statusText}`);
  }
  const billingInfo = await billingInfoResp.json();
  if (!billingInfo.billingEnabled || !billingInfo.billingAccountName) {
    throw new Error('No billing account is linked to this project');
  }

  const accountName = billingInfo.billingAccountName; // "billingAccounts/XXXXXX-XXXXXX-XXXXXX"
  const accountId = accountName.replace('billingAccounts/', '');

  // Step 2: get MTD cost per service from the Billing Reports API
  const now = new Date();
  const params = new URLSearchParams({
    'dateRange.startDate.year': now.getUTCFullYear(),
    'dateRange.startDate.month': now.getUTCMonth() + 1,
    'dateRange.startDate.day': 1,
    'dateRange.endDate.year': now.getUTCFullYear(),
    'dateRange.endDate.month': now.getUTCMonth() + 1,
    'dateRange.endDate.day': now.getUTCDate()
  });

  const reportsResp = await fetch(
    `https://cloudbilling.googleapis.com/v1beta/${accountName}/reports?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (reportsResp.status === 403) {
    const bodyText = await reportsResp.text().catch(() => '');
    const disabledApi = /SERVICE_DISABLED|Cloud Billing API has not been used|cloudbilling\.googleapis\.com/i.test(bodyText);
    if (disabledApi) {
      const err = new Error(
        'BILLING_API_DISABLED: Enable cloudbilling.googleapis.com for this project, then retry.'
      );
      err.isBillingApiDisabled = true;
      throw err;
    }
    const err = new Error(
      'BILLING_IAM: Grant roles/billing.viewer on the billing account to the Functions service account ' +
      `(${runtimeServiceAccount}) to read cost reports.`
    );
    err.isBillingIamError = true;
    throw err;
  }
  if (reportsResp.status === 404) {
    const err = new Error('BILLING_REPORTS_UNAVAILABLE: Cloud Billing reports endpoint is not available for this billing account/project.');
    err.isBillingReportsUnavailable = true;
    throw err;
  }
  if (!reportsResp.ok) {
    const body = await reportsResp.text().catch(() => '');
    throw new Error(`billing reports: ${reportsResp.status} - ${body.substring(0, 300)}`);
  }

  const reportsJson = await reportsResp.json();
  console.log('[Admin] Cloud Billing reports response keys:', Object.keys(reportsJson));

  const toUsd = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object') {
      if (value.amount !== undefined) return toUsd(value.amount);
      if (value.value !== undefined) return toUsd(value.value);
      if (value.doubleValue !== undefined) return toUsd(value.doubleValue);
      if (value.units !== undefined || value.nanos !== undefined) {
        const units = Number(value.units || 0);
        const nanos = Number(value.nanos || 0);
        const total = units + (nanos / 1e9);
        return Number.isFinite(total) ? total : null;
      }
      if (value.currencyAmount !== undefined) return toUsd(value.currencyAmount);
    }
    return null;
  };

  const getServiceName = (obj) => {
    if (!obj || typeof obj !== 'object') return '';
    const explicit =
      obj.serviceDisplayName ||
      obj.serviceName ||
      obj.service ||
      obj.displayName ||
      obj.cloudServiceId ||
      '';
    if (explicit && typeof explicit === 'string') return explicit;

    if (Array.isArray(obj.dimensionValues)) {
      const namedService = obj.dimensionValues.find((d) => {
        const key = String(d?.dimension || d?.name || d?.key || '').toLowerCase();
        return key.includes('service');
      });
      if (namedService) {
        const v = namedService.value || namedService.stringValue || namedService.displayName;
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      const firstString = obj.dimensionValues
        .map((d) => d?.value || d?.stringValue || d?.displayName)
        .find((v) => typeof v === 'string' && v.trim());
      if (firstString) return firstString.trim();
    }

    if (Array.isArray(obj.cells) && obj.cells.length) {
      const firstStringCell = obj.cells
        .map((c) => c?.value || c?.stringValue || c?.displayName || c?.text)
        .find((v) => typeof v === 'string' && v.trim());
      if (firstStringCell) return firstStringCell.trim();
    }

    return '';
  };

  const getCostValue = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    const candidates = [
      obj.cost,
      obj.totalCost,
      obj.aggregatedCost,
      obj.totalCostAmount,
      obj.costAmount,
      obj.amount,
      obj.metricValue,
      obj.value
    ];
    for (const candidate of candidates) {
      const parsed = toUsd(candidate);
      if (parsed !== null) return parsed;
    }

    if (Array.isArray(obj.metricValues)) {
      for (const metricValue of obj.metricValues) {
        const parsed = toUsd(metricValue);
        if (parsed !== null) return parsed;
      }
    }

    if (Array.isArray(obj.cells)) {
      for (const cell of obj.cells) {
        const parsed = toUsd(cell);
        if (parsed !== null) return parsed;
      }
    }

    return null;
  };

  const serviceTotals = new Map();
  const totalFallbacks = [];

  const addServiceCost = (serviceName, amount) => {
    if (!serviceName || !Number.isFinite(amount) || amount <= 0) return;
    const current = serviceTotals.get(serviceName) || 0;
    serviceTotals.set(serviceName, current + amount);
  };

  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (typeof node !== 'object') return;

    const serviceName = getServiceName(node);
    const costValue = getCostValue(node);
    if (serviceName && costValue !== null) {
      addServiceCost(serviceName, costValue);
    } else if (!serviceName && costValue !== null) {
      totalFallbacks.push(costValue);
    }

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') {
        walk(value);
      } else if (typeof value !== 'object') {
        const keyLower = key.toLowerCase();
        if ((keyLower.includes('total') || keyLower.includes('cost')) && value !== null && value !== undefined) {
          const parsed = toUsd(value);
          if (parsed !== null) totalFallbacks.push(parsed);
        }
      }
    }
  };

  walk(reportsJson);

  const services = Array.from(serviceTotals.entries())
    .map(([service, costUsd]) => ({ service, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  let totalUsd = services.reduce((sum, entry) => sum + entry.costUsd, 0);
  if ((!Number.isFinite(totalUsd) || totalUsd <= 0) && totalFallbacks.length) {
    const bestTotal = Math.max(...totalFallbacks.filter((v) => Number.isFinite(v) && v > 0));
    if (Number.isFinite(bestTotal) && bestTotal > 0) {
      totalUsd = bestTotal;
    }
  }

  if (!services.length && !totalUsd) {
    console.log('[Admin] Cloud Billing reports raw JSON (unparsed):', JSON.stringify(reportsJson).substring(0, 1500));
  }

  return { services, totalUsd: Number.isFinite(totalUsd) && totalUsd > 0 ? totalUsd : null, accountId, raw: reportsJson };
}

/**
 * GET /api/admin/firestore-metrics - Pull Firestore usage + billing signals from GCP Monitoring
 * Query: ?hours=36 (default 36, min 6, max 168)
 */
app.get('/api/admin/firestore-metrics', authenticateUser, requireAdmin, async (req, res) => {
  const warnings = [];
  try {
    if (!googleApis) {
      return res.status(503).json({ errno: 503, error: 'googleapis dependency not available on server' });
    }

    const projectId = getRuntimeProjectId();
    if (!projectId) {
      return res.status(500).json({ errno: 500, error: 'Unable to resolve GCP project id' });
    }

    const hoursRaw = Number(req.query?.hours);
    const hours = Number.isFinite(hoursRaw) ? Math.max(6, Math.min(168, Math.floor(hoursRaw))) : 36;

    const now = new Date();
    const start = new Date(now.getTime() - (hours * 60 * 60 * 1000));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

    const auth = new googleApis.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/monitoring.read']
    });
    const monitoring = googleApis.monitoring({ version: 'v3', auth });

    const metricFilters = {
      reads: 'metric.type="firestore.googleapis.com/document/read_count"',
      writes: 'metric.type="firestore.googleapis.com/document/write_count"',
      deletes: 'metric.type="firestore.googleapis.com/document/delete_count"',
      storageCandidates: [
        'metric.type="firestore.googleapis.com/storage/bytes_used"',
        'metric.type="firestore.googleapis.com/database/storage/total_bytes"',
        'metric.type="firestore.googleapis.com/storage/total_bytes"'
      ],
      billingCostCandidates: [
        'metric.type="billing.googleapis.com/billing/account/total_cost"',
        'metric.type="billing.googleapis.com/billing_account/cost"',
        'metric.type="billing.googleapis.com/billing/account/cost"'
      ]
    };

    const loadMetricSeriesSafe = async ({
      label,
      filters,
      startTime,
      endTime,
      aligner,
      alignmentPeriod
    }) => {
      const filterList = Array.isArray(filters) ? filters : [filters];
      for (const filter of filterList) {
        try {
          const series = await listMonitoringTimeSeries({
            monitoring,
            projectId,
            filter,
            startTime,
            endTime,
            aligner,
            alignmentPeriod
          });
          return series;
        } catch (error) {
          const msg = String(error?.message || error || 'unknown error');
          const unavailable = msg.includes('Cannot find metric(s) that match type') || msg.includes('not found');
          if (!unavailable) {
            warnings.push(`${label} metric query failed: ${normalizeMetricErrorMessage(error)}`);
            return [];
          }
        }
      }
      warnings.push(`${label} metric unavailable for this project/region`);
      return [];
    };

    const [readsSeries, writesSeries, deletesSeries, readsMtdSeries, writesMtdSeries, deletesMtdSeries, storageSeries] = await Promise.all([
      loadMetricSeriesSafe({
        label: 'Firestore reads',
        filters: metricFilters.reads,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '3600s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore writes',
        filters: metricFilters.writes,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '3600s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore deletes',
        filters: metricFilters.deletes,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '3600s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore reads (MTD)',
        filters: metricFilters.reads,
        startTime: monthStart,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '86400s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore writes (MTD)',
        filters: metricFilters.writes,
        startTime: monthStart,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '86400s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore deletes (MTD)',
        filters: metricFilters.deletes,
        startTime: monthStart,
        endTime: now,
        aligner: 'ALIGN_DELTA',
        alignmentPeriod: '86400s'
      }),
      loadMetricSeriesSafe({
        label: 'Firestore storage',
        filters: metricFilters.storageCandidates,
        startTime: start,
        endTime: now,
        aligner: 'ALIGN_MEAN',
        alignmentPeriod: '3600s'
      })
    ]);

    // Fetch real billing cost per service from Cloud Billing API
    let billingData = null;
    let usedMonitoringBillingFallback = false;
    try {
      billingData = await fetchCloudBillingCost(projectId);
      console.log(`[Admin] Cloud Billing cost fetched: $${billingData.totalUsd.toFixed(2)} across ${billingData.services.length} services`);
    } catch (billingErr) {
      if (billingErr.isBillingIamError) {
        warnings.push(billingErr.message);
      } else if (billingErr.isBillingReportsUnavailable) {
        // Fallback 1: Cloud Monitoring billing metrics
        const billingMtdSeries = await loadMetricSeriesSafe({
          label: 'Billing cost (Monitoring fallback)',
          filters: metricFilters.billingCostCandidates,
          startTime: monthStart,
          endTime: now,
          aligner: 'ALIGN_SUM',
          alignmentPeriod: '86400s'
        });

        const fallbackTotal = billingMtdSeries.length ? sumSeriesValues(billingMtdSeries) : null;
        if (Number.isFinite(fallbackTotal) && fallbackTotal > 0) {
          billingData = {
            services: null,
            totalUsd: fallbackTotal,
            accountId: null,
            raw: null
          };
          usedMonitoringBillingFallback = true;
          warnings.push('Billing service breakdown unavailable; using Monitoring total-cost fallback.');
        } else {
          // Fallback 2: estimate from Firestore read/write/delete usage counts we already fetched
          const readsMtdVal   = Math.round(sumSeriesValues(readsMtdSeries));
          const writesMtdVal  = Math.round(sumSeriesValues(writesMtdSeries));
          const deletesMtdVal = Math.round(sumSeriesValues(deletesMtdSeries));
          const estimate = estimateFirestoreCostFromUsage(readsMtdVal, writesMtdVal, deletesMtdVal, now);
          billingData = {
            services: estimate.services,
            totalUsd: estimate.totalUsd,
            accountId: null,
            raw: null,
            isEstimate: true
          };
          warnings.push(
            'Est. MTD cost calculated from Firestore read/write/delete counts × GCP pricing ' +
            '($0.06/100K reads, $0.18/100K writes, $0.02/100K deletes, minus daily free tier). ' +
            'Does not include Cloud Functions, Auth, storage, or egress costs.'
          );
        }
      } else {
        warnings.push(`Billing cost unavailable: ${normalizeMetricErrorMessage(billingErr)}`);
        console.warn('[Admin] fetchCloudBillingCost error:', billingErr.message);
      }
    }

    const trendMap = new Map();
    for (const point of readsSeries) {
      const existing = trendMap.get(point.timestamp) || { timestamp: point.timestamp, reads: 0, writes: 0, deletes: 0 };
      existing.reads = Number(point.value || 0);
      trendMap.set(point.timestamp, existing);
    }
    for (const point of writesSeries) {
      const existing = trendMap.get(point.timestamp) || { timestamp: point.timestamp, reads: 0, writes: 0, deletes: 0 };
      existing.writes = Number(point.value || 0);
      trendMap.set(point.timestamp, existing);
    }
    for (const point of deletesSeries) {
      const existing = trendMap.get(point.timestamp) || { timestamp: point.timestamp, reads: 0, writes: 0, deletes: 0 };
      existing.deletes = Number(point.value || 0);
      trendMap.set(point.timestamp, existing);
    }

    const trend = Array.from(trendMap.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const latestStorageBytes = storageSeries.length
      ? Number(storageSeries[storageSeries.length - 1].value || 0)
      : null;

    res.json({
      errno: 0,
      result: {
        source: (() => {
          if (!billingData) return 'gcp-monitoring';
          if (usedMonitoringBillingFallback) return 'gcp-monitoring+monitoring-billing-fallback';
          if (billingData.isEstimate) return 'gcp-monitoring+usage-estimate';
          return 'gcp-monitoring+cloud-billing';
        })(),
        projectId,
        updatedAt: now.toISOString(),
        windowHours: hours,
        firestore: {
          readsMtd: Math.round(sumSeriesValues(readsMtdSeries)),
          writesMtd: Math.round(sumSeriesValues(writesMtdSeries)),
          deletesMtd: Math.round(sumSeriesValues(deletesMtdSeries)),
          storageGb: Number.isFinite(latestStorageBytes) ? (latestStorageBytes / (1024 * 1024 * 1024)) : null
        },
        billing: {
          estimatedMtdCostUsd: billingData ? billingData.totalUsd : null,
          services: billingData ? billingData.services : null,
          billingAccountId: billingData ? billingData.accountId : null,
          isEstimate: billingData ? (billingData.isEstimate === true) : false
        },
        trend,
        warnings
      }
    });
  } catch (error) {
    console.error('[Admin] Error loading Firestore metrics:', error);
    res.status(500).json({ errno: 500, error: error.message || String(error), result: { warnings } });
  }
});

/**
 * GET /api/admin/users - List all registered users with basic info
 */
app.get('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const usersSnap = await db.collection('users').get();
    const profileByUid = new Map();
    usersSnap.docs.forEach((doc) => {
      profileByUid.set(doc.id, doc.data() || {});
    });

    // Include users that authenticated but never completed onboarding/profile init.
    // Those users exist in Firebase Auth but may be missing users/{uid} docs.
    const authByUid = new Map();
    try {
      let pageToken;
      do {
        const page = await admin.auth().listUsers(1000, pageToken);
        (page.users || []).forEach((userRecord) => {
          authByUid.set(userRecord.uid, userRecord);
        });
        pageToken = page.pageToken;
      } while (pageToken);
    } catch (authListErr) {
      console.warn('[Admin] listUsers failed; falling back to Firestore-only users:', authListErr.message || authListErr);
    }

    const allUids = new Set([...profileByUid.keys(), ...authByUid.keys()]);

    const users = await Promise.all(Array.from(allUids).map(async (uid) => {
      const data = profileByUid.get(uid) || {};
      const authUser = authByUid.get(uid) || null;
      const authMetadata = authUser && authUser.metadata ? authUser.metadata : null;

      let rulesCount = 0;
      if (profileByUid.has(uid)) {
        try {
          const rulesSnap = await db.collection('users').doc(uid).collection('rules').get();
          rulesCount = rulesSnap.size;
        } catch (e) {
          // Ignore errors per user and keep endpoint resilient
        }
      }

      // Joined date: prefer Firebase Auth creation time (source of truth),
      // then fall back to Firestore createdAt for backward compatibility.
      const joinedAt = (authMetadata && authMetadata.creationTime) ? authMetadata.creationTime : (data.createdAt || null);
      const email = data.email || (authUser && authUser.email ? authUser.email : '');
      const emailLc = String(email || '').toLowerCase();
      const isSeedAdmin = emailLc === SEED_ADMIN_EMAIL;

      return {
        uid,
        email,
        role: data.role || (isSeedAdmin ? 'admin' : 'user'),
        automationEnabled: !!data.automationEnabled,
        createdAt: data.createdAt || null,
        joinedAt,
        lastSignedInAt: (authMetadata && authMetadata.lastSignInTime) ? authMetadata.lastSignInTime : null,
        rulesCount,
        profileInitialized: profileByUid.has(uid),
        lastUpdated: data.lastUpdated || null
      };
    }));

    res.json({ errno: 0, result: { users } });
  } catch (error) {
    console.error('[Admin] Error listing users:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * GET /api/admin/platform-stats - Compact platform KPIs + trend data
 * Query: ?days=90 (default 90, min 7, max 365)
 */
app.get('/api/admin/platform-stats', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const daysRaw = Number(req.query?.days);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(365, Math.floor(daysRaw))) : 90;

    const toMs = (value) => {
      if (!value) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return d && d.getTime ? d.getTime() : null;
      }
      if (Number.isFinite(value._seconds)) return value._seconds * 1000;
      if (Number.isFinite(value.seconds)) return value.seconds * 1000;
      return null;
    };

    // Build date window in UTC date keys (YYYY-MM-DD)
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const startUtc = todayUtc - (days - 1) * 24 * 60 * 60 * 1000;

    const dateBuckets = [];
    for (let i = 0; i < days; i++) {
      const dayMs = startUtc + i * 24 * 60 * 60 * 1000;
      const date = new Date(dayMs);
      const key = date.toISOString().slice(0, 10);
      dateBuckets.push({ key, dayStartMs: dayMs, dayEndMs: dayMs + (24 * 60 * 60 * 1000) - 1 });
    }

    // Load Firestore user profiles
    const usersSnap = await db.collection('users').get();
    const profileByUid = new Map();
    usersSnap.docs.forEach((doc) => {
      profileByUid.set(doc.id, doc.data() || {});
    });

    // Load Firebase Auth users (captures onboarding-only users)
    const authByUid = new Map();
    try {
      let pageToken;
      do {
        const page = await admin.auth().listUsers(1000, pageToken);
        (page.users || []).forEach((userRecord) => authByUid.set(userRecord.uid, userRecord));
        pageToken = page.pageToken;
      } while (pageToken);
    } catch (authErr) {
      console.warn('[Admin] platform-stats listUsers failed:', authErr.message || authErr);
    }

    const allUids = new Set([...profileByUid.keys(), ...authByUid.keys()]);

    const users = await Promise.all(Array.from(allUids).map(async (uid) => {
      const profile = profileByUid.get(uid) || {};
      const authUser = authByUid.get(uid) || null;
      const authMetadata = authUser && authUser.metadata ? authUser.metadata : null;

      const email = profile.email || (authUser?.email || '');
      const emailLc = String(email || '').toLowerCase();
      const role = profile.role || (emailLc === SEED_ADMIN_EMAIL ? 'admin' : 'user');

      const joinedAtMs = toMs(authMetadata?.creationTime) || toMs(profile.createdAt);
      const lastSignInMs = toMs(authMetadata?.lastSignInTime) || null;

      let configured = false;
      let configuredAtMs = null;
      let firstRuleAtMs = null;
      let hasRules = false;
      if (profileByUid.has(uid)) {
        try {
          const cfgDoc = await db.collection('users').doc(uid).collection('config').doc('main').get();
          if (cfgDoc.exists) {
            const cfg = cfgDoc.data() || {};
            configured = !!(cfg.setupComplete || cfg.deviceSn || cfg.foxessToken || cfg.amberApiKey);
            if (configured) {
              configuredAtMs =
                toMs(cfg.setupCompletedAt) ||
                toMs(cfg.firstConfiguredAt) ||
                toMs(cfg.updatedAt) ||
                toMs(cfg.createdAt) ||
                toMs(profile.lastUpdated) ||
                joinedAtMs;
            }
          }
        } catch (cfgErr) {
          // Keep endpoint resilient for per-user errors
        }

        try {
          let firstRuleSnap = await db.collection('users').doc(uid)
            .collection('rules')
            .orderBy('createdAt', 'asc')
            .limit(1)
            .get();

          // Fallback for legacy rules missing createdAt
          if (firstRuleSnap.empty) {
            firstRuleSnap = await db.collection('users').doc(uid)
              .collection('rules')
              .limit(1)
              .get();
          }

          if (!firstRuleSnap.empty) {
            hasRules = true;
            const firstRule = firstRuleSnap.docs[0].data() || {};
            firstRuleAtMs =
              toMs(firstRule.createdAt) ||
              toMs(firstRule.updatedAt) ||
              configuredAtMs ||
              toMs(profile.lastUpdated) ||
              joinedAtMs;
          }
        } catch (ruleErr) {
          // Keep endpoint resilient for per-user errors
        }
      }

      return {
        uid,
        role,
        automationEnabled: !!profile.automationEnabled,
        joinedAtMs,
        lastSignInMs,
        configured,
        configuredAtMs,
        hasRules,
        firstRuleAtMs
      };
    }));

    const joinedSeries = users
      .map((u) => u.joinedAtMs)
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    const configuredSeries = users
      .map((u) => u.configuredAtMs)
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    const rulesSeries = users
      .map((u) => u.firstRuleAtMs)
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    let joinedIdx = 0;
    let configuredIdx = 0;
    let rulesIdx = 0;
    let totalUsers = 0;
    let configuredUsers = 0;
    let usersWithRules = 0;

    const trend = dateBuckets.map((bucket) => {
      while (joinedIdx < joinedSeries.length && joinedSeries[joinedIdx] <= bucket.dayEndMs) {
        totalUsers += 1;
        joinedIdx += 1;
      }
      while (configuredIdx < configuredSeries.length && configuredSeries[configuredIdx] <= bucket.dayEndMs) {
        configuredUsers += 1;
        configuredIdx += 1;
      }
      while (rulesIdx < rulesSeries.length && rulesSeries[rulesIdx] <= bucket.dayEndMs) {
        usersWithRules += 1;
        rulesIdx += 1;
      }
      return {
        date: bucket.key,
        totalUsers,
        configuredUsers,
        usersWithRules
      };
    });

    // MAU = users who signed in at least once in the current calendar month (UTC)
    const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const summary = {
      totalUsers: users.length,
      configuredUsers: users.filter((u) => u.configured).length,
      usersWithRules: users.filter((u) => u.hasRules).length,
      admins: users.filter((u) => u.role === 'admin').length,
      mau: users.filter((u) => u.lastSignInMs !== null && u.lastSignInMs >= monthStartMs).length,
      automationActive: users.filter((u) => u.automationEnabled).length
    };

    res.json({ errno: 0, result: { summary, trend, days } });
  } catch (error) {
    console.error('[Admin] Error loading platform stats:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * POST /api/admin/users/:uid/role - Update a user's role
 * Body: { role: 'admin' | 'user' }
 */
app.post('/api/admin/users/:uid/role', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ errno: 400, error: 'Role must be "admin" or "user"' });
    }
    // Prevent removing your own admin role
    if (uid === req.user.uid && role !== 'admin') {
      return res.status(400).json({ errno: 400, error: 'Cannot remove your own admin role' });
    }
    await db.collection('users').doc(uid).set({ role, lastUpdated: serverTimestamp() }, { merge: true });
    res.json({ errno: 0, result: { uid, role } });
  } catch (error) {
    console.error('[Admin] Error setting role:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * POST /api/admin/users/:uid/delete - Delete user account and all Firestore data
 * Body: { confirmText: 'DELETE' }
 */
app.post('/api/admin/users/:uid/delete', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const confirmText = String(req.body?.confirmText || '').trim();

    if (!uid) {
      return res.status(400).json({ errno: 400, error: 'uid is required' });
    }
    if (confirmText !== 'DELETE') {
      return res.status(400).json({ errno: 400, error: 'Confirmation text must be DELETE' });
    }
    if (uid === req.user.uid) {
      return res.status(400).json({ errno: 400, error: 'Cannot delete your own admin account from this endpoint' });
    }

    let targetUser;
    try {
      targetUser = await admin.auth().getUser(uid);
    } catch (e) {
      return res.status(404).json({ errno: 404, error: 'User not found' });
    }

    await deleteUserDataTree(uid);

    try {
      await deleteCollectionDocs(db.collection('admin_audit').where('adminUid', '==', uid));
      await deleteCollectionDocs(db.collection('admin_audit').where('targetUid', '==', uid));
    } catch (auditError) {
      console.warn('[AdminDelete] Failed to clean admin_audit references:', auditError.message || auditError);
    }

    try {
      await admin.auth().deleteUser(uid);
    } catch (authErr) {
      if (!authErr || authErr.code !== 'auth/user-not-found') {
        throw authErr;
      }
    }

    await db.collection('admin_audit').add({
      action: 'delete_user',
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      targetUid: uid,
      targetEmail: targetUser.email || '',
      timestamp: serverTimestamp()
    });

    res.json({ errno: 0, result: { deleted: true, uid, email: targetUser.email || '' } });
  } catch (error) {
    console.error('[Admin] Error deleting user:', error);
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

/**
 * GET /api/admin/users/:uid/stats - Get utilization stats for a specific user
 * Returns last 30 days of per-user API metrics, automation state, rule count, and config summary
 */
app.get('/api/admin/users/:uid/stats', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    
    // 1. Gather last 30 days of per-user API metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const metricsSnap = await db.collection('users').doc(uid)
      .collection('metrics').orderBy('updatedAt', 'desc').limit(30).get();
    const metrics = {};
    metricsSnap.forEach(doc => {
      metrics[doc.id] = { foxess: doc.data().foxess || 0, amber: doc.data().amber || 0, weather: doc.data().weather || 0 };
    });

    // 2. Automation state
    let automationState = null;
    try {
      const stateDoc = await db.collection('users').doc(uid).collection('automation').doc('state').get();
      automationState = stateDoc.exists ? stateDoc.data() : null;
    } catch (e) { /* ignore */ }

    // 3. Rule count
    let ruleCount = 0;
    try {
      const rulesSnap = await db.collection('users').doc(uid).collection('rules').get();
      ruleCount = rulesSnap.size;
    } catch (e) { /* ignore */ }

    // 4. Config summary (no secrets)
    let configSummary = {};
    try {
      const configDoc = await db.collection('users').doc(uid).collection('config').doc('main').get();
      if (configDoc.exists) {
        const c = configDoc.data();

        const rawSystemTopology = c.systemTopology || c.topology || null;
        let resolvedCoupling = normalizeCouplingValue(
          rawSystemTopology?.coupling ||
          c.coupling ||
          c.systemCoupling ||
          c.topologyCoupling
        );

        // Legacy compatibility: older payloads may only have boolean hints.
        const legacyAcHint =
          (typeof rawSystemTopology?.isLikelyAcCoupled === 'boolean')
            ? rawSystemTopology.isLikelyAcCoupled
            : ((typeof c.isLikelyAcCoupled === 'boolean') ? c.isLikelyAcCoupled : null);

        if (resolvedCoupling === 'unknown' && legacyAcHint !== null) {
          resolvedCoupling = legacyAcHint ? 'ac' : 'dc';
        }

        const normalizedSystemTopology = {
          ...(rawSystemTopology || {}),
          coupling: resolvedCoupling,
          source: rawSystemTopology?.source || (legacyAcHint !== null ? 'legacy' : 'unknown')
        };

        configSummary = {
          hasDeviceSn: !!c.deviceSn,
          hasFoxessToken: !!c.foxessToken,
          hasAmberApiKey: !!c.amberApiKey,
          location: c.location || null,
          timezone: c.timezone || null,
          systemTopology: normalizedSystemTopology
        };
      }
    } catch (e) { /* ignore */ }

    res.json({ errno: 0, result: { uid, metrics, automationState, ruleCount, configSummary } });
  } catch (error) {
    console.error('[Admin] Error getting user stats:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * POST /api/admin/impersonate - Generate a custom token for the target user
 * Body: { uid: 'target-user-uid' }
 * Returns a custom Firebase Auth token the admin can use to sign in as that user.
 */
app.post('/api/admin/impersonate', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      return res.status(400).json({ errno: 400, error: 'uid is required' });
    }
    // Verify the target user exists
    let targetUser;
    try {
      targetUser = await admin.auth().getUser(uid);
    } catch (e) {
      return res.status(404).json({ errno: 404, error: 'User not found' });
    }
    // Strict mode: only custom-token impersonation is allowed to ensure
    // the UI/API experience matches the target user exactly.
    let customToken = null;
    const mode = 'customToken';
    try {
      customToken = await admin.auth().createCustomToken(uid, { impersonatedBy: req.user.uid });
    } catch (tokenErr) {
      const msg = tokenErr && tokenErr.message ? tokenErr.message : String(tokenErr);
      const isSignBlobDenied = msg.includes('iam.serviceAccounts.signBlob') || msg.includes('Permission iam.serviceAccounts.signBlob denied');
      if (isSignBlobDenied) {
        return res.status(503).json({
          errno: 503,
          error: 'Impersonation is unavailable until IAM token signing is enabled. Grant roles/iam.serviceAccountTokenCreator to the Cloud Functions service account on the runtime service account.'
        });
      }
      throw tokenErr;
    }
    
    // Audit log
    await db.collection('admin_audit').add({
      action: 'impersonate',
      mode,
      adminUid: req.user.uid,
      adminEmail: req.user.email,
      targetUid: uid,
      targetEmail: targetUser.email || '',
      timestamp: serverTimestamp()
    });

    return res.json({
      errno: 0,
      result: {
        mode,
        customToken,
        targetUid: uid,
        targetEmail: targetUser.email || ''
      }
    });
  } catch (error) {
    console.error('[Admin] Error impersonating user:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * GET /api/admin/check - Check if the current user is an admin
 * Used by the frontend to decide whether to show the admin nav link
 */
app.get('/api/admin/check', authenticateUser, async (req, res) => {
  const adminStatus = await isAdmin(req);
  res.json({ errno: 0, result: { isAdmin: adminStatus } });
});

// Apply auth middleware to remaining API routes
app.use('/api', authenticateUser);

// Header-based impersonation is intentionally disabled.
// Strict impersonation mode uses Firebase custom tokens only so the session
// is identical to the target user and cannot leak admin context.
app.use('/api', async (req, res, next) => {
  next();
});

// ==================== PROTECTED ENDPOINTS (After Auth Middleware) ====================

// Health check with auth
app.get('/api/health/auth', (req, res) => {
  res.json({ ok: true, user: req.user.uid });
});

// ==================== HELPER FUNCTIONS ====================

// ==================== FOXESS API MODULE ====================
// All FoxESS-related functions have been extracted to api/foxess.js
// Functions are initialized at module load and reinit after dependencies are available (line ~4180)
// Access via foxessAPI.foxessAPI.callFoxESSAPI(), foxessAPI.generateFoxESSSignature()

/**
 * Call Amber API
 */

// ==================== AMBER API MODULE ====================
// All Amber-related functions have been extracted to api/amber.js
// Functions are initialized at module load and reinit after dependencies are available (line ~4178)
// Access via amberAPI.callAmberAPI(), amberAPI.getCachedAmberSites(), etc.

/**
 * Call Weather API (Open-Meteo)
 * Fetches extended forecast with solar radiation, cloud cover, and other useful fields
 * Max forecast_days is 16 for Open-Meteo free tier
 */
async function callWeatherAPI(place = 'Sydney', days = 16, userId = null) {
  // Track API call if userId provided
  if (userId) {
    incrementApiCount(userId, 'weather').catch(() => {});
  }
  
  // Clamp days to Open-Meteo max of 16
  const forecastDays = Math.min(Math.max(1, days), 16);
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // Increased timeout for larger payload
    
    // Geocode place - request 5 results to handle ambiguous names across countries
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=5&language=en`;
    const geoResp = await fetch(geoUrl, { signal: controller.signal });
    const geoJson = await geoResp.json();
    
    let latitude, longitude, resolvedName, country, fallback = false, fallbackReason = '', fallbackResolvedName = '';
    if (geoJson?.results?.length > 0) {
      // Prioritize Australian locations to handle cases like "Narara" (AU vs Fiji)
      const auResult = geoJson.results.find(r => r.country_code === 'AU');
      const selectedResult = auResult || geoJson.results[0];
      
      latitude = selectedResult.latitude;
      longitude = selectedResult.longitude;
      resolvedName = selectedResult.name;
      country = selectedResult.country;
    } else {
      // Fallback to Sydney when geocoding returns no results
      fallback = true;
      fallbackReason = 'location_not_found';
      fallbackResolvedName = 'Sydney NSW';
      latitude = -33.9215;
      longitude = 151.0390;
      resolvedName = place;
      country = 'AU';
    }
    
    // Extended hourly variables including solar radiation and cloud cover
    const hourlyVars = [
      'temperature_2m',
      'precipitation',
      'precipitation_probability',
      'weathercode',
      'shortwave_radiation',      // Solar irradiance W/m² - key for PV production
      'direct_radiation',         // Direct solar radiation W/m²
      'diffuse_radiation',        // Diffuse solar radiation W/m²
      'cloudcover',               // Total cloud cover %
      'windspeed_10m',
      'relativehumidity_2m',
      'uv_index'
    ].join(',');
    
    // Extended daily variables including sunrise/sunset
    const dailyVars = [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'weathercode',
      'shortwave_radiation_sum',  // Total daily solar radiation MJ/m²
      'uv_index_max',
      'sunrise',
      'sunset',
      'precipitation_probability_max'
    ].join(',');
    
    // Get forecast with extended variables
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=${hourlyVars}&daily=${dailyVars}&current_weather=true&temperature_unit=celsius&timezone=auto&forecast_days=${forecastDays}`;
    const forecastResp = await fetch(forecastUrl, { signal: controller.signal });
    const forecastJson = await forecastResp.json();
    clearTimeout(timeout);
    
    // Extract timezone from Open-Meteo response (e.g., "America/New_York", "Europe/London", "Australia/Sydney")
    const detectedTimezone = forecastJson.timezone || 'Australia/Sydney';
    
    return {
      errno: 0,
      result: {
        source: 'open-meteo',
        place: {
          query: place,
          resolvedName,
          country,
          latitude,
          longitude,
          timezone: detectedTimezone,
          fallback,
          fallbackReason,
          fallbackResolvedName
        },
        current: forecastJson.current_weather || null,
        hourly: forecastJson.hourly || null,
        daily: forecastJson.daily || null,
        raw: forecastJson,
        forecastDays: forecastDays
      }
    };
  } catch (error) {
    return { errno: 500, error: error.message };
  }
}

/**
 * Cache weather data in Firestore (per-user)
 * TTL: 30 minutes
 */
async function getCachedWeatherData(userId, place = 'Sydney', days = 16, forceRefresh = false) {
  const config = getConfig();
  const ttlMs = config.automation.cacheTtl.weather; // 30 minutes
  
  try {
    // Skip cache check if forceRefresh is true
    if (!forceRefresh) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('weather').get();
      
      if (cacheDoc.exists) {
        const { data, timestamp, cachedDays, cachedPlace } = cacheDoc.data();
        const ageMs = Date.now() - timestamp;
        const cachedDayCount = data?.result?.daily?.time?.length || 0;
        
        // Compare places case-insensitively and handle undefined/null
        const placesMatch = (cachedPlace || '').toLowerCase().trim() === (place || '').toLowerCase().trim();
        
        // Validate cache is still fresh AND has enough days AND is for the same place
        // Use cache if it has >= requested days (e.g., cached 7 days can serve a request for 6 days)
        // IMPORTANT: Force cache MISS if location changed - this allows timezone to update
        if (!placesMatch) {
          // Fall through to fetch fresh data
        } else if (ageMs < ttlMs && cachedDays >= days && cachedDayCount >= days) {
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
      }
    }
    
    // Fetch fresh data from Open-Meteo
    const data = await callWeatherAPI(place, days, userId);
    
    // If weather fetch succeeded and returned a timezone, update user config with detected timezone
    if (data?.errno === 0 && data?.result?.place?.timezone && userId) {
      const detectedTimezone = data.result.place.timezone;
      try {
        await db.collection('users').doc(userId).collection('config').doc('main').set(
          { timezone: detectedTimezone },
          { merge: true }
        );
      } catch (tzErr) {
        console.warn(`[Weather] Failed to update user timezone: ${tzErr.message}`);
      }
    }
    
    // Store in cache if successful
    // NOTE: Only store the daily data and metadata, not full hourly (reduces Firestore document size)
    if (data?.errno === 0) {
      const cacheData = {
        errno: data.errno,
        result: {
          source: data.result?.source,
          place: data.result?.place,
          current: data.result?.current,
          daily: data.result?.daily,  // Include daily forecast
          hourly: data.result?.hourly,  // Include hourly forecast
          forecastDays: data.result?.forecastDays
        }
      };
      await db.collection('users').doc(userId).collection('cache').doc('weather').set({
        data: cacheData,
        timestamp: Date.now(),
        ttlMs,
        cachedPlace: place,  // Store the place parameter exactly as received for comparison
        cachedDays: days,  // Store requested days for cache validation
        ttl: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000) // Firestore TTL in seconds
      }, { merge: true }).catch(cacheErr => {
        console.warn(`[Cache] Failed to store weather cache: ${cacheErr.message}`);
      });
    }
    
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    console.error(`[Cache] Error in getCachedWeatherData: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}

/**
 * Validate timezone string is a valid IANA timezone
 */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    // Test by trying to use it in toLocaleString
    new Date().toLocaleString('en-AU', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get user's timezone from config
 * Config is kept up-to-date via:
 * - Browser timezone detection (sent every time frontend saves)
 * - Location-based detection (when location is set)
 * - Weather API detection (when weather is fetched for any rule)
 */
function getAutomationTimezone(userConfig) {
  if (userConfig?.timezone && isValidTimezone(userConfig.timezone)) {
    return userConfig.timezone;
  }
  return DEFAULT_TIMEZONE;
}

/**
 * Get user config from Firestore
 */
async function getUserConfig(userId) {
  try {
    logger.debug('Config', `Loading config for user: ${userId}`);
    
    // Primary location: users/{uid}/config/main (newer code)
    const configDoc = await db.collection('users').doc(userId).collection('config').doc('main').get();
    if (configDoc.exists) {
      const data = configDoc.data() || {};
      logger.debug('Config', `Found config at users/${userId}/config/main: { hasDeviceSn: ${!!data.deviceSn}, hasFoxessToken: ${!!data.foxessToken} }`);
      return { ...data, _source: 'config-main' };
    }

    // Backward compatibility: older deployments stored credentials directly on users/{uid}.credentials
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data() || {};

      // If the older 'credentials' object exists, map its snake_case fields to the config shape
      if (data.credentials && (data.credentials.device_sn || data.credentials.foxess_token || data.credentials.amber_api_key)) {
        return {
          deviceSn: data.credentials.device_sn || '',
          foxessToken: data.credentials.foxess_token || '',
          amberApiKey: data.credentials.amber_api_key || '',
          // No explicit setupComplete flag in old storage — consider presence of tokens as complete
          setupComplete: !!(data.credentials.device_sn && data.credentials.foxess_token),
          _source: 'legacy-credentials'
        };
      }

      // If top-level config keys exist directly on the user doc, use them too
      if (data.deviceSn || data.foxessToken || data.amberApiKey) {
        return {
          deviceSn: data.deviceSn || '',
          foxessToken: data.foxessToken || '',
          amberApiKey: data.amberApiKey || '',
          setupComplete: !!(data.deviceSn && data.foxessToken),
          _source: 'user-top-level'
        };
      }
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
      const data = stateDoc.data();
      return data;
    }
    return {
      enabled: false,
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
 * Also syncs automationEnabled flag on parent user doc for efficient scheduler queries
 */
async function saveUserAutomationState(userId, state) {
  try {
    await db.collection('users').doc(userId).collection('automation').doc('state').set(state, { merge: true });
    
    // Sync enabled flag to parent user doc for efficient scheduler pre-filtering
    if ('enabled' in state) {
      await db.collection('users').doc(userId).set(
        { automationEnabled: !!state.enabled },
        { merge: true }
      );
    }
    return true;
  } catch (error) {
    console.error('Error saving automation state:', error);
    return false;
  }
}

/**
 * Get quick control state from Firestore
 */
async function getQuickControlState(userId) {
  try {
    const stateDoc = await db.collection('users').doc(userId).collection('quickControl').doc('state').get();
    if (stateDoc.exists) {
      return stateDoc.data();
    }
    return null;
  } catch (error) {
    console.error('Error getting quick control state:', error);
    return null;
  }
}

/**
 * Save quick control state to Firestore
 */
async function saveQuickControlState(userId, state) {
  try {
    if (state === null) {
      // Delete the state document
      await db.collection('users').doc(userId).collection('quickControl').doc('state').delete();
    } else {
      await db.collection('users').doc(userId).collection('quickControl').doc('state').set(state);
    }
    return true;
  } catch (error) {
    console.error('Error saving quick control state:', error);
    return false;
  }
}

/**
 * Clean up expired quick control: clear scheduler segments, disable flag, delete state
 * Called from both automation cycle (server-side) and status endpoint (on user poll)
 * Returns true if cleanup was performed, false if nothing to clean up
 */
async function cleanupExpiredQuickControl(userId, quickState) {
  if (!quickState || !quickState.active || quickState.expiresAt > Date.now()) {
    return false;
  }
  
  logger.info('QuickControl', `Auto-cleanup expired quick control: type=${quickState.type}, expiresAt=${new Date(quickState.expiresAt).toISOString()}, userId=${userId}`);
  
  // Clear all scheduler segments
  try {
    const userConfig = await getUserConfig(userId);
    const deviceSN = userConfig?.deviceSn;
    if (deviceSN) {
      const clearedGroups = [];
      for (let i = 0; i < 8; i++) {
        clearedGroups.push({
          enable: 0,
          workMode: 'SelfUse',
          startHour: 0, startMinute: 0,
          endHour: 0, endMinute: 0,
          minSocOnGrid: 10,
          fdSoc: 10,
          fdPwr: 0,
          maxSoc: 100
        });
      }
      const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
      if (clearResult?.errno === 0) {
        logger.debug('QuickControl', `Auto-cleanup cleared segments successfully`);
      } else {
        console.warn(`[QuickControl] Auto-cleanup segment clear returned errno=${clearResult?.errno}`);
      }
      
      // Disable scheduler flag
      try {
        await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      } catch (flagErr) {
        console.warn('[QuickControl] Auto-cleanup flag disable failed:', flagErr?.message || flagErr);
      }
    }
  } catch (err) {
    console.error(`[QuickControl] Auto-cleanup error:`, err.message);
  }
  
  // Delete quick control state
  await saveQuickControlState(userId, null);
  
  // Log to history
  try {
    await addHistoryEntry(userId, {
      type: 'quickcontrol_auto_cleanup',
      controlType: quickState.type,
      power: quickState.power,
      durationMinutes: quickState.durationMinutes,
      timestamp: serverTimestamp()
    });
  } catch (e) { /* ignore */ }
  
  return true;
}

/**
 * Check and apply solar curtailment if conditions are met
 * This runs AFTER automation rules to avoid conflicts
 * 
 * @param {string} userId - User ID
 * @param {object} userConfig - User configuration
 * @param {array} amberData - Current Amber price data
 * @returns {object} Result of curtailment check and action
 */
/**
 * Check and apply solar curtailment based on feed-in price and user config
 * 
 * @param {string} userId - User ID
 * @param {Object} userConfig - User configuration with curtailment settings
 *   - curtailment.enabled {boolean} - Is curtailment feature enabled?
 *   - curtailment.priceThreshold {number} - Price threshold in cents/kWh (range: -999 to +999)
 *     When feed-in price drops below this, curtailment activates
 *     Default: 0 (curtail when price ≤ 0, useful for avoiding negative pricing)
 * @param {Object} amberData - Current Amber electricity price data with currentPrice in cents/kWh
 * @returns {Promise<Object>} Curtailment state and action taken
 */
async function checkAndApplyCurtailment(userId, userConfig, amberData) {
  const result = {
    enabled: false,
    triggered: false,
    priceThreshold: null,
    currentPrice: null,
    action: null,
    error: null,
    stateChanged: false
  };

  try {
    // OPTIMIZATION: If curtailment is not enabled, skip state check
    if (!userConfig?.curtailment?.enabled) {
      result.enabled = false;
      
      // Only check and restore if we have a device and might need to deactivate
      if (userConfig?.deviceSn) {
        // Do a quick check if state exists WITHOUT reading full document
        // We only need to know if it was previously active
        const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
        const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false };
        
        // If it was previously active, restore power
        if (curtailmentState.active) {
          console.log(`[Curtailment] Restoring power (was active, now disabled)`);
          
          const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
            sn: userConfig.deviceSn,
            key: 'ExportLimit',
            value: 12000
          }, userConfig, userId);
          
          if (setResult?.errno === 0) {
            result.action = 'deactivated_by_disable';
            result.stateChanged = true;
            await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
              active: false,
              lastPrice: null,
              lastDeactivated: Date.now(),
              disabledByUser: true
            });
          } else {
            result.error = `Failed to restore export limit: ${setResult?.msg || 'Unknown error'}`;
          }
        }
      }
      
      return result;
    }

    // Curtailment is ENABLED - do full check
    result.enabled = true;
    result.priceThreshold = userConfig.curtailment.priceThreshold;

    // Get current feed-in price from Amber data
    if (!Array.isArray(amberData) || amberData.length === 0) {
      result.error = 'No Amber price data available';
      return result;
    }

    const currentInterval = amberData.find(p => p.type === 'CurrentInterval' && p.channelType === 'feedIn');
    if (!currentInterval) {
      result.error = 'No current feed-in price found';
      return result;
    }

    // Negate the feed-in price for display (Amber API returns negative values for feed-in)
    // This makes it positive for display and comparison
    result.currentPrice = -currentInterval.perKwh;

    // Get curtailment state from Firestore
    const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
    const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false, lastPrice: null };

    // Determine if we should curtail (price below threshold)
    const shouldCurtail = result.currentPrice < result.priceThreshold;
    result.triggered = shouldCurtail;

    // Only take action if state has changed (avoid redundant API calls)
    if (shouldCurtail && !curtailmentState.active) {
      // Activate curtailment: set ExportLimit to 0
      console.log(`[Curtailment] Activating (price ${result.currentPrice.toFixed(2)}¢ < ${result.priceThreshold}¢)`);
      
      if (!userConfig?.deviceSn) {
        result.error = 'No device SN configured';
        return result;
      }

      const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
        sn: userConfig.deviceSn,
        key: 'ExportLimit',
        value: 0
      }, userConfig, userId);

      if (setResult?.errno === 0) {
        result.action = 'activated';
        result.stateChanged = true;
        await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
          active: true,
          lastPrice: result.currentPrice,
          lastActivated: Date.now(),
          threshold: result.priceThreshold
        });
      } else {
        result.error = `Failed to set export limit: ${setResult?.msg || 'Unknown error'}`;
      }

    } else if (!shouldCurtail && curtailmentState.active) {
      // Deactivate curtailment: restore ExportLimit to 12000
      console.log(`[Curtailment] Deactivating (price ${result.currentPrice.toFixed(2)}¢ >= ${result.priceThreshold}¢)`);
      
      if (!userConfig?.deviceSn) {
        result.error = 'No device SN configured';
        return result;
      }

      const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
        sn: userConfig.deviceSn,
        key: 'ExportLimit',
        value: 12000
      }, userConfig, userId);

      if (setResult?.errno === 0) {
        result.action = 'deactivated';
        result.stateChanged = true;
        await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
          active: false,
          lastPrice: result.currentPrice,
          lastDeactivated: Date.now(),
          threshold: result.priceThreshold
        });
      } else {
        result.error = `Failed to restore export limit: ${setResult?.msg || 'Unknown error'}`;
      }
    }

  } catch (error) {
    result.error = error.message;
    console.error('[Curtailment] Error:', error);
  }

  return result;
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
 * Get current time in user's timezone
 */
function getTimeInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const values = {};
  parts.forEach(part => {
    values[part.type] = part.value;
  });
  return new Date(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`);
}

/**
 * Check if current time falls within a time range (HH:MM format)
 */
function isTimeInRange(currentTime, startTime, endTime) {
  // currentTime format: "HH:MM"
  // startTime, endTime format: "HH:MM"
  
  const current = parseInt(currentTime.replace(':', ''));
  const start = parseInt(startTime.replace(':', ''));
  const end = parseInt(endTime.replace(':', ''));

  // If start < end (normal case: 22:00 to 06:00 wraps around midnight)
  if (start >= end) {
    return current >= start || current < end; // Wraps around midnight
  } else {
    return current >= start && current < end;
  }
}

function normalizeCouplingValue(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'ac' || raw === 'ac-coupled' || raw === 'ac_coupled') return 'ac';
  if (raw === 'dc' || raw === 'dc-coupled' || raw === 'dc_coupled') return 'dc';
  return 'unknown';
}

const DEFAULT_TOPOLOGY_REFRESH_MS = 4 * 60 * 60 * 1000;

/**
 * Add entry to user history
 */
async function addHistoryEntry(userId, entry) {
  try {
    await db.collection('users').doc(userId).collection('history').add({
      ...entry,
      timestamp: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error adding history entry:', error);
    return false;
  }
}

async function deleteCollectionDocs(query, batchSize = 200) {
  let snapshot = await query.limit(batchSize).get();
  while (!snapshot.empty) {
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    snapshot = await query.limit(batchSize).get();
  }
}

async function deleteDocumentTreeFallback(docRef) {
  if (!docRef || typeof docRef.listCollections !== 'function') {
    await docRef?.delete?.().catch(() => {});
    return;
  }
  const subcollections = await docRef.listCollections();
  for (const subcollection of subcollections) {
    let snapshot = await subcollection.limit(100).get();
    while (!snapshot.empty) {
      for (const doc of snapshot.docs) {
        await deleteDocumentTreeFallback(doc.ref);
      }
      snapshot = await subcollection.limit(100).get();
    }
  }
  await docRef.delete().catch(() => {});
}

async function deleteUserDataTree(userId) {
  const userRef = db.collection('users').doc(userId);
  if (typeof db.recursiveDelete === 'function') {
    await db.recursiveDelete(userRef);
    return;
  }
  await deleteDocumentTreeFallback(userRef);
}

// ==================== API ENDPOINTS ====================

// Get user config
app.get('/api/config', async (req, res) => {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ errno: 401, error: 'Unauthorized' });
    }
    const userConfig = await getUserConfig(req.user.uid);
    const serverConfig = getConfig();
    
    // Build config object with TTLs and defaults (same as setup-status)
    const config = {
      automation: {
        intervalMs: (userConfig?.automation?.intervalMs) || serverConfig.automation.intervalMs
      },
      cache: {
        amber: (userConfig?.cache?.amber) || serverConfig.automation.cacheTtl.amber,
        inverter: (userConfig?.automation?.inverterCacheTtlMs) || serverConfig.automation.cacheTtl.inverter,
        weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather
      },
      defaults: {
        cooldownMinutes: (userConfig?.defaults?.cooldownMinutes) || 5,
        durationMinutes: (userConfig?.defaults?.durationMinutes) || 30
      }
    };
    
    // Set cache headers: revalidate on every request but allow 304 Not Modified responses
    // This means browser will check with server each time, but gets instant 304 if unchanged
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.json({ errno: 0, result: { ...userConfig, config } });
  } catch (error) {
    console.error('[Config] Error getting user config:', error.message);
    // Return safe empty config instead of 500 error
    res.json({ errno: 0, result: {} });
  }
});

// Get persisted system topology/coupling hint for low-cost frontend detection
app.get('/api/config/system-topology', async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const topology = userConfig?.systemTopology || {};
    const coupling = normalizeCouplingValue(topology.coupling);

    res.json({
      errno: 0,
      result: {
        coupling,
        isLikelyAcCoupled: coupling === 'ac' ? true : (coupling === 'dc' ? false : null),
        source: topology.source || 'unknown',
        confidence: Number.isFinite(topology.confidence) ? Number(topology.confidence) : null,
        lastDetectedAt: topology.lastDetectedAt || null,
        updatedAt: topology.updatedAt || null,
        evidence: topology.evidence || null,
        refreshAfterMs: Number.isFinite(topology.refreshAfterMs) ? Number(topology.refreshAfterMs) : DEFAULT_TOPOLOGY_REFRESH_MS
      }
    });
  } catch (error) {
    console.error('[Config] Error getting system topology:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Persist system topology/coupling hint (manual or auto)
app.post('/api/config/system-topology', async (req, res) => {
  try {
    const userId = req.user.uid;
    const coupling = normalizeCouplingValue(req.body?.coupling);
    const sourceRaw = String(req.body?.source || 'auto').toLowerCase().trim();
    const source = (sourceRaw === 'manual' || sourceRaw === 'auto') ? sourceRaw : 'auto';
    const confidenceRaw = Number(req.body?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : null;
    const refreshAfterMsRaw = Number(req.body?.refreshAfterMs);
    const refreshAfterMs = Number.isFinite(refreshAfterMsRaw) && refreshAfterMsRaw > 0
      ? Math.floor(refreshAfterMsRaw)
      : DEFAULT_TOPOLOGY_REFRESH_MS;
    const lastDetectedAtRaw = Number(req.body?.lastDetectedAt);
    const lastDetectedAt = Number.isFinite(lastDetectedAtRaw) && lastDetectedAtRaw > 0
      ? Math.floor(lastDetectedAtRaw)
      : Date.now();

    const systemTopology = {
      coupling,
      source,
      updatedAt: serverTimestamp(),
      lastDetectedAt
    };

    if (confidence !== null) systemTopology.confidence = confidence;
    systemTopology.refreshAfterMs = refreshAfterMs;
    if (req.body?.evidence && typeof req.body.evidence === 'object') {
      systemTopology.evidence = req.body.evidence;
    }

    await db.collection('users').doc(userId).collection('config').doc('main').set({
      systemTopology
    }, { merge: true });

    res.json({ errno: 0, msg: 'System topology saved', result: systemTopology });
  } catch (error) {
    console.error('[Config] Error saving system topology:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Save user config
app.post('/api/config', async (req, res) => {
  try {
    // Accept both shapes: { config: {...} } (older functions API) or raw config object in body
    const newConfig = req.body && typeof req.body === 'object' ? (req.body.config ?? req.body) : null;
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ errno: 400, error: 'Invalid payload: expected config object' });
    }

    const userId = req.user.uid;

    // Get existing config to check if location changed
    const existingConfig = await getUserConfig(userId);
    
    // Normalize location fields: ensure location and preferences.weatherPlace stay in sync
    // Priority: use whichever field was provided, and sync to both
    const locationValue = newConfig.location || newConfig.preferences?.weatherPlace || existingConfig?.location || existingConfig?.preferences?.weatherPlace;
    if (locationValue) {
      newConfig.location = locationValue;
      if (!newConfig.preferences) newConfig.preferences = {};
      newConfig.preferences.weatherPlace = locationValue;
    }
    
    const locationChanged = newConfig.location && newConfig.location !== existingConfig?.location;
    
    // PRIORITY 1: If browser sent timezone, ALWAYS use it (most reliable - from user's OS)
    if (newConfig.browserTimezone && isValidTimezone(newConfig.browserTimezone)) {
      newConfig.timezone = newConfig.browserTimezone;
    }
    // PRIORITY 2: If location changed or no timezone set, detect from location
    else if (locationChanged || !newConfig.timezone) {
      const locationToUse = newConfig.location || existingConfig?.location || 'Sydney';
      try {
        const weatherData = await callWeatherAPI(locationToUse, 1, userId);
        const tzValid = weatherData?.result?.place?.timezone && isValidTimezone(weatherData.result.place.timezone);
        if (tzValid) {
          newConfig.timezone = weatherData.result.place.timezone;
        }
      } catch (err) {
        console.error(`[Config] Failed to detect timezone from location:`, err.message);
      }
    }
    // PRIORITY 3: Keep existing timezone if still valid
    else if (newConfig.timezone && isValidTimezone(newConfig.timezone)) {
      // timezone already set
    }
    
    // Remove browserTimezone from stored config (it's transient, only for detection)
    delete newConfig.browserTimezone;

    // CRITICAL FIX: Deep merge to preserve nested fields that weren't sent
    // Firestore's merge: true only works at top level, not for nested objects
    // This prevents accidentally clearing blackoutWindows or curtailment settings
    const mergedConfig = existingConfig ? deepMerge(existingConfig, newConfig) : newConfig;

    // Persist to Firestore under user's config/main
    await db.collection('users').doc(userId).collection('config').doc('main').set(mergedConfig, { merge: true });
    res.json({ errno: 0, msg: 'Config saved', result: mergedConfig });
  } catch (error) {
    console.error('[API] /api/config save error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// Clear credentials (clear deviceSN, foxessToken, amberApiKey from user config)
app.post('/api/config/clear-credentials', authenticateUser, async (req, res) => {
  try {
    const updates = {
      deviceSn: deleteField(),
      foxessToken: deleteField(),
      amberApiKey: deleteField(),
      setupComplete: false,
      updatedAt: serverTimestamp()
    };

    // Update the user's config/main document to clear these fields
    await db.collection('users').doc(req.user.uid).collection('config').doc('main').update(updates);
    
    res.json({ errno: 0, msg: 'Credentials cleared successfully' });
  } catch (error) {
    console.error('[API] /api/config/clear-credentials error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// ---------- Onboarding tour state ----------

// GET /api/config/tour-status — return tourComplete flag for the current user
app.get('/api/config/tour-status', authenticateUser, async (req, res) => {
  try {
    const config = await getUserConfig(req.user.uid);
    res.json({
      errno: 0,
      result: {
        tourComplete:    !!(config && config.tourComplete),
        tourCompletedAt: (config && config.tourCompletedAt) || null
      }
    });
  } catch (error) {
    console.error('[API] /api/config/tour-status GET error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// POST /api/config/tour-status — persist tour completion / reset flag
app.post('/api/config/tour-status', authenticateUser, async (req, res) => {
  try {
    const { tourComplete, tourCompletedAt, tourDismissedAt } = req.body || {};
    const updates = {};
    if (typeof tourComplete === 'boolean') updates.tourComplete = tourComplete;
    if (tourCompletedAt)  updates.tourCompletedAt  = tourCompletedAt;
    if (tourDismissedAt)  updates.tourDismissedAt  = tourDismissedAt;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ errno: 400, error: 'No valid fields to update' });
    }

    await db.collection('users').doc(req.user.uid).collection('config').doc('main').update(updates);
    res.json({ errno: 0, msg: 'Tour status updated' });
  } catch (error) {
    console.error('[API] /api/config/tour-status POST error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// Get automation state
app.get('/api/automation/status', async (req, res) => {
  try {
    const userId = req.user.uid;
    const state = await getUserAutomationState(userId);
    const rules = await getUserRules(userId);
    let userConfig = await getUserConfig(userId);
    const serverConfig = getConfig();
    
    // Migration: sync automationEnabled flag to parent user doc for scheduler pre-filtering
    // This ensures existing users who enabled automation before the flag was introduced
    // get picked up by the optimized scheduler query
    if (state && typeof state.enabled === 'boolean') {
      try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists && userDoc.data()?.automationEnabled !== state.enabled) {
          await db.collection('users').doc(userId).set(
            { automationEnabled: state.enabled },
            { merge: true }
          );
          logger.debug('Migration', `Synced automationEnabled=${state.enabled} for user ${userId}`);
        }
      } catch (migErr) {
        // Non-critical - don't fail the status request
        console.warn('[Migration] Failed to sync automationEnabled flag:', migErr.message);
      }
    }
    
    // Aggressive timezone sync: fetch weather to ensure timezone matches location.
    if (userConfig?.location) {
      try {
        const weatherData = await getCachedWeatherData(userId, userConfig.location, 1);
        if (weatherData?.result?.place?.timezone) {
          const weatherTimezone = weatherData.result.place.timezone;
          if (userConfig.timezone !== weatherTimezone) {
            await db.collection('users').doc(userId).collection('config').doc('main').set(
              { timezone: weatherTimezone },
              { merge: true }
            );
            userConfig.timezone = weatherTimezone;
          }
        }
      } catch (err) {
        // Silently handle timezone sync failures; use existing timezone
      }
    }
    
    // Use user's timezone for blackout window check
    const userTimezone = getAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const currentMinutes = userTime.hour * 60 + userTime.minute;
    
    // Check for blackout windows
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    
    let inBlackout = false;
    let currentBlackoutWindow = null;
    for (const window of blackoutWindows) {
      // Treat windows without explicit enabled property as enabled by default
      // (the user explicitly added them, so they should be active unless explicitly disabled)
      if (window.enabled === false) continue;
      const [startH, startM] = (window.start || '00:00').split(':').map(Number);
      const [endH, endM] = (window.end || '00:00').split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      
      // Handle windows that cross midnight
      if (startMins <= endMins) {
        if (currentMinutes >= startMins && currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      } else {
        if (currentMinutes >= startMins || currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      }
    }
    
    // Include user-specific cache TTLs and defaults
    const config = {
      // Automation timing
      automation: {
        intervalMs: (userConfig?.automation?.intervalMs) || serverConfig.automation.intervalMs
      },
      // Cache TTLs (respect user overrides, fall back to server defaults)
      cache: {
        amber: (userConfig?.cache?.amber) || serverConfig.automation.cacheTtl.amber,
        inverter: (userConfig?.automation?.inverterCacheTtlMs) || serverConfig.automation.cacheTtl.inverter,
        weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather
      },
      // Default rule behavior
      defaults: {
        cooldownMinutes: (userConfig?.defaults?.cooldownMinutes) || 5,
        durationMinutes: (userConfig?.defaults?.durationMinutes) || 30
      }
    };
    
    res.json({
      errno: 0,
      result: {
        ...state,
        rules,
        serverTime: Date.now(),
        userTimezone,  // Include user's timezone so frontend can format times correctly
        nextCheckIn: config.automation.intervalMs,
        inBlackout,
        currentBlackoutWindow,
        config  // Return user-specific configuration
      }
    });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Initialize user profile (creates Firestore document if missing)
app.post('/api/user/init-profile', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const existing = userDoc.exists ? (userDoc.data() || {}) : {};

    // IMPORTANT: createdAt must be immutable once set.
    // Previous logic used merge+serverTimestamp on every init call, which
    // could shift "joined" date repeatedly. We now set createdAt only when missing.
    const profileUpdate = {
      uid: userId,
      email: req.user.email || '',
      lastUpdated: serverTimestamp()
    };

    if (!userDoc.exists || typeof existing.automationEnabled !== 'boolean') {
      profileUpdate.automationEnabled = false;
    }

    if (!existing.createdAt) {
      profileUpdate.createdAt = serverTimestamp();
    }

    await userRef.set(profileUpdate, { merge: true });
    
    // Ensure automation state exists and is enabled
    const stateRef = db.collection('users').doc(userId).collection('automation').doc('state');
    const stateDoc = await stateRef.get();
    
    if (!stateDoc.exists) {
      // Create default state with automation DISABLED (user must enable it)
      await stateRef.set({
        enabled: false,
        lastCheck: null,
        lastTriggered: null,
        activeRule: null,
        updatedAt: serverTimestamp()
      });
    }
    
    res.json({
      errno: 0,
      result: {
        userId,
        message: 'User profile initialized successfully',
        automationEnabled: false
      }
    });
  } catch (error) {
    console.error('[API] Error initializing user:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Delete own account + user data (irreversible)
app.post('/api/user/delete-account', authenticateUser, async (req, res) => {
  try {
    // Safety: disallow deleting through admin header-impersonation context.
    if (req.actorUser) {
      return res.status(403).json({ errno: 403, error: 'Stop impersonation before deleting an account.' });
    }

    const userId = req.user.uid;
    const userEmail = String(req.user.email || '').trim().toLowerCase();
    const confirmText = String(req.body?.confirmText || '').trim();
    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();

    if (confirmText !== 'DELETE') {
      return res.status(400).json({ errno: 400, error: 'Confirmation text must be DELETE' });
    }

    if (userEmail && confirmEmail !== userEmail) {
      return res.status(400).json({ errno: 400, error: 'Confirmation email does not match signed-in user' });
    }

    // Remove user-scoped Firestore data first.
    await deleteUserDataTree(userId);

    // Best-effort cleanup for audit records referencing this user.
    try {
      await deleteCollectionDocs(db.collection('admin_audit').where('adminUid', '==', userId));
      await deleteCollectionDocs(db.collection('admin_audit').where('targetUid', '==', userId));
    } catch (auditError) {
      console.warn('[AccountDelete] Failed to clean admin_audit references:', auditError.message || auditError);
    }

    // Delete Firebase Auth identity.
    try {
      await admin.auth().deleteUser(userId);
    } catch (authErr) {
      if (!authErr || authErr.code !== 'auth/user-not-found') {
        throw authErr;
      }
    }

    res.json({ errno: 0, result: { deleted: true } });
  } catch (error) {
    console.error('[API] /api/user/delete-account error:', error && error.stack ? error.stack : String(error));
    res.status(500).json({ errno: 500, error: error.message || String(error) });
  }
});

// Toggle automation

app.post('/api/automation/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.uid;
    
    // When disabling automation, check if curtailment is active and restore export power
    if (enabled === false) {
      try {
        const userConfig = await getUserConfig(userId);
        const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
        const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false };
        
        if (curtailmentState.active && userConfig?.deviceSn) {
          console.log(`[Automation Toggle] Restoring export power (curtailment was active, automation disabled)`);
          
          const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
            sn: userConfig.deviceSn,
            key: 'ExportLimit',
            value: 12000
          }, userConfig, userId);
          
          if (setResult?.errno === 0) {
            await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
              active: false,
              lastPrice: null,
              lastDeactivated: Date.now(),
              disabledByAutomationToggle: true
            });
            console.log(`[Automation Toggle] ✓ Export power restored successfully`);
          } else {
            console.warn(`[Automation Toggle] ⚠️ Failed to restore export power: ${setResult?.msg || 'Unknown error'}`);
          }
        }
      } catch (curtErr) {
        console.error('[Automation Toggle] Error checking/restoring curtailment:', curtErr);
        // Don't fail the toggle operation if curtailment restoration fails
      }
    }
    
    await saveUserAutomationState(userId, { enabled: !!enabled });
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Backwards-compatible alias: some frontends call /api/automation/enable
app.post('/api/automation/enable', async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.uid;
    const stateUpdate = { enabled: !!enabled };
    
    // When re-enabling automation, clear the segmentsCleared flag so segments will be re-cleared on next disable
    if (enabled === true) {
      stateUpdate.segmentsCleared = false;
    }
    
    // When disabling automation, check if curtailment is active and restore export power
    if (enabled === false) {
      try {
        const userConfig = await getUserConfig(userId);
        const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
        const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false };
        
        if (curtailmentState.active && userConfig?.deviceSn) {
          console.log(`[Automation Enable] Restoring export power (curtailment was active, automation disabled)`);
          
          const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
            sn: userConfig.deviceSn,
            key: 'ExportLimit',
            value: 12000
          }, userConfig, userId);
          
          if (setResult?.errno === 0) {
            await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
              active: false,
              lastPrice: null,
              lastDeactivated: Date.now(),
              disabledByAutomationToggle: true
            });
            console.log(`[Automation Enable] ✓ Export power restored successfully`);
          } else {
            console.warn(`[Automation Enable] ⚠️ Failed to restore export power: ${setResult?.msg || 'Unknown error'}`);
          }
        }
      } catch (curtErr) {
        console.error('[Automation Enable] Error checking/restoring curtailment:', curtErr);
        // Don't fail the toggle operation if curtailment restoration fails
      }
    }
    
    await saveUserAutomationState(userId, stateUpdate);
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Manually trigger a rule (for testing) - applies the rule's action immediately
app.post('/api/automation/trigger', async (req, res) => {
  try {
    const { ruleName } = req.body;
    
    if (!ruleName) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    // Get the rule
    const rules = await getUserRules(req.user.uid);
    const ruleId = ruleName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rule = rules[ruleId] || rules[ruleName];
    
    if (!rule) {
      return res.status(400).json({ errno: 400, error: `Unknown rule: ${ruleName}` });
    }
    
    // Get user config
    const userConfig = await getUserConfig(req.user.uid);
    
    // Apply the rule action (uses v1 API, sets flag, does verification)
    const result = await applyRuleAction(req.user.uid, rule, userConfig);
    
    // Update automation state - use ruleId for UI matching
    await saveUserAutomationState(req.user.uid, {
      lastTriggered: Date.now(),
      activeRule: ruleId,
      activeRuleName: rule.name || ruleName
    });
    
    // Update rule's lastTriggered
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set({
      lastTriggered: serverTimestamp()
    }, { merge: true });
    
    res.json({ errno: 0, result, ruleName });
  } catch (error) {
    console.error('[Automation] Trigger error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Reset automation state (clear cooldowns, active rule, etc.)
app.post('/api/automation/reset', async (req, res) => {
  try {
    // Reset automation state
    await saveUserAutomationState(req.user.uid, {
      lastTriggered: null,
      activeRule: null,
      lastCheck: null
    });
    
    // Reset lastTriggered on all rules
    const rulesSnapshot = await db.collection('users').doc(req.user.uid).collection('rules').get();
    const batch = db.batch();
    rulesSnapshot.forEach(doc => {
      batch.update(doc.ref, { lastTriggered: null });
    });
    await batch.commit();
    
    logger.debug('Automation', `State reset for user ${req.user.uid}`);
    res.json({ errno: 0, result: 'Automation state reset' });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Run automation cycle - evaluates all rules and triggers if conditions met
// This is called by the frontend timer every 60 seconds
app.post('/api/automation/cycle', async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // Get user's automation state
    const state = await getUserAutomationState(userId);
    // Check explicitly for enabled === false (not undefined which means not set yet)
    if (state && state.enabled === false) {
      
      // Always update lastCheck timestamp to prevent scheduler from calling cycle repeatedly
      await saveUserAutomationState(userId, { 
        lastCheck: Date.now(), 
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
      
      // Only clear segments if they haven't been cleared already for this disabled state
      // Track with a flag in the state to avoid redundant API calls on every cycle
      if (state.segmentsCleared !== true) {
        try {
          const userConfig = await getUserConfig(userId);
          const deviceSN = userConfig?.deviceSn;
          if (deviceSN) {
            const clearedGroups = [];
            for (let i = 0; i < 8; i++) {
              clearedGroups.push({
                enable: 0,
                workMode: 'SelfUse',
                startHour: 0, startMinute: 0,
                endHour: 0, endMinute: 0,
                minSocOnGrid: 10,
                fdSoc: 10,
                fdPwr: 0,
                maxSoc: 100
              });
            }
            // Real API call - counted in metrics for accurate quota tracking
            const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
            if (clearResult?.errno === 0) {
              // Mark segments as cleared so we don't do this again every cycle
              await saveUserAutomationState(userId, { segmentsCleared: true });
            } else {
              console.warn(`[Automation] ⚠️ Segment clear returned errno=${clearResult?.errno}`);
            }
          } else {
            console.warn(`[Automation] ⚠️ No deviceSN found - cannot clear segments`);
          }
        } catch (err) {
          console.error(`[Automation] ❌ Error clearing segments on disable:`, err.message);
        }
      }

      // Clear lastTriggered on the active rule if one exists (so it can re-trigger when automation re-enabled)
      if (state.activeRule) {
        try {
          await db.collection('users').doc(userId).collection('rules').doc(state.activeRule).set({
            lastTriggered: null
          }, { merge: true });
          
          // Create audit entry showing the active rule was deactivated due to automation being disabled
          // This ensures the ROI calculator shows the rule as "ended" not "ongoing"
          try {
            const activationTime = state.lastTriggered || Date.now();
            const deactivationTime = Date.now();
            const durationMs = deactivationTime - activationTime;
            
            await addAutomationAuditEntry(userId, {
              cycleId: `cycle_automation_disabled_${Date.now()}`,
              triggered: false,
              ruleName: state.activeRuleName || state.activeRule,
              ruleId: state.activeRule,
              evaluationResults: [],
              allRuleEvaluations: [{
                name: state.activeRuleName || state.activeRule,
                ruleId: state.activeRule,
                triggered: false,
                conditions: [],
                feedInPrice: null,
                buyPrice: null
              }],
              actionTaken: null,
              activeRuleBefore: state.activeRule,
              activeRuleAfter: null,
              rulesEvaluated: 0,
              cycleDurationMs: durationMs,
              automationDisabled: true  // Flag indicating this was due to automation being disabled
            });
          } catch (auditErr) {
            console.warn(`[Automation] ⚠️ Failed to create audit entry:`, auditErr.message);
          }
        } catch (err) {
          console.warn(`[Automation] ⚠️ Error clearing rule lastTriggered:`, err.message);
        }
      }
      
      return res.json({ errno: 0, result: { skipped: true, reason: 'Automation disabled', segmentsCleared: state.segmentsCleared === true } });
    }
    
    // ============================================================
    // Check for active quick control (mutual exclusion)
    // ============================================================
    const quickState = await getQuickControlState(userId);
    if (quickState && quickState.active) {
      const now = Date.now();
      
      // If quick control has expired, clean it up and continue with normal automation
      if (quickState.expiresAt <= now) {
        await cleanupExpiredQuickControl(userId, quickState);
        // Continue with normal automation
      } else {
        // Quick control still active - skip automation cycle
        const remainingMs = quickState.expiresAt - now;
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        
        logger.debug('Automation', `Cycle skipped: Quick control active (type=${quickState.type}, ${remainingMinutes}min remaining)`);
        
        // Update lastCheck to prevent scheduler from calling cycle repeatedly
        await saveUserAutomationState(userId, { lastCheck: Date.now() });
        
        return res.json({
          errno: 0,
          result: {
            skipped: true,
            reason: 'Quick control active',
            quickControl: {
              type: quickState.type,
              power: quickState.power,
              remainingMinutes: remainingMinutes
            }
          }
        });
      }
    }
    
    // Check for blackout windows
    const userConfig = await getUserConfig(userId);
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    
    // Get user's timezone (from config which is kept up-to-date)
    const userTimezone = getAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const currentMinutes = userTime.hour * 60 + userTime.minute;
    
    
    let inBlackout = false;
    let currentBlackoutWindow = null;
    for (const window of blackoutWindows) {
      // Treat windows without explicit enabled property as enabled by default
      // (the user explicitly added them, so they should be active unless explicitly disabled)
      if (window.enabled === false) continue;
      const [startH, startM] = (window.start || '00:00').split(':').map(Number);
      const [endH, endM] = (window.end || '00:00').split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      
      // Handle windows that cross midnight
      if (startMins <= endMins) {
        if (currentMinutes >= startMins && currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      } else {
        if (currentMinutes >= startMins || currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      }
    }
    
    if (inBlackout) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: true, currentBlackoutWindow });
      return res.json({ errno: 0, result: { skipped: true, reason: 'In blackout window', blackoutWindow: currentBlackoutWindow } });
    }
    
    // Get user's rules
    const rules = await getUserRules(userId);
    const totalRules = Object.keys(rules).length;
    
    if (totalRules === 0) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
      return res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    }
    
    // Check if a rule was just disabled and we need to clear segments (via flag)
    if (state.clearSegmentsOnNextCycle) {
      try {
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          // Real API call - counted in metrics for accurate quota tracking
          const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
          if (clearResult?.errno !== 0) {
            console.warn(`[Cycle] ⚠️ Failed to clear segments due to rule disable flag: errno=${clearResult?.errno}`);
          }
        }
      } catch (err) {
        console.error('[Cycle] Error clearing segments:', err.message);
      }
      
      // Clear the flag after processing
      await saveUserAutomationState(userId, {
        clearSegmentsOnNextCycle: false
      });
      
      return res.json({ errno: 0, result: { skipped: true, reason: 'Rule was disabled - segments cleared', segmentsCleared: true } });
    }
    
    // Check if the active rule was disabled (CRITICAL: Must check BEFORE filtering)
    // If activeRule exists but is now disabled, we need to clear segments
    if (state.activeRule && rules[state.activeRule] && !rules[state.activeRule].enabled) {
      try {
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          // Real API call - counted in metrics for accurate quota tracking
          const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
          if (clearResult?.errno !== 0) {
            console.warn(`[Automation] ⚠️ Failed to clear segments: errno=${clearResult?.errno}`);
          }
        }
      } catch (err) {
        console.error(`[Automation] ❌ Error clearing segments after rule disable:`, err.message);
      }
      
      // Clear automation state (but DON'T update lastCheck - let scheduler timer continue)
      await saveUserAutomationState(userId, {
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
      return res.json({ errno: 0, result: { skipped: true, reason: 'Active rule was disabled', segmentsCleared: true } });
    }
    
    // Get live data for evaluation
    const deviceSN = userConfig?.deviceSn;
    let inverterData = null;
    let amberData = null;
    const cycleStartTime = Date.now();
    
    // Fetch inverter data (with per-user cache TTL)
    if (deviceSN) {
      try {
        inverterData = await getCachedInverterData(userId, deviceSN, userConfig, false);
        // If automation cache doesn't have valid datas structure (e.g. stale failed response),
        // fall back to the realtime cache which the dashboard may have just refreshed.
        if (!inverterData?.result?.[0]?.datas) {
          console.warn('[Automation] Automation inverter cache missing datas structure (errno=%s), falling back to realtime cache', inverterData?.errno);
          try {
            const realtimeData = await getCachedInverterRealtimeData(userId, deviceSN, userConfig, false);
            if (realtimeData?.result?.[0]?.datas) {
              inverterData = realtimeData;
              console.log('[Automation] Realtime cache fallback succeeded - SoC data now available');
            }
          } catch (fe) {
            console.warn('[Automation] Realtime cache fallback also failed:', fe.message);
          }
        }
      } catch (e) {
        console.warn('[Automation] Failed to get inverter data:', e.message);
      }
    }
    
    // Fetch Amber data (with forecast for next 288 intervals = 24 hours, Amber provides up to ~48hrs)
    if (userConfig?.amberApiKey) {
      try {
        // Try cache first to avoid duplicate API call
        let sites = await amberAPI.getCachedAmberSites(userId);
        if (!sites) {
          sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
          if (Array.isArray(sites) && sites.length > 0) {
            await amberAPI.cacheAmberSites(userId, sites);
          }
        }
        
        if (Array.isArray(sites) && sites.length > 0) {
          const siteId = userConfig.amberSiteId || sites[0].id;
          
          // Try cache first for current prices
          amberData = await amberAPI.getCachedAmberPricesCurrent(siteId, userId, userConfig);
          if (!amberData) {
            const inflightKey = `${userId}:${siteId}`;
            
            // Check if another request is already fetching this data
            if (amberPricesInFlight.has(inflightKey)) {
              try {
                amberData = await amberPricesInFlight.get(inflightKey);
              } catch (err) {
                console.warn(`[Automation] In-flight request failed for ${userId}, will retry:`, err.message);
              }
            }
            
            // If still no data (first request or in-flight failed), fetch it
            if (!amberData) {
              const fetchPromise = amberAPI.callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 288 }, userConfig, userId)
                .then(async (data) => {
                  if (Array.isArray(data) && data.length > 0) {
                    await amberAPI.cacheAmberPricesCurrent(siteId, data, userId, userConfig);
                  }
                  return data;
                })
                .finally(() => {
                  amberPricesInFlight.delete(inflightKey);
                });
              
              amberPricesInFlight.set(inflightKey, fetchPromise);
              amberData = await fetchPromise;
            }
          }
          
          if (amberData) {
            const forecastCount = amberData.filter(p => p.type === 'ForecastInterval').length;
            const currentCount = amberData.filter(p => p.type === 'CurrentInterval').length;
            const generalForecasts = amberData.filter(p => p.type === 'ForecastInterval' && p.channelType === 'general');
            const feedInForecasts = amberData.filter(p => p.type === 'ForecastInterval' && p.channelType === 'feedIn');
            // Show time range and price extremes for BOTH channels
            if (generalForecasts.length > 0) {
              const generalPrices = generalForecasts.map(f => f.perKwh);
              const maxGeneral = Math.max(...generalPrices);
              const firstTime = new Date(generalForecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
              const lastTime = new Date(generalForecasts[generalForecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
            }
            if (feedInForecasts.length > 0) {
              const feedInPrices = feedInForecasts.map(f => -f.perKwh); // Negate for display (you earn positive)
              const maxFeedIn = Math.max(...feedInPrices);
              const firstTime = new Date(feedInForecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
              const lastTime = new Date(feedInForecasts[feedInForecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
            }
          }
        }
      } catch (e) {
        console.warn('[Automation] Failed to get Amber data:', e.message);
      }
    }
    
    // Build cache object for rule evaluation
    const cache = { amber: amberData, weather: null };
    
    // Evaluate rules (sorted by priority - lower number = higher priority)
    const enabledRules = Object.entries(rules).filter(([_, rule]) => rule.enabled);
    
    if (enabledRules.length === 0) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
      return res.json({ errno: 0, result: { skipped: true, reason: 'No rules enabled', totalRules } });
    }
    
    // Check if any enabled rule uses weather-dependent conditions (solar radiation, cloud cover, UV)
    const needsWeatherData = enabledRules.some(([_, rule]) => {
      const cond = rule.conditions || {};
      return cond.solarRadiation?.enabled || cond.cloudCover?.enabled || cond.uvIndex?.enabled;
    });
    
    // Only fetch weather if a rule actually needs it
    let weatherData = null;
    if (needsWeatherData) {
      try {
        const place = userConfig?.location || 'Sydney';
        
        // Calculate maximum lookAhead days needed across all enabled rules
        let maxDaysNeeded = 1;
        for (const [, rule] of enabledRules) {
          const cond = rule.conditions || {};
          
          // Check solar radiation lookAhead
          if (cond.solarRadiation?.enabled) {
            const unit = cond.solarRadiation.lookAheadUnit || 'hours';
            const value = cond.solarRadiation.lookAhead || 6;
            const days = unit === 'days' ? value : Math.ceil(value / 24);
            maxDaysNeeded = Math.max(maxDaysNeeded, days);
          }
          
          // Check cloud cover lookAhead
          if (cond.cloudCover?.enabled) {
            const unit = cond.cloudCover.lookAheadUnit || 'hours';
            const value = cond.cloudCover.lookAhead || 6;
            const days = unit === 'days' ? value : Math.ceil(value / 24);
            maxDaysNeeded = Math.max(maxDaysNeeded, days);
          }
        }
        
        // Cap at 7 days (Open-Meteo free tier limit)
        maxDaysNeeded = Math.min(maxDaysNeeded, 7);
        
        // Always fetch 7 days to maximize cache hits - any rule requesting ≤7 days will use cached data
        // This prevents cache busting when different rules request different day counts
        const daysToFetch = 7;
        weatherData = await getCachedWeatherData(userId, place, daysToFetch);
        cache.weather = weatherData.result || weatherData;
      } catch (e) {
        console.warn('[Automation] Failed to get weather data:', e.message);
      }
    }
    
    const sortedRules = enabledRules.sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
    
    let triggeredRule = null;
    const evaluationResults = [];
    
    for (const [ruleId, rule] of sortedRules) {
      
      // BUG FIX: Check if this is the ACTIVE rule
      // Active rules should always be re-evaluated to verify conditions still hold, even if in cooldown
      // Be resilient to older state docs that may not have activeRule but have the name persisted
      const isActiveRule = state.activeRule === ruleId || state.activeRuleName === rule.name;
      
      // Only apply cooldown check to INACTIVE rules (new rule searches)
      // Active rules bypass cooldown check because they need continuous condition monitoring
      const lastTriggered = rule.lastTriggered;
      const cooldownMs = (rule.cooldownMinutes || 5) * 60 * 1000;
      if (!isActiveRule && lastTriggered) {
        const lastTriggeredMs = typeof lastTriggered === 'object' 
          ? (lastTriggered._seconds || lastTriggered.seconds || 0) * 1000 
          : lastTriggered;
        if (Date.now() - lastTriggeredMs < cooldownMs) {
          const remaining = Math.round((cooldownMs - (Date.now() - lastTriggeredMs)) / 1000);
          evaluationResults.push({ rule: rule.name, result: 'cooldown', remaining });
          continue;
        }
      }
      
      // Always evaluate active rules even if in cooldown, to detect when conditions no longer hold
      // For inactive rules, this is a normal condition check
      const result = await evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig, isActiveRule /* skipCooldownCheck */);
      
      if (result.triggered) {
        logger.debug('Automation', `🎯 Rule '${rule.name}' (${ruleId}) conditions MET - triggered=${result.triggered}`);
        if (isActiveRule) {
          logger.debug('Automation', `🔄 Rule '${rule.name}' is ACTIVE (continuing) - checking segment status...`);
          // Active rule continues - conditions still hold
          // Calculate how long rule has been active
          const lastTriggeredMs = typeof lastTriggered === 'object' 
            ? (lastTriggered._seconds || lastTriggered.seconds || 0) * 1000 
            : (lastTriggered || Date.now());
          const activeForSec = Math.round((Date.now() - lastTriggeredMs) / 1000);
          const cooldownRemaining = Math.max(0, Math.round((cooldownMs - (Date.now() - lastTriggeredMs)) / 1000));
          logger.debug('Automation', `⏱️ Active for ${activeForSec}s, cooldown remaining: ${cooldownRemaining}s`);
          logger.debug('Automation', `📊 Current segment status: activeSegmentEnabled=${state.activeSegmentEnabled}`);
          
          // CRITICAL: If segment failed to send but rule is active, attempt to re-send the segment
          if (state.activeSegmentEnabled === false && state.activeRule === ruleId) {
            logger.debug('Automation', `⚠️ Segment previously failed for active rule '${rule.name}' - attempting RETRY...`);
            logger.debug('Automation', `🔧 Retry attempt for userId=${userId}, ruleId=${ruleId}`);
            let retryResult = null;
            try {
              retryResult = await applyRuleAction(userId, rule, userConfig);
              logger.debug('Automation', `📤 Retry result: errno=${retryResult?.errno}, msg=${retryResult?.msg}`);
            } catch (retryErr) {
              console.error(`[Automation] ❌ Retry exception:`, retryErr);
              retryResult = { errno: -1, msg: retryErr.message || 'Retry failed' };
            }
            
            // Update state with retry result
            logger.debug('Automation', `💾 Updating state after retry: activeSegmentEnabled=${retryResult?.errno === 0}`);
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              activeSegmentEnabled: retryResult?.errno === 0,
              lastActionResult: retryResult,
              inBlackout: false
            });
            
            if (retryResult?.errno === 0) {
              logger.debug('Automation', `✅ Segment re-send SUCCESSFUL - segment should now be on device`);
            } else {
              console.error(`[Automation] ❌ Segment re-send FAILED: ${retryResult?.msg || 'unknown error'}`);
            }
            break;
          }
          
          // Check if cooldown has EXPIRED - if so, reset and re-trigger in SAME cycle
          if (Date.now() - lastTriggeredMs >= cooldownMs) {
            
            try {
              // Reset lastTriggered to allow immediate re-trigger
              await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
                lastTriggered: null
              }, { merge: true });
              
              // Clear active rule state so the rule can re-trigger as NEW in this same cycle
              await saveUserAutomationState(userId, { 
                lastCheck: Date.now(), 
                inBlackout: false, 
                activeRule: null,
                activeRuleName: null,
                activeSegment: null,
                activeSegmentEnabled: false
              });
              
            } catch (err) {
              console.error(`[Automation] Error resetting rule after cooldown expiry:`, err.message);
            }
            
            // Mark as triggered - this is a re-trigger after cooldown expiry
            // Since we cleared activeRule state, it will be treated as a new rule and re-trigger with updated times
            evaluationResults.push({ 
              rule: rule.name, 
              result: 'triggered', 
              activeFor: activeForSec,
              details: result 
            });
            
            // Fall through to NEW trigger logic below (isActiveRule is still true in variable but state is cleared)
            // We need to manually apply the action since we're not going through the normal path
            
            // Apply the rule action with NEW timestamps
            const isNewTrigger = true; // Treat as new trigger
            triggeredRule = { ruleId, ...rule, isNewTrigger, status: 'new_trigger' };
            
            let actionResult = null;
            try {
              const applyStart = Date.now();
              actionResult = await applyRuleAction(userId, rule, userConfig);
              const applyDuration = Date.now() - applyStart;
              if (actionResult?.retrysFailed) {
                console.warn(`[Automation] ⚠️ Some retries failed during atomic segment update`);
              }
            } catch (actionError) {
              console.error(`[Automation] ❌ Action failed:`, actionError);
              actionResult = { errno: -1, msg: actionError.message || 'Action failed' };
            }
            
            // Update rule's lastTriggered (new trigger)
            await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
              lastTriggered: serverTimestamp()
            }, { merge: true });
            
            // Update automation state with NEW active rule
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              lastTriggered: Date.now(),
              activeRule: ruleId,
              activeRuleName: rule.name,
              activeSegment: actionResult?.segment || null,
              activeSegmentEnabled: actionResult?.errno === 0,
              inBlackout: false,
              lastActionResult: actionResult
            });
            
            triggeredRule.actionResult = actionResult;
            break; // Rule applied, exit loop
          } else {
            // Cooldown still active - rule continues
            
            // Mark as 'continuing' in evaluation results with cooldown info
            evaluationResults.push({ 
              rule: rule.name, 
              result: 'continuing', 
              activeFor: activeForSec,
              cooldownRemaining,
              details: result 
            });
            
            logger.debug('Automation', `✅ Rule '${rule.name}' continuing (cooldown ${cooldownRemaining}s remaining) - segment already sent`);
            logger.debug('Automation', `📊 Preserving segment state: activeSegmentEnabled=${state.activeSegmentEnabled}`);
            // Mark this as the triggered rule for response (continuing state)
            triggeredRule = { ruleId, ...rule, isNewTrigger: false, status: 'continuing' };
            
            // Update check timestamp only, don't re-apply segment
            // CRITICAL: Preserve activeSegmentEnabled from previous state - if the segment failed to send,
            // don't falsely claim it's enabled on subsequent cycles
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              inBlackout: false
              // DO NOT UPDATE activeSegmentEnabled - preserve prior state
            });
            logger.debug('Automation', `💾 State updated - rule continues without re-sending segment`);
            
            break; // Rule still active, exit loop
          }
        } else {
          logger.debug('Automation', `🆕 NEW rule triggered: '${rule.name}' (${ruleId})`);
          logger.debug('Automation', `📊 Current active rule: ${state.activeRule || 'none'}`);
          // Mark as 'triggered' for new rules
          evaluationResults.push({ rule: rule.name, result: 'triggered', details: result });
          // New rule triggered - check priority vs active rule
          if (state.activeRule && rules[state.activeRule]) {
            const activeRulePriority = rules[state.activeRule].priority || 99;
            const newRulePriority = rule.priority || 99;
            if (newRulePriority > activeRulePriority) {
              // New rule is LOWER priority than active rule - don't trigger
              continue;
            } else if (newRulePriority < activeRulePriority) {
              // New rule has HIGHER priority (lower number) - cancel active rule first
              try {
                const deviceSN = userConfig?.deviceSn;
                if (deviceSN) {
                  const clearedGroups = [];
                  for (let i = 0; i < 8; i++) {
                    clearedGroups.push({
                      enable: 0,
                      workMode: 'SelfUse',
                      startHour: 0, startMinute: 0,
                      endHour: 0, endMinute: 0,
                      minSocOnGrid: 10,
                      fdSoc: 10,
                      fdPwr: 0,
                      maxSoc: 100
                    });
                  }
                  // Real API call - counted in metrics for accurate quota tracking
                  await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
                  await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for inverter to process
                }
              } catch (err) {
                console.error(`[Automation] ❌ Error clearing active rule segment:`, err.message);
              }
              // Reset active rule's lastTriggered so it can be re-triggered later
              if (state.activeRule) {
                await db.collection('users').doc(userId).collection('rules').doc(state.activeRule).set({ lastTriggered: null }, { merge: true });
              }
            }
          }
          // New rule triggered with higher priority or no active rule exists
        }
        // Mark whether this is a new trigger or a continuing active rule
        const isNewTrigger = !isActiveRule;
        triggeredRule = { ruleId, ...rule, isNewTrigger, status: isNewTrigger ? 'new_trigger' : 'continuing' };
        
        // Only apply the rule action if this is a NEW rule (not the active one continuing)
        if (!isActiveRule) {
          logger.debug('Automation', `🚀 Applying NEW rule action for '${rule.name}'...`);
          logger.debug('Automation', `🎬 Calling applyRuleAction(userId=${userId}, rule=${rule.name})`);
          // Actually apply the rule action (create scheduler segment)
          let actionResult = null;
          try {
            const applyStart = Date.now();
            actionResult = await applyRuleAction(userId, rule, userConfig);
            const applyDuration = Date.now() - applyStart;
            logger.debug('Automation', `📤 applyRuleAction completed in ${applyDuration}ms: errno=${actionResult?.errno}`);
            console.log(`[Automation] 📋 Action result details:`, JSON.stringify({errno: actionResult?.errno, msg: actionResult?.msg, segment: actionResult?.segment ? 'present' : 'missing'}, null, 2));
          } catch (actionError) {
            console.error(`[Automation] ❌ Action exception:`, actionError);
            actionResult = { errno: -1, msg: actionError.message || 'Action failed' };
          }
          
          // Update rule's lastTriggered (new rule triggered)
          await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
            lastTriggered: serverTimestamp()
          }, { merge: true });
          
          logger.debug('Automation', `💾 Saving automation state for new rule...`);
          logger.debug('Automation', `📊 State to save: activeRule=${ruleId}, activeSegmentEnabled=${actionResult?.errno === 0}`);
          // Update automation state
          // IMPORTANT: Save ruleId (doc key) not rule.name so UI can match activeRule with rule keys
          await saveUserAutomationState(userId, {
            lastCheck: Date.now(),
            lastTriggered: Date.now(),
            activeRule: ruleId,
            activeRuleName: rule.name, // Keep display name for reference
            activeSegment: actionResult?.segment || null, // Store segment details for verification
            activeSegmentEnabled: actionResult?.errno === 0,
            inBlackout: false,
            lastActionResult: actionResult
          });
          logger.debug('Automation', `✅ State saved successfully - activeRule is now '${rule.name}'`);
          logger.debug('Automation', `🔍 Final segment status: ${actionResult?.errno === 0 ? 'ENABLED ✅' : 'FAILED ❌'}`);
          if (actionResult?.errno !== 0) {
            console.error(`[Automation] 🚨 SEGMENT SEND FAILED - errno=${actionResult?.errno}, msg=${actionResult?.msg}`);
          }
          
          // Log to audit trail - Rule turned ON
          // Include full evaluation context: ALL rules and their condition states
          // Transform evaluationResults to frontend-friendly format
          const allRulesForAudit = evaluationResults.map(evalResult => {
            const ruleData = sortedRules.find(([_id, r]) => r.name === evalResult.rule);
            const [evalRuleId] = ruleData || [null];
            
            return {
              name: evalResult.rule,
              ruleId: evalRuleId || evalResult.rule,
              triggered: evalResult.result === 'triggered' || evalResult.result === 'continuing',
              feedInPrice: evalResult.details?.feedInPrice !== undefined && evalResult.details?.feedInPrice !== null ? evalResult.details.feedInPrice : null,
              buyPrice: evalResult.details?.buyPrice !== undefined && evalResult.details?.buyPrice !== null ? evalResult.details.buyPrice : null,
              conditions: evalResult.details?.results?.map(cond => ({
                name: cond.condition,
                met: cond.met,
                value: cond.actual !== undefined ? String(cond.actual) : (cond.reason || 'N/A'),
                rule: `${cond.condition} ${cond.operator || ''} ${cond.target || ''}`
              })) || []
            };
          });
          
          // ⭐ Extract house load at trigger time (for accurate ROI calculation)
          // Use the SAME logic as index.html which successfully extracts house load (showing 1.68kW)
          
          // Helper function - same as index.html findValue (using const to avoid inner function declaration lint error)
          const findValue = (arr, keysOrPatterns) => {
            if (!Array.isArray(arr)) return null;
            for (const k of keysOrPatterns) {
              // Try exact match on variable
              const exact = arr.find(it => 
                (it.variable && it.variable.toString().toLowerCase() === k.toString().toLowerCase()) || 
                (it.key && it.key.toString().toLowerCase() === k.toString().toLowerCase())
              );
              if (exact && exact.value !== undefined && exact.value !== null) return exact.value;
              
              // Try includes match on variable name
              const incl = arr.find(it => 
                (it.variable && it.variable.toString().toLowerCase().includes(k.toString().toLowerCase())) || 
                (it.key && it.key.toString().toLowerCase().includes(k.toString().toLowerCase()))
              );
              if (incl && incl.value !== undefined && incl.value !== null) return incl.value;
            }
            return null;
          };
          
          // ⭐ CRITICAL: Validate inverterData exists and is valid before extracting house load
          // If API call failed or cache is empty, inverterData.errno won't be 0
          if (!inverterData || inverterData.errno !== 0) {
            console.error(`[Automation ROI] Cannot extract house load - inverterData invalid: errno=${inverterData?.errno}, error=${inverterData?.error || inverterData?.msg || 'unknown'}`);
          }
          
          // Normalize response structure - same as index.html
          let datas = [];
          if (Array.isArray(inverterData?.result)) {
            // result may be array of frames with datas arrays
            if (inverterData.result.length > 0 && Array.isArray(inverterData.result[0].datas)) {
              inverterData.result.forEach(r => { if (Array.isArray(r.datas)) datas.push(...r.datas); });
            } else {
              // result is array of simple datapoints
              datas = inverterData.result.slice();
            }
          } else if (inverterData?.result && typeof inverterData.result === 'object') {
            if (Array.isArray(inverterData.result.datas)) datas = inverterData.result.datas.slice();
            else if (Array.isArray(inverterData.result.data)) datas = inverterData.result.data.slice();
          }
          
          // Log the structure we're working with for debugging
          if (datas.length === 0) {
            console.error(`[Automation ROI] No datapoints extracted! inverterData structure: errno=${inverterData?.errno}, hasResult=${!!inverterData?.result}, resultType=${Array.isArray(inverterData?.result) ? 'array' : typeof inverterData?.result}, resultLength=${Array.isArray(inverterData?.result) ? inverterData.result.length : 'N/A'}`);
            if (inverterData?.result && Array.isArray(inverterData.result) && inverterData.result.length > 0) {
              console.error(`[Automation ROI] First result item structure: ${JSON.stringify(Object.keys(inverterData.result[0]))}, hasDatas=${!!inverterData.result[0].datas}`);
            }
          }
          
          // Extract house load using same keys and logic as index.html
          const loadKeys = ['loadspower', 'loadpower', 'load', 'houseload', 'house_load', 'consumption', 'load_active_power', 'loadactivepower', 'loadsPower'];
          let houseLoadW = findValue(datas, loadKeys);
          
          // Convert to number, but preserve null if data not found (don't default to 0)
          if (houseLoadW !== null && houseLoadW !== undefined) {
            houseLoadW = Number(houseLoadW);
            if (isNaN(houseLoadW)) {
              console.warn(`[Automation ROI] House load found but NaN: ${houseLoadW}`);
              houseLoadW = null;
            } else {
              // CRITICAL FIX: FoxESS API returns loadsPower in KILOWATTS, not watts!
              // Example: API returns 2.545 meaning 2.545kW (2545W actual house load)
              // We need to convert to watts for consistency with variable name (houseLoadW)
              // If value < 100, it's definitely in kW (house load rarely exceeds 100kW residential)
              if (Math.abs(houseLoadW) < 100) {
                const originalValue = houseLoadW;
                houseLoadW = houseLoadW * 1000; // Convert kW to W
              }
            }
          }
          
          if (houseLoadW === null) {
            console.error(`[Automation ROI] ❌ FAILED to extract house load from ${datas.length} datapoints - tried keys: ${loadKeys.join(', ')}`);
            // Log what variables ARE present to help diagnose
            if (datas.length > 0) {
              const presentVars = datas.map(d => d.variable || d.key).filter(v => v).join(', ');
              console.error(`[Automation ROI] Variables present in data: [${presentVars}]`);
            }
          }
          
          const fdPwr = rule.action?.fdPwr || 0;
          const workMode = rule.action?.workMode || 'SelfUse';
          const isChargeRule = workMode === 'ForceCharge';
          const isDischargeRule = workMode === 'ForceDischarge' || workMode === 'Feedin';
          
          // BUG FIX: result from evaluateRule() has prices at TOP level, not inside 'details'
          // evaluateRule returns: { triggered, results, feedInPrice, buyPrice }
          const feedInPrice = result.feedInPrice ?? 0; // In cents/kWh from Amber API
          const buyPrice = result.buyPrice ?? 0; // In cents/kWh from Amber API
          
          // DEBUG: Validate price format
          
          const durationHours = (rule.action?.durationMinutes || 30) / 60;
          
          // Calculate profit/cost based on rule type
          let estimatedGridExportW = null;
          let estimatedRevenue = 0;
          
          if (isChargeRule) {
            // CHARGE RULE: Drawing power FROM the grid
            // - Positive buyPrice: You PAY to consume = NEGATIVE profit (cost)
            // - Negative buyPrice: You get PAID to consume = POSITIVE profit (revenue)
            // Formula: revenue = -(power * price) where price can be negative
            // Power drawn from grid = fdPwr (charge power) + house load
            const gridDrawW = houseLoadW !== null ? (fdPwr + houseLoadW) : fdPwr;
            const pricePerKwh = buyPrice / 100; // Convert cents to dollars
            
            // When buyPrice is negative (e.g., -20¢), pricePerKwh is -0.20
            // revenue = -(gridDrawW * -0.20 * hours) = positive (you earn money)
            // When buyPrice is positive (e.g., +30¢), pricePerKwh is +0.30
            // revenue = -(gridDrawW * 0.30 * hours) = negative (you pay money)
            estimatedRevenue = -(gridDrawW * pricePerKwh * durationHours);
            
            const profitOrCost = estimatedRevenue >= 0 ? 'PROFIT' : 'COST';
          } else if (isDischargeRule) {
            // DISCHARGE RULE: Exporting power TO the grid
            // - Positive feedInPrice: You get PAID for export = POSITIVE profit (revenue)  
            // - Negative feedInPrice: You PAY to export = NEGATIVE profit (cost) - rare but possible
            // Power exported = fdPwr (discharge power) - house load
            estimatedGridExportW = houseLoadW !== null ? Math.max(0, fdPwr - houseLoadW) : fdPwr;
            const pricePerKwh = feedInPrice / 100; // Convert cents to dollars
            estimatedRevenue = estimatedGridExportW * pricePerKwh * durationHours;
            
            const profitOrCost = estimatedRevenue >= 0 ? 'REVENUE' : 'COST';
          } else {
            // Other modes (SelfUse, Backup, etc) - no grid transaction
          }
          
          await addAutomationAuditEntry(userId, {
            cycleId: `cycle_${cycleStartTime}`,
            triggered: true,
            ruleName: rule.name,
            ruleId: ruleId,
            evaluationResults: result.conditions || [],
            allRuleEvaluations: allRulesForAudit, // Complete evaluation context in frontend format
            actionTaken: {
              workMode: rule.action?.workMode,
              durationMinutes: rule.action?.durationMinutes,
              fdPwr: rule.action?.fdPwr,
              fdSoc: rule.action?.fdSoc,
              minSocOnGrid: rule.action?.minSocOnGrid
            },
            // ⭐ Store ROI data with house load snapshot (null if not found)
            roiSnapshot: {
              houseLoadW: houseLoadW,
              estimatedGridExportW: estimatedGridExportW,
              feedInPrice: feedInPrice,
              buyPrice: buyPrice,
              workMode: workMode,
              durationMinutes: rule.action?.durationMinutes || 30,
              estimatedRevenue: estimatedRevenue
            },
            activeRuleBefore: state.activeRule,
            activeRuleAfter: ruleId,
            rulesEvaluated: sortedRules.length,
            inverterCacheHit: cache?.inverterData?.__cacheHit || false,
            inverterCacheAgeMs: cache?.inverterData?.__cacheAgeMs || null,
            cycleDurationMs: Date.now() - cycleStartTime
          });
          
          // Store action result for response
          triggeredRule.actionResult = actionResult;
        } else {
          // Active rule is continuing - just update check timestamp, no re-apply needed
          await saveUserAutomationState(userId, {
            lastCheck: Date.now(),
            inBlackout: false,
            activeSegmentEnabled: true,
            activeRule: state.activeRule,
            activeRuleName: state.activeRuleName
          });
        }
        
        break; // First matching rule wins
      } else {
        // Conditions not met - add to evaluation results
        evaluationResults.push({ rule: rule.name, result: 'not_met', details: result });
        
        // Active rule's conditions NO LONGER hold during evaluation
        if (isActiveRule) {
          let segmentClearSuccess = false;
          try {
            // Clear all scheduler segments
            const deviceSN = userConfig?.deviceSn;
            if (deviceSN) {
              const clearedGroups = [];
              for (let i = 0; i < 8; i++) {
                clearedGroups.push({
                  enable: 0,
                  workMode: 'SelfUse',
                  startHour: 0, startMinute: 0,
                  endHour: 0, endMinute: 0,
                  minSocOnGrid: 10,
                  fdSoc: 10,
                  fdPwr: 0,
                  maxSoc: 100
                });
              }
              
              // Retry logic for segment clearing (up to 3 attempts)
              let clearAttempt = 0;
              let clearResult = null;
              while (clearAttempt < 3 && !segmentClearSuccess) {
                clearAttempt++;
                clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
                
                if (clearResult?.errno === 0) {
                  segmentClearSuccess = true;
                } else {
                  console.warn(`[Automation] Segment clear attempt ${clearAttempt} failed: errno=${clearResult?.errno}, msg=${clearResult?.msg}`);
                  if (clearAttempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1200));
                  }
                }
              }
              
              if (!segmentClearSuccess) {
                console.error(`[Automation] ❌ Failed to clear segments after 3 attempts - aborting replacement rule evaluation for safety`);
                // Break out of rule loop if we can't clear - too risky to apply new segment
                break;
              }
              
              // Wait for inverter to process segment clearing before continuing evaluation
              // Extended delay to ensure hardware is ready (2.5s total wait)
              await new Promise(resolve => setTimeout(resolve, 2500));
            }
            // Clear lastTriggered when rule is canceled (conditions failed)
            // This allows the rule to re-trigger immediately if conditions become valid again
            // Cooldown only applies to CONTINUING active rules, not canceled ones
            await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
              lastTriggered: null
            }, { merge: true });
          } catch (cancelError) {
            console.error(`[Automation] Unexpected error during cancellation:`, cancelError.message);
            // Break on unexpected errors - don't risk applying a replacement
            break;
          }
          
          // Only proceed if segment clear was successful
          if (segmentClearSuccess) {
            await saveUserAutomationState(userId, { 
              lastCheck: Date.now(), 
              inBlackout: false, 
              activeRule: null,
              activeRuleName: null,
              activeSegment: null,
              activeSegmentEnabled: false
            });
            
            // Log to audit trail - Rule turned OFF
            // Include full evaluation context showing why conditions failed
            // Transform evaluationResults to frontend-friendly format
            const allRulesForAudit = evaluationResults.map(evalResult => {
              const ruleData = sortedRules.find(([_id, r]) => r.name === evalResult.rule);
              const [evalRuleId] = ruleData || [null];
              
              return {
                name: evalResult.rule,
                ruleId: evalRuleId || evalResult.rule,
                triggered: evalResult.result === 'triggered' || evalResult.result === 'continuing',
                feedInPrice: evalResult.details?.feedInPrice !== undefined && evalResult.details?.feedInPrice !== null ? evalResult.details.feedInPrice : null,
                buyPrice: evalResult.details?.buyPrice !== undefined && evalResult.details?.buyPrice !== null ? evalResult.details.buyPrice : null,
                conditions: evalResult.details?.results?.map(cond => ({
                  name: cond.condition,
                  met: cond.met,
                  value: cond.actual !== undefined ? String(cond.actual) : (cond.reason || 'N/A'),
                  rule: `${cond.condition} ${cond.operator || ''} ${cond.target || ''}`
                })) || []
              };
            });
            
            await addAutomationAuditEntry(userId, {
              cycleId: `cycle_${cycleStartTime}`,
              triggered: false,
              ruleName: rule.name,
              ruleId: ruleId,
              evaluationResults: result.conditions || [],
              allRuleEvaluations: allRulesForAudit, // Complete evaluation context in frontend format
              actionTaken: null,
              activeRuleBefore: state.activeRule,
              activeRuleAfter: null,
              rulesEvaluated: sortedRules.length,
              cycleDurationMs: Date.now() - cycleStartTime
            });
            
            // Continue to check if any other rule can trigger
            continue;
          } else {
            // Failed to clear - don't evaluate replacement rules this cycle
            break;
          }
        }
      }
    }
    
    if (!triggeredRule) {
      
      // Just update lastCheck timestamp
      // Note: If an active rule's conditions no longer held, it was already handled in the main loop above
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
    }

    // ========== SOLAR CURTAILMENT CHECK ==========
    // Run AFTER automation rules to ensure sequential execution
    // Curtailment failures don't affect automation cycle
    let curtailmentResult = null;
    try {
      logger.debug('Cycle', `🌞 Starting curtailment check with amberData: ${amberData ? amberData.length : 'null'} items`);
      logger.debug('Cycle', `🔍 FULL userConfig: ${JSON.stringify(userConfig)}`);
      logger.debug('Cycle', `🔍 userConfig.curtailment specifically: ${JSON.stringify(userConfig?.curtailment)}`);
      curtailmentResult = await checkAndApplyCurtailment(userId, userConfig, amberData);
      logger.debug('Cycle', `🌞 Curtailment result: ${JSON.stringify(curtailmentResult)}`);
      if (curtailmentResult.error) {
        console.warn(`[Cycle] ⚠️ Curtailment check failed: ${curtailmentResult.error}`);
      }
    } catch (curtErr) {
      console.error('[Cycle] ❌ Curtailment exception:', curtErr);
      curtailmentResult = { error: curtErr.message, enabled: userConfig?.curtailment?.enabled || false };
    }
    
    // Calculate cycle duration
    const cycleDurationMs = Date.now() - cycleStartTime;
    
    res.json({
      errno: 0,
      result: {
        triggered: !!triggeredRule,
        status: triggeredRule?.status || null,  // 'new_trigger', 'continuing', or null
        rule: triggeredRule ? { name: triggeredRule.name, priority: triggeredRule.priority, actionResult: triggeredRule.actionResult } : null,
        rulesEvaluated: sortedRules.length,
        totalRules,
        evaluationResults,
        lastCheck: Date.now(),
        // Curtailment result (for UI feedback)
        curtailment: curtailmentResult,
        // Performance
        cycleDurationMs
      }
    });
  } catch (error) {
    console.error('[Automation] Cycle error:', error);
    
    // Still update lastCheck even on error
    try {
      await saveUserAutomationState(req.user.uid, { lastCheck: Date.now() });
    } catch (e) { /* ignore */ }
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Cancel active automation segment - clears all scheduler segments
app.post('/api/automation/cancel', async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const deviceSN = userConfig?.deviceSn;
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    logger.debug('Automation', `Cancel request for user ${userId}, device ${deviceSN}`);

    // Create 8 empty/disabled segments (matching device's actual group count)
    const emptyGroups = [];
    for (let i = 0; i < 8; i++) {
      emptyGroups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    
    // Send to device via v1 API
    const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: emptyGroups }, userConfig, userId);
    logger.debug('Automation', `Cancel v1 result: errno=${result.errno}`);
    
    // Disable the scheduler flag
    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      logger.debug('Automation', `Cancel flag result: errno=${flagResult?.errno}`);
    } catch (flagErr) {
      console.warn('[Automation] Flag disable failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    
    // Verification read
    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      console.warn('[Automation] Verify read failed:', e && e.message ? e.message : e);
    }
    
    // Clear active rule in state
    await saveUserAutomationState(userId, {
      activeRule: null
    });
    
    // Log to history
    try {
      await addHistoryEntry(userId, {
        type: 'automation_cancel',
        timestamp: serverTimestamp()
      });
    } catch (e) { /* ignore */ }
    
    res.json({
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Automation cancelled' : 'Failed'),
      flagResult,
      verify: verify?.result || null
    });
  } catch (error) {
    console.error('[Automation] Cancel error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ============================================================
// Quick Manual Controls - Immediate charge/discharge
// ============================================================

/**
 * Start a quick manual control (charge or discharge)
 * POST /api/quickcontrol/start
 * Body: { type: 'charge'|'discharge', power: 0-30000, durationMinutes: 2-360 }
 */
app.post('/api/quickcontrol/start', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { type, power, durationMinutes } = req.body;
    
    console.log('[QuickControl] Start request:', { userId, type, power, durationMinutes, bodyType: typeof req.body });
    
    // Validation
    if (!type || (type !== 'charge' && type !== 'discharge')) {
      console.log('[QuickControl] Validation failed: invalid type');
      return res.status(400).json({ errno: 400, error: 'type must be "charge" or "discharge"' });
    }
    if (typeof power !== 'number' || power < 0 || power > 30000) {
      console.log('[QuickControl] Validation failed: invalid power', { power, type: typeof power });
      return res.status(400).json({ errno: 400, error: 'power must be between 0 and 30000 watts' });
    }
    if (typeof durationMinutes !== 'number' || durationMinutes < 2 || durationMinutes > 360) {
      console.log('[QuickControl] Validation failed: invalid duration', { durationMinutes, type: typeof durationMinutes });
      return res.status(400).json({ errno: 400, error: 'durationMinutes must be between 2 and 360' });
    }
    
    logger.debug('QuickControl', `Start requested: type=${type}, power=${power}W, duration=${durationMinutes}min, userId=${userId}`);
    
    // Get user configuration
    const userConfig = await getUserConfig(userId);
    if (!userConfig || !userConfig.deviceSn) {
      return res.status(400).json({ errno: 400, error: 'Device serial number not configured' });
    }
    const deviceSN = userConfig.deviceSn;
    
    // Get user's timezone and current time in their timezone (same as automation)
    const userTimezone = getAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const startHour = userTime.hour;
    const startMinute = userTime.minute;
    
    logger.debug('QuickControl', `Using timezone: ${userTimezone}, local time: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')}`);
    
    // Calculate end time using timezone-aware addMinutes helper
    const endTimeObj = addMinutes(startHour, startMinute, durationMinutes);
    let endHour = endTimeObj.hour;
    let endMinute = endTimeObj.minute;
    
    // Handle midnight crossing (FoxESS doesn't support segments crossing 00:00)
    const startTotalMins = startHour * 60 + startMinute;
    const endTotalMins = endHour * 60 + endMinute;
    if (endTotalMins <= startTotalMins) {
      logger.warn('QuickControl', `Midnight crossing detected, capping at 23:59`);
      endHour = 23;
      endMinute = 59;
    }
    
    logger.debug('QuickControl', `Segment time: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')} -> ${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')}`);
    
    // Determine work mode based on type (must be STRING to match manual scheduler)
    const workMode = type === 'charge' ? 'ForceCharge' : 'ForceDischarge';
    
    // Set SoC parameters based on charge vs discharge
    const minSocOnGrid = 20; // Min SoC on Grid for both charge and discharge
    const fdSoc = type === 'charge' ? 90 : 30; // Stop SoC: 90% for charge, 30% for discharge
    
    logger.debug('QuickControl', `Parameters: workMode=${workMode}, power=${power}W, minSocOnGrid=${minSocOnGrid}%, fdSoc=${fdSoc}%, maxSoc=100%`);
    
    // Create scheduler segment (Group 1 enabled, Groups 2-8 disabled)
    const groups = [];
    for (let i = 0; i < 8; i++) {
      if (i === 0) { // Group 1: Quick control segment
        groups.push({
          enable: 1,
          workMode: workMode,
          startHour: startHour,
          startMinute: startMinute,
          endHour: endHour,
          endMinute: endMinute,
          minSocOnGrid: minSocOnGrid,
          fdSoc: fdSoc,
          fdPwr: power,
          maxSoc: 100
        });
      } else {
        groups.push({
          enable: 0,
          workMode: 'SelfUse',
          startHour: 0,
          startMinute: 0,
          endHour: 0,
          endMinute: 0,
          minSocOnGrid: 10,
          fdSoc: 10,
          fdPwr: 0,
          maxSoc: 100
        });
      }
    }
    
    // Send to FoxESS API with retries
    let result = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        logger.debug('QuickControl', `Attempt ${attempts}/${maxAttempts}: Calling FoxESS API...`);
        result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', {
          deviceSN,
          groups
        }, userConfig, userId);
        
        logger.debug('QuickControl', `Attempt ${attempts} result: errno=${result?.errno}, msg=${result?.msg}`);
        
        if (result && result.errno === 0) {
          logger.debug('QuickControl', `Segment set success on attempt ${attempts}`);
          break;
        } else {
          logger.debug('QuickControl', `Attempt ${attempts} returned errno=${result?.errno}`);
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (apiErr) {
        logger.debug('QuickControl', `API error on attempt ${attempts}: ${apiErr.message}`);
        if (attempts === maxAttempts) throw apiErr;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (!result || result.errno !== 0) {
      const errorDetails = {
        errno: result?.errno || 500,
        msg: result?.msg || 'Failed to set quick control segment',
        result: result?.result || null
      };
      console.error('[QuickControl] FoxESS API failed after retries:', JSON.stringify(errorDetails));
      return res.status(500).json({
        errno: errorDetails.errno,
        error: errorDetails.msg,
        details: errorDetails.result
      });
    }
    
    // Enable scheduler flag
    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', {
        deviceSN,
        enable: 1
      }, userConfig, userId);
      logger.debug('QuickControl', `Flag enable result: errno=${flagResult?.errno}`);
    } catch (flagErr) {
      console.warn('[QuickControl] Flag enable failed:', flagErr?.message || flagErr);
    }
    
    // 3-second wait before verification
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verification read
    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      console.warn('[QuickControl] Verify read failed:', e?.message || e);
    }
    
    // Save state to Firestore
    const startedAt = Date.now();
    const expiresAt = startedAt + (durationMinutes * 60 * 1000);
    
    await saveQuickControlState(userId, {
      active: true,
      type: type,
      power: power,
      durationMinutes: durationMinutes,
      startedAt: startedAt,
      expiresAt: expiresAt,
      createdAt: serverTimestamp()
    });
    
    // Log to history
    try {
      await addHistoryEntry(userId, {
        type: 'quickcontrol_start',
        controlType: type,
        power: power,
        durationMinutes: durationMinutes,
        timestamp: serverTimestamp()
      });
    } catch (e) { /* ignore */ }
    
    logger.info('QuickControl', `Started: type=${type}, power=${power}W, duration=${durationMinutes}min, expiresAt=${new Date(expiresAt).toISOString()}`);
    
    res.json({
      errno: 0,
      msg: 'Quick control started',
      state: {
        active: true,
        type: type,
        power: power,
        durationMinutes: durationMinutes,
        startedAt: startedAt,
        expiresAt: expiresAt
      },
      flagResult,
      verify: verify?.result || null
    });
  } catch (error) {
    console.error('[QuickControl] Start error:', error);
    console.error('[QuickControl] Error stack:', error.stack);
    console.error('[QuickControl] Error details:', JSON.stringify({
      message: error.message,
      name: error.name,
      code: error.code
    }));
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * Stop/end quick manual control
 * POST /api/quickcontrol/end
 */
app.post('/api/quickcontrol/end', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    logger.debug('QuickControl', `End requested: userId=${userId}`);
    
    // Get current quick control state
    const quickState = await getQuickControlState(userId);
    if (!quickState || !quickState.active) {
      return res.json({
        errno: 0,
        msg: 'No active quick control to stop'
      });
    }
    
    // Get user configuration
    const userConfig = await getUserConfig(userId);
    if (!userConfig || !userConfig.deviceSn) {
      return res.status(400).json({ errno: 400, error: 'Device serial number not configured' });
    }
    const deviceSN = userConfig.deviceSn;
    
    // Clear all scheduler segments (same as cancel)
    const groups = [];
    for (let i = 0; i < 8; i++) {
      groups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0,
        startMinute: 0,
        endHour: 0,
        endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    
    // Send to FoxESS API with retries
    let result = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        attempts++;
        result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', {
          deviceSN,
          groups
        }, userConfig, userId);
        
        if (result && result.errno === 0) {
          logger.debug('QuickControl', `Segments cleared on attempt ${attempts}`);
          break;
        } else {
          logger.debug('QuickControl', `Clear attempt ${attempts} returned errno=${result?.errno}`);
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (apiErr) {
        logger.debug('QuickControl', `API error on attempt ${attempts}: ${apiErr.message}`);
        if (attempts === maxAttempts) throw apiErr;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (!result || result.errno !== 0) {
      return res.status(500).json({
        errno: result?.errno || 500,
        error: result?.msg || 'Failed to clear quick control segment'
      });
    }
    
    // Disable scheduler flag
    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', {
        deviceSN,
        enable: 0
      }, userConfig, userId);
      logger.debug('QuickControl', `Flag disable result: errno=${flagResult?.errno}`);
    } catch (flagErr) {
      console.warn('[QuickControl] Flag disable failed:', flagErr?.message || flagErr);
    }
    
    // Verification read
    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      console.warn('[QuickControl] Verify read failed:', e?.message || e);
    }
    
    // Delete state from Firestore
    await saveQuickControlState(userId, null);
    
    // Log to history
    try {
      await addHistoryEntry(userId, {
        type: 'quickcontrol_end',
        controlType: quickState.type,
        power: quickState.power,
        durationMinutes: quickState.durationMinutes,
        completedEarly: quickState.expiresAt > Date.now(),
        timestamp: serverTimestamp()
      });
    } catch (e) { /* ignore */ }
    
    logger.info('QuickControl', `Ended: type=${quickState.type}, power=${quickState.power}W`);
    
    res.json({
      errno: 0,
      msg: 'Quick control stopped',
      flagResult,
      verify: verify?.result || null
    });
  } catch (error) {
    console.error('[QuickControl] End error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * Get quick control status
 * GET /api/quickcontrol/status
 */
app.get('/api/quickcontrol/status', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const quickState = await getQuickControlState(userId);
    
    if (!quickState || !quickState.active) {
      return res.json({
        errno: 0,
        result: {
          active: false
        }
      });
    }
    
    // If expired, auto-cleanup immediately (don't wait for user acknowledge)
    const now = Date.now();
    if (now >= quickState.expiresAt) {
      // Clean up in the background - clear segments and delete state
      const cleaned = await cleanupExpiredQuickControl(userId, quickState);
      logger.info('QuickControl', `Status check triggered auto-cleanup: cleaned=${cleaned}`);
      
      return res.json({
        errno: 0,
        result: {
          active: false,
          justExpired: true,
          completedControl: {
            type: quickState.type,
            power: quickState.power,
            durationMinutes: quickState.durationMinutes
          }
        }
      });
    }
    
    // Calculate remaining time
    const remainingMs = Math.max(0, quickState.expiresAt - now);
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    
    res.json({
      errno: 0,
      result: {
        active: true,
        type: quickState.type,
        power: quickState.power,
        durationMinutes: quickState.durationMinutes,
        startedAt: quickState.startedAt,
        expiresAt: quickState.expiresAt,
        remainingMinutes: remainingMinutes,
        expired: false
      }
    });
  } catch (error) {
    console.error('[QuickControl] Status error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Manually end an orphan ongoing rule (create a "complete" audit entry with endTime)
// This fixes rules that get stuck in "ongoing" state without a proper termination event
app.post('/api/automation/rule/end', async (req, res) => {
  try {
    const { ruleId, ruleName, endTime } = req.body;
    const userId = req.user.uid;
    
    if (!ruleId && !ruleName) {
      return res.status(400).json({ errno: 400, error: 'ruleId or ruleName is required' });
    }
    
    const actualRuleId = ruleId || (ruleName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const endTimestamp = endTime || Date.now();
    
    logger.debug('Automation', `Manual rule end requested: ruleId=${actualRuleId}, endTime=${endTimestamp}`);
    
    // Get automation audit logs to find the start event for this rule
    const auditLogs = await getAutomationAuditLogs(userId, 500);
    
    // Find the most recent log where this rule became active
    let startEvent = null;
    let startTimestamp = null;
    
    for (const log of auditLogs) {
      if (log.activeRuleAfter === actualRuleId && log.triggered) {
        startTimestamp = log.epochMs;
        startEvent = {
          ruleName: log.ruleName,
          ruleId: actualRuleId,
          conditions: log.evaluationResults,
          allRuleEvaluations: log.allRuleEvaluations,
          action: log.actionTaken
        };
        break;  // Found the most recent activation (logs are in desc order)
      }
    }
    
    if (!startEvent) {
      return res.status(400).json({ errno: 400, error: `No activation event found for rule ${actualRuleId}` });
    }
    
    logger.debug('Automation', `Found start event at ${new Date(startTimestamp).toISOString()}`);
    
    // Create an audit entry that shows the rule being deactivated
    // This creates the "off" event that pairs with the "on" event in the audit trail
    await addAutomationAuditEntry(userId, {
      cycleId: `cycle_manual_end_${Date.now()}`,
      triggered: false,
      ruleName: startEvent.ruleName,
      ruleId: actualRuleId,
      evaluationResults: [],
      allRuleEvaluations: [{
        name: startEvent.ruleName,
        ruleId: actualRuleId,
        triggered: false,
        conditions: [],
        feedInPrice: null,
        buyPrice: null
      }],
      actionTaken: null,
      activeRuleBefore: actualRuleId,
      activeRuleAfter: null,  // This is the key - switching from activeRule to null marks it as ended
      rulesEvaluated: 0,
      cycleDurationMs: endTimestamp - startTimestamp,
      manualEnd: true  // Flag to indicate this was manually ended
    });
    
    // Also clear the active rule from state if it's still set to this rule
    const state = await getUserAutomationState(userId);
    if (state && state.activeRule === actualRuleId) {
      logger.debug('Automation', `Clearing active rule state for ${actualRuleId}`);
      await saveUserAutomationState(userId, {
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
    }
    
    const durationMs = endTimestamp - startTimestamp;
    logger.debug('Automation', `✅ Orphan rule ended: ${startEvent.ruleName} (${Math.round(durationMs / 1000)}s duration)`);
    
    res.json({
      errno: 0,
      result: {
        ended: true,
        ruleName: startEvent.ruleName,
        ruleId: actualRuleId,
        startTime: startTimestamp,
        endTime: endTimestamp,
        durationMs,
        message: 'Orphan rule successfully ended with completion timestamp'
      }
    });
  } catch (error) {
    console.error('[Automation] Manual rule end error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Create automation rule
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
      priority: typeof priority === 'number' ? priority : 5, // Default to priority 5 for new rules
      conditions: conditions || {},
      action: action || {},
      cooldownMinutes: typeof cooldownMinutes === 'number' ? cooldownMinutes : 5,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set(rule);
    res.json({ errno: 0, result: { ruleId, ...rule } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Update automation rule (backwards-compatible endpoint used by frontend)
// IMPORTANT: Only updates provided fields - does NOT overwrite with defaults
app.post('/api/automation/rule/update', async (req, res) => {
  try {
    const { ruleName, name, enabled, priority, conditions, action, cooldownMinutes } = req.body;

    if (!ruleName && !name) {
      return res.status(400).json({ errno: 400, error: 'Rule name or ruleId is required' });
    }

    const ruleId = (ruleName || name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    
    // Build update object with ONLY provided fields to avoid overwriting existing data
    const update = {
      updatedAt: serverTimestamp()
    };
    
    // Only include fields that were explicitly provided in the request
    if (name !== undefined) update.name = name;
    if (enabled !== undefined) update.enabled = !!enabled;
    if (typeof priority === 'number') update.priority = priority;
    if (conditions !== undefined) update.conditions = conditions;
    if (cooldownMinutes !== undefined) update.cooldownMinutes = cooldownMinutes;
    
    // Handle action - merge with existing if partial update
    if (action !== undefined) {
      // Get existing rule to merge action properly
      const existingDoc = await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).get();
      if (existingDoc.exists && existingDoc.data().action) {
        // Merge new action fields with existing action
        update.action = { ...existingDoc.data().action, ...action };
      } else {
        update.action = action;
      }
    }

    console.log(`[Rule Update] Updating rule ${ruleId} with fields:`, Object.keys(update));
    
    // If rule is being DISABLED, clear lastTriggered to reset cooldown
    // This ensures the rule can trigger immediately when re-enabled
    if (enabled === false) {
      update.lastTriggered = null;
      console.log(`[Rule Update] Rule ${ruleId} disabled - clearing lastTriggered to reset cooldown`);
      
      // Also check if this was the active rule and clear segments IMMEDIATELY + create audit entry
      const state = await getUserAutomationState(req.user.uid);
      if (state && state.activeRule === ruleId) {
        console.log(`[Rule Update] Disabled rule was active - clearing segments immediately`);
        
        // Get user config for device SN
        const userConfig = await getUserConfig(req.user.uid);
        const deviceSN = userConfig?.deviceSn;
        
        // Clear scheduler segments immediately
        if (deviceSN) {
          try {
            const clearedGroups = [];
            for (let i = 0; i < 8; i++) {
              clearedGroups.push({
                enable: 0,
                workMode: 'SelfUse',
                startHour: 0, startMinute: 0,
                endHour: 0, endMinute: 0,
                minSocOnGrid: 10,
                fdSoc: 10,
                fdPwr: 0,
                maxSoc: 100
              });
            }
            const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, req.user.uid);
            if (clearResult?.errno === 0) {
              console.log(`[Rule Update] ✓ Segments cleared successfully`);
            } else {
              console.warn(`[Rule Update] ⚠️ Failed to clear segments: errno=${clearResult?.errno}`);
            }
          } catch (err) {
            console.error(`[Rule Update] ❌ Error clearing segments:`, err.message);
          }
        }
        
        // Create audit entry to mark rule as ended (critical for ROI display)
        const activationTime = state.lastTriggered || Date.now();
        const deactivationTime = Date.now();
        const durationMs = deactivationTime - activationTime;
        
        await addAutomationAuditEntry(req.user.uid, {
          cycleId: `cycle_rule_disabled_${Date.now()}`,
          triggered: false,
          ruleName: state.activeRuleName || state.activeRule,
          ruleId: state.activeRule,
          evaluationResults: [],
          allRuleEvaluations: [{
            name: state.activeRuleName || state.activeRule,
            ruleId: state.activeRule,
            triggered: false,
            conditions: [],
            feedInPrice: null,
            buyPrice: null
          }],
          actionTaken: null,
          activeRuleBefore: state.activeRule,
          activeRuleAfter: null,  // This marks the rule as ended
          rulesEvaluated: 0,
          cycleDurationMs: durationMs,
          manualEnd: true,
          reason: 'Rule disabled by user'
        });
        
        console.log(`[Rule Update] ✓ Audit entry created - rule marked as ended`);
        
        // Clear active rule state
        await saveUserAutomationState(req.user.uid, {
          activeRule: null,
          activeRuleName: null,
          activeSegment: null,
          activeSegmentEnabled: false
        });
      }
    }
    
    await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).set(update, { merge: true });
    
    // Return the updated rule
    const updatedDoc = await db.collection('users').doc(req.user.uid).collection('rules').doc(ruleId).get();
    res.json({ errno: 0, result: { ruleId, ...updatedDoc.data() } });
  } catch (error) {
    console.error('[Rule Update] Error:', error);
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
    
    // Check if this is the active rule, if so, set flag to clear segments
    const state = await getUserAutomationState(req.user.uid);
    if (state && state.activeRule === ruleId) {
      console.log(`[Rule Delete] Deleted rule was active - clearing segments immediately`);
      
      // Get user config for device SN
      const userConfig = await getUserConfig(req.user.uid);
      const deviceSN = userConfig?.deviceSn;
      
      // Clear scheduler segments immediately
      if (deviceSN) {
        try {
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, req.user.uid);
          if (clearResult?.errno === 0) {
            console.log(`[Rule Delete] ✓ Segments cleared successfully`);
          } else {
            console.warn(`[Rule Delete] ⚠️ Failed to clear segments: errno=${clearResult?.errno}`);
          }
        } catch (err) {
          console.error(`[Rule Delete] ❌ Error clearing segments:`, err.message);
        }
      }
      
      // Create audit entry to mark rule as ended (critical for ROI display)
      const activationTime = state.lastTriggered || Date.now();
      const deactivationTime = Date.now();
      const durationMs = deactivationTime - activationTime;
      
      await addAutomationAuditEntry(req.user.uid, {
        cycleId: `cycle_rule_deleted_${Date.now()}`,
        triggered: false,
        ruleName: state.activeRuleName || state.activeRule,
        ruleId: state.activeRule,
        evaluationResults: [],
        allRuleEvaluations: [{
          name: state.activeRuleName || state.activeRule,
          ruleId: state.activeRule,
          triggered: false,
          conditions: [],
          feedInPrice: null,
          buyPrice: null
        }],
        actionTaken: null,
        activeRuleBefore: state.activeRule,
        activeRuleAfter: null,  // This marks the rule as ended
        rulesEvaluated: 0,
        cycleDurationMs: durationMs,
        manualEnd: true,
        reason: 'Rule deleted by user'
      });
      
      console.log(`[Rule Delete] ✓ Audit entry created - rule marked as ended`);
      
      // Clear active rule state
      await saveUserAutomationState(req.user.uid, {
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
    }
    
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

// Get automation audit logs (cycle history with cache & performance metrics)
app.get('/api/automation/audit', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '1000', 10);  // Increased to ensure we get all events in range
    const days = parseInt(req.query.days || '7', 10);  // Support days parameter (default 7)
    
    // Support explicit date range: ?startDate=2025-12-19&endDate=2025-12-21
    let startMs = null;
    let endMs = null;
    let period = null;
    
    if (req.query.startDate && req.query.endDate) {
      try {
        // Parse dates as YYYY-MM-DD in local timezone
        const [startYear, startMonth, startDay] = req.query.startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = req.query.endDate.split('-').map(Number);
        
        if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) {
          throw new Error('Invalid date format');
        }
        
        const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
        const endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
        
        startMs = startDate.getTime();
        endMs = endDate.getTime();
        period = `${req.query.startDate} to ${req.query.endDate}`;
        console.log(`[Audit] Fetching events for date range: ${period} (${startMs} to ${endMs})`);
      } catch (parseError) {
        console.error(`[Audit] Date parsing error: ${parseError.message}`);
        return res.status(400).json({ errno: 400, error: `Invalid date format: ${parseError.message}` });
      }
    } else {
      // Fallback: use days parameter (relative to now)
      endMs = Date.now();
      startMs = endMs - (days * 24 * 60 * 60 * 1000);
      period = `${days} days`;
      console.log(`[Audit] Fetching events for last ${period} (${startMs} to ${endMs})`);
    }
    
    const auditLogs = await getAutomationAuditLogs(req.user.uid, limit);
    
    // Filter by date range
    const filteredLogs = auditLogs.filter(log => log.epochMs >= startMs && log.epochMs <= endMs);
    
    console.log(`[Audit] Filtered ${filteredLogs.length} events from ${auditLogs.length} total`);
    
    // Process logs to identify rule on/off pairs and calculate durations
    const ruleEvents = [];
    const activeRules = new Map();  // Track currently active rules
    
    // Process logs in chronological order (oldest first)
    const chronological = [...filteredLogs].reverse();
    
    for (const log of chronological) {
      const activeRuleBefore = log.activeRuleBefore;
      const activeRuleAfter = log.activeRuleAfter;
      
      // Detect rule turning OFF (was active, now not)
      if (activeRuleBefore && activeRuleBefore !== activeRuleAfter) {
        const startEvent = activeRules.get(activeRuleBefore);
        if (startEvent) {
          // Rule turned off - create complete event with duration
          const durationMs = log.epochMs - startEvent.epochMs;
          ruleEvents.push({
            type: 'complete',
            ruleId: activeRuleBefore,
            ruleName: startEvent.ruleName || activeRuleBefore,
            startTime: startEvent.epochMs,
            endTime: log.epochMs,
            durationMs,
            startConditions: startEvent.conditions,
            endConditions: log.evaluationResults,
            startAllRules: startEvent.allRuleEvaluations,  // All rules evaluated at start
            endAllRules: log.allRuleEvaluations,          // All rules evaluated at end
            action: startEvent.action,
            roiSnapshot: startEvent.roiSnapshot  // ⭐ Include ROI snapshot captured at trigger time
          });
          activeRules.delete(activeRuleBefore);
        }
      }
      
      // Detect rule turning ON (newly triggered)
      if (log.triggered && activeRuleAfter && activeRuleAfter !== activeRuleBefore) {
        // Rule turned on - store start event
        activeRules.set(activeRuleAfter, {
          epochMs: log.epochMs,
          ruleName: log.ruleName || activeRuleAfter,
          ruleId: log.ruleId || activeRuleAfter,
          conditions: log.evaluationResults,
          allRuleEvaluations: log.allRuleEvaluations,  // Store all rules evaluated
          action: log.actionTaken,
          roiSnapshot: log.roiSnapshot  // ⭐ Preserve ROI data for later use in complete event
        });
      }
    }
    
    // Add any still-active rules as ongoing events
    for (const [ruleId, startEvent] of activeRules.entries()) {
      const durationMs = Date.now() - startEvent.epochMs;
      ruleEvents.push({
        type: 'ongoing',
        ruleId,
        ruleName: startEvent.ruleName || ruleId,
        startTime: startEvent.epochMs,
        endTime: null,
        durationMs,
        startConditions: startEvent.conditions,
        startAllRules: startEvent.allRuleEvaluations,  // All rules evaluated when started
        action: startEvent.action,
        roiSnapshot: startEvent.roiSnapshot  // ⭐ Include ROI snapshot from trigger time
      });
    }
    
    // Sort events by start time (newest first for UI)
    ruleEvents.sort((a, b) => b.startTime - a.startTime);
    
    res.json({ 
      errno: 0, 
      result: {
        entries: filteredLogs,  // Raw audit logs
        ruleEvents,             // Processed rule on/off events
        count: filteredLogs.length,
        eventsCount: ruleEvents.length,
        period: period,
        cutoffTime: startMs,
        note: 'Logs older than 7 days are automatically deleted'
      }
    });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Run automation test with provided mock data (simulation)
app.post('/api/automation/test', async (req, res) => {
  try {
    const mockData = req.body && req.body.mockData ? req.body.mockData : (req.body || {});

    // Load user rules
    const rules = await getUserRules(req.user.uid);
    const sorted = Object.entries(rules || {}).filter(([_, r]) => r.enabled).sort((a,b) => (a[1].priority||99) - (b[1].priority||99));

    const allResults = [];
    // Helper to check time window
    const timeInWindow = (timeStr, start, end) => {
      if (!timeStr) return true; // if no test time provided assume match
      const toMins = t => { const [hh,mm] = (t||'00:00').split(':').map(x=>parseInt(x,10)||0); return hh*60+mm; };
      const t = toMins(timeStr);
      const s = toMins(start || '00:00');
      const e = toMins(end || '23:59');
      if (s <= e) return t >= s && t <= e;
      // window spans midnight
      return t >= s || t <= e;
    };

    for (const [ruleId, rule] of sorted) {
      const cond = rule.conditions || {};
      let met = true;
      const condDetails = [];

      // feedInPrice
      if (cond.feedInPrice?.enabled) {
        const price = Number(mockData.feedInPrice || 0);
        const target = Number(cond.feedInPrice.value || 0);
        const cmet = compareValue(price, cond.feedInPrice.operator, target);
        condDetails.push({ name: 'Feed-in Price', value: price, target, operator: cond.feedInPrice.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // buyPrice
      if (cond.buyPrice?.enabled) {
        const price = Number(mockData.buyPrice || 0);
        const target = Number(cond.buyPrice.value || 0);
        const cmet = compareValue(price, cond.buyPrice.operator, target);
        condDetails.push({ name: 'Buy Price', value: price, target, operator: cond.buyPrice.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // soc
      if (cond.soc?.enabled) {
        const soc = Number(mockData.soc || 0);
        const target = Number(cond.soc.value || 0);
        const cmet = compareValue(soc, cond.soc.operator, target);
        condDetails.push({ name: 'Battery SoC', value: soc, target, operator: cond.soc.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // temperature
      if (cond.temperature?.enabled) {
        const type = cond.temperature.type || 'battery';
        const tempVal = type === 'ambient' ? Number(mockData.ambientTemp || 0) : Number(mockData.batteryTemp || 0);
        const target = Number(cond.temperature.value || 0);
        const cmet = compareValue(tempVal, cond.temperature.operator, target);
        condDetails.push({ name: (type === 'ambient' ? 'Ambient Temp' : 'Battery Temp'), value: tempVal, target, operator: cond.temperature.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // time
      const timeCond = cond.time || cond.timeWindow;
      if (timeCond?.enabled) {
        const ok = timeInWindow(mockData.testTime || null, timeCond.startTime || timeCond.start, timeCond.endTime || timeCond.end);
        condDetails.push({ name: 'Time Window', value: mockData.testTime || 'now', target: `${timeCond.startTime || timeCond.start || '00:00'}–${timeCond.endTime || timeCond.end || '23:59'}`, operator: 'in', met: !!ok });
        if (!ok) met = false;
      }

      allResults.push({ ruleName: rule.name || ruleId, ruleId, met, priority: rule.priority || 99, conditions: condDetails });

      if (met) {
        // First match wins
        return res.json({ errno: 0, triggered: true, result: { ruleName: rule.name || ruleId, ruleId, priority: rule.priority || 99, action: rule.action || {} }, testData: mockData, allResults });
      }
    }

    // No rules triggered
    res.json({ errno: 0, triggered: false, result: null, testData: mockData, allResults });
  } catch (error) {
    console.error('[API] /api/automation/test error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Inverter endpoints (proxy to FoxESS)
app.get('/api/inverter/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
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
    
    // Check for force refresh query parameter (bypass cache when ?forceRefresh=true)
    const forceRefresh = req.query.forceRefresh === 'true' || req.query.force === 'true';
    
    // Use cached data to avoid excessive Fox API calls (unless force refresh requested)
    // This respects per-user cache TTL and reduces API quota usage significantly
    const result = await getCachedInverterRealtimeData(req.user.uid, sn, userConfig, forceRefresh);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Read a specific inverter setting (returns the value for a given key)
app.get('/api/inverter/settings', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    const key = req.query.key;
    if (!key) return res.status(400).json({ errno: 400, error: 'Missing required parameter: key' });
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/inverter/settings error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Battery SoC read endpoint used by control UI
app.get('/api/device/battery/soc/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const result = await foxessAPI.callFoxESSAPI(`/op/v0/device/battery/soc/get?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/soc/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Battery SoC set
app.post('/api/device/battery/soc/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const { minSoc, minSocOnGrid, maxSoc } = req.body;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[BatterySoC] SET REQUEST`);
    console.log(`  User: ${req.user.uid}`);
    console.log(`  Device SN: ${sn}`);
    console.log(`  Request body:`, JSON.stringify(req.body, null, 2));
    console.log(`  Extracted: minSoc=${minSoc}, minSocOnGrid=${minSocOnGrid}, maxSoc=${maxSoc}`);
    
    if (!sn) {
      console.log(`[BatterySoC] ❌ No device SN configured`);
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    const foxessPayload = { sn, minSoc, minSocOnGrid, maxSoc };
    console.log(`[BatterySoC] Calling FoxESS API with payload:`, JSON.stringify(foxessPayload, null, 2));
    
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/battery/soc/set', 'POST', foxessPayload, userConfig, req.user.uid);
    
    console.log(`[BatterySoC] FoxESS Response:`, JSON.stringify(result, null, 2));
    console.log(`${'='.repeat(80)}\n`);
    
    res.json(result);
  } catch (error) {
    console.error('[BatterySoC] Error:', error);
    console.log(`${'='.repeat(80)}\n`);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== DEVICE SETTINGS (Curtailment Discovery) ====================

// Read device setting (for discovery / testing)
// NOTE: Includes retry logic for empty results (transient failures)
app.post('/api/device/setting/get', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const key = req.body.key;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[DeviceSetting] REQUEST - Key: ${key}, SN: ${sn}`);
    console.log(`[DeviceSetting] User: ${req.user.uid}`);
    
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    if (!key) return res.status(400).json({ errno: 400, error: 'Missing required parameter: key' });
    
    // Retry logic: if result is empty, retry once after short delay
    let result = null;
    let retryCount = 0;
    const maxRetries = 1;
    
    while (retryCount <= maxRetries) {
      if (retryCount > 0) {
        console.log(`[DeviceSetting] Retry ${retryCount}/${maxRetries} for key ${key} after 500ms delay...`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log(`[DeviceSetting] Calling FoxESS API with:`, { sn, key });
      result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, userConfig, req.user.uid);
      
      // 🔍 AGGRESSIVE DEBUG LOGGING
      console.log(`[DeviceSetting] FULL RESPONSE OBJECT:`, JSON.stringify(result, null, 2));
      console.log(`[DeviceSetting] errno:`, result?.errno);
      console.log(`[DeviceSetting] result field:`, JSON.stringify(result?.result, null, 2));
      console.log(`[DeviceSetting] result.data:`, JSON.stringify(result?.result?.data, null, 2));
      console.log(`[DeviceSetting] result.value:`, result?.result?.value);
      console.log(`[DeviceSetting] error field:`, result?.error);
      console.log(`[DeviceSetting] msg field:`, result?.msg);
      
      // Check if result is not empty or if we got an explicit error (don't retry those)
      const resultIsEmpty = result?.result && Object.keys(result.result).length === 0;
      const hasError = result?.errno !== 0 && result?.error;
      
      if (!resultIsEmpty || hasError) {
        // Either we got data or an explicit error - don't retry
        console.log(`[DeviceSetting] Result received${resultIsEmpty ? ' (empty)' : ''}${hasError ? ` (error: ${result.errno})` : ''} - stopping retries`);
        break;
      }
      
      // Empty result and no explicit error - this might be transient
      if (resultIsEmpty && retryCount < maxRetries) {
        console.log(`[DeviceSetting] ⚠️ Empty result received for ${key} (possible transient failure) - will retry...`);
        retryCount++;
        continue;
      } else if (resultIsEmpty && retryCount >= maxRetries) {
        console.log(`[DeviceSetting] ⚠️ Empty result received for ${key} after ${maxRetries + 1} attempts (device may not support this setting)`);
        break;
      }
    }
    
    if (result?.result?.data) {
      console.log(`[DeviceSetting] Keys in result.data:`, Object.keys(result.result.data));
      Object.entries(result.result.data).forEach(([k, v]) => {
        console.log(`  - ${k}: ${JSON.stringify(v)} (type: ${typeof v})`);
      });
    }
    console.log(`${'='.repeat(80)}\n`);
    
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/setting/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Write device setting (for discovery / testing and curtailment control)
app.post('/api/device/setting/set', authenticateUser, async (req, res) => {
  let key, value;
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    key = req.body.key;
    value = req.body.value;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[DeviceSetting] SET REQUEST`);
    console.log(`  User: ${req.user.uid}`);
    console.log(`  Device SN: ${sn}`);
    console.log(`  Key: ${key}`);
    console.log(`  Value: ${value} (type: ${typeof value})`);
    
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    if (!key) return res.status(400).json({ errno: 400, error: 'Missing required parameter: key' });
    if (value === undefined || value === null) return res.status(400).json({ errno: 400, error: 'Missing required parameter: value' });
    
    console.log(`[DeviceSetting] Calling FoxESS API...`);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', { sn, key, value }, userConfig, req.user.uid);
    
    // 🔍 AGGRESSIVE DEBUG LOGGING
    console.log(`[DeviceSetting] SET RESPONSE:`);
    console.log(`  Full response:`, JSON.stringify(result, null, 2));
    console.log(`  errno:`, result?.errno);
    console.log(`  result:`, JSON.stringify(result?.result, null, 2));
    console.log(`  error:`, result?.error);
    console.log(`  msg:`, result?.msg);
    console.log(`${'='.repeat(80)}\n`);
    
    res.json(result);
  } catch (error) {
    console.error(`[DeviceSetting] SET ERROR for ${key}=${value}:`, error);
    console.log(`${'='.repeat(80)}\n`);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Device status check (diagnostic endpoint to verify device connectivity and API responsiveness)
app.get('/api/device/status/check', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    
    console.log(`[DeviceStatusCheck] Checking device status for SN: ${sn}`);
    
    // Try to fetch device list - this tells us if the API is responding and device is online
    const deviceListResult = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, userConfig, req.user.uid);
    
    let deviceFound = false;
    let deviceInfo = null;
    
    if (deviceListResult?.errno === 0 && deviceListResult?.result?.data?.length > 0) {
      const devices = deviceListResult.result.data;
      deviceInfo = devices.find(d => d.sn === sn);
      deviceFound = !!deviceInfo;
    }
    
    // Try to fetch real-time data - this verifies the device is actively reporting
    const realtimeResult = await foxessAPI.callFoxESSAPI(`/op/v0/device/real-time?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    
    const realtimeWorking = realtimeResult?.errno === 0 && realtimeResult?.result?.data;
    
    // Try to fetch a sample setting to verify settings API is working
    const settingResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key: 'ExportLimit' }, userConfig, req.user.uid);
    
    const settingResponseOk = settingResult?.errno === 0;
    const settingHasData = settingResult?.result && Object.keys(settingResult.result).length > 0;
    
    const potentialIssues = [];
    if (!deviceFound) potentialIssues.push('Device not found in device list - may be offline or using wrong SN');
    if (!realtimeWorking) potentialIssues.push('Real-time data API not responding - device may be offline');
    if (!settingResponseOk) potentialIssues.push('Settings API error - possible API issue with FoxESS');
    if (settingResponseOk && !settingHasData) potentialIssues.push('Settings API returned empty result - this setting may not be supported by your device');

    return res.json({
      errno: 0,
      result: {
        deviceSn: sn,
        deviceFound,
        deviceInfo: deviceInfo ? { sn: deviceInfo.sn, deviceName: deviceInfo.deviceName, deviceType: deviceInfo.deviceType } : null,
        realtimeWorking,
        settingResponseOk,
        settingHasData,
        diagnosticSummary: {
          apiResponsive: deviceListResult?.errno === 0,
          deviceOnline: deviceFound,
          realtimeDataAvailable: realtimeWorking,
          settingReadSupported: settingResponseOk && settingHasData,
          potentialIssues
        }
      }
    });
    
  } catch (error) {
    console.error('[API] /api/device/status/check error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Force charge time read
app.get('/api/device/battery/forceChargeTime/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const result = await foxessAPI.callFoxESSAPI(`/op/v0/device/battery/forceChargeTime/get?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/forceChargeTime/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Force charge time set
app.post('/api/device/battery/forceChargeTime/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const body = Object.assign({ sn }, req.body);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/battery/forceChargeTime/set', 'POST', body, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/battery/forceChargeTime/set error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// FoxESS: Get meter reader (legacy endpoint used by UI)
app.post('/api/device/getMeterReader', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const body = Object.assign({ sn }, req.body);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/getMeterReader', 'POST', body, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/getMeterReader error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Dedicated temperatures endpoint - returns only temperature-related variables
app.get('/api/inverter/temps', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    const variables = ['batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation'];
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/real/query', 'POST', { sn, variables }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/inverter/temps error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Device report (daily, monthly, yearly, hourly data)
app.get('/api/inverter/report', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    
    const dimension = req.query.dimension || 'month';
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    
    // FoxESS API dimensions:
    // 'year' = monthly data for the year (needs: year)
    // 'month' = daily data for the month (needs: year, month)
    const body = {
      sn,
      dimension,
      year,
      variables: ['generation', 'feedin', 'gridConsumption', 'chargeEnergyToTal', 'dischargeEnergyToTal']
    };
    
    // Add month for 'month' dimension
    if (dimension === 'month') {
      body.month = month;
    }
    
    console.log(`[API] /api/inverter/report - dimension: ${dimension}, body: ${JSON.stringify(body)}`);
    
    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/report/query', 'POST', body, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/inverter/report error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Device generation summary
app.get('/api/inverter/generation', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    
    // Get point-in-time generation data (today, month, cumulative)
    const genResult = await foxessAPI.callFoxESSAPI(`/op/v0/device/generation?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
    
    // Enhance with yearly data from report endpoint
    try {
      const year = new Date().getFullYear();
      // Try multiple variable names — AC-coupled systems may not report under 'generation'.
      // Priority: generation > generationPower > pvPower (pick first with non-zero sum)
      const reportVarCandidates = ['generation', 'generationPower', 'pvPower'];
      const reportBody = {
        sn,
        dimension: 'year',
        year,
        variables: reportVarCandidates
      };
      const reportResult = await foxessAPI.callFoxESSAPI('/op/v0/device/report/query', 'POST', reportBody, userConfig, req.user.uid);
      
      // Extract yearly generation from report — prefer first candidate with a non-zero sum
      if (reportResult.result && Array.isArray(reportResult.result) && reportResult.result.length > 0) {
        let yearGeneration = 0;
        for (const candidate of reportVarCandidates) {
          const varEntry = reportResult.result.find(v => v.variable === candidate);
          if (varEntry && Array.isArray(varEntry.values)) {
            const sum = varEntry.values.reduce((acc, val) => acc + (val || 0), 0);
            if (sum > 0) { yearGeneration = sum; break; }
          }
        }
        if (genResult.result && typeof genResult.result === 'object') {
          genResult.result.year = yearGeneration;
          genResult.result.yearGeneration = yearGeneration;
        }
      }
    } catch (reportError) {
      // Log but don't fail - report endpoint might not be available
      console.warn('[API] /api/inverter/generation - report endpoint failed:', reportError.message);
    }
    
    res.json(genResult);
  } catch (error) {
    console.error('[API] /api/inverter/generation error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== DIAGNOSTIC ENDPOINTS ====================

// Discover all available variables for a device (topology detection)
app.get('/api/inverter/discover-variables', authenticateUser, async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const deviceSN = req.query.sn || userConfig?.deviceSn;
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }

    console.log(`[Diagnostics] Discovering variables for device: ${deviceSN}`);
    
    // Call FoxESS API to get available variables
    const result = await foxessAPI.callFoxESSAPI(
      `/op/v0/device/variable/get?deviceSN=${encodeURIComponent(deviceSN)}`,
      'GET',
      null,
      userConfig,
      req.user.uid
    );

    console.log(`[Diagnostics] Variables discovered:`, result);
    res.json(result);
  } catch (error) {
    console.error('[Diagnostics] discover-variables error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get ALL real-time data (no variable filtering) for topology analysis
app.post('/api/inverter/all-data', authenticateUser, async (req, res) => {
  try {
    console.log(`[Diagnostics] all-data endpoint called by user: ${req.user.uid}`);
    
    const userConfig = await getUserConfig(req.user.uid);
    console.log(`[Diagnostics] User config loaded, deviceSn: ${userConfig?.deviceSn}`);
    
    const sn = req.body.sn || userConfig?.deviceSn;
    if (!sn) {
      console.error('[Diagnostics] No device SN found');
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }

    console.log(`[Diagnostics] Querying ALL variables for device: ${sn}`);
    
    // Use the comprehensive list of all available variables
    // Including PV, meter, battery, loads, grid, etc.
    const allVariables = [
      'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power',
      'meterPower', 'meterPower2', 'meterPowerR', 'meterPowerS', 'meterPowerT',
      'loadsPower', 'loadsPowerR', 'loadsPowerS', 'loadsPowerT',
      'generationPower', 'feedinPower', 'gridConsumptionPower',
      'batChargePower', 'batDischargePower', 'batVolt', 'batCurrent', 'SoC',
      'invBatVolt', 'invBatCurrent', 'invBatPower',
      'batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation', 'chargeTemperature',
      'RVolt', 'RCurrent', 'RFreq', 'RPower',
      'SVolt', 'SCurrent', 'SFreq', 'SPower',
      'TVolt', 'TCurrent', 'TFreq', 'TPower',
      'epsPower', 'epsVoltR', 'epsCurrentR', 'epsPowerR',
      'epsVoltS', 'epsCurrentS', 'epsPowerS',
      'epsVoltT', 'epsCurrentT', 'epsPowerT',
      'ReactivePower', 'PowerFactor', 'runningState', 'currentFault'
    ];

    const body = {
      sn,
      variables: allVariables
    };

    console.log(`[Diagnostics] Calling FoxESS API /op/v0/device/real/query with ${allVariables.length} variables`);
    
    const result = await foxessAPI.callFoxESSAPI(
      '/op/v0/device/real/query',
      'POST',
      body,
      userConfig,
      req.user.uid
    );

    console.log(`[Diagnostics] FoxESS API response errno: ${result.errno}, has result: ${!!result.result}`);
    
    if (result.errno !== 0) {
      console.warn(`[Diagnostics] FoxESS API returned error: ${result.errno} - ${result.msg || result.error}`);
      return res.json(result); // Return the error response as-is
    }

    // Add topology hints based on data
    if (result.result && Array.isArray(result.result)) {
      const datas = result.result[0]?.datas || [];
      const pvPower = datas.find(d => d.variable === 'pvPower')?.value || 0;
      const meterPower = datas.find(d => d.variable === 'meterPower')?.value || null;
      const meterPower2 = datas.find(d => d.variable === 'meterPower2')?.value || null;
      const batChargePower = datas.find(d => d.variable === 'batChargePower')?.value || 0;
      const gridConsumptionPower = datas.find(d => d.variable === 'gridConsumptionPower')?.value || 0;

      result.topologyHints = {
        pvPower,
        meterPower,
        meterPower2,
        batChargePower,
        gridConsumptionPower,
        likelyTopology: 
          (pvPower < 0.1 && (batChargePower > 0.5 || meterPower2 > 0.5) && gridConsumptionPower < 0.5)
            ? 'AC-coupled (external PV via meter)'
            : (pvPower > 0.5)
            ? 'DC-coupled (standard)'
            : 'Unknown (check during solar production hours)'
      };
    }

    console.log(`[Diagnostics] All data retrieved, topology hints:`, result.topologyHints);
    res.json(result);
  } catch (error) {
    console.error('[Diagnostics] all-data error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// EMS list
app.get('/api/ems/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/ems/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/ems/list error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Module list
app.get('/api/module/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/module/list', 'POST', { currentPage: 1, pageSize: 10, sn: userConfig?.deviceSn }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/module/list error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Module signal (requires moduleSN parameter)
app.get('/api/module/signal', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const moduleSN = req.query.moduleSN;
    
    if (!moduleSN) {
      return res.status(400).json({ errno: 400, error: 'moduleSN parameter is required' });
    }
    
    const result = await foxessAPI.callFoxESSAPI('/op/v0/module/getSignal', 'POST', { sn: moduleSN }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/module/signal error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Meter list
app.get('/api/meter/list', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const result = await foxessAPI.callFoxESSAPI('/op/v0/gw/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/meter/list error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get work mode setting (default active mode, not scheduler)
app.get('/api/device/workmode/get', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key: 'WorkMode' }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/workmode/get error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Set work mode setting (default active mode, not scheduler)
app.post('/api/device/workmode/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const sn = req.body.sn || userConfig?.deviceSn;
    const { workMode } = req.body;
    if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    if (!workMode) return res.status(400).json({ errno: 400, error: 'workMode is required (SelfUse, Feedin, Backup)' });

    // Map string work mode values to FoxESS numeric values
    const workModeMap = {
      'SelfUse': 0,
      'Feedin': 1,
      'FeedinFirst': 1,
      'Backup': 2,
      'PeakShaving': 3
    };

    const numericWorkMode = workModeMap[workMode];
    if (numericWorkMode === undefined) {
      return res.status(400).json({ 
        errno: 400, 
        error: `Invalid work mode: ${workMode}. Valid modes: SelfUse, Feedin, Backup, PeakShaving` 
      });
    }

    const result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', { sn, key: 'WorkMode', value: numericWorkMode }, userConfig, req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[API] /api/device/workmode/set error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// (Amber sites handler moved earlier to allow unauthenticated callers)
// (Amber prices handler moved earlier to allow unauthenticated callers)

// Weather endpoint
app.get('/api/weather', async (req, res) => {
  try {
    await tryAttachUser(req);
    const place = req.query.place || 'Sydney';
    const days = parseInt(req.query.days || '3', 10);
    const forceRefresh = req.query.forceRefresh === 'true' || req.query.force === 'true';
    const result = await getCachedWeatherData(req.user?.uid || 'anonymous', place, days, forceRefresh);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Scheduler endpoints
// IMPORTANT: Always fetch from the live FoxESS device to ensure UI matches actual device state
// (not from Firestore cache, which caused segments to appear saved but not sync to manufacturer app)
app.get('/api/scheduler/v1/get', async (req, res) => {
  try {
    await tryAttachUser(req);
    const userConfig = await getUserConfig(req.user?.uid);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      // No device SN configured - return sensible defaults
      const defaultGroups = Array.from({ length: 10 }).map((_unused, _i) => ({
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        enable: 0,
        workMode: 'SelfUse',
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      }));
      return res.json({ errno: 0, result: { groups: defaultGroups, enable: false }, source: 'defaults' });
    }
    
    // Always fetch live data from the device (this is what the manufacturer app sees)
    const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: sn }, userConfig, req.user?.uid);
    
    // Tag the source so debugging is easier
    if (result && result.errno === 0) {
      result.source = 'device';
    }
    
    res.json(result);
  } catch (error) {
    console.error('[Scheduler] GET error:', error.message);
    res.status(500).json({ errno: 500, error: error.message });
  }
});



app.post('/api/scheduler/v1/set', async (req, res) => {
  try {
    const userConfig = await getUserConfig(req.user.uid);
    const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;
    const groups = req.body.groups || [];
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    logger.debug('Scheduler', `SET request for device ${deviceSN}, ${groups.length} groups`);
    
    // Primary: v1 API (this is what backend server.js uses and it works)
    const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups }, userConfig, req.user.uid);

    // Determine if we should enable or disable the scheduler flag
    const shouldEnable = Array.isArray(groups) && groups.some(g => Number(g.enable) === 1);
    
    // Set scheduler flag (required for FoxESS app to show the schedule)
    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: shouldEnable ? 1 : 0 }, userConfig, req.user.uid);
    } catch (flagErr) {
      logger.warn('Scheduler', `Flag set failed: ${flagErr && flagErr.message ? flagErr.message : flagErr}`);
    }

    // Log action to history
    await addHistoryEntry(req.user.uid, {
      type: 'scheduler_update',
      action: 'manual',
      groups,
      result: result.errno === 0 ? 'success' : 'failed'
    });

    // Verification read: fetch what the device actually has now
    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, req.user.uid);
    } catch (e) { 
      logger.warn('Scheduler', `Verify read failed: ${e && e.message ? e.message : e}`);
    }

    // Return the result with verification data
    res.json({
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Success' : 'Failed'),
      result: result.result,
      flagResult,
      verify: verify?.result || null
    });
  } catch (error) {
    console.error('[Scheduler] SET error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== API METRICS (USER-SPECIFIC) ====================

/**
 * Increment API call count for a user
 */
// Helper: returns YYYY-MM-DD for specified timezone local date (handles DST)
function getDateKey(date = new Date(), timezone) {
  timezone = timezone || DEFAULT_TIMEZONE;
  return date.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
}

// Backward compatibility: getAusDateKey uses configured default timezone
function getAusDateKey(date = new Date()) {
  return getDateKey(date, DEFAULT_TIMEZONE);
}

async function incrementApiCount(userId, apiType) {
  // NOTE: Metrics date keys are computed using DEFAULT_TIMEZONE. If the server's default timezone
  // is changed, new metrics will be stored under different date keys. This is expected behavior.
  // Historical metrics from previous timezone settings will not be included in new rollover.
  const today = getAusDateKey(); // YYYY-MM-DD (DEFAULT_TIMEZONE)

  // Only update per-user metrics when we have a valid userId
  if (userId) {
    logger.debug('Metrics', `Incrementing ${apiType} counter for user ${userId} on ${today}`);
    const docRef = db.collection('users').doc(userId).collection('metrics').doc(today);
    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        const data = doc.exists ? doc.data() : { foxess: 0, amber: 0, weather: 0 };
        data[apiType] = (data[apiType] || 0) + 1;
        data.updatedAt = serverTimestamp();
        transaction.set(docRef, data, { merge: true });
        console.log(`[Metrics] ✓ Incremented ${apiType} to ${data[apiType]}`);
      });
    } catch (error) {
      console.error('Error incrementing API count:', error);
    }
  }
  
  // Also maintain an aggregated global daily metric so the UI (and non-authenticated callers)
  // can show platform-level API usage (mirrors backend `api_call_counts.json`).
  try {
    await incrementGlobalApiCount(apiType);
  } catch (e) {
    console.error('[Metrics] incrementGlobalApiCount error:', e && e.message ? e.message : e);
  }
}

// ==================== REINITIALIZE API MODULES ====================
// Now that all dependencies (logger, getConfig, incrementApiCount) are defined,
// reinitialize the API modules with proper dependencies
Object.assign(amberAPI, amberModule.init({
  db,
  logger,
  getConfig,
  incrementApiCount
}));

Object.assign(foxessAPI, foxessModule.init({
  db,
  logger,
  getConfig,
  incrementApiCount
}));

Object.assign(authAPI, authModule.init({
  admin,
  logger
}));

/**
 * Increment the global daily counters (top-level `metrics` collection)
 * This keeps a platform-wide view of API usage similar to the backend file-based counters.
 */
async function incrementGlobalApiCount(apiType) {
  try {
    const today = getAusDateKey(); // YYYY-MM-DD (Australia/Sydney)
    const docRef = db.collection('metrics').doc(today);

    await docRef.set({
      [apiType]: admin.firestore.FieldValue.increment(1),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('[Metrics] Failed to increment global count:', error && error.message ? error.message : error);
  }
}



// NOTE: 404 handler moved to the end of the file so all routes
// declared below (including scheduler user-scoped endpoints)
// are reachable. See end-of-file for the catch-all handler.

// ==================== SCHEDULER ENDPOINTS (USER-SCOPED) ====================
/**
 * Get scheduler segments for the authenticated user
 * Response: { errno: 0, result: { groups: [...], enable: boolean } }
 */


/**
 * Clear all scheduler segments (set to disabled / zeroed).
 * Sends directly to the device, same pattern as backend/server.js
 * Body: {}
 */
app.post('/api/scheduler/v1/clear-all', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    logger.debug('Scheduler', `CLEAR-ALL request for device ${deviceSN}`);

    // Create 8 empty/disabled segments (matching device's actual group count)
    const emptyGroups = [];
    for (let i = 0; i < 8; i++) {
      emptyGroups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0,
        startMinute: 0,
        endHour: 0,
        endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    
    // Send to device via v1 API (primary - this is what works in server.js)
    const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: emptyGroups }, userConfig, userId);
    
    // Disable the scheduler flag
    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
    } catch (flagErr) {
      logger.warn('Scheduler', `Flag disable failed: ${flagErr && flagErr.message ? flagErr.message : flagErr}`);
    }
    
    // Verification read
    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      logger.warn('Scheduler', `Verify read failed: ${e && e.message ? e.message : e}`);
    }
    
    // Log to history
    try {
      await db.collection('users').doc(userId).collection('history').add({
        type: 'scheduler_clear',
        by: userId,
        timestamp: serverTimestamp()
      });
    } catch (e) { console.warn('[Scheduler] Failed to write history entry:', e && e.message); }

    res.json({ 
      errno: result.errno, 
      msg: result.msg || (result.errno === 0 ? 'Scheduler cleared' : 'Failed'),
      result: result.result,
      flagResult,
      verify: verify?.result || null
    });
  } catch (err) {
    console.error('[Scheduler] clear-all error:', err.message || err);
    res.status(500).json({ errno: 500, error: err.message || String(err) });
  }
});

// ==================== TESLA INTEGRATION (WIP - Restricted Access) ====================
// Initialize Tesla API module
const teslaModule = require('./api/tesla');
const teslaAPI = teslaModule.init({
  db,
  logger
});

// Middleware to restrict Tesla routes to specific user
const restrictToTeslaUser = (req, res, next) => {
  const allowedEmail = 'sardanapalos928@hotmail.com';
  
  if (!req.user || req.user.email !== allowedEmail) {
    return res.status(403).json({ 
      errno: 403, 
      error: 'Access denied. Tesla integration is currently restricted to authorized users.' 
    });
  }
  
  next();
};

// Save Tesla tokens
app.post('/api/tesla/save-tokens', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { accessToken, refreshToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ errno: 400, error: 'Access token is required' });
    }
    
    await teslaAPI.saveUserTokens(req.user.uid, accessToken, refreshToken);
    res.json({ errno: 0, msg: 'Tokens saved successfully' });
  } catch (error) {
    console.error('[Tesla] save-tokens error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Test authentication
app.get('/api/tesla/test-auth', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    // Just try to list vehicles as a test
    const result = await teslaAPI.listVehicles(req.user.uid);
    
    if (result.errno === 0) {
      res.json({ errno: 0, result: { message: 'Authentication successful', vehicleCount: result.result?.vehicles?.length || 0 } });
    } else {
      res.json({ errno: result.errno, error: result.error });
    }
  } catch (error) {
    console.error('[Tesla] test-auth error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Register partner account (required once per region)
app.post('/api/tesla/register-partner', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const result = await teslaAPI.registerPartner(userId);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] register-partner error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// List vehicles
app.get('/api/tesla/vehicles', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const result = await teslaAPI.listVehicles(req.user.uid);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] list-vehicles error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get vehicle data (use sparingly)
app.get('/api/tesla/vehicles/:vehicleTag/data', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTag } = req.params;
    const result = await teslaAPI.getVehicleData(req.user.uid, vehicleTag);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] get-vehicle-data error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Wake vehicle
app.post('/api/tesla/vehicles/:vehicleTag/wake', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTag } = req.params;
    const result = await teslaAPI.wakeVehicle(req.user.uid, vehicleTag);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] wake-vehicle error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Check fleet status
app.post('/api/tesla/fleet-status', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTags } = req.body;
    const result = await teslaAPI.checkFleetStatus(req.user.uid, vehicleTags);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] fleet-status error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Start charging
app.post('/api/tesla/vehicles/:vehicleTag/charge/start', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTag } = req.params;
    logger.debug('Tesla', `User ${req.user.uid} starting charge on vehicle ${vehicleTag}`);
    const result = await teslaAPI.startCharging(req.user.uid, vehicleTag);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] start-charging error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Stop charging
app.post('/api/tesla/vehicles/:vehicleTag/charge/stop', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTag } = req.params;
    logger.debug('Tesla', `User ${req.user.uid} stopping charge on vehicle ${vehicleTag}`);
    const result = await teslaAPI.stopCharging(req.user.uid, vehicleTag);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] stop-charging error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Set charging amps
app.post('/api/tesla/vehicles/:vehicleTag/charge/set-amps', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTag } = req.params;
    const { amps } = req.body;
    
    if (typeof amps !== 'number' || amps < 5 || amps > 32) {
      return res.status(400).json({ errno: 400, error: 'Amps must be a number between 5 and 32' });
    }
    
    logger.debug('Tesla', `User ${req.user.uid} setting ${amps}A on vehicle ${vehicleTag}`);
    const result = await teslaAPI.setChargingAmps(req.user.uid, vehicleTag, amps);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] set-amps error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Set charge limit
app.post('/api/tesla/vehicles/:vehicleTag/charge/set-limit', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { vehicleTag } = req.params;
    const { percent } = req.body;
    
    if (typeof percent !== 'number' || percent < 50 || percent > 100) {
      return res.status(400).json({ errno: 400, error: 'Charge limit must be a number between 50 and 100' });
    }
    
    logger.debug('Tesla', `User ${req.user.uid} setting charge limit to ${percent}% on vehicle ${vehicleTag}`);
    const result = await teslaAPI.setChargeLimit(req.user.uid, vehicleTag, percent);
    res.json(result);
  } catch (error) {
    console.error('[Tesla] set-limit error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== TESLA ADMIN CONFIGURATION ====================

// Get Tesla server configuration
// Check if user has their own Tesla OAuth credentials configured
app.get('/api/tesla/check-config', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('[Tesla] check-config: checking user credentials for user =', userId);
    
    try {
      const teslaDoc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
      
      if (teslaDoc.exists && teslaDoc.data()) {
        const data = teslaDoc.data();
        const hasClientId = !!data.clientId;
        const hasClientSecret = !!data.clientSecret;
        console.log('[Tesla] check-config: user has credentials -', { hasClientId, hasClientSecret });
        
        return res.json({ 
          errno: 0, 
          result: {
            configured: hasClientId && hasClientSecret,
            hasClientId,
            hasClientSecret
          }
        });
      }
    } catch (err) {
      console.warn('[Tesla] check-config: Error reading user config -', err.message);
    }
    
    // No credentials found
    res.json({ 
      errno: 0, 
      result: {
        configured: false,
        hasClientId: false,
        hasClientSecret: false
      }
    });
  } catch (error) {
    console.error('[Tesla] check-config error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get user's stored Tesla OAuth app credentials
app.get('/api/tesla/get-config', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('[Tesla] get-config: retrieving credentials for user =', userId);
    
    try {
      const teslaDoc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
      
      if (teslaDoc.exists && teslaDoc.data()) {
        const data = teslaDoc.data();
        logger.debug('Tesla', 'get-config: user credentials retrieved');
        
        return res.json({ 
          errno: 0, 
          result: {
            clientId: data.clientId || null,
            clientSecret: data.clientSecret || null,
            accessToken: data.accessToken || null,
            refreshToken: data.refreshToken || null,
            hasClientId: !!data.clientId,
            hasClientSecret: !!data.clientSecret,
            hasAccessToken: !!data.accessToken,
            hasRefreshToken: !!data.refreshToken
          }
        });
      }
    } catch (err) {
      console.warn('[Tesla] get-config: Error reading user config -', err.message);
    }
    
    // No credentials found
    res.json({ 
      errno: 0, 
      result: {
        clientId: null,
        clientSecret: null,
        accessToken: null,
        refreshToken: null,
        hasClientId: false,
        hasClientSecret: false,
        hasAccessToken: false,
        hasRefreshToken: false
      }
    });
  } catch (error) {
    console.error('[Tesla] get-config error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Save user's Tesla OAuth app credentials (client_id and client_secret)
app.post('/api/tesla/save-credentials', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;
    const userId = req.user.uid;
    
    if (!clientId || typeof clientId !== 'string' || clientId.trim().length === 0) {
      return res.status(400).json({ errno: 400, error: 'clientId is required and must be a non-empty string' });
    }
    
    if (!clientSecret || typeof clientSecret !== 'string' || clientSecret.trim().length === 0) {
      return res.status(400).json({ errno: 400, error: 'clientSecret is required and must be a non-empty string' });
    }
    
    try {
      await teslaAPI.saveUserCredentials(userId, clientId, clientSecret);
      logger.debug('Tesla', `OAuth credentials saved for user ${userId}`);
      res.json({ errno: 0, result: { success: true }, msg: 'Credentials saved successfully' });
    } catch (saveError) {
      console.error('[Tesla] Failed to save credentials:', saveError);
      res.status(500).json({ errno: 500, error: 'Failed to save credentials: ' + saveError.message });
    }
  } catch (error) {
    console.error('[Tesla] save-credentials error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Get shared public key for Tesla Fleet API registration
app.get('/api/tesla/public-key', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const privateKey = await teslaAPI.getSharedPrivateKey();
    
    if (!privateKey) {
      return res.status(500).json({ 
        errno: 500, 
        error: 'Shared signing key not configured on server. Contact administrator.' 
      });
    }
    
    try {
      // Derive public key from private key
      const crypto = require('crypto');
      const keyObject = crypto.createPrivateKey(privateKey);
      const publicKey = crypto.createPublicKey(keyObject);
      const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
      
      res.json({ 
        errno: 0, 
        result: { publicKey: publicKeyPem },
        msg: 'Public key is deployed at /.well-known/appspecific/com.tesla.3p.public-key.pem'
      });
    } catch (cryptoError) {
      console.error('[Tesla] Failed to derive public key:', cryptoError);
      res.status(500).json({ errno: 500, error: 'Failed to derive public key: ' + cryptoError.message });
    }
  } catch (error) {
    console.error('[Tesla] public-key error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Check user's Tesla connection status
app.get('/api/tesla/status', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const teslaDoc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
    
    if (!teslaDoc.exists) {
      return res.json({ 
        errno: 0, 
        result: { 
          connected: false 
        }
      });
    }
    
    try {
      const data = teslaDoc.data() || {};
      const hasTokens = !!(data.accessToken && data.refreshToken);
      
      // Check global partner registration status
      let partnerRegistered = false;
      try {
        const sharedDoc = await db.collection('shared').doc('config').get();
        if (sharedDoc.exists && sharedDoc.data().teslaPartnerRegistered) {
          partnerRegistered = true;
        }
      } catch (sharedError) {
        console.warn('[Tesla] Error checking shared config:', sharedError.message);
      }
      
      res.json({ 
        errno: 0, 
        result: {
          connected: hasTokens,
          partnerRegistered,
          connectedAt: data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt) : null,
          expiresAt: data.expiresAt ? (data.expiresAt.toDate ? data.expiresAt.toDate().toISOString() : data.expiresAt) : null
        }
      });
    } catch (dataError) {
      console.warn('[Tesla] Error reading tesla doc data:', dataError);
      res.json({ 
        errno: 0, 
        result: { 
          connected: false 
        }
      });
    }
  } catch (error) {
    console.error('[Tesla] status error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Disconnect Tesla account (remove stored tokens)
app.post('/api/tesla/disconnect', authenticateUser, restrictToTeslaUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    await db.collection('users').doc(userId).collection('config').doc('tesla').delete();
    
    logger.debug('Tesla', `User ${userId} disconnected Tesla account`);
    res.json({ 
      errno: 0, 
      result: { success: true }
    });
  } catch (error) {
    console.error('[Tesla] disconnect error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== EXPORT EXPRESS APP AS CLOUD FUNCTION ====================
// Use the broadly-compatible onRequest export to avoid depending on newer SDK features
exports.api = functions.https.onRequest(app);

// Export for testing
if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
  exports.app = app; // Export Express app for supertest
  exports.getAmberCacheTTL = amberAPI.getAmberCacheTTL;
  exports.getCachedAmberPricesCurrent = amberAPI.getCachedAmberPricesCurrent;
  exports.getConfig = getConfig;
}

// ==================== SCHEDULED AUTOMATION ====================
/**
 * Scheduled automation is handled by the backend server.js in 1st Gen
 * Cloud Functions here only provides the API proxy and per-user endpoints
 */

/**
 * Evaluate a single automation rule - checks ALL conditions
 * ALL enabled conditions must be met for the rule to trigger
 */
async function evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig, _skipCooldown = false) {
  // _skipCooldown: if true, we skip the cooldown check (used for re-evaluating active rules)
  const conditions = rule.conditions || {};
  const enabledConditions = [];
  const results = [];
  
  // Get user's timezone from config, fallback to Sydney
  const userTimezone = getAutomationTimezone(userConfig);
  const userTime = getUserTime(userTimezone);
  const currentMinutes = userTime.hour * 60 + userTime.minute;
  
  logger.debug('Automation', `Evaluating rule '${rule.name}' in timezone ${userTimezone} (${String(userTime.hour).padStart(2,'0')}:${String(userTime.minute).padStart(2,'0')})`);
  
  // Parse inverter data
  let soc = null;
  let batTemp = null;
  let ambientTemp = null;
  if (inverterData?.result?.[0]?.datas) {
    const datas = inverterData.result[0].datas;
    const socData = datas.find(d => d.variable === 'SoC');
    const batTempData = datas.find(d => d.variable === 'batTemperature');
    const ambientTempData = datas.find(d => d.variable === 'ambientTemperation');
    soc = socData?.value ?? null;
    batTemp = batTempData?.value ?? null;
    ambientTemp = ambientTempData?.value ?? null;
  }
  
  // Parse Amber prices
  let feedInPrice = null;
  let buyPrice = null;
  if (Array.isArray(cache.amber)) {
    const feedInInterval = cache.amber.find(ch => ch.channelType === 'feedIn' && ch.type === 'CurrentInterval');
    const generalInterval = cache.amber.find(ch => ch.channelType === 'general' && ch.type === 'CurrentInterval');
    if (feedInInterval) feedInPrice = -feedInInterval.perKwh; // Convert to positive (what you earn)
    if (generalInterval) buyPrice = generalInterval.perKwh;
  }
  
  logger.debug('Automation', `Evaluating rule '${rule.name}' - Live data: SoC=${soc}%, BatTemp=${batTemp}°C, FeedIn=${feedInPrice?.toFixed(1)}¢, Buy=${buyPrice?.toFixed(1)}¢`);
  
  // Check SoC condition (support both 'op' and 'operator' field names)
  if (conditions.soc?.enabled) {
    enabledConditions.push('soc');
    if (soc !== null) {
      const operator = conditions.soc.op || conditions.soc.operator;
      const value = conditions.soc.value;
      const value2 = conditions.soc.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = soc >= value && soc <= value2;
      } else {
        met = compareValue(soc, operator, value);
      }
      results.push({ condition: 'soc', met, actual: soc, operator, target: value });
      if (!met) {
        logger.debug('Automation', `Rule '${rule.name}' - SoC condition NOT met: ${soc} ${operator} ${value} = false`);
      }
    } else {
      results.push({ condition: 'soc', met: false, reason: 'No SoC data' });
      logger.debug('Automation', `Rule '${rule.name}' - SoC condition NOT met: No SoC data available`);
    }
  }
  
  // Check price condition (support both 'price' and 'feedInPrice/buyPrice' formats)
  // Frontend saves as conditions.price with 'type' field (feedIn or buy)
  const priceCondition = conditions.price;
  if (priceCondition?.enabled && priceCondition?.type) {
    const priceType = priceCondition.type; // 'feedIn' or 'buy'
    const actualPrice = priceType === 'feedIn' ? feedInPrice : buyPrice;
    enabledConditions.push('price');
    if (actualPrice !== null) {
      const operator = priceCondition.op || priceCondition.operator;
      const value = priceCondition.value;
      const value2 = priceCondition.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = actualPrice >= value && actualPrice <= value2;
      } else {
        met = compareValue(actualPrice, operator, value);
      }
      results.push({ condition: 'price', met, actual: actualPrice, operator, target: value, type: priceType });
      if (!met) {
        logger.debug('Automation', `Rule '${rule.name}' - Price (${priceType}) condition NOT met: actual=${actualPrice} (type: ${typeof actualPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${actualPrice} ${operator} ${value} = false`);
      } else {
        logger.debug('Automation', `Rule '${rule.name}' - Price (${priceType}) condition MET: ${actualPrice} ${operator} ${value} = true`);
      }
    } else {
      results.push({ condition: 'price', met: false, reason: 'No Amber price data' });
      logger.debug('Automation', `Rule '${rule.name}' - Price condition NOT met: No Amber data available`);
    }
  }
  
  // Legacy: Check feed-in price condition (for old format rules)
  if (conditions.feedInPrice?.enabled) {
    enabledConditions.push('feedInPrice');
    if (feedInPrice !== null) {
      const operator = conditions.feedInPrice.op || conditions.feedInPrice.operator;
      const value = conditions.feedInPrice.value;
      const value2 = conditions.feedInPrice.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = feedInPrice >= value && feedInPrice <= value2;
      } else {
        met = compareValue(feedInPrice, operator, value);
      }
      results.push({ condition: 'feedInPrice', met, actual: feedInPrice, operator, target: value });
      if (!met) {
        logger.debug('Automation', `Rule '${rule.name}' - FeedIn condition NOT met: actual=${feedInPrice} (type: ${typeof feedInPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${feedInPrice} ${operator} ${value} = false`);
      } else {
        logger.debug('Automation', `Rule '${rule.name}' - FeedIn condition MET: ${feedInPrice} ${operator} ${value} = true`);
      }
    } else {
      results.push({ condition: 'feedInPrice', met: false, reason: 'No Amber data' });
      logger.debug('Automation', `Rule '${rule.name}' - FeedIn condition NOT met: No Amber data available`);
    }
  }
  
  // Check buy price condition
  if (conditions.buyPrice?.enabled) {
    enabledConditions.push('buyPrice');
    if (buyPrice !== null) {
      const operator = conditions.buyPrice.op || conditions.buyPrice.operator;
      const value = conditions.buyPrice.value;
      const value2 = conditions.buyPrice.value2;
      let met = false;
      if (operator === 'between' && value2 !== undefined) {
        met = buyPrice >= value && buyPrice <= value2;
      } else {
        met = compareValue(buyPrice, operator, value);
      }
      results.push({ condition: 'buyPrice', met, actual: buyPrice, operator, target: value });
      if (!met) {
        logger.debug('Automation', `Rule '${rule.name}' - BuyPrice condition NOT met: actual=${buyPrice} (type: ${typeof buyPrice}), target=${value} (type: ${typeof value}), operator=${operator}, result: ${buyPrice} ${operator} ${value} = false`);
      } else {
        logger.debug('Automation', `Rule '${rule.name}' - BuyPrice condition MET: ${buyPrice} ${operator} ${value} = true`);
      }
    } else {
      results.push({ condition: 'buyPrice', met: false, reason: 'No Amber data' });
      logger.debug('Automation', `Rule '${rule.name}' - BuyPrice condition NOT met: No Amber data available`);
    }
  }
  
  // Check temperature condition (support both 'temp' and 'temperature' with 'op' and 'operator')
  const tempCondition = conditions.temp || conditions.temperature;
  if (tempCondition?.enabled) {
    enabledConditions.push('temperature');
    const tempType = tempCondition.type || 'battery';
    const actualTemp = tempType === 'battery' ? batTemp : ambientTemp;
    if (actualTemp !== null) {
      const operator = tempCondition.op || tempCondition.operator;
      const value = tempCondition.value;
      const met = compareValue(actualTemp, operator, value);
      results.push({ condition: 'temperature', met, actual: actualTemp, operator, target: value, type: tempType });
      if (!met) {
        logger.debug('Automation', `Rule '${rule.name}' - Temperature condition NOT met: ${actualTemp} ${operator} ${value} = false`);
      }
    } else {
      results.push({ condition: 'temperature', met: false, reason: `No ${tempType} temperature data` });
      logger.debug('Automation', `Rule '${rule.name}' - Temperature condition NOT met: No ${tempType} temp data available`);
    }
  }
  
  // Check time window condition
  const timeCondition = conditions.time || conditions.timeWindow;
  if (timeCondition?.enabled) {
    enabledConditions.push('time');
    const startTime = timeCondition.startTime || timeCondition.start || '00:00';
    const endTime = timeCondition.endTime || timeCondition.end || '23:59';
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    
    let met = false;
    // Handle windows that cross midnight
    if (startMins <= endMins) {
      met = currentMinutes >= startMins && currentMinutes < endMins;
    } else {
      met = currentMinutes >= startMins || currentMinutes < endMins;
    }
    results.push({ condition: 'time', met, actual: `${userTime.hour}:${String(userTime.minute).padStart(2,'0')}`, window: `${startTime}-${endTime}` });
    if (!met) {
      logger.debug('Automation', `Rule '${rule.name}' - Time condition NOT met: ${userTime.hour}:${String(userTime.minute).padStart(2,'0')} not in ${startTime}-${endTime}`);
    }
  }
  
  /**
   * Find the starting hour index in weather hourly data for timezone-aware time comparison
   * Open-Meteo returns times like "2025-12-17T00:00" in the user's timezone (no Z suffix)
   * This function correctly matches current local time to the hourly array
   */
  function findWeatherStartIndex(hourlyTimes, weatherTz = 'Australia/Sydney') {
    if (!hourlyTimes || hourlyTimes.length === 0) return 0;
    
    // Get current time in the weather's timezone
    const userLocalTime = new Date().toLocaleString('en-AU', { timeZone: weatherTz, hour12: false });
    const [userDatePart, userTimePart] = userLocalTime.split(', ');
    const [userHour, userMinute] = userTimePart.split(':').slice(0, 2).map(Number);
    const [userDay, userMonth, userYear] = userDatePart.split('/').map(Number);
    
    // Current time as comparison strings
    const currentHourStr = `${String(userHour).padStart(2, '0')}:${String(userMinute).padStart(2, '0')}`;
    const currentDateStr = `${userYear}-${String(userMonth).padStart(2, '0')}-${String(userDay).padStart(2, '0')}`;
    
    // Find first hour that's in the future (or current hour if no future)
    let startIdx = 0;
    for (let i = 0; i < hourlyTimes.length; i++) {
      const timeStr = hourlyTimes[i]; // e.g., "2025-12-17T00:00"
      const [dateOnly, timeOnly] = timeStr.split('T');
      
      // If this hour's date is after today, use this index
      if (dateOnly > currentDateStr) {
        startIdx = i;
        break;
      } else if (dateOnly === currentDateStr) {
        // Same day - use this hour if it's in the future
        if (timeOnly > currentHourStr) {
          startIdx = i;
          break;
        }
        // Otherwise keep searching
      }
      // If dateOnly < currentDateStr, this hour is in the past, keep going
    }
    
    return startIdx;
  }
  
  // Check solar radiation condition (new separate condition)
  if (conditions.solarRadiation?.enabled) {
    enabledConditions.push('solarRadiation');
    const weatherData = cache.weather;
    const hourly = weatherData?.result?.hourly || weatherData?.hourly;
    
    if (hourly?.shortwave_radiation && hourly?.time) {
      // Support lookAheadUnit: hours or days
      const lookAheadUnit = conditions.solarRadiation.lookAheadUnit || 'hours';
      const lookAheadValue = conditions.solarRadiation.lookAhead || 6;
      const lookAheadHours = lookAheadUnit === 'days' ? lookAheadValue * 24 : lookAheadValue;
      
      const threshold = conditions.solarRadiation.value || 200; // W/m² default
      const operator = conditions.solarRadiation.operator || '>';
      const checkType = conditions.solarRadiation.checkType || 'average';
      
      // Get timezone-aware starting index
      const forecastTz = weatherData?.result?.place?.timezone || 'Australia/Sydney';
      const startIdx = findWeatherStartIndex(hourly.time, forecastTz);
      
      // Get radiation values for next N hours (starting from current/next hour)
      const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
      const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
      const hoursRequested = lookAheadHours;
      const hoursRetrieved = radiationValues.length;
      
      if (radiationValues.length > 0) {
        let actualValue;
        if (checkType === 'min') {
          actualValue = Math.min(...radiationValues);
        } else if (checkType === 'max') {
          actualValue = Math.max(...radiationValues);
        } else {
          actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
        }
        
        const met = compareValue(actualValue, operator, threshold);
        const lookAheadDisplay = lookAheadUnit === 'days' ? `${lookAheadValue}d` : `${lookAheadValue}h`;
        
        // Warn if we got fewer hours than requested (incomplete timeframe)
        const hasIncompleteData = hoursRetrieved < hoursRequested;
        if (hasIncompleteData) {
          console.warn(`[Automation] Rule '${rule.name}' - Solar radiation: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
        }
        
        results.push({ 
          condition: 'solarRadiation', 
          met, 
          actual: (actualValue !== undefined && actualValue !== null) ? actualValue.toFixed(0) : '0', 
          operator,
          target: threshold,
          unit: 'W/m²',
          lookAhead: lookAheadDisplay,
          checkType,
          hoursChecked: radiationValues.length,
          hoursRequested,
          incomplete: hasIncompleteData
        });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - Solar radiation NOT met: ${checkType} ${actualValue?.toFixed(0)} W/m² ${operator} ${threshold} W/m²`);
        }
      } else {
        results.push({ condition: 'solarRadiation', met: false, reason: 'No radiation data for timeframe' });
      }
    } else {
      results.push({ condition: 'solarRadiation', met: false, reason: 'No hourly radiation data' });
    }
  }
  
  // Check cloud cover condition (new separate condition)
  if (conditions.cloudCover?.enabled) {
    enabledConditions.push('cloudCover');
    const weatherData = cache.weather;
    const hourly = weatherData?.result?.hourly || weatherData?.hourly;
    
    if (hourly?.cloudcover && hourly?.time) {
      // Support lookAheadUnit: hours or days
      const lookAheadUnit = conditions.cloudCover.lookAheadUnit || 'hours';
      const lookAheadValue = conditions.cloudCover.lookAhead || 6;
      const lookAheadHours = lookAheadUnit === 'days' ? lookAheadValue * 24 : lookAheadValue;
      
      const threshold = conditions.cloudCover.value || 50; // % default
      const operator = conditions.cloudCover.operator || '<';
      const checkType = conditions.cloudCover.checkType || 'average';
      
      // Get timezone-aware starting index
      const forecastTz = weatherData?.result?.place?.timezone || 'Australia/Sydney';
      const startIdx = findWeatherStartIndex(hourly.time, forecastTz);
      
      const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
      const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
      const hoursRequested = lookAheadHours;
      const hoursRetrieved = cloudValues.length;
      
      if (cloudValues.length > 0) {
        let actualValue;
        if (checkType === 'min') {
          actualValue = Math.min(...cloudValues);
        } else if (checkType === 'max') {
          actualValue = Math.max(...cloudValues);
        } else {
          actualValue = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
        }
        
        const met = compareValue(actualValue, operator, threshold);
        const lookAheadDisplay = lookAheadUnit === 'days' ? `${lookAheadValue}d` : `${lookAheadValue}h`;
        
        // Warn if we got fewer hours than requested (incomplete timeframe)
        const hasIncompleteData = hoursRetrieved < hoursRequested;
        if (hasIncompleteData) {
          console.warn(`[Automation] Rule '${rule.name}' - Cloud cover: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
        }
        
        results.push({ 
          condition: 'cloudCover', 
          met, 
          actual: (actualValue !== undefined && actualValue !== null) ? actualValue.toFixed(0) : '0', 
          operator,
          target: threshold,
          unit: '%',
          lookAhead: lookAheadDisplay,
          checkType,
          hoursChecked: cloudValues.length,
          hoursRequested,
          incomplete: hasIncompleteData
        });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - Cloud cover NOT met: ${checkType} ${actualValue?.toFixed(0)}% ${operator} ${threshold}%`);
        }
      } else {
        results.push({ condition: 'cloudCover', met: false, reason: 'No cloud cover data' });
      }
    } else {
      results.push({ condition: 'cloudCover', met: false, reason: 'No hourly cloud data' });
    }
  }
  
  // Legacy weather condition (for backward compatibility with old rules)
  if (conditions.weather?.enabled) {
    enabledConditions.push('weather');
    const weatherData = cache.weather;
    
    // Check if this is an old-style radiation/cloudcover rule (migrate to new format)
    if (conditions.weather.type === 'radiation' || conditions.weather.radiationEnabled ||
        conditions.weather.type === 'solar' || conditions.weather.type === 'cloudcover') {
      // This is a legacy rule using the old weather.type format - evaluate it for compatibility
      if (conditions.weather.type === 'solar' || conditions.weather.type === 'radiation' || conditions.weather.radiationEnabled) {
        const hourly = weatherData?.result?.hourly || weatherData?.hourly;
        if (hourly?.shortwave_radiation && hourly?.time) {
          const lookAheadHours = conditions.weather.radiationHours || conditions.weather.lookAheadHours || 6;
          const threshold = conditions.weather.radiationThreshold || 200;
          const rawOp = conditions.weather.radiationOp || '>';
          // Parse operator from combined string like 'avg>' or simple '>'
          const operator = rawOp.replace('avg', '').replace('min', '').replace('max', '') || '>';
          const checkType = rawOp.includes('min') ? 'min' : rawOp.includes('max') ? 'max' : 'average';
          
          const now = new Date();
          const currentHour = now.getHours();
          let startIdx = 0;
          for (let i = 0; i < hourly.time.length; i++) {
            const t = new Date(hourly.time[i]);
            if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
              startIdx = i;
              break;
            }
          }
          
          const endIdx = Math.min(startIdx + lookAheadHours, hourly.shortwave_radiation.length);
          const radiationValues = hourly.shortwave_radiation.slice(startIdx, endIdx);
          
          if (radiationValues.length > 0) {
            let actualValue;
            if (checkType === 'min') actualValue = Math.min(...radiationValues);
            else if (checkType === 'max') actualValue = Math.max(...radiationValues);
            else actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
            
            const met = compareValue(actualValue, operator, threshold);
            results.push({ condition: 'weather', met, type: 'radiation', actual: actualValue?.toFixed(0), operator, target: threshold, unit: 'W/m²', legacy: true });
          } else {
            results.push({ condition: 'weather', met: false, reason: 'No radiation data' });
          }
        } else {
          results.push({ condition: 'weather', met: false, reason: 'No hourly data' });
        }
      } else if (conditions.weather.type === 'cloudcover') {
        const hourly = weatherData?.result?.hourly || weatherData?.hourly;
        if (hourly?.cloudcover && hourly?.time) {
          const lookAheadHours = conditions.weather.cloudcoverHours || conditions.weather.lookAheadHours || 6;
          const threshold = conditions.weather.cloudcoverThreshold || 50;
          const rawOp = conditions.weather.cloudcoverOp || '<';
          const operator = rawOp.replace('avg', '').replace('min', '').replace('max', '') || '<';
          const checkType = rawOp.includes('min') ? 'min' : rawOp.includes('max') ? 'max' : 'average';
          
          // Get timezone-aware starting index
          const forecastTz = weatherData?.result?.place?.timezone || 'Australia/Sydney';
          const startIdx = findWeatherStartIndex(hourly.time, forecastTz);
          
          const endIdx = Math.min(startIdx + lookAheadHours, hourly.cloudcover.length);
          const cloudValues = hourly.cloudcover.slice(startIdx, endIdx);
          
          if (cloudValues.length > 0) {
            let actualValue;
            if (checkType === 'min') actualValue = Math.min(...cloudValues);
            else if (checkType === 'max') actualValue = Math.max(...cloudValues);
            else actualValue = cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length;
            
            const met = compareValue(actualValue, operator, threshold);
            results.push({ condition: 'weather', met, type: 'cloudcover', actual: (actualValue !== undefined && actualValue !== null) ? actualValue.toFixed(0) : '0', operator, target: threshold, unit: '%', legacy: true });
          } else {
            results.push({ condition: 'weather', met: false, reason: 'No cloud data' });
          }
        } else {
          results.push({ condition: 'weather', met: false, reason: 'No hourly data' });
        }
      }
    }
    // Legacy weathercode-based condition (sunny/cloudy/rainy)
    else if (weatherData?.current_weather) {
      const currentCode = weatherData.current_weather.weathercode;
      const weatherType = conditions.weather.condition || conditions.weather.type || 'any';
      
      let met = false;
      if (weatherType === 'any') {
        met = true;
      } else if (weatherType === 'sunny' || weatherType === 'clear') {
        met = currentCode <= 1;
      } else if (weatherType === 'cloudy') {
        met = currentCode >= 2 && currentCode <= 48;
      } else if (weatherType === 'rainy') {
        met = currentCode >= 51;
      }
      
      const codeDesc = currentCode <= 1 ? 'Clear' : currentCode <= 3 ? 'Partly Cloudy' : currentCode <= 48 ? 'Cloudy/Fog' : currentCode <= 67 ? 'Rain' : 'Storm';
      results.push({ condition: 'weather', met, type: 'weathercode', actual: codeDesc, target: weatherType, weatherCode: currentCode, legacy: true });
    } else {
      results.push({ condition: 'weather', met: false, reason: 'No weather data' });
    }
  }
  
  // Check forecast price condition (future amber prices - supports minutes, hours, or days)
  if (conditions.forecastPrice?.enabled) {
    enabledConditions.push('forecastPrice');
    const amberData = cache.amber;
    if (Array.isArray(amberData)) {
      const priceType = conditions.forecastPrice.type || 'general'; // 'general' (buy) or 'feedIn'
      const channelType = priceType === 'feedIn' ? 'feedIn' : 'general';
      
      // Support different time units: minutes (default), hours, days
      const lookAheadUnit = conditions.forecastPrice.lookAheadUnit || 'minutes';
      let lookAheadMinutes;
      if (lookAheadUnit === 'days') {
        lookAheadMinutes = (conditions.forecastPrice.lookAhead || 1) * 24 * 60;
      } else if (lookAheadUnit === 'hours') {
        lookAheadMinutes = (conditions.forecastPrice.lookAhead || 1) * 60;
      } else {
        lookAheadMinutes = conditions.forecastPrice.lookAhead || 30;
      }
      
      const intervalsNeeded = Math.ceil(lookAheadMinutes / 5); // 5-min intervals
      
      // Get forecast intervals for the specified channel, sorted by time
      const forecasts = amberData.filter(p => p.channelType === channelType && p.type === 'ForecastInterval');
      
      // CRITICAL FIX: Filter by time window (now to now + lookAheadMinutes) instead of just taking first N
      const now = new Date();
      const cutoffTime = new Date(now.getTime() + lookAheadMinutes * 60 * 1000);
      
      // Filter for intervals that fall within [now, cutoffTime]
      // startTime <= cutoffTime (ends before/at cutoff) and endTime >= now (starts before/at now)
      const relevantForecasts = forecasts.filter(f => {
        const startTime = new Date(f.startTime);
        const endTime = new Date(f.endTime || startTime.getTime() + 5 * 60 * 1000);
        // Include if interval overlaps with our window
        return startTime <= cutoffTime && endTime >= now;
      }).slice(0, intervalsNeeded); // Still limit to intervalsNeeded in case of overlap
      
      // LOG: Show what forecast data we have
      console.log(`[ForecastPrice] Rule '${rule.name}' - Type: ${priceType}, CheckType: ${conditions.forecastPrice.checkType || 'average'}`);
      console.log(`[ForecastPrice] Requested: ${lookAheadMinutes} minutes (${intervalsNeeded} intervals)`);
      console.log(`[ForecastPrice] Found ${forecasts.length} total forecast intervals in Amber data`);
      console.log(`[ForecastPrice] Filtered to ${relevantForecasts.length} intervals in time window [now -> +${lookAheadMinutes}min]`);
      if (forecasts.length > 0) {
        const firstTime = new Date(forecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        const lastTime = new Date(forecasts[forecasts.length - 1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        console.log(`[ForecastPrice] Available data time range: ${firstTime} to ${lastTime}`);
        // Show first 5 prices to see what we're working with
        const firstPrices = forecasts.slice(0, 5).map(f => `${new Date(f.startTime).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Australia/Sydney'})}=${(priceType === 'feedIn' ? -f.perKwh : f.perKwh).toFixed(1)}¢`);
        console.log(`[ForecastPrice] First 5 prices (all data): ${firstPrices.join(', ')}`);
      }
      if (relevantForecasts.length > 0) {
        const relevantFirst = new Date(relevantForecasts[0].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        const relevantLast = new Date(relevantForecasts[relevantForecasts.length-1].startTime).toLocaleTimeString('en-AU', {hour12:false, timeZone:'Australia/Sydney'});
        console.log(`[ForecastPrice] Relevant time range (filtered): ${relevantFirst} to ${relevantLast}`);
      }
      
      // Check if we got fewer intervals than requested (Amber API limit is ~12 intervals = 1 hour)
      const intervalsActuallyAvailable = forecasts.length;
      const hasIncompleteData = relevantForecasts.length < intervalsNeeded;
      
      if (hasIncompleteData && intervalsActuallyAvailable < intervalsNeeded) {
        console.warn(`[Automation] Rule '${rule.name}' - Forecast ${priceType}: Only ${relevantForecasts.length} intervals in time window, requested ${intervalsNeeded}`);
      }
      
      if (relevantForecasts.length > 0) {
        // Calculate average or check specific criteria
        const checkType = conditions.forecastPrice.checkType || 'average'; // 'average', 'min', 'max', 'any'
        const prices = relevantForecasts.map(f => priceType === 'feedIn' ? -f.perKwh : f.perKwh);
        
        // LOG: Show all prices being considered
        console.log(`[ForecastPrice] Evaluating ${relevantForecasts.length} intervals, prices: ${prices.map(p => p.toFixed(1)).join(', ')}`);
        
        let actualValue;
        if (checkType === 'min') {
          actualValue = Math.min(...prices);
        } else if (checkType === 'max') {
          actualValue = Math.max(...prices);
        } else if (checkType === 'any') {
          actualValue = prices.find(p => compareValue(p, conditions.forecastPrice.operator, conditions.forecastPrice.value));
        } else {
          actualValue = prices.reduce((a, b) => a + b, 0) / prices.length; // average
        }
        
        console.log(`[ForecastPrice] Calculated ${checkType}: ${actualValue?.toFixed(1)}¢ (comparing ${conditions.forecastPrice.operator} ${conditions.forecastPrice.value}¢)`);

        
        const operator = conditions.forecastPrice.operator;
        const value = conditions.forecastPrice.value;
        const met = checkType === 'any' ? actualValue !== undefined : compareValue(actualValue, operator, value);
        
        // Format lookAhead for display
        const lookAheadDisplay = lookAheadUnit === 'days' 
          ? `${conditions.forecastPrice.lookAhead}d`
          : lookAheadUnit === 'hours'
          ? `${conditions.forecastPrice.lookAhead}h`
          : `${conditions.forecastPrice.lookAhead}m`;
        
        results.push({ 
          condition: 'forecastPrice', 
          met, 
          actual: actualValue?.toFixed(1), 
          operator, 
          target: value, 
          type: priceType, 
          lookAhead: lookAheadDisplay,
          lookAheadMinutes,
          checkType,
          intervalsChecked: relevantForecasts.length,
          intervalsAvailable: forecasts.length,
          incomplete: hasIncompleteData
        });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - Forecast ${priceType} condition NOT met: ${checkType} ${actualValue?.toFixed(1)}¢ ${operator} ${value}¢ (${lookAheadDisplay})`);
        }
      } else {
        results.push({ condition: 'forecastPrice', met: false, reason: 'No forecast data' });
        logger.debug('Automation', `Rule '${rule.name}' - Forecast price condition NOT met: No forecast data available`);
      }
    } else {
      results.push({ condition: 'forecastPrice', met: false, reason: 'No Amber data' });
      logger.debug('Automation', `Rule '${rule.name}' - Forecast price condition NOT met: No Amber data available`);
    }
  }
  
  // Determine if all conditions are met
  const allMet = results.length > 0 && results.every(r => r.met);
  
  if (enabledConditions.length === 0) {
    logger.debug('Automation', `Rule '${rule.name}' - No conditions enabled, skipping`);
    return { triggered: false, reason: 'No conditions enabled', feedInPrice, buyPrice };
  }
  
  if (allMet) {
    logger.debug('Automation', `Rule '${rule.name}' - ALL ${enabledConditions.length} conditions MET!`);
    return { triggered: true, results, feedInPrice, buyPrice };
  }
  
  logger.debug('Automation', `Rule '${rule.name}' - Not all conditions met (${results.filter(r => r.met).length}/${results.length})`);
  return { triggered: false, results, feedInPrice, buyPrice };
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
    case 'between':
      // For "between" operator, target should be an object with min/max or an array [min, max]
      if (Array.isArray(target)) return actual >= target[0] && actual <= target[1];
      if (target && typeof target === 'object') return actual >= (target.min || 0) && actual <= (target.max || 100);
      return false;
    default: return false;
  }
}

/**
 * Helper to get Sydney time components
 */
/**
 * Get current time in specified timezone
 * @param {string} timezone - IANA timezone (e.g., 'America/New_York', 'Europe/London', 'Australia/Sydney')
 * @returns {Object} Time components { hour, minute, second, day, month, year, dayOfWeek }
 */
function getUserTime(timezone) {
  timezone = timezone || DEFAULT_TIMEZONE;
  const now = new Date();
  const timeStr = now.toLocaleString('en-AU', { timeZone: timezone, hour12: false });
  // Parse "DD/MM/YYYY, HH:MM:SS" format
  const [datePart, timePart] = timeStr.split(', ');
  const [day, month, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  // IMPORTANT: Some Node.js/ICU versions return hour "24" for midnight instead of "00"
  // Normalize to 0-23 range for FoxESS API compatibility
  const parsedHour = parseInt(hour, 10);
  const normalizedHour = parsedHour === 24 ? 0 : parsedHour;
  return {
    hour: normalizedHour,
    minute: parseInt(minute, 10),
    second: parseInt(second, 10),
    day: parseInt(day, 10),
    month: parseInt(month, 10),
    year: parseInt(year, 10),
    dayOfWeek: now.getDay(), // 0 = Sunday, 6 = Saturday
    timezone: timezone
  };
}

/**
 * Helper to add minutes to a time
 */
function addMinutes(hour, minute, addMins) {
  const totalMins = hour * 60 + minute + addMins;
  return {
    hour: Math.floor(totalMins / 60) % 24,
    minute: totalMins % 60
  };
}

/**
 * Apply a rule's action - creates/updates scheduler segment on device
 * Uses the same v1 API pattern as the manual scheduler endpoints
 */
async function applyRuleAction(userId, rule, userConfig) {
  console.log(`[SegmentSend] ========== START applyRuleAction for '${rule.name}' ==========`);
  const action = rule.action || {};
  const deviceSN = userConfig?.deviceSn;
  
  if (!deviceSN) {
    console.error(`[SegmentSend] ❌ CRITICAL: No deviceSN configured for user ${userId}`);
    return { errno: -1, msg: 'No device SN configured' };
  }
  
  console.log(`[SegmentSend] 🎯 Target device: ${deviceSN}`);
  console.log(`[SegmentSend] 📋 Action config:`, JSON.stringify(action, null, 2));
  
  // Get user's timezone from config (or configured default)
  const userTimezone = getAutomationTimezone(userConfig);
  const tzSource = userConfig?.timezone ? 'config' : 'default';
  logger.debug('Automation', `Using timezone: ${userTimezone} (source: ${tzSource})`);
  
  // Get current time in user's timezone
  const userTime = getUserTime(userTimezone);
  const startHour = userTime.hour;
  const startMinute = userTime.minute;
  
  // Calculate end time based on duration
  const durationMins = action.durationMinutes || 30;
  const endTimeObj = addMinutes(startHour, startMinute, durationMins);
  let endHour = endTimeObj.hour;
  let endMinute = endTimeObj.minute;
  
  // CRITICAL FIX: FoxESS does NOT support segments that cross midnight (00:00)
  // If the calculated end time is earlier than start time (wrapped around), cap at 23:59
  const startTotalMins = startHour * 60 + startMinute;
  const endTotalMins = endHour * 60 + endMinute;
  
  if (endTotalMins <= startTotalMins) {
    // Segment would cross midnight - cap at 23:59 instead
    console.warn(`[SegmentSend] ⚠️ MIDNIGHT CROSSING DETECTED: Original end time ${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} would cross midnight`);
    endHour = 23;
    endMinute = 59;
    const actualDuration = (endHour * 60 + endMinute) - startTotalMins;
    console.warn(`[SegmentSend] 🔧 CAPPED at 23:59 - Reduced duration from ${durationMins}min to ${actualDuration}min to respect FoxESS constraint`);
  }
  
  logger.debug('Automation', `Creating segment: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')} - ${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} (${durationMins}min requested)`);
  
  // Get current scheduler from device (v1 API)
  let currentGroups = [];
  try {
    const currentScheduler = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    if (currentScheduler.errno === 0 && currentScheduler.result?.groups) {
      currentGroups = JSON.parse(JSON.stringify(currentScheduler.result.groups)); // Deep copy
      logger.debug('Automation', `Got ${currentGroups.length} groups from device`);
    }
  } catch (e) {
    console.warn('[Automation] Failed to get current scheduler:', e && e.message ? e.message : e);
  }
  
  // Ensure we have at least one group (don't pad to 10 - use device's actual count)
  if (currentGroups.length === 0) {
    currentGroups.push({
      enable: 0,
      workMode: 'SelfUse',
      startHour: 0, startMinute: 0,
      endHour: 0, endMinute: 0,
      minSocOnGrid: 10,
      fdSoc: 10,
      fdPwr: 0,
      maxSoc: 100
    });
  }
  
  // Clear all existing enabled segments (same as backend server.js does)
  // This avoids FoxESS reordering issues and ensures clean state
  let clearedCount = 0;
  currentGroups.forEach((group, idx) => {
    if (group.enable === 1 || group.startHour !== 0 || group.startMinute !== 0 || group.endHour !== 0 || group.endMinute !== 0) {
      currentGroups[idx] = {
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      };
      clearedCount++;
    }
  });
  if (clearedCount > 0) {
    logger.debug('Automation', `Cleared ${clearedCount} existing segment(s)`);
  }
  
  // Final validation: Ensure end time is after start time (no midnight crossing)
  const startTotalMinsCheck = startHour * 60 + startMinute;
  const endTotalMinsCheck = endHour * 60 + endMinute;
  if (endTotalMinsCheck <= startTotalMinsCheck) {
    console.error(`[SegmentSend] ❌ CRITICAL: Final validation failed - end time ${endHour}:${String(endMinute).padStart(2,'0')} is not after start time ${startHour}:${String(startMinute).padStart(2,'0')}`);
    throw new Error(`Invalid segment: end time must be after start time (no midnight crossing allowed by FoxESS)`);
  }
  
  // Build the new segment (V1 flat structure)
  const segment = {
    enable: 1,
    workMode: action.workMode || 'SelfUse',
    startHour,
    startMinute,
    endHour,
    endMinute,
    minSocOnGrid: action.minSocOnGrid ?? 20,
    fdSoc: action.fdSoc ?? 35,
    fdPwr: action.fdPwr ?? 0,
    maxSoc: action.maxSoc ?? 90
  };
  
  // Always use Group 1 (index 0) for automation - clean slate approach
  currentGroups[0] = segment;
  console.log(`[SegmentSend] 📦 Final segment prepared for Group 1:`, JSON.stringify(segment, null, 2));
  console.log(`[SegmentSend] 📊 Total groups to send: ${currentGroups.length}`);
  
  console.log(`[SegmentSend] 🚀 Sending segment: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')}-${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} ${segment.workMode} fdSoc=${segment.fdSoc}`);
  
  // Send to device via v1 API with retry logic (up to 3 attempts)
  let applyAttempt = 0;
  let result = null;
  console.log(`[SegmentSend] 🔄 Starting API call with up to 3 retry attempts...`);
  while (applyAttempt < 3) {
    applyAttempt++;
    console.log(`[SegmentSend] 📡 Attempt ${applyAttempt}/3: Calling FoxESS /op/v1/device/scheduler/enable...`);
    const callStart = Date.now();
    result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: currentGroups }, userConfig, userId);
    const callDuration = Date.now() - callStart;
    console.log(`[SegmentSend] ⏱️ API call completed in ${callDuration}ms`);
    console.log(`[SegmentSend] 📥 Response: errno=${result?.errno}, msg=${result?.msg}`);
    
    if (result?.errno === 0) {
      console.log(`[SegmentSend] ✅ Segment sent successfully (attempt ${applyAttempt})`);
      break;
    } else {
      console.error(`[SegmentSend] ❌ Attempt ${applyAttempt} FAILED: errno=${result?.errno}, msg=${result?.msg}`);
      if (applyAttempt < 3) {
        console.log(`[SegmentSend] ⏳ Waiting 1200ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
  }
  
  if (result?.errno !== 0) {
    console.error(`[SegmentSend] 🚨 CRITICAL FAILURE: Segment failed after 3 attempts`);
    console.error(`[SegmentSend] 💥 Final error: errno=${result?.errno}, msg=${result?.msg}`);
    console.error(`[SegmentSend] 📦 Failed segment details:`, JSON.stringify(segment, null, 2));
    console.log(`[SegmentSend] ========== END applyRuleAction (FAILED) ==========`);
    return {
      errno: result?.errno || -1,
      msg: result?.msg || 'Failed to apply segment after 3 retry attempts',
      segment,
      flagResult: null,
      verify: null,
      retrysFailed: true
    };
  }
  
  // Set the scheduler flag to enabled (required for FoxESS app to show schedule)
  console.log(`[SegmentSend] 🚩 Setting scheduler flag to ENABLED...`);
  let flagResult = null;
  let flagAttempt = 0;
  while (flagAttempt < 2) {
    flagAttempt++;
    try {
      console.log(`[SegmentSend] 📡 Flag attempt ${flagAttempt}/2: Calling /op/v1/device/scheduler/set/flag...`);
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 1 }, userConfig, userId);
      console.log(`[SegmentSend] 📥 Flag response: errno=${flagResult?.errno}, msg=${flagResult?.msg}`);
      if (flagResult?.errno === 0) {
        console.log(`[SegmentSend] ✅ Scheduler flag set successfully (attempt ${flagAttempt})`);
        break;
      } else {
        console.error(`[SegmentSend] ❌ Flag set attempt ${flagAttempt} failed: errno=${flagResult?.errno}`);
      }
    } catch (flagErr) {
      console.error(`[SegmentSend] ❌ Flag set exception:`, flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    if (flagAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  
  // Wait 3 seconds for FoxESS to process the request before verification
  // Extended from 2s to 3s for better reliability
  console.log(`[SegmentSend] ⏳ Waiting 3000ms for FoxESS device to process segment...`);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Verification read to confirm device accepted the segment (with retry)
  console.log(`[SegmentSend] 🔍 Starting verification read to confirm segment on device...`);
  let verify = null;
  let verifyAttempt = 0;
  while (verifyAttempt < 2) {
    verifyAttempt++;
    try {
      console.log(`[SegmentSend] 📡 Verify attempt ${verifyAttempt}/2: Calling /op/v1/device/scheduler/get...`);
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
      console.log(`[SegmentSend] 📥 Verify response: errno=${verify?.errno}, groups=${verify?.result?.groups?.length || 0}`);
      if (verify?.errno === 0) {
        console.log(`[SegmentSend] ✅ Verification read successful (attempt ${verifyAttempt})`);
        if (verify?.result?.groups?.[0]) {
          console.log(`[SegmentSend] 📊 Group 0 on device:`, JSON.stringify(verify.result.groups[0], null, 2));
        }
        break;
      } else {
        console.error(`[SegmentSend] ❌ Verification read attempt ${verifyAttempt} failed: errno=${verify?.errno}`);
      }
    } catch (verifyErr) {
      console.error(`[SegmentSend] ❌ Verification read exception:`, verifyErr.message);
    }
    if (verifyAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (verify?.result?.groups?.[0]) {
    const deviceSegment = verify.result.groups[0];
    if (deviceSegment.enable === 1) {
      console.log(`[SegmentSend] ✅ Segment CONFIRMED ENABLED on device!`);
      console.log(`[SegmentSend] 🎉 Device segment: ${deviceSegment.startHour}:${deviceSegment.startMinute}-${deviceSegment.endHour}:${deviceSegment.endMinute} ${deviceSegment.workMode}`);
    } else {
      console.warn(`[SegmentSend] ⚠️ Segment on device but DISABLED (enable=${deviceSegment.enable})`);
    }
  } else {
    console.warn(`[SegmentSend] ⚠️ No verification data available for Group 0`);
  }
  console.log(`[SegmentSend] ========== END applyRuleAction (SUCCESS) ==========`);
  console.log(`[SegmentSend] 🏁 Final result: errno=0, segment sent and verified`);
  
  // Log to user history
  try {
    await addHistoryEntry(userId, {
      type: 'automation_action',
      ruleName: rule.name,
      action,
      segment,
      result: result.errno === 0 ? 'success' : 'failed',
      timestamp: serverTimestamp()
    });
  } catch (e) {
    console.warn('[Automation] Failed to log history:', e && e.message ? e.message : e);
  }
  
  return {
    errno: result.errno,
    msg: result.msg || (result.errno === 0 ? 'Segment applied' : 'Failed'),
    segment,
    flagResult,
    verify: verify?.result || null,
    retrysFailed: false
  };
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
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
      createdAt: serverTimestamp()
    }, { merge: true });
    
    // Create default automation state
    await db.collection('users').doc(userId).collection('automation').doc('state').set({
      enabled: false, // Disabled by default until user configures
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    }, { merge: true });
    
    logger.info('Auth', `User ${userId} initialized successfully`, true);
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
    logger.info('Auth', `Cleaning up user: ${userId}`, true);
    
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
    
    logger.info('Auth', `User ${userId} data cleaned up successfully`, true);
    res.json({ errno: 0, msg: 'User data deleted' });
  } catch (error) {
    console.error(`[Auth] Error cleaning up user:`, error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// ==================== INVERTER HISTORY ENDPOINT ====================
/**
 * Get inverter history data from FoxESS API
 * Handles large date ranges by splitting into 24-hour chunks
 * Caches results in Firestore to reduce API calls
 */
app.get('/api/inverter/history', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    let begin = Number(req.query.begin);
    let end = Number(req.query.end);

    const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

    if (!Number.isFinite(begin)) begin = Date.now() - DEFAULT_RANGE_MS;
    if (!Number.isFinite(end)) end = Date.now();

    // Normalize to milliseconds (FoxESS expects ms)
    if (begin < 1e12) begin *= 1000;
    if (end < 1e12) end *= 1000;

    begin = Math.floor(begin);
    end = Math.floor(end);
    
    
    // Set a strict timeout for the FoxESS call
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timeout')), 9000)
    );
    
    try {
      const MAX_RANGE_MS = 24 * 60 * 60 * 1000; // 24 hours per FoxESS request

      // If the requested window is small, call FoxESS once. For larger windows, split into chunks and merge results.
      if ((end - begin) <= MAX_RANGE_MS) {
        // Check cache first
        const cachedResult = await getHistoryFromCacheFirestore(userId, sn, begin, end);
        if (cachedResult) {
          return res.json(cachedResult);
        }
        
        const result = await Promise.race([
          foxessAPI.callFoxESSAPI('/op/v0/device/history/query', 'POST', {
            sn,
            begin,
            end,
            variables: ['generationPower', 'pvPower', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower']
          }, userConfig, userId),
          timeoutPromise
        ]);
        
        // Cache successful response
        if (result && result.errno === 0) {
          await setHistoryToCacheFirestore(userId, sn, begin, end, result).catch(e => console.warn('[History] Cache write failed:', e.message));
        }
        
        return res.json(result);
      }

      // Build chunk ranges
      const chunks = [];
      let cursor = begin;
      while (cursor < end) {
        const chunkEnd = Math.min(end, cursor + MAX_RANGE_MS - 1);
        chunks.push({ cbeg: cursor, cend: chunkEnd });
        cursor = chunkEnd + 1;
      }

      // Aggregate results per variable
      const aggMap = {}; // variable -> array of {time, value}
      let deviceSN = sn;

      for (const ch of chunks) {
        // Check cache for this chunk
        let chunkResp = await getHistoryFromCacheFirestore(userId, sn, ch.cbeg, ch.cend);
        if (!chunkResp) {
          chunkResp = await foxessAPI.callFoxESSAPI('/op/v0/device/history/query', 'POST', {
            sn,
            begin: ch.cbeg,
            end: ch.cend,
            variables: ['generationPower', 'pvPower', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower']
          }, userConfig, userId);
          
          // Cache successful chunk response
          if (chunkResp && chunkResp.errno === 0) {
            await setHistoryToCacheFirestore(userId, sn, ch.cbeg, ch.cend, chunkResp).catch(e => console.warn('[History] Cache write failed:', e.message));
          }
        }

        if (!chunkResp || chunkResp.errno !== 0) {
          // Bubble up the upstream error
          const errMsg = chunkResp && chunkResp.msg ? chunkResp.msg : 'Unknown FoxESS error';
          console.warn(`[History] FoxESS chunk error for ${new Date(ch.cbeg).toISOString()} - ${new Date(ch.cend).toISOString()}: ${errMsg}`);
          return res.status(500).json({ errno: chunkResp?.errno || 500, msg: `FoxESS API error: ${errMsg}` });
        }

        const r = Array.isArray(chunkResp.result) && chunkResp.result[0] ? chunkResp.result[0] : null;
        if (!r) continue;
        deviceSN = r.deviceSN || deviceSN;

        const datas = Array.isArray(r.datas) ? r.datas : [];
        for (const item of datas) {
          const variable = item.variable || item.name || 'unknown';
          if (!Array.isArray(item.data)) continue;
          if (!aggMap[variable]) aggMap[variable] = [];
          // Append all points (chunks are non-overlapping)
          aggMap[variable].push(...item.data);
        }

        // Small delay to be kind to upstream when many chunks requested
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Merge & dedupe per-variable by time, then sort chronologically
      const mergedDatas = [];
      for (const [variable, points] of Object.entries(aggMap)) {
        const mapByTime = new Map();
        for (const p of points) {
          // Use the time string prefix (YYYY-MM-DD HH:MM:SS) as key when available
          const tKey = (typeof p.time === 'string' && p.time.length >= 19) ? p.time.substr(0, 19) : String(p.time);
          mapByTime.set(tKey, p);
        }
        // Convert back to array and sort by key (YYYY-MM-DD HH:MM:SS sorts lexicographically)
        const merged = Array.from(mapByTime.values()).sort((a, b) => {
          const ta = (typeof a.time === 'string' ? a.time.substr(0,19) : String(a.time));
          const tb = (typeof b.time === 'string' ? b.time.substr(0,19) : String(b.time));
          return ta < tb ? -1 : (ta > tb ? 1 : 0);
        });
        mergedDatas.push({ unit: 'kW', data: merged, name: variable, variable });
      }

      return res.json({ errno: 0, msg: 'Operation successful', result: [{ datas: mergedDatas, deviceSN }] });
    } catch (apiError) {
      console.warn(`[History] API error: ${apiError.message}`);
      res.status(500).json({ errno: 500, msg: `FoxESS API error: ${apiError.message}` });
    }
  } catch (error) {
    console.error(`[History] Request error: ${error.message}`);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

/**
 * Get inverter history from Firestore cache
 * Cache TTL: 30 minutes
 */
async function getHistoryFromCacheFirestore(userId, sn, begin, end) {
  try {
    const cacheKey = `history_${sn}_${begin}_${end}`;
    const docRef = db.collection('users').doc(userId).collection('cache').doc(cacheKey);
    const doc = await docRef.get();
    
    if (doc.exists) {
      const entry = doc.data();
      const ttl = 30 * 60 * 1000; // 30 minutes
      if (entry.timestamp && (Date.now() - entry.timestamp) < ttl) {
        return entry.data;
      }
      // Delete expired entry
      await docRef.delete().catch(() => {});
    }
    return null;
  } catch (error) {
    console.warn('[History] Cache get error:', error.message);
    return null;
  }
}

/**
 * Set inverter history to Firestore cache
 */
async function setHistoryToCacheFirestore(userId, sn, begin, end, data) {
  try {
    const cacheKey = `history_${sn}_${begin}_${end}`;
    const docRef = db.collection('users').doc(userId).collection('cache').doc(cacheKey);
    await docRef.set({
      timestamp: Date.now(),
      data: data,
      ttl: Math.floor(Date.now() / 1000) + (30 * 60) // Firestore TTL in seconds (30 min from now)
    });
  } catch (error) {
    console.warn('[History] Cache set error:', error.message);
    // Don't throw - cache is optional
  }
}

// ==================== 404 HANDLER ====================
// Catch-all for undefined routes to prevent HTML responses
app.use((req, res) => {
  res.status(404).json({ errno: 404, error: 'Endpoint not found' });
});
// ==================== CLOUD SCHEDULER: BACKGROUND AUTOMATION ====================
/**
 * Cloud Scheduler trigger: Orchestrates background automation for all users.
 * 
 * RESPECTS ALL BACKEND CONFIGURATION:
 * ✅ Uses getConfig().automation.intervalMs for cycle frequency (default 60000ms)
 * ✅ Uses getConfig().automation.cacheTtl for all API cache TTL
 * ✅ Respects per-user config: automation.intervalMs, automation.inverterCacheTtlMs
 * ✅ Checks lastCheck timestamp - only runs cycle if enough time elapsed
 * ✅ Uses existing cache functions: getCachedInverterData, getCachedWeatherData, callAmberAPI
 * ✅ Reuses POST /api/automation/cycle endpoint logic - zero duplication
 * ✅ Respects blackout windows, enabled state, all rule conditions
 * 
 * HOW IT WORKS:
 * 1. Runs every 1 minute (Cloud Scheduler frequency - can be more frequent than user cycles)
 * 2. For each user: checks if (now - lastCheck) >= userIntervalMs
 * 3. If yes: triggers automation cycle by calling the endpoint logic
 * 4. Endpoint handles ALL the work (cache, evaluation, segments, counters)
 */
// Run automation handler logic as a standalone function so tests and different
// firebase-functions versions can wire it up appropriately.
async function runAutomationHandler(_context) {
  const schedulerStartTime = Date.now();
  const schedId = `${schedulerStartTime}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[Scheduler] ========== Background check ${schedId} START ==========`);
  
  try {
    // Get server config for default interval
    const serverConfig = getConfig();
    const defaultIntervalMs = serverConfig.automation.intervalMs; // Respects backend config!
    
    // OPTIMIZATION: Query only users with automation enabled (pre-filtered via automationEnabled flag)
    // This avoids loading state+config for every registered user on each scheduler tick
    let usersSnapshot = await db.collection('users').where('automationEnabled', '==', true).get();
    
    if (usersSnapshot.size === 0) {
      // SELF-HEALING MIGRATION: Scan all users for automation state that hasn't been synced
      // This handles existing users who had automation enabled before the pre-filtering flag was added
      console.log(`[Scheduler] No pre-filtered users found — running migration scan...`);
      const allUsersSnapshot = await db.collection('users').get();
      let migratedCount = 0;
      
      const migrationChecks = allUsersSnapshot.docs.map(async (userDoc) => {
        try {
          const stateDoc = await db.collection('users').doc(userDoc.id)
            .collection('automation').doc('state').get();
          if (stateDoc.exists && stateDoc.data()?.enabled === true) {
            // Found a user with automation enabled but missing the parent flag — migrate them
            await db.collection('users').doc(userDoc.id).set(
              { automationEnabled: true },
              { merge: true }
            );
            console.log(`[Scheduler] Migrated user ${userDoc.id}: set automationEnabled=true`);
            migratedCount++;
          }
        } catch (err) {
          console.error(`[Scheduler] Migration check failed for ${userDoc.id}:`, err.message);
        }
      });
      await Promise.all(migrationChecks);
      
      if (migratedCount === 0) {
        console.log(`[Scheduler] Migration scan complete — no enabled users found, skipping`);
        return null;
      }
      
      console.log(`[Scheduler] Migration complete — ${migratedCount} user(s) migrated, re-querying...`);
      // Re-query to get the now-migrated users
      usersSnapshot = await db.collection('users').where('automationEnabled', '==', true).get();
    }
    
    const totalEnabled = usersSnapshot.size;
    
    // Load state and config for enabled users in parallel
    const userPromises = usersSnapshot.docs.map(async (userDoc) => {
      const userId = userDoc.id;
      try {
        const state = await getUserAutomationState(userId);
        const userConfig = await getUserConfig(userId);
        
        return {
          userId,
          state,
          userConfig,
          ready: state && state.enabled === true && userConfig?.deviceSn
        };
      } catch (err) {
        return { userId, error: err.message, ready: false };
      }
    });

    const userDataAll = await Promise.all(userPromises);
    
    // Filter candidates that need cycles (have device, interval elapsed)
    const cycleCandidates = [];
    let skippedDisabled = 0;
    let skippedTooSoon = 0;

    const now = Date.now();
    for (const userData of userDataAll) {
      if (!userData.ready) {
        skippedDisabled++;
        continue;
      }

      const { userId, state, userConfig } = userData;
      const userIntervalMs = userConfig?.automation?.intervalMs || defaultIntervalMs;
      const lastCheck = state?.lastCheck || 0;
      const elapsed = now - lastCheck;

      if (elapsed < userIntervalMs) {
        skippedTooSoon++;
        continue;
      }

      // OPTIMIZATION: Check blackout window EARLY (before expensive cycle call)
      const userRules = await getUserRules(userId);
      const blackoutWindows = userRules?.blackoutWindows || [];
      
      // Check if currently in blackout
      let inBlackout = false;
      if (blackoutWindows && blackoutWindows.length > 0) {
        const userTz = userConfig?.timezone || 'UTC';
        const userNow = getTimeInTimezone(userTz);
        const dayOfWeek = userNow.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
        const currentTime = userNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

        for (const window of blackoutWindows) {
          if (window.enabled === false) continue; // Skip explicitly disabled windows
          
          const applicableDays = window.days || [];
          if (applicableDays.length === 0 || applicableDays.includes(dayOfWeek)) {
            if (isTimeInRange(currentTime, window.start, window.end)) {
              inBlackout = true;
              break;
            }
          }
        }
      }

      if (inBlackout) {
        skippedDisabled++; // Count as skipped (though technically in blackout)
        continue;
      }

      cycleCandidates.push({ userId, state, userConfig });
    }

    // OPTIMIZATION: Run all candidate cycles in parallel (Promise.all)
    let cyclesRun = 0;
    let errors = 0;

    if (cycleCandidates.length > 0) {
      const cyclePromises = cycleCandidates.map(async (candidate) => {
        const { userId } = candidate;
        const userStartTime = Date.now();

        try {
          // Trigger cycle via existing route handler
          const mockReq = { user: { uid: userId }, body: {}, headers: {}, get: () => null };
          let cycleResult = null;
          const mockRes = { json: (data) => { cycleResult = data; return mockRes; }, status: () => mockRes, send: () => mockRes };

          const route = app._router.stack.find(layer => layer.route && layer.route.path === '/api/automation/cycle' && layer.route.methods.post);
          if (route && route.route.stack[0]) {
            await route.route.stack[0].handle(mockReq, mockRes);
            
            const userDuration = Date.now() - userStartTime;
            
            if (cycleResult) {
              if (cycleResult.errno === 0) {
                const r = cycleResult.result;
                if (r?.triggered) {
                  console.log(`[Scheduler] User ${userId}: ✅ Rule '${r.rule?.name}' triggered (${userDuration}ms)`);
                  return { success: true };
                } else if (r?.skipped) {
                  console.log(`[Scheduler] User ${userId}: ⏭️ Skipped: ${r.reason} (${userDuration}ms)`);
                  return { success: true };
                }
              } else {
                console.error(`[Scheduler] User ${userId}: ❌ Error: ${cycleResult.error} (${userDuration}ms)`);
                return { success: false };
              }
            }
          } else {
            console.error(`[Scheduler] User ${userId}: ❌ No route found`);
            return { success: false };
          }

          return { success: true };
        } catch (userErr) {
          console.error(`[Scheduler] User ${userId}: Exception: ${userErr.message}`);
          return { success: false };
        }
      });

      const cycleResults = await Promise.all(cyclePromises);
      cyclesRun = cycleResults.filter(r => r.success).length;
      errors = cycleResults.filter(r => !r.success).length;
    }

    const duration = Date.now() - schedulerStartTime;
    console.log(`[Scheduler] ========== Background check ${schedId} COMPLETE ==========`);
    console.log(`[Scheduler] ${totalEnabled} enabled users: ${cyclesRun} cycles, ${skippedTooSoon} too soon, ${skippedDisabled} skipped, ${errors} errors (${duration}ms)`);

    return null;

  } catch (fatal) {
    console.error(`[Scheduler] FATAL:`, fatal);
    throw fatal;
  }
}

// ==================== EXPORT CLOUD SCHEDULER FUNCTION ====================
// Scheduler for background automation (runs every 1 minute via Cloud Scheduler)
// For firebase-functions v7+ (2nd gen), we use functions.scheduler
const { onSchedule } = require('firebase-functions/v2/scheduler');

// Simple schedule without advanced options for CLI compatibility
exports.runAutomation = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'UTC'
  },
  runAutomationHandler
);


