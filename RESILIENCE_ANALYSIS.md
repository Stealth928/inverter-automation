# End-to-End Resilience Analysis: Automation Cycle

## Executive Summary

The automation system has **decent baseline resilience** for happy paths but **several critical gaps** in unhappy path handling and edge cases. The main issues are:

1. **Cascading failures** - Errors in data fetching can leave inverter in inconsistent states
2. **Missing error boundaries** - No fallback when external APIs fail mid-cycle
3. **Unreliable state recovery** - Failures updating Firestore aren't caught, leaving stale state
4. **API retry limits** - Only 1-3 retries; no exponential backoff or circuit breaker
5. **Silent failures** - Some error paths don't notify user or prevent next cycle from attempting same action

---

## Critical Paths & Error Handling Analysis

### Path 1: Get Live Data (Inverter + Amber Prices)

**Code Location**: Lines 1760-1810 (automation cycle)

```javascript
// Inverter data fetch
if (deviceSN) {
  try {
    inverterData = await getCachedInverterData(userId, deviceSN, userConfig, false);
  } catch (e) {
    console.warn('[Automation] Failed to get inverter data:', e.message);
  }
}

// Amber prices fetch
if (userConfig?.amberApiKey) {
  try {
    // ... fetch logic ...
  } catch (e) {
    console.warn('[Automation] Failed to get Amber data:', e.message);
  }
}
```

**Issues**:
- ❌ **Silent failures** - Errors just logged, inverterData/amberData stay null
- ❌ **No retry logic** - Single attempt, then proceeds with null data
- ❌ **Unreliable evaluation** - Rules evaluated with missing data, may produce false negatives
- ❌ **No fallback data** - Could fall back to previous cycle's cached values
- ⚠️ **Partial data** - If Amber fails but Amber-dependent rule exists, rule evaluates as "not met" (might be safe or might cause wrong behavior)

**Risk**: If Amber API is down for 30+ minutes, all price-based rules stop triggering even though user depends on them.

**Recommended Fixes**:
```javascript
// Option 1: Retry with exponential backoff
async function fetchWithRetry(fn, maxRetries = 3, backoffMs = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      const delay = backoffMs * Math.pow(2, attempt);
      console.warn(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Option 2: Fall back to previous values from state
const amberData = await fetchAmber().catch(async e => {
  console.warn('[Automation] Amber fetch failed, using cached values from state');
  const state = await getUserAutomationState(userId);
  return state.lastAmberData || null; // Could have stale but valid prices
});
```

---

### Path 2: Rule Evaluation with Unreliable Data

**Code Location**: Lines 3118-3500 (evaluateRule function)

**Issues**:
- ❌ **Null data handling** - When weather/inverter/amber data is null, conditions silently evaluate as "not_met"
  - `if (soc !== null)` → if null, just logs and moves on
  - No distinction between "condition failed" vs "data unavailable"

- ❌ **Weather data incomplete** - Open-Meteo timeout or missing hours treated same as "check failed"
  - Line 3343: `if (radiationValues.length > 0)` - but what if only 2 of 12 hours retrieved?
  - Current code warns about incomplete data but still evaluates against threshold with partial data

- ❌ **Edge case: Floating point NaN** - Not guarded against
  ```javascript
  const actualValue = radiationValues.reduce((a, b) => a + b, 0) / radiationValues.length;
  // If radiationValues is empty or contains NaN → actualValue is NaN
  // compareValue() then does: NaN > 200 → false (but should be "no data")
  ```

- ❌ **Price comparison edge cases** - No validation of comparison logic
  ```javascript
  const met = compareValue(actualPrice, operator, value);
  // But compareValue() function not shown - could have bugs
  ```

**Risk**: Rules may trigger or not trigger incorrectly when external data is partial/corrupted.

**Recommended Fixes**:
```javascript
// Distinguish between "condition failed" vs "data unavailable"
const evaluateCondition = (value, operator, threshold) => {
  if (value === null || value === undefined || isNaN(value)) {
    return { met: null, reason: 'no_data' }; // Different from false
  }
  return { met: compareValue(value, operator, threshold), reason: 'evaluated' };
};

// In cycle, handle "no_data" state
const condResults = evaluateRule(...);
const hasNoData = condResults.some(c => c.met === null);
if (hasNoData) {
  console.warn('Rule evaluation incomplete - retrying next cycle');
  // Don't make decisions based on incomplete info
  continue;
}
```

---

### Path 3: Segment Application (Most Critical)

**Code Location**: Lines 3762-3900 (applyRuleAction)

**Retry Logic**: Has retry on segment send (3x) and flag set (2x) ✅

