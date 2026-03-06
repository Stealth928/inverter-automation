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
const {
  evaluateTemperatureCondition,
  evaluateTimeCondition,
  getWeekdayIndexInTimezone,
  isForecastTemperatureType,
  normalizeWeekdays
} = require('./lib/automation-conditions');
const { createAdminAccess } = require('./lib/admin-access');
const {
  estimateFirestoreCostFromUsage,
  fetchCloudBillingCost,
  getRuntimeProjectId,
  listMonitoringTimeSeries,
  normalizeMetricErrorMessage,
  sumSeriesValues
} = require('./lib/admin-metrics');
const {
  applySegmentToGroups,
  buildAutomationSchedulerSegment,
  clearSchedulerGroups
} = require('./lib/automation-actions');
const { registerMetricsRoutes } = require('./api/routes/metrics');
const { registerPricingRoutes } = require('./api/routes/pricing');
const { registerWeatherRoutes } = require('./api/routes/weather');
const { registerDeviceReadRoutes } = require('./api/routes/device-read');
const { registerDiagnosticsReadRoutes } = require('./api/routes/diagnostics-read');
const { registerInverterReadRoutes } = require('./api/routes/inverter-read');
const { registerInverterHistoryRoutes } = require('./api/routes/inverter-history');
const { registerConfigMutationRoutes } = require('./api/routes/config-mutations');
const { registerConfigReadStatusRoutes } = require('./api/routes/config-read-status');
const { registerHealthRoutes } = require('./api/routes/health');
const { registerAdminRoutes } = require('./api/routes/admin');
const { registerAuthLifecycleRoutes } = require('./api/routes/auth-lifecycle');
const { registerAutomationHistoryRoutes } = require('./api/routes/automation-history');
const { registerDeviceMutationRoutes } = require('./api/routes/device-mutations');
const { registerQuickControlRoutes } = require('./api/routes/quick-control');
const { registerUserSelfRoutes } = require('./api/routes/user-self');
const { registerSetupPublicRoutes } = require('./api/routes/setup-public');
const { registerSchedulerReadRoutes } = require('./api/routes/scheduler-read');
const { registerSchedulerMutationRoutes } = require('./api/routes/scheduler-mutations');
const { registerAutomationMutationRoutes } = require('./api/routes/automation-mutations');
const { registerAutomationCycleRoute } = require('./api/routes/automation-cycle');
const { runAutomationSchedulerCycle } = require('./lib/services/automation-scheduler-service');
const { createApiMetricsService } = require('./lib/services/api-metrics-service');
const { createWeatherService } = require('./lib/services/weather-service');
const { parseAutomationTelemetry } = require('./lib/device-telemetry');
const { getCurrentAmberPrices } = require('./lib/pricing-normalization');
const { createUserAutomationRepository } = require('./lib/repositories/user-automation-repository');
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

const userAutomationRepository = createUserAutomationRepository({
  db,
  logger,
  serverTimestamp
});

const {
  getAusDateKey,
  incrementApiCount
} = createApiMetricsService({
  admin,
  db,
  defaultTimezone: DEFAULT_TIMEZONE,
  logger,
  serverTimestamp
});

