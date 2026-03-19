'use strict';

const { normalizeTelemetryMappings } = require('../../lib/telemetry-mappings');

const WRITE_ONLY_SECRET_FIELDS = Object.freeze([
  'alphaessAppSecret',
  'sungrowPassword',
  'sigenPassword'
]);

const TESLA_STATUS_CACHE_MIN_MS = 120000;
const TESLA_STATUS_CACHE_MAX_MS = 10000000;

function stripWriteOnlySecrets(config) {
  if (!config || typeof config !== 'object') return config;
  const sanitized = { ...config };
  WRITE_ONLY_SECRET_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(sanitized, field)) {
      delete sanitized[field];
    }
  });
  return sanitized;
}

function registerConfigMutationRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const callWeatherAPI = deps.callWeatherAPI;
  const deepMerge = deps.deepMerge;
  const deleteField = deps.deleteField;
  const db = deps.db;
  const isValidTimezone = deps.isValidTimezone;
  const normalizeCouplingValue = deps.normalizeCouplingValue;
  const serverTimestamp = deps.serverTimestamp;
  const setUserConfig = deps.setUserConfig;
  const updateUserConfig = deps.updateUserConfig;
  const getUserConfig = deps.getUserConfig;
  const DEFAULT_TOPOLOGY_REFRESH_MS = deps.DEFAULT_TOPOLOGY_REFRESH_MS;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerConfigMutationRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerConfigMutationRoutes requires authenticateUser middleware');
  }
  if (typeof callWeatherAPI !== 'function') {
    throw new Error('registerConfigMutationRoutes requires callWeatherAPI()');
  }
  if (typeof deepMerge !== 'function') {
    throw new Error('registerConfigMutationRoutes requires deepMerge()');
  }
  if (typeof deleteField !== 'function') {
    throw new Error('registerConfigMutationRoutes requires deleteField()');
  }
  if (typeof isValidTimezone !== 'function') {
    throw new Error('registerConfigMutationRoutes requires isValidTimezone()');
  }
  if (typeof normalizeCouplingValue !== 'function') {
    throw new Error('registerConfigMutationRoutes requires normalizeCouplingValue()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerConfigMutationRoutes requires serverTimestamp()');
  }
  if (typeof setUserConfig !== 'function') {
    throw new Error('registerConfigMutationRoutes requires setUserConfig()');
  }
  if (typeof updateUserConfig !== 'function') {
    throw new Error('registerConfigMutationRoutes requires updateUserConfig()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerConfigMutationRoutes requires getUserConfig()');
  }
  if (!Number.isFinite(DEFAULT_TOPOLOGY_REFRESH_MS)) {
    throw new Error('registerConfigMutationRoutes requires DEFAULT_TOPOLOGY_REFRESH_MS');
  }

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

      await setUserConfig(userId, {
        systemTopology
      }, { merge: true });

      res.json({ errno: 0, msg: 'System topology saved', result: systemTopology });
    } catch (error) {
      console.error('[Config] Error saving system topology:', error.message);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Persist telemetry mapping overrides for vendor-specific realtime/history fields.
  app.post('/api/config/telemetry-mappings', async (req, res) => {
    try {
      const userId = req.user.uid;
      const telemetryMappings = normalizeTelemetryMappings(req.body || {});

      await setUserConfig(userId, {
        telemetryMappings: {
          ...telemetryMappings,
          updatedAt: serverTimestamp()
        }
      }, { merge: true });

      res.json({
        errno: 0,
        msg: 'Telemetry mappings saved',
        result: telemetryMappings
      });
    } catch (error) {
      console.error('[Config] Error saving telemetry mappings:', error.message);
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

      if (Object.prototype.hasOwnProperty.call(newConfig, 'cache') && newConfig.cache && typeof newConfig.cache === 'object') {
        if (Object.prototype.hasOwnProperty.call(newConfig.cache, 'teslaStatus')) {
          const teslaStatusMs = Number(newConfig.cache.teslaStatus);
          if (!Number.isFinite(teslaStatusMs)) {
            return res.status(400).json({ errno: 400, error: 'Tesla status cache must be a numeric millisecond value' });
          }
          const roundedTtl = Math.round(teslaStatusMs);
          if (roundedTtl < TESLA_STATUS_CACHE_MIN_MS || roundedTtl > TESLA_STATUS_CACHE_MAX_MS) {
            return res.status(400).json({
              errno: 400,
              error: `Tesla status cache must be between ${TESLA_STATUS_CACHE_MIN_MS} and ${TESLA_STATUS_CACHE_MAX_MS} milliseconds`
            });
          }
          newConfig.cache.teslaStatus = roundedTtl;
        }
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
          console.error('[Config] Failed to detect timezone from location:', err.message);
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
      const sanitizedMergedConfig = stripWriteOnlySecrets(mergedConfig);

      // Persist to Firestore under user's config/main
      await setUserConfig(userId, sanitizedMergedConfig, { merge: true });
      return res.json({ errno: 0, msg: 'Config saved', result: sanitizedMergedConfig });
    } catch (error) {
      console.error('[API] /api/config save error:', error && error.stack ? error.stack : String(error));
      return res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });

  // Clear credentials and provider-specific identity fields from user config.
  app.post('/api/config/clear-credentials', authenticateUser, async (req, res) => {
    try {
      const updates = {
        deviceSn: deleteField(),
        foxessToken: deleteField(),
        alphaessSystemSn: deleteField(),
        alphaessSysSn: deleteField(),
        alphaessAppId: deleteField(),
        alphaessAppSecret: deleteField(),
        sungrowUsername: deleteField(),
        sungrowPassword: deleteField(),
        sungrowToken: deleteField(),
        sungrowUid: deleteField(),
        sungrowDeviceSn: deleteField(),
        sigenUsername: deleteField(),
        sigenPassword: deleteField(),
        sigenAccessToken: deleteField(),
        sigenRefreshToken: deleteField(),
        sigenTokenExpiry: deleteField(),
        sigenStationId: deleteField(),
        sigenDeviceSn: deleteField(),
        deviceProvider: 'foxess',
        amberApiKey: deleteField(),
        setupComplete: false,
        updatedAt: serverTimestamp()
      };

      // Update the user's config/main document to clear these fields
      const userId = req.user.uid;
      await updateUserConfig(userId, updates);

      // Clear write-only credentials doc used by setup flows.
      if (db && typeof db.collection === 'function') {
        await db.collection('users').doc(userId).collection('secrets').doc('credentials').delete().catch(() => {});
      }

      res.json({ errno: 0, msg: 'Credentials cleared successfully' });
    } catch (error) {
      console.error('[API] /api/config/clear-credentials error:', error && error.stack ? error.stack : String(error));
      res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });

  // POST /api/config/tour-status - persist tour completion / reset flag
  app.post('/api/config/tour-status', authenticateUser, async (req, res) => {
    try {
      const { tourComplete, tourCompletedAt, tourDismissedAt } = req.body || {};
      const updates = {};
      if (typeof tourComplete === 'boolean') updates.tourComplete = tourComplete;
      if (tourCompletedAt) updates.tourCompletedAt = tourCompletedAt;
      if (tourDismissedAt) updates.tourDismissedAt = tourDismissedAt;

      if (!Object.keys(updates).length) {
        return res.status(400).json({ errno: 400, error: 'No valid fields to update' });
      }

      await updateUserConfig(req.user.uid, updates);
      return res.json({ errno: 0, msg: 'Tour status updated' });
    } catch (error) {
      console.error('[API] /api/config/tour-status POST error:', error && error.stack ? error.stack : String(error));
      return res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });
}

module.exports = {
  registerConfigMutationRoutes
};
