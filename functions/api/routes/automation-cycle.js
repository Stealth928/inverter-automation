'use strict';

const { buildAllRuleEvaluationsForAudit } = require('../../lib/services/automation-audit-service');
const { extractHouseLoadWatts } = require('../../lib/services/automation-roi-service');
const { clearSchedulerSegments } = require('../../lib/services/scheduler-segment-service');

function registerAutomationCycleRoute(app, deps = {}) {
  const addAutomationAuditEntry = deps.addAutomationAuditEntry;
  const amberAPI = deps.amberAPI;
  const amberPricesInFlight = deps.amberPricesInFlight;
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

// Run automation cycle - evaluates all rules and triggers if conditions met
// This is called by the frontend timer every 60 seconds
app.post('/api/automation/cycle', async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // Get user's automation state
    const state = await getUserAutomationState(userId);
    // Check explicitly for enabled === false (not undefined which means not set yet)
    if (state && state.enabled === false) {
      
      // Always update lastCheck timestamp to prevent scheduler from calling cycle repeatedly
      await saveUserAutomationState(userId, { 
        lastCheck: Date.now(), 
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
      
      // Only clear segments if they haven't been cleared already for this disabled state
      // Track with a flag in the state to avoid redundant API calls on every cycle
      if (state.segmentsCleared !== true) {
        try {
          const userConfig = await getUserConfig(userId);
          const deviceSN = userConfig?.deviceSn;
          if (deviceSN) {
            // Real API call - counted in metrics for accurate quota tracking
            const clearResult = await clearSchedulerSegments({
              deviceSN,
              foxessAPI,
              userConfig,
              userId
            });
            if (clearResult?.errno === 0) {
              // Mark segments as cleared so we don't do this again every cycle
              await saveUserAutomationState(userId, { segmentsCleared: true });
            } else {
              console.warn(`[Automation] � ️ Segment clear returned errno=${clearResult?.errno}`);
            }
          } else {
            console.warn(`[Automation] � ️ No deviceSN found - cannot clear segments`);
          }
        } catch (err) {
          console.error(`[Automation] ❌ Error clearing segments on disable:`, err.message);
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
            console.warn(`[Automation] � ️ Failed to create audit entry:`, auditErr.message);
          }
        } catch (err) {
          console.warn(`[Automation] � ️ Error clearing rule lastTriggered:`, err.message);
        }
      }
      
      return res.json({ errno: 0, result: { skipped: true, reason: 'Automation disabled', segmentsCleared: state.segmentsCleared === true } });
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
        await saveUserAutomationState(userId, { lastCheck: Date.now() });
        
        return res.json({
          errno: 0,
          result: {
            skipped: true,
            reason: 'Quick control active',
            quickControl: {
              type: quickState.type,
              power: quickState.power,
              remainingMinutes: remainingMinutes
            }
          }
        });
      }
    }
    
    // Check for blackout windows
    const userConfig = await getUserConfig(userId);
    const blackoutWindows = userConfig?.automation?.blackoutWindows || [];
    
    // Get user's timezone (from config which is kept up-to-date)
    const userTimezone = getAutomationTimezone(userConfig);
    const userTime = getUserTime(userTimezone);
    const currentMinutes = userTime.hour * 60 + userTime.minute;
    
    
    let inBlackout = false;
    let currentBlackoutWindow = null;
    for (const window of blackoutWindows) {
      // Treat windows without explicit enabled property as enabled by default
      // (the user explicitly added them, so they should be active unless explicitly disabled)
      if (window.enabled === false) continue;
      const [startH, startM] = (window.start || '00:00').split(':').map(Number);
      const [endH, endM] = (window.end || '00:00').split(':').map(Number);
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      
      // Handle windows that cross midnight
      if (startMins <= endMins) {
        if (currentMinutes >= startMins && currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      } else {
        if (currentMinutes >= startMins || currentMinutes < endMins) {
          inBlackout = true;
          currentBlackoutWindow = window;
          break;
        }
      }
    }
    
    if (inBlackout) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: true, currentBlackoutWindow });
      return res.json({ errno: 0, result: { skipped: true, reason: 'In blackout window', blackoutWindow: currentBlackoutWindow } });
    }
    
    // Get user's rules
    const rules = await getUserRules(userId);
    const totalRules = Object.keys(rules).length;
    
    if (totalRules === 0) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
      return res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    }
    
    // Check if a rule was just disabled and we need to clear segments (via flag)
    if (state.clearSegmentsOnNextCycle) {
      try {
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          // Real API call - counted in metrics for accurate quota tracking
          const clearResult = await clearSchedulerSegments({
            deviceSN,
            foxessAPI,
            userConfig,
            userId
          });
          if (clearResult?.errno !== 0) {
            console.warn(`[Cycle] � ️ Failed to clear segments due to rule disable flag: errno=${clearResult?.errno}`);
          }
        }
      } catch (err) {
        console.error('[Cycle] Error clearing segments:', err.message);
      }
      
      // Clear the flag after processing
      await saveUserAutomationState(userId, {
        clearSegmentsOnNextCycle: false
      });
      
      return res.json({ errno: 0, result: { skipped: true, reason: 'Rule was disabled - segments cleared', segmentsCleared: true } });
    }
    
    // Check if the active rule was disabled (CRITICAL: Must check BEFORE filtering)
    // If activeRule exists but is now disabled, we need to clear segments
    if (state.activeRule && rules[state.activeRule] && !rules[state.activeRule].enabled) {
      try {
        const deviceSN = userConfig?.deviceSn;
        if (deviceSN) {
          // Real API call - counted in metrics for accurate quota tracking
          const clearResult = await clearSchedulerSegments({
            deviceSN,
            foxessAPI,
            userConfig,
            userId
          });
          if (clearResult?.errno !== 0) {
            console.warn(`[Automation] � ️ Failed to clear segments: errno=${clearResult?.errno}`);
          }
        }
      } catch (err) {
        console.error(`[Automation] ❌ Error clearing segments after rule disable:`, err.message);
      }
      
      // Clear automation state (but DON'T update lastCheck - let scheduler timer continue)
      await saveUserAutomationState(userId, {
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false
      });
      return res.json({ errno: 0, result: { skipped: true, reason: 'Active rule was disabled', segmentsCleared: true } });
    }
    
    // Get live data for evaluation
    const deviceSN = userConfig?.deviceSn;
    let inverterData = null;
    let amberData = null;
    const cycleStartTime = Date.now();
    
    // Fetch inverter data (with per-user cache TTL)
    if (deviceSN) {
      try {
        inverterData = await getCachedInverterData(userId, deviceSN, userConfig, false);
        // If automation cache doesn't have valid datas structure (e.g. stale failed response),
        // fall back to the realtime cache which the dashboard may have just refreshed.
        if (!inverterData?.result?.[0]?.datas) {
          console.warn('[Automation] Automation inverter cache missing datas structure (errno=%s), falling back to realtime cache', inverterData?.errno);
          try {
            const realtimeData = await getCachedInverterRealtimeData(userId, deviceSN, userConfig, false);
            if (realtimeData?.result?.[0]?.datas) {
              inverterData = realtimeData;
              console.log('[Automation] Realtime cache fallback succeeded - SoC data now available');
            }
          } catch (fe) {
            console.warn('[Automation] Realtime cache fallback also failed:', fe.message);
          }
        }
      } catch (e) {
        console.warn('[Automation] Failed to get inverter data:', e.message);
      }
    }
    
    // Fetch Amber data (with forecast for next 288 intervals = 24 hours, Amber provides up to ~48hrs)
    if (userConfig?.amberApiKey) {
      try {
        // Try cache first to avoid duplicate API call
        let sites = await amberAPI.getCachedAmberSites(userId);
        if (!sites) {
          sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
          if (Array.isArray(sites) && sites.length > 0) {
            await amberAPI.cacheAmberSites(userId, sites);
          }
        }
        
        if (Array.isArray(sites) && sites.length > 0) {
          const siteId = userConfig.amberSiteId || sites[0].id;
          
          // Try cache first for current prices
          amberData = await amberAPI.getCachedAmberPricesCurrent(siteId, userId, userConfig);
          if (!amberData) {
            const inflightKey = `${userId}:${siteId}`;
            
            // Check if another request is already fetching this data
            if (amberPricesInFlight.has(inflightKey)) {
              try {
                amberData = await amberPricesInFlight.get(inflightKey);
              } catch (err) {
                console.warn(`[Automation] In-flight request failed for ${userId}, will retry:`, err.message);
              }
            }
            
            // If still no data (first request or in-flight failed), fetch it
            if (!amberData) {
              const fetchPromise = amberAPI.callAmberAPI(`/sites/${encodeURIComponent(siteId)}/prices/current`, { next: 288 }, userConfig, userId)
                .then(async (data) => {
                  if (Array.isArray(data) && data.length > 0) {
                    await amberAPI.cacheAmberPricesCurrent(siteId, data, userId, userConfig);
                  }
                  return data;
                })
                .finally(() => {
                  amberPricesInFlight.delete(inflightKey);
                });
              
              amberPricesInFlight.set(inflightKey, fetchPromise);
              amberData = await fetchPromise;
            }
          }
          
          if (amberData) {
            const generalForecasts = amberData.filter(p => p.type === 'ForecastInterval' && p.channelType === 'general');
            const feedInForecasts = amberData.filter(p => p.type === 'ForecastInterval' && p.channelType === 'feedIn');
            if (generalForecasts.length > 0) {
              const generalPrices = generalForecasts.map(f => f.perKwh);
              console.log(`[Automation] General forecast: ${generalForecasts.length} intervals, max ${Math.max(...generalPrices).toFixed(2)}¢/kWh`);
            }
            if (feedInForecasts.length > 0) {
              const feedInPrices = feedInForecasts.map(f => -f.perKwh);
              console.log(`[Automation] Feed-in forecast: ${feedInForecasts.length} intervals, max ${Math.max(...feedInPrices).toFixed(2)}¢/kWh`);
            }
          }
        }
      } catch (e) {
        console.warn('[Automation] Failed to get Amber data:', e.message);
      }
    }
    
    // Build cache object for rule evaluation
    const cache = { amber: amberData, weather: null };
    
    // Evaluate rules (sorted by priority - lower number = higher priority)
    const enabledRules = Object.entries(rules).filter(([_, rule]) => rule.enabled);
    
    if (enabledRules.length === 0) {
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
      return res.json({ errno: 0, result: { skipped: true, reason: 'No rules enabled', totalRules } });
    }
    
    // Check if any enabled rule uses weather-dependent conditions.
    const needsWeatherData = enabledRules.some(([_, rule]) => {
      const cond = rule.conditions || {};
      const tempCond = cond.temp || cond.temperature;
      return (
        cond.solarRadiation?.enabled ||
        cond.cloudCover?.enabled ||
        cond.uvIndex?.enabled ||
        (tempCond?.enabled && isForecastTemperatureType(tempCond.type))
      );
    });
    
    // Only fetch weather if a rule actually needs it
    let weatherData = null;
    if (needsWeatherData) {
      try {
        const place = userConfig?.location || 'Sydney';
        
        // Calculate maximum lookAhead days needed across all enabled rules
        let maxDaysNeeded = 1;
        for (const [, rule] of enabledRules) {
          const cond = rule.conditions || {};
          
          // Check solar radiation lookAhead
          if (cond.solarRadiation?.enabled) {
            const unit = cond.solarRadiation.lookAheadUnit || 'hours';
            const value = cond.solarRadiation.lookAhead || 6;
            const days = unit === 'days' ? value : Math.ceil(value / 24);
            maxDaysNeeded = Math.max(maxDaysNeeded, days);
          }
          
          // Check cloud cover lookAhead
          if (cond.cloudCover?.enabled) {
            const unit = cond.cloudCover.lookAheadUnit || 'hours';
            const value = cond.cloudCover.lookAhead || 6;
            const days = unit === 'days' ? value : Math.ceil(value / 24);
            maxDaysNeeded = Math.max(maxDaysNeeded, days);
          }

          // Check forecast daily temperature offset
          const tempCond = cond.temp || cond.temperature;
          if (tempCond?.enabled && isForecastTemperatureType(tempCond.type)) {
            const dayOffset = Number.isInteger(tempCond.dayOffset)
              ? tempCond.dayOffset
              : Number.parseInt(tempCond.dayOffset, 10) || 0;
            maxDaysNeeded = Math.max(maxDaysNeeded, dayOffset + 1);
          }
        }
        
        // Support forecast temperature look-ahead up to day +10 (11 days including today)
        const automationForecastDays = 11;
        maxDaysNeeded = Math.min(maxDaysNeeded, automationForecastDays);
        
        // Always fetch a stable forecast window to maximize cache reuse across rules
        const daysToFetch = automationForecastDays;
        weatherData = await getCachedWeatherData(userId, place, daysToFetch);
        cache.weather = weatherData.result || weatherData;
      } catch (e) {
        console.warn('[Automation] Failed to get weather data:', e.message);
      }
    }
    
    const sortedRules = enabledRules.sort((a, b) => (a[1].priority || 99) - (b[1].priority || 99));
    
    let triggeredRule = null;
    const evaluationResults = [];
    
    for (const [ruleId, rule] of sortedRules) {
      
      // BUG FIX: Check if this is the ACTIVE rule
      // Active rules should always be re-evaluated to verify conditions still hold, even if in cooldown
      // Be resilient to older state docs that may not have activeRule but have the name persisted
      const isActiveRule = state.activeRule === ruleId || state.activeRuleName === rule.name;
      
      // Only apply cooldown check to INACTIVE rules (new rule searches)
      // Active rules bypass cooldown check because they need continuous condition monitoring
      const lastTriggered = rule.lastTriggered;
      const cooldownMs = (rule.cooldownMinutes || 5) * 60 * 1000;
      if (!isActiveRule && lastTriggered) {
        const lastTriggeredMs = typeof lastTriggered === 'object' 
          ? (lastTriggered._seconds || lastTriggered.seconds || 0) * 1000 
          : lastTriggered;
        if (Date.now() - lastTriggeredMs < cooldownMs) {
          const remaining = Math.round((cooldownMs - (Date.now() - lastTriggeredMs)) / 1000);
          evaluationResults.push({ rule: rule.name, result: 'cooldown', remaining });
          continue;
        }
      }
      
      // Always evaluate active rules even if in cooldown, to detect when conditions no longer hold
      // For inactive rules, this is a normal condition check
      const result = await evaluateRule(userId, ruleId, rule, cache, inverterData, userConfig, isActiveRule /* skipCooldownCheck */);
      
      if (result.triggered) {
        logger.debug('Automation', `🎯 Rule '${rule.name}' (${ruleId}) conditions MET - triggered=${result.triggered}`);
        if (isActiveRule) {
          logger.debug('Automation', `🔄 Rule '${rule.name}' is ACTIVE (continuing) - checking segment status...`);
          // Active rule continues - conditions still hold
          // Calculate how long rule has been active
          const lastTriggeredMs = typeof lastTriggered === 'object' 
            ? (lastTriggered._seconds || lastTriggered.seconds || 0) * 1000 
            : (lastTriggered || Date.now());
          const activeForSec = Math.round((Date.now() - lastTriggeredMs) / 1000);
          const cooldownRemaining = Math.max(0, Math.round((cooldownMs - (Date.now() - lastTriggeredMs)) / 1000));
          logger.debug('Automation', `⏱️ Active for ${activeForSec}s, cooldown remaining: ${cooldownRemaining}s`);
          logger.debug('Automation', `📊 Current segment status: activeSegmentEnabled=${state.activeSegmentEnabled}`);
          
          // CRITICAL: If segment failed to send but rule is active, attempt to re-send the segment
          if (state.activeSegmentEnabled === false && state.activeRule === ruleId) {
            logger.debug('Automation', `� ️ Segment previously failed for active rule '${rule.name}' - attempting RETRY...`);
            logger.debug('Automation', `🔧 Retry attempt for userId=${userId}, ruleId=${ruleId}`);
            let retryResult = null;
            try {
              retryResult = await applyRuleAction(userId, rule, userConfig);
              logger.debug('Automation', `📤 Retry result: errno=${retryResult?.errno}, msg=${retryResult?.msg}`);
            } catch (retryErr) {
              console.error(`[Automation] ❌ Retry exception:`, retryErr);
              retryResult = { errno: -1, msg: retryErr.message || 'Retry failed' };
            }
            
            // Update state with retry result
            logger.debug('Automation', `💾 Updating state after retry: activeSegmentEnabled=${retryResult?.errno === 0}`);
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              activeSegmentEnabled: retryResult?.errno === 0,
              lastActionResult: retryResult,
              inBlackout: false
            });
            
            if (retryResult?.errno === 0) {
              logger.debug('Automation', `✅ Segment re-send SUCCESSFUL - segment should now be on device`);
            } else {
              console.error(`[Automation] ❌ Segment re-send FAILED: ${retryResult?.msg || 'unknown error'}`);
            }
            break;
          }
          
          // Check if cooldown has EXPIRED - if so, reset and re-trigger in SAME cycle
          if (Date.now() - lastTriggeredMs >= cooldownMs) {
            
            try {
              // Reset lastTriggered to allow immediate re-trigger
              await setUserRule(userId, ruleId, {
                lastTriggered: null
              }, { merge: true });
              
              // Clear active rule state so the rule can re-trigger as NEW in this same cycle
              await saveUserAutomationState(userId, { 
                lastCheck: Date.now(), 
                inBlackout: false, 
                activeRule: null,
                activeRuleName: null,
                activeSegment: null,
                activeSegmentEnabled: false
              });
              
            } catch (err) {
              console.error(`[Automation] Error resetting rule after cooldown expiry:`, err.message);
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
            triggeredRule = { ruleId, ...rule, isNewTrigger, status: 'new_trigger' };
            
            let actionResult = null;
            try {
              const applyStart = Date.now();
              actionResult = await applyRuleAction(userId, rule, userConfig);
              const _applyDuration = Date.now() - applyStart;
              if (actionResult?.retrysFailed) {
                console.warn(`[Automation] � ️ Some retries failed during atomic segment update`);
              }
            } catch (actionError) {
              console.error(`[Automation] ❌ Action failed:`, actionError);
              actionResult = { errno: -1, msg: actionError.message || 'Action failed' };
            }
            
            // Update rule's lastTriggered (new trigger)
            await setUserRule(userId, ruleId, {
              lastTriggered: serverTimestamp()
            }, { merge: true });
            
            // Update automation state with NEW active rule
            await saveUserAutomationState(userId, {
              lastCheck: Date.now(),
              lastTriggered: Date.now(),
              activeRule: ruleId,
              activeRuleName: rule.name,
              activeSegment: actionResult?.segment || null,
              activeSegmentEnabled: actionResult?.errno === 0,
              inBlackout: false,
              lastActionResult: actionResult
            });
            
            triggeredRule.actionResult = actionResult;
            break; // Rule applied, exit loop
          } else {
            // Cooldown still active - rule continues
            
            // Mark as 'continuing' in evaluation results with cooldown info
            evaluationResults.push({ 
              rule: rule.name, 
              result: 'continuing', 
              activeFor: activeForSec,
              cooldownRemaining,
              details: result 
            });
            
            logger.debug('Automation', `✅ Rule '${rule.name}' continuing (cooldown ${cooldownRemaining}s remaining) - segment already sent`);
            logger.debug('Automation', `📊 Preserving segment state: activeSegmentEnabled=${state.activeSegmentEnabled}`);
            // Mark this as the triggered rule for response (continuing state)
            triggeredRule = { ruleId, ...rule, isNewTrigger: false, status: 'continuing' };
            
            // Update check timestamp only, don't re-apply segment
            // CRITICAL: Preserve activeSegmentEnabled from previous state - if the segment failed to send,
            // don't falsely claim it's enabled on subsequent cycles
            await saveUserAutomationState(userId, {
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
                const deviceSN = userConfig?.deviceSn;
                if (deviceSN) {
                  // Real API call - counted in metrics for accurate quota tracking
                  await clearSchedulerSegments({
                    deviceSN,
                    foxessAPI,
                    userConfig,
                    userId
                  });
                  await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for inverter to process
                }
              } catch (err) {
                console.error(`[Automation] ❌ Error clearing active rule segment:`, err.message);
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
        triggeredRule = { ruleId, ...rule, isNewTrigger, status: isNewTrigger ? 'new_trigger' : 'continuing' };
        
        // Only apply the rule action if this is a NEW rule (not the active one continuing)
        if (!isActiveRule) {
          logger.debug('Automation', `🚀 Applying NEW rule action for '${rule.name}'...`);
          logger.debug('Automation', `🎬 Calling applyRuleAction(userId=${userId}, rule=${rule.name})`);
          // Actually apply the rule action (create scheduler segment)
          let actionResult = null;
          try {
            const applyStart = Date.now();
            actionResult = await applyRuleAction(userId, rule, userConfig);
            const applyDuration = Date.now() - applyStart;
            logger.debug('Automation', `📤 applyRuleAction completed in ${applyDuration}ms: errno=${actionResult?.errno}`);
            console.log(`[Automation] 📋 Action result details:`, JSON.stringify({errno: actionResult?.errno, msg: actionResult?.msg, segment: actionResult?.segment ? 'present' : 'missing'}, null, 2));
          } catch (actionError) {
            console.error(`[Automation] ❌ Action exception:`, actionError);
            actionResult = { errno: -1, msg: actionError.message || 'Action failed' };
          }
          
          // Update rule's lastTriggered (new rule triggered)
          await setUserRule(userId, ruleId, {
            lastTriggered: serverTimestamp()
          }, { merge: true });
          
          logger.debug('Automation', `💾 Saving automation state for new rule...`);
          logger.debug('Automation', `📊 State to save: activeRule=${ruleId}, activeSegmentEnabled=${actionResult?.errno === 0}`);
          // Update automation state
          // IMPORTANT: Save ruleId (doc key) not rule.name so UI can match activeRule with rule keys
          await saveUserAutomationState(userId, {
            lastCheck: Date.now(),
            lastTriggered: Date.now(),
            activeRule: ruleId,
            activeRuleName: rule.name, // Keep display name for reference
            activeSegment: actionResult?.segment || null, // Store segment details for verification
            activeSegmentEnabled: actionResult?.errno === 0,
            inBlackout: false,
            lastActionResult: actionResult
          });
          logger.debug('Automation', `✅ State saved successfully - activeRule is now '${rule.name}'`);
          logger.debug('Automation', `🔍 Final segment status: ${actionResult?.errno === 0 ? 'ENABLED ✅' : 'FAILED ❌'}`);
          if (actionResult?.errno !== 0) {
            console.error(`[Automation] 🚨 SEGMENT SEND FAILED - errno=${actionResult?.errno}, msg=${actionResult?.msg}`);
          }
          
          // Log to audit trail - Rule turned ON
          // Include full evaluation context: ALL rules and their condition states
          const allRulesForAudit = buildAllRuleEvaluationsForAudit(evaluationResults, sortedRules);

          const { houseLoadW } = extractHouseLoadWatts(inverterData, console);

          const fdPwr = rule.action?.fdPwr || 0;
          const workMode = rule.action?.workMode || 'SelfUse';
          const isChargeRule = workMode === 'ForceCharge';
          const isDischargeRule = workMode === 'ForceDischarge' || workMode === 'Feedin';
          
          // BUG FIX: result from evaluateRule() has prices at TOP level, not inside 'details'
          // evaluateRule returns: { triggered, results, feedInPrice, buyPrice }
          const feedInPrice = result.feedInPrice ?? 0; // In cents/kWh from Amber API
          const buyPrice = result.buyPrice ?? 0; // In cents/kWh from Amber API
          
          // DEBUG: Validate price format
          
          const durationHours = (rule.action?.durationMinutes || 30) / 60;
          
          // Calculate profit/cost based on rule type
          let estimatedGridExportW = null;
          let estimatedRevenue = 0;
          
          if (isChargeRule) {
            // CHARGE RULE: Drawing power FROM the grid
            // - Positive buyPrice: You PAY to consume = NEGATIVE profit (cost)
            // - Negative buyPrice: You get PAID to consume = POSITIVE profit (revenue)
            // Formula: revenue = -(power * price) where price can be negative
            // Power drawn from grid = fdPwr (charge power) + house load
            const gridDrawW = houseLoadW !== null ? (fdPwr + houseLoadW) : fdPwr;
            const pricePerKwh = buyPrice / 100; // Convert cents to dollars
            
            // When buyPrice is negative (e.g., -20¢), pricePerKwh is -0.20
            // revenue = -(gridDrawW * -0.20 * hours) = positive (you earn money)
            // When buyPrice is positive (e.g., +30¢), pricePerKwh is +0.30
            // revenue = -(gridDrawW * 0.30 * hours) = negative (you pay money)
            estimatedRevenue = -(gridDrawW * pricePerKwh * durationHours);
          } else if (isDischargeRule) {
            // DISCHARGE RULE: Exporting power TO the grid
            // - Positive feedInPrice: You get PAID for export = POSITIVE profit (revenue)  
            // - Negative feedInPrice: You PAY to export = NEGATIVE profit (cost) - rare but possible
            // Power exported = fdPwr (discharge power) - house load
            estimatedGridExportW = houseLoadW !== null ? Math.max(0, fdPwr - houseLoadW) : fdPwr;
            const pricePerKwh = feedInPrice / 100; // Convert cents to dollars
            estimatedRevenue = estimatedGridExportW * pricePerKwh * durationHours;
          } else {
            // Other modes (SelfUse, Backup, etc) - no grid transaction
          }
          
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
            roiSnapshot: {
              houseLoadW: houseLoadW,
              estimatedGridExportW: estimatedGridExportW,
              feedInPrice: feedInPrice,
              buyPrice: buyPrice,
              workMode: workMode,
              durationMinutes: rule.action?.durationMinutes || 30,
              estimatedRevenue: estimatedRevenue
            },
            activeRuleBefore: state.activeRule,
            activeRuleAfter: ruleId,
            rulesEvaluated: sortedRules.length,
            inverterCacheHit: cache?.inverterData?.__cacheHit || false,
            inverterCacheAgeMs: cache?.inverterData?.__cacheAgeMs || null,
            cycleDurationMs: Date.now() - cycleStartTime
          });
          
          // Store action result for response
          triggeredRule.actionResult = actionResult;
        } else {
          // Active rule is continuing - just update check timestamp, no re-apply needed
          await saveUserAutomationState(userId, {
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
            const deviceSN = userConfig?.deviceSn;
            if (deviceSN) {
              // Retry logic for segment clearing (up to 3 attempts)
              let clearAttempt = 0;
              let clearResult = null;
              while (clearAttempt < 3 && !segmentClearSuccess) {
                clearAttempt++;
                clearResult = await clearSchedulerSegments({
                  deviceSN,
                  foxessAPI,
                  userConfig,
                  userId
                });
                
                if (clearResult?.errno === 0) {
                  segmentClearSuccess = true;
                } else {
                  console.warn(`[Automation] Segment clear attempt ${clearAttempt} failed: errno=${clearResult?.errno}, msg=${clearResult?.msg}`);
                  if (clearAttempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1200));
                  }
                }
              }
              
              if (!segmentClearSuccess) {
                console.error(`[Automation] ❌ Failed to clear segments after 3 attempts - aborting replacement rule evaluation for safety`);
                // Break out of rule loop if we can't clear - too risky to apply new segment
                break;
              }
              
              // Wait for inverter to process segment clearing before continuing evaluation
              // Extended delay to ensure hardware is ready (2.5s total wait)
              await new Promise(resolve => setTimeout(resolve, 2500));
            }
            // Clear lastTriggered when rule is canceled (conditions failed)
            // This allows the rule to re-trigger immediately if conditions become valid again
            // Cooldown only applies to CONTINUING active rules, not canceled ones
            await setUserRule(userId, ruleId, {
              lastTriggered: null
            }, { merge: true });
          } catch (cancelError) {
            console.error(`[Automation] Unexpected error during cancellation:`, cancelError.message);
            // Break on unexpected errors - don't risk applying a replacement
            break;
          }
          
          // Only proceed if segment clear was successful
          if (segmentClearSuccess) {
            await saveUserAutomationState(userId, { 
              lastCheck: Date.now(), 
              inBlackout: false, 
              activeRule: null,
              activeRuleName: null,
              activeSegment: null,
              activeSegmentEnabled: false
            });
            
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
      await saveUserAutomationState(userId, { lastCheck: Date.now(), inBlackout: false });
    }

    // ========== SOLAR CURTAILMENT CHECK ==========
    // Run AFTER automation rules to ensure sequential execution
    // Curtailment failures don't affect automation cycle
    let curtailmentResult = null;
    try {
      logger.debug('Cycle', `🌞 Starting curtailment check with amberData: ${amberData ? amberData.length : 'null'} items`);
      logger.debug('Cycle', `🔍 FULL userConfig: ${JSON.stringify(userConfig)}`);
      logger.debug('Cycle', `🔍 userConfig.curtailment specifically: ${JSON.stringify(userConfig?.curtailment)}`);
      curtailmentResult = await checkAndApplyCurtailment(userId, userConfig, amberData);
      logger.debug('Cycle', `🌞 Curtailment result: ${JSON.stringify(curtailmentResult)}`);
      if (curtailmentResult.error) {
        console.warn(`[Cycle] � ️ Curtailment check failed: ${curtailmentResult.error}`);
      }
    } catch (curtErr) {
      console.error('[Cycle] ❌ Curtailment exception:', curtErr);
      curtailmentResult = { error: curtErr.message, enabled: userConfig?.curtailment?.enabled || false };
    }
    
    // Calculate cycle duration
    const cycleDurationMs = Date.now() - cycleStartTime;
    
    res.json({
      errno: 0,
      result: {
        triggered: !!triggeredRule,
        status: triggeredRule?.status || null,  // 'new_trigger', 'continuing', or null
        rule: triggeredRule ? { name: triggeredRule.name, priority: triggeredRule.priority, actionResult: triggeredRule.actionResult } : null,
        rulesEvaluated: sortedRules.length,
        totalRules,
        evaluationResults,
        lastCheck: Date.now(),
        // Curtailment result (for UI feedback)
        curtailment: curtailmentResult,
        // Performance
        cycleDurationMs
      }
    });
  } catch (error) {
    console.error('[Automation] Cycle error:', error);
    
    // Still update lastCheck even on error
    try {
      await saveUserAutomationState(req.user.uid, { lastCheck: Date.now() });
    } catch (e) { /* ignore */ }
    res.status(500).json({ errno: 500, error: error.message });
  }
});

}

module.exports = {
  registerAutomationCycleRoute
};
