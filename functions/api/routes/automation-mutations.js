'use strict';

const { clearSchedulerSegments } = require('../../lib/services/scheduler-segment-service');
const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

function registerAutomationMutationRoutes(app, deps = {}) {
  const addAutomationAuditEntry = deps.addAutomationAuditEntry;
  const addHistoryEntry = deps.addHistoryEntry;
  const applyRuleAction = deps.applyRuleAction;
  const clearRulesLastTriggered = deps.clearRulesLastTriggered;
  const compareValue = deps.compareValue;
  const db = deps.db;
  const adapterRegistry = deps.adapterRegistry || null;
  const DEFAULT_TIMEZONE = deps.DEFAULT_TIMEZONE;
  const deleteUserRule = deps.deleteUserRule;
  const evaluateTemperatureCondition = deps.evaluateTemperatureCondition;
  const evaluateTimeCondition = deps.evaluateTimeCondition;
  const foxessAPI = deps.foxessAPI;
  const getAutomationAuditLogs = deps.getAutomationAuditLogs;
  const getUserAutomationState = deps.getUserAutomationState;
  const getUserConfig = deps.getUserConfig;
  const getUserRule = deps.getUserRule;
  const getUserRules = deps.getUserRules;
  const getUserTime = deps.getUserTime;
  const logger = deps.logger || console;
  const normalizeWeekdays = deps.normalizeWeekdays;
  const saveUserAutomationState = deps.saveUserAutomationState;
  const serverTimestamp = deps.serverTimestamp;
  const setUserRule = deps.setUserRule;
  const validateRuleActionForUser = deps.validateRuleActionForUser;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires an Express app');
  }
  if (typeof addAutomationAuditEntry !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires addAutomationAuditEntry()');
  }
  if (typeof addHistoryEntry !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires addHistoryEntry()');
  }
  if (typeof applyRuleAction !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires applyRuleAction()');
  }
  if (typeof clearRulesLastTriggered !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires clearRulesLastTriggered()');
  }
  if (typeof compareValue !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires compareValue()');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires db');
  }
  if (typeof DEFAULT_TIMEZONE !== 'string' || !DEFAULT_TIMEZONE) {
    throw new Error('registerAutomationMutationRoutes requires DEFAULT_TIMEZONE');
  }
  if (typeof deleteUserRule !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires deleteUserRule()');
  }
  if (typeof evaluateTemperatureCondition !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires evaluateTemperatureCondition()');
  }
  if (typeof evaluateTimeCondition !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires evaluateTimeCondition()');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires foxessAPI');
  }
  if (typeof getAutomationAuditLogs !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires getAutomationAuditLogs()');
  }
  if (typeof getUserAutomationState !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires getUserAutomationState()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires getUserConfig()');
  }
  if (typeof getUserRule !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires getUserRule()');
  }
  if (typeof getUserRules !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires getUserRules()');
  }
  if (typeof getUserTime !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires getUserTime()');
  }
  if (typeof normalizeWeekdays !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires normalizeWeekdays()');
  }
  if (typeof saveUserAutomationState !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires saveUserAutomationState()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires serverTimestamp()');
  }
  if (typeof setUserRule !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires setUserRule()');
  }
  if (typeof validateRuleActionForUser !== 'function') {
    throw new Error('registerAutomationMutationRoutes requires validateRuleActionForUser()');
  }

  function getProviderContext(userConfig = {}, explicitDeviceId) {
    const resolved = resolveProviderDeviceId(userConfig, explicitDeviceId);
    return {
      provider: String(resolved.provider || 'foxess').toLowerCase().trim(),
      deviceSN: resolved.deviceId || null
    };
  }

  function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getEnabledConditionKeys(conditions = {}) {
    return Object.entries(conditions || {})
      .filter(([, condition]) => condition && typeof condition === 'object' && condition.enabled === true)
      .map(([key]) => key);
  }

  function formatConditionName(conditionKey) {
    return String(conditionKey || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (char) => char.toUpperCase());
  }

  function findHourlyStartIndex(hourly = {}, currentTime = null) {
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    if (!times.length) return 0;
    if (typeof currentTime === 'string' && currentTime) {
      const currentHour = currentTime.substring(0, 13);
      const idx = times.findIndex((time) => typeof time === 'string' && time.substring(0, 13) === currentHour);
      if (idx >= 0) return idx;
    }
    return 0;
  }

  function evaluateAggregateConditionFromMock({
    conditionKey,
    label,
    condition,
    mockData,
    mockWeatherData
  }) {
    const lookAheadUnit = String(condition.lookAheadUnit || 'hours').trim().toLowerCase();
    const rawLookAhead = toFiniteNumber(condition.lookAhead, lookAheadUnit === 'days' ? 1 : 6) || (lookAheadUnit === 'days' ? 1 : 6);
    const checkType = String(condition.checkType || condition.check || 'average').trim().toLowerCase();
    const operator = condition.operator || condition.op || (conditionKey === 'cloudCover' ? '<' : '>');
    const target = toFiniteNumber(condition.value, 0);
    const target2 = toFiniteNumber(condition.value2, null);
    const weatherData = mockWeatherData?.result || mockWeatherData || null;
    const hourly = weatherData?.hourly || null;

    let actualValue = null;

    if (hourly && Array.isArray(hourly.time)) {
      const source = conditionKey === 'solarRadiation'
        ? hourly.shortwave_radiation
        : (hourly.cloudcover || hourly.cloud_cover);
      if (Array.isArray(source) && source.length > 0) {
        const lookAheadHours = lookAheadUnit === 'days' ? rawLookAhead * 24 : rawLookAhead;
        const startIdx = findHourlyStartIndex(hourly, weatherData?.current?.time || null);
        const endIdx = Math.min(startIdx + lookAheadHours, source.length);
        const values = source.slice(startIdx, endIdx).map((value) => Number(value)).filter((value) => Number.isFinite(value));
        if (values.length > 0) {
          if (checkType === 'min') {
            actualValue = Math.min(...values);
          } else if (checkType === 'max') {
            actualValue = Math.max(...values);
          } else {
            actualValue = values.reduce((sum, value) => sum + value, 0) / values.length;
          }
        }
      }
    }

    if (!Number.isFinite(actualValue)) {
      const fallbackValue = conditionKey === 'solarRadiation'
        ? (lookAheadUnit === 'days'
          ? toFiniteNumber(mockData.forecastSolar1D, toFiniteNumber(mockData.solarRadiation, null))
          : toFiniteNumber(mockData.solarRadiation, toFiniteNumber(mockData.forecastSolar1D, null)))
        : (lookAheadUnit === 'days'
          ? toFiniteNumber(mockData.forecastCloudCover1D, toFiniteNumber(mockData.cloudCover, null))
          : toFiniteNumber(mockData.cloudCover, toFiniteNumber(mockData.forecastCloudCover1D, null)));
      actualValue = Number.isFinite(fallbackValue) ? fallbackValue : null;
    }

    const met = Number.isFinite(actualValue)
      ? ((operator === 'between' && target2 !== null)
        ? compareValue(actualValue, 'between', target, target2)
        : compareValue(actualValue, operator, target))
      : false;

    return {
      met,
      detail: {
        name: label,
        value: Number.isFinite(actualValue) ? Math.round(actualValue) : 'N/A',
        target: operator === 'between' && target2 !== null ? `${target}-${target2}` : target,
        operator,
        met
      }
    };
  }

  function parseTimestampMs(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function normalizeForecastIntervals(priceData = [], priceType = 'general') {
    const channelType = priceType === 'feedIn' ? 'feedIn' : 'general';
    return (Array.isArray(priceData) ? priceData : [])
      .filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (String(entry.channelType || '').trim() !== channelType) return false;
        const entryType = String(entry.type || '').trim();
        return !entryType || entryType === 'ForecastInterval';
      })
      .map((entry) => {
        const startMs = parseTimestampMs(entry.startTime || entry.start || entry.nemTime || null);
        const endMs = parseTimestampMs(entry.endTime || entry.end || null);
        const perKwh = toFiniteNumber(entry.perKwh, null);
        if (!Number.isFinite(startMs) || !Number.isFinite(perKwh)) return null;
        return {
          startMs,
          endMs: Number.isFinite(endMs) && endMs > startMs ? endMs : (startMs + (30 * 60 * 1000)),
          value: channelType === 'feedIn' ? -perKwh : perKwh
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs);
  }

  function evaluateForecastPriceFromMock(condition, mockData) {
    const lookAheadUnit = String(condition.lookAheadUnit || 'minutes').trim().toLowerCase();
    const rawLookAhead = toFiniteNumber(condition.lookAhead, lookAheadUnit === 'days' ? 1 : lookAheadUnit === 'hours' ? 1 : 30)
      || (lookAheadUnit === 'days' ? 1 : lookAheadUnit === 'hours' ? 1 : 30);
    const lookAheadMinutes = lookAheadUnit === 'days'
      ? rawLookAhead * 24 * 60
      : lookAheadUnit === 'hours'
        ? rawLookAhead * 60
        : rawLookAhead;
    const priceType = String(condition.type || 'general').trim().toLowerCase() === 'feedin' ? 'feedIn' : 'general';
    const checkType = String(condition.checkType || condition.check || 'average').trim().toLowerCase();
    const operator = condition.operator || '>=';
    const target = toFiniteNumber(condition.value, 0);
    const target2 = toFiniteNumber(condition.value2, null);
    const intervals = normalizeForecastIntervals(mockData.priceData, priceType);

    let actualValue = null;
    if (intervals.length > 0) {
      const windowStartMs = intervals[0].startMs;
      const windowEndMs = windowStartMs + (lookAheadMinutes * 60 * 1000);
      const relevant = intervals.filter((interval) => interval.endMs > windowStartMs && interval.startMs < windowEndMs);
      const values = relevant.map((interval) => interval.value).filter((value) => Number.isFinite(value));
      if (values.length > 0) {
        if (checkType === 'min') {
          actualValue = Math.min(...values);
        } else if (checkType === 'max') {
          actualValue = Math.max(...values);
        } else if (checkType === 'any') {
          actualValue = values.find((value) => compareValue(value, operator, target, target2));
        } else {
          let weightedSum = 0;
          let weightedMs = 0;
          relevant.forEach((interval) => {
            const overlapMs = Math.max(0, Math.min(interval.endMs, windowEndMs) - Math.max(interval.startMs, windowStartMs));
            if (overlapMs <= 0) return;
            weightedSum += interval.value * overlapMs;
            weightedMs += overlapMs;
          });
          actualValue = weightedMs > 0 ? (weightedSum / weightedMs) : (values.reduce((sum, value) => sum + value, 0) / values.length);
        }
      }
    }

    if (!Number.isFinite(actualValue)) {
      const fallbackValue = priceType === 'feedIn'
        ? toFiniteNumber(mockData.forecastFeedIn1D, null)
        : toFiniteNumber(mockData.forecastBuy1D, null);
      actualValue = Number.isFinite(fallbackValue) ? fallbackValue : null;
    }

    const met = Number.isFinite(actualValue)
      ? (checkType === 'any'
        ? actualValue !== undefined && actualValue !== null
        : ((operator === 'between' && target2 !== null)
          ? compareValue(actualValue, 'between', target, target2)
          : compareValue(actualValue, operator, target)))
      : false;

    return {
      met,
      detail: {
        name: 'Forecast Price',
        value: Number.isFinite(actualValue) ? Number(actualValue.toFixed(1)) : 'N/A',
        target: operator === 'between' && target2 !== null ? `${target}-${target2}` : target,
        operator,
        met
      }
    };
  }

  async function clearActiveSegmentsForProvider(userId, userConfig, explicitDeviceId = null) {
    const { provider, deviceSN } = getProviderContext(userConfig, explicitDeviceId);
    if (!deviceSN) {
      return {
        provider,
        deviceSN: null,
        errno: 400,
        msg: 'Device SN not configured',
        flagResult: null,
        verify: null
      };
    }

    if (provider !== 'foxess' && adapterRegistry) {
      const adapter = adapterRegistry.getDeviceProvider(provider);
      if (adapter && typeof adapter.clearSchedule === 'function') {
        const result = await adapter.clearSchedule({ deviceSN, userConfig, userId });
        let verify = null;
        try {
          if (typeof adapter.getSchedule === 'function') {
            verify = await adapter.getSchedule({ deviceSN, userConfig, userId });
          }
        } catch (verifyErr) {
          console.warn('[Automation] Adapter verify read failed:', verifyErr && verifyErr.message ? verifyErr.message : verifyErr);
        }

        return {
          provider,
          deviceSN,
          errno: result?.errno ?? 500,
          msg: result?.msg || result?.error || (result?.errno === 0 ? 'Automation cancelled' : 'Failed'),
          flagResult: null,
          verify: verify?.result || null
        };
      }

      return {
        provider,
        deviceSN,
        errno: 400,
        msg: `Not supported for provider: ${provider}`,
        flagResult: null,
        verify: null
      };
    }

    const result = await clearSchedulerSegments({
      deviceSN,
      foxessAPI,
      userConfig,
      userId
    });
    logger.debug('Automation', `Cancel v1 result: errno=${result.errno}`);

    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      logger.debug('Automation', `Cancel flag result: errno=${flagResult?.errno}`);
    } catch (flagErr) {
      console.warn('[Automation] Flag disable failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }

    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      console.warn('[Automation] Verify read failed:', e && e.message ? e.message : e);
    }

    return {
      provider,
      deviceSN,
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Automation cancelled' : 'Failed'),
      flagResult,
      verify: verify?.result || null
    };
  }

  async function restoreCurtailmentIfRequired(userId, userConfig, curtailmentState, reasonKey) {
    if (!curtailmentState?.active) return;

    const { provider, deviceSN } = getProviderContext(userConfig);
    if (provider !== 'foxess' || !deviceSN) {
      await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
        active: false,
        lastPrice: null,
        lastDeactivated: Date.now(),
        disabledByAutomationToggle: true,
        disabledReason: reasonKey || 'unsupported_provider'
      });
      return;
    }

    const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
      sn: deviceSN,
      key: 'ExportLimit',
      value: 12000
    }, userConfig, userId);

    if (setResult?.errno === 0) {
      await db.collection('users').doc(userId).collection('curtailment').doc('state').set({
        active: false,
        lastPrice: null,
        lastDeactivated: Date.now(),
        disabledByAutomationToggle: true
      });
    } else {
      throw new Error(setResult?.msg || setResult?.error || 'Failed to restore export power');
    }
  }

