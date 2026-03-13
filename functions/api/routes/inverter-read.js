'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');
const DEFAULT_LOCAL_TOPOLOGY_REFRESH_MS = 4 * 60 * 60 * 1000;

function normalizeLocalCouplingValue(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'ac' || raw === 'ac-coupled' || raw === 'ac_coupled') return 'ac';
  if (raw === 'dc' || raw === 'dc-coupled' || raw === 'dc_coupled') return 'dc';
  return 'unknown';
}

function extractRealtimeDatas(realtimePayload) {
  const result = realtimePayload && realtimePayload.result;
  if (Array.isArray(result) && result.length > 0) {
    if (Array.isArray(result[0] && result[0].datas)) return result[0].datas;
    return result;
  }
  if (result && Array.isArray(result.datas)) return result.datas;
  return [];
}

function findRealtimeVar(datas, key) {
  if (!Array.isArray(datas)) return null;
  const item = datas.find((d) => d && (d.variable === key || d.key === key));
  return item ? item.value : null;
}

function normalizePowerToKw(rawValue) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;
  const kw = Math.abs(numeric) > 100 ? (numeric / 1000) : numeric;
  return Number(kw.toFixed(4));
}

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function wattsToKw(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) return null;
  return Number((numeric / 1000).toFixed(4));
}

function inferSystemCouplingFromRealtime(realtimePayload) {
  const datas = extractRealtimeDatas(realtimePayload);
  if (!datas.length) return null;

  const pvPower = normalizePowerToKw(findRealtimeVar(datas, 'pvPower'));
  let meterPower2 = normalizePowerToKw(findRealtimeVar(datas, 'meterPower2'));
  if (meterPower2 === null) {
    meterPower2 = normalizePowerToKw(findRealtimeVar(datas, 'meterPower'));
  }
  if (pvPower === null || meterPower2 === null) return null;

  const meterPowerMagnitude = Math.abs(meterPower2);
  const isLikelyAcCoupled = Math.abs(pvPower) < 0.05 && meterPowerMagnitude > 0.05;
  const confidence = isLikelyAcCoupled
    ? (meterPowerMagnitude > 0.3 ? 0.9 : 0.75)
    : (Math.abs(pvPower) > 0.2 ? 0.8 : 0.65);

  return {
    coupling: isLikelyAcCoupled ? 'ac' : 'dc',
    confidence,
    evidence: {
      pvPower,
      meterPower2,
      heuristic: 'pvPower~0 && |meterPower2|>0'
    }
  };
}

function shouldPersistAutoTopology(existingTopology, inferredCoupling, defaultRefreshMs, normalizeCouplingValue) {
  const existingCoupling = normalizeCouplingValue(existingTopology && existingTopology.coupling);
  const source = String((existingTopology && existingTopology.source) || '').toLowerCase().trim();
  const hasStoredCoupling = existingCoupling === 'ac' || existingCoupling === 'dc';

  // Never override explicit manual topology selections automatically.
  if (source === 'manual' && hasStoredCoupling) {
    return false;
  }

  const refreshAfterMsRaw = Number(existingTopology && existingTopology.refreshAfterMs);
  const refreshAfterMs = Number.isFinite(refreshAfterMsRaw) && refreshAfterMsRaw > 0
    ? Math.floor(refreshAfterMsRaw)
    : defaultRefreshMs;
  const lastDetectedAt = Number(existingTopology && existingTopology.lastDetectedAt) || 0;
  const isStale = !lastDetectedAt || ((Date.now() - lastDetectedAt) > refreshAfterMs);

  return !hasStoredCoupling || isStale || existingCoupling !== inferredCoupling;
}

function resolveAlphaEssBatterySignInversion(userConfig, normalizeCouplingValue) {
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

  const coupling = typeof normalizeCouplingValue === 'function'
    ? normalizeCouplingValue(userConfig.systemTopology && userConfig.systemTopology.coupling)
    : normalizeLocalCouplingValue(userConfig.systemTopology && userConfig.systemTopology.coupling);
  return coupling === 'ac';
}

/**
 * Normalizes adapter status into the same frame shape used by existing FoxESS realtime consumers.
 * This keeps dashboard/history frontend parsing logic unchanged for non-FoxESS providers.
 */
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

  const pvPower = normalizeToKw ? (wattsToKw(status.pvPowerW) ?? 0) : pvPowerRaw;
  const loadPower = normalizeToKw ? (wattsToKw(status.loadPowerW) ?? 0) : loadPowerRaw;
  const gridPower = normalizeToKw ? (wattsToKw(status.gridPowerW) ?? 0) : gridPowerRaw;
  const feedInPower = normalizeToKw ? (wattsToKw(status.feedInPowerW) ?? 0) : feedInPowerRaw;
  const batteryPower = normalizeToKw ? (wattsToKw(batteryPowerCanonicalRaw) ?? 0) : batteryPowerCanonicalRaw;
  const batteryChargePower = batteryPower > 0 ? batteryPower : 0;
  const batteryDischargePower = batteryPower < 0 ? Math.abs(batteryPower) : 0;
  const meterPower = gridPower > 0 ? gridPower : -feedInPower;

  return {
    errno: 0,
    msg: 'Operation successful',
    result: [{
      deviceSN: String(sn || status.deviceSN || ''),
      time: status.observedAtIso || new Date().toISOString(),
      datas: [
        { variable: 'SoC', value: socPct, ...(normalizeToKw ? { unit: '%' } : {}) },
        { variable: 'pvPower', value: pvPower, ...(normalizeToKw ? { unit: 'kW' } : {}) },
        { variable: 'loadsPower', value: loadPower, ...(normalizeToKw ? { unit: 'kW' } : {}) },
        { variable: 'gridConsumptionPower', value: gridPower, ...(normalizeToKw ? { unit: 'kW' } : {}) },
        { variable: 'feedinPower', value: feedInPower, ...(normalizeToKw ? { unit: 'kW' } : {}) },
        { variable: 'meterPower2', value: meterPower, ...(normalizeToKw ? { unit: 'kW' } : {}) },
        { variable: 'batTemperature', value: batteryTempC, ...(normalizeToKw ? { unit: 'C' } : {}) },
        { variable: 'ambientTemperation', value: ambientTempC, ...(normalizeToKw ? { unit: 'C' } : {}) },
        { variable: 'batChargePower', value: batteryChargePower, ...(normalizeToKw ? { unit: 'kW' } : {}) },
        { variable: 'batDischargePower', value: batteryDischargePower, ...(normalizeToKw ? { unit: 'kW' } : {}) }
      ]
    }]
  };
}

