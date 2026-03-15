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
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const {
  evaluateTemperatureCondition,
  evaluateTimeCondition,
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
const { registerEVRoutes } = require('./api/routes/ev');
const { runAutomationSchedulerCycle } = require('./lib/services/automation-scheduler-service');
const { createAutomationSchedulerMetricsSink } = require('./lib/services/automation-scheduler-metrics-sink');
const { createApiMetricsService } = require('./lib/services/api-metrics-service');
const { createAutomationRuleActionService } = require('./lib/services/automation-rule-action-service');
const { createAutomationRuleEvaluationService } = require('./lib/services/automation-rule-evaluation-service');
const { createCurtailmentService } = require('./lib/services/curtailment-service');
const { createQuickControlService } = require('./lib/services/quick-control-service');
const { createSchedulerSloAlertNotifier } = require('./lib/services/scheduler-slo-alert-notifier');
const { createWeatherService } = require('./lib/services/weather-service');
const { parseAutomationTelemetry } = require('./lib/device-telemetry');
const { getCurrentAmberPrices } = require('./lib/pricing-normalization');
const { createAutomationStateRepository } = require('./lib/repositories/automation-state-repository');
const { createUserAutomationRepository } = require('./lib/repositories/user-automation-repository');
const { createVehiclesRepository } = require('./lib/repositories/vehicles-repository');
const {
  addMinutes,
  getAutomationTimezone: getAutomationTimezoneWithFallback,
  getTimeInTimezone,
  getUserTime,
  isTimeInRange,
  isValidTimezone
} = require('./lib/time-utils');
const { resolveProviderDeviceId } = require('./lib/provider-device-id');
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

const sungrowModule = require('./api/sungrow');
const sungrowAPI = sungrowModule.init({
  db,
  logger: null, // Will be defined below
  getConfig: null, // Will be defined below
  incrementApiCount: null // Will be defined below
});

const sigenEnergyModule = require('./api/sigenergy');
const sigenEnergyAPI = sigenEnergyModule.init({
  db,
  logger: null, // Will be defined below
  getConfig: null, // Will be defined below
  incrementApiCount: null // Will be defined below
});

const alphaEssModule = require('./api/alphaess');
const alphaEssAPI = alphaEssModule.init({
  db,
  logger: null, // Will be defined below
  getConfig: null, // Will be defined below
  incrementApiCount: null // Will be defined below
});

const { createAdapterRegistry } = require('./lib/adapters/adapter-registry');
const { createFoxessDeviceAdapter } = require('./lib/adapters/foxess-adapter');
const { createSungrowDeviceAdapter } = require('./lib/adapters/sungrow-adapter');
const { createSigenEnergyDeviceAdapter } = require('./lib/adapters/sigenergy-adapter');
const { createAlphaEssDeviceAdapter } = require('./lib/adapters/alphaess-adapter');
const {
  TeslaFleetAdapter,
  createTeslaHttpClient
} = require('./lib/adapters/tesla-fleet-adapter');
// adapterRegistry populated once all deps (logger, getConfig) are reinitialized
const adapterRegistry = createAdapterRegistry();

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

// ==================== SECRETS (Firebase Secret Manager) ====================
// Declared here so Firebase mounts them as process.env.* at function runtime.
// Set via: firebase functions:secrets:set SUNGROW_APP_KEY
const _secretSungrowAppKey    = defineSecret('SUNGROW_APP_KEY');
const _secretSungrowAppSecret = defineSecret('SUNGROW_APP_SECRET');
const _secretTeslaProxyUrl    = defineSecret('TESLA_SIGNED_COMMAND_PROXY_URL');
const _secretTeslaProxyToken  = defineSecret('TESLA_SIGNED_COMMAND_PROXY_TOKEN');

// ==================== CONFIGURATION ====================
// Reads from environment variables (populated from Secret Manager at runtime,
// or from .env.local for the local emulator).
const getConfig = () => {
  return {
    foxess: {
      token:   process.env.FOXESS_TOKEN   || '',
      baseUrl: process.env.FOXESS_BASE_URL || 'https://www.foxesscloud.com'
    },
    amber: {
      apiKey:  process.env.AMBER_API_KEY  || '',
      baseUrl: process.env.AMBER_BASE_URL || 'https://api.amber.com.au/v1'
    },
    sungrow: {
      appKey:    process.env.SUNGROW_APP_KEY    || '',
      appSecret: process.env.SUNGROW_APP_SECRET || '',
      baseUrl:   process.env.SUNGROW_BASE_URL   || 'https://augateway.isolarcloud.com'
    },
    sigenergy: {
      defaultRegion: process.env.SIGENERGY_REGION || 'apac'
    },
    alphaess: {
      appId: process.env.ALPHAESS_APP_ID || '',
      appSecret: process.env.ALPHAESS_APP_SECRET || '',
      baseUrl: process.env.ALPHAESS_BASE_URL || 'https://openapi.alphaess.com'
    },
    automation: {
      intervalMs: 60000,
      timeZone: 'Australia/Sydney',
      cacheTtl: {
        amber: 60000,      // 60 seconds
        inverter: 300000,  // 5 minutes
        weather: 1800000,  // 30 minutes
        teslaStatus: 600000 // 10 minutes
      }
    }
  };
};

// Default timezone constant derived from config (can be overridden via functions.config())
// NOTE: This is computed once at module load time. If timezone is changed via Firebase config,
// the service must be redeployed for the change to take effect. Users in different timezones
// will use their stored config.timezone value, falling back to this default.
const DEFAULT_TIMEZONE = (getConfig().automation && getConfig().automation.timeZone) || 'Australia/Sydney';
const getAutomationTimezone = (userConfig) => getAutomationTimezoneWithFallback(userConfig, DEFAULT_TIMEZONE);

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

const {
  addHistoryEntry,
  clearRulesLastTriggered,
  deleteUserRule,
  getHistoryEntries: getUserHistoryEntries,
  getUserConfig,
  getUserRule,
  getUserRules,
  setUserConfig,
  setUserRule,
  updateUserConfig
} = createUserAutomationRepository({
  db,
  logger,
  serverTimestamp
});

const {
  deleteCollectionDocs,
  deleteUserDataTree,
  getQuickControlState,
  getUserAutomationState,
  saveQuickControlState,
  saveUserAutomationState
} = createAutomationStateRepository({ db });

const vehiclesRepo = createVehiclesRepository({
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

const {
  checkAndApplyCurtailment
} = createCurtailmentService({
  db,
  foxessAPI,
  getCurrentAmberPrices
});

const {
  applyRuleAction,
  validateRuleActionForUser
} = createAutomationRuleActionService({
  adapterRegistry,
  addHistoryEntry,
  addMinutes,
  foxessAPI,
  getUserTime,
  logger,
  resolveAutomationTimezone: getAutomationTimezone,
  serverTimestamp
});

const {
  compareValue,
  evaluateRule
} = createAutomationRuleEvaluationService({
  evaluateTemperatureCondition,
  evaluateTimeCondition,
  getCurrentAmberPrices,
  getUserTime,
  logger,
  parseAutomationTelemetry,
  resolveAutomationTimezone: getAutomationTimezone
});

const {
  cleanupExpiredQuickControl
} = createQuickControlService({
  adapterRegistry,
  addHistoryEntry,
  foxessAPI,
  getUserConfig,
  logger,
  saveQuickControlState,
  serverTimestamp
});

const {
  notifySchedulerSloAlert
} = createSchedulerSloAlertNotifier({
  cooldownMs: process.env.AUTOMATION_SCHEDULER_SLO_ALERT_COOLDOWN_MS,
  logger: console,
  webhookUrl: process.env.AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL
});

const schedulerSloThresholdConfig = getConfig()?.automation?.scheduler?.slo || {};
const {
  emitSchedulerMetrics
} = createAutomationSchedulerMetricsSink({
  db,
  logger,
  onSloAlert: notifySchedulerSloAlert,
  sloThresholds: {
    errorRatePct:
      schedulerSloThresholdConfig.errorRatePct ||
      process.env.AUTOMATION_SCHEDULER_SLO_ERROR_RATE_PCT,
    deadLetterRatePct:
      schedulerSloThresholdConfig.deadLetterRatePct ||
      process.env.AUTOMATION_SCHEDULER_SLO_DEAD_LETTER_RATE_PCT,
    maxQueueLagMs:
      schedulerSloThresholdConfig.maxQueueLagMs ||
      process.env.AUTOMATION_SCHEDULER_SLO_MAX_QUEUE_LAG_MS,
    maxCycleDurationMs:
      schedulerSloThresholdConfig.maxCycleDurationMs ||
      process.env.AUTOMATION_SCHEDULER_SLO_MAX_CYCLE_DURATION_MS,
    p99CycleDurationMs:
      schedulerSloThresholdConfig.p99CycleDurationMs ||
      process.env.AUTOMATION_SCHEDULER_SLO_P99_CYCLE_DURATION_MS,
    tailP99CycleDurationMs:
      schedulerSloThresholdConfig.tailP99CycleDurationMs ||
      process.env.AUTOMATION_SCHEDULER_SLO_TAIL_P99_CYCLE_DURATION_MS,
    tailWindowMinutes:
      schedulerSloThresholdConfig.tailWindowMinutes ||
      process.env.AUTOMATION_SCHEDULER_SLO_TAIL_WINDOW_MINUTES,
    tailMinRuns:
      schedulerSloThresholdConfig.tailMinRuns ||
      process.env.AUTOMATION_SCHEDULER_SLO_TAIL_MIN_RUNS
  },
  serverTimestamp
});

// ==================== CACHED INVERTER DATA HELPER ====================
/**
 * Get inverter data with per-user Firestore cache.
 * Respects TTL (default 5 minutes, configurable via user config).
 * Only fetches fresh data if cache is expired.
 */
function toPositiveMs(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function resolveInverterCacheTtlMs(userConfig, defaultTtlMs, options = {}) {
  const preferRealtime = options.preferRealtime === true;
  const fromAutomationRealtime = toPositiveMs(userConfig?.automation?.inverterRealtimeCacheTtlMs, null);
  const fromAutomation = toPositiveMs(userConfig?.automation?.inverterCacheTtlMs, null);
  const fromCacheSection = toPositiveMs(userConfig?.cache?.inverter, null);

  if (preferRealtime && fromAutomationRealtime !== null) return fromAutomationRealtime;
  if (fromAutomation !== null) return fromAutomation;
  if (fromCacheSection !== null) return fromCacheSection;
  if (fromAutomationRealtime !== null) return fromAutomationRealtime;
  return toPositiveMs(defaultTtlMs, 300000);
}

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toKw(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) return null;
  return Number((numeric / 1000).toFixed(4));
}

function inferAlphaEssBatterySignInversion(status = {}) {
  const pvPower = toFiniteNumber(status.pvPowerW, null);
  const loadPower = toFiniteNumber(status.loadPowerW, null);
  const gridPower = toFiniteNumber(status.gridPowerW, null);
  const feedInPower = toFiniteNumber(status.feedInPowerW, null);
  const batteryPower = toFiniteNumber(status.batteryPowerW, null);

  if (
    pvPower === null ||
    loadPower === null ||
    gridPower === null ||
    feedInPower === null ||
    batteryPower === null
  ) {
    return null;
  }

  if (Math.abs(batteryPower) < 50) return null;

  const nonNegative = (value) => Math.max(0, value);
  const flowResidual = (canonicalBatteryPower) => {
    const batteryChargePower = canonicalBatteryPower > 0 ? canonicalBatteryPower : 0;
    const batteryDischargePower = canonicalBatteryPower < 0 ? Math.abs(canonicalBatteryPower) : 0;
    const powerSources = nonNegative(pvPower) + nonNegative(gridPower) + batteryDischargePower;
    const powerSinks = nonNegative(loadPower) + nonNegative(feedInPower) + batteryChargePower;
    return Math.abs(powerSources - powerSinks);
  };

  const residualNative = flowResidual(batteryPower);
  const residualInverted = flowResidual(-batteryPower);
  const marginW = Math.max(50, Math.abs(batteryPower) * 0.1);

  if (residualInverted + marginW < residualNative) return true;
  if (residualNative + marginW < residualInverted) return false;
  return null;
}

function resolveAlphaEssBatterySignInversion(userConfig, status) {
  if (!userConfig || typeof userConfig !== 'object') return false;

  if (typeof userConfig.alphaessInvertBatteryPower === 'boolean') {
    return userConfig.alphaessInvertBatteryPower;
  }

  const rawPolicy = String(userConfig.alphaessBatteryPowerSign || '').toLowerCase().trim();
  if (rawPolicy) {
    if (rawPolicy === 'invert' || rawPolicy === 'inverted' || rawPolicy === 'reverse' || rawPolicy === 'reversed') {
      return true;
    }
    if (rawPolicy === 'default' || rawPolicy === 'normal' || rawPolicy === 'native' || rawPolicy === 'standard') {
      return false;
    }
  }

  const inferred = inferAlphaEssBatterySignInversion(status);
  if (inferred !== null) return inferred;

  const coupling = normalizeCouplingValue(userConfig.systemTopology && userConfig.systemTopology.coupling);
  return coupling === 'ac';
}

function buildRealtimePayloadFromDeviceStatus(status = {}, sn, options = {}) {
  const normalizeToKw = options.normalizeToKw === true;
  const invertBatteryPowerSign = options.invertBatteryPowerSign === true;

  const socPct = toFiniteNumber(status.socPct, null);
  const batteryTempC = toFiniteNumber(status.batteryTempC, null);
  const ambientTempC = toFiniteNumber(status.ambientTempC, null);
  const pvPowerRaw = toFiniteNumber(status.pvPowerW, 0);
  const loadPowerRaw = toFiniteNumber(status.loadPowerW, 0);
  const gridPowerRaw = toFiniteNumber(status.gridPowerW, 0);
  const feedInPowerRaw = toFiniteNumber(status.feedInPowerW, 0);
  const batteryPowerRaw = toFiniteNumber(status.batteryPowerW, 0);
  const batteryPowerCanonicalRaw = invertBatteryPowerSign ? -batteryPowerRaw : batteryPowerRaw;

  const mapPower = (raw) => {
    if (!normalizeToKw) return raw;
    return toKw(raw) ?? 0;
  };

  const pvPower = mapPower(pvPowerRaw);
  const loadPower = mapPower(loadPowerRaw);
  const gridPower = mapPower(gridPowerRaw);
  const feedInPower = mapPower(feedInPowerRaw);
  const batteryPower = mapPower(batteryPowerCanonicalRaw);
  const batteryChargePower = batteryPower > 0 ? batteryPower : 0;
  const batteryDischargePower = batteryPower < 0 ? Math.abs(batteryPower) : 0;
  const meterPower = gridPower > 0 ? gridPower : -feedInPower;
  const unit = normalizeToKw ? 'kW' : undefined;

  return {
    errno: 0,
    msg: 'Operation successful',
    result: [{
      deviceSN: String(sn || status.deviceSN || ''),
      time: status.observedAtIso || new Date().toISOString(),
      datas: [
        { variable: 'SoC', value: socPct, ...(normalizeToKw ? { unit: '%' } : {}) },
        { variable: 'pvPower', value: pvPower, ...(unit ? { unit } : {}) },
        { variable: 'loadsPower', value: loadPower, ...(unit ? { unit } : {}) },
        { variable: 'gridConsumptionPower', value: gridPower, ...(unit ? { unit } : {}) },
        { variable: 'feedinPower', value: feedInPower, ...(unit ? { unit } : {}) },
        { variable: 'meterPower2', value: meterPower, ...(unit ? { unit } : {}) },
        { variable: 'batTemperature', value: batteryTempC, ...(normalizeToKw ? { unit: 'C' } : {}) },
        { variable: 'ambientTemperation', value: ambientTempC, ...(normalizeToKw ? { unit: 'C' } : {}) },
        { variable: 'batChargePower', value: batteryChargePower, ...(unit ? { unit } : {}) },
        { variable: 'batDischargePower', value: batteryDischargePower, ...(unit ? { unit } : {}) }
      ]
    }]
  };
}

function buildAutomationTelemetryPayloadFromStatus(status = {}) {
  const datas = [];
  const pushNumeric = (variable, value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    datas.push({ variable, value: numeric });
  };

  pushNumeric('SoC', status.socPct);
  pushNumeric('batTemperature', status.batteryTempC);
  pushNumeric('ambientTemperation', status.ambientTempC);
  pushNumeric('pvPower', status.pvPowerW);
  pushNumeric('loadsPower', status.loadPowerW);
  pushNumeric('gridConsumptionPower', status.gridPowerW);
  pushNumeric('feedinPower', status.feedInPowerW);

  const gridPower = Number(status.gridPowerW);
  const feedInPower = Number(status.feedInPowerW);
  const meterPower = Number.isFinite(gridPower) && gridPower > 0
    ? gridPower
    : Number.isFinite(feedInPower) && feedInPower > 0
      ? -feedInPower
      : NaN;
  pushNumeric('meterPower2', meterPower);

  return {
    errno: 0,
    result: [{
      time: status.observedAtIso || new Date().toISOString(),
      datas
    }]
  };
}

function isMatchingProviderCacheEntry(cacheRecord, provider, deviceSN) {
  const cachedProviderRaw = String(cacheRecord?.provider || '').toLowerCase().trim();
  const cachedDeviceRaw = String(cacheRecord?.deviceSN || '').trim();
  const providerNormalized = String(provider || 'foxess').toLowerCase().trim();
  const deviceNormalized = String(deviceSN || '').trim();
  const providerMatch = cachedProviderRaw
    ? cachedProviderRaw === providerNormalized
    : providerNormalized === 'foxess';
  const deviceMatch = cachedDeviceRaw ? (cachedDeviceRaw === deviceNormalized) : true;
  return providerMatch && deviceMatch;
}

async function getCachedInverterData(userId, deviceSN, userConfig, forceRefresh = false) {
  const config = getConfig();
  const ttlMs = resolveInverterCacheTtlMs(userConfig, config?.automation?.cacheTtl?.inverter, { preferRealtime: false });
  const resolved = resolveProviderDeviceId(userConfig, deviceSN);
  const provider = String(resolved.provider || 'foxess').toLowerCase().trim();
  const resolvedDeviceSN = resolved.deviceId;
  
  try {
    if (!resolvedDeviceSN) {
      return { errno: 400, error: 'Device SN not configured' };
    }

    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter').get();
      if (cacheDoc.exists) {
        const cachePayload = cacheDoc.data() || {};
        const { data, timestamp } = cachePayload;
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs && isMatchingProviderCacheEntry(cachePayload, provider, resolvedDeviceSN)) {
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
      }
    }

    let data = null;

    if (provider !== 'foxess') {
      const adapter = adapterRegistry.getDeviceProvider(provider);
      if (!adapter || typeof adapter.getStatus !== 'function') {
        return { errno: 400, error: `Not supported for provider: ${provider}` };
      }
      const status = await adapter.getStatus({
        deviceSN: resolvedDeviceSN,
        userConfig,
        userId
      });
      data = buildAutomationTelemetryPayloadFromStatus(status);
    } else {
      // Fetch fresh data from FoxESS
      data = await foxessAPI.callFoxESSAPI('/op/v0/device/real/query', 'POST', {
        sn: resolvedDeviceSN,
        variables: ['SoC', 'SoC1', 'batTemperature', 'ambientTemperation', 'pvPower', 'loadsPower', 'gridConsumptionPower', 'feedinPower']
      }, userConfig, userId);
    }
    
    // Store in cache if successful
    if (data?.errno === 0) {
      await db.collection('users').doc(userId).collection('cache').doc('inverter').set({
        data,
        timestamp: Date.now(),
        ttlMs,
        provider,
        deviceSN: resolvedDeviceSN,
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
  const ttlMs = resolveInverterCacheTtlMs(userConfig, config?.automation?.cacheTtl?.inverter || 300000, { preferRealtime: true });
  const resolved = resolveProviderDeviceId(userConfig, deviceSN);
  const provider = String(resolved.provider || 'foxess').toLowerCase().trim();
  const resolvedDeviceSN = resolved.deviceId;
  
  try {
    if (!resolvedDeviceSN) {
      return { errno: 400, error: 'Device SN not configured' };
    }

    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter-realtime').get();
      if (cacheDoc.exists) {
        const cachePayload = cacheDoc.data() || {};
        const { data, timestamp } = cachePayload;
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs && isMatchingProviderCacheEntry(cachePayload, provider, resolvedDeviceSN)) {
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
      }
    }

    let data = null;

    if (provider !== 'foxess') {
      const adapter = adapterRegistry.getDeviceProvider(provider);
      if (!adapter || typeof adapter.getStatus !== 'function') {
        return { errno: 400, error: `Not supported for provider: ${provider}` };
      }
      const status = await adapter.getStatus({
        deviceSN: resolvedDeviceSN,
        userConfig,
        userId
      });
      const invertAlphaEssBatteryPowerSign = provider === 'alphaess'
        ? resolveAlphaEssBatterySignInversion(userConfig, status)
        : false;
      data = buildRealtimePayloadFromDeviceStatus(status, resolvedDeviceSN, {
        normalizeToKw: provider === 'alphaess',
        invertBatteryPowerSign: invertAlphaEssBatteryPowerSign
      });
    } else {
      // Fetch fresh data from FoxESS with all required variables
      data = await foxessAPI.callFoxESSAPI('/op/v0/device/real/query', 'POST', {
        sn: resolvedDeviceSN,
        variables: ['generationPower', 'pvPower', 'pv1Power', 'pv2Power', 'pv3Power', 'pv4Power', 'pv1Volt', 'pv2Volt', 'pv3Volt', 'pv4Volt', 'pv1Current', 'pv2Current', 'pv3Current', 'pv4Current', 'meterPower', 'meterPower2', 'feedinPower', 'gridConsumptionPower', 'loadsPower', 'batChargePower', 'batDischargePower', 'SoC', 'SoC1', 'batTemperature', 'ambientTemperation', 'invTemperation', 'boostTemperation']
      }, userConfig, userId);
    }
    
    // Store in cache if successful
    if (data?.errno === 0) {
      await db.collection('users').doc(userId).collection('cache').doc('inverter-realtime').set({
        data,
        timestamp: Date.now(),
        ttlMs,
        provider,
        deviceSN: resolvedDeviceSN,
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
      telemetryTimestampMs: cycleData.telemetryTimestampMs || null,
      telemetryAgeMs: Number.isFinite(Number(cycleData.telemetryAgeMs))
        ? Number(cycleData.telemetryAgeMs)
        : null,
      telemetryStatus: cycleData.telemetryStatus || null,
      telemetryPauseReason: cycleData.telemetryPauseReason || null,
      
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
const teslaHttpClient = createTeslaHttpClient();
const teslaFleetAdapter = new TeslaFleetAdapter({
  httpClient: teslaHttpClient,
  region: process.env.TESLA_FLEET_REGION || 'na',
  logger
});

registerHealthRoutes(app, {
  getUserConfig,
  tryAttachUser
});

registerSetupPublicRoutes(app, {
  alphaEssAPI,
  db,
  foxessAPI,
  getConfig,
  getUserConfig,
  logger,
  serverTimestamp,
  setUserConfig,
  sigenEnergyAPI,
  sungrowAPI,
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

registerEVRoutes(app, {
  admin,
  adapterRegistry,
  authenticateUser,
  db,
  getConfig,
  getUserConfig,
  incrementApiCount,
  logger,
  teslaHttpClient,
  vehiclesRepo
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

function normalizeCouplingValue(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'ac' || raw === 'ac-coupled' || raw === 'ac_coupled') return 'ac';
  if (raw === 'dc' || raw === 'dc-coupled' || raw === 'dc_coupled') return 'dc';
  return 'unknown';
}

const DEFAULT_TOPOLOGY_REFRESH_MS = 4 * 60 * 60 * 1000;

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
  db,
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
  adapterRegistry,
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
  adapterRegistry,
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
  adapterRegistry,
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
  adapterRegistry,
  logger,
  normalizeCouplingValue,
  DEFAULT_TOPOLOGY_REFRESH_MS,
  serverTimestamp,
  setUserConfig
});

registerDeviceReadRoutes(app, {
  authenticateUser,
  adapterRegistry,
  foxessAPI,
  getUserConfig,
  logger
});

registerDiagnosticsReadRoutes(app, {
  adapterRegistry,
  authenticateUser,
  foxessAPI,
  getUserConfig
});

registerDeviceMutationRoutes(app, {
  authenticateUser,
  adapterRegistry,
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
  adapterRegistry,
  foxessAPI,
  getUserConfig,
  tryAttachUser
});

registerSchedulerMutationRoutes(app, {
  adapterRegistry,
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

Object.assign(sungrowAPI, sungrowModule.init({
  db,
  logger,
  getConfig,
  incrementApiCount
}));

Object.assign(sigenEnergyAPI, sigenEnergyModule.init({
  db,
  logger,
  getConfig,
  incrementApiCount
}));

Object.assign(alphaEssAPI, alphaEssModule.init({
  db,
  logger,
  getConfig,
  incrementApiCount
}));

// Register device adapters now that foxessAPI, sungrowAPI, and sigenEnergyAPI are fully initialised
adapterRegistry.registerDeviceProvider('foxess', createFoxessDeviceAdapter({ foxessAPI, logger }));
adapterRegistry.registerDeviceProvider('sungrow', createSungrowDeviceAdapter({ sungrowAPI, logger }));
adapterRegistry.registerDeviceProvider('sigenergy', createSigenEnergyDeviceAdapter({ sigenEnergyAPI, logger }));
adapterRegistry.registerDeviceProvider('alphaess', createAlphaEssDeviceAdapter({ alphaEssAPI, logger }));
adapterRegistry.registerEVProvider('tesla', teslaFleetAdapter);

Object.assign(authAPI, authModule.init({
  admin,
  logger
}));



// NOTE: 404 handler moved to the end of the file so all routes
// declared below (including scheduler user-scoped endpoints)
// are reachable. See end-of-file for the catch-all handler.

// ==================== EXPORT EXPRESS APP AS CLOUD FUNCTION ====================
// Use the broadly-compatible onRequest export to avoid depending on newer SDK features
// NOTE: secrets are bound on the v2 onSchedule export below; api export will need
// migration to v2 onRequest when secrets binding is required for Gen 1 → Gen 2 move.
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
registerInverterHistoryRoutes(app, {
  authenticateUser,
  db,
  foxessAPI,
  getUserConfig,
  adapterRegistry,
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
async function runAutomationHandler(context) {
  return runAutomationSchedulerCycle(context, {
    automationCycleHandler,
    db,
    emitSchedulerMetrics,
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
    timeZone: 'UTC',
    secrets: [_secretSungrowAppKey, _secretSungrowAppSecret]
  },
  runAutomationHandler
);


