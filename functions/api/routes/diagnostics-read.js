'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');
const {
  appendRealtimeTelemetryMappings,
  getConfiguredAcSolarPowerVariable,
  shouldApplyTelemetryMappings
} = require('../../lib/telemetry-mappings');

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function powerToKw(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) return null;
  if (Math.abs(numeric) > 100) return Number((numeric / 1000).toFixed(4));
  return Number(numeric.toFixed(4));
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

function normalizeLocalCouplingValue(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'ac' || raw === 'ac-coupled' || raw === 'ac_coupled') return 'ac';
  if (raw === 'dc' || raw === 'dc-coupled' || raw === 'dc_coupled') return 'dc';
  return 'unknown';
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

  return normalizeLocalCouplingValue(userConfig.systemTopology && userConfig.systemTopology.coupling) === 'ac';
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

  const asPower = (value) => {
    if (!normalizeToKw) return value;
    return powerToKw(value) ?? 0;
  };

  const pvPower = asPower(pvPowerRaw);
  const loadPower = asPower(loadPowerRaw);
  const gridPower = asPower(gridPowerRaw);
  const feedInPower = asPower(feedInPowerRaw);
  const batteryPower = asPower(batteryPowerCanonicalRaw);
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

function extractDatas(payload) {
  if (Array.isArray(payload?.result?.[0]?.datas)) return payload.result[0].datas;
  if (Array.isArray(payload?.result?.datas)) return payload.result.datas;
  return [];
}

function findDataValue(datas, variable, fallback = null) {
  if (!Array.isArray(datas)) return fallback;
  const match = datas.find((entry) => entry && entry.variable === variable);
  if (!match) return fallback;
  const numeric = toFiniteNumber(match.value, fallback);
  return numeric;
}

function withTopologyHints(payload, userConfig) {
  if (!payload || payload.errno !== 0) return payload;

  const datas = extractDatas(payload);
  const pvPower = findDataValue(datas, 'pvPower', 0);
  const meterPower = findDataValue(datas, 'meterPower', null);
  const meterPower2 = findDataValue(datas, 'meterPower2', null);
  const acSolarPower = findDataValue(datas, 'acSolarPower', null);
  const solarPowerTotal = findDataValue(datas, 'solarPowerTotal', null);
  const batChargePower = findDataValue(datas, 'batChargePower', 0);
  const gridConsumptionPower = findDataValue(datas, 'gridConsumptionPower', 0);
  const mappingSupported = shouldApplyTelemetryMappings(userConfig);
  const configuredAcSolarVariable = mappingSupported
    ? (getConfiguredAcSolarPowerVariable(userConfig) || null)
    : null;
  let recommendedAcSolarVariable = null;

  if (mappingSupported && pvPower < 0.1 && meterPower2 !== null && Math.abs(meterPower2) > 0.5) {
    recommendedAcSolarVariable = 'meterPower2';
  } else if (mappingSupported && pvPower < 0.1 && meterPower !== null && Math.abs(meterPower) > 0.5) {
    recommendedAcSolarVariable = 'meterPower';
  }

  payload.topologyHints = {
    pvPower,
    meterPower,
    meterPower2,
    acSolarPower,
    solarPowerTotal,
    batChargePower,
    gridConsumptionPower,
    configuredAcSolarVariable,
    recommendedAcSolarVariable,
    likelyTopology:
      (pvPower < 0.1 && (batChargePower > 0.5 || meterPower2 > 0.5) && gridConsumptionPower < 0.5)
        ? 'AC-coupled (external PV via meter)'
        : (pvPower > 0.5)
          ? 'DC-coupled (standard)'
          : 'Unknown (check during solar production hours)'
  };

  return payload;
}

function registerDiagnosticsReadRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;
  const adapterRegistry = deps.adapterRegistry || null;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerDiagnosticsReadRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerDiagnosticsReadRoutes requires authenticateUser middleware');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerDiagnosticsReadRoutes requires foxessAPI');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerDiagnosticsReadRoutes requires getUserConfig()');
  }

  // Read device setting (for discovery / testing)
  // NOTE: Includes retry logic for empty results (transient failures)
  app.post('/api/device/setting/get', authenticateUser, async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      if (provider !== 'foxess') {
        return res.status(400).json({ errno: 400, error: `Not supported for provider: ${provider}` });
      }
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
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        console.log('[DeviceSetting] Calling FoxESS API with:', { sn, key });
        result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, userConfig, req.user.uid);

        // 🔍 AGGRESSIVE DEBUG LOGGING
        console.log('[DeviceSetting] FULL RESPONSE OBJECT:', JSON.stringify(result, null, 2));
        console.log('[DeviceSetting] errno:', result?.errno);
        console.log('[DeviceSetting] result field:', JSON.stringify(result?.result, null, 2));
        console.log('[DeviceSetting] result.data:', JSON.stringify(result?.result?.data, null, 2));
        console.log('[DeviceSetting] result.value:', result?.result?.value);
        console.log('[DeviceSetting] error field:', result?.error);
        console.log('[DeviceSetting] msg field:', result?.msg);

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
        console.log('[DeviceSetting] Keys in result.data:', Object.keys(result.result.data));
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

  // Get ALL real-time data (no variable filtering) for topology analysis
  app.post('/api/inverter/all-data', authenticateUser, async (req, res) => {
    try {
      console.log(`[Diagnostics] all-data endpoint called by user: ${req.user.uid}`);

      const userConfig = await getUserConfig(req.user.uid);
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const adapter = provider !== 'foxess' && adapterRegistry
        ? adapterRegistry.getDeviceProvider(provider)
        : null;
      const sn = resolveProviderDeviceId(userConfig, req.body.sn).deviceId;
      console.log(`[Diagnostics] User config loaded, provider=${provider}, deviceSn=${sn}`);

      if (!sn) {
        console.error('[Diagnostics] No device SN found');
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      if (provider !== 'foxess' && adapter && typeof adapter.getStatus === 'function') {
        const status = await adapter.getStatus({ deviceSN: sn, userConfig, userId: req.user.uid });
        const invertAlphaEssBatteryPowerSign = provider === 'alphaess'
          ? resolveAlphaEssBatterySignInversion(userConfig, status)
          : false;
        const normalized = buildRealtimePayloadFromDeviceStatus(status, sn, {
          normalizeToKw: true,
          invertBatteryPowerSign: invertAlphaEssBatteryPowerSign
        });
        appendRealtimeTelemetryMappings(normalized, userConfig);
        const withHints = withTopologyHints(normalized, userConfig);
        console.log(`[Diagnostics] Adapter diagnostics response ready for provider=${provider}`);
        return res.json(withHints);
      }

      if (provider !== 'foxess') {
        return res.status(400).json({ errno: 400, error: `Not supported for provider: ${provider}` });
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

      appendRealtimeTelemetryMappings(result, userConfig);
      withTopologyHints(result, userConfig);

      console.log('[Diagnostics] All data retrieved, topology hints:', result.topologyHints);
      res.json(result);
    } catch (error) {
      console.error('[Diagnostics] all-data error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerDiagnosticsReadRoutes
};
