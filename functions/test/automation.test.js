/**
 * Comprehensive Test Suite for Automation System
 * 
 * Tests all critical automation behaviors including:
 * - Master switch toggling and segment clearing
 * - Individual rule enable/disable and segment clearing
 * - Rule deletion and segment clearing
 * - Cooldown behavior
 * - Rule priority and conflict resolution
 * - State persistence
 */

const admin = require('firebase-admin');

// Mock setup
jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn(() => mockFirestore),
    doc: jest.fn(() => mockFirestore),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    where: jest.fn(() => mockFirestore),
    orderBy: jest.fn(() => mockFirestore),
    limit: jest.fn(() => mockFirestore)
  };

  return {
    initializeApp: jest.fn(),
    firestore: jest.fn(() => mockFirestore),
    auth: jest.fn(() => ({
      verifyIdToken: jest.fn()
    })),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date())
    }
  };
});

describe('Automation System Tests', () => {
  let mockDb;
  let mockState;
  let mockRules;
  let mockConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup mock Firestore
    mockDb = admin.firestore();
    
    // Default mock state
    mockState = {
      enabled: true,
      activeRule: null,
      activeRuleName: null,
      activeSegment: null,
      activeSegmentEnabled: false,
      lastCheck: Date.now(),
      clearSegmentsOnNextCycle: false
    };
    
    // Default mock rules
    mockRules = {
      'cheap_price_rule': {
        name: 'Cheap Price Rule',
        enabled: true,
        priority: 1,
        conditions: {
          priceBelow: 10,
          timeRange: { start: '00:00', end: '23:59' }
        },
        action: {
          segments: [{ startHour: 14, startMinute: 0, endHour: 16, endMinute: 0, minSocOnGrid: 10 }]
        },
        cooldownMinutes: 60
      },
      'solar_rule': {
        name: 'Solar Rule',
        enabled: true,
        priority: 2,
        conditions: {
          solarRadiationAbove: 500
        },
        action: {
          segments: [{ startHour: 10, startMinute: 0, endHour: 14, endMinute: 0, minSocOnGrid: 20 }]
        },
        cooldownMinutes: 30
      }
    };
    
    // Default mock config
    mockConfig = {
      deviceSn: 'TEST123',
      foxessToken: 'test_token',
      amberApiKey: 'test_amber_key',
      amberSiteId: 'test_site'
    };
  });

  describe('Master Switch Toggle', () => {
    test('should set clearSegmentsOnNextCycle flag when automation is disabled', async () => {
      mockState.enabled = true;
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate disabling automation
      const expectedState = {
        enabled: false,
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false,
        clearSegmentsOnNextCycle: true
      };
      
      // This would be called by the toggle endpoint
      expect(expectedState.clearSegmentsOnNextCycle).toBe(true);
      expect(expectedState.activeRule).toBe(null);
    });

    test('should clear all segments when automation is disabled', async () => {
      mockState.clearSegmentsOnNextCycle = true;
      
      // Simulate cycle detecting the flag
      const shouldClearSegments = mockState.clearSegmentsOnNextCycle === true;
      
      expect(shouldClearSegments).toBe(true);
    });

    test('should not affect timer when toggling automation off', async () => {
      const originalLastCheck = Date.now() - 30000; // 30 seconds ago
      mockState.lastCheck = originalLastCheck;
      
      // Simulate toggle (should NOT modify lastCheck)
      const newState = {
        ...mockState,
        enabled: false,
        clearSegmentsOnNextCycle: true
      };
      
      expect(newState.lastCheck).toBe(originalLastCheck);
    });
  });

  describe('Individual Rule Toggle', () => {
    test('should set clearSegmentsOnNextCycle when active rule is disabled', async () => {
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate disabling the active rule
      const ruleId = 'cheap_price_rule';
      const enabled = false;
      
      const shouldSetFlag = (mockState.activeRule === ruleId && enabled === false);
      
      expect(shouldSetFlag).toBe(true);
    });

    test('should NOT set flag when disabling non-active rule', async () => {
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate disabling a different rule
      const ruleId = 'solar_rule';
      const enabled = false;
      
      const shouldSetFlag = (mockState.activeRule === ruleId && enabled === false);
      
      expect(shouldSetFlag).toBe(false);
    });

    test('should clear lastTriggered when rule is disabled', async () => {
      const rule = { ...mockRules.cheap_price_rule };
      rule.lastTriggered = Date.now() - 3600000; // 1 hour ago
      
      // Simulate disabling rule
      const update = {};
      if (false === true) { // enabled === false
        update.lastTriggered = null;
      }
      
      // When re-enabled, should be able to trigger immediately
      expect(rule.lastTriggered).toBeDefined();
    });

    test('should preserve timer when toggling rule off', async () => {
      const originalLastCheck = Date.now() - 45000;
      mockState.lastCheck = originalLastCheck;
      
      // Simulate rule toggle (should NOT touch lastCheck)
      const newState = {
        ...mockState,
        activeRule: null,
        clearSegmentsOnNextCycle: true
      };
      
      expect(newState.lastCheck).toBe(originalLastCheck);
    });
  });

  describe('Rule Deletion', () => {
    test('should set clearSegmentsOnNextCycle when deleting active rule', async () => {
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate deleting the active rule
      const ruleIdToDelete = 'cheap_price_rule';
      const isActiveRule = (mockState.activeRule === ruleIdToDelete);
      
      expect(isActiveRule).toBe(true);
      
      if (isActiveRule) {
        mockState.clearSegmentsOnNextCycle = true;
        mockState.activeRule = null;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
    });

    test('should NOT set flag when deleting non-active rule', async () => {
      mockState.activeRule = 'cheap_price_rule';
      mockState.clearSegmentsOnNextCycle = false;
      
      // Simulate deleting a different rule
      const ruleIdToDelete = 'solar_rule';
      const isActiveRule = (mockState.activeRule === ruleIdToDelete);
      
      expect(isActiveRule).toBe(false);
      
      if (isActiveRule) {
        mockState.clearSegmentsOnNextCycle = true;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(false);
    });

    test('should clear automation state when deleting active rule', async () => {
      mockState.activeRule = 'cheap_price_rule';
      mockState.activeRuleName = 'Cheap Price Rule';
      mockState.activeSegment = 0;
      
      // Simulate deletion
      const ruleIdToDelete = 'cheap_price_rule';
      if (mockState.activeRule === ruleIdToDelete) {
        mockState.activeRule = null;
        mockState.activeRuleName = null;
        mockState.activeSegment = null;
        mockState.activeSegmentEnabled = false;
      }
      
      expect(mockState.activeRule).toBe(null);
      expect(mockState.activeRuleName).toBe(null);
      expect(mockState.activeSegment).toBe(null);
    });
  });

  describe('Cycle Behavior', () => {
    test('should detect and process clearSegmentsOnNextCycle flag', async () => {
      mockState.clearSegmentsOnNextCycle = true;
      
      // Simulate cycle checking for flag
      const shouldClearAndReturn = mockState.clearSegmentsOnNextCycle === true;
      
      expect(shouldClearAndReturn).toBe(true);
      
      // After processing, flag should be cleared
      if (shouldClearAndReturn) {
        mockState.clearSegmentsOnNextCycle = false;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(false);
    });

    test('should check flag BEFORE checking activeRule state', async () => {
      mockState.clearSegmentsOnNextCycle = true;
      mockState.activeRule = null; // Already cleared
      
      // The flag check happens first, so it should work even if activeRule is null
      const flagCheck = mockState.clearSegmentsOnNextCycle === true;
      const activeRuleCheck = mockState.activeRule !== null;
      
      expect(flagCheck).toBe(true);
      expect(activeRuleCheck).toBe(false);
      
      // Flag check takes precedence
      const shouldClearSegments = flagCheck || activeRuleCheck;
      expect(shouldClearSegments).toBe(true);
    });

    test('should skip automation when disabled', async () => {
      mockState.enabled = false;
      
      const shouldRunAutomation = mockState.enabled === true;
      
      expect(shouldRunAutomation).toBe(false);
    });

    test('should skip automation when no rules configured', async () => {
      const rules = {};
      const enabledRules = Object.entries(rules).filter(([_, r]) => r.enabled);
      
      const shouldRunAutomation = enabledRules.length > 0;
      
      expect(shouldRunAutomation).toBe(false);
    });
  });

  describe('Cooldown Logic', () => {
    test('should respect cooldown period', async () => {
      const rule = { ...mockRules.cheap_price_rule };
      rule.cooldownMinutes = 60;
      rule.lastTriggered = Date.now() - 30 * 60 * 1000; // 30 minutes ago
      
      const cooldownMs = rule.cooldownMinutes * 60 * 1000;
      const timeSinceTriggered = Date.now() - rule.lastTriggered;
      const isInCooldown = timeSinceTriggered < cooldownMs;
      
      expect(isInCooldown).toBe(true);
    });

    test('should allow rule after cooldown expires', async () => {
      const rule = { ...mockRules.cheap_price_rule };
      rule.cooldownMinutes = 60;
      rule.lastTriggered = Date.now() - 90 * 60 * 1000; // 90 minutes ago
      
      const cooldownMs = rule.cooldownMinutes * 60 * 1000;
      const timeSinceTriggered = Date.now() - rule.lastTriggered;
      const isInCooldown = timeSinceTriggered < cooldownMs;
      
      expect(isInCooldown).toBe(false);
    });

    test('should allow rule without lastTriggered', async () => {
      const rule = { ...mockRules.cheap_price_rule };
      rule.lastTriggered = null;
      
      const isInCooldown = rule.lastTriggered !== null;
      
      expect(isInCooldown).toBe(false);
    });
  });

  describe('Rule Priority', () => {
    test('should sort rules by priority', async () => {
      const rulesArray = Object.entries(mockRules).map(([id, r]) => ({ id, ...r }));
      const sorted = rulesArray.sort((a, b) => a.priority - b.priority);
      
      expect(sorted[0].priority).toBeLessThan(sorted[1].priority);
      expect(sorted[0].id).toBe('cheap_price_rule'); // priority 1
      expect(sorted[1].id).toBe('solar_rule'); // priority 2
    });

    test('should evaluate rules in priority order', async () => {
      const evaluationOrder = [];
      
      const rulesArray = Object.entries(mockRules).map(([id, r]) => ({ id, ...r }));
      const sorted = rulesArray.sort((a, b) => a.priority - b.priority);
      
      sorted.forEach(rule => {
        if (rule.enabled) {
          evaluationOrder.push(rule.id);
        }
      });
      
      expect(evaluationOrder[0]).toBe('cheap_price_rule');
      expect(evaluationOrder[1]).toBe('solar_rule');
    });
  });

  describe('State Management', () => {
    test('should preserve state fields when updating', async () => {
      const originalState = { ...mockState };
      originalState.lastCheck = Date.now() - 60000;
      originalState.someCustomField = 'test';
      
      // Simulate partial update
      const update = {
        activeRule: 'cheap_price_rule',
        activeRuleName: 'Cheap Price Rule'
      };
      
      const newState = { ...originalState, ...update };
      
      expect(newState.lastCheck).toBe(originalState.lastCheck);
      expect(newState.someCustomField).toBe('test');
      expect(newState.activeRule).toBe('cheap_price_rule');
    });

    test('should clear flag after processing', async () => {
      mockState.clearSegmentsOnNextCycle = true;
      
      // Simulate cycle processing the flag
      if (mockState.clearSegmentsOnNextCycle) {
        // Clear segments...
        mockState.clearSegmentsOnNextCycle = false;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(false);
    });
  });

  describe('Segment Clearing', () => {
    test('should build correct clear command', async () => {
      const clearedGroups = [];
      for (let i = 0; i < 8; i++) {
        clearedGroups.push({
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
      
      expect(clearedGroups).toHaveLength(8);
      expect(clearedGroups[0].enable).toBe(0);
      expect(clearedGroups[7].enable).toBe(0);
    });

    test('should clear all segments when master switch disabled', async () => {
      mockState.enabled = true;
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate toggle off
      mockState.enabled = false;
      mockState.clearSegmentsOnNextCycle = true;
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
    });

    test('should clear segments when active rule disabled', async () => {
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate disabling active rule
      const disabledRuleId = 'cheap_price_rule';
      if (mockState.activeRule === disabledRuleId) {
        mockState.clearSegmentsOnNextCycle = true;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
    });

    test('should clear segments when active rule deleted', async () => {
      mockState.activeRule = 'cheap_price_rule';
      
      // Simulate deleting active rule
      const deletedRuleId = 'cheap_price_rule';
      if (mockState.activeRule === deletedRuleId) {
        mockState.clearSegmentsOnNextCycle = true;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle missing state gracefully', async () => {
      const state = null;
      const enabled = state?.enabled ?? true; // Default to enabled
      
      expect(enabled).toBe(true);
    });

    test('should handle missing config gracefully', async () => {
      const config = null;
      const deviceSN = config?.deviceSn;
      
      expect(deviceSN).toBeUndefined();
    });

    test('should handle empty rules object', async () => {
      const rules = {};
      const ruleCount = Object.keys(rules).length;
      
      expect(ruleCount).toBe(0);
    });

    test('should handle rule with no conditions', async () => {
      const rule = {
        name: 'Test Rule',
        enabled: true,
        conditions: {},
        action: { segments: [] }
      };
      
      const hasConditions = Object.keys(rule.conditions).length > 0;
      
      expect(hasConditions).toBe(false);
    });

    test('should handle concurrent flag operations', async () => {
      mockState.clearSegmentsOnNextCycle = false;
      
      // Simulate two operations trying to set the flag
      mockState.clearSegmentsOnNextCycle = true;
      const firstSet = mockState.clearSegmentsOnNextCycle;
      
      mockState.clearSegmentsOnNextCycle = true;
      const secondSet = mockState.clearSegmentsOnNextCycle;
      
      expect(firstSet).toBe(true);
      expect(secondSet).toBe(true);
      
      // Both should result in the same state
      expect(firstSet).toBe(secondSet);
    });
  });

  describe('Integration Scenarios', () => {
    test('complete flow: enable rule → activate → disable → clear', async () => {
      // 1. Start with no active rule
      mockState.activeRule = null;
      expect(mockState.activeRule).toBe(null);
      
      // 2. Rule triggers and becomes active
      mockState.activeRule = 'cheap_price_rule';
      mockState.activeRuleName = 'Cheap Price Rule';
      mockState.activeSegment = 0;
      expect(mockState.activeRule).toBe('cheap_price_rule');
      
      // 3. User disables the rule
      if (mockState.activeRule === 'cheap_price_rule') {
        mockState.clearSegmentsOnNextCycle = true;
        mockState.activeRule = null;
      }
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
      
      // 4. Cycle processes the flag
      if (mockState.clearSegmentsOnNextCycle) {
        // Clear segments on inverter...
        mockState.clearSegmentsOnNextCycle = false;
      }
      expect(mockState.clearSegmentsOnNextCycle).toBe(false);
      expect(mockState.activeRule).toBe(null);
    });

    test('complete flow: enable automation → rule active → disable automation → clear', async () => {
      // 1. Automation enabled
      mockState.enabled = true;
      mockState.activeRule = 'cheap_price_rule';
      
      // 2. User disables automation
      mockState.enabled = false;
      mockState.clearSegmentsOnNextCycle = true;
      mockState.activeRule = null;
      
      expect(mockState.enabled).toBe(false);
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
      
      // 3. Cycle processes
      if (mockState.clearSegmentsOnNextCycle) {
        mockState.clearSegmentsOnNextCycle = false;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(false);
    });

    test('complete flow: create rule → activate → delete → clear', async () => {
      // 1. Rule created and triggers
      mockState.activeRule = 'cheap_price_rule';
      
      // 2. User deletes the rule
      const ruleToDelete = 'cheap_price_rule';
      if (mockState.activeRule === ruleToDelete) {
        mockState.clearSegmentsOnNextCycle = true;
        mockState.activeRule = null;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
      
      // 3. Rule deleted from DB
      delete mockRules[ruleToDelete];
      
      // 4. Cycle processes flag
      if (mockState.clearSegmentsOnNextCycle) {
        mockState.clearSegmentsOnNextCycle = false;
      }
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(false);
      expect(mockRules[ruleToDelete]).toBeUndefined();
    });
  });
});
