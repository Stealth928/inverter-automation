'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

function registerInverterReadRoutes(app, deps = {}) {
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;
  const getCachedInverterRealtimeData = deps.getCachedInverterRealtimeData;
  const authenticateUser = deps.authenticateUser;
  const adapterRegistry = deps.adapterRegistry || null;
  const logger = deps.logger || console;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerInverterReadRoutes requires an Express app');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerInverterReadRoutes requires foxessAPI');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerInverterReadRoutes requires getUserConfig()');
  }
  if (typeof getCachedInverterRealtimeData !== 'function') {
    throw new Error('registerInverterReadRoutes requires getCachedInverterRealtimeData()');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerInverterReadRoutes requires authenticateUser middleware');
  }

  /** Return the device adapter for a user's configured provider, or null for FoxESS (default path). */
  function getProviderAdapter(userConfig) {
    const provider = userConfig?.deviceProvider || 'foxess';
    if (provider === 'foxess' || !adapterRegistry) return null;
    return adapterRegistry.getDeviceProvider(provider) || null;
  }

  /** Returns true (and sends 400) when the user's provider is not FoxESS. */
  function foxessGuard(res, userConfig) {
    const provider = (userConfig?.deviceProvider || 'foxess').toLowerCase();
    if (provider !== 'foxess') {
      res.status(400).json({ errno: 400, error: `Not supported for provider: ${provider}` });
      return true;
    }
    return false;
  }

  // Inverter endpoints (proxy to FoxESS)
  app.get('/api/inverter/list', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
      const result = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  app.get('/api/inverter/real-time', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;

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
      if (foxessGuard(res, userConfig)) return;
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;
      const key = req.query.key;
      if (!key) return res.status(400).json({ errno: 400, error: 'Missing required parameter: key' });
      const result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/inverter/settings error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Dedicated temperatures endpoint - returns only temperature-related variables
  app.get('/api/inverter/temps', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;
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
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

      const dimension = req.query.dimension || 'month';
      const year = parseInt(req.query.year, 10) || new Date().getFullYear();
      const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);

      // Provider dispatch — try Sungrow adapter first; fall through to FoxESS on null
      const adapter = getProviderAdapter(userConfig);
      if (adapter && typeof adapter.getReport === 'function') {
        const adapterResult = await adapter.getReport(
          { deviceSN: sn, userConfig, userId: req.user.uid },
          dimension, year, month
        );
        if (adapterResult !== null) return res.json(adapterResult);
      }
      // Adapter returned null — operation not supported by this provider's adapter
      if (foxessGuard(res, userConfig)) return;

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
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

      // Provider dispatch — try Sungrow adapter first; fall through to FoxESS on null
      const adapter = getProviderAdapter(userConfig);
      if (adapter && typeof adapter.getGeneration === 'function') {
        const adapterResult = await adapter.getGeneration(
          { deviceSN: sn, userConfig, userId: req.user.uid }
        );
        if (adapterResult !== null) return res.json(adapterResult);
      }
      // Adapter returned null — operation not supported by this provider's adapter
      if (foxessGuard(res, userConfig)) return;

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
              if (sum > 0) {
                yearGeneration = sum;
                break;
              }
            }
          }
          if (genResult.result && typeof genResult.result === 'object') {
            genResult.result.year = yearGeneration;
            genResult.result.yearGeneration = yearGeneration;
          }
        }
      } catch (reportError) {
        // Log but don't fail - report endpoint might not be available
        logger.warn('[API] /api/inverter/generation - report endpoint failed:', reportError.message);
      }

      res.json(genResult);
    } catch (error) {
      console.error('[API] /api/inverter/generation error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Discover all available variables for a device (topology detection)
  app.get('/api/inverter/discover-variables', authenticateUser, async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
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

      console.log('[Diagnostics] Variables discovered:', result);
      res.json(result);
    } catch (error) {
      console.error('[Diagnostics] discover-variables error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerInverterReadRoutes
};
