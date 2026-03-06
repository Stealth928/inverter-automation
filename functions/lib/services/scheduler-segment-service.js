'use strict';

const { buildClearedSchedulerGroups } = require('../automation-actions');

async function clearSchedulerSegments(options = {}) {
  const foxessAPI = options.foxessAPI;
  const userConfig = options.userConfig;
  const userId = options.userId;
  const providedDeviceSN = options.deviceSN;
  const groupCount = options.groupCount;

  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('clearSchedulerSegments requires foxessAPI.callFoxESSAPI()');
  }

  const deviceSN = providedDeviceSN || userConfig?.deviceSn;
  if (!deviceSN) {
    throw new Error('clearSchedulerSegments requires deviceSN');
  }

  return foxessAPI.callFoxESSAPI(
    '/op/v1/device/scheduler/enable',
    'POST',
    {
      deviceSN,
      groups: buildClearedSchedulerGroups(groupCount)
    },
    userConfig,
    userId
  );
}

module.exports = {
  clearSchedulerSegments
};
