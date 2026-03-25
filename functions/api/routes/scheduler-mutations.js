'use strict';

const { buildClearedSchedulerGroups } = require('../../lib/automation-actions');
const { clearSchedulerSegments } = require('../../lib/services/scheduler-segment-service');
const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

function registerSchedulerMutationRoutes(app, deps = {}) {
  const addHistoryEntry = deps.addHistoryEntry;
  const authenticateUser = deps.authenticateUser;
  const foxessAPI = deps.foxessAPI;
  // adapterRegistry is optional — used for non-FoxESS providers
  const adapterRegistry = deps.adapterRegistry || null;
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

  function shouldVerify(req) {
    const raw = req?.query?.verify;
    if (raw === undefined || raw === null || raw === '') return false;
    const normalized = String(raw).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async function readVerifiedSchedule({ verifyRequested, readSchedule, routeLabel, userId, deviceSN }) {
    if (!verifyRequested) {
      return null;
    }

    try {
      return await readSchedule();
    } catch (error) {
      const wrappedError = new Error('Schedule verification failed after mutation');
      wrappedError.statusCode = 502;
      wrappedError.cause = error;

      logger.warn(
        'Scheduler',
        `${routeLabel} verification failed for user ${userId} device ${deviceSN}: ${error && error.message ? error.message : error}`
      );
      throw wrappedError;
    }
  }

  async function writeHistoryEntry(userId, entry, operationLabel) {
    try {
      await addHistoryEntry(userId, entry);
    } catch (error) {
      logger.warn(
        'Scheduler',
        `${operationLabel} history write failed for user ${userId}: ${error && error.message ? error.message : error}`
      );
    }
  }

  app.post('/api/scheduler/v1/set', async (req, res) => {
    try {
      const userConfig = await getUserConfig(req.user.uid);
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const deviceAdapter = adapterRegistry ? adapterRegistry.getDeviceProvider(provider) : null;
      const explicitDeviceId = req.body.sn || req.body.deviceSN;
      const deviceSN = resolveProviderDeviceId(userConfig, explicitDeviceId).deviceId;
      const groups = req.body.groups || [];

      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      logger.debug('Scheduler', `SET request for device ${deviceSN}, ${groups.length} groups`);

      if (deviceAdapter && provider !== 'foxess') {
        // Adapter-based path for non-FoxESS providers
        const context = { deviceSN, userConfig, userId: req.user.uid };
        const result = await deviceAdapter.setSchedule(context, groups);
        const verify = await readVerifiedSchedule({
          verifyRequested: shouldVerify(req),
          readSchedule: () => deviceAdapter.getSchedule(context),
          routeLabel: 'set',
          userId: req.user.uid,
          deviceSN
        });
        await writeHistoryEntry(
          req.user.uid,
          { type: 'scheduler_update', action: 'manual', groups, result: result.errno === 0 ? 'success' : 'failed' },
          'set'
        );
        return res.json({ errno: result.errno, msg: result.errno === 0 ? 'Success' : 'Failed', result: result.result, flagResult: null, verify: verify?.result || null });
      }

      // FoxESS path
      const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups }, userConfig, req.user.uid);
      const shouldEnable = Array.isArray(groups) && groups.some((group) => Number(group.enable) === 1);
      let flagResult = null;
      try {
        flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: shouldEnable ? 1 : 0 }, userConfig, req.user.uid);
      } catch (flagErr) {
        logger.warn('Scheduler', `Flag set failed: ${flagErr && flagErr.message ? flagErr.message : flagErr}`);
      }
      await writeHistoryEntry(
        req.user.uid,
        { type: 'scheduler_update', action: 'manual', groups, result: result.errno === 0 ? 'success' : 'failed' },
        'set'
      );
      const verify = await readVerifiedSchedule({
        verifyRequested: shouldVerify(req),
        readSchedule: () => foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, req.user.uid),
        routeLabel: 'set',
        userId: req.user.uid,
        deviceSN
      });
      return res.json({ errno: result.errno, msg: result.msg || (result.errno === 0 ? 'Success' : 'Failed'), result: result.result, flagResult, verify: verify?.result || null });
    } catch (error) {
      console.error('[Scheduler] SET error:', error);
      return res.status(error.statusCode || 500).json({ errno: error.statusCode || 500, error: error.message });
    }
  });

  /**
   * Clear all scheduler segments (set to disabled / zeroed).
   */
  app.post('/api/scheduler/v1/clear-all', authenticateUser, async (req, res) => {
    try {
      const userId = req.user.uid;
      const userConfig = await getUserConfig(userId);
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const deviceAdapter = adapterRegistry ? adapterRegistry.getDeviceProvider(provider) : null;
      const explicitDeviceId = req.body.sn || req.body.deviceSN;
      const deviceSN = resolveProviderDeviceId(userConfig, explicitDeviceId).deviceId;

      if (!deviceSN) {
        return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
      }

      logger.debug('Scheduler', `CLEAR-ALL request for device ${deviceSN}`);

      if (deviceAdapter && provider !== 'foxess') {
        const result = await deviceAdapter.clearSchedule({ deviceSN, userConfig, userId });
        const verify = await readVerifiedSchedule({
          verifyRequested: shouldVerify(req),
          readSchedule: () => deviceAdapter.getSchedule({ deviceSN, userConfig, userId }),
          routeLabel: 'clear-all',
          userId,
          deviceSN
        });
        await writeHistoryEntry(userId, { type: 'scheduler_clear', by: userId }, 'clear-all');
        return res.json({ errno: result.errno, msg: result.errno === 0 ? 'Scheduler cleared' : 'Failed', result: result.result, flagResult: null, verify: verify?.result || null });
      }

      // FoxESS path
      const result = await clearSchedulerSegments({ deviceSN, foxessAPI, userConfig, userId });
      let flagResult = null;
      try {
        flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      } catch (flagErr) {
        logger.warn('Scheduler', `Flag disable failed: ${flagErr && flagErr.message ? flagErr.message : flagErr}`);
      }
      const verify = await readVerifiedSchedule({
        verifyRequested: shouldVerify(req),
        readSchedule: () => foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId),
        routeLabel: 'clear-all',
        userId,
        deviceSN
      });
      await writeHistoryEntry(userId, { type: 'scheduler_clear', by: userId }, 'clear-all');
      return res.json({ errno: result.errno, msg: result.msg || (result.errno === 0 ? 'Scheduler cleared' : 'Failed'), result: result.result, flagResult, verify: verify?.result || null });
    } catch (error) {
      console.error('[Scheduler] clear-all error:', error.message || error);
      return res.status(error.statusCode || 500).json({ errno: error.statusCode || 500, error: error.message || String(error) });
    }
  });
}

module.exports = {
  buildClearedSchedulerGroups,
  registerSchedulerMutationRoutes
};
