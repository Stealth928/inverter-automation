'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

function maskValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 6) return '***';
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

function summarizeMutationRequest(body = {}) {
  return {
    key: body.key,
    value: body.value,
    minSoc: body.minSoc,
    minSocOnGrid: body.minSocOnGrid,
    maxSoc: body.maxSoc,
    sn: maskValue(body.sn)
  };
}

function registerDeviceMutationRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;
  const adapterRegistry = deps.adapterRegistry || null;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerDeviceMutationRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerDeviceMutationRoutes requires authenticateUser middleware');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerDeviceMutationRoutes requires foxessAPI.callFoxESSAPI()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerDeviceMutationRoutes requires getUserConfig()');
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

  // Battery SoC set
  app.post('/api/device/battery/soc/set', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
      const sn = req.body.sn || userConfig?.deviceSn;
      const { minSoc, minSocOnGrid, maxSoc } = req.body;

      console.info('[BatterySoC] SET request', {
        userId: req.user.uid,
        deviceSn: maskValue(sn),
        minSoc,
        minSocOnGrid,
        maxSoc
      });

      if (!sn) {
        console.warn('[BatterySoC] No device SN configured', { userId: req.user.uid });
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      const foxessPayload = { sn, minSoc, minSocOnGrid, maxSoc };

      const result = await foxessAPI.callFoxESSAPI(
        '/op/v0/device/battery/soc/set',
        'POST',
        foxessPayload,
        userConfig,
        req.user.uid
      );

      console.info('[BatterySoC] SET response', {
        userId: req.user.uid,
        deviceSn: maskValue(sn),
        errno: result?.errno,
        msg: result?.msg || result?.error || ''
      });

      res.json(result);
    } catch (error) {
      console.error('[BatterySoC] Error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Write device setting (for discovery / testing and curtailment control)
  app.post('/api/device/setting/set', authenticateUser, async (req, res) => {
    let key; let value;
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
      const sn = req.body.sn || userConfig?.deviceSn;
      key = req.body.key;
      value = req.body.value;

      console.info('[DeviceSetting] SET request', {
        userId: req.user.uid,
        deviceSn: maskValue(sn),
        key,
        valueType: typeof value
      });

      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      if (!key) return res.status(400).json({ errno: 400, error: 'Missing required parameter: key' });
      if (value === undefined || value === null) {
        return res.status(400).json({ errno: 400, error: 'Missing required parameter: value' });
      }

      const result = await foxessAPI.callFoxESSAPI(
        '/op/v0/device/setting/set',
        'POST',
        { sn, key, value },
        userConfig,
        req.user.uid
      );

      console.info('[DeviceSetting] SET response', {
        userId: req.user.uid,
        request: summarizeMutationRequest(req.body),
        errno: result?.errno,
        msg: result?.msg || result?.error || ''
      });

      res.json(result);
    } catch (error) {
      console.error(`[DeviceSetting] SET ERROR for ${key}=${value}:`, error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Force charge time set
  app.post('/api/device/battery/forceChargeTime/set', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      if (foxessGuard(res, userConfig)) return;
      const sn = req.body.sn || userConfig?.deviceSn;
      const body = Object.assign({ sn }, req.body);
      const result = await foxessAPI.callFoxESSAPI(
        '/op/v0/device/battery/forceChargeTime/set',
        'POST',
        body,
        userConfig,
        req.user.uid
      );
      res.json(result);
    } catch (error) {
      console.error('[API] /api/device/battery/forceChargeTime/set error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Set work mode setting (default active mode, not scheduler)
  app.post('/api/device/workmode/set', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const { workMode } = req.body;
      if (!workMode) {
        return res.status(400).json({ errno: 400, error: 'workMode is required (SelfUse, Feedin, Backup)' });
      }

      // Dispatch to adapter for non-FoxESS providers
      if (adapterRegistry) {
        const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
        if (provider !== 'foxess') {
          const adapter = adapterRegistry.getDeviceProvider(provider);
          if (adapter && typeof adapter.setWorkMode === 'function') {
            const sn = resolveProviderDeviceId(userConfig, req.body.sn).deviceId;
            const adapterResult = await adapter.setWorkMode({ deviceSN: sn, userConfig, userId: req.user.uid }, workMode);
            return res.json(adapterResult);
          }
        }
      }

      const sn = req.body.sn || userConfig?.deviceSn;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

      const workModeMap = {
        SelfUse: 0,
        Feedin: 1,
        FeedinFirst: 1,
        Backup: 2,
        PeakShaving: 3
      };

      const numericWorkMode = workModeMap[workMode];
      if (numericWorkMode === undefined) {
        return res.status(400).json({
          errno: 400,
          error: `Invalid work mode: ${workMode}. Valid modes: SelfUse, Feedin, Backup, PeakShaving`
        });
      }

      const result = await foxessAPI.callFoxESSAPI(
        '/op/v0/device/setting/set',
        'POST',
        { sn, key: 'WorkMode', value: numericWorkMode },
        userConfig,
        req.user.uid
      );
      res.json(result);
    } catch (error) {
      console.error('[API] /api/device/workmode/set error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerDeviceMutationRoutes
};
