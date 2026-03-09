'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

function buildDefaultSchedulerGroups() {
  return Array.from({ length: 10 }).map(() => ({
    startHour: 0,
    startMinute: 0,
    endHour: 0,
    endMinute: 0,
    enable: 0,
    workMode: 'SelfUse',
    minSocOnGrid: 10,
    fdSoc: 10,
    fdPwr: 0,
    maxSoc: 100
  }));
}

function registerSchedulerReadRoutes(app, deps = {}) {
  const foxessAPI = deps.foxessAPI;
  // adapterRegistry is optional — used for non-FoxESS providers
  const adapterRegistry = deps.adapterRegistry || null;
  const getUserConfig = deps.getUserConfig;
  const tryAttachUser = deps.tryAttachUser;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerSchedulerReadRoutes requires an Express app');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerSchedulerReadRoutes requires foxessAPI');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerSchedulerReadRoutes requires getUserConfig()');
  }
  if (typeof tryAttachUser !== 'function') {
    throw new Error('registerSchedulerReadRoutes requires tryAttachUser()');
  }

  // Scheduler endpoints
  // IMPORTANT: Always fetch from the live device to ensure UI matches actual device state
  app.get('/api/scheduler/v1/get', async (req, res) => {
    try {
      await tryAttachUser(req);
      const userConfig = await getUserConfig(req.user?.uid);
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const deviceAdapter = adapterRegistry ? adapterRegistry.getDeviceProvider(provider) : null;
      const sn = resolveProviderDeviceId(userConfig, req.query.sn).deviceId;

      if (!sn) {
        return res.json({ errno: 0, result: { groups: buildDefaultSchedulerGroups(), enable: false }, source: 'defaults' });
      }

      if (deviceAdapter && provider !== 'foxess') {
        const result = await deviceAdapter.getSchedule({ deviceSN: sn, userConfig, userId: req.user?.uid });
        if (result && result.errno === 0) result.source = 'device';
        return res.json(result);
      }

      // FoxESS path — always fetch live from device
      const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: sn }, userConfig, req.user?.uid);
      if (result && result.errno === 0) result.source = 'device';
      res.json(result);
    } catch (error) {
      console.error('[Scheduler] GET error:', error.message);
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerSchedulerReadRoutes
};
