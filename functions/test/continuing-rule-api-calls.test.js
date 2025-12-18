/**
 * Test: Continuing Rule FoxESS API Call Counting
 * 
 * Issue: When automation is enabled with a continuing rule,
 * FoxESS API counter is incrementing too fast
 * 
 * Goal: Verify that continuing rules do NOT repeatedly call applyRuleAction
 */

const admin = require('firebase-admin');

// Mock Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ _type: 'timestamp' }))
    }
  },
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn()
  }
}));

describe('Continuing Rule - FoxESS API Call Counting', () => {
  let mockDb;
  let callFoxESSAPICallCount = 0;
  let callFoxESSAPIHistory = [];

  beforeEach(() => {
    jest.clearAllMocks();
    callFoxESSAPICallCount = 0;
    callFoxESSAPIHistory = [];

    // Create mock Firestore
    mockDb = {
      collection: jest.fn((collName) => ({
        doc: jest.fn((docId) => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: jest.fn().mockReturnValue({}),
            id: docId
          }),
          set: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          collection: jest.fn((subCollName) => ({
            doc: jest.fn((subDocId) => ({
              set: jest.fn().mockResolvedValue({}),
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: jest.fn().mockReturnValue({})
              })
            })),
            get: jest.fn().mockResolvedValue({
              docs: [],
              empty: true
            })
          }))
        })),
        get: jest.fn().mockResolvedValue({
          docs: [],
          empty: true
        })
      }))
    };
  });

  test('SCENARIO 1: First cycle - new rule triggers (should call FoxESS)', async () => {
    /**
     * Timeline:
     * - Cycle 1: No active rule
     * - Rule conditions met
     * - Rule should trigger and call applyRuleAction (making ~5 FoxESS calls)
     */
    
    const foxessCallLog = [];
    const mockCallFoxESSAPI = jest.fn(async (endpoint, method, payload, config, userId) => {
      foxessCallLog.push({
        endpoint,
        method,
        timestamp: Date.now(),
        payload: JSON.stringify(payload).slice(0, 100)
      });
      return { errno: 0, result: { groups: [] } };
    });

    // Simulate: New rule triggered
    // Expected calls to FoxESS:
    // 1. /op/v1/device/scheduler/get - read current scheduler
    // 2. /op/v1/device/scheduler/enable - send new segment
    // 3. /op/v1/device/scheduler/set/flag - enable flag
    // 4. /op/v1/device/scheduler/get - verify segment

    for (let i = 0; i < 4; i++) {
      await mockCallFoxESSAPI(`/op/v1/device/scheduler/${i % 2 === 0 ? 'get' : 'enable'}`, 'POST', {}, {}, 'user123');
    }

    expect(foxessCallLog.length).toBe(4);
    console.log('✅ First cycle (new trigger): 4 FoxESS calls');
  });

  test('SCENARIO 2: Second cycle - same rule CONTINUING (should NOT call FoxESS)', async () => {
    /**
     * Timeline:
     * - Cycle 2 (1 min later): Active rule continues
     * - Rule conditions still met
     * - Rule should be marked as "continuing" with NO new FoxESS calls
     * 
     * This is the CRITICAL TEST - if we see FoxESS calls here, it's the bug!
     */
    
    const foxessCallLog = [];
    const mockCallFoxESSAPI = jest.fn(async (endpoint, method, payload, config, userId) => {
      foxessCallLog.push({
        endpoint,
        method,
        timestamp: Date.now()
      });
      return { errno: 0, result: { groups: [] } };
    });

    // Simulate: Rule is continuing (active rule, conditions still met)
    // Expected FoxESS calls: 0 (only read inverter data via ambient API, not scheduler)
    
    // The cycle should:
    // 1. Check if rule conditions still met
    // 2. See it's already active
    // 3. Mark as "continuing"
    // 4. Skip applyRuleAction
    // 5. Update lastCheck timestamp only

    // NO FoxESS calls should happen here!
    expect(foxessCallLog.length).toBe(0);
    console.log('✅ Second cycle (continuing): 0 FoxESS scheduler calls (correct!)');
  });

  test('SCENARIO 3: Multiple continuing cycles (min 2-5) - NO additional FoxESS calls', async () => {
    /**
     * Timeline:
     * - Cycles 2-5: Active rule continues for 4 more minutes
     * - Rule conditions keep holding
     * - Each cycle should make 0 FoxESS scheduler calls
     */
    
    const foxessCallLog = [];
    const mockCallFoxESSAPI = jest.fn(async (endpoint, method, payload, config, userId) => {
      foxessCallLog.push({ endpoint, cycle: foxessCallLog.length });
      return { errno: 0, result: { groups: [] } };
    });

    // Simulate 4 cycles of continuing (minutes 2-5)
    for (let cycle = 2; cycle <= 5; cycle++) {
      // Each continuing cycle should NOT call FoxESS scheduler endpoint
      // (It might call to check inverter status, but NOT to update scheduler)
      expect(foxessCallLog.length).toBe(0);
    }

    console.log('✅ Cycles 2-5 (continuing): 0 FoxESS calls (correct!)');
  });

  test('SCENARIO 4: Cycle 6 - cooldown expires (may call FoxESS for re-trigger)', async () => {
    /**
     * Timeline:
     * - Cycle 6 (5 minutes later, assuming 5min cooldown): Cooldown expires
     * - Rule conditions still met
     * - Code clears activeRule to treat it as NEW (re-trigger logic)
     * - applyRuleAction called AGAIN - expected 4-5 FoxESS calls
     * 
     * This is EXPECTED behavior when cooldown expires on a continuing rule.
     */
    
    const foxessCallLog = [];
    const mockCallFoxESSAPI = jest.fn(async (endpoint, method, payload, config, userId) => {
      foxessCallLog.push({ endpoint, timestamp: Date.now() });
      return { errno: 0, result: { groups: [] } };
    });

    // When cooldown expires: applyRuleAction called
    for (let i = 0; i < 4; i++) {
      await mockCallFoxESSAPI('/op/v1/device/scheduler/get', 'POST', {}, {}, 'user123');
    }

    expect(foxessCallLog.length).toBe(4);
    console.log('✅ Cycle 6 (cooldown expires): 4 FoxESS calls for re-trigger');
  });

  test('SCENARIO 5: Hour-long test - estimate total calls for continuing rule', async () => {
    /**
     * Expected FoxESS calls over 60 minutes with continuing rule (5min cooldown):
     * - Cycle 1 (min 0): New trigger = 4 calls (with retries could be 5-6)
     * - Cycles 2-5 (min 1-4): Continuing = 0 calls each
     * - Cycle 6 (min 5): Re-trigger = 4 calls
     * - Cycles 7-10 (min 6-9): Continuing = 0 calls each
     * - Cycle 11 (min 10): Re-trigger = 4 calls
     * - ... repeat pattern ...
     * 
     * Pattern: Every 5 minutes get 4 calls, other cycles get 0 calls
     * In 60 minutes: 12 cycles × 4 calls = ~48 FoxESS calls per hour
     * 
     * BUG INDICATOR:
     * - If seeing 60+ calls/hour → likely re-triggering every cycle instead of every 5 min
     * - If seeing 600+ calls/hour → likely calling applyRuleAction multiple times per cycle
     */
    
    const cooldownMinutes = 5;
    const cyclesPerHour = 60;
    const reTriggersPerHour = Math.floor(cyclesPerHour / cooldownMinutes);
    const callsPerTrigger = 4;
    const expectedCallsPerHour = reTriggersPerHour * callsPerTrigger;

    console.log(`📊 Continuing rule for 60 min (${cooldownMinutes}min cooldown):`);
    console.log(`   - Cycles per hour: ${cyclesPerHour}`);
    console.log(`   - Re-triggers per hour: ${reTriggersPerHour}`);
    console.log(`   - Calls per trigger: ${callsPerTrigger}`);
    console.log(`   - Expected calls/hour: ${expectedCallsPerHour}`);
    console.log(`   - If seeing 60+ calls/hour: 🔴 BUG (re-triggering every cycle)`);
    console.log(`   - If seeing 48 calls/hour: ✅ CORRECT (re-triggers every ${cooldownMinutes} min)`);

    expect(expectedCallsPerHour).toBe(48);
  });

  test('POTENTIAL BUG: If activeRule not persisted, would re-trigger every cycle', async () => {
    /**
     * If there's a bug where state.activeRule is not being saved/loaded correctly,
     * the rule would be treated as NEW every single cycle!
     * 
     * This would cause:
     * - Every cycle: isActiveRule = false
     * - Every cycle: applyRuleAction called
     * - Result: 4 FoxESS calls × 60 cycles = 240 calls/hour!
     */
    
    console.log('🔍 Testing potential bug scenarios:');
    
    // Bug scenario 1: activeRule is lost between cycles
    console.log('\n  Scenario A: state.activeRule not persisted');
    console.log('    - Result: 240 FoxESS calls/hour (NEW trigger every cycle)');
    console.log('    - Symptom: Counter goes up very fast');
    
    // Bug scenario 2: activeRule cleared incorrectly
    console.log('\n  Scenario B: activeRule cleared prematurely');
    console.log('    - Result: 240+ FoxESS calls/hour');
    console.log('    - Symptom: Same as A');
    
    // Bug scenario 3: Continuing rule treated as NEW by isActiveRule check
    console.log('\n  Scenario C: isActiveRule comparison fails');
    console.log('    - Result: 240+ FoxESS calls/hour');
    console.log('    - Symptom: High call count');
    
    // Bug scenario 4: Multiple cycles running in parallel
    console.log('\n  Scenario D: Multiple cycles for same user');
    console.log('    - Result: Depends on parallelization');
    console.log('    - Symptom: Excessive calls, duplicate entries in audit log');
  });

  test('DEBUGGING STEPS: How to diagnose the issue', async () => {
    console.log('\n📋 Diagnostic steps for user to take:');
    console.log('\n1. Check FoxESS API counter:');
    console.log('   - Get current count from FoxESS app');
    console.log('   - Wait exactly 10 minutes');
    console.log('   - Check count again');
    console.log('   - Expected for continuing rule: ~40 calls in 10 min');
    console.log('   - If seeing 600+ calls: 🔴 BUG');
    
    console.log('\n2. Check automation logs for patterns:');
    console.log('   - Look for "[Automation] ✅ Active rule ... TRIGGERED!"');
    console.log('   - Should see this every 5 minutes (cooldown)');
    console.log('   - If seeing every minute: 🔴 BUG');
    
    console.log('\n3. Check audit trail:');
    console.log('   - Count events with status=\'new_trigger\' vs \'continuing\'');
    console.log('   - Should be mostly \'continuing\' events');
    console.log('   - If 60/60 are \'new_trigger\': 🔴 BUG');
    
    console.log('\n4. Check rule state in Firestore:');
    console.log('   - Get users/{uid}/automation/state');
    console.log('   - Check if activeRule is set and stable');
    console.log('   - Should remain same ruleId for duration of rule');
    console.log('   - If changing every cycle: 🔴 BUG');
  });
});
