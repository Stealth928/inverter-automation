'use strict';

const { resolveProviderDeviceId } = require('../../lib/provider-device-id');

const { buildAllRuleEvaluationsForAudit } = require('../../lib/services/automation-audit-service');
const {
  applyTriggeredRuleAction,
  persistTriggeredRuleState
} = require('../../lib/services/automation-cycle-action-service');
const {
  fetchAutomationAmberData,
  fetchAutomationInverterData
} = require('../../lib/services/automation-cycle-data-service');
const {
  buildClearedActiveRuleState,
  buildContinuingEvaluationResult,
  buildCooldownEvaluationResult,
  buildTriggeredRuleSummary,
  evaluateRuleCooldown
} = require('../../lib/services/automation-cycle-lifecycle-service');
const {
  buildWeatherFetchPlan,
  evaluateBlackoutWindow
} = require('../../lib/services/automation-cycle-rule-service');
const {
  buildRoiSnapshot
} = require('../../lib/services/automation-roi-service');
const {
  clearSchedulerSegmentsOneShot,
  clearSchedulerSegmentsWithRetry
} = require('../../lib/services/scheduler-segment-service');
const {
  DEFAULT_FRESHNESS_MAX_AGE_MS,
  DEFAULT_FROZEN_MAX_AGE_MS,
  evaluateTelemetryHealth
} = require('../../lib/services/automation-telemetry-health-service');

function buildTelemetryCyclePayload(telemetryHealth) {
  if (!telemetryHealth || typeof telemetryHealth !== 'object') {
    return null;
  }
  return {
    status: telemetryHealth.telemetryStatus || 'unknown',
    pauseReason: telemetryHealth.pauseReason || null,
    timestampMs: Number.isFinite(Number(telemetryHealth.telemetryTimestampMs))
      ? Number(telemetryHealth.telemetryTimestampMs)
      : null,
    ageMs: Number.isFinite(Number(telemetryHealth.telemetryAgeMs))
      ? Number(telemetryHealth.telemetryAgeMs)
      : null,
    freshnessMaxAgeMs: Number.isFinite(Number(telemetryHealth.freshnessMaxAgeMs))
      ? Number(telemetryHealth.freshnessMaxAgeMs)
      : DEFAULT_FRESHNESS_MAX_AGE_MS,
    frozenMaxAgeMs: Number.isFinite(Number(telemetryHealth.frozenMaxAgeMs))
      ? Number(telemetryHealth.frozenMaxAgeMs)
      : DEFAULT_FROZEN_MAX_AGE_MS,
    staleDueToMissingTimestamp: telemetryHealth.staleDueToMissingTimestamp === true,
    staleDueToAge: telemetryHealth.staleDueToAge === true,
    frozen: telemetryHealth.frozen === true
  };
}

function buildTelemetryResetStatePatch(nowMs = Date.now()) {
  return {
    telemetryTimestampMs: null,
    telemetryAgeMs: null,
    telemetryFingerprint: null,
    telemetryFingerprintSinceMs: null,
    telemetryFailsafePaused: false,
    telemetryFailsafePauseReason: null,
    telemetryHealthStatus: 'unknown',
    telemetryUpdatedAtMs: Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  };
}