**Issues**:
- ⚠️ **Partial failure handling** - Segment sent but flag set fails
  ```javascript
  const result = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups });
  // ✅ Retries 3x if fails
  
  let flagResult = await callFoxESSAPI('/op/v1/device/scheduler/set/flag', 'POST', { deviceSN, enable: 1 });
  // ✅ Retries 2x if fails
  
  // But if segment succeeds and flag fails:
  // - Segment is active on inverter (will execute)
  // - But FoxESS app won't show it (confusing for user)
  // - Next automation cycle may not detect it properly
  ```

- ⚠️ **Verification read race condition** - Waits only 3 seconds
  ```javascript
  await new Promise(resolve => setTimeout(resolve, 3000)); // Fixed 3s wait
  const verify = await callFoxESSAPI('/op/v1/device/scheduler/get', ...);
  
  // FoxESS might still be processing after 3s on high load
  // Verification read might return stale data
  // Could incorrectly report success when device is still updating
  ```

- ⚠️ **Verification failure not critical** - If verify fails, still returns success
  ```javascript
  if (verify?.result?.groups?.[0]) {
    if (verify.result.groups[0].enable === 1) {
      console.log(`✓ Segment CONFIRMED`); // Logged but not required
    }
  }
  return { errno: 0, ... }; // Returns success even if verify failed
  ```

- ❌ **No rollback on verification failure** - If verify shows segment wasn't applied
  - Should retry or alert user
  - Currently just logs and continues

**Risk**: Inverter could have stale/incorrect segment active while system thinks it was applied successfully.

**Recommended Fixes**:
```javascript
// Add verification-based decision logic
let verifyAttempt = 0;
let verifySuccess = false;
while (verifyAttempt < 2) {
  verifyAttempt++;
  const verify = await callFoxESSAPI('.../device/scheduler/get', 'POST', { deviceSN }, userConfig, userId);
  
  if (verify?.result?.groups?.[0]?.enable === 1) {
    const applied = verify.result.groups[0];
    if (applied.startHour === segment.startHour && applied.startMinute === segment.startMinute) {
      verifySuccess = true; // Exact match
      break;
    } else {
      console.error('❌ Verification mismatch - device has different segment than sent');
      // Return failure if verify shows wrong segment
      return { errno: -1, msg: 'Segment mismatch after apply', ...};
    }
  }
  if (verifyAttempt < 2) await new Promise(r => setTimeout(r, 2000));
}

if (!verifySuccess && applyAttempt < 3) {
  console.warn('Verification failed - retrying entire segment apply');
  applyAttempt = 0; // Reset to retry from scratch
  continue; // Retry send + verify cycle
}
```

---

### Path 4: Active Rule Cancellation (When Conditions Fail)

