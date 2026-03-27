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
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { AsyncLocalStorage } = require('async_hooks');
const admin = require('firebase-admin');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const {
  evaluateTemperatureCondition,
  evaluateTimeCondition,
  isForecastTemperatureType,
  normalizeWeekdays
} = require('./lib/automation-conditions');
const { createAdminAccess, DEFAULT_SEED_ADMIN_EMAIL } = require('./lib/admin-access');
const {
  buildFirestoreQuotaSummary,
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
const { registerNotificationRoutes } = require('./api/routes/notifications');
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
const { createApiRateLimiter } = require('./lib/services/api-rate-limiter');
const { createApiMetricsService } = require('./lib/services/api-metrics-service');
const { createAutomationRuleActionService } = require('./lib/services/automation-rule-action-service');
const { createAutomationRuleEvaluationService } = require('./lib/services/automation-rule-evaluation-service');
const { createCurtailmentService } = require('./lib/services/curtailment-service');
const { createQuickControlService } = require('./lib/services/quick-control-service');
const { createNotificationsService } = require('./lib/services/notifications-service');
const { createSchedulerSloAlertNotifier } = require('./lib/services/scheduler-slo-alert-notifier');
const { createWeatherService } = require('./lib/services/weather-service');
const { createCacheMetricsService } = require('./lib/services/cache-metrics-service');
const { createStructuredLogger } = require('./lib/structured-logger');
const { parseAutomationTelemetry } = require('./lib/device-telemetry');
const { getCurrentAmberPrices } = require('./lib/pricing-normalization');
const { createAutomationStateRepository } = require('./lib/repositories/automation-state-repository');
const { createUserAutomationRepository } = require('./lib/repositories/user-automation-repository');
const { createVehiclesRepository } = require('./lib/repositories/vehicles-repository');
const { buildAlphaEssDiagnostics, logAlphaEssDiagnostics } = require('./lib/alphaess-diagnostics');
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
const aemoModule = require('./api/aemo');
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

const aemoAPI = aemoModule.init({
  db,
  logger: null, // Will be defined below
  getConfig: null, // Will be defined below
  incrementApiCount: null, // Will be defined below
  serverTimestamp
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
const { createAmberTariffAdapter } = require('./lib/adapters/amber-adapter');
const { createAemoTariffAdapter } = require('./lib/adapters/aemo-adapter');
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
const _secretGithubDataworksToken = defineSecret('GITHUB_DATAWORKS_TOKEN');
const _secretWebPushVapidPublicKey = defineSecret('WEB_PUSH_VAPID_PUBLIC_KEY');
const _secretWebPushVapidPrivateKey = defineSecret('WEB_PUSH_VAPID_PRIVATE_KEY');
const _secretWebPushVapidSubject = defineSecret('WEB_PUSH_VAPID_SUBJECT');

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
        aemo: 60000,       // 60 seconds
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
const requestContextStorage = new AsyncLocalStorage();
const logger = createStructuredLogger({
  service: 'automation-api',
  debugEnabled: DEBUG,
  verboseEnabled: VERBOSE,
  storage: requestContextStorage,
  consoleImpl: console
});
const amberTariffAdapter = createAmberTariffAdapter({ amberAPI, amberPricesInFlight, logger });
const aemoTariffAdapter = createAemoTariffAdapter({ aemoAPI });
const cacheMetrics = createCacheMetricsService();
const apiRateLimiter = createApiRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => {
    const authHeader = String(req.headers?.authorization || '').trim();
    if (authHeader) {
      return `auth:${crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 16)}`;
    }
    return `ip:${req.ip || req.headers?.['x-forwarded-for'] || 'anonymous'}`;
  },
  skip: (req) => req.path === '/api/health' || req.path === '/api/health/auth'
});

const {
  addHistoryEntry,
  clearRulesLastTriggered,
  deleteUserRule,
  getHistoryEntries: getUserHistoryEntries,
  getUserConfig,
  getUserConfigPublic,
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

const weatherService = createWeatherService({
  cacheMetrics,
  db,
  getConfig,
  incrementApiCount,
  logger,
  setUserConfig
});

const {
  callWeatherAPI,
  getCachedWeatherData
} = weatherService;

const UPSTREAM_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
let upstreamHealthSnapshotCache = {
  expiresAtMs: 0,
  payload: null,
  pending: null
};

function summarizePassiveCircuit(provider, circuitState) {
  const state = circuitState && typeof circuitState === 'object'
    ? circuitState
    : { name: provider, state: 'unknown' };
  return {
    status: state.state === 'open' ? 'DEGRADED' : 'OK',
    ok: state.state !== 'open',
    mode: 'passive',
    circuit: state
  };
}

async function getUpstreamHealthSnapshot({ forceRefresh = false } = {}) {
  const nowMs = Date.now();
  if (!forceRefresh && upstreamHealthSnapshotCache.payload && upstreamHealthSnapshotCache.expiresAtMs > nowMs) {
    return {
      ...upstreamHealthSnapshotCache.payload,
      cache: { hit: true, ttlMs: UPSTREAM_HEALTH_CACHE_TTL_MS }
    };
  }

  if (!forceRefresh && upstreamHealthSnapshotCache.pending) {
    return upstreamHealthSnapshotCache.pending;
  }

  const pending = Promise.resolve().then(async () => {
    const weatherStatus = typeof weatherService.probeWeatherService === 'function'
      ? await weatherService.probeWeatherService()
      : {
          status: 'unknown',
          ok: null,
          circuit: weatherService.getCircuitState ? weatherService.getCircuitState() : null
        };
    const foxessStatus = summarizePassiveCircuit('foxess', foxessAPI.getCircuitState ? foxessAPI.getCircuitState() : null);
    const sungrowStatus = summarizePassiveCircuit('sungrow', sungrowAPI.getCircuitState ? sungrowAPI.getCircuitState() : null);
    const services = {
      foxess: foxessStatus,
      sungrow: sungrowStatus,
      weather: {
        ...weatherStatus,
        status: String(weatherStatus.status || 'unknown').toUpperCase()
      }
    };
    const degraded = Object.values(services).some((service) => service && service.ok === false);
    const payload = {
      status: degraded ? 'DEGRADED' : 'OK',
      checkedAtMs: Date.now(),
      services
    };

    upstreamHealthSnapshotCache = {
      expiresAtMs: Date.now() + UPSTREAM_HEALTH_CACHE_TTL_MS,
      payload,
      pending: null
    };

    return {
      ...payload,
      cache: { hit: false, ttlMs: UPSTREAM_HEALTH_CACHE_TTL_MS }
    };
  }).finally(() => {
    upstreamHealthSnapshotCache.pending = null;
  });

  upstreamHealthSnapshotCache.pending = pending;
  return pending;
}

const {
  checkAndApplyCurtailment
} = createCurtailmentService({
  db,
  foxessAPI,
  getCurrentAmberPrices
});

const notificationsService = createNotificationsService({
  db,
  logger,
  seedAdminEmail: DEFAULT_SEED_ADMIN_EMAIL,
  serverTimestamp,
  pushConfig: {
    vapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.WEB_PUSH_VAPID_SUBJECT || ''
  }
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

const emitSchedulerSloAlert = async (alert = {}) => {
  await notifySchedulerSloAlert(alert);
  const alertStatus = String(alert?.alertStatus || alert?.status || '').trim().toLowerCase();
  if (alertStatus !== 'breach') return;

  await notificationsService.sendAdminSystemAlert({
    eventType: 'scheduler_breach',
    stateSignature: 'scheduler',
    title: 'Scheduler breach detected',
    body: 'Scheduler SLO status moved to breach. Review scheduler metrics and dead letters in admin.',
    severity: 'danger',
    deepLink: '/admin.html#scheduler'
  });
};

const schedulerSloThresholdConfig = getConfig()?.automation?.scheduler?.slo || {};
const {
  emitSchedulerMetrics
} = createAutomationSchedulerMetricsSink({
  db,
  logger,
  onSloAlert: emitSchedulerSloAlert,
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

function isEmulatorRuntime() {
  return Boolean(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
}

async function getCachedInverterData(userId, deviceSN, userConfig, forceRefresh = false) {
  const config = getConfig();
  const ttlMs = resolveInverterCacheTtlMs(userConfig, config?.automation?.cacheTtl?.inverter, { preferRealtime: false });
  const resolved = resolveProviderDeviceId(userConfig, deviceSN);
  const provider = String(resolved.provider || 'foxess').toLowerCase().trim();
  const resolvedDeviceSN = resolved.deviceId;
  const emulatorRuntime = isEmulatorRuntime();
  
  try {
    if (!resolvedDeviceSN) {
      return { errno: 400, error: 'Device SN not configured' };
    }

    // In emulator mode, keep seeded cache authoritative even after TTL expiry or manual refresh.
    if (!forceRefresh || emulatorRuntime) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter').get();
      if (cacheDoc.exists) {
        const cachePayload = cacheDoc.data() || {};
        const { data, timestamp } = cachePayload;
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs && isMatchingProviderCacheEntry(cachePayload, provider, resolvedDeviceSN)) {
          cacheMetrics.record({ source: 'inverter', outcome: 'hit' });
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
        if (emulatorRuntime && data && isMatchingProviderCacheEntry(cachePayload, provider, resolvedDeviceSN)) {
          cacheMetrics.record({ source: 'inverter', outcome: 'hit' });
          return {
            ...data,
            __cacheHit: true,
            __cacheAgeMs: ageMs,
            __cacheTtlMs: ttlMs,
            __cacheStale: ageMs >= ttlMs,
            __emulatorSeedFallback: true
          };
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
        cacheMetrics.record({ source: 'inverter', outcome: 'error' });
        logger.warn(`[Cache] Failed to store inverter cache: ${cacheErr.message}`);
      });
      cacheMetrics.record({ source: 'inverter', outcome: 'write', operation: 'write' });
    }

    cacheMetrics.record({ source: 'inverter', outcome: 'miss' });
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    cacheMetrics.record({ source: 'inverter', outcome: 'error' });
    logger.error(`[Cache] Error in getCachedInverterData: ${err.message}`);
    return { errno: 500, error: err.message };
  }
}

// ==================== CACHED REAL-TIME INVERTER DATA ====================
/**
 * Get full real-time inverter data with per-user Firestore cache.
 * Includes all variables needed for the dashboard display.
 * Respects TTL (default 5 minutes for real-time, configurable via user config).
 */
async function getCachedInverterRealtimeData(userId, deviceSN, userConfig, forceRefresh = false, options = {}) {
  const config = getConfig();
  const ttlMs = resolveInverterCacheTtlMs(userConfig, config?.automation?.cacheTtl?.inverter || 300000, { preferRealtime: true });
  const resolved = resolveProviderDeviceId(userConfig, deviceSN);
  const provider = String(resolved.provider || 'foxess').toLowerCase().trim();
  const resolvedDeviceSN = resolved.deviceId;
  const emulatorRuntime = isEmulatorRuntime();
  const diagnosticsOptions = options && typeof options === 'object' ? options : {};
  const diagnosticsLogger = diagnosticsOptions.logger || console;
  
  try {
    if (!resolvedDeviceSN) {
      return { errno: 400, error: 'Device SN not configured' };
    }

    // In emulator mode, keep seeded cache authoritative even after TTL expiry or manual refresh.
    if (!forceRefresh || emulatorRuntime) {
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter-realtime').get();
      if (cacheDoc.exists) {
        const cachePayload = cacheDoc.data() || {};
        const { data, timestamp } = cachePayload;
        const ageMs = Date.now() - timestamp;
        if (ageMs < ttlMs && isMatchingProviderCacheEntry(cachePayload, provider, resolvedDeviceSN)) {
          cacheMetrics.record({ source: 'inverter-realtime', outcome: 'hit' });
          return { ...data, __cacheHit: true, __cacheAgeMs: ageMs, __cacheTtlMs: ttlMs };
        }
        if (emulatorRuntime && data && isMatchingProviderCacheEntry(cachePayload, provider, resolvedDeviceSN)) {
          cacheMetrics.record({ source: 'inverter-realtime', outcome: 'hit' });
          return {
            ...data,
            __cacheHit: true,
            __cacheAgeMs: ageMs,
            __cacheTtlMs: ttlMs,
            __cacheStale: ageMs >= ttlMs,
            __emulatorSeedFallback: true
          };
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
      if (provider === 'alphaess') {
        data.alphaessDiagnostics = buildAlphaEssDiagnostics({
          route: diagnosticsOptions.route || 'inverter-real-time',
          status,
          userConfig,
          userId,
          userEmail: diagnosticsOptions.userEmail || null,
          deviceSN: resolvedDeviceSN,
          invertBatteryPowerSign: invertAlphaEssBatteryPowerSign
        });
        logAlphaEssDiagnostics(diagnosticsLogger, data.alphaessDiagnostics, {
          mode: diagnosticsOptions.alphaessLogMode || 'suspicious-only'
        });
      }
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
        cacheMetrics.record({ source: 'inverter-realtime', outcome: 'error' });
        logger.warn(`[Cache] Failed to store inverter realtime cache: ${cacheErr.message}`);
      });
      cacheMetrics.record({ source: 'inverter-realtime', outcome: 'write', operation: 'write' });
    }

    cacheMetrics.record({ source: 'inverter-realtime', outcome: 'miss' });
    return { ...data, __cacheHit: false, __cacheAgeMs: 0, __cacheTtlMs: ttlMs };
  } catch (err) {
    cacheMetrics.record({ source: 'inverter-realtime', outcome: 'error' });
    logger.error(`[Cache] Error in getCachedInverterRealtimeData: ${err.message}`);
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
const allowedCorsOrigins = new Set([
  'https://socratesautomation.com',
  'https://www.socratesautomation.com'
]);

function resolveRequestId(req) {
  const explicitId = req.get('x-request-id') || req.get('x-correlation-id');
  if (explicitId) {
    return String(explicitId).trim().slice(0, 128);
  }

  const cloudTrace = req.get('x-cloud-trace-context');
  if (cloudTrace) {
    return String(cloudTrace).split('/')[0].trim().slice(0, 128);
  }

  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    try {
      const parsedOrigin = new URL(origin);
      const normalizedOrigin = parsedOrigin.origin.toLowerCase();
      const hostname = String(parsedOrigin.hostname || '').toLowerCase();
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

      callback(null, allowedCorsOrigins.has(normalizedOrigin) || isLocalhost);
      return;
    } catch (_error) {
      callback(null, false);
      return;
    }
  }
}));
app.use((req, res, next) => {
  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  requestContextStorage.run({
    requestId,
    path: req.path,
    method: req.method
  }, next);
});
app.use('/api', apiRateLimiter);
// Simple request logger (controlled by VERBOSE_API environment variable)
app.use((req, res, next) => {
  try {
    if (VERBOSE_API) {
      logger.debug('API', `requestId=${req.requestId} ${req.method} ${req.path}`);
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
  getUserConfigPublic,
  getUpstreamHealthSnapshot,
  tryAttachUser
});

registerSetupPublicRoutes(app, {
  alphaEssAPI,
  db,
  foxessAPI,
  getConfig,
  getUserConfig,
  getUserConfigPublic,
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
  aemoAPI,
  authenticateUser,
  getUserConfig,
  incrementApiCount,
  logger,
  tryAttachUser
});

registerMetricsRoutes(app, {
  db,
  getAusDateKey,
  isAdmin,
  logger,
  tryAttachUser
});

// ==================== ADMIN API ENDPOINTS ====================
// All admin routes use authenticateUser + requireAdmin explicitly so they
// are registered before the catch-all app.use('/api', authenticateUser).
const getRuntimeProjectIdForAdmin = () => getRuntimeProjectId(admin);
const fetchCloudBillingCostForAdmin = (projectId) => fetchCloudBillingCost(projectId, { googleApis });
let automationCycleHandler = null;
let adminRouteHelpers = {};

adminRouteHelpers = registerAdminRoutes(app, {
  admin,
  authenticateUser,
  buildFirestoreQuotaSummary,
  db,
  deleteCollectionDocs,
  deleteUserDataTree,
  estimateFirestoreCostFromUsage,
  fetchCloudBillingCost: fetchCloudBillingCostForAdmin,
  getCacheMetricsSnapshot: () => cacheMetrics.getSnapshot(),
  getRuntimeProjectId: getRuntimeProjectIdForAdmin,
  googleApis,
  isAdmin,
  listMonitoringTimeSeries,
  normalizeCouplingValue,
  normalizeMetricErrorMessage,
  requireAdmin,
  SEED_ADMIN_EMAIL,
  serverTimestamp,
  sumSeriesValues,
  githubDataworks: {
    owner: process.env.GITHUB_DATAWORKS_OWNER || 'Stealth928',
    repo: process.env.GITHUB_DATAWORKS_REPO || 'inverter-automation',
    workflowId: process.env.GITHUB_DATAWORKS_WORKFLOW || 'aemo-market-insights-delta.yml',
    ref: process.env.GITHUB_DATAWORKS_REF || '',
    refMode: process.env.GITHUB_DATAWORKS_REF_MODE || 'auto',
    dispatchToken: process.env.GITHUB_DATAWORKS_TOKEN || ''
  },
  getAutomationCycleHandler: () => automationCycleHandler,
  notificationsService
}) || {};

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
  sendAdminSystemAlert: async (payload) => notificationsService.sendAdminSystemAlert(payload),
  serverTimestamp,
  setUserConfig
});

registerNotificationRoutes(app, {
  authenticateUser,
  notificationsService
});

registerEVRoutes(app, {
  admin,
  adapterRegistry,
  authenticateUser,
  db,
  deleteField,
  getConfig,
  getUserConfig,
  incrementApiCount,
  logger,
  requireAdmin,
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
  getUserConfigPublic,
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

automationCycleHandler = registerAutomationCycleRoute(app, {
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
  emitAutomationNotification: async (userId, payload) => notificationsService.emitEventNotification(userId, payload),
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
  cacheMetrics,
  db,
  logger,
  getConfig,
  incrementApiCount
}));

Object.assign(aemoAPI, aemoModule.init({
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

// Register adapters now that provider APIs are fully initialised.
adapterRegistry.registerTariffProvider('amber', amberTariffAdapter);
adapterRegistry.registerTariffProvider('aemo', aemoTariffAdapter);
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
exports.api = onRequest(
  {
    timeoutSeconds: 60,
    maxInstances: 20,
    memory: '512MiB',
    secrets: [
      _secretTeslaProxyUrl,
      _secretTeslaProxyToken,
      _secretGithubDataworksToken,
      _secretWebPushVapidPublicKey,
      _secretWebPushVapidPrivateKey,
      _secretWebPushVapidSubject
    ]
  },
  app
);

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
    getUserConfigPublic,
    getUserRules,
    isTimeInRange,
    logger: console
  });
}

async function refreshAemoLiveSnapshotsHandler(_context) {
  const results = await aemoAPI.refreshAllCurrentPriceData({});
  const failures = results.filter((result) => !!result?.error);
  const updated = results.filter((result) => result && result.updated === true);
  const skipped = results.filter((result) => result && result.updated === false && !result.error);

  console.log(
    '[AEMO] Live snapshot refresh completed: updated=%s skipped=%s failed=%s',
    updated.length,
    skipped.length,
    failures.length
  );

  results.forEach((result) => {
    if (!result) return;
    if (result.error) {
      console.error(
        '[AEMO] Snapshot refresh failed for %s: %s',
        result.regionId || 'unknown',
        result.error
      );
      return;
    }
    console.log(
      '[AEMO] Snapshot refresh %s region=%s previousAsOf=%s currentAsOf=%s',
      result.updated ? 'stored' : 'skipped',
      result.regionId || 'unknown',
      result.previousAsOf || '-',
      result.currentAsOf || '-'
    );
  });

  if (failures.length > 0) {
    throw new Error(`AEMO live snapshot refresh failed for ${failures.length} region(s)`);
  }
}

async function runAdminOperationalAlertsHandler(_context) {
  const schedulerAlertSnapshot = await db
    .collection('metrics')
    .doc('automationScheduler')
    .collection('alerts')
    .doc('current')
    .get();

  const schedulerAlert = schedulerAlertSnapshot.exists
    ? (schedulerAlertSnapshot.data() || {})
    : { status: 'healthy' };

  let dataworks = {};
  try {
    if (adminRouteHelpers && typeof adminRouteHelpers.loadGithubWorkflowOps === 'function') {
      dataworks = await adminRouteHelpers.loadGithubWorkflowOps(false);
    }
  } catch (error) {
    dataworks = {
      error: error?.message || String(error)
    };
  }

  let apiHealth = {};
  try {
    if (adminRouteHelpers && typeof adminRouteHelpers.loadAdminApiHealth === 'function') {
      apiHealth = await adminRouteHelpers.loadAdminApiHealth({
        days: 30,
        forceRefresh: false
      });
    }
  } catch (error) {
    apiHealth = {
      healthStatus: 'unknown',
      error: error?.message || String(error)
    };
  }

  const evaluation = await notificationsService.evaluateAndSendAdminOperationalAlerts({
    schedulerAlert: {
      status: schedulerAlert.status || schedulerAlert.alertStatus || 'healthy',
      schedulerId: schedulerAlert.schedulerId || null,
      runId: schedulerAlert.runId || null,
      dayKey: schedulerAlert.dayKey || null
    },
    dataworks: {
      latestRun: dataworks.latestRun || null,
      error: dataworks.error || null
    },
    apiHealth: {
      healthStatus: apiHealth?.summary?.healthStatus || apiHealth?.healthStatus || apiHealth?.status || 'good'
    }
  });

  console.log(
    '[AdminAlerts] Evaluation complete: scheduler=%s dataworks=%s apiHealth=%s triggered=%s',
    evaluation?.evaluatedSignals?.schedulerStatus || 'unknown',
    evaluation?.evaluatedSignals?.dataworksStatus || 'unknown',
    evaluation?.evaluatedSignals?.apiHealthStatus || 'unknown',
    Number(evaluation?.triggered || 0)
  );
  return evaluation;
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

exports.refreshAemoLiveSnapshots = onSchedule(
  {
    schedule: '1-59/5 * * * *',
    timeZone: 'Australia/Brisbane',
    memory: '512MiB'
  },
  refreshAemoLiveSnapshotsHandler
);

exports.runAdminOperationalAlerts = onSchedule(
  {
    schedule: '2-59/5 * * * *',
    timeZone: 'UTC'
  },
  runAdminOperationalAlertsHandler
);
