'use strict';

function registerDeviceReadRoutes(app, deps = {}) {
  const authenticateUser = deps.authenticateUser;
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;

  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('registerDeviceReadRoutes requires an Express app');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerDeviceReadRoutes requires authenticateUser middleware');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerDeviceReadRoutes requires foxessAPI');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerDeviceReadRoutes requires getUserConfig()');
  }

  // Battery SoC read endpoint used by control UI
  app.get('/api/device/battery/soc/get', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const sn = req.query.sn || userConfig?.deviceSn;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      const result = await foxessAPI.callFoxESSAPI(`/op/v0/device/battery/soc/get?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/device/battery/soc/get error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Device status check (diagnostic endpoint to verify device connectivity and API responsiveness)
  app.get('/api/device/status/check', authenticateUser, async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const sn = req.query.sn || userConfig?.deviceSn;

      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

      console.log(`[DeviceStatusCheck] Checking device status for SN: ${sn}`);

      // Try to fetch device list - this tells us if the API is responding and device is online
      const deviceListResult = await foxessAPI.callFoxESSAPI('/op/v0/device/list', 'GET', null, userConfig, req.user.uid);

      let deviceFound = false;
      let deviceInfo = null;

      if (deviceListResult?.errno === 0 && deviceListResult?.result?.data?.length > 0) {
        const devices = deviceListResult.result.data;
        deviceInfo = devices.find((d) => d.sn === sn);
        deviceFound = !!deviceInfo;
      }

      // Try to fetch real-time data - this verifies the device is actively reporting
      const realtimeResult = await foxessAPI.callFoxESSAPI(`/op/v0/device/real-time?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);

      const realtimeWorking = realtimeResult?.errno === 0 && realtimeResult?.result?.data;

      // Try to fetch a sample setting to verify settings API is working
      const settingResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key: 'ExportLimit' }, userConfig, req.user.uid);

      const settingResponseOk = settingResult?.errno === 0;
      const settingHasData = settingResult?.result && Object.keys(settingResult.result).length > 0;

      const potentialIssues = [];
      if (!deviceFound) potentialIssues.push('Device not found in device list - may be offline or using wrong SN');
      if (!realtimeWorking) potentialIssues.push('Real-time data API not responding - device may be offline');
      if (!settingResponseOk) potentialIssues.push('Settings API error - possible API issue with FoxESS');
      if (settingResponseOk && !settingHasData) potentialIssues.push('Settings API returned empty result - this setting may not be supported by your device');

      return res.json({
        errno: 0,
        result: {
          deviceSn: sn,
          deviceFound,
          deviceInfo: deviceInfo ? { sn: deviceInfo.sn, deviceName: deviceInfo.deviceName, deviceType: deviceInfo.deviceType } : null,
          realtimeWorking,
          settingResponseOk,
          settingHasData,
          diagnosticSummary: {
            apiResponsive: deviceListResult?.errno === 0,
            deviceOnline: deviceFound,
            realtimeDataAvailable: realtimeWorking,
            settingReadSupported: settingResponseOk && settingHasData,
            potentialIssues
          }
        }
      });
    } catch (error) {
      console.error('[API] /api/device/status/check error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Force charge time read
  app.get('/api/device/battery/forceChargeTime/get', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const sn = req.query.sn || userConfig?.deviceSn;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      const result = await foxessAPI.callFoxESSAPI(`/op/v0/device/battery/forceChargeTime/get?sn=${encodeURIComponent(sn)}`, 'GET', null, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/device/battery/forceChargeTime/get error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // FoxESS: Get meter reader (legacy endpoint used by UI)
  app.post('/api/device/getMeterReader', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const sn = req.body.sn || userConfig?.deviceSn;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      const body = Object.assign({ sn }, req.body);
      const result = await foxessAPI.callFoxESSAPI('/op/v0/device/getMeterReader', 'POST', body, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/device/getMeterReader error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // EMS list
  app.get('/api/ems/list', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const result = await foxessAPI.callFoxESSAPI('/op/v0/ems/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/ems/list error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Module list
  app.get('/api/module/list', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const result = await foxessAPI.callFoxESSAPI('/op/v0/module/list', 'POST', { currentPage: 1, pageSize: 10, sn: userConfig?.deviceSn }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/module/list error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Module signal (requires moduleSN parameter)
  app.get('/api/module/signal', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const moduleSN = req.query.moduleSN;

      if (!moduleSN) {
        return res.status(400).json({ errno: 400, error: 'moduleSN parameter is required' });
      }

      const result = await foxessAPI.callFoxESSAPI('/op/v0/module/getSignal', 'POST', { sn: moduleSN }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/module/signal error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Meter list
  app.get('/api/meter/list', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const result = await foxessAPI.callFoxESSAPI('/op/v0/gw/list', 'POST', { currentPage: 1, pageSize: 10 }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/meter/list error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Get work mode setting (default active mode, not scheduler)
  app.get('/api/device/workmode/get', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const sn = req.query.sn || userConfig?.deviceSn;
      if (!sn) return res.status(400).json({ errno: 400, error: 'Device SN not configured' });

      const result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key: 'WorkMode' }, userConfig, req.user.uid);
      res.json(result);
    } catch (error) {
      console.error('[API] /api/device/workmode/get error:', error);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerDeviceReadRoutes
};
