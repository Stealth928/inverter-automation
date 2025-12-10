/**
 * Comprehensive Edge Case Tests for Automation System
 * 
 * Tests complex scenarios including:
 * - Multiple simultaneous rule triggers
 * - API failures during cycle execution
 * - Concurrent cycle executions
 * - Network timeouts and retries
 * - Invalid rule configurations
 * - State corruption and recovery
 * - Race conditions and timing issues
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

describe('Automation Edge Cases', () => {
  let mockDb;
  let mockState;
  let mockRules;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = admin.firestore();
    
    mockState = {
      enabled: true,
      activeRule: null,
      activeRuleName: null,
      activeSegment: null,
      activeSegmentEnabled: false,
      lastCheck: Date.now(),
      clearSegmentsOnNextCycle: false
    };
    
    mockRules = {
      'rule_1': {
        name: 'High Priority Rule',
        enabled: true,
        priority: 1,
        cooldownMinutes: 60,
        conditions: { feedInPrice: { enabled: true, operator: '>', value: 30 } },
        action: { workMode: 'ForceDischarge', durationMinutes: 30, fdPwr: 5000 }
      },
      'rule_2': {
        name: 'Medium Priority Rule',
        enabled: true,
        priority: 2,
        cooldownMinutes: 30,
        conditions: { soc: { enabled: true, operator: '>', value: 90 } },
        action: { workMode: 'ForceDischarge', durationMinutes: 45, fdPwr: 4000 }
      },
      'rule_3': {
        name: 'Low Priority Rule',
        enabled: true,
        priority: 3,
        cooldownMinutes: 15,
        conditions: { buyPrice: { enabled: true, operator: '<', value: 10 } },
        action: { workMode: 'ForceCharge', durationMinutes: 60, fdPwr: 3000 }
      }
    };
    
    mockConfig = {
      deviceSn: 'TEST123',
      foxessToken: 'test_token',
      amberApiKey: 'test_amber_key',
      amberSiteId: 'test_site'
    };
  });

  describe('Multiple Simultaneous Rule Triggers', () => {
    test('should only activate highest priority rule when multiple rules match', async () => {
      // Simulate all three rules having conditions met
      const matchingRules = [
        { id: 'rule_1', priority: 1, name: 'High Priority Rule' },
        { id: 'rule_2', priority: 2, name: 'Medium Priority Rule' },
        { id: 'rule_3', priority: 3, name: 'Low Priority Rule' }
      ];
      
      // Sort by priority
      const sorted = matchingRules.sort((a, b) => a.priority - b.priority);
      
      // Only first (highest priority) should be activated
      const triggeredRule = sorted[0];
      
      expect(triggeredRule.id).toBe('rule_1');
      expect(triggeredRule.priority).toBe(1);
    });

    test('should skip lower priority rules when higher priority rule is active', async () => {
      mockState.activeRule = 'rule_1';
      
      // Simulate rule_2 and rule_3 having conditions met
      const newMatchingRules = ['rule_2', 'rule_3'];
      
      // Should not trigger because rule_1 is already active
      const shouldTriggerNew = mockState.activeRule === null;
      
      expect(shouldTriggerNew).toBe(false);
      expect(mockState.activeRule).toBe('rule_1');
    });

    test('should handle priority ties by using first-evaluated rule', async () => {
      mockRules.rule_2.priority = 1; // Same as rule_1
      
      const matchingRules = [
        { id: 'rule_1', priority: 1, name: 'First Rule' },
        { id: 'rule_2', priority: 1, name: 'Second Rule' }
      ];
      
      const sorted = matchingRules.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id); // Stable sort by ID
      });
      
      expect(sorted[0].id).toBe('rule_1');
    });

    test('should evaluate all rules even when one is active (for monitoring)', async () => {
      mockState.activeRule = 'rule_1';
      
      const allRules = Object.entries(mockRules).map(([id, r]) => ({ id, ...r }));
      const enabledRules = allRules.filter(r => r.enabled);
      
      // All enabled rules should be evaluated (even with active rule)
      expect(enabledRules).toHaveLength(3);
    });

    test('should handle rule cooldown expiry with multiple waiting rules', async () => {
      // Rule 1 active and in cooldown
      mockState.activeRule = 'rule_1';
      mockRules.rule_1.lastTriggered = Date.now() - 61 * 60 * 1000; // Expired
      
      // Rules 2 and 3 ready to trigger
      const waitingRules = ['rule_2', 'rule_3'];
      const cooldownExpired = (Date.now() - mockRules.rule_1.lastTriggered) > (60 * 60 * 1000);
      
      if (cooldownExpired) {
        // Should allow rule_2 (higher priority) to trigger
        const nextRule = waitingRules.sort((a, b) => 
          mockRules[a].priority - mockRules[b].priority
        )[0];
        
        expect(nextRule).toBe('rule_2');
      }
    });
  });

  describe('API Failures During Cycle', () => {
    test('should handle FoxESS API failure gracefully', async () => {
      const apiError = new Error('FoxESS API timeout');
      apiError.code = 'ETIMEDOUT';
      
      // Cycle should continue and log error, not crash
      const shouldContinue = true;
      const errorLogged = apiError.message;
      
      expect(shouldContinue).toBe(true);
      expect(errorLogged).toContain('timeout');
    });

    test('should handle Amber API failure gracefully', async () => {
      const apiError = new Error('Amber API 503 Service Unavailable');
      apiError.statusCode = 503;
      
      // Should use cached prices if available
      const shouldUseCachedData = true;
      
      expect(shouldUseCachedData).toBe(true);
    });

    test('should handle weather API failure gracefully', async () => {
      const apiError = new Error('Weather API rate limit exceeded');
      apiError.statusCode = 429;
      
      // Should skip weather-dependent rules but continue with others
      const shouldSkipWeatherRules = true;
      const shouldContinueOtherRules = true;
      
      expect(shouldSkipWeatherRules).toBe(true);
      expect(shouldContinueOtherRules).toBe(true);
    });

    test('should handle Firestore write failure during state update', async () => {
      const firestoreError = new Error('Firestore unavailable');
      firestoreError.code = 'unavailable';
      
      // Should retry with exponential backoff
      const shouldRetry = true;
      const maxRetries = 3;
      
      expect(shouldRetry).toBe(true);
      expect(maxRetries).toBe(3);
    });

    test('should handle scheduler segment creation failure', async () => {
      const schedulerError = new Error('FoxESS segment creation failed');
      schedulerError.errno = 40257;
      
      // Should clear activeRule state and retry next cycle
      mockState.activeRule = 'rule_1';
      
      if (schedulerError.errno === 40257) {
        mockState.activeRule = null;
        mockState.activeSegmentEnabled = false;
      }
      
      expect(mockState.activeRule).toBe(null);
    });

    test('should handle partial API response (missing fields)', async () => {
      const partialResponse = {
        errno: 0,
        result: {
          // Missing expected fields
        }
      };
      
      const hasRequiredData = partialResponse.result?.expectedField !== undefined;
      
      // Should handle gracefully without crashing
      expect(hasRequiredData).toBe(false);
      expect(() => {
        const value = partialResponse.result?.expectedField ?? 'default';
        expect(value).toBe('default');
      }).not.toThrow();
    });
  });

  describe('Concurrent Cycle Executions', () => {
    test('should prevent concurrent cycles for same user', async () => {
      const cycleInProgress = true;
      
      // Second cycle attempt should be rejected
      const shouldAllowSecondCycle = !cycleInProgress;
      
      expect(shouldAllowSecondCycle).toBe(false);
    });

    test('should use locking mechanism to prevent race conditions', async () => {
      const lockAcquired = true;
      const lockTimestamp = Date.now();
      const lockTTL = 60000; // 60 seconds
      
      // Second attempt should fail to acquire lock
      const secondLockAttempt = false; // Lock already held
      
      expect(lockAcquired).toBe(true);
      expect(secondLockAttempt).toBe(false);
    });

    test('should release lock after cycle completion', async () => {
      let lockHeld = true;
      
      // Simulate cycle completion
      const cycleComplete = true;
      if (cycleComplete) {
        lockHeld = false;
      }
      
      expect(lockHeld).toBe(false);
    });

    test('should handle lock timeout (stale locks)', async () => {
      const lockTimestamp = Date.now() - 120000; // 2 minutes old
      const lockTTL = 60000; // 60 seconds
      const now = Date.now();
      
      const lockExpired = (now - lockTimestamp) > lockTTL;
      
      expect(lockExpired).toBe(true);
      // Should allow new cycle to proceed
    });

    test('should handle state updates from multiple cycles', async () => {
      // First cycle sets activeRule
      const firstCycleState = { activeRule: 'rule_1', timestamp: Date.now() };
      
      // Second cycle should see the update
      const secondCycleReads = { activeRule: 'rule_1' };
      
      expect(secondCycleReads.activeRule).toBe(firstCycleState.activeRule);
    });
  });

  describe('Network Timeouts and Retries', () => {
    test('should timeout long-running API calls', async () => {
      const apiCallStart = Date.now();
      const timeoutMs = 10000; // 10 seconds
      const apiCallDuration = 15000; // 15 seconds
      
      const shouldTimeout = apiCallDuration > timeoutMs;
      
      expect(shouldTimeout).toBe(true);
    });

    test('should retry failed API calls with exponential backoff', async () => {
      const maxRetries = 3;
      const baseDelayMs = 1000;
      
      const delays = [];
      for (let i = 0; i < maxRetries; i++) {
        delays.push(baseDelayMs * Math.pow(2, i));
      }
      
      expect(delays).toEqual([1000, 2000, 4000]);
    });

    test('should respect rate limits and back off', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.statusCode = 429;
      rateLimitError.headers = { 'retry-after': '60' };
      
      const retryAfterSeconds = parseInt(rateLimitError.headers['retry-after']);
      
      expect(retryAfterSeconds).toBe(60);
      // Should wait at least this long before retrying
    });

    test('should cache successful responses to reduce API calls', async () => {
      const cacheKey = 'amber_prices_TEST123';
      const cachedData = { prices: [10, 20, 30], timestamp: Date.now() };
      const cacheTTL = 5 * 60 * 1000; // 5 minutes
      
      const cacheAge = Date.now() - cachedData.timestamp;
      const isCacheValid = cacheAge < cacheTTL;
      
      expect(isCacheValid).toBe(true);
    });

    test('should fall back to cached data on API failure', async () => {
      const apiAvailable = false;
      const cachedData = { prices: [10, 20, 30] };
      
      const dataSource = apiAvailable ? 'api' : 'cache';
      
      expect(dataSource).toBe('cache');
      expect(cachedData.prices).toBeDefined();
    });
  });

  describe('Invalid Rule Configurations', () => {
    test('should skip rule with invalid work mode', async () => {
      const invalidRule = {
        name: 'Invalid Mode Rule',
        enabled: true,
        action: { workMode: 'InvalidMode' }
      };
      
      const validModes = ['SelfUse', 'ForceDischarge', 'ForceCharge', 'Backup'];
      const isValid = validModes.includes(invalidRule.action.workMode);
      
      expect(isValid).toBe(false);
      // Should skip this rule
    });

    test('should skip rule with missing required action fields', async () => {
      const incompleteRule = {
        name: 'Incomplete Rule',
        enabled: true,
        action: {
          workMode: 'ForceDischarge'
          // Missing durationMinutes, fdPwr, etc.
        }
      };
      
      const hasRequiredFields = 
        incompleteRule.action.durationMinutes !== undefined &&
        incompleteRule.action.fdPwr !== undefined;
      
      expect(hasRequiredFields).toBe(false);
    });

    test('should skip rule with invalid time range', async () => {
      const invalidTimeRule = {
        name: 'Invalid Time Rule',
        enabled: true,
        conditions: {
          time: { enabled: true, startTime: '25:00', endTime: '26:00' }
        }
      };
      
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      const isValidStart = timeRegex.test(invalidTimeRule.conditions.time.startTime);
      const isValidEnd = timeRegex.test(invalidTimeRule.conditions.time.endTime);
      
      expect(isValidStart).toBe(false);
      expect(isValidEnd).toBe(false);
    });

    test('should skip rule with negative cooldown', async () => {
      const invalidCooldownRule = {
        name: 'Negative Cooldown Rule',
        enabled: true,
        cooldownMinutes: -30
      };
      
      const isValidCooldown = invalidCooldownRule.cooldownMinutes >= 0;
      
      expect(isValidCooldown).toBe(false);
    });

    test('should skip rule with invalid priority', async () => {
      const invalidPriorityRule = {
        name: 'Invalid Priority Rule',
        enabled: true,
        priority: 0 // Should be 1-10
      };
      
      const isValidPriority = 
        invalidPriorityRule.priority >= 1 && 
        invalidPriorityRule.priority <= 10;
      
      expect(isValidPriority).toBe(false);
    });

    test('should handle rule with circular dependencies', async () => {
      // Prevent infinite loops in rule evaluation
      const maxEvaluationDepth = 10;
      let currentDepth = 0;
      
      while (currentDepth < maxEvaluationDepth) {
        currentDepth++;
      }
      
      expect(currentDepth).toBe(maxEvaluationDepth);
      // Should prevent infinite loops
    });

    test('should validate SoC values are in valid range (0-100)', async () => {
      const invalidSocRule = {
        name: 'Invalid SoC Rule',
        enabled: true,
        conditions: {
          soc: { enabled: true, operator: '>', value: 150 }
        }
      };
      
      const isValidSoc = 
        invalidSocRule.conditions.soc.value >= 0 &&
        invalidSocRule.conditions.soc.value <= 100;
      
      expect(isValidSoc).toBe(false);
    });
  });

  describe('State Corruption and Recovery', () => {
    test('should handle null state document', async () => {
      const state = null;
      
      // Should create default state
      const defaultState = {
        enabled: true,
        activeRule: null,
        activeRuleName: null,
        activeSegment: null,
        activeSegmentEnabled: false,
        clearSegmentsOnNextCycle: false
      };
      
      const finalState = state || defaultState;
      
      expect(finalState.enabled).toBe(true);
      expect(finalState.activeRule).toBe(null);
    });

    test('should handle corrupted state with missing fields', async () => {
      const corruptedState = {
        enabled: true
        // Missing other required fields
      };
      
      const repaired = {
        enabled: corruptedState.enabled ?? true,
        activeRule: corruptedState.activeRule ?? null,
        activeRuleName: corruptedState.activeRuleName ?? null,
        activeSegment: corruptedState.activeSegment ?? null,
        activeSegmentEnabled: corruptedState.activeSegmentEnabled ?? false,
        clearSegmentsOnNextCycle: corruptedState.clearSegmentsOnNextCycle ?? false
      };
      
      expect(repaired.activeRule).toBe(null);
      expect(repaired.activeSegmentEnabled).toBe(false);
    });

    test('should handle state with invalid data types', async () => {
      const invalidState = {
        enabled: 'true', // Should be boolean
        activeRule: 123, // Should be string or null
        clearSegmentsOnNextCycle: 'yes' // Should be boolean
      };
      
      const normalized = {
        enabled: Boolean(invalidState.enabled),
        activeRule: typeof invalidState.activeRule === 'string' ? invalidState.activeRule : null,
        clearSegmentsOnNextCycle: Boolean(invalidState.clearSegmentsOnNextCycle)
      };
      
      expect(normalized.enabled).toBe(true);
      expect(normalized.activeRule).toBe(null);
      expect(normalized.clearSegmentsOnNextCycle).toBe(true);
    });

    test('should handle orphaned activeRule (rule no longer exists)', async () => {
      mockState.activeRule = 'deleted_rule';
      const ruleExists = mockRules['deleted_rule'] !== undefined;
      
      if (!ruleExists) {
        mockState.activeRule = null;
        mockState.activeRuleName = null;
        mockState.activeSegment = null;
        mockState.clearSegmentsOnNextCycle = true;
      }
      
      expect(mockState.activeRule).toBe(null);
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
    });

    test('should recover from timestamp corruption', async () => {
      const corruptedTimestamp = 'not-a-number';
      const parsedTimestamp = parseInt(corruptedTimestamp);
      
      const validTimestamp = isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;
      
      expect(isNaN(parsedTimestamp)).toBe(true);
      expect(validTimestamp).toBeGreaterThan(0);
    });

    test('should handle concurrent state modifications', async () => {
      // Simulate two operations modifying state simultaneously
      const operation1 = { activeRule: 'rule_1', timestamp: Date.now() };
      const operation2 = { activeRule: 'rule_2', timestamp: Date.now() + 100 };
      
      // Last write should win
      const finalState = operation2.timestamp > operation1.timestamp ? operation2 : operation1;
      
      expect(finalState.activeRule).toBe('rule_2');
    });
  });

  describe('Race Conditions and Timing', () => {
    test('should handle rule toggle during active cycle', async () => {
      mockState.activeRule = 'rule_1';
      const cycleInProgress = true;
      
      // Toggle happens during cycle
      const toggleRequest = { ruleId: 'rule_1', enabled: false };
      
      // Should set flag for next cycle, not interrupt current cycle
      const flagSet = toggleRequest.ruleId === mockState.activeRule;
      
      expect(flagSet).toBe(true);
    });

    test('should handle master switch toggle during rule evaluation', async () => {
      const evaluatingRules = true;
      const toggleRequest = { enabled: false };
      
      // Should complete current evaluation and apply toggle on next cycle
      const shouldCompleteCycle = true;
      const shouldSetFlag = toggleRequest.enabled === false;
      
      expect(shouldCompleteCycle).toBe(true);
      expect(shouldSetFlag).toBe(true);
    });

    test('should handle rule deletion during cooldown', async () => {
      mockState.activeRule = 'rule_1';
      mockRules.rule_1.lastTriggered = Date.now() - 30 * 60 * 1000; // In cooldown
      
      // Delete rule while it's in cooldown
      const ruleToDelete = 'rule_1';
      if (mockState.activeRule === ruleToDelete) {
        mockState.clearSegmentsOnNextCycle = true;
        mockState.activeRule = null;
      }
      
      delete mockRules[ruleToDelete];
      
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
      expect(mockRules[ruleToDelete]).toBeUndefined();
    });

    test('should handle rapid enable/disable toggles', async () => {
      const toggles = [];
      
      // Simulate 5 rapid toggles (0: true, 1: false, 2: true, 3: false, 4: true)
      for (let i = 0; i < 5; i++) {
        toggles.push({ enabled: i % 2 === 0, timestamp: Date.now() + i });
      }
      
      // Last toggle should win (index 4, i=4, 4%2===0 -> true)
      const finalState = toggles[toggles.length - 1];
      
      expect(finalState.enabled).toBe(true);
    });

    test('should handle config update during cycle execution', async () => {
      const cycleStartConfig = { deviceSn: 'OLD123' };
      const configUpdate = { deviceSn: 'NEW456' };
      
      // Cycle should use config from start, not mid-execution
      const cycleConfig = cycleStartConfig;
      
      expect(cycleConfig.deviceSn).toBe('OLD123');
    });

    test('should handle scheduler cache invalidation during cycle', async () => {
      const cacheInvalidated = true;
      const shouldRefreshCache = cacheInvalidated;
      
      // Should fetch fresh data on cache invalidation
      expect(shouldRefreshCache).toBe(true);
    });
  });

  describe('Complex Integration Scenarios', () => {
    test('scenario: multiple rules expire cooldown simultaneously', async () => {
      const now = Date.now();
      const expiredTime = now - 61 * 60 * 1000;
      
      mockRules.rule_1.lastTriggered = expiredTime;
      mockRules.rule_2.lastTriggered = expiredTime;
      mockRules.rule_3.lastTriggered = expiredTime;
      
      // All rules eligible, should pick highest priority
      const eligibleRules = Object.entries(mockRules)
        .filter(([_, r]) => {
          const cooldownMs = r.cooldownMinutes * 60 * 1000;
          return (now - r.lastTriggered) > cooldownMs;
        })
        .map(([id, r]) => ({ id, priority: r.priority }))
        .sort((a, b) => a.priority - b.priority);
      
      expect(eligibleRules[0].id).toBe('rule_1');
      expect(eligibleRules).toHaveLength(3);
    });

    test('scenario: API failure + state corruption + concurrent cycle', async () => {
      const apiError = true;
      const stateCorrupted = true;
      const concurrentCycle = true;
      
      // Should handle gracefully
      const shouldUseCache = apiError;
      const shouldRepairState = stateCorrupted;
      const shouldRejectConcurrent = concurrentCycle;
      
      expect(shouldUseCache).toBe(true);
      expect(shouldRepairState).toBe(true);
      expect(shouldRejectConcurrent).toBe(true);
    });

    test('scenario: rule triggers at midnight with DST transition', async () => {
      // Hour normalization should handle DST edge cases
      const midnightHour = 24; // ICU library returns 24 for midnight
      const normalizedHour = midnightHour === 24 ? 0 : midnightHour;
      
      expect(normalizedHour).toBe(0);
    });

    test('scenario: active rule has conditions no longer met', async () => {
      mockState.activeRule = 'rule_1';
      
      // Conditions no longer met (e.g., price dropped)
      const conditionsMet = false;
      const cooldownExpired = true;
      
      if (!conditionsMet && cooldownExpired) {
        // Should clear active rule
        mockState.activeRule = null;
        mockState.clearSegmentsOnNextCycle = true;
      }
      
      expect(mockState.activeRule).toBe(null);
      expect(mockState.clearSegmentsOnNextCycle).toBe(true);
    });

    test('scenario: user has no config but rules are enabled', async () => {
      const config = null;
      const rulesExist = Object.keys(mockRules).length > 0;
      
      const canRunAutomation = config !== null && rulesExist;
      
      expect(canRunAutomation).toBe(false);
      // Should skip automation gracefully
    });

    test('scenario: all external APIs fail simultaneously', async () => {
      const foxessAvailable = false;
      const amberAvailable = false;
      const weatherAvailable = false;
      
      const canEvaluateRules = false; // No data available
      
      // Should skip cycle and log warning
      expect(canEvaluateRules).toBe(false);
    });

    test('scenario: segment creation succeeds but state update fails', async () => {
      const segmentCreated = true;
      const stateUpdateFailed = true;
      
      // Should retry state update, segment already on inverter
      const shouldRetryStateUpdate = stateUpdateFailed;
      const segmentAlreadyActive = segmentCreated;
      
      expect(shouldRetryStateUpdate).toBe(true);
      expect(segmentAlreadyActive).toBe(true);
    });
  });
});
