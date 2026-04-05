'use strict';

const { resolveProviderDeviceId } = require('../provider-device-id');
const { validateActionEnergyCap } = require('./automation-energy-cap-service');
const {
  applySegmentToGroups,
  buildAutomationSchedulerSegment,
  clearSchedulerGroups
} = require('../automation-actions');

const VALID_RULE_WORK_MODES = new Set(['SelfUse', 'ForceDischarge', 'ForceCharge', 'Feedin', 'Backup']);
const POWER_REQUIRED_WORK_MODES = new Set(['ForceDischarge', 'ForceCharge', 'Feedin']);
const PROVIDER_WORK_MODE_BLACKLIST = Object.freeze({
  alphaess: new Set(['Backup']),
  sigenergy: new Set(['Backup'])
});

function getEffectiveInverterCapacityW(userConfig) {
  const capacity = Number(userConfig?.inverterCapacityW);
  if (!Number.isFinite(capacity) || capacity < 1000) {
    return 10000;
  }
  return Math.min(30000, Math.round(capacity));
}

function validateRuleActionForUser(action, userConfig) {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const workMode = action.workMode || 'SelfUse';
  if (!VALID_RULE_WORK_MODES.has(workMode)) {
    return `Invalid action.workMode: ${workMode}. Valid modes: ${Array.from(VALID_RULE_WORK_MODES).join(', ')}`;
  }

  const energyCapValidationError = validateActionEnergyCap(action);
  if (energyCapValidationError) {
    return energyCapValidationError;
  }

  const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
  const disallowedModes = PROVIDER_WORK_MODE_BLACKLIST[provider];
  if (disallowedModes && disallowedModes.has(workMode)) {
    return `action.workMode ${workMode} is not supported for provider ${provider}`;
  }

  if (action.durationMinutes !== undefined && action.durationMinutes !== null) {
    const duration = Number(action.durationMinutes);
    if (!Number.isFinite(duration) || duration < 5 || duration > 1440) {
      return 'action.durationMinutes must be between 5 and 1440 minutes';
    }
  }

  const inverterCapacityW = getEffectiveInverterCapacityW(userConfig);
  const hasFdPwr = action.fdPwr !== undefined && action.fdPwr !== null && action.fdPwr !== '';

  if (POWER_REQUIRED_WORK_MODES.has(workMode)) {
    if (!hasFdPwr) {
      return `action.fdPwr is required for workMode ${workMode} and must be greater than 0`;
    }

    const fdPwr = Number(action.fdPwr);
    if (!Number.isFinite(fdPwr) || fdPwr <= 0) {
      return `action.fdPwr must be greater than 0 for workMode ${workMode}`;
    }

    if (fdPwr > inverterCapacityW) {
      return `action.fdPwr (${Math.round(fdPwr)}W) exceeds inverter capacity (${inverterCapacityW}W)`;
    }

    return null;
  }

  if (hasFdPwr) {
    const fdPwr = Number(action.fdPwr);
    if (!Number.isFinite(fdPwr) || fdPwr < 0) {
      return 'action.fdPwr must be a non-negative number';
    }

    if (fdPwr > inverterCapacityW) {
      return `action.fdPwr (${Math.round(fdPwr)}W) exceeds inverter capacity (${inverterCapacityW}W)`;
    }
  }

  return null;
}

