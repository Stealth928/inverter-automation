'use strict';

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
  // IMPORTANT: Always fetch from the live FoxESS device to ensure UI matches actual device state
  // (not from Firestore cache, which caused segments to appear saved but not sync to manufacturer app)
  app.get('/api/scheduler/v1/get', async (req, res) => {
    try {
      await tryAttachUser(req);
      const userConfig = await getUserConfig(req.user?.uid);
      const sn = req.query.sn || userConfig?.deviceSn;

      if (!sn) {
        return res.json({ errno: 0, result: { groups: buildDefaultSchedulerGroups(), enable: false }, source: 'defaults' });
      }

      // Always fetch live data from the device (this is what the manufacturer app sees)
      const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN: sn }, userConfig, req.user?.uid);

      // Tag the source so debugging is easier
      if (result && result.errno === 0) {
        result.source = 'device';
      }

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