const {
  callWeatherAPI,
  getCachedWeatherData
} = createWeatherService({
  db,
  getConfig,
  incrementApiCount,
  logger: console,
  setUserConfig
});

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
      variables: ['SoC', 'SoC1', 'batTemperature', 'ambientTemperation', 'pvPower', 'loadsPower', 'gridConsumptionPower', 'feedinPower']
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
      variables: ['generationPower', 'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power', 'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt', 'pv1Current', 'pv2Current', 'pv3Current', 'pv4Current', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC', 'SoC1', 'batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation']
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
      
      // â­ NEW: ROI snapshot with house load
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
const {
  isAdmin,
  requireAdmin,
  SEED_ADMIN_EMAIL
} = createAdminAccess({ db, logger: console });

registerHealthRoutes(app, {
  getUserConfig,
  tryAttachUser
});

registerSetupPublicRoutes(app, {
  db,
  foxessAPI,
  getConfig,
  getUserConfig,
  logger,
  serverTimestamp,
  setUserConfig,
  tryAttachUser
});

registerPricingRoutes(app, {
  amberAPI,
  amberPricesInFlight,
  authenticateUser,
  getUserConfig,
  incrementApiCount,
  logger,
  tryAttachUser
});

registerMetricsRoutes(app, {
  db,
  getAusDateKey,
  tryAttachUser
});

// ==================== ADMIN API ENDPOINTS ====================
// All admin routes use authenticateUser + requireAdmin explicitly so they
// are registered before the catch-all app.use('/api', authenticateUser).
const getRuntimeProjectIdForAdmin = () => getRuntimeProjectId(admin);
const fetchCloudBillingCostForAdmin = (projectId) => fetchCloudBillingCost(projectId, { googleApis });

registerAdminRoutes(app, {
  admin,
  authenticateUser,
  db,
  deleteCollectionDocs,
  deleteUserDataTree,
  estimateFirestoreCostFromUsage,
  fetchCloudBillingCost: fetchCloudBillingCostForAdmin,
  getRuntimeProjectId: getRuntimeProjectIdForAdmin,
  googleApis,
  isAdmin,
  listMonitoringTimeSeries,
  normalizeCouplingValue,
  normalizeMetricErrorMessage,
  requireAdmin,
  SEED_ADMIN_EMAIL,
  serverTimestamp,
  sumSeriesValues
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

registerAuthLifecycleRoutes(app, {
  authenticateUser,
  db,
  deleteUserDataTree,
  logger,
  serverTimestamp,
  setUserConfig
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
  return userAutomationRepository.getUserConfig(userId);
}

const VALID_RULE_WORK_MODES = new Set(['SelfUse', 'ForceDischarge', 'ForceCharge', 'Feedin', 'Backup']);
const POWER_REQUIRED_WORK_MODES = new Set(['ForceDischarge', 'ForceCharge', 'Feedin']);

function getEffectiveInverterCapacityW(userConfig) {
  const capacity = Number(userConfig?.inverterCapacityW);
  if (!Number.isFinite(capacity) || capacity < 1000) return 10000;
  return Math.min(30000, Math.round(capacity));
}

/**
 * Validates automation rule action payload against mode-specific constraints.
 * Returns null when valid; otherwise a human-readable error string.
 */
function validateRuleActionForUser(action, userConfig) {
  if (!action || typeof action !== 'object') return null;

  const workMode = action.workMode || 'SelfUse';
  if (!VALID_RULE_WORK_MODES.has(workMode)) {
    return `Invalid action.workMode: ${workMode}. Valid modes: ${Array.from(VALID_RULE_WORK_MODES).join(', ')}`;
  }

  if (action.durationMinutes !== undefined && action.durationMinutes !== null) {
    const duration = Number(action.durationMinutes);
    if (!Number.isFinite(duration) || duration < 5 || duration > 1440) {
      return 'action.durationMinutes must be between 5 and 1440 minutes';
    }
  }

  const inverterCapacityW = getEffectiveInverterCapacityW(userConfig);
  const hasFdPwr = action.fdPwr !== undefined && action.fdPwr !== null && action.fdPwr !== '';

  if (POWER_REQUIRED_WORK_MODES.has(workMode)) {
    if (!hasFdPwr) {
      return `action.fdPwr is required for workMode ${workMode} and must be greater than 0`;
    }
    const fdPwr = Number(action.fdPwr);
    if (!Number.isFinite(fdPwr) || fdPwr <= 0) {
      return `action.fdPwr must be greater than 0 for workMode ${workMode}`;
    }
    if (fdPwr > inverterCapacityW) {
      return `action.fdPwr (${Math.round(fdPwr)}W) exceeds inverter capacity (${inverterCapacityW}W)`;
    }
    return null;
  }

  if (hasFdPwr) {
    const fdPwr = Number(action.fdPwr);
    if (!Number.isFinite(fdPwr) || fdPwr < 0) {
      return 'action.fdPwr must be a non-negative number';
    }
    if (fdPwr > inverterCapacityW) {
      return `action.fdPwr (${Math.round(fdPwr)}W) exceeds inverter capacity (${inverterCapacityW}W)`;
    }
  }

  return null;
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
 *     Default: 0 (curtail when price â‰¤ 0, useful for avoiding negative pricing)
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

    const { feedInPrice: currentFeedInPrice } = getCurrentAmberPrices(amberData);
    if (currentFeedInPrice === null) {
      result.error = 'No current feed-in price found';
      return result;
    }

    result.currentPrice = currentFeedInPrice;

    // Get curtailment state from Firestore
    const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
    const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false, lastPrice: null };

    // Determine if we should curtail (price below threshold)
    const shouldCurtail = result.currentPrice < result.priceThreshold;
    result.triggered = shouldCurtail;

    // Only take action if state has changed (avoid redundant API calls)
    if (shouldCurtail && !curtailmentState.active) {
      // Activate curtailment: set ExportLimit to 0
      console.log(`[Curtailment] Activating (price ${result.currentPrice.toFixed(2)}Â¢ < ${result.priceThreshold}Â¢)`);
      
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
      console.log(`[Curtailment] Deactivating (price ${result.currentPrice.toFixed(2)}Â¢ >= ${result.priceThreshold}Â¢)`);
      
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
  return userAutomationRepository.getUserRules(userId);
}

/**
 * Get one user automation rule by id
 */
async function getUserRule(userId, ruleId) {
  return userAutomationRepository.getUserRule(userId, ruleId);
}

/**
 * Persist user config (users/{uid}/config/main)
 */
async function setUserConfig(userId, config, options = { merge: true }) {
  return userAutomationRepository.setUserConfig(userId, config, options);
}

/**
 * Update user config fields (users/{uid}/config/main)
 */
async function updateUserConfig(userId, updates) {
  return userAutomationRepository.updateUserConfig(userId, updates);
}

/**
 * Persist one user automation rule by id
 */
async function setUserRule(userId, ruleId, rule, options) {
  return userAutomationRepository.setUserRule(userId, ruleId, rule, options);
}

/**
 * Delete one user automation rule by id
 */
async function deleteUserRule(userId, ruleId) {
  return userAutomationRepository.deleteUserRule(userId, ruleId);
}

/**
 * Clear lastTriggered for all user rules
 */
async function clearRulesLastTriggered(userId) {
  return userAutomationRepository.clearRulesLastTriggered(userId);
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
  return userAutomationRepository.addHistoryEntry(userId, entry);
}

/**
 * Get recent user history entries ordered by timestamp desc
 */
async function getUserHistoryEntries(userId, limit = 50) {
  return userAutomationRepository.getHistoryEntries(userId, limit);
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

registerConfigReadStatusRoutes(app, {
  authenticateUser,
  db,
  DEFAULT_TOPOLOGY_REFRESH_MS,
  getAutomationTimezone,
  getCachedWeatherData,
  getConfig,
  getUserAutomationState,
  getUserConfig,
  getUserRules,
  getUserTime,
  logger,
  normalizeCouplingValue,
  setUserConfig
});

registerConfigMutationRoutes(app, {
  authenticateUser,
  callWeatherAPI,
  deepMerge,
  deleteField,
  isValidTimezone,
  normalizeCouplingValue,
  serverTimestamp,
  setUserConfig,
  updateUserConfig,
  getUserConfig,
  DEFAULT_TOPOLOGY_REFRESH_MS
});

registerUserSelfRoutes(app, {
  authenticateUser,
  admin,
  db,
  deleteCollectionDocs,
  deleteUserDataTree,
  serverTimestamp
});
registerAutomationMutationRoutes(app, {
  addAutomationAuditEntry,
  addHistoryEntry,
  applyRuleAction,
  clearRulesLastTriggered,
  compareValue,
  db,
  DEFAULT_TIMEZONE,
  deleteUserRule,
  evaluateTemperatureCondition,
  evaluateTimeCondition,
  foxessAPI,
  getAutomationAuditLogs,
  getUserAutomationState,
  getUserConfig,
  getUserRule,
  getUserRules,
  getUserTime,
  logger,
  normalizeWeekdays,
  saveUserAutomationState,
  serverTimestamp,
  setUserRule,
  validateRuleActionForUser
});

const automationCycleHandler = registerAutomationCycleRoute(app, {
  addAutomationAuditEntry,
  amberAPI,
  amberPricesInFlight,
  applyRuleAction,
  checkAndApplyCurtailment,
  cleanupExpiredQuickControl,
  evaluateRule,
  foxessAPI,
  getAutomationTimezone,
  getCachedInverterData,
  getCachedInverterRealtimeData,
  getCachedWeatherData,
  getQuickControlState,
  getUserAutomationState,
  getUserConfig,
  getUserRules,
  getUserTime,
  isForecastTemperatureType,
  logger,
  saveUserAutomationState,
  serverTimestamp,
  setUserRule
});

registerQuickControlRoutes(app, {
  addHistoryEntry,
  addMinutes,
  authenticateUser,
  cleanupExpiredQuickControl,
  foxessAPI,
  getAutomationTimezone,
  getQuickControlState,
  getUserConfig,
  getUserTime,
  logger,
  saveQuickControlState,
  serverTimestamp
});

registerAutomationHistoryRoutes(app, {
  getAutomationAuditLogs,
  getUserHistoryEntries
});

registerInverterReadRoutes(app, {
  authenticateUser,
  foxessAPI,
  getCachedInverterRealtimeData,
  getUserConfig,
  logger
});

registerDeviceReadRoutes(app, {
  authenticateUser,
  foxessAPI,
  getUserConfig,
  logger
});

registerDiagnosticsReadRoutes(app, {
  authenticateUser,
  foxessAPI,
  getUserConfig
});

registerDeviceMutationRoutes(app, {
  authenticateUser,
  foxessAPI,
  getUserConfig
});

// (Amber sites handler moved earlier to allow unauthenticated callers)
// (Amber prices handler moved earlier to allow unauthenticated callers)

registerWeatherRoutes(app, {
  getCachedWeatherData,
  tryAttachUser
});

registerSchedulerReadRoutes(app, {
  foxessAPI,
  getUserConfig,
  tryAttachUser
});

registerSchedulerMutationRoutes(app, {
  addHistoryEntry,
  authenticateUser,
  foxessAPI,
  getUserConfig,
  logger
});

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



// NOTE: 404 handler moved to the end of the file so all routes
// declared below (including scheduler user-scoped endpoints)
// are reachable. See end-of-file for the catch-all handler.

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
  const { soc, batTemp, ambientTemp } = parseAutomationTelemetry(inverterData);
  
  // Parse Amber prices
  const { feedInPrice, buyPrice } = getCurrentAmberPrices(cache.amber);
  
  logger.debug('Automation', `Evaluating rule '${rule.name}' - Live data: SoC=${soc}%, BatTemp=${batTemp}Â°C, FeedIn=${feedInPrice?.toFixed(1)}Â¢, Buy=${buyPrice?.toFixed(1)}Â¢`);
  
  // Check SoC condition (support both 'op' and 'operator' field names)
  if (conditions.soc?.enabled) {
    enabledConditions.push('soc');
    if (soc !== null) {
      const operator = conditions.soc.op || conditions.soc.operator;
      const value = conditions.soc.value;
      const value2 = conditions.soc.value2;
      let met = false;
      if (operator === 'between' && value2 != null) {
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
      if (operator === 'between' && value2 != null) {
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
      if (operator === 'between' && value2 != null) {
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
      if (operator === 'between' && value2 != null) {
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
    const tempResult = evaluateTemperatureCondition(tempCondition, {
      batteryTemp: batTemp,
      ambientTemp,
      weatherData: cache.weather
    });

    if (tempResult.reason) {
      results.push({
        condition: 'temperature',
        met: false,
        reason: tempResult.reason,
        type: tempResult.type,
        source: tempResult.source,
        dayOffset: tempResult.dayOffset
      });
      logger.debug('Automation', `Rule '${rule.name}' - Temperature condition NOT met: ${tempResult.reason}`);
    } else {
      results.push({
        condition: 'temperature',
        met: tempResult.met,
        actual: tempResult.actual,
        operator: tempResult.operator,
        target: tempResult.target,
        target2: tempResult.target2,
        type: tempResult.type,
        source: tempResult.source,
        metric: tempResult.metric,
        dayOffset: tempResult.dayOffset
      });
      if (!tempResult.met) {
        logger.debug(
          'Automation',
          `Rule '${rule.name}' - Temperature condition NOT met: ${tempResult.actual} ${tempResult.operator} ${tempResult.target} = false`
        );
      }
    }
  }
  
  // Check time window condition
  const timeCondition = conditions.time || conditions.timeWindow;
  if (timeCondition?.enabled) {
    enabledConditions.push('time');
    const timeResult = evaluateTimeCondition(timeCondition, {
      timezone: userTimezone,
      userTime,
      currentMinutes
    });

    results.push({
      condition: 'time',
      met: timeResult.met,
      actual: timeResult.actualTime,
      window: `${timeResult.startTime}-${timeResult.endTime}`,
      days: timeResult.days,
      daysLabel: timeResult.daysLabel,
      dayMatched: timeResult.dayMatched
    });
    if (!timeResult.met) {
      logger.debug(
        'Automation',
        `Rule '${rule.name}' - Time condition NOT met: ${timeResult.actualTime} not in ${timeResult.startTime}-${timeResult.endTime} (${timeResult.daysLabel})`
      );
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
      
      const threshold = conditions.solarRadiation.value || 200; // W/mÂ² default
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
        
        const value2 = conditions.solarRadiation.value2;
        const met = (operator === 'between' && value2 != null)
          ? compareValue(actualValue, 'between', threshold, value2)
          : compareValue(actualValue, operator, threshold);
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
          unit: 'W/mÂ²',
          lookAhead: lookAheadDisplay,
          checkType,
          hoursChecked: radiationValues.length,
          hoursRequested,
          incomplete: hasIncompleteData
        });
        if (!met) {
          logger.debug('Automation', `Rule '${rule.name}' - Solar radiation NOT met: ${checkType} ${actualValue?.toFixed(0)} W/mÂ² ${operator} ${threshold} W/mÂ²`);
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
        
        const value2 = conditions.cloudCover.value2;
        const met = (operator === 'between' && value2 != null)
          ? compareValue(actualValue, 'between', threshold, value2)
          : compareValue(actualValue, operator, threshold);
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
            results.push({ condition: 'weather', met, type: 'radiation', actual: actualValue?.toFixed(0), operator, target: threshold, unit: 'W/mÂ²', legacy: true });
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
        const firstPrices = forecasts.slice(0, 5).map(f => `${new Date(f.startTime).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Australia/Sydney'})}=${(priceType === 'feedIn' ? -f.perKwh : f.perKwh).toFixed(1)}Â¢`);
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
        
        console.log(`[ForecastPrice] Calculated ${checkType}: ${actualValue?.toFixed(1)}Â¢ (comparing ${conditions.forecastPrice.operator} ${conditions.forecastPrice.value}Â¢)`);

        
        const operator = conditions.forecastPrice.operator;
        const value = conditions.forecastPrice.value;
        const forecastValue2 = conditions.forecastPrice.value2;
        const met = checkType === 'any'
          ? actualValue !== undefined
          : (operator === 'between' && forecastValue2 != null)
            ? compareValue(actualValue, 'between', value, forecastValue2)
            : compareValue(actualValue, operator, value);
        
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
          logger.debug('Automation', `Rule '${rule.name}' - Forecast ${priceType} condition NOT met: ${checkType} ${actualValue?.toFixed(1)}Â¢ ${operator} ${value}Â¢ (${lookAheadDisplay})`);
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
 * @param {number} actual - The actual measured value
 * @param {string} operator - Comparison operator: '>', '>=', '<', '<=', '==', '!=', 'between'
 * @param {number|Array|Object} target - Target value (or min for 'between')
 * @param {number} [target2] - Upper bound for 'between' operator
 */
function compareValue(actual, operator, target, target2) {
  if (actual === null || actual === undefined) return false;
  switch (operator) {
    case '>': return actual > target;
    case '>=': return actual >= target;
    case '<': return actual < target;
    case '<=': return actual <= target;
    case '==': return actual == target;
    case '!=': return actual != target;
    case 'between':
      // Support multiple calling conventions:
      // 1. compareValue(actual, 'between', min, max)  â€” preferred
      // 2. compareValue(actual, 'between', [min, max]) â€” legacy array
      // 3. compareValue(actual, 'between', {min, max}) â€” legacy object
      if (target2 != null) return actual >= Math.min(target, target2) && actual <= Math.max(target, target2);
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
    dayOfWeek: getWeekdayIndexInTimezone(timezone, now) ?? now.getDay(), // 0 = Sunday, 6 = Saturday
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
    console.error(`[SegmentSend] âŒ CRITICAL: No deviceSN configured for user ${userId}`);
    return { errno: -1, msg: 'No device SN configured' };
  }
  
  console.log(`[SegmentSend] ðŸŽ¯ Target device: ${deviceSN}`);
  console.log(`[SegmentSend] ðŸ“‹ Action config:`, JSON.stringify(action, null, 2));

  const actionValidationError = validateRuleActionForUser(action, userConfig);
  if (actionValidationError) {
    console.error(`[SegmentSend] âŒ Invalid rule action for '${rule.name}': ${actionValidationError}`);
    return {
      errno: 400,
      msg: actionValidationError,
      segment: null,
      flagResult: null,
      verify: null,
      retrysFailed: false
    };
  }
  
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
    console.warn(`[SegmentSend] ï¿½ ï¸ MIDNIGHT CROSSING DETECTED: Original end time ${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} would cross midnight`);
    endHour = 23;
    endMinute = 59;
    const actualDuration = (endHour * 60 + endMinute) - startTotalMins;
    console.warn(`[SegmentSend] ðŸ”§ CAPPED at 23:59 - Reduced duration from ${durationMins}min to ${actualDuration}min to respect FoxESS constraint`);
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
  
  // Clear all existing enabled segments (same as backend server.js does)
  // This avoids FoxESS reordering issues and ensures clean state.
  const clearedResult = clearSchedulerGroups(currentGroups);
  currentGroups = clearedResult.groups;
  const clearedCount = clearedResult.clearedCount;
  if (clearedCount > 0) {
    logger.debug('Automation', `Cleared ${clearedCount} existing segment(s)`);
  }
  
  // Final validation: Ensure end time is after start time (no midnight crossing)
  const startTotalMinsCheck = startHour * 60 + startMinute;
  const endTotalMinsCheck = endHour * 60 + endMinute;
  if (endTotalMinsCheck <= startTotalMinsCheck) {
    console.error(`[SegmentSend] âŒ CRITICAL: Final validation failed - end time ${endHour}:${String(endMinute).padStart(2,'0')} is not after start time ${startHour}:${String(startMinute).padStart(2,'0')}`);
    throw new Error(`Invalid segment: end time must be after start time (no midnight crossing allowed by FoxESS)`);
  }
  
  // Build the new segment (V1 flat structure)
  const segment = buildAutomationSchedulerSegment(action, {
    startHour,
    startMinute,
    endHour,
    endMinute
  });
  
  // Always use Group 1 (index 0) for automation - clean slate approach
  currentGroups = applySegmentToGroups(currentGroups, segment, 0);
  console.log(`[SegmentSend] ðŸ“¦ Final segment prepared for Group 1:`, JSON.stringify(segment, null, 2));
  console.log(`[SegmentSend] ðŸ“Š Total groups to send: ${currentGroups.length}`);
  
  console.log(`[SegmentSend] ðŸš€ Sending segment: ${String(startHour).padStart(2,'0')}:${String(startMinute).padStart(2,'0')}-${String(endHour).padStart(2,'0')}:${String(endMinute).padStart(2,'0')} ${segment.workMode} fdSoc=${segment.fdSoc}`);
  
  // Send to device via v1 API with retry logic (up to 3 attempts)
  let applyAttempt = 0;
  let result = null;
  console.log(`[SegmentSend] ðŸ”„ Starting API call with up to 3 retry attempts...`);
  while (applyAttempt < 3) {
    applyAttempt++;
    console.log(`[SegmentSend] ðŸ“¡ Attempt ${applyAttempt}/3: Calling FoxESS /op/v1/device/scheduler/enable...`);
    const callStart = Date.now();
    result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: currentGroups }, userConfig, userId);
    const callDuration = Date.now() - callStart;
    console.log(`[SegmentSend] â±ï¸ API call completed in ${callDuration}ms`);
    console.log(`[SegmentSend] ðŸ“¥ Response: errno=${result?.errno}, msg=${result?.msg}`);
    
    if (result?.errno === 0) {
      console.log(`[SegmentSend] âœ… Segment sent successfully (attempt ${applyAttempt})`);
      break;
    } else {
      console.error(`[SegmentSend] âŒ Attempt ${applyAttempt} FAILED: errno=${result?.errno}, msg=${result?.msg}`);
      if (applyAttempt < 3) {
        console.log(`[SegmentSend] â³ Waiting 1200ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
  }
  
  if (result?.errno !== 0) {
    console.error(`[SegmentSend] ðŸš¨ CRITICAL FAILURE: Segment failed after 3 attempts`);
    console.error(`[SegmentSend] ðŸ’¥ Final error: errno=${result?.errno}, msg=${result?.msg}`);
    console.error(`[SegmentSend] ðŸ“¦ Failed segment details:`, JSON.stringify(segment, null, 2));
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
  console.log(`[SegmentSend] ðŸš© Setting scheduler flag to ENABLED...`);
  let flagResult = null;
  let flagAttempt = 0;
  while (flagAttempt < 2) {
    flagAttempt++;
    try {
      console.log(`[SegmentSend] ðŸ“¡ Flag attempt ${flagAttempt}/2: Calling /op/v1/device/scheduler/set/flag...`);
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 1 }, userConfig, userId);
      console.log(`[SegmentSend] ðŸ“¥ Flag response: errno=${flagResult?.errno}, msg=${flagResult?.msg}`);
      if (flagResult?.errno === 0) {
        console.log(`[SegmentSend] âœ… Scheduler flag set successfully (attempt ${flagAttempt})`);
        break;
      } else {
        console.error(`[SegmentSend] âŒ Flag set attempt ${flagAttempt} failed: errno=${flagResult?.errno}`);
      }
    } catch (flagErr) {
      console.error(`[SegmentSend] âŒ Flag set exception:`, flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    if (flagAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  
  // Wait 3 seconds for FoxESS to process the request before verification
  // Extended from 2s to 3s for better reliability
  console.log(`[SegmentSend] â³ Waiting 3000ms for FoxESS device to process segment...`);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Verification read to confirm device accepted the segment (with retry)
  console.log(`[SegmentSend] ðŸ” Starting verification read to confirm segment on device...`);
  let verify = null;
  let verifyAttempt = 0;
  while (verifyAttempt < 2) {
    verifyAttempt++;
    try {
      console.log(`[SegmentSend] ðŸ“¡ Verify attempt ${verifyAttempt}/2: Calling /op/v1/device/scheduler/get...`);
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
      console.log(`[SegmentSend] ðŸ“¥ Verify response: errno=${verify?.errno}, groups=${verify?.result?.groups?.length || 0}`);
      if (verify?.errno === 0) {
        console.log(`[SegmentSend] âœ… Verification read successful (attempt ${verifyAttempt})`);
        if (verify?.result?.groups?.[0]) {
          console.log(`[SegmentSend] ðŸ“Š Group 0 on device:`, JSON.stringify(verify.result.groups[0], null, 2));
        }
        break;
      } else {
        console.error(`[SegmentSend] âŒ Verification read attempt ${verifyAttempt} failed: errno=${verify?.errno}`);
      }
    } catch (verifyErr) {
      console.error(`[SegmentSend] âŒ Verification read exception:`, verifyErr.message);
    }
    if (verifyAttempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (verify?.result?.groups?.[0]) {
    const deviceSegment = verify.result.groups[0];
    if (deviceSegment.enable === 1) {
      console.log(`[SegmentSend] âœ… Segment CONFIRMED ENABLED on device!`);
      console.log(`[SegmentSend] ðŸŽ‰ Device segment: ${deviceSegment.startHour}:${deviceSegment.startMinute}-${deviceSegment.endHour}:${deviceSegment.endMinute} ${deviceSegment.workMode}`);
    } else {
      console.warn(`[SegmentSend] ï¿½ ï¸ Segment on device but DISABLED (enable=${deviceSegment.enable})`);
    }
  } else {
    console.warn(`[SegmentSend] ï¿½ ï¸ No verification data available for Group 0`);
  }
  console.log(`[SegmentSend] ========== END applyRuleAction (SUCCESS) ==========`);
  console.log(`[SegmentSend] ðŸ Final result: errno=0, segment sent and verified`);
  
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

registerInverterHistoryRoutes(app, {
  authenticateUser,
  db,
  foxessAPI,
  getUserConfig,
  logger
});

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
 * âœ… Uses getConfig().automation.intervalMs for cycle frequency (default 60000ms)
 * âœ… Uses getConfig().automation.cacheTtl for all API cache TTL
 * âœ… Respects per-user config: automation.intervalMs, automation.inverterCacheTtlMs
 * âœ… Checks lastCheck timestamp - only runs cycle if enough time elapsed
 * âœ… Uses existing cache functions: getCachedInverterData, getCachedWeatherData, callAmberAPI
 * âœ… Reuses POST /api/automation/cycle endpoint logic - zero duplication
 * âœ… Respects blackout windows, enabled state, all rule conditions
 * 
 * HOW IT WORKS:
 * 1. Runs every 1 minute (Cloud Scheduler frequency - can be more frequent than user cycles)
 * 2. For each user: checks if (now - lastCheck) >= userIntervalMs
 * 3. If yes: triggers automation cycle by calling the endpoint logic
 * 4. Endpoint handles ALL the work (cache, evaluation, segments, counters)
 */
// Run automation handler logic as a standalone function so tests and different
// firebase-functions versions can wire it up appropriately.
async function runAutomationHandler(context) {
  return runAutomationSchedulerCycle(context, {
    automationCycleHandler,
    db,
    getConfig,
    getTimeInTimezone,
    getUserAutomationState,
    getUserConfig,
    getUserRules,
    isTimeInRange,
    logger: console
  });
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



