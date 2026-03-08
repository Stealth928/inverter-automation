'use strict';

function createQuickControlService(deps = {}) {
  const addHistoryEntry = deps.addHistoryEntry;
  const foxessAPI = deps.foxessAPI;
  // adapterRegistry is optional — enables multi-provider dispatch (e.g. Sungrow)
  const adapterRegistry = deps.adapterRegistry || null;
  const getUserConfig = deps.getUserConfig;
  const logger = deps.logger || console;
  const saveQuickControlState = deps.saveQuickControlState;
  const serverTimestamp = deps.serverTimestamp;

  if (typeof addHistoryEntry !== 'function') {
    throw new Error('createQuickControlService requires addHistoryEntry()');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('createQuickControlService requires foxessAPI.callFoxESSAPI()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('createQuickControlService requires getUserConfig()');
  }
  if (!logger || typeof logger.info !== 'function' || typeof logger.debug !== 'function') {
    throw new Error('createQuickControlService requires logger.info/debug()');
  }
  if (typeof saveQuickControlState !== 'function') {
    throw new Error('createQuickControlService requires saveQuickControlState()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('createQuickControlService requires serverTimestamp()');
  }

  function buildClearedGroups() {
    const groups = [];
    for (let i = 0; i < 8; i++) {
      groups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0,
        startMinute: 0,
        endHour: 0,
        endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    return groups;
  }

  async function cleanupExpiredQuickControl(userId, quickState) {
    if (!quickState || !quickState.active || quickState.expiresAt > Date.now()) {
      return false;
    }

    logger.info(
      'QuickControl',
      `Auto-cleanup expired quick control: type=${quickState.type}, expiresAt=${new Date(quickState.expiresAt).toISOString()}, userId=${userId}`
    );

    try {
      const userConfig = await getUserConfig(userId);
      const deviceSN = userConfig?.sungrowDeviceSn || userConfig?.deviceSn;
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      const deviceAdapter = adapterRegistry ? adapterRegistry.getDeviceProvider(provider) : null;

      if (deviceSN && deviceAdapter && provider !== 'foxess') {
        // Adapter-based cleanup for non-FoxESS providers
        try {
          await deviceAdapter.clearSchedule({ deviceSN, userConfig, userId });
          logger.debug('QuickControl', 'Auto-cleanup (adapter) cleared segments successfully');
        } catch (e) {
          console.warn(`[QuickControl] Adapter cleanup failed: ${e.message}`);
        }
      } else if (deviceSN) {
        const clearResult = await foxessAPI.callFoxESSAPI(
          '/op/v1/device/scheduler/enable',
          'POST',
          { deviceSN, groups: buildClearedGroups() },
          userConfig,
          userId
        );
        if (clearResult?.errno === 0) {
          logger.debug('QuickControl', 'Auto-cleanup cleared segments successfully');
        } else {
          console.warn(`[QuickControl] Auto-cleanup segment clear returned errno=${clearResult?.errno}`);
        }

        try {
          await foxessAPI.callFoxESSAPI(
            '/op/v1/device/scheduler/set/flag',
            'POST',
            { deviceSN, enable: 0 },
            userConfig,
            userId
          );
        } catch (flagErr) {
          console.warn('[QuickControl] Auto-cleanup flag disable failed:', flagErr?.message || flagErr);
        }
      } // end FoxESS path
    } catch (err) {
      console.error('[QuickControl] Auto-cleanup error:', err.message);
    }

    await saveQuickControlState(userId, null);

    try {
      await addHistoryEntry(userId, {
        type: 'quickcontrol_auto_cleanup',
        controlType: quickState.type,
        power: quickState.power,
        durationMinutes: quickState.durationMinutes,
        timestamp: serverTimestamp()
      });
    } catch (_error) {
      // Ignore history write failures to avoid blocking cleanup
    }

    return true;
  }

  return {
    cleanupExpiredQuickControl
  };
}

module.exports = {
  createQuickControlService
};
