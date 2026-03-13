'use strict';

const WRITE_ONLY_SECRET_FIELDS = Object.freeze([
  'alphaessAppSecret',
  'sungrowPassword',
  'sigenPassword'
]);

const TESLA_STATUS_CACHE_MIN_MS = 120000;
const TESLA_STATUS_CACHE_MAX_MS = 10000000;
const TESLA_STATUS_CACHE_DEFAULT_MS = 600000;

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
          weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather,
          teslaStatus: resolveTeslaStatusCacheMs(userConfig, serverConfig)
        },
        defaults: {
          cooldownMinutes: (userConfig?.defaults?.cooldownMinutes) || 5,
          durationMinutes: (userConfig?.defaults?.durationMinutes) || 30
        }
      };

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

  // GET /api/config/tour-status - return tourComplete flag for the current user
  app.get('/api/config/tour-status', authenticateUser, async (req, res) => {
    try {
      const config = await getUserConfig(req.user.uid);
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
        } else if (currentMinutes >= startMins || currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
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
          weather: (userConfig?.cache?.weather) || serverConfig.automation.cacheTtl.weather,
          teslaStatus: resolveTeslaStatusCacheMs(userConfig, serverConfig)
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
          userTimezone, // Include user's timezone so frontend can format times correctly
          nextCheckIn: config.automation.intervalMs,
          inBlackout,
          currentBlackoutWindow,
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
