'use strict';

const { buildClearedSchedulerGroups } = require('../automation-actions');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function clearSchedulerSegmentsOneShot(options = {}) {
  const settleDelayMs = Number.isInteger(options.settleDelayMs) ? options.settleDelayMs : 0;
  const clearResult = await clearSchedulerSegments(options);
  if (settleDelayMs > 0) {
    await sleep(settleDelayMs);
  }
  return {
    clearResult,
    success: clearResult?.errno === 0
  };
}

async function clearSchedulerSegmentsWithRetry(options = {}) {
  const logger = options.logger || console;
  const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 3;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 1200;
  const settleDelayMs = Number.isInteger(options.settleDelayMs) ? options.settleDelayMs : 0;

  let clearResult = null;
  for (let clearAttempt = 1; clearAttempt <= maxAttempts; clearAttempt++) {
    clearResult = await clearSchedulerSegments(options);
    if (clearResult?.errno === 0) {
      if (settleDelayMs > 0) {
        await sleep(settleDelayMs);
      }
      return {
        attempts: clearAttempt,
        clearResult,
        success: true
      };
    }

    if (logger && typeof logger.warn === 'function') {
      logger.warn(
        `[Automation] Segment clear attempt ${clearAttempt} failed: errno=${clearResult?.errno}, msg=${clearResult?.msg}`
      );
    }

    if (clearAttempt < maxAttempts && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }

  return {
    attempts: maxAttempts,
    clearResult,
    success: false
  };
}

module.exports = {
  clearSchedulerSegments,
  clearSchedulerSegmentsOneShot,
  clearSchedulerSegmentsWithRetry
};