// Toggle automation

app.post('/api/automation/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.uid;
    
    // When disabling automation, check if curtailment is active and restore export power
    if (enabled === false) {
      try {
        const userConfig = await getUserConfig(userId);
        const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
        const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false };
        
        if (curtailmentState.active) {
          console.log('[Automation Toggle] Restoring curtailment state before disabling automation');
          await restoreCurtailmentIfRequired(userId, userConfig, curtailmentState, 'automation_toggle');
          console.log('[Automation Toggle] Curtailment state restored');
        }
      } catch (curtErr) {
        console.error('[Automation Toggle] Error checking/restoring curtailment:', curtErr);
        // Don't fail the toggle operation if curtailment restoration fails
      }
    }
    
    await saveUserAutomationState(userId, { enabled: !!enabled });
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Backwards-compatible alias: some frontends call /api/automation/enable
app.post('/api/automation/enable', async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.uid;
    const stateUpdate = { enabled: !!enabled };
    
    // When re-enabling automation, clear the segmentsCleared flag so segments will be re-cleared on next disable
    if (enabled === true) {
      stateUpdate.segmentsCleared = false;
    }
    
    // When disabling automation, check if curtailment is active and restore export power
    if (enabled === false) {
      try {
        const userConfig = await getUserConfig(userId);
        const stateDoc = await db.collection('users').doc(userId).collection('curtailment').doc('state').get();
        const curtailmentState = stateDoc.exists ? stateDoc.data() : { active: false };
        
        if (curtailmentState.active) {
          console.log('[Automation Enable] Restoring curtailment state before disabling automation');
          await restoreCurtailmentIfRequired(userId, userConfig, curtailmentState, 'automation_enable');
          console.log('[Automation Enable] Curtailment state restored');
        }
      } catch (curtErr) {
        console.error('[Automation Enable] Error checking/restoring curtailment:', curtErr);
        // Don't fail the toggle operation if curtailment restoration fails
      }
    }
    
    await saveUserAutomationState(userId, stateUpdate);
    res.json({ errno: 0, result: { enabled: !!enabled } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Manually trigger a rule (for testing) - applies the rule's action immediately
app.post('/api/automation/trigger', async (req, res) => {
  try {
    const { ruleName } = req.body;
    
    if (!ruleName) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    // Get the rule
    const rules = await getUserRules(req.user.uid);
    const ruleId = ruleName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rule = rules[ruleId] || rules[ruleName];
    
    if (!rule) {
      return res.status(400).json({ errno: 400, error: `Unknown rule: ${ruleName}` });
    }
    
    // Get user config
    const userConfig = await getUserConfig(req.user.uid);
    
    // Apply the rule action (uses v1 API, sets flag, does verification)
    const result = await applyRuleAction(req.user.uid, rule, userConfig);
    
    // Update automation state - use ruleId for UI matching
    await saveUserAutomationState(req.user.uid, {
      lastTriggered: Date.now(),
      activeRule: ruleId,
      activeRuleName: rule.name || ruleName,
      activeEnergyTracking: null
    });
    
    // Update rule's lastTriggered
    await setUserRule(req.user.uid, ruleId, {
      lastTriggered: serverTimestamp()
    }, { merge: true });
    
    res.json({ errno: 0, result, ruleName });
  } catch (error) {
    console.error('[Automation] Trigger error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Reset automation state (clear cooldowns, active rule, etc.)
app.post('/api/automation/reset', async (req, res) => {
  try {
    // Reset automation state
    await saveUserAutomationState(req.user.uid, {
      lastTriggered: null,
      activeRule: null,
      activeRuleName: null,
      activeEnergyTracking: null,
      activeSegment: null,
      activeSegmentEnabled: false,
      lastCheck: null
    });
    
    // Reset lastTriggered on all rules
    await clearRulesLastTriggered(req.user.uid);
    
    logger.debug('Automation', `State reset for user ${req.user.uid}`);
    res.json({ errno: 0, result: 'Automation state reset' });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Cancel active automation segment - clears all scheduler segments
app.post('/api/automation/cancel', async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const providerContext = getProviderContext(userConfig);
    const deviceSN = providerContext.deviceSN;
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    logger.debug('Automation', `Cancel request for user ${userId}, provider ${providerContext.provider}, device ${deviceSN}`);
    const cleared = await clearActiveSegmentsForProvider(userId, userConfig, deviceSN);
    
    // Clear active rule in state
    await saveUserAutomationState(userId, {
      activeRule: null,
      activeRuleName: null,
      activeEnergyTracking: null,
      activeSegment: null,
      activeSegmentEnabled: false
    });
    
    // Log to history
    try {
      await addHistoryEntry(userId, {
        type: 'automation_cancel',
        timestamp: serverTimestamp()
      });
    } catch (e) { /* ignore */ }
    
    res.json({
      errno: cleared.errno,
      msg: cleared.msg,
      flagResult: cleared.flagResult,
      verify: cleared.verify
    });
  } catch (error) {
    console.error('[Automation] Cancel error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Manually end an orphan ongoing rule (create a "complete" audit entry with endTime)
// This fixes rules that get stuck in "ongoing" state without a proper termination event
app.post('/api/automation/rule/end', async (req, res) => {
  try {
    const { ruleId, ruleName, endTime } = req.body;
    const userId = req.user.uid;
    
    if (!ruleId && !ruleName) {
      return res.status(400).json({ errno: 400, error: 'ruleId or ruleName is required' });
    }
    
    const actualRuleId = ruleId || (ruleName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const endTimestamp = endTime || Date.now();
    
    logger.debug('Automation', `Manual rule end requested: ruleId=${actualRuleId}, endTime=${endTimestamp}`);
    
    // Get automation audit logs to find the start event for this rule
    const auditLogs = await getAutomationAuditLogs(userId, 500);
    
    // Find the most recent log where this rule became active
    let startEvent = null;
    let startTimestamp = null;
    
    for (const log of auditLogs) {
      if (log.activeRuleAfter === actualRuleId && log.triggered) {
        startTimestamp = log.epochMs;
        startEvent = {
          ruleName: log.ruleName,
          ruleId: actualRuleId,
          conditions: log.evaluationResults,
          allRuleEvaluations: log.allRuleEvaluations,
          action: log.actionTaken
        };
        break;  // Found the most recent activation (logs are in desc order)
      }
    }
    
    if (!startEvent) {
      return res.status(400).json({ errno: 400, error: `No activation event found for rule ${actualRuleId}` });
    }
    
    logger.debug('Automation', `Found start event at ${new Date(startTimestamp).toISOString()}`);
    
    // Create an audit entry that shows the rule being deactivated
    // This creates the "off" event that pairs with the "on" event in the audit trail
    await addAutomationAuditEntry(userId, {
      cycleId: `cycle_manual_end_${Date.now()}`,
      triggered: false,
      ruleName: startEvent.ruleName,
      ruleId: actualRuleId,
      evaluationResults: [],
      allRuleEvaluations: [{
        name: startEvent.ruleName,
        ruleId: actualRuleId,
        triggered: false,
        conditions: [],
        feedInPrice: null,
        buyPrice: null
      }],
      actionTaken: null,
      activeRuleBefore: actualRuleId,
      activeRuleAfter: null,  // This is the key - switching from activeRule to null marks it as ended
      rulesEvaluated: 0,
      cycleDurationMs: endTimestamp - startTimestamp,
      manualEnd: true  // Flag to indicate this was manually ended
    });
    
    // Also clear the active rule from state if it's still set to this rule
    const state = await getUserAutomationState(userId);
    if (state && state.activeRule === actualRuleId) {
      logger.debug('Automation', `Clearing active rule state for ${actualRuleId}`);
      await saveUserAutomationState(userId, {
        activeRule: null,
        activeRuleName: null,
        activeEnergyTracking: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
    }
    
    const durationMs = endTimestamp - startTimestamp;
    logger.debug('Automation', `Orphan rule ended: ${startEvent.ruleName} (${Math.round(durationMs / 1000)}s duration)`);
    
    res.json({
      errno: 0,
      result: {
        ended: true,
        ruleName: startEvent.ruleName,
        ruleId: actualRuleId,
        startTime: startTimestamp,
        endTime: endTimestamp,
        durationMs,
        message: 'Orphan rule successfully ended with completion timestamp'
      }
    });
  } catch (error) {
    console.error('[Automation] Manual rule end error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Create automation rule
app.post('/api/automation/rule/create', async (req, res) => {
  try {
    const { name, enabled, priority, conditions, action, cooldownMinutes } = req.body;
    
    if (!name) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }

    const normalizedCooldown = cooldownMinutes === undefined ? 5 : Number(cooldownMinutes);
    if (!Number.isInteger(normalizedCooldown) || normalizedCooldown < 1 || normalizedCooldown > 1440) {
      return res.status(400).json({ errno: 400, error: 'cooldownMinutes must be an integer between 1 and 1440' });
    }

    const userConfig = await getUserConfig(req.user.uid);
    const actionValidationError = validateRuleActionForUser(action, userConfig);
    if (actionValidationError) {
      return res.status(400).json({ errno: 400, error: actionValidationError });
    }
    
    const ruleId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rule = {
      name,
      enabled: enabled !== false,
      priority: typeof priority === 'number' ? priority : 5, // Default to priority 5 for new rules
      conditions: conditions || {},
      action: action || {},
      cooldownMinutes: normalizedCooldown,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    await setUserRule(req.user.uid, ruleId, rule);
    res.json({ errno: 0, result: { ruleId, ...rule } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Update automation rule (backwards-compatible endpoint used by frontend)
// IMPORTANT: Only updates provided fields - does NOT overwrite with defaults
app.post('/api/automation/rule/update', async (req, res) => {
  try {
    const { ruleName, name, enabled, priority, conditions, action, cooldownMinutes } = req.body;

    if (!ruleName && !name) {
      return res.status(400).json({ errno: 400, error: 'Rule name or ruleId is required' });
    }

    const ruleId = (ruleName || name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    
    // Build update object with ONLY provided fields to avoid overwriting existing data
    const update = {
      updatedAt: serverTimestamp()
    };
    
    // Only include fields that were explicitly provided in the request
    if (name !== undefined) update.name = name;
    if (enabled !== undefined) update.enabled = !!enabled;
    if (typeof priority === 'number') update.priority = priority;
    if (conditions !== undefined) update.conditions = conditions;
    if (cooldownMinutes !== undefined) {
      const normalizedCooldown = Number(cooldownMinutes);
      if (!Number.isInteger(normalizedCooldown) || normalizedCooldown < 1 || normalizedCooldown > 1440) {
        return res.status(400).json({ errno: 400, error: 'cooldownMinutes must be an integer between 1 and 1440' });
      }
      update.cooldownMinutes = normalizedCooldown;
    }
    
    // Handle action - merge with existing if partial update
    if (action !== undefined) {
      // Get existing rule to merge action properly
      const existingRule = await getUserRule(req.user.uid, ruleId);
      if (existingRule && existingRule.data.action) {
        // Merge new action fields with existing action
        update.action = { ...existingRule.data.action, ...action };
      } else {
        update.action = action;
      }

      const userConfig = await getUserConfig(req.user.uid);
      const actionValidationError = validateRuleActionForUser(update.action, userConfig);
      if (actionValidationError) {
        return res.status(400).json({ errno: 400, error: actionValidationError });
      }
    }

    console.log(`[Rule Update] Updating rule ${ruleId} with fields:`, Object.keys(update));
    
    // If rule is being DISABLED, clear lastTriggered to reset cooldown
    // This ensures the rule can trigger immediately when re-enabled
    if (enabled === false) {
      update.lastTriggered = null;
      console.log(`[Rule Update] Rule ${ruleId} disabled - clearing lastTriggered to reset cooldown`);
      
      // Also check if this was the active rule and clear segments IMMEDIATELY + create audit entry
      const state = await getUserAutomationState(req.user.uid);
      if (state && state.activeRule === ruleId) {
        console.log(`[Rule Update] Disabled rule was active - clearing segments immediately`);
        
        // Get user config for provider/device context
        const userConfig = await getUserConfig(req.user.uid);
        const deviceSN = getProviderContext(userConfig).deviceSN;
        
        // Clear scheduler segments immediately
        if (deviceSN) {
          try {
            const cleared = await clearActiveSegmentsForProvider(req.user.uid, userConfig, deviceSN);
            if (cleared?.errno === 0) {
              console.log('[Rule Update] Segments cleared successfully');
            } else {
              console.warn(`[Rule Update] Failed to clear segments: errno=${cleared?.errno}`);
            }
          } catch (err) {
            console.error('[Rule Update] Error clearing segments:', err.message);
          }
        }
        
        // Create audit entry to mark rule as ended (critical for ROI display)
        const activationTime = state.lastTriggered || Date.now();
        const deactivationTime = Date.now();
        const durationMs = deactivationTime - activationTime;
        
        await addAutomationAuditEntry(req.user.uid, {
          cycleId: `cycle_rule_disabled_${Date.now()}`,
          triggered: false,
          ruleName: state.activeRuleName || state.activeRule,
          ruleId: state.activeRule,
          evaluationResults: [],
          allRuleEvaluations: [{
            name: state.activeRuleName || state.activeRule,
            ruleId: state.activeRule,
            triggered: false,
            conditions: [],
            feedInPrice: null,
            buyPrice: null
          }],
          actionTaken: null,
          activeRuleBefore: state.activeRule,
          activeRuleAfter: null,  // This marks the rule as ended
          rulesEvaluated: 0,
          cycleDurationMs: durationMs,
          manualEnd: true,
          reason: 'Rule disabled by user'
        });
        
        console.log('[Rule Update] Audit entry created - rule marked as ended');
        
        // Clear active rule state
        await saveUserAutomationState(req.user.uid, {
          activeRule: null,
          activeRuleName: null,
          activeEnergyTracking: null,
          activeSegment: null,
          activeSegmentEnabled: false
        });
      }
    }
    
    await setUserRule(req.user.uid, ruleId, update, { merge: true });
    
    // Return the updated rule
    const updatedRule = await getUserRule(req.user.uid, ruleId);
    res.json({ errno: 0, result: { ruleId, ...(updatedRule ? updatedRule.data : {}) } });
  } catch (error) {
    console.error('[Rule Update] Error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});
// Delete automation rule
app.post('/api/automation/rule/delete', async (req, res) => {
  try {
    const { ruleName } = req.body;
    
    if (!ruleName) {
      return res.status(400).json({ errno: 400, error: 'Rule name is required' });
    }
    
    const ruleId = ruleName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    
    // Check if this is the active rule, if so, set flag to clear segments
    const state = await getUserAutomationState(req.user.uid);
    if (state && state.activeRule === ruleId) {
      console.log(`[Rule Delete] Deleted rule was active - clearing segments immediately`);
      
      // Get user config for provider/device context
      const userConfig = await getUserConfig(req.user.uid);
      const deviceSN = getProviderContext(userConfig).deviceSN;
      
      // Clear scheduler segments immediately
      if (deviceSN) {
        try {
          const cleared = await clearActiveSegmentsForProvider(req.user.uid, userConfig, deviceSN);
          if (cleared?.errno === 0) {
            console.log('[Rule Delete] Segments cleared successfully');
          } else {
            console.warn(`[Rule Delete] Failed to clear segments: errno=${cleared?.errno}`);
          }
        } catch (err) {
          console.error('[Rule Delete] Error clearing segments:', err.message);
        }
      }
      
      // Create audit entry to mark rule as ended (critical for ROI display)
      const activationTime = state.lastTriggered || Date.now();
      const deactivationTime = Date.now();
      const durationMs = deactivationTime - activationTime;
      
      await addAutomationAuditEntry(req.user.uid, {
        cycleId: `cycle_rule_deleted_${Date.now()}`,
        triggered: false,
        ruleName: state.activeRuleName || state.activeRule,
        ruleId: state.activeRule,
        evaluationResults: [],
        allRuleEvaluations: [{
          name: state.activeRuleName || state.activeRule,
          ruleId: state.activeRule,
          triggered: false,
          conditions: [],
          feedInPrice: null,
          buyPrice: null
        }],
        actionTaken: null,
        activeRuleBefore: state.activeRule,
        activeRuleAfter: null,  // This marks the rule as ended
        rulesEvaluated: 0,
        cycleDurationMs: durationMs,
        manualEnd: true,
        reason: 'Rule deleted by user'
      });
      
      console.log('[Rule Delete] Audit entry created - rule marked as ended');
      
      // Clear active rule state
      await saveUserAutomationState(req.user.uid, {
        activeRule: null,
        activeRuleName: null,
        activeEnergyTracking: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
    }
    
    await deleteUserRule(req.user.uid, ruleId);
    res.json({ errno: 0, result: { deleted: ruleName } });
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});

// Run automation test with provided mock data (simulation)
app.post('/api/automation/test', async (req, res) => {
  try {
    const mockData = req.body && req.body.mockData ? req.body.mockData : (req.body || {});

    // Load user rules
    const rules = await getUserRules(req.user.uid, { enabledOnly: true });
    const sorted = Object.entries(rules || {}).filter(([_, r]) => r.enabled).sort((a,b) => (a[1].priority||99) - (b[1].priority||99));

    const allResults = [];
    const parseMockTime = (timeStr) => {
      if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
      const [hh, mm] = timeStr.split(':').map((x) => parseInt(x, 10));
      if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return null;
      }
      return { hour: hh, minute: mm };
    };

    const mockTime = parseMockTime(mockData.testTime);
    const mockDayRaw = mockData.testDayOfWeek !== undefined ? mockData.testDayOfWeek : mockData.dayOfWeek;
    const normalizedMockDays = normalizeWeekdays(mockDayRaw !== undefined ? [mockDayRaw] : []);
    const mockDayOfWeek = normalizedMockDays.length > 0 ? normalizedMockDays[0] : null;

    let mockWeatherData = mockData.weatherData || mockData.weather || null;
    if (!mockWeatherData) {
      const maxDaily = Array.isArray(mockData.dailyMaxTemps) ? mockData.dailyMaxTemps : null;
      const minDaily = Array.isArray(mockData.dailyMinTemps) ? mockData.dailyMinTemps : null;
      if (maxDaily || minDaily) {
        mockWeatherData = {
          daily: {
            temperature_2m_max: maxDaily || [],
            temperature_2m_min: minDaily || []
          }
        };
      }
    }

    for (const [ruleId, rule] of sorted) {
      const cond = rule.conditions || {};
      const enabledConditionKeys = getEnabledConditionKeys(cond);
      let met = true;
      const condDetails = [];
      const handledConditionKeys = new Set();

      if (enabledConditionKeys.length === 0) {
        allResults.push({
          ruleName: rule.name || ruleId,
          ruleId,
          met: false,
          priority: rule.priority || 99,
          conditions: [],
          action: rule.action || {},
          reason: 'No conditions enabled'
        });
        continue;
      }

      // price (provider-agnostic current price condition)
      if (cond.price?.enabled) {
        const priceType = String(cond.price.type || 'feedIn').trim().toLowerCase();
        const actual = priceType === 'buy' || priceType === 'general'
          ? Number(mockData.buyPrice || 0)
          : Number(mockData.feedInPrice || 0);
        const target = Number(cond.price.value || 0);
        const target2 = cond.price.value2 !== undefined ? Number(cond.price.value2) : undefined;
        const operator = cond.price.operator || cond.price.op || '>=';
        const cmet = operator === 'between' && target2 !== undefined
          ? compareValue(actual, 'between', target, target2)
          : compareValue(actual, operator, target);
        condDetails.push({
          name: priceType === 'buy' || priceType === 'general' ? 'Buy Price' : 'Feed-in Price',
          value: actual,
          target,
          operator,
          met: !!cmet
        });
        handledConditionKeys.add('price');
        if (!cmet) met = false;
      }

      // feedInPrice
      if (cond.feedInPrice?.enabled) {
        const price = Number(mockData.feedInPrice || 0);
        const target = Number(cond.feedInPrice.value || 0);
        const target2 = cond.feedInPrice.value2 !== undefined ? Number(cond.feedInPrice.value2) : undefined;
        const operator = cond.feedInPrice.operator || cond.feedInPrice.op || '>=';
        const cmet = operator === 'between' && target2 !== undefined
          ? compareValue(price, 'between', target, target2)
          : compareValue(price, operator, target);
        condDetails.push({ name: 'Feed-in Price', value: price, target, operator, met: !!cmet });
        handledConditionKeys.add('feedInPrice');
        if (!cmet) met = false;
      }

      // buyPrice
      if (cond.buyPrice?.enabled) {
        const price = Number(mockData.buyPrice || 0);
        const target = Number(cond.buyPrice.value || 0);
        const target2 = cond.buyPrice.value2 !== undefined ? Number(cond.buyPrice.value2) : undefined;
        const operator = cond.buyPrice.operator || cond.buyPrice.op || '>=';
        const cmet = operator === 'between' && target2 !== undefined
          ? compareValue(price, 'between', target, target2)
          : compareValue(price, operator, target);
        condDetails.push({ name: 'Buy Price', value: price, target, operator, met: !!cmet });
        handledConditionKeys.add('buyPrice');
        if (!cmet) met = false;
      }

      // soc
      if (cond.soc?.enabled) {
        const soc = Number(mockData.soc || 0);
        const target = Number(cond.soc.value || 0);
        const target2 = cond.soc.value2 !== undefined ? Number(cond.soc.value2) : undefined;
        const operator = cond.soc.operator || cond.soc.op || '>=';
        const cmet = operator === 'between' && target2 !== undefined
          ? compareValue(soc, 'between', target, target2)
          : compareValue(soc, operator, target);
        condDetails.push({ name: 'Battery SoC', value: soc, target, operator, met: !!cmet });
        handledConditionKeys.add('soc');
        if (!cmet) met = false;
      }

      // temperature
      const tempCond = cond.temp || cond.temperature;
      if (tempCond?.enabled) {
        const tempResult = evaluateTemperatureCondition(tempCond, {
          batteryTemp: Number(mockData.batteryTemp),
          ambientTemp: Number(mockData.ambientTemp),
          inverterTemp: Number(mockData.inverterTemp),
          weatherData: mockWeatherData
        });

        if (tempResult.reason) {
          condDetails.push({
            name: 'Temperature',
            value: null,
            target: Number(tempCond.value || 0),
            operator: tempCond.operator || tempCond.op || '>',
            met: false,
            reason: tempResult.reason
          });
          if (cond.temp?.enabled) handledConditionKeys.add('temp');
          if (cond.temperature?.enabled) handledConditionKeys.add('temperature');
          met = false;
        } else {
          const normalizedTempType = String(tempResult.type || '').toLowerCase();
          const label = tempResult.source === 'weather_daily'
            ? `Forecast ${tempResult.metric === 'min' ? 'Min' : 'Max'} Temp (D+${tempResult.dayOffset || 0})`
            : (normalizedTempType === 'battery'
              ? 'Battery Temp'
              : normalizedTempType === 'inverter'
                ? 'Inverter Temp'
                : 'Ambient Temp');
          condDetails.push({
            name: label,
            value: tempResult.actual,
            target: tempResult.target,
            operator: tempResult.operator,
            met: !!tempResult.met
          });
          if (cond.temp?.enabled) handledConditionKeys.add('temp');
          if (cond.temperature?.enabled) handledConditionKeys.add('temperature');
          if (!tempResult.met) met = false;
        }
      }

      if (cond.solarRadiation?.enabled) {
        const result = evaluateAggregateConditionFromMock({
          conditionKey: 'solarRadiation',
          label: 'Solar Radiation',
          condition: cond.solarRadiation,
          mockData,
          mockWeatherData
        });
        condDetails.push(result.detail);
        handledConditionKeys.add('solarRadiation');
        if (!result.met) met = false;
      }

      if (cond.cloudCover?.enabled) {
        const result = evaluateAggregateConditionFromMock({
          conditionKey: 'cloudCover',
          label: 'Cloud Cover',
          condition: cond.cloudCover,
          mockData,
          mockWeatherData
        });
        condDetails.push(result.detail);
        handledConditionKeys.add('cloudCover');
        if (!result.met) met = false;
      }

      if (cond.forecastPrice?.enabled) {
        const result = evaluateForecastPriceFromMock(cond.forecastPrice, mockData);
        condDetails.push(result.detail);
        handledConditionKeys.add('forecastPrice');
        if (!result.met) met = false;
      }

      // time
      const timeCond = cond.time || cond.timeWindow;
      if (timeCond?.enabled) {
        const defaultUserTime = getUserTime(DEFAULT_TIMEZONE);
        const userTime = {
          hour: mockTime ? mockTime.hour : defaultUserTime.hour,
          minute: mockTime ? mockTime.minute : defaultUserTime.minute,
          dayOfWeek: mockDayOfWeek !== null ? mockDayOfWeek : defaultUserTime.dayOfWeek
        };
        const timeResult = evaluateTimeCondition(timeCond, {
          timezone: DEFAULT_TIMEZONE,
          userTime
        });
        condDetails.push({
          name: 'Time Window',
          value: timeResult.actualTime,
          target: `${timeResult.startTime}-${timeResult.endTime} (${timeResult.daysLabel})`,
          operator: 'in',
          met: !!timeResult.met
        });
        if (cond.time?.enabled) handledConditionKeys.add('time');
        if (cond.timeWindow?.enabled) handledConditionKeys.add('timeWindow');
        if (!timeResult.met) met = false;
      }

      enabledConditionKeys
        .filter((key) => !handledConditionKeys.has(key))
        .forEach((key) => {
          condDetails.push({
            name: formatConditionName(key),
            value: 'N/A',
            target: 'Unsupported in Automation Lab',
            operator: 'n/a',
            met: false
          });
          met = false;
        });

      allResults.push({
        ruleName: rule.name || ruleId,
        ruleId,
        met,
        priority: rule.priority || 99,
        conditions: condDetails,
        action: rule.action || {}
      });

      if (met) {
        // First match wins
        return res.json({ errno: 0, triggered: true, result: { ruleName: rule.name || ruleId, ruleId, priority: rule.priority || 99, action: rule.action || {} }, testData: mockData, allResults });
      }
    }

    // No rules triggered
    res.json({ errno: 0, triggered: false, result: null, testData: mockData, allResults });
  } catch (error) {
    console.error('[API] /api/automation/test error:', error);
    res.status(500).json({ errno: 500, error: error.message });
  }
});

}

module.exports = {
  registerAutomationMutationRoutes
};

