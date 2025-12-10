# Resilience Improvements - Implementation Guide

## Quick Win: Add Verification Enforcement (30 mins)

**Current behavior**: Segment apply reports success even if verification fails

**Fix**: Make verification result mandatory for success decision

```javascript
// REPLACE: Lines 3870-3900 in functions/index.js

// Wait for FoxESS to process
console.log(`[Automation] ⏳ Waiting 3s for FoxESS to process...`);
await new Promise(resolve => setTimeout(resolve, 3000));

// Verification read - NOW CRITICAL
let verify = null;
let verifySuccess = false;
let verifyAttempt = 0;

while (verifyAttempt < 3 && !verifySuccess) {
  verifyAttempt++;
  try {
    verify = await callFoxESSAPI('/op/v1/device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
    if (verify?.errno === 0 && verify?.result?.groups?.[0]) {
      const appliedSegment = verify.result.groups[0];
      
      // Verify the segment matches what we sent
      if (appliedSegment.enable === 1 &&
          appliedSegment.startHour === segment.startHour &&
          appliedSegment.startMinute === segment.startMinute &&
          appliedSegment.endHour === segment.endHour &&
          appliedSegment.endMinute === segment.endMinute) {
        console.log(`[Automation] ✓✓ Segment VERIFIED on device - exact match`);
        verifySuccess = true;
      } else {
        // Mismatch - device has different segment
        console.error(`[Automation] ❌ Segment mismatch! Sent: ${segment.startHour}:${segment.startMinute} but device has: ${appliedSegment.startHour}:${appliedSegment.startMinute}`);
        if (verifyAttempt < 3) {
          console.log(`[Automation] Verification attempt ${verifyAttempt}/3 - retrying...`);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    } else {
      console.warn(`[Automation] Verification read attempt ${verifyAttempt} failed: errno=${verify?.errno}`);
      if (verifyAttempt < 3) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (verifyErr) {
    console.warn(`[Automation] Verification error attempt ${verifyAttempt}:`, verifyErr.message);
    if (verifyAttempt < 3) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// Return failure if verification didn't succeed
if (!verifySuccess) {
  console.error(`[Automation] ❌ Verification failed after 3 attempts - SEGMENT NOT CONFIRMED`);
  return {
    errno: -1,
    msg: 'Segment verification failed - not confirmed on device',
    segment,
    verify,
    retrysFailed: true
  };
}

// Only log to history if verification succeeded
try {
  await addHistoryEntry(userId, {
    type: 'automation_action',
    ruleName: rule.name,
    action,
    segment,
    result: 'success',
    verified: true,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
} catch (e) {
  console.warn('[Automation] Failed to log history:', e && e.message ? e.message : e);
}

return {
  errno: 0,
  msg: 'Segment successfully applied and verified',
  segment,
  flagResult,
  verify: verify?.result || null,
  verified: true
};
```

---

## Quick Win: Fix Segment Duplication Risk (45 mins)

**Current behavior**: If segment clear fails when active rule cancels, state is cleared but segment stays on device

**Risk**: Next cycle thinks no segment active, creates new one → duplication

**Fix**: Keep active rule state if clear fails, retry next cycle