function createAutomationRuleActionService(deps = {}) {
  const addHistoryEntry = deps.addHistoryEntry;
  const addMinutes = deps.addMinutes;
  const foxessAPI = deps.foxessAPI;
  // adapterRegistry is optional — enables multi-provider dispatch (e.g. Sungrow)
  const adapterRegistry = deps.adapterRegistry || null;
  const getUserTime = deps.getUserTime;
  const logger = deps.logger || { debug: () => {} };
  const resolveAutomationTimezone = deps.resolveAutomationTimezone;
  const serverTimestamp = deps.serverTimestamp;
  const sleep = typeof deps.sleep === 'function'
    ? deps.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (typeof addHistoryEntry !== 'function') {
    throw new Error('createAutomationRuleActionService requires addHistoryEntry()');
  }
  if (typeof addMinutes !== 'function') {
    throw new Error('createAutomationRuleActionService requires addMinutes()');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('createAutomationRuleActionService requires foxessAPI.callFoxESSAPI()');
  }
  if (typeof getUserTime !== 'function') {
    throw new Error('createAutomationRuleActionService requires getUserTime()');
  }
  if (typeof resolveAutomationTimezone !== 'function') {
    throw new Error('createAutomationRuleActionService requires resolveAutomationTimezone()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('createAutomationRuleActionService requires serverTimestamp()');
  }

  /**
   * Adapter-based applyRuleAction for non-FoxESS providers (e.g. Sungrow).
   * Uses the DeviceAdapter contract — getSchedule, setSchedule — instead of raw API calls.
   */
  async function applyRuleActionViaAdapter(userId, rule, userConfig, deviceAdapter) {
    console.log(`[SegmentSend] START applyRuleAction (adapter) for '${rule.name}'`);
    const action = rule.action || {};
    const deviceSN = resolveProviderDeviceId(userConfig).deviceId;

    if (!deviceSN) {
      console.error(`[SegmentSend] No deviceSN configured for user ${userId}`);
      return { errno: -1, msg: 'No device SN configured' };
    }

    const actionValidationError = validateRuleActionForUser(action, userConfig);
    if (actionValidationError) {
      console.error(`[SegmentSend] Invalid rule action for '${rule.name}': ${actionValidationError}`);
      return { errno: 400, msg: actionValidationError, segment: null, flagResult: null, verify: null, retrysFailed: false };
    }

    const userTimezone = resolveAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const startHour = userTime.hour;
    const startMinute = userTime.minute;
    const durationMins = action.durationMinutes || 30;
    const endTimeObj = addMinutes(startHour, startMinute, durationMins);
    let endHour = endTimeObj.hour;
    let endMinute = endTimeObj.minute;

    const startTotalMins = startHour * 60 + startMinute;
    const endTotalMins = endHour * 60 + endMinute;
    if (endTotalMins <= startTotalMins) {
      console.warn(`[SegmentSend] Adapter: midnight crossing capped at 23:59`);
      endHour = 23; endMinute = 59;
    }

    const segment = buildAutomationSchedulerSegment(action, { startHour, startMinute, endHour, endMinute });

    const context = { deviceSN, userConfig, userId };

    // Fetch current groups, clear old segments, apply new one
    let currentGroups = [];
    try {
      const schedResult = await deviceAdapter.getSchedule(context);
      if (schedResult?.errno === 0 && Array.isArray(schedResult.result?.groups)) {
        currentGroups = JSON.parse(JSON.stringify(schedResult.result.groups));
      }
    } catch (e) {
      console.warn('[SegmentSend] Adapter: failed to read current schedule:', e.message);
    }

    const clearedResult = clearSchedulerGroups(currentGroups);
    currentGroups = clearedResult.groups;
    currentGroups = applySegmentToGroups(currentGroups, segment, 0);

    let result = null;
    let applyAttempt = 0;
    while (applyAttempt < 3) {
      applyAttempt++;
      try {
        result = await deviceAdapter.setSchedule(context, currentGroups);
        if (result?.errno === 0) break;
      } catch (e) {
        result = { errno: -1, msg: e.message };
      }
      if (applyAttempt < 3) await sleep(1200);
    }

    if (!result || result.errno !== 0) {
      return {
        errno: result?.errno || -1,
        msg: result?.msg || result?.error || 'Adapter: failed to apply segment after 3 attempts',
        segment,
        flagResult: null,
        verify: null,
        retrysFailed: true
      };
    }

    // Brief settle time, then read-back verification
    await sleep(2000);
    let verify = null;
    try {
      verify = await deviceAdapter.getSchedule(context);
    } catch (e) {
      console.warn('[SegmentSend] Adapter: verification read failed:', e.message);
    }

    try {
      await addHistoryEntry(userId, {
        type: 'automation_action',
        ruleName: rule.name,
        action,
        segment,
        result: 'success',
        timestamp: serverTimestamp()
      });
    } catch (e) {
      console.warn('[Automation] Adapter: failed to log history:', e.message);
    }

    return {
      errno: 0,
      msg: 'Segment applied',
      segment,
      flagResult: null,
      verify: verify?.result || null,
      retrysFailed: false
    };
  }

  async function applyRuleAction(userId, rule, userConfig) {
    // Dispatch to adapter-based path for non-FoxESS providers
    if (adapterRegistry) {
      const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
      if (provider !== 'foxess') {
        const deviceAdapter = adapterRegistry.getDeviceProvider(provider);
        if (deviceAdapter) {
          return applyRuleActionViaAdapter(userId, rule, userConfig, deviceAdapter);
        }
        console.warn(`[SegmentSend] No adapter registered for provider '${provider}', falling back to FoxESS path`);
      }
    }

    console.log(`[SegmentSend] START applyRuleAction for '${rule.name}'`);
    const action = rule.action || {};
    const deviceSN = userConfig?.deviceSn;

    if (!deviceSN) {
      console.error(`[SegmentSend] No deviceSN configured for user ${userId}`);
      return { errno: -1, msg: 'No device SN configured' };
    }

    const actionValidationError = validateRuleActionForUser(action, userConfig);
    if (actionValidationError) {
      console.error(`[SegmentSend] Invalid rule action for '${rule.name}': ${actionValidationError}`);
      return {
        errno: 400,
        msg: actionValidationError,
        segment: null,
        flagResult: null,
        verify: null,
        retrysFailed: false
      };
    }

    const userTimezone = resolveAutomationTimezone(userConfig);
    const tzSource = userConfig?.timezone ? 'config' : 'default';
    logger.debug('Automation', `Using timezone: ${userTimezone} (source: ${tzSource})`);

    const userTime = getUserTime(userTimezone);
    const startHour = userTime.hour;
    const startMinute = userTime.minute;

    const durationMins = action.durationMinutes || 30;
    const endTimeObj = addMinutes(startHour, startMinute, durationMins);
    let endHour = endTimeObj.hour;
    let endMinute = endTimeObj.minute;

    const startTotalMins = startHour * 60 + startMinute;
    const endTotalMins = endHour * 60 + endMinute;

    if (endTotalMins <= startTotalMins) {
      console.warn(
        `[SegmentSend] MIDNIGHT CROSSING DETECTED: ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
      );
      endHour = 23;
      endMinute = 59;
      const actualDuration = (endHour * 60 + endMinute) - startTotalMins;
      console.warn(
        `[SegmentSend] CAPPED at 23:59 - Reduced duration from ${durationMins}min to ${actualDuration}min`
      );
    }

    logger.debug(
      'Automation',
      `Creating segment: ${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} - ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')} (${durationMins}min requested)`
    );

    let currentGroups = [];
    try {
      const currentScheduler = await foxessAPI.callFoxESSAPI(
        '/op/v1/device/scheduler/get',
        'POST',
        { deviceSN },
        userConfig,
        userId
      );
      if (currentScheduler.errno === 0 && currentScheduler.result?.groups) {
        currentGroups = JSON.parse(JSON.stringify(currentScheduler.result.groups));
        logger.debug('Automation', `Got ${currentGroups.length} groups from device`);
      }
    } catch (error) {
      console.warn('[Automation] Failed to get current scheduler:', error && error.message ? error.message : error);
    }

    const clearedResult = clearSchedulerGroups(currentGroups);
    currentGroups = clearedResult.groups;
    const clearedCount = clearedResult.clearedCount;
    if (clearedCount > 0) {
      logger.debug('Automation', `Cleared ${clearedCount} existing segment(s)`);
    }

    const startTotalMinsCheck = startHour * 60 + startMinute;
    const endTotalMinsCheck = endHour * 60 + endMinute;
    if (endTotalMinsCheck <= startTotalMinsCheck) {
      console.error(
        `[SegmentSend] Final validation failed - end time ${endHour}:${String(endMinute).padStart(2, '0')} is not after start time ${startHour}:${String(startMinute).padStart(2, '0')}`
      );
      throw new Error('Invalid segment: end time must be after start time (no midnight crossing allowed by FoxESS)');
    }

    const segment = buildAutomationSchedulerSegment(action, {
      startHour,
      startMinute,
      endHour,
      endMinute
    });

    currentGroups = applySegmentToGroups(currentGroups, segment, 0);

    let applyAttempt = 0;
    let result = null;
    while (applyAttempt < 3) {
      applyAttempt += 1;
      result = await foxessAPI.callFoxESSAPI(
        '/op/v1/device/scheduler/enable',
        'POST',
        { deviceSN, groups: currentGroups },
        userConfig,
        userId
      );

      if (result?.errno === 0) {
        break;
      }

      if (applyAttempt < 3) {
        await sleep(1200);
      }
    }

    if (result?.errno !== 0) {
      return {
        errno: result?.errno || -1,
        msg: result?.msg || 'Failed to apply segment after 3 retry attempts',
        segment,
        flagResult: null,
        verify: null,
        retrysFailed: true
      };
    }

    let flagResult = null;
    let flagAttempt = 0;
    while (flagAttempt < 2) {
      flagAttempt += 1;
      try {
        flagResult = await foxessAPI.callFoxESSAPI(
          '/op/v1/device/scheduler/set/flag',
          'POST',
          { deviceSN, enable: 1 },
          userConfig,
          userId
        );
        if (flagResult?.errno === 0) {
          break;
        }
      } catch (error) {
        console.error('[SegmentSend] Flag set exception:', error && error.message ? error.message : error);
      }

      if (flagAttempt < 2) {
        await sleep(800);
      }
    }

    await sleep(3000);

    let verify = null;
    let verifyAttempt = 0;
    while (verifyAttempt < 2) {
      verifyAttempt += 1;
      try {
        verify = await foxessAPI.callFoxESSAPI(
          '/op/v1/device/scheduler/get',
          'POST',
          { deviceSN },
          userConfig,
          userId
        );
        if (verify?.errno === 0) {
          break;
        }
      } catch (error) {
        console.error('[SegmentSend] Verification read exception:', error && error.message ? error.message : error);
      }

      if (verifyAttempt < 2) {
        await sleep(1000);
      }
    }

    try {
      await addHistoryEntry(userId, {
        type: 'automation_action',
        ruleName: rule.name,
        action,
        segment,
        result: result.errno === 0 ? 'success' : 'failed',
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.warn('[Automation] Failed to log history:', error && error.message ? error.message : error);
    }

    return {
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Segment applied' : 'Failed'),
      segment,
      flagResult,
      verify: verify?.result || null,
      retrysFailed: false
    };
  }

  return {
    applyRuleAction,
    validateRuleActionForUser
  };
}

module.exports = {
  createAutomationRuleActionService,
  getEffectiveInverterCapacityW,
  validateRuleActionForUser
};
