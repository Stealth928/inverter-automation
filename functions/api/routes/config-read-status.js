'use strict';

const { getTelemetryMappings } = require('../../lib/telemetry-mappings');

const WRITE_ONLY_SECRET_FIELDS = Object.freeze([
  'alphaessAppSecret',
  'sungrowPassword',
  'sigenPassword'
]);

const TESLA_STATUS_CACHE_MIN_MS = 120000;
const TESLA_STATUS_CACHE_MAX_MS = 10000000;
const TESLA_STATUS_CACHE_DEFAULT_MS = 600000;
const ANNOUNCEMENT_SEVERITIES = new Set(['info', 'success', 'warning', 'danger']);

function trimString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeAnnouncementId(value) {
  const raw = trimString(value);
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || null;
}

function normalizeAnnouncementText(value, maxLength = 4000) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function normalizeUidList(value, maxItems = 200) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]+/);
  const seen = new Set();
  const normalized = [];

  items.forEach((item) => {
    const uid = trimString(item);
    if (!uid || seen.has(uid)) return;
    seen.add(uid);
    normalized.push(uid);
  });

  return normalized.slice(0, maxItems);
}

function normalizeAnnouncementAudience(value) {
  const source = value && typeof value === 'object' ? value : {};
  const parsedAge = Number(source.minAccountAgeDays);
  const minAccountAgeDays = Number.isFinite(parsedAge)
    ? Math.max(0, Math.min(3650, Math.round(parsedAge)))
    : null;

  return {
    requireTourComplete: source.requireTourComplete !== false,
    requireSetupComplete: source.requireSetupComplete !== false,
    requireAutomationEnabled: source.requireAutomationEnabled === true,
    minAccountAgeDays: minAccountAgeDays > 0 ? minAccountAgeDays : null,
    onlyIncludeUids: normalizeUidList(source.onlyIncludeUids),
    includeUids: normalizeUidList(source.includeUids),
    excludeUids: normalizeUidList(source.excludeUids)
  };
}

function normalizeAnnouncementConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const severity = trimString(source.severity);

  return {
    enabled: source.enabled === true,
    id: normalizeAnnouncementId(source.id),
    title: normalizeAnnouncementText(source.title, 160),
    body: normalizeAnnouncementText(source.body, 4000),
    severity: ANNOUNCEMENT_SEVERITIES.has(severity) ? severity : 'info',
    showOnce: source.showOnce !== false,
    audience: normalizeAnnouncementAudience(source.audience)
  };
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date && typeof date.getTime === 'function' ? date.getTime() : null;
  }
  if (Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  return null;
}

function buildClientAnnouncement(value) {
  const normalized = normalizeAnnouncementConfig(value);
  if (!normalized.enabled) return null;
  if (!normalized.title && !normalized.body) return null;
  if (normalized.showOnce && !normalized.id) return null;
  return normalized;
}

function isAnnouncementEligible(announcement, userId, userConfig, userProfile, automationState) {
  if (!announcement || !announcement.enabled) return false;

  const audience = announcement.audience || {};
  const onlyIncludeUids = Array.isArray(audience.onlyIncludeUids) ? audience.onlyIncludeUids : [];
  const includeUids = Array.isArray(audience.includeUids) ? audience.includeUids : [];
  const excludeUids = Array.isArray(audience.excludeUids) ? audience.excludeUids : [];
  const automationEnabled = typeof automationState?.enabled === 'boolean'
    ? automationState.enabled === true
    : userProfile?.automationEnabled === true;

  if (excludeUids.includes(userId)) return false;
  if (onlyIncludeUids.length && !onlyIncludeUids.includes(userId)) return false;

  const forceInclude = includeUids.includes(userId);
  if (forceInclude) return true;

  if (audience.requireTourComplete && !userConfig?.tourComplete) return false;
  if (audience.requireSetupComplete && !userConfig?.setupComplete) return false;
  if (audience.requireAutomationEnabled && automationEnabled !== true) return false;

  if (Number.isFinite(audience.minAccountAgeDays) && audience.minAccountAgeDays > 0) {
    const createdAtMs = toMillis(userProfile?.createdAt);
    if (!createdAtMs) return false;
    const ageMs = Date.now() - createdAtMs;
    if (ageMs < audience.minAccountAgeDays * 24 * 60 * 60 * 1000) {
      return false;
    }
  }

  return true;
}

function sanitizeConfigForClient(userConfig) {
  if (!userConfig || typeof userConfig !== 'object') return {};
  const sanitized = { ...userConfig };
  WRITE_ONLY_SECRET_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) {
      delete sanitized[field];
    }
  });
  return sanitized;
}

function resolveTeslaStatusCacheMs(userConfig, serverConfig) {
  const serverDefaultRaw = Number(serverConfig?.automation?.cacheTtl?.teslaStatus);
  const serverDefault = Number.isFinite(serverDefaultRaw)
    ? Math.round(serverDefaultRaw)
    : TESLA_STATUS_CACHE_DEFAULT_MS;
  const fallback = Math.min(TESLA_STATUS_CACHE_MAX_MS, Math.max(TESLA_STATUS_CACHE_MIN_MS, serverDefault));
  const userValue = Number(userConfig?.cache?.teslaStatus);
  if (!Number.isFinite(userValue)) return fallback;
  const rounded = Math.round(userValue);
  return Math.min(TESLA_STATUS_CACHE_MAX_MS, Math.max(TESLA_STATUS_CACHE_MIN_MS, rounded));
}

function registerConfigReadStatusRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const db = deps.db;
  const DEFAULT_TOPOLOGY_REFRESH_MS = deps.DEFAULT_TOPOLOGY_REFRESH_MS;
  const getAutomationTimezone = deps.getAutomationTimezone;
  const getCachedWeatherData = deps.getCachedWeatherData;
  const getConfig = deps.getConfig;
  const getUserAutomationState = deps.getUserAutomationState;
  const getUserConfig = deps.getUserConfig;
  const getUserConfigPublic = deps.getUserConfigPublic || deps.getUserConfig;
  const getUserRules = deps.getUserRules;
  const getUserTime = deps.getUserTime;
  const logger = deps.logger;
  const normalizeCouplingValue = deps.normalizeCouplingValue;
  const setUserConfig = deps.setUserConfig;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires authenticateUser middleware');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires Firestore db');
  }
  if (!Number.isFinite(Number(DEFAULT_TOPOLOGY_REFRESH_MS))) {
    throw new Error('registerConfigReadStatusRoutes requires DEFAULT_TOPOLOGY_REFRESH_MS');
  }
  if (typeof getAutomationTimezone !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getAutomationTimezone()');
  }
  if (typeof getCachedWeatherData !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getCachedWeatherData()');
  }
  if (typeof getConfig !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getConfig()');
  }
  if (typeof getUserAutomationState !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getUserAutomationState()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getUserConfig()');
  }
  if (typeof getUserConfigPublic !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getUserConfigPublic()');
  }
  if (typeof getUserRules !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getUserRules()');
  }
  if (typeof getUserTime !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires getUserTime()');
  }
  if (!logger || typeof logger.debug !== 'function' || typeof logger.warn !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires logger.debug()/warn()');
  }
  if (typeof normalizeCouplingValue !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires normalizeCouplingValue()');
  }
  if (typeof setUserConfig !== 'function') {
    throw new Error('registerConfigReadStatusRoutes requires setUserConfig()');
  }

  const buildResponseConfig = (userConfig, serverConfig) => ({
    automation: {
      intervalMs: (userConfig?.automation?.intervalMs) || serverConfig.automation.intervalMs
    },
    cache: {
      amber: (userConfig?.cache?.amber) || serverConfig.automation.cacheTtl.amber,
      inverter: (userConfig?.automation?.inverterCacheTtlMs) || serverConfig.automation.cacheTtl.inverter,
      weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather,
      teslaStatus: resolveTeslaStatusCacheMs(userConfig, serverConfig)
    },
    defaults: {
      cooldownMinutes: (userConfig?.defaults?.cooldownMinutes) || 5,
      durationMinutes: (userConfig?.defaults?.durationMinutes) || 30
    }
  });

  const resolveBlackoutStatus = (userConfig, currentMinutes) => {
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    let inBlackout = false;
    let currentBlackoutWindow = null;
    for (const window of blackoutWindows) {
      // Treat windows without explicit enabled property as enabled by default.
      if (window.enabled === false) continue;
      const [startH, startM] = (window.start || '00:00').split(':').map(Number);
      const [endH, endM] = (window.end || '00:00').split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      // Handle windows that cross midnight.
      if (startMins <= endMins) {
        if (currentMinutes >= startMins && currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      } else if (currentMinutes >= startMins || currentMinutes < endMins) {
        inBlackout = true;
        currentBlackoutWindow = window;
        break;
      }
    }

    return {
      inBlackout,
      currentBlackoutWindow
    };
  };

  const syncAutomationEnabledMirror = async (userId, state) => {
    if (!state || typeof state.enabled !== 'boolean') return;
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
      // Non-critical - do not fail the status request.
      console.warn('[Migration] Failed to sync automationEnabled flag:', migErr.message);
    }
  };

  // Get user config
  app.get('/api/config', async (req, res) => {
    try {
      if (!req.user || !req.user.uid) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      const userConfig = await getUserConfig(req.user.uid);
      const serverConfig = getConfig();
      const config = buildResponseConfig(userConfig, serverConfig);

      const configResponse = sanitizeConfigForClient(userConfig);

      // Set cache headers: revalidate on every request but allow 304 Not Modified responses
      // This means browser will check with server each time, but gets instant 304 if unchanged
      res.set('Cache-Control', 'no-cache, must-revalidate');
      res.json({ errno: 0, result: { ...configResponse, config } });
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
      const userConfig = await getUserConfigPublic(userId);
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

  // Get persisted telemetry mapping overrides used to normalize vendor-specific fields.
  app.get('/api/config/telemetry-mappings', async (req, res) => {
    try {
      const userId = req.user.uid;
      const userConfig = await getUserConfigPublic(userId);
      const telemetryMappings = getTelemetryMappings(userConfig);

      res.json({
        errno: 0,
        result: telemetryMappings
      });
    } catch (error) {
      console.error('[Config] Error getting telemetry mappings:', error.message);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // GET /api/config/tour-status - return tourComplete flag for the current user
  app.get('/api/config/tour-status', authenticateUser, async (req, res) => {
    try {
      const config = await getUserConfigPublic(req.user.uid);
      res.json({
        errno: 0,
        result: {
          tourComplete: !!(config && config.tourComplete),
          tourCompletedAt: (config && config.tourCompletedAt) || null
        }
      });
    } catch (error) {
      console.error('[API] /api/config/tour-status GET error:', error && error.stack ? error.stack : String(error));
      res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });

  app.get('/api/config/announcement', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const [userConfig, sharedDoc, userProfileDoc, automationState] = await Promise.all([
        getUserConfigPublic(userId),
        db.collection('shared').doc('serverConfig').get(),
        db.collection('users').doc(userId).get(),
        getUserAutomationState(userId)
      ]);

      const userProfile = userProfileDoc.exists ? (userProfileDoc.data() || {}) : {};
      const sharedConfig = sharedDoc.exists ? (sharedDoc.data() || {}) : {};
      const announcement = buildClientAnnouncement(sharedConfig.announcement);
      const dismissedIds = normalizeUidList(userConfig?.announcementDismissedIds, 500);

      if (!announcement || !isAnnouncementEligible(announcement, userId, userConfig, userProfile, automationState)) {
        return res.json({ errno: 0, result: { announcement: null } });
      }

      if (announcement.showOnce && announcement.id && dismissedIds.includes(announcement.id)) {
        return res.json({ errno: 0, result: { announcement: null } });
      }

      return res.json({ errno: 0, result: { announcement } });
    } catch (error) {
      console.error('[API] /api/config/announcement GET error:', error && error.stack ? error.stack : String(error));
      return res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });

  // Lightweight automation status for polling paths.
  // Intentionally avoids full rules/secrets/weather-sync reads.
  app.get('/api/automation/status-summary', async (req, res) => {
    try {
      const userId = req.user.uid;
      const [state, userConfig] = await Promise.all([
        getUserAutomationState(userId),
        getUserConfigPublic(userId)
      ]);
      const serverConfig = getConfig();
      const statePayload = state && typeof state === 'object' ? state : {};

      await syncAutomationEnabledMirror(userId, statePayload);

      const config = buildResponseConfig(userConfig, serverConfig);
      const userTimezone = getAutomationTimezone(userConfig);
      const userTime = getUserTime(userTimezone);
      const currentMinutes = userTime.hour * 60 + userTime.minute;
      const blackoutStatus = resolveBlackoutStatus(userConfig, currentMinutes);

      return res.json({
        errno: 0,
        result: {
          ...statePayload,
          enabled: statePayload.enabled === true,
          serverTime: Date.now(),
          userTimezone,
          nextCheckIn: config.automation.intervalMs,
          inBlackout: blackoutStatus.inBlackout,
          currentBlackoutWindow: blackoutStatus.currentBlackoutWindow,
          config
        }
      });
    } catch (error) {
      return res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Get automation state
  app.get('/api/automation/status', async (req, res) => {
    try {
      const userId = req.user.uid;
      const [state, rules, initialUserConfig] = await Promise.all([
        getUserAutomationState(userId),
        getUserRules(userId),
        getUserConfig(userId)
      ]);
      let userConfig = initialUserConfig;
      const serverConfig = getConfig();

      await syncAutomationEnabledMirror(userId, state);

      // Aggressive timezone sync: fetch weather to ensure timezone matches location.
      if (userConfig?.location) {
        try {
          const weatherData = await getCachedWeatherData(userId, userConfig.location, 1);
          if (weatherData?.result?.place?.timezone) {
            const weatherTimezone = weatherData.result.place.timezone;
            if (userConfig.timezone !== weatherTimezone) {
              await setUserConfig(userId, { timezone: weatherTimezone }, { merge: true });
              userConfig.timezone = weatherTimezone;
            }
          }
        } catch (_err) {
          // Silently handle timezone sync failures; use existing timezone
        }
      }

      // Use user's timezone for blackout window check
      const userTimezone = getAutomationTimezone(userConfig);
      const userTime = getUserTime(userTimezone);
      const currentMinutes = userTime.hour * 60 + userTime.minute;
      const blackoutStatus = resolveBlackoutStatus(userConfig, currentMinutes);
      const config = buildResponseConfig(userConfig, serverConfig);

      res.json({
        errno: 0,
        result: {
          ...state,
          rules,
          serverTime: Date.now(),
          userTimezone, // Include user's timezone so frontend can format times correctly
          nextCheckIn: config.automation.intervalMs,
          inBlackout: blackoutStatus.inBlackout,
          currentBlackoutWindow: blackoutStatus.currentBlackoutWindow,
          config // Return user-specific configuration
        }
      });
    } catch (error) {
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerConfigReadStatusRoutes
};