```javascript
// REPLACE: Lines 2104-2180 in functions/index.js

// Active rule's conditions NO LONGER hold - need to cancel segment
if (isActiveRule) {
  console.log(`[Automation] Active rule '${rule.name}' conditions NO LONGER MET - canceling segment`);
  let segmentClearSuccess = false;
  let clearError = null;
  
  try {
    const deviceSN = userConfig?.deviceSn;
    if (deviceSN) {
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
      
      // Retry logic for clearing segments (up to 3 attempts)
      let clearAttempt = 0;
      let clearResult = null;
      while (clearAttempt < 3 && !segmentClearSuccess) {
        clearAttempt++;
        console.log(`[Automation] Segment clear attempt ${clearAttempt}/3...`);
        clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, userConfig, userId);
        
        if (clearResult?.errno === 0) {
          console.log(`[Automation] ✓ Cleared all scheduler segments (attempt ${clearAttempt})`);
          segmentClearSuccess = true;
        } else {
          clearError = clearResult?.msg || `errno ${clearResult?.errno}`;
          console.warn(`[Automation] Segment clear attempt ${clearAttempt} failed: ${clearError}`);
          if (clearAttempt < 3) {
            console.log(`[Automation] ⏳ Waiting 1.2s before retry...`);
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        }
      }
      
      if (!segmentClearSuccess) {
        // ❌ CRITICAL: Clear failed - keep activeRule set so next cycle knows segment is stuck
        console.error(`[Automation] ❌ Failed to clear segments after 3 attempts`);
        
        // Update state to track clear failure
        const clearAttemptCount = (state.clearFailureAttempts || 0) + 1;
        await saveUserAutomationState(userId, {
          lastCheck: Date.now(),
          // KEEP activeRule set - don't clear it!
          clearFailureAttempts: clearAttemptCount,
          lastClearError: clearError,
          lastClearErrorTime: Date.now()
        });
        
        // Alert user after multiple failures
        if (clearAttemptCount >= 5) {
          console.error(`[CRITICAL] Segment stuck on device for 5+ cycles - alerting user`);
          try {
            await addHistoryEntry(userId, {
              type: 'alert',
              severity: 'critical',
              message: `Failed to clear automation segment after ${clearAttemptCount} attempts. Manual intervention may be needed.`,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (e) {
            console.warn('Failed to add alert history:', e.message);
          }
        }
        
        // Abort replacement rule evaluation
        console.log(`[Automation] 🛑 Aborting replacement rule evaluation due to segment clear failure`);
        break;
      }
      
      // Clear succeeded - wait for inverter to process
      console.log(`[Automation] ⏳ Waiting 2.5s for inverter to process segment clearing...`);
      await new Promise(resolve => setTimeout(resolve, 2500));
      console.log(`[Automation] ✓ Inverter processing delay complete, ready to evaluate replacement rules`);
    }
    
    // Only if clear was successful: clear lastTriggered to allow re-trigger
    if (segmentClearSuccess) {
      await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
        lastTriggered: null
      }, { merge: true });
      console.log(`[Automation] Rule '${ruleId}' canceled - cooldown reset, can re-trigger if conditions met`);
    }
  } catch (cancelError) {
    console.error(`[Automation] Unexpected error during cancellation:`, cancelError.message);
    // Keep state consistent - don't clear activeRule
    await saveUserAutomationState(userId, {
      lastCheck: Date.now(),
      clearError: cancelError.message
    });
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
      activeSegmentEnabled: false,
      clearFailureAttempts: 0, // Reset counter
      lastClearError: null
    });
    // Continue to check if any other rule can trigger
    console.log(`[Automation] 🔄 Continuing rule evaluation after successful cancellation...`);
    cancelledRuleThisCycle = true;
    continue;
  } else {
    // Failed to clear - don't evaluate replacement rules
    console.log(`[Automation] 🛑 Skipping replacement rule evaluation due to segment clear failure`);
    break;
  }
}
```

---

## Medium Effort: Add Intelligent Retry with Backoff (1 hour)

**Create new file**: `functions/retry-utils.js`

