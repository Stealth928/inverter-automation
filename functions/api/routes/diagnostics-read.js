'use strict';

function registerDiagnosticsReadRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;

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
        const pvPower = datas.find((d) => d.variable === 'pvPower')?.value || 0;
        const meterPower = datas.find((d) => d.variable === 'meterPower')?.value || null;
        const meterPower2 = datas.find((d) => d.variable === 'meterPower2')?.value || null;
        const batChargePower = datas.find((d) => d.variable === 'batChargePower')?.value || 0;
        const gridConsumptionPower = datas.find((d) => d.variable === 'gridConsumptionPower')?.value || 0;

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