function registerAutomationCycleRoute(app, deps = {}) {
  const addAutomationAuditEntry = deps.addAutomationAuditEntry;
  const amberAPI = deps.amberAPI;
  const amberPricesInFlight = deps.amberPricesInFlight;
  const adapterRegistry = deps.adapterRegistry || null;
  const applyRuleAction = deps.applyRuleAction;
  const checkAndApplyCurtailment = deps.checkAndApplyCurtailment;
  const cleanupExpiredQuickControl = deps.cleanupExpiredQuickControl;
  const evaluateRule = deps.evaluateRule;
  const foxessAPI = deps.foxessAPI;
  const getAutomationTimezone = deps.getAutomationTimezone;
  const getCachedInverterData = deps.getCachedInverterData;
  const getCachedInverterRealtimeData = deps.getCachedInverterRealtimeData;
  const getCachedWeatherData = deps.getCachedWeatherData;
  const getQuickControlState = deps.getQuickControlState;
  const getUserAutomationState = deps.getUserAutomationState;
  const getUserConfig = deps.getUserConfig;
  const getUserRules = deps.getUserRules;
  const getUserTime = deps.getUserTime;
  const isForecastTemperatureType = deps.isForecastTemperatureType;
  const logger = deps.logger || console;
  const emitAutomationNotification = typeof deps.emitAutomationNotification === 'function'
    ? deps.emitAutomationNotification
    : null;
  const warnLog = typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console);
  const errorLog = typeof logger.error === 'function' ? logger.error.bind(logger) : console.error.bind(console);
  const saveUserAutomationState = deps.saveUserAutomationState;
  const serverTimestamp = deps.serverTimestamp;
  const setUserRule = deps.setUserRule;

  if (!app || typeof app.post !== 'function') {
    throw new Error('registerAutomationCycleRoute requires an Express app');
  }
  if (typeof addAutomationAuditEntry !== 'function') {
    throw new Error('registerAutomationCycleRoute requires addAutomationAuditEntry()');
  }
  if (!amberAPI || typeof amberAPI.callAmberAPI !== 'function' || typeof amberAPI.getCachedAmberSites !== 'function' || typeof amberAPI.getCachedAmberPricesCurrent !== 'function' || typeof amberAPI.cacheAmberSites !== 'function' || typeof amberAPI.cacheAmberPricesCurrent !== 'function') {
    throw new Error('registerAutomationCycleRoute requires amberAPI cache/call methods');
  }
  if (!(amberPricesInFlight instanceof Map)) {
    throw new Error('registerAutomationCycleRoute requires amberPricesInFlight Map');
  }
  if (typeof applyRuleAction !== 'function') {
    throw new Error('registerAutomationCycleRoute requires applyRuleAction()');
  }
  if (typeof checkAndApplyCurtailment !== 'function') {
    throw new Error('registerAutomationCycleRoute requires checkAndApplyCurtailment()');
  }
  if (typeof cleanupExpiredQuickControl !== 'function') {
    throw new Error('registerAutomationCycleRoute requires cleanupExpiredQuickControl()');
  }
  if (typeof evaluateRule !== 'function') {
    throw new Error('registerAutomationCycleRoute requires evaluateRule()');
  }
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') {
    throw new Error('registerAutomationCycleRoute requires foxessAPI');
  }
  if (typeof getAutomationTimezone !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getAutomationTimezone()');
  }
  if (typeof getCachedInverterData !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getCachedInverterData()');
  }
  if (typeof getCachedInverterRealtimeData !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getCachedInverterRealtimeData()');
  }
  if (typeof getCachedWeatherData !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getCachedWeatherData()');
  }
  if (typeof getQuickControlState !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getQuickControlState()');
  }
  if (typeof getUserAutomationState !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getUserAutomationState()');
  }
  if (typeof getUserConfig !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getUserConfig()');
  }
  if (typeof getUserRules !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getUserRules()');
  }
  if (typeof getUserTime !== 'function') {
    throw new Error('registerAutomationCycleRoute requires getUserTime()');
  }
  if (typeof isForecastTemperatureType !== 'function') {
    throw new Error('registerAutomationCycleRoute requires isForecastTemperatureType()');
  }
  if (typeof saveUserAutomationState !== 'function') {
    throw new Error('registerAutomationCycleRoute requires saveUserAutomationState()');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('registerAutomationCycleRoute requires serverTimestamp()');
  }
  if (typeof setUserRule !== 'function') {
    throw new Error('registerAutomationCycleRoute requires setUserRule()');
  }

  // ── Provider-aware segment clearing ─────────────────────────────────────────
  // For non-FoxESS providers, delegates to the adapter's clearSchedule().
  // For FoxESS, uses the existing clearSchedulerSegmentsOneShot/WithRetry helpers.
  async function clearSegmentsForUser(userConfig, userId, opts = {}) {
    const { provider, deviceId } = resolveProviderDeviceId(userConfig);
    if (provider !== 'foxess' && adapterRegistry) {
      const adapter = adapterRegistry.getDeviceProvider(provider);
      if (adapter && typeof adapter.clearSchedule === 'function') {
        const result = await adapter.clearSchedule({ deviceSN: deviceId, userConfig, userId });
        return { success: result.errno === 0, clearResult: result };
      }
    }
    const deviceSN = deviceId;
    if (!deviceSN) return { success: false, clearResult: { errno: -1, error: 'No deviceSN configured' } };
    return clearSchedulerSegmentsOneShot({ deviceSN, foxessAPI, userConfig, userId, ...opts });
  }

  async function clearSegmentsForUserWithRetry(userConfig, userId) {
    const { provider, deviceId } = resolveProviderDeviceId(userConfig);
    if (provider !== 'foxess' && adapterRegistry) {
      const adapter = adapterRegistry.getDeviceProvider(provider);
      if (adapter && typeof adapter.clearSchedule === 'function') {
        const result = await adapter.clearSchedule({ deviceSN: deviceId, userConfig, userId });
        return { success: result.errno === 0, clearResult: result };
      }
    }
    const deviceSN = deviceId;
    if (!deviceSN) return { success: false, clearResult: { errno: -1, error: 'No deviceSN configured' } };
    return clearSchedulerSegmentsWithRetry({
      deviceSN, foxessAPI, logger: console,
      maxAttempts: 3, retryDelayMs: 1200, settleDelayMs: 2500,
      userConfig, userId
    });
  }

  // Run automation cycle - evaluates all rules and triggers if conditions met
  // This is called by the frontend timer every 60 seconds
  const automationCycleHandler = async (req, res) => {
  let telemetryStatePatch = null;
  try {
    const userId = req.user.uid;
    const emitNotificationSafe = async (payload) => {
      if (!emitAutomationNotification) return null;
      try {
        return await emitAutomationNotification(userId, payload);
      } catch (notifyError) {
        warnLog(`[Cycle] Notification emit failed: ${notifyError?.message || notifyError}`);
        return null;
      }
    };
    const schedulerContext = req.schedulerContext && req.schedulerContext.userId === userId
      ? req.schedulerContext
      : null;
    let resolvedState = schedulerContext && schedulerContext.state !== undefined
      ? schedulerContext.state
      : undefined;
    let resolvedUserConfig = schedulerContext && schedulerContext.userConfig !== undefined
      ? schedulerContext.userConfig
      : undefined;
    let resolvedRules = schedulerContext && schedulerContext.rules !== undefined
      ? schedulerContext.rules
      : undefined;
    const loadAutomationState = async () => {
      if (resolvedState === undefined) {
        resolvedState = await getUserAutomationState(userId);
      }
      return resolvedState;
    };
    const loadUserConfig = async () => {
      if (resolvedUserConfig === undefined) {
        resolvedUserConfig = await getUserConfig(userId);
      }
      return resolvedUserConfig;
    };
    const loadUserRules = async () => {
      if (resolvedRules === undefined) {
        resolvedRules = await getUserRules(userId, { enabledOnly: true });
      }
      return resolvedRules;
    };
    const cycleStartTime = Date.now();
    const phaseTimingsMs = {
      dataFetchMs: 0,
      ruleEvalMs: 0,
      actionApplyMs: 0,
      curtailmentMs: 0
    };
    const clampPhaseDuration = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    };
    const addPhaseDuration = (phaseKey, startMs) => {
      if (!phaseKey || !Number.isFinite(Number(startMs))) return;
      const elapsed = Date.now() - Number(startMs);
      if (!Number.isFinite(elapsed) || elapsed <= 0) return;
      phaseTimingsMs[phaseKey] = (phaseTimingsMs[phaseKey] || 0) + elapsed;
    };
    const withActionTiming = async (task) => {
      const actionStartMs = Date.now();
      try {
        return await task();
      } finally {
        addPhaseDuration('actionApplyMs', actionStartMs);
      }
    };
    const buildPerformance = () => ({
      cycleDurationMs: Math.max(0, Date.now() - cycleStartTime),
      phaseTimingsMs: {
        dataFetchMs: clampPhaseDuration(phaseTimingsMs.dataFetchMs),
        ruleEvalMs: clampPhaseDuration(phaseTimingsMs.ruleEvalMs),
        actionApplyMs: clampPhaseDuration(phaseTimingsMs.actionApplyMs),
        curtailmentMs: clampPhaseDuration(phaseTimingsMs.curtailmentMs)
      }
    });
    const respondSuccess = (resultPayload = {}) => (
      res.json({
        errno: 0,
        result: {
          ...resultPayload,
          ...buildPerformance()
        }
      })
    );
    const runCurtailmentCheck = async (userConfig, amberData) => {
      let curtailmentResult = null;
      const curtailmentStartMs = Date.now();
      try {
        logger.debug(
          'Cycle',
          `[Curtailment] Starting check: amberItems=${Array.isArray(amberData) ? amberData.length : 0}, enabled=${userConfig?.curtailment?.enabled === true}`
        );
        curtailmentResult = await checkAndApplyCurtailment(userId, userConfig, amberData);
        logger.debug(
          'Cycle',
          `[Curtailment] Result: enabled=${curtailmentResult?.enabled === true}, adjusted=${curtailmentResult?.adjusted === true}, error=${curtailmentResult?.error ? 'yes' : 'no'}`
        );
        if (curtailmentResult.error) {
          warnLog(`[Cycle] Curtailment check failed: ${curtailmentResult.error}`);
        }
      } catch (curtErr) {
        errorLog(`[Cycle] Curtailment exception: ${curtErr?.stack || curtErr?.message || curtErr}`);
        curtailmentResult = {
          error: curtErr.message,
          enabled: userConfig?.curtailment?.enabled || false
        };
      } finally {
        addPhaseDuration('curtailmentMs', curtailmentStartMs);
      }
      if (curtailmentResult && curtailmentResult.stateChanged === true) {
        const action = String(curtailmentResult.action || '').toLowerCase();
        const priceText = Number.isFinite(Number(curtailmentResult.currentPrice))
          ? `${Number(curtailmentResult.currentPrice).toFixed(2)} c/kWh`
          : 'unknown price';
        const thresholdText = Number.isFinite(Number(curtailmentResult.priceThreshold))
          ? `${Number(curtailmentResult.priceThreshold).toFixed(2)} c/kWh`
          : 'configured threshold';
        const wasActivated = action === 'activated';
        await emitNotificationSafe({
          eventType: wasActivated ? 'curtailment_activated' : 'curtailment_deactivated',
          stateSignature: wasActivated ? 'active' : 'inactive',
          preferenceScope: 'curtailment',
          source: 'automation',
          title: wasActivated ? 'Curtailment activated' : 'Curtailment deactivated',
          body: wasActivated
            ? `Feed-in price ${priceText} is below threshold ${thresholdText}. Export limit was reduced.`
            : `Feed-in price ${priceText} recovered or curtailment was disabled. Export limit was restored.`,
          severity: wasActivated ? 'warning' : 'info',
          deepLink: '/settings.html#curtailmentSection',
          cooldownMs: 10 * 60 * 1000
        });
      }
      return curtailmentResult;
    };
    const normalizeActionErrno = (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) return 500;
      if (parsed >= 400 && parsed <= 599) return parsed;
      return 500;
    };
    const createActionFailureError = (ruleName, actionResult, stage) => {
      const actionErrno = Number.isFinite(Number(actionResult?.errno))
        ? Number(actionResult.errno)
        : 500;
      const cycleErrno = normalizeActionErrno(actionErrno);
      const actionMsg = String(actionResult?.msg || actionResult?.error || 'Action apply failed');
      const error = new Error(
        `[Automation] Action apply failed (${stage}) for rule '${ruleName}': errno=${actionErrno}, msg=${actionMsg}`
      );
      error.cycleErrno = cycleErrno;
      error.actionErrno = actionErrno;
      return error;
    };
    
    // Get user's automation state
    const state = await loadAutomationState();
    // Check explicitly for enabled === false (not undefined which means not set yet)
    if (state && state.enabled === false) {
      const disabledNowMs = Date.now();
      
      // Always update lastCheck timestamp to prevent scheduler from calling cycle repeatedly
      await saveUserAutomationState(
        userId,
        {
          ...buildClearedActiveRuleState({
            lastCheckMs: disabledNowMs
          }),
          ...buildTelemetryResetStatePatch(disabledNowMs)
        }
      );
      
      // Only clear segments if they haven't been cleared already for this disabled state
      // Track with a flag in the state to avoid redundant API calls on every cycle
      if (state.segmentsCleared !== true) {
        try {
          const userConfig = await loadUserConfig();
          const { deviceId } = resolveProviderDeviceId(userConfig);
          if (deviceId) {
            const clearOutcome = await withActionTiming(
              () => clearSegmentsForUser(userConfig, userId)
            );
            if (clearOutcome.success === true) {
              // Mark segments as cleared so we don't do this again every cycle
              await saveUserAutomationState(userId, { segmentsCleared: true });
            } else {
              const clearResult = clearOutcome.clearResult;
              warnLog(`[Automation] Segment clear returned errno=${clearResult?.errno}`);
            }
          } else {
            warnLog('[Automation] No device identifier found - cannot clear segments');
          }
        } catch (err) {
          errorLog(`[Automation] Error clearing segments on disable: ${err.message}`);
        }
      }

      // Clear lastTriggered on the active rule if one exists (so it can re-trigger when automation re-enabled)
      if (state.activeRule) {
        try {
          await setUserRule(userId, state.activeRule, {
            lastTriggered: null
          }, { merge: true });
          
          // Create audit entry showing the active rule was deactivated due to automation being disabled
          // This ensures the ROI calculator shows the rule as "ended" not "ongoing"
          try {
            const activationTime = state.lastTriggered || Date.now();
            const deactivationTime = Date.now();
            const durationMs = deactivationTime - activationTime;
            
            await addAutomationAuditEntry(userId, {
              cycleId: `cycle_automation_disabled_${Date.now()}`,
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
              activeRuleAfter: null,
              rulesEvaluated: 0,
              cycleDurationMs: durationMs,
              automationDisabled: true  // Flag indicating this was due to automation being disabled
            });
          } catch (auditErr) {
            warnLog(`[Automation] Failed to create audit entry: ${auditErr.message}`);
          }
        } catch (err) {
          warnLog(`[Automation] Error clearing rule lastTriggered: ${err.message}`);
        }
      }
      
      return respondSuccess({ skipped: true, reason: 'Automation disabled', segmentsCleared: state.segmentsCleared === true });
    }
    
    // ============================================================
    // Check for active quick control (mutual exclusion)
    // ============================================================
    const quickState = await getQuickControlState(userId);
    if (quickState && quickState.active) {
      const now = Date.now();
      
      // If quick control has expired, clean it up and continue with normal automation
      if (quickState.expiresAt <= now) {
        await cleanupExpiredQuickControl(userId, quickState);
        // Continue with normal automation
      } else {
        // Quick control still active - skip automation cycle
        const remainingMs = quickState.expiresAt - now;
        const remainingMinutes = Math.ceil(remainingMs / 60000);
        
        logger.debug('Automation', `Cycle skipped: Quick control active (type=${quickState.type}, ${remainingMinutes}min remaining)`);
        
        // Update lastCheck to prevent scheduler from calling cycle repeatedly
        const quickControlNowMs = Date.now();
        await saveUserAutomationState(userId, {
          lastCheck: quickControlNowMs,
          ...buildTelemetryResetStatePatch(quickControlNowMs)
        });
        
        return respondSuccess({
          skipped: true,
          reason: 'Quick control active',
          quickControl: {
            type: quickState.type,
            power: quickState.power,
            remainingMinutes: remainingMinutes
          }
        });
      }
    }
    
    // Check for blackout windows
    const userConfig = await loadUserConfig();
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    
    // Get user's timezone (from config which is kept up-to-date)
    const userTimezone = getAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const currentMinutes = userTime.hour * 60 + userTime.minute;
    
    
    const { inBlackout, currentBlackoutWindow } = evaluateBlackoutWindow(
      blackoutWindows,
      currentMinutes
    );
    
    if (inBlackout) {
      const blackoutNowMs = Date.now();
      await saveUserAutomationState(userId, {
        lastCheck: blackoutNowMs,
        inBlackout: true,
        currentBlackoutWindow,
        ...buildTelemetryResetStatePatch(blackoutNowMs)
      });
      return respondSuccess({ skipped: true, reason: 'In blackout window', blackoutWindow: currentBlackoutWindow });
    }
    
    // Get user's rules
    const rules = await loadUserRules();
    const totalRules = Object.keys(rules).length;
    
    if (totalRules === 0) {
      const noRulesNowMs = Date.now();
      await saveUserAutomationState(userId, {
        lastCheck: noRulesNowMs,
        inBlackout: false,
        ...buildTelemetryResetStatePatch(noRulesNowMs)
      });
      return respondSuccess({ skipped: true, reason: 'No rules configured' });
    }
    
    // Check if a rule was just disabled and we need to clear segments (via flag)
    if (state.clearSegmentsOnNextCycle) {
      try {
        const clearOutcome = await withActionTiming(
          () => clearSegmentsForUser(userConfig, userId)
        );
        const clearResult = clearOutcome.clearResult;
        if (clearResult?.errno !== 0) {
          warnLog(`[Cycle] Failed to clear segments due to rule disable flag: errno=${clearResult?.errno}`);
        }
      } catch (err) {
        errorLog(`[Cycle] Error clearing segments: ${err.message}`);
      }
      
      // Clear the flag after processing
      const clearFlagNowMs = Date.now();
      await saveUserAutomationState(userId, {
        clearSegmentsOnNextCycle: false,
        ...buildTelemetryResetStatePatch(clearFlagNowMs)
      });
      
      return respondSuccess({ skipped: true, reason: 'Rule was disabled - segments cleared', segmentsCleared: true });
    }
    
    // Check if the active rule was disabled (CRITICAL: Must check BEFORE filtering)
    // If activeRule exists but is now disabled, we need to clear segments
    if (state.activeRule && rules[state.activeRule] && !rules[state.activeRule].enabled) {
      try {
        const clearOutcome = await withActionTiming(
          () => clearSegmentsForUser(userConfig, userId)
        );
        const clearResult = clearOutcome.clearResult;
        if (clearResult?.errno !== 0) {
          warnLog(`[Automation] Failed to clear segments: errno=${clearResult?.errno}`);
        }
      } catch (err) {
        errorLog(`[Automation] Error clearing segments after rule disable: ${err.message}`);
      }
      
      // Clear automation state (but DON'T update lastCheck - let scheduler timer continue)
      const activeRuleDisabledNowMs = Date.now();
      await saveUserAutomationState(
        userId,
        {
          ...buildClearedActiveRuleState({
            includeLastCheck: false
          }),
          ...buildTelemetryResetStatePatch(activeRuleDisabledNowMs)
        }
      );
      return respondSuccess({ skipped: true, reason: 'Active rule was disabled', segmentsCleared: true });
    }
    
    // Get live data for evaluation
    const resolvedDevice = resolveProviderDeviceId(userConfig);
    const deviceSN = resolvedDevice.deviceId;
    const provider = resolvedDevice.provider;
    const deviceAdapter = provider !== 'foxess' && adapterRegistry
      ? adapterRegistry.getDeviceProvider(provider)
      : null;
    // Evaluate which rules are enabled before fetching data so we can early-exit and
    // determine whether weather data is needed before launching fetches.
    const enabledRules = Object.entries(rules).filter(([_, rule]) => rule.enabled);

    if (enabledRules.length === 0) {
      const noEnabledRulesNowMs = Date.now();
      await saveUserAutomationState(userId, {
        lastCheck: noEnabledRulesNowMs,
        inBlackout: false,
        ...buildTelemetryResetStatePatch(noEnabledRulesNowMs)
      });
      return respondSuccess({ skipped: true, reason: 'No rules enabled', totalRules });
    }

    const configuredForecastDays = Number.parseInt(userConfig?.preferences?.forecastDays, 10);
    const weatherFetchPlan = buildWeatherFetchPlan({
      automationForecastDays:
        Number.isInteger(configuredForecastDays) && configuredForecastDays > 0
          ? Math.min(configuredForecastDays, 16)
          : undefined,
      enabledRules,
      isForecastTemperatureType
    });

    // Run independent external data fetches in parallel to minimise cycle latency.
    // Sequential worst-case (FoxESS 10s + Amber sites 10s + Amber prices 10s) can reach ~30s;
    // parallel execution bounds it to the slowest single dependency.
    const weatherFetchPromise = weatherFetchPlan.needsWeatherData
      ? getCachedWeatherData(userId, userConfig?.location || 'Sydney', weatherFetchPlan.daysToFetch)
      : Promise.resolve(null);

    const dataFetchStartMs = Date.now();
    const pricingProvider = String(userConfig?.pricingProvider || 'amber').toLowerCase().trim();
    const tariffAdapter = adapterRegistry && typeof adapterRegistry.getTariffProvider === 'function'
      ? adapterRegistry.getTariffProvider(pricingProvider)
      : null;
    let inverterData;
    let amberData;
    let weatherDataRaw;
    let telemetryHealth = null;
    let telemetry = null;
    try {
      const [inverterResult, amberResult, weatherResult] = await Promise.allSettled([
        fetchAutomationInverterData({
          deviceAdapter,
          provider,
          deviceSN,
          getCachedInverterData,
          getCachedInverterRealtimeData,
          logger: console,
          userConfig,
          userId
        }),
        fetchAutomationAmberData({
          amberAPI,
          amberPricesInFlight,
          logger: console,
          pricingProvider,
          tariffAdapter,
          userConfig,
          userId
        }),
        weatherFetchPromise
      ]);

      if (inverterResult.status === 'rejected') {
        const inverterError = inverterResult.reason instanceof Error
          ? inverterResult.reason
          : new Error(String(inverterResult.reason || 'Failed to fetch inverter data'));
        inverterError.cycleErrno = 503;
        throw inverterError;
      }

      inverterData = inverterResult.value;
      const inverterErrno = Number(inverterData?.errno);
      if (!inverterData || (Number.isFinite(inverterErrno) && inverterErrno !== 0)) {
        const message = inverterData?.error || 'Failed to fetch inverter data';
        const inverterError = new Error(message);
        inverterError.cycleErrno = Number.isInteger(inverterErrno) && inverterErrno >= 400 ? inverterErrno : 503;
        throw inverterError;
      }

      if (amberResult.status === 'fulfilled') {
        amberData = amberResult.value;
      } else {
        warnLog(`[Automation] Amber fetch degraded: ${amberResult.reason?.message || amberResult.reason}`);
        amberData = null;
      }

      if (weatherResult.status === 'fulfilled') {
        weatherDataRaw = weatherResult.value;
      } else {
        warnLog(`[Automation] Weather fetch degraded: ${weatherResult.reason?.message || weatherResult.reason}`);
        weatherDataRaw = null;
      }
    } finally {
      addPhaseDuration('dataFetchMs', dataFetchStartMs);
    }

    const telemetryCheckNowMs = Date.now();
    telemetryHealth = evaluateTelemetryHealth({
      inverterData,
      previousState: state,
      nowMs: telemetryCheckNowMs,
      freshnessMaxAgeMs: DEFAULT_FRESHNESS_MAX_AGE_MS,
      frozenMaxAgeMs: DEFAULT_FROZEN_MAX_AGE_MS
    });
    telemetry = buildTelemetryCyclePayload(telemetryHealth);
    telemetryStatePatch = telemetryHealth && telemetryHealth.statePatch && typeof telemetryHealth.statePatch === 'object'
      ? telemetryHealth.statePatch
      : {};
    const saveStateWithTelemetry = async (patch = {}) => {
      const safePatch = patch && typeof patch === 'object' ? patch : {};
      return saveUserAutomationState(userId, {
        ...telemetryStatePatch,
        ...safePatch
      });
    };

    if (telemetryHealth.shouldPauseAutomation) {
      const telemetryPauseTransition = state?.telemetryFailsafePaused !== true;
      await saveStateWithTelemetry({
        inBlackout: false,
        lastCheck: telemetryCheckNowMs
      });
      if (telemetryPauseTransition) {
        await emitNotificationSafe({
          eventType: 'telemetry_pause',
          stateSignature: String(telemetryHealth.pauseReason || telemetryHealth.telemetryStatus || 'unknown'),
          preferenceScope: 'highSignalAutomation',
          source: 'automation',
          title: 'Automation paused due to telemetry health',
          body: String(telemetryHealth.pauseReason || 'Telemetry is stale or frozen and automation is paused until fresh data arrives.'),
          severity: 'warning',
          deepLink: '/control.html',
          cooldownMs: 30 * 60 * 1000
        });
      }
      const curtailmentResult = await runCurtailmentCheck(userConfig, amberData);

      return respondSuccess({
        skipped: true,
        reason: telemetryHealth.pauseReason,
        telemetry,
        curtailment: curtailmentResult
      });
    }

    // Build cache object for rule evaluation
    const cache = {
      amber: amberData,
      inverterData,
      weather: weatherDataRaw ? (weatherDataRaw.result || weatherDataRaw) : null
    };
    
    const sortedRules = enabledRules.sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
    
    let triggeredRule = null;
    const evaluationResults = [];
    
    for (const [ruleId, rule] of sortedRules) {
      
      // BUG FIX: Check if this is the ACTIVE rule
      // Active rules should always be re-evaluated to verify conditions still hold, even if in cooldown
      // Be resilient to older state docs that may not have activeRule but have the name persisted
      const isActiveRule = state.activeRule === ruleId || state.activeRuleName === rule.name;
      
      const nowMs = Date.now();
      const cooldownState = evaluateRuleCooldown({
        cooldownMinutes: rule.cooldownMinutes,
        isActiveRule,
        lastTriggered: rule.lastTriggered,
        nowMs
      });
      if (cooldownState.shouldSkipForCooldown) {
        evaluationResults.push(
          buildCooldownEvaluationResult(rule.name, cooldownState.cooldownRemainingSeconds)
        );
        continue;
      }
      
      // Always evaluate active rules even if in cooldown, to detect when conditions no longer hold
      // For inactive rules, this is a normal condition check
      const ruleEvalStartMs = Date.now();
      let result;
      try {
        result = await evaluateRule(
          userId,
          ruleId,
          rule,
          cache,
          inverterData,
          userConfig,
          isActiveRule /* skipCooldownCheck */
        );
      } finally {
        addPhaseDuration('ruleEvalMs', ruleEvalStartMs);
      }
      
      if (result.triggered) {
        logger.debug('Automation', `🎯 Rule '${rule.name}' (${ruleId}) conditions MET - triggered=${result.triggered}`);
        if (isActiveRule) {
          logger.debug('Automation', `🔄 Rule '${rule.name}' is ACTIVE (continuing) - checking segment status...`);
          // Active rule continues - conditions still hold
          const activeForSec = cooldownState.activeForSeconds;
          const cooldownRemaining = cooldownState.cooldownRemainingSeconds;
          logger.debug('Automation', `⏱️ Active for ${activeForSec}s, cooldown remaining: ${cooldownRemaining}s`);
          logger.debug('Automation', `📊 Current segment status: activeSegmentEnabled=${state.activeSegmentEnabled}`);
          
          // CRITICAL: If segment failed to send but rule is active, attempt to re-send the segment
          if (state.activeSegmentEnabled === false && state.activeRule === ruleId) {
            logger.debug('Automation', `� ️ Segment previously failed for active rule '${rule.name}' - attempting RETRY...`);
            logger.debug('Automation', `🔧 Retry attempt for userId=${userId}, ruleId=${ruleId}`);
            let retryResult = null;
            try {
              retryResult = await withActionTiming(
                () => applyRuleAction(userId, rule, userConfig)
              );
              logger.debug('Automation', `📤 Retry result: errno=${retryResult?.errno}, msg=${retryResult?.msg}`);
            } catch (retryErr) {
              errorLog(`[Automation] Retry exception: ${retryErr?.stack || retryErr?.message || retryErr}`);
              retryResult = { errno: -1, msg: retryErr.message || 'Retry failed' };
            }
            
            // Update state with retry result
            logger.debug('Automation', `💾 Updating state after retry: activeSegmentEnabled=${retryResult?.errno === 0}`);
            await saveStateWithTelemetry({
              lastCheck: Date.now(),
              activeSegmentEnabled: retryResult?.errno === 0,
              lastActionResult: retryResult,
              inBlackout: false
            });
            
            if (retryResult?.errno === 0) {
              logger.debug('Automation', `✅ Segment re-send SUCCESSFUL - segment should now be on device`);
            } else {
              errorLog(`[Automation] Segment re-send failed: ${retryResult?.msg || 'unknown error'}`);
              throw createActionFailureError(rule.name, retryResult, 'active_rule_retry');
            }
            break;
          }
          
          // Check if cooldown has EXPIRED - if so, reset and re-trigger in SAME cycle
          if (cooldownState.isCooldownExpired) {
            
            try {
              // Reset lastTriggered to allow immediate re-trigger
              await setUserRule(userId, ruleId, {
                lastTriggered: null
              }, { merge: true });
              
              // Clear active rule state so the rule can re-trigger as NEW in this same cycle
              await saveStateWithTelemetry(
                buildClearedActiveRuleState({
                  inBlackout: false,
                  lastCheckMs: Date.now()
                })
              );
              
            } catch (err) {
              errorLog(`[Automation] Error resetting rule after cooldown expiry: ${err.message}`);
            }
            
            // Mark as triggered - this is a re-trigger after cooldown expiry
            // Since we cleared activeRule state, it will be treated as a new rule and re-trigger with updated times
            evaluationResults.push({ 
              rule: rule.name, 
              result: 'triggered', 
              activeFor: activeForSec,
              details: result 
            });
            
            // Fall through to NEW trigger logic below (isActiveRule is still true in variable but state is cleared)
            // We need to manually apply the action since we're not going through the normal path
            
            // Apply the rule action with NEW timestamps
            const isNewTrigger = true; // Treat as new trigger
            triggeredRule = buildTriggeredRuleSummary({ isNewTrigger, rule, ruleId });
            
            const { actionResult } = await withActionTiming(
              () => applyTriggeredRuleAction({
                applyRuleAction,
                errorLogLabel: '[Automation] Action failed:',
                logger: console,
                rule,
                userConfig,
                userId,
                warnOnPartialRetryFailure: true
              })
            );

            await persistTriggeredRuleState({
              actionResult,
              lastCheckMs: Date.now(),
              lastTriggeredMs: Date.now(),
              ruleId,
              ruleName: rule.name,
              saveUserAutomationState: async (_targetUserId, statePatch) => saveStateWithTelemetry(statePatch),
              serverTimestamp,
              setUserRule,
              userId
            });
            
            if (actionResult?.errno !== 0) {
              throw createActionFailureError(rule.name, actionResult, 'active_rule_cooldown_retrigger');
            }
            triggeredRule.actionResult = actionResult;
            break; // Rule applied, exit loop
          } else {
            // Cooldown still active - rule continues
            
            // Mark as 'continuing' in evaluation results with cooldown info
            evaluationResults.push(
              buildContinuingEvaluationResult({
                cooldownRemainingSeconds: cooldownRemaining,
                details: result,
                activeForSeconds: activeForSec,
                ruleName: rule.name
              })
            );
            
            logger.debug('Automation', `✅ Rule '${rule.name}' continuing (cooldown ${cooldownRemaining}s remaining) - segment already sent`);
            logger.debug('Automation', `📊 Preserving segment state: activeSegmentEnabled=${state.activeSegmentEnabled}`);
            // Mark this as the triggered rule for response (continuing state)
            triggeredRule = buildTriggeredRuleSummary({
              isNewTrigger: false,
              rule,
              ruleId
            });
            
            // Update check timestamp only, don't re-apply segment
            // CRITICAL: Preserve activeSegmentEnabled from previous state - if the segment failed to send,
            // don't falsely claim it's enabled on subsequent cycles
            await saveStateWithTelemetry({
              lastCheck: Date.now(),
              inBlackout: false
              // DO NOT UPDATE activeSegmentEnabled - preserve prior state
            });
            logger.debug('Automation', `💾 State updated - rule continues without re-sending segment`);
            
            break; // Rule still active, exit loop
          }
        } else {
          logger.debug('Automation', `🆕 NEW rule triggered: '${rule.name}' (${ruleId})`);
          logger.debug('Automation', `📊 Current active rule: ${state.activeRule || 'none'}`);
          // Mark as 'triggered' for new rules
          evaluationResults.push({ rule: rule.name, result: 'triggered', details: result });
          // New rule triggered - check priority vs active rule
          if (state.activeRule && rules[state.activeRule]) {
            const activeRulePriority = rules[state.activeRule].priority || 99;
            const newRulePriority = rule.priority || 99;
            if (newRulePriority > activeRulePriority) {
              // New rule is LOWER priority than active rule - don't trigger
              continue;
            } else if (newRulePriority < activeRulePriority) {
              // New rule has HIGHER priority (lower number) - cancel active rule first
              try {
                await withActionTiming(
                  () => clearSegmentsForUser(userConfig, userId, { settleDelayMs: 2500 })
                );
              } catch (err) {
                errorLog(`[Automation] Error clearing active rule segment: ${err.message}`);
              }
              // Reset active rule's lastTriggered so it can be re-triggered later
              if (state.activeRule) {
                await setUserRule(userId, state.activeRule, { lastTriggered: null }, { merge: true });
              }
            }
          }
          // New rule triggered with higher priority or no active rule exists
        }
        // Mark whether this is a new trigger or a continuing active rule
        const isNewTrigger = !isActiveRule;
        triggeredRule = buildTriggeredRuleSummary({ isNewTrigger, rule, ruleId });
        
        // Only apply the rule action if this is a NEW rule (not the active one continuing)
        if (!isActiveRule) {
          logger.debug('Automation', `🚀 Applying NEW rule action for '${rule.name}'...`);
          logger.debug('Automation', `🎬 Calling applyRuleAction(userId=${userId}, rule=${rule.name})`);
          // Actually apply the rule action (create scheduler segment)
          const { actionResult, applyDurationMs } = await withActionTiming(
            () => applyTriggeredRuleAction({
              applyRuleAction,
              errorLogLabel: '[Automation] Action exception:',
              logger: console,
              rule,
              userConfig,
              userId
            })
          );
          logger.debug(
            'Automation',
            `applyRuleAction completed in ${applyDurationMs}ms: errno=${actionResult?.errno}, segment=${actionResult?.segment ? 'present' : 'missing'}`
          );
          
          await persistTriggeredRuleState({
            actionResult,
            lastCheckMs: Date.now(),
            lastTriggeredMs: Date.now(),
            ruleId,
            ruleName: rule.name,
            saveUserAutomationState: async (_targetUserId, statePatch) => saveStateWithTelemetry(statePatch),
            serverTimestamp,
            setUserRule,
            userId
          });
          logger.debug('Automation', `✅ State saved successfully - activeRule is now '${rule.name}'`);
          logger.debug('Automation', `🔍 Final segment status: ${actionResult?.errno === 0 ? 'ENABLED ✅' : 'FAILED ❌'}`);
          if (actionResult?.errno !== 0) {
            errorLog(`[Automation] Segment send failed: errno=${actionResult?.errno}, msg=${actionResult?.msg}`);
            throw createActionFailureError(rule.name, actionResult, 'new_trigger');
          }
          
          // Log to audit trail - Rule turned ON
          // Include full evaluation context: ALL rules and their condition states
          const allRulesForAudit = buildAllRuleEvaluationsForAudit(evaluationResults, sortedRules);

          const { roiSnapshot } = buildRoiSnapshot({
            action: rule.action,
            inverterData,
            logger: console,
            result
          });
          
          await addAutomationAuditEntry(userId, {
            cycleId: `cycle_${cycleStartTime}`,
            triggered: true,
            ruleName: rule.name,
            ruleId: ruleId,
            evaluationResults: result.conditions || [],
            allRuleEvaluations: allRulesForAudit, // Complete evaluation context in frontend format
            actionTaken: {
              workMode: rule.action?.workMode,
              durationMinutes: rule.action?.durationMinutes,
              fdPwr: rule.action?.fdPwr,
              fdSoc: rule.action?.fdSoc,
              minSocOnGrid: rule.action?.minSocOnGrid
            },
            // ⭐ Store ROI data with house load snapshot (null if not found)
            roiSnapshot,
            activeRuleBefore: state.activeRule,
            activeRuleAfter: ruleId,
            rulesEvaluated: sortedRules.length,
            inverterCacheHit: cache?.inverterData?.__cacheHit || false,
            inverterCacheAgeMs: cache?.inverterData?.__cacheAgeMs || null,
            telemetryTimestampMs: telemetry?.timestampMs || null,
            telemetryAgeMs: telemetry?.ageMs || null,
            telemetryStatus: telemetry?.status || null,
            telemetryPauseReason: telemetry?.pauseReason || null,
            cycleDurationMs: Date.now() - cycleStartTime
          });
          
          // Store action result for response
          triggeredRule.actionResult = actionResult;
        } else {
          // Active rule is continuing - just update check timestamp, no re-apply needed
          await saveStateWithTelemetry({
            lastCheck: Date.now(),
            inBlackout: false,
            activeSegmentEnabled: true,
            activeRule: state.activeRule,
            activeRuleName: state.activeRuleName
          });
        }
        
        break; // First matching rule wins
      } else {
        // Conditions not met - add to evaluation results
        evaluationResults.push({ rule: rule.name, result: 'not_met', details: result });
        
        // Active rule's conditions NO LONGER hold during evaluation
        if (isActiveRule) {
          let segmentClearSuccess = false;
          try {
            // Clear all scheduler segments
            {
              // Retry logic for segment clearing (up to 3 attempts)
              const clearOutcome = await withActionTiming(
                () => clearSegmentsForUserWithRetry(userConfig, userId)
              );
              segmentClearSuccess = clearOutcome.success === true;

              if (!segmentClearSuccess) {
                errorLog('[Automation] Failed to clear segments after 3 attempts; aborting replacement rule evaluation for safety');
                // Break out of rule loop if we can't clear - too risky to apply new segment
                break;
              }
            }
            // Clear lastTriggered when rule is canceled (conditions failed)
            // This allows the rule to re-trigger immediately if conditions become valid again
            // Cooldown only applies to CONTINUING active rules, not canceled ones
            await setUserRule(userId, ruleId, {
              lastTriggered: null
            }, { merge: true });
          } catch (cancelError) {
            errorLog(`[Automation] Unexpected error during cancellation: ${cancelError.message}`);
            // Break on unexpected errors - don't risk applying a replacement
            break;
          }
          
          // Only proceed if segment clear was successful
          if (segmentClearSuccess) {
            await saveStateWithTelemetry(
              buildClearedActiveRuleState({
                inBlackout: false,
                lastCheckMs: Date.now()
              })
            );
            
            // Log to audit trail - Rule turned OFF
            // Include full evaluation context showing why conditions failed
            const allRulesForAudit = buildAllRuleEvaluationsForAudit(evaluationResults, sortedRules);
            
            await addAutomationAuditEntry(userId, {
              cycleId: `cycle_${cycleStartTime}`,
              triggered: false,
              ruleName: rule.name,
              ruleId: ruleId,
              evaluationResults: result.conditions || [],
              allRuleEvaluations: allRulesForAudit, // Complete evaluation context in frontend format
              actionTaken: null,
              activeRuleBefore: state.activeRule,
              activeRuleAfter: null,
              rulesEvaluated: sortedRules.length,
              telemetryTimestampMs: telemetry?.timestampMs || null,
              telemetryAgeMs: telemetry?.ageMs || null,
              telemetryStatus: telemetry?.status || null,
              telemetryPauseReason: telemetry?.pauseReason || null,
              cycleDurationMs: Date.now() - cycleStartTime
            });
            
            // Continue to check if any other rule can trigger
            continue;
          } else {
            // Failed to clear - don't evaluate replacement rules this cycle
            break;
          }
        }
      }
    }
    
    if (!triggeredRule) {
      
      // Just update lastCheck timestamp
      // Note: If an active rule's conditions no longer held, it was already handled in the main loop above
      await saveStateWithTelemetry({ lastCheck: Date.now(), inBlackout: false });
    }

    // ========== SOLAR CURTAILMENT CHECK ==========
    // Run AFTER automation rules to ensure sequential execution
    // Curtailment failures don't affect automation cycle
    const curtailmentResult = await runCurtailmentCheck(userConfig, amberData);
    
    return respondSuccess({
      triggered: !!triggeredRule,
      status: triggeredRule?.status || null,  // 'new_trigger', 'continuing', or null
      rule: triggeredRule ? { name: triggeredRule.name, priority: triggeredRule.priority, actionResult: triggeredRule.actionResult } : null,
      rulesEvaluated: sortedRules.length,
      totalRules,
      evaluationResults,
      lastCheck: Date.now(),
      telemetry,
      // Curtailment result (for UI feedback)
      curtailment: curtailmentResult
    });
  } catch (error) {
    errorLog(`[Automation] Cycle error: ${error?.stack || error?.message || error}`);
    
    // Still update lastCheck even on error
    try {
      const errorNowMs = Date.now();
      const safeTelemetryPatch = telemetryStatePatch && typeof telemetryStatePatch === 'object'
        ? telemetryStatePatch
        : {};
      await saveUserAutomationState(req.user.uid, {
        ...safeTelemetryPatch,
        lastCheck: errorNowMs
      });
    } catch (e) { /* ignore */ }
    const cycleErrno = Number(error?.cycleErrno);
    const statusCode = Number.isInteger(cycleErrno) && cycleErrno >= 400 && cycleErrno <= 599
      ? cycleErrno
      : 500;
    if (emitAutomationNotification && req?.user?.uid) {
      try {
        await emitAutomationNotification(req.user.uid, {
          eventType: 'cycle_failure',
          stateSignature: `${statusCode}:${String(error?.message || 'unknown').slice(0, 120)}`,
          preferenceScope: 'highSignalAutomation',
          source: 'automation',
          title: 'Automation cycle failed',
          body: `Automation cycle returned ${statusCode}. ${String(error?.message || 'Unknown failure').slice(0, 280)}`,
          severity: 'danger',
          deepLink: '/control.html',
          cooldownMs: 30 * 60 * 1000
        });
      } catch (notifyError) {
        warnLog(`[Cycle] Failed to emit cycle failure notification: ${notifyError?.message || notifyError}`);
      }
    }
    res.status(statusCode).json({ errno: statusCode, error: error.message });
  }
};

  app.post('/api/automation/cycle', automationCycleHandler);
  return automationCycleHandler;

}

module.exports = {
  registerAutomationCycleRoute
};