```javascript
/**
 * Retry strategy with exponential backoff
 */
class RetryStrategy {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelayMs = options.initialDelayMs || 500;
    this.maxDelayMs = options.maxDelayMs || 10000;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.jitterFactor = options.jitterFactor || 0.1; // 10% random jitter
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  calculateDelay(attemptNumber) {
    const exponentialDelay = this.initialDelayMs * Math.pow(this.backoffMultiplier, attemptNumber - 1);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitter = cappedDelay * this.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(100, cappedDelay + jitter); // Never below 100ms
  }

  /**
   * Execute function with automatic retry
   */
  async execute(fn, context = '') {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await fn();
        if (attempt > 1) {
          console.log(`[Retry] ${context} succeeded on attempt ${attempt}`);
        }
        return { success: true, result, attempts: attempt };
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          console.warn(
            `[Retry] ${context} attempt ${attempt} failed (${error.message}), ` +
            `retrying in ${Math.round(delay)}ms...`
          );
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    console.error(`[Retry] ${context} failed after ${this.maxRetries} attempts: ${lastError.message}`);
    return { success: false, error: lastError, attempts: this.maxRetries };
  }
}

/**
 * Presets for common scenarios
 */
const RETRY_PRESETS = {
  // For API calls (e.g., FoxESS, Amber)
  api: new RetryStrategy({
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000
  }),
  
  // For inverter operations (might be slow)
  inverter: new RetryStrategy({
    maxRetries: 4,
    initialDelayMs: 1500,
    maxDelayMs: 15000
  }),
  
  // For database operations (usually fast)
  database: new RetryStrategy({
    maxRetries: 2,
    initialDelayMs: 500,
    maxDelayMs: 5000
  }),
  
  // Aggressive for critical operations
  critical: new RetryStrategy({
    maxRetries: 5,
    initialDelayMs: 2000,
    maxDelayMs: 30000
  })
};

module.exports = { RetryStrategy, RETRY_PRESETS };
```

**Usage in functions/index.js**:

```javascript
const { RETRY_PRESETS } = require('./retry-utils');

// Replace inline retries with:

// Example 1: Fetch inverter data
const inverterFetch = async () => {
  return await getCachedInverterData(userId, deviceSN, userConfig, false);
};
const { success, result: inverterData, attempts } = 
  await RETRY_PRESETS.api.execute(inverterFetch, 'Inverter data fetch');

if (!success) {
  console.warn(`[Automation] Inverter data unavailable after ${attempts} attempts`);
  inverterData = null; // Use null, evaluate rules without inverter data
}

// Example 2: Apply segment with more aggressive retry
const segmentApply = async () => {
  return await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', 
    { deviceSN, groups: currentGroups }, userConfig, userId);
};
const { success: applySuccess, result: applyResult } = 
  await RETRY_PRESETS.critical.execute(segmentApply, 'Segment apply');

if (!applySuccess) {
  console.error(`Failed to apply segment - giving up`);
  return { errno: -1, msg: 'Segment apply failed after retries' };
}
```

---

## Medium Effort: Add Circuit Breaker (1 hour)

**Create new file**: `functions/circuit-breaker.js`

```javascript
/**
 * Circuit breaker pattern for external API calls
 * Prevents cascading failures when APIs are down
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'unnamed';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 60000; // 1 minute
    
    this.state = 'closed'; // closed | open | half-open
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
  }

  /**
   * Record success
   */
  recordSuccess() {
    console.log(`[CircuitBreaker] ${this.name}: Success recorded`);
    
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.close();
      }
    }
  }

  /**
   * Record failure
   */
  recordFailure(error) {
    console.warn(`[CircuitBreaker] ${this.name}: Failure recorded - ${error.message}`);
    
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'closed' && this.failureCount >= this.failureThreshold) {
      this.open();
    } else if (this.state === 'half-open') {
      // Failure in half-open state opens circuit again
      this.open();
    }
  }

  /**
   * Check if call should be allowed
   */
  canExecute() {
    if (this.state === 'closed') {
      return true;
    }
    
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.resetTimeoutMs) {
        this.halfOpen();
        return true;
      }
      return false; // Fail fast
    }
    
    if (this.state === 'half-open') {
      return true; // Allow probe request
    }
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute(fn, fallback = null) {
    if (!this.canExecute()) {
      console.warn(`[CircuitBreaker] ${this.name}: Circuit is ${this.state}`);
      if (fallback !== null) {
        console.log(`[CircuitBreaker] ${this.name}: Using fallback`);
        return fallback;
      }
      throw new Error(`Circuit breaker ${this.name} is ${this.state}`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  close() {
    console.log(`[CircuitBreaker] ${this.name}: CLOSED (operational)`);
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChange = Date.now();
  }

  open() {
    console.error(`[CircuitBreaker] ${this.name}: OPEN (failing fast for ${this.resetTimeoutMs}ms)`);
    this.state = 'open';
    this.successCount = 0;
    this.lastStateChange = Date.now();
  }

  halfOpen() {
    console.log(`[CircuitBreaker] ${this.name}: HALF-OPEN (probing...)`);
    this.state = 'half-open';
    this.successCount = 0;
    this.failureCount = 0;
    this.lastStateChange = Date.now();
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failureCount,
      uptime: Date.now() - this.lastStateChange
    };
  }
}

// Create circuit breakers for each external API
const circuitBreakers = {
  amber: new CircuitBreaker({
    name: 'Amber Prices API',
    failureThreshold: 3,
    resetTimeoutMs: 5 * 60 * 1000 // 5 min
  }),
  
  foxess: new CircuitBreaker({
    name: 'FoxESS API',
    failureThreshold: 4,
    resetTimeoutMs: 10 * 60 * 1000 // 10 min
  }),
  
  weather: new CircuitBreaker({
    name: 'Weather API',
    failureThreshold: 2,
    resetTimeoutMs: 3 * 60 * 1000 // 3 min
  })
};

module.exports = { CircuitBreaker, circuitBreakers };
```