**Code Location**: Lines 2104-2180 (when active rule's conditions NO LONGER hold)

```javascript
// Retry logic for clearing segments (up to 3 attempts)
let clearAttempt = 0;
let clearResult = null;
while (clearAttempt < 3 && !segmentClearSuccess) {
  clearAttempt++;
  clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { deviceSN, groups: clearedGroups }, ...);
  
  if (clearResult?.errno === 0) {
    segmentClearSuccess = true;
  } else {
    console.warn(`Segment clear attempt ${clearAttempt} failed: errno=${clearResult?.errno}`);
    if (clearAttempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
  }
}

if (!segmentClearSuccess) {
  console.error(`Failed to clear segments after 3 attempts - aborting replacement rule evaluation for safety`);
  break; // ⚠️ STOPS evaluation
}
```

**Issues**:
- ✅ **Good**: Retries clearing with backoff (3x, 1.2s delay)
- ✅ **Good**: Fails safe - if can't clear, stops evaluating (prevents overlap)
- ⚠️ **Issue**: But what happens next cycle?
  - Active rule state is cleared from Firestore (line 2167: `activeRule: null`)
  - Inverter still has old segment active (clear failed)
  - Next cycle: No active rule in state, evaluates all rules fresh
  - If conditions still met, could try to apply to a different group (now 2 segments active!)
  - Or if conditions failed, tries to clear again (same failure loop)

**Risk**: **Segment duplication** - Old segment remains, new segment created, inverter has both active

**Recommended Fixes**:
```javascript
// Don't clear automation state if segment clear failed
if (!segmentClearSuccess) {
  console.error('Failed to clear segments - keeping rule as active to retry next cycle');
  // Keep state.activeRule set so next cycle knows segment is still there
  // Mark attempt count in state
  await saveUserAutomationState(userId, {
    clearAttempts: (state.clearAttempts || 0) + 1,
    lastClearError: clearResult?.msg
  });
  
  // If too many attempts, alert user
  if ((state.clearAttempts || 0) > 5) {
    console.error('Failed to clear segment after 5 cycles - segment may be stuck on inverter');
    await sendAlertToUser(userId, 'CRITICAL: Unable to clear automation segment - manual intervention needed');
  }
  break;
}
```

---

### Path 5: Firestore State Updates

**Code Location**: Scattered through automation cycle

```javascript
// Example 1: Clearing rule lastTriggered
await db.collection('users').doc(userId).collection('rules').doc(ruleId).set({
  lastTriggered: null
}, { merge: true });

// Example 2: Saving automation state
await saveUserAutomationState(userId, { 
  lastCheck: Date.now(), 
  activeRule: null,
  ...
});
```

**Issues**:
- ❌ **Fire-and-forget** - No error handling for database writes
  ```javascript
  await saveUserAutomationState(...); // Can throw, but not caught
  ```

- ❌ **Transaction not used** - Multiple writes not atomic
  - Update rule lastTriggered
  - Update automation state activeRule
  - If second fails, rule state inconsistent

- ❌ **No verification** - Written data not verified
  - Assumes write succeeded
  - Network partition could silently lose write

- ⚠️ **Timing issue** - State updated after API call but before verification
  ```javascript
  const result = await callFoxESSAPI(...); // Segment sent
  await saveUserAutomationState({ activeRule: ruleId }); // State updated
  const verify = await callFoxESSAPI(...); // Verification read
  
  // If verify fails, state says segment is active but it's not
  ```

**Risk**: Automation state in Firestore doesn't match inverter state → next cycle confused.

**Recommended Fixes**:
```javascript
try {
  // Use transaction for consistency
  await db.runTransaction(async (transaction) => {
    // Update automation state
    const stateRef = db.collection('users').doc(userId).collection('state').doc('automation');
    transaction.set(stateRef, newState, { merge: true });
    
    // Update rule's lastTriggered
    if (ruleId) {
      const ruleRef = db.collection('users').doc(userId).collection('rules').doc(ruleId);
      transaction.set(ruleRef, { lastTriggered: newValue }, { merge: true });
    }
  });
  
  console.log('✓ State updated atomically');
} catch (err) {
  console.error('❌ State update FAILED - not continuing with cycle');
  throw err; // Escalate - don't proceed with partial state
}
```

---

## Key Gaps & Missing Resilience Features

### 1. No Circuit Breaker Pattern
**Problem**: If Amber API is down, cycles keep trying every minute, logging thousands of errors

**Gap**: No way to temporarily disable a data source or rule

**Should Have**:
```javascript
const circuitBreakerState = {
  amberFailCount: 0,
  amberLastFailTime: null,
  amberOpen: false // Circuit is "open" when too many failures
};

// Before fetching Amber
if (circuitBreakerState.amberOpen) {
  const timeSinceLastFail = Date.now() - circuitBreakerState.amberLastFailTime;
  if (timeSinceLastFail < 5 * 60 * 1000) { // 5 minute timeout
    console.log('[Circuit Breaker] Amber API circuit open, skipping fetch');
    // Skip Amber-dependent rules
  }
}
```

### 2. No Exponential Backoff
**Problem**: Fixed 1.2s delays between retries - no accommodation for network recovery time

**Gap**: FoxESS taking 30s to recover gets hammered with requests every 1.2s

**Should Have**:
```javascript
const backoffStrategy = {
  initialDelay: 500,
  maxDelay: 30000,
  multiplier: 2
};

let delay = backoffStrategy.initialDelay;
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    return await operation();
  } catch (e) {
    if (attempt < maxRetries - 1) {
      console.log(`Waiting ${delay}ms before retry...`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * backoffStrategy.multiplier, backoffStrategy.maxDelay);
    }
  }
}
```

### 3. No Timeout on Firestore Operations
**Problem**: Database write hangs forever (network partition), cycle blocks indefinitely

**Gap**: Firebase operations can timeout but code doesn't set one

**Should Have**:
```javascript
async function saveWithTimeout(ref, data, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await ref.set(data, { merge: true });
    clearTimeout(timeout);
    return result;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new Error(`Database write timeout after ${timeoutMs}ms`);
    }
    throw e;
  }
}
```

### 4. No User Notification of Critical Failures
**Problem**: Segment fails to apply → logged but user never knows → they think it's working

**Gap**: No way to notify user of critical issues through UI or email

**Should Have**:
```javascript
async function sendCriticalAlert(userId, message) {
  try {
    await db.collection('users').doc(userId).collection('alerts').add({
      severity: 'critical',
      message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false
    });
    console.error(`[ALERT] Sent to user: ${message}`);
  } catch (e) {
    console.error('[ALERT] Failed to send alert:', e);
  }
}

// Usage:
if (!segmentClearSuccess) {
  await sendCriticalAlert(userId, 'Failed to clear automation segments - manual intervention needed');
}
```

### 5. No Cycle-Level Transaction
**Problem**: Cycle partially completes before error → state inconsistent

**Gap**: Each operation independent, no rollback mechanism

**Should Have**:
```javascript
class AutomationCycleTransaction {
  constructor(userId) {
    this.userId = userId;
    this.updates = [];
    this.rollbackActions = [];
  }
  
  addUpdate(doc, data, rollbackData) {
    this.updates.push({ doc, data, rollbackData });
  }
  
  async commit() {
    try {
      const batch = db.batch();
      for (const { doc, data } of this.updates) {
        batch.set(doc, data, { merge: true });
      }
      await batch.commit();
    } catch (e) {
      // Rollback
      for (const rollback of this.rollbackActions) {
        await rollback();
      }
      throw e;
    }
  }
}
```

### 6. No Idempotency Keys
**Problem**: Network retry sends same request twice → segment applied twice

**Gap**: No deduplication mechanism

**Should Have**:
```javascript
const cycleTxnId = `${userId}-${Date.now()}-${Math.random()}`;

// Include in FoxESS request headers
const headers = {
  ...existingHeaders,
  'X-Idempotency-Key': cycleTxnId
};

// Store in Firestore - check before retrying
const lastTxn = await db.collection('users').doc(userId).collection('cycles').doc(cycleTxnId).get();
if (lastTxn.exists && lastTxn.data().status === 'completed') {
  console.log('Idempotent retry - cycle already applied');
  return lastTxn.data().result;
}
```

---

## Severity Classification

### 🔴 Critical (Can Cause Wrong Inverter State)
1. **Segment duplication** - Active rule cancellation failure leaves segment on device
2. **Verification not enforced** - Segment reports success but didn't apply
3. **Firestore state mismatch** - Automation state doesn't match inverter reality

### 🟠 High (Can Cause False Triggers/Non-Triggers)
4. **Silent data fetch failures** - Rules evaluate with null data as "not_met"
5. **Partial weather data** - Only 2 of 12 hours available, evaluates anyway
6. **No retry with backoff** - API failures not retried intelligently

### 🟡 Medium (Can Cause Confusion/Delays)
7. **No circuit breaker** - Persistent API down state keeps retrying
8. **No user alerts** - Critical failures logged but user never knows
9. **No idempotency** - Network retry could apply segment twice

### 🔵 Low (Informational)
10. **Timeout inconsistency** - FoxESS has 10s timeout, Firestore has none
11. **Logs hard to parse** - Debugging failures requires extensive log reading

---

## Recommended Priority Fixes (In Order)

### Phase 1: Critical Safety (1-2 hours)
1. **Add verification enforcement** - Fail segment apply if verification doesn't match
2. **Fix segment duplication** - Keep activeRule set if clear fails, retry next cycle
3. **Add idempotency** - Check if exact same cycle already executed

### Phase 2: Data Reliability (2-3 hours)
4. **Implement retry with exponential backoff** - Use strategy above
5. **Distinguish "no data" from "condition failed"** - Handle incomplete data gracefully
6. **Add circuit breaker** - Disable unreliable data sources temporarily

### Phase 3: User Experience (1-2 hours)
7. **Add critical alerts** - Notify user of segment failures, clear issues
8. **Add cycle transaction** - Make all updates atomic or rollback
9. **Improved logging** - Structured logs so errors are easy to spot

---

## Testing Scenarios for Resilience

```javascript
// Test 1: Amber API timeout mid-cycle
// Expected: Cycle continues, rules without Amber conditions trigger
// Risk: High if not handled

// Test 2: FoxESS segment apply fails 3x then succeeds 4th time
// Expected: Automatic retry succeeds, segment applied
// Risk: Medium - backoff might not be long enough

// Test 3: Segment apply succeeds but verification read times out
// Expected: Retry verification, don't report success until confirmed
// Risk: High - currently just logs and proceeds

// Test 4: Active rule cancellation segment clear fails
// Expected: Keep rule active, retry next cycle, alert user
// Risk: Critical - currently clears state then segment duplication can occur

// Test 5: Firestore write times out during state update
// Expected: Cycle fails gracefully, next cycle retries
// Risk: High - currently just hangs

// Test 6: Network partition during segment verify read
// Expected: Assume segment failed, retry entire apply
// Risk: High - currently assumes stale data is valid
```

---

## Summary

**Good parts**: Has retry logic in critical paths (3-2x), logging is verbose, catches most exception throws

**Bad parts**: No verification enforcement, no intelligent backoff, data failures silently fail, state updates fire-and-forget, no circuit breaker, no user alerts

**Biggest risks**:
1. Segment duplication when active rule clear fails
2. Rules evaluate with null data silently
3. Segment succeeds to apply but verification ignored

**Recommendation**: Implement Phase 1 fixes first (verification + idempotency) before expanding automation to more complex rules.
