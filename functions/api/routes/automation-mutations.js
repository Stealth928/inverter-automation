'use strict';

function registerAutomationMutationRoutes(app, deps = {}) {
  const addAutomationAuditEntry = deps.addAutomationAuditEntry;
  const addHistoryEntry = deps.addHistoryEntry;
  const applyRuleAction = deps.applyRuleAction;
  const clearRulesLastTriggered = deps.clearRulesLastTriggered;
  const compareValue = deps.compareValue;
  const db = deps.db;
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
        
        if (curtailmentState.active && userConfig?.deviceSn) {
          console.log(`[Automation Toggle] Restoring export power (curtailment was active, automation disabled)`);
          
          const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
            sn: userConfig.deviceSn,
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
            console.log(`[Automation Toggle] ✓ Export power restored successfully`);
          } else {
            console.warn(`[Automation Toggle] � ️ Failed to restore export power: ${setResult?.msg || 'Unknown error'}`);
          }
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
        
        if (curtailmentState.active && userConfig?.deviceSn) {
          console.log(`[Automation Enable] Restoring export power (curtailment was active, automation disabled)`);
          
          const setResult = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/set', 'POST', {
            sn: userConfig.deviceSn,
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
            console.log(`[Automation Enable] ✓ Export power restored successfully`);
          } else {
            console.warn(`[Automation Enable] � ️ Failed to restore export power: ${setResult?.msg || 'Unknown error'}`);
          }
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
      activeRuleName: rule.name || ruleName
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
    const deviceSN = userConfig?.deviceSn;
    
    if (!deviceSN) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    logger.debug('Automation', `Cancel request for user ${userId}, device ${deviceSN}`);

    // Create 8 empty/disabled segments (matching device's actual group count)
    const emptyGroups = [];
    for (let i = 0; i < 8; i++) {
      emptyGroups.push({
        enable: 0,
        workMode: 'SelfUse',
        startHour: 0, startMinute: 0,
        endHour: 0, endMinute: 0,
        minSocOnGrid: 10,
        fdSoc: 10,
        fdPwr: 0,
        maxSoc: 100
      });
    }
    
    // Send to device via v1 API
    const result = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: emptyGroups }, userConfig, userId);
    logger.debug('Automation', `Cancel v1 result: errno=${result.errno}`);
    
    // Disable the scheduler flag
    let flagResult = null;
    try {
      flagResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 0 }, userConfig, userId);
      logger.debug('Automation', `Cancel flag result: errno=${flagResult?.errno}`);
    } catch (flagErr) {
      console.warn('[Automation] Flag disable failed:', flagErr && flagErr.message ? flagErr.message : flagErr);
    }
    
    // Verification read
    let verify = null;
    try {
      verify = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    } catch (e) {
      console.warn('[Automation] Verify read failed:', e && e.message ? e.message : e);
    }
    
    // Clear active rule in state
    await saveUserAutomationState(userId, {
      activeRule: null
    });
    
    // Log to history
    try {
      await addHistoryEntry(userId, {
        type: 'automation_cancel',
        timestamp: serverTimestamp()
      });
    } catch (e) { /* ignore */ }
    
    res.json({
      errno: result.errno,
      msg: result.msg || (result.errno === 0 ? 'Automation cancelled' : 'Failed'),
      flagResult,
      verify: verify?.result || null
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
        activeSegment: null,
        activeSegmentEnabled: false
      });
    }
    
    const durationMs = endTimestamp - startTimestamp;
    logger.debug('Automation', `✅ Orphan rule ended: ${startEvent.ruleName} (${Math.round(durationMs / 1000)}s duration)`);
    
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
        
        // Get user config for device SN
        const userConfig = await getUserConfig(req.user.uid);
        const deviceSN = userConfig?.deviceSn;
        
        // Clear scheduler segments immediately
        if (deviceSN) {
          try {
            const clearedGroups = [];
            for (let i = 0; i < 8; i++) {
              clearedGroups.push({
                enable: 0,
                workMode: 'SelfUse',
                startHour: 0, startMinute: 0,
                endHour: 0, endMinute: 0,
                minSocOnGrid: 10,
                fdSoc: 10,
                fdPwr: 0,
                maxSoc: 100
              });
            }
            const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, req.user.uid);
            if (clearResult?.errno === 0) {
              console.log(`[Rule Update] ✓ Segments cleared successfully`);
            } else {
              console.warn(`[Rule Update] � ️ Failed to clear segments: errno=${clearResult?.errno}`);
            }
          } catch (err) {
            console.error(`[Rule Update] ❌ Error clearing segments:`, err.message);
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
        
        console.log(`[Rule Update] ✓ Audit entry created - rule marked as ended`);
        
        // Clear active rule state
        await saveUserAutomationState(req.user.uid, {
          activeRule: null,
          activeRuleName: null,
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
      
      // Get user config for device SN
      const userConfig = await getUserConfig(req.user.uid);
      const deviceSN = userConfig?.deviceSn;
      
      // Clear scheduler segments immediately
      if (deviceSN) {
        try {
          const clearedGroups = [];
          for (let i = 0; i < 8; i++) {
            clearedGroups.push({
              enable: 0,
              workMode: 'SelfUse',
              startHour: 0, startMinute: 0,
              endHour: 0, endMinute: 0,
              minSocOnGrid: 10,
              fdSoc: 10,
              fdPwr: 0,
              maxSoc: 100
            });
          }
          const clearResult = await foxessAPI.callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, req.user.uid);
          if (clearResult?.errno === 0) {
            console.log(`[Rule Delete] ✓ Segments cleared successfully`);
          } else {
            console.warn(`[Rule Delete] � ️ Failed to clear segments: errno=${clearResult?.errno}`);
          }
        } catch (err) {
          console.error(`[Rule Delete] ❌ Error clearing segments:`, err.message);
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
      
      console.log(`[Rule Delete] ✓ Audit entry created - rule marked as ended`);
      
      // Clear active rule state
      await saveUserAutomationState(req.user.uid, {
        activeRule: null,
        activeRuleName: null,
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
    const rules = await getUserRules(req.user.uid);
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
      let met = true;
      const condDetails = [];

      // feedInPrice
      if (cond.feedInPrice?.enabled) {
        const price = Number(mockData.feedInPrice || 0);
        const target = Number(cond.feedInPrice.value || 0);
        const cmet = compareValue(price, cond.feedInPrice.operator, target);
        condDetails.push({ name: 'Feed-in Price', value: price, target, operator: cond.feedInPrice.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // buyPrice
      if (cond.buyPrice?.enabled) {
        const price = Number(mockData.buyPrice || 0);
        const target = Number(cond.buyPrice.value || 0);
        const cmet = compareValue(price, cond.buyPrice.operator, target);
        condDetails.push({ name: 'Buy Price', value: price, target, operator: cond.buyPrice.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // soc
      if (cond.soc?.enabled) {
        const soc = Number(mockData.soc || 0);
        const target = Number(cond.soc.value || 0);
        const cmet = compareValue(soc, cond.soc.operator, target);
        condDetails.push({ name: 'Battery SoC', value: soc, target, operator: cond.soc.operator, met: !!cmet });
        if (!cmet) met = false;
      }

      // temperature
      const tempCond = cond.temp || cond.temperature;
      if (tempCond?.enabled) {
        const tempResult = evaluateTemperatureCondition(tempCond, {
          batteryTemp: Number(mockData.batteryTemp),
          ambientTemp: Number(mockData.ambientTemp),
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
          met = false;
        } else {
          const label = tempResult.source === 'weather_daily'
            ? `Forecast ${tempResult.metric === 'min' ? 'Min' : 'Max'} Temp (D+${tempResult.dayOffset || 0})`
            : (String(tempResult.type || '').toLowerCase() === 'battery' ? 'Battery Temp' : 'Ambient Temp');
          condDetails.push({
            name: label,
            value: tempResult.actual,
            target: tempResult.target,
            operator: tempResult.operator,
            met: !!tempResult.met
          });
          if (!tempResult.met) met = false;
        }
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
        if (!timeResult.met) met = false;
      }

      allResults.push({ ruleName: rule.name || ruleId, ruleId, met, priority: rule.priority || 99, conditions: condDetails });

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