**Usage in functions/index.js**:

```javascript
const { circuitBreakers } = require('./circuit-breaker');

// Before Amber fetch
try {
  amberData = await circuitBreakers.amber.execute(
    () => callAmberAPI(`/sites/${siteId}/prices/current`, { next: 288 }, userConfig),
    null // No fallback - just skip if circuit open
  );
} catch (e) {
  console.warn('[Automation] Amber fetch failed:', e.message);
  amberData = null;
}

// Check circuit status (could show in UI)
const breakers = [
  circuitBreakers.amber.getStatus(),
  circuitBreakers.foxess.getStatus(),
  circuitBreakers.weather.getStatus()
];
console.log('[Automation] Circuit breakers:', breakers);
```

---

## Quick Reference: Error Handling Patterns

### Pattern 1: Retry with Fallback
```javascript
const result = await RETRY_PRESETS.api.execute(
  () => fetchData(),
  defaultData // Fallback value if all retries fail
);
```

### Pattern 2: Circuit Breaker with Feature Flag
```javascript
try {
  data = await circuitBreakers.amber.execute(() => fetchAmber());
  enableAmberRules = true;
} catch (e) {
  enableAmberRules = false; // Disable Amber-dependent rules
}

// Later:
if (enableAmberRules && rule.conditions.price?.enabled) {
  // Evaluate price rule
} else if (!enableAmberRules && rule.conditions.price?.enabled) {
  console.log('Skipping price rule - Amber API unavailable');
}
```

### Pattern 3: Alert on Repeated Failures
```javascript
if (state.clearFailureAttempts >= 5) {
  await addHistoryEntry(userId, {
    type: 'alert',
    severity: 'critical',
    message: 'Automation segment may be stuck on inverter'
  });
}
```

### Pattern 4: Atomic Firestore Updates
```javascript
await db.runTransaction(async (transaction) => {
  // Update multiple documents atomically
  transaction.set(stateRef, newState, { merge: true });
  transaction.set(ruleRef, { lastTriggered }, { merge: true });
});
```

---

## Testing Resilience Improvements

```javascript
// Test 1: Amber API circuit breaker
// Mock Amber to fail 3 times
// Expected: Circuit opens, rules skip Amber conditions
// Verify: No price-based rules trigger

// Test 2: Verification failure
// Mock scheduler/get to return different startTime
// Expected: Segment apply fails, returns errno != 0
// Verify: State doesn't update, retry next cycle

// Test 3: Clear failure retry
// Mock scheduler/enable to fail twice then succeed
// Expected: Exponential backoff applied (1s, 2s, then success)
// Verify: Segment cleared, state updated

// Test 4: State inconsistency recovery
// Start with segment on device but activeRule=null in state
// Expected: Cycle detects no active rule, creates new one
// Risk: Would cause duplication - but with verification, this is caught

// Test 5: Firestore write timeout
// Mock database to timeout
// Expected: Cycle logs error, doesn't proceed
// Verify: Next cycle retries same action
```
