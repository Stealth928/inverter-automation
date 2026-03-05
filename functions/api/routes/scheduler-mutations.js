'use strict';

const { buildClearedSchedulerGroups } = require('../../lib/automation-actions');

function registerSchedulerMutationRoutes(app, deps = {}) {
  const addHistoryEntry = deps.addHistoryEntry;
  const authenticateUser = deps.authenticateUser;
  const foxessAPI = deps.foxessAPI;
  const getUserConfig = deps.getUserConfig;
  const logger = deps.logger || console;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerSchedulerMutationRoutes requires an Express app');
  }
  if (typeof addHistoryEntry !== 'function') {
    throw new Error('registerSchedulerMutationRoutes requires addHistoryEntry()');
  }
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerSchedulerMutationRoutes requires authenticateUser middleware');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerSchedulerMutationRoutes requires foxessAPI');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerSchedulerMutationRoutes requires getUserConfig()');
  }

  app.post('/api/scheduler/v1/set', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;
      const groups = req.body.groups || [];

      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      logger.debug('Scheduler', `SET request for device ${deviceSN}, ${groups.length} groups`);

      // Primary: v1 API (this is what backend server.js uses and it works)
      const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups }, userConfig, req.user.uid);

      // Determine if we should enable or disable the scheduler flag
      const shouldEnable = Array.isArray(groups) && groups.some((group) => Number(group.enable) === 1);

      // Set scheduler flag (required for FoxESS app to show the schedule)
      let flagResult = null;
      try {
        flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: shouldEnable ? 1 : 0 }, userConfig, req.user.uid);
      } catch (flagErr) {
        logger.warn('Scheduler', `Flag set failed: ${flagErr && flagErr.message ? flagErr.message : flagErr}`);
      }

      // Log action to history
      await addHistoryEntry(req.user.uid, {
        type: 'scheduler_update',
        action: 'manual',
        groups,
        result: result.errno === 0 ? 'success' : 'failed'
      });

      // Verification read: fetch what the device actually has now
      let verify = null;
      try {
        verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, req.user.uid);
      } catch (error) {
        logger.warn('Scheduler', `Verify read failed: ${error && error.message ? error.message : error}`);
      }

      // Return the result with verification data
      return res.json({
        errno: result.errno,
        msg: result.msg || (result.errno === 0 ? 'Success' : 'Failed'),
        result: result.result,
        flagResult,
        verify: verify?.result || null
      });
    } catch (error) {
      console.error('[Scheduler] SET error:', error);
      return res.status(500).json({ errno: 500, error: error.message });
    }
  });

  /**
   * Clear all scheduler segments (set to disabled / zeroed).
   * Sends directly to the device, same pattern as backend/server.js
   * Body: {}
   */
  app.post('/api/scheduler/v1/clear-all', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const userConfig = await getUserConfig(userId);
      const deviceSN = req.body.sn || req.body.deviceSN || userConfig?.deviceSn;

      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      logger.debug('Scheduler', `CLEAR-ALL request for device ${deviceSN}`);

      const emptyGroups = buildClearedSchedulerGroups();

      // Send to device via v1 API (primary - this is what works in server.js)
      const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: emptyGroups }, userConfig, userId);

      // Disable the scheduler flag
      let flagResult = null;
      try {
        flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      } catch (flagErr) {
        logger.warn('Scheduler', `Flag disable failed: ${flagErr && flagErr.message ? flagErr.message : flagErr}`);
      }

      // Verification read
      let verify = null;
      try {
        verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
      } catch (error) {
        logger.warn('Scheduler', `Verify read failed: ${error && error.message ? error.message : error}`);
      }

      // Log to history
      try {
        await addHistoryEntry(userId, {
          type: 'scheduler_clear',
          by: userId
        });
      } catch (error) {
        console.warn('[Scheduler] Failed to write history entry:', error && error.message);
      }

      return res.json({
        errno: result.errno,
        msg: result.msg || (result.errno === 0 ? 'Scheduler cleared' : 'Failed'),
        result: result.result,
        flagResult,
        verify: verify?.result || null
      });
    } catch (error) {
      console.error('[Scheduler] clear-all error:', error.message || error);
      return res.status(500).json({ errno: 500, error: error.message || String(error) });
    }
  });
}

module.exports = {
  buildClearedSchedulerGroups,
  registerSchedulerMutationRoutes
};