function registerInverterReadRoutes(app, deps = {}) {
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;
  const getCachedInverterRealtimeData = deps.getCachedInverterRealtimeData;
  const authenticateUser = deps.authenticateUser;
  const adapterRegistry = deps.adapterRegistry || null;
  const logger = deps.logger || console;
  const setUserConfig = deps.setUserConfig;
  const serverTimestamp = deps.serverTimestamp;
  const normalizeCouplingValue = typeof deps.normalizeCouplingValue === 'function'
    ? deps.normalizeCouplingValue
    : normalizeLocalCouplingValue;
  const DEFAULT_TOPOLOGY_REFRESH_MS = Number.isFinite(Number(deps.DEFAULT_TOPOLOGY_REFRESH_MS))
    ? Math.floor(Number(deps.DEFAULT_TOPOLOGY_REFRESH_MS))
    : DEFAULT_LOCAL_TOPOLOGY_REFRESH_MS;

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

  async function persistTopologyFromRealtime(userId, userConfig, realtimePayload) {
    if (typeof setUserConfig !== 'function' || typeof serverTimestamp !== 'function') return;
    if (!realtimePayload || realtimePayload.errno !== 0) return;

    const inferred = inferSystemCouplingFromRealtime(realtimePayload);
    if (!inferred) return;

    const existingTopology = userConfig && userConfig.systemTopology ? userConfig.systemTopology : null;
    const shouldPersist = shouldPersistAutoTopology(
      existingTopology,
      inferred.coupling,
      DEFAULT_TOPOLOGY_REFRESH_MS,
      normalizeCouplingValue
    );
    if (!shouldPersist) return;

    const refreshAfterMsRaw = Number(existingTopology && existingTopology.refreshAfterMs);
    const refreshAfterMs = Number.isFinite(refreshAfterMsRaw) && refreshAfterMsRaw > 0
      ? Math.floor(refreshAfterMsRaw)
      : DEFAULT_TOPOLOGY_REFRESH_MS;

    const now = Date.now();
    await setUserConfig(userId, {
      systemTopology: {
        coupling: inferred.coupling,
        source: 'auto',
        confidence: inferred.confidence,
        refreshAfterMs,
        lastDetectedAt: now,
        updatedAt: serverTimestamp(),
        evidence: inferred.evidence
      }
    }, { merge: true });
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
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const adapter = getProviderAdapter(userConfig);
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;
      // Check for force refresh query parameter (bypass cache when ?forceRefresh=true)
      const forceRefresh = req.query.forceRefresh === 'true' || req.query.force === 'true';

      if (!sn) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      if (provider !== 'foxess' && adapter && typeof adapter.getStatus === 'function') {
        // For non-Fox providers, reuse the same cached helper so cache TTL settings
        // apply consistently across providers (not just FoxESS).
        const normalized = await getCachedInverterRealtimeData(req.user.uid, sn, userConfig, forceRefresh);
        try {
          await persistTopologyFromRealtime(req.user.uid, userConfig, normalized);
        } catch (persistError) {
          logger.warn('[Inverter] Failed to auto-persist system topology:', persistError.message);
        }
        return res.json(normalized);
      }

      if (foxessGuard(res, userConfig)) return;

      // Use cached data to avoid excessive Fox API calls (unless force refresh requested)
      // This respects per-user cache TTL and reduces API quota usage significantly
      const result = await getCachedInverterRealtimeData(req.user.uid, sn, userConfig, forceRefresh);
      try {
        await persistTopologyFromRealtime(req.user.uid, userConfig, result);
      } catch (persistError) {
        logger.warn('[Inverter] Failed to auto-persist system topology:', persistError.message);
      }
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
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const adapter = getProviderAdapter(userConfig);
      const deviceSN = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;

      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      // Non-Fox providers: derive available variables from adapter status normalized to the
      // same frame shape used by the dashboard so diagnostics stay useful across providers.
      if (provider !== 'foxess' && adapter && typeof adapter.getStatus === 'function') {
        const status = await adapter.getStatus({ deviceSN, userConfig, userId: req.user.uid });
        const invertAlphaEssBatteryPowerSign = provider === 'alphaess'
          ? resolveAlphaEssBatterySignInversion(userConfig, normalizeCouplingValue)
          : false;
        const normalized = buildRealtimePayloadFromDeviceStatus(status, deviceSN, {
          normalizeToKw: provider === 'alphaess',
          invertBatteryPowerSign: invertAlphaEssBatteryPowerSign
        });
        const variables = extractRealtimeDatas(normalized)
          .map((entry) => String(entry?.variable || '').trim())
          .filter(Boolean);
        const uniqueVariables = Array.from(new Set(variables));
        return res.json({
          errno: 0,
          msg: 'Variables discovered from provider adapter',
          result: uniqueVariables
        });
      }

      if (foxessGuard(res, userConfig)) return;

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
