'use strict';

function registerAutomationHistoryRoutes(app, deps = {}) {
  const getAutomationAuditLogs = deps.getAutomationAuditLogs;
  const getUserHistoryEntries = deps.getUserHistoryEntries;

  if (!app || typeof app.get !== 'function') {
    throw new Error('registerAutomationHistoryRoutes requires an Express app');
  }
  if (typeof getAutomationAuditLogs !== 'function') {
    throw new Error('registerAutomationHistoryRoutes requires getAutomationAuditLogs()');
  }
  if (typeof getUserHistoryEntries !== 'function') {
    throw new Error('registerAutomationHistoryRoutes requires getUserHistoryEntries()');
  }

  // Get automation history
  app.get('/api/automation/history', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const history = await getUserHistoryEntries(req.user.uid, limit);

      res.json({ errno: 0, result: history });
    } catch (error) {
      res.status(500).json({ errno: 500, error: error.message });
    }
  });

  // Get automation audit logs (cycle history with cache & performance metrics)
  app.get('/api/automation/audit', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '1000', 10); // Increased to ensure we get all events in range
      const days = parseInt(req.query.days || '7', 10); // Support days parameter (default 7)

      // Support explicit date range: ?startDate=2025-12-19&endDate=2025-12-21
      let startMs = null;
      let endMs = null;
      let period = null;

      if (req.query.startDate && req.query.endDate) {
        try {
          // Parse dates as YYYY-MM-DD in local timezone
          const [startYear, startMonth, startDay] = req.query.startDate.split('-').map(Number);
          const [endYear, endMonth, endDay] = req.query.endDate.split('-').map(Number);

          if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) {
            throw new Error('Invalid date format');
          }

          const startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
          const endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

          startMs = startDate.getTime();
          endMs = endDate.getTime();
          period = `${req.query.startDate} to ${req.query.endDate}`;
          console.log(`[Audit] Fetching events for date range: ${period} (${startMs} to ${endMs})`);
        } catch (parseError) {
          console.error(`[Audit] Date parsing error: ${parseError.message}`);
          return res.status(400).json({ errno: 400, error: `Invalid date format: ${parseError.message}` });
        }
      } else {
        // Fallback: use days parameter (relative to now)
        endMs = Date.now();
        startMs = endMs - (days * 24 * 60 * 60 * 1000);
        period = `${days} days`;
        console.log(`[Audit] Fetching events for last ${period} (${startMs} to ${endMs})`);
      }

      const auditLogs = await getAutomationAuditLogs(req.user.uid, limit);

      // Filter by date range
      const filteredLogs = auditLogs.filter((log) => log.epochMs >= startMs && log.epochMs <= endMs);

      console.log(`[Audit] Filtered ${filteredLogs.length} events from ${auditLogs.length} total`);

      // Process logs to identify rule on/off pairs and calculate durations
      const ruleEvents = [];
      const activeRules = new Map(); // Track currently active rules

      // Process logs in chronological order (oldest first)
      const chronological = [...filteredLogs].reverse();

      for (const log of chronological) {
        const activeRuleBefore = log.activeRuleBefore;
        const activeRuleAfter = log.activeRuleAfter;

        // Detect rule turning OFF (was active, now not)
        if (activeRuleBefore && activeRuleBefore !== activeRuleAfter) {
          const startEvent = activeRules.get(activeRuleBefore);
          if (startEvent) {
            // Rule turned off - create complete event with duration
            const durationMs = log.epochMs - startEvent.epochMs;
            ruleEvents.push({
              type: 'complete',
              ruleId: activeRuleBefore,
              ruleName: startEvent.ruleName || activeRuleBefore,
              startTime: startEvent.epochMs,
              endTime: log.epochMs,
              durationMs,
              startConditions: startEvent.conditions,
              endConditions: log.evaluationResults,
              startAllRules: startEvent.allRuleEvaluations, // All rules evaluated at start
              endAllRules: log.allRuleEvaluations, // All rules evaluated at end
              action: startEvent.action,
              roiSnapshot: startEvent.roiSnapshot // Include ROI snapshot captured at trigger time
            });
            activeRules.delete(activeRuleBefore);
          }
        }

        // Detect rule turning ON (newly triggered)
        if (log.triggered && activeRuleAfter && activeRuleAfter !== activeRuleBefore) {
          // Rule turned on - store start event
          activeRules.set(activeRuleAfter, {
            epochMs: log.epochMs,
            ruleName: log.ruleName || activeRuleAfter,
            ruleId: log.ruleId || activeRuleAfter,
            conditions: log.evaluationResults,
            allRuleEvaluations: log.allRuleEvaluations, // Store all rules evaluated
            action: log.actionTaken,
            roiSnapshot: log.roiSnapshot // Preserve ROI data for later use in complete event
          });
        }
      }

      // Add any still-active rules as ongoing events
      for (const [ruleId, startEvent] of activeRules.entries()) {
        const durationMs = Date.now() - startEvent.epochMs;
        ruleEvents.push({
          type: 'ongoing',
          ruleId,
          ruleName: startEvent.ruleName || ruleId,
          startTime: startEvent.epochMs,
          endTime: null,
          durationMs,
          startConditions: startEvent.conditions,
          startAllRules: startEvent.allRuleEvaluations, // All rules evaluated when started
          action: startEvent.action,
          roiSnapshot: startEvent.roiSnapshot // Include ROI snapshot from trigger time
        });
      }

      // Sort events by start time (newest first for UI)
      ruleEvents.sort((a, b) => b.startTime - a.startTime);

      res.json({
        errno: 0,
        result: {
          entries: filteredLogs, // Raw audit logs
          ruleEvents, // Processed rule on/off events
          count: filteredLogs.length,
          eventsCount: ruleEvents.length,
          period: period,
          cutoffTime: startMs,
          note: 'Logs older than 7 days are automatically deleted'
        }
      });
    } catch (error) {
      res.status(500).json({ errno: 500, error: error.message });
    }
  });
}

module.exports = {
  registerAutomationHistoryRoutes
};
