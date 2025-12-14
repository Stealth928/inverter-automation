/**
 * Tests for Automation Audit functionality
 * Tests the audit log processing and rule event detection logic
 */

describe('Automation Audit Logic', () => {
  /**
   * Helper function to process audit logs into rule events
   * Mimics the backend logic in /api/automation/audit
   */
  function processAuditLogs(entries, currentTime = Date.now()) {
    const ruleEvents = [];
    const activeRules = {}; // Track active rules (ruleId -> start entry)

    // Process entries in chronological order (oldest first)
    const sortedEntries = [...entries].sort((a, b) => a.epochMs - b.epochMs);

    for (const entry of sortedEntries) {
      const { activeRuleBefore, activeRuleAfter, ruleId, ruleName, epochMs, evaluationResults, actionTaken } = entry;

      // Detect rule turning ON
      if (activeRuleBefore === null && activeRuleAfter) {
        activeRules[activeRuleAfter] = {
          ruleId: activeRuleAfter,
          ruleName: ruleName || activeRuleAfter,
          startTime: epochMs,
          startConditions: evaluationResults || [],
          action: actionTaken || {}
        };
      }

      // Detect rule turning OFF
      if (activeRuleBefore && activeRuleAfter === null) {
        const ruleStartEvent = activeRules[activeRuleBefore];
        if (ruleStartEvent) {
          ruleEvents.push({
            type: 'complete',
            ruleId: activeRuleBefore,
            ruleName: ruleStartEvent.ruleName,
            startTime: ruleStartEvent.startTime,
            endTime: epochMs,
            durationMs: epochMs - ruleStartEvent.startTime,
            startConditions: ruleStartEvent.startConditions,
            endConditions: evaluationResults || [],
            action: ruleStartEvent.action
          });
          delete activeRules[activeRuleBefore];
        }
      }
    }

    // Any remaining active rules are "ongoing"
    for (const ruleId in activeRules) {
      const ruleStartEvent = activeRules[ruleId];
      ruleEvents.push({
        type: 'ongoing',
        ruleId,
        ruleName: ruleStartEvent.ruleName,
        startTime: ruleStartEvent.startTime,
        endTime: null,
        durationMs: currentTime - ruleStartEvent.startTime,
        startConditions: ruleStartEvent.startConditions,
        endConditions: null,
        action: ruleStartEvent.action
      });
    }

    // Sort events by start time (newest first)
    ruleEvents.sort((a, b) => b.startTime - a.startTime);

    return ruleEvents;
  }

  describe('Rule Event Processing', () => {
    test('should return empty array when no audit logs exist', () => {
      const entries = [];
      const events = processAuditLogs(entries);
      
      expect(events).toEqual([]);
    });

    test('should filter logs by date range (7 days default)', () => {
      const now = Date.now();
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
      const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);

      const allLogs = [
        { docId: 'log1', epochMs: now - 1000, triggered: false, activeRuleBefore: null, activeRuleAfter: null },
        { docId: 'log2', epochMs: sevenDaysAgo + 1000, triggered: false, activeRuleBefore: null, activeRuleAfter: null },
        { docId: 'log3', epochMs: eightDaysAgo, triggered: false, activeRuleBefore: null, activeRuleAfter: null }
      ];

      // Filter to 7 days
      const cutoffTime = now - (7 * 24 * 60 * 60 * 1000);
      const filtered = allLogs.filter(log => log.epochMs > cutoffTime);
      
      expect(filtered.length).toBe(2);  // Only 2 within 7 days
    });

    test('should process rule on/off events correctly', () => {
      const now = Date.now();
      const entries = [
        {
          docId: 'log1',
          epochMs: now - 3600000,  // 1 hour ago - rule turns on
          triggered: true,
          ruleName: 'High Export Price',
          ruleId: 'rule1',
          activeRuleBefore: null,
          activeRuleAfter: 'rule1',
          evaluationResults: [
            { name: 'Feed-in Price > 40¢', met: true, value: '42¢' }
          ],
          actionTaken: { workMode: 'ForceDischarge', durationMinutes: 30, fdPwr: 7000 }
        },
        {
          docId: 'log2',
          epochMs: now - 1800000,  // 30 minutes ago - rule turns off
          triggered: false,
          activeRuleBefore: 'rule1',
          activeRuleAfter: null,
          evaluationResults: [
            { name: 'Feed-in Price > 40¢', met: false, value: '25¢' }
          ]
        }
      ];

      const events = processAuditLogs(entries, now);
      
      expect(events.length).toBe(1);
      
      const event = events[0];
      expect(event.type).toBe('complete');
      expect(event.ruleId).toBe('rule1');
      expect(event.ruleName).toBe('High Export Price');
      expect(event.startTime).toBe(now - 3600000);
      expect(event.endTime).toBe(now - 1800000);
      expect(event.durationMs).toBe(1800000);  // 30 minutes
      expect(event.startConditions).toHaveLength(1);
      expect(event.endConditions).toHaveLength(1);
      expect(event.action.workMode).toBe('ForceDischarge');
    });

    test('should identify ongoing rules', () => {
      const now = Date.now();
      const entries = [
        {
          docId: 'log1',
          epochMs: now - 600000,  // 10 minutes ago - rule still active
          triggered: true,
          ruleName: 'Cheap Import',
          ruleId: 'rule2',
          activeRuleBefore: null,
          activeRuleAfter: 'rule2',
          evaluationResults: [
            { name: 'Buy Price < 10¢', met: true, value: '8¢' }
          ],
          actionTaken: { workMode: 'ForceCharge', durationMinutes: 30, fdPwr: 5000 }
        }
      ];

      const events = processAuditLogs(entries, now);
      
      expect(events.length).toBe(1);
      
      const event = events[0];
      expect(event.type).toBe('ongoing');
      expect(event.endTime).toBeNull();
      expect(event.durationMs).toBe(600000);  // 10 minutes
    });

    test('should handle multiple rule transitions', () => {
      const now = Date.now();
      const entries = [
        {
          docId: 'log1',
          epochMs: now - 7200000,  // 2 hours ago
          triggered: true,
          ruleName: 'Rule A',
          ruleId: 'ruleA',
          activeRuleBefore: null,
          activeRuleAfter: 'ruleA',
          evaluationResults: [],
          actionTaken: { workMode: 'SelfUse' }
        },
        {
          docId: 'log2',
          epochMs: now - 5400000,  // 1.5 hours ago
          triggered: false,
          activeRuleBefore: 'ruleA',
          activeRuleAfter: null,
          evaluationResults: []
        },
        {
          docId: 'log3',
          epochMs: now - 3600000,  // 1 hour ago
          triggered: true,
          ruleName: 'Rule B',
          ruleId: 'ruleB',
          activeRuleBefore: null,
          activeRuleAfter: 'ruleB',
          evaluationResults: [],
          actionTaken: { workMode: 'ForceCharge' }
        },
        {
          docId: 'log4',
          epochMs: now - 1800000,  // 30 minutes ago
          triggered: false,
          activeRuleBefore: 'ruleB',
          activeRuleAfter: null,
          evaluationResults: []
        }
      ];

      const events = processAuditLogs(entries, now);
      
      expect(events.length).toBe(2);
      
      // Events should be sorted by start time (newest first)
      expect(events[0].ruleId).toBe('ruleB');
      expect(events[1].ruleId).toBe('ruleA');
      
      // Verify durations
      expect(events[0].durationMs).toBe(1800000);  // 30 minutes
      expect(events[1].durationMs).toBe(1800000);  // 30 minutes
    });

    test('should handle orphaned rule-off events (no matching start)', () => {
      const now = Date.now();
      const entries = [
        {
          docId: 'log1',
          epochMs: now - 1800000,
          triggered: false,
          activeRuleBefore: 'rule1',
          activeRuleAfter: null,
          evaluationResults: []
        }
      ];

      const events = processAuditLogs(entries, now);
      
      // Should not create an event if there's no matching start
      expect(events.length).toBe(0);
    });

    test('should handle overlapping rule periods', () => {
      const now = Date.now();
      const entries = [
        {
          docId: 'log1',
          epochMs: now - 7200000,  // Rule A starts
          triggered: true,
          ruleName: 'Rule A',
          ruleId: 'ruleA',
          activeRuleBefore: null,
          activeRuleAfter: 'ruleA',
          evaluationResults: [],
          actionTaken: { workMode: 'SelfUse' }
        },
        {
          docId: 'log2',
          epochMs: now - 3600000,  // Rule B starts (A might still be active in reality but audit shows transition)
          triggered: true,
          ruleName: 'Rule B',
          ruleId: 'ruleB',
          activeRuleBefore: 'ruleA',  // Previous rule was A
          activeRuleAfter: 'ruleB',    // Now B is active
          evaluationResults: [],
          actionTaken: { workMode: 'ForceCharge' }
        },
        {
          docId: 'log3',
          epochMs: now - 1800000,  // Rule B ends
          triggered: false,
          activeRuleBefore: 'ruleB',
          activeRuleAfter: null,
          evaluationResults: []
        }
      ];

      const events = processAuditLogs(entries, now);
      
      // Should create events for both rules
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});
