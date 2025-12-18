# Continuing Rule - FoxESS API Call Diagnosis

**Status:** 🔍 Investigating excessive FoxESS API calls with continuing rule  
**Date:** December 18, 2025

## Issue Summary

User reports: "Automation is enabled with continuing rule and again too many fox calls somehow"

This suggests that when a rule's conditions remain met and the rule is "continuing" (active for multiple cycles), FoxESS API calls are happening more frequently than expected.

## Expected Behavior

### Normal Continuing Rule Timeline

For a rule with **5-minute cooldown** that remains continuously triggered:

```
Minute 0: Rule triggers (NEW)
  └─ applyRuleAction called
     ├─ /op/v1/device/scheduler/get (read)
     ├─ /op/v1/device/scheduler/enable (write segment) 
     ├─ /op/v1/device/scheduler/set/flag (enable flag)
     └─ /op/v1/device/scheduler/get (verify)
     = 4 FoxESS calls

Minutes 1-4: Rule CONTINUING (active conditions hold)
  └─ applyRuleAction NOT called
  └─ Only state update (lastCheck timestamp)
  = 0 FoxESS calls each cycle

Minute 5: Cooldown expires, rule RE-TRIGGERS
  └─ applyRuleAction called again
  = 4 FoxESS calls

Minutes 6-9: Rule CONTINUING again
  = 0 FoxESS calls each cycle

Minute 10: Cooldown expires again
  = 4 FoxESS calls

... pattern repeats ...

EXPECTED TOTAL: ~48 FoxESS calls per hour (12 re-triggers × 4 calls each)
```

## Potential Issues & Diagnostics

### Issue #1: Rule re-triggers EVERY cycle instead of every N minutes

**Symptom:** ~60 FoxESS calls per hour (or 240+ for longer durations)

**Root Cause:** `state.activeRule` is not being persisted or loaded correctly between cycles

**Check:**
```
1. Open Firebase Console → Firestore
2. Navigate to: users/{your-user-id}/automation/state
3. Check the 'activeRule' field
4. Run automation for 5 minutes
5. Refresh and check if 'activeRule' stays the same

Expected: activeRule should remain the SAME ruleId (e.g., "battery_full_discharge")
Bug: activeRule is different or empty
```

### Issue #2: Audit trail shows all 'new_trigger' instead of 'continuing'

**Symptom:** Every cycle shows a new trigger instead of continuing

**Root Cause:** isActiveRule check failing (activeRule mismatch)

**Check:**
```
1. Open automation audit trail in UI (History page)
2. Filter by current rule
3. Look at last 10 entries
4. Check 'Status' column

Expected: Mix of "continuing" and occasional "new_trigger"
Bug: All showing "new_trigger"
```

### Issue #3: Multiple cycles running for same user simultaneously

**Symptom:** Duplicate entries in audit log, counter jumps multiple times per minute

**Root Cause:** Scheduler parallelization or manual API calls

**Check:**
```
1. Firebase Console → Logs
2. Search: "[Scheduler] User {your-uid}: ✅"
3. Check timestamps for the same minute

Expected: One entry per minute max
Bug: Multiple entries in same minute
```

### Issue #4: Conditions constantly fluctuating

**Symptom:** Rule triggers and immediately cancels, repeating every cycle

**Root Cause:** Rule condition is unstable (e.g., "battery > 95%" with battery at 94-95%)

**Check:**
```
1. Open automation logs
2. Look for patterns like:
   - "TRIGGERED" followed by "NO LONGER MET"
   - Happening multiple times per minute

Expected: Stable state (either all CONTINUING or all NOT_MET)
Bug: Flip-flopping every cycle
```

## Quick Diagnostic: 10-Minute Test

**Goal:** Determine the exact call pattern

**Steps:**
1. Get current FoxESS API counter from FoxESS app (note exact number)
2. Wait exactly 10 minutes
3. Check counter again
4. Calculate: (new count - old count) / 10 = calls per minute

**Expected Results:**
```
Continuing rule (5min cooldown):
- Minute 0: ~4 calls
- Minutes 1-4: 0 calls each
- Minute 5: ~4 calls
- Minutes 6-9: 0 calls each

Total in 10 min: ~8 calls (or 0.8 calls/min average)
Expected range: 6-10 calls

Bug Indicators:
- Seeing 30+ calls: 🔴 HIGH (re-triggering multiple times/min)
- Seeing 60+ calls: 🔴 CRITICAL (re-triggering every cycle)
```

## Code Analysis: Where the Bug Could Be

### Location 1: State Persistence (lines 2626-2667)

When rule continues, code should call:
```javascript
await saveUserAutomationState(userId, {
  lastCheck: Date.now(),
  inBlackout: false,
  activeSegmentEnabled: true
  // NOTE: activeRule is NOT cleared - it stays the same!
});
```

**Check:** Is `activeRule` being passed to `saveUserAutomationState`? If NOT, it's cleared!

### Location 2: State Loading (lines 2486-2490)

When cycle starts, code should load existing state:
```javascript
const state = await getUserAutomationState(userId);
// Should have: state.activeRule = "battery_full_discharge"
```

**Check:** Is `getUserAutomationState` correctly retrieving the saved `activeRule`?

### Location 3: Active Rule Detection (line 2542)

```javascript
const isActiveRule = state.activeRule === ruleId;
```

**Check:** If `state.activeRule` is undefined or mismatch, `isActiveRule` will be false!

### Location 4: Cooldown Expiry Re-trigger (lines 2574-2588)

When cooldown expires:
```javascript
// Clear activeRule to allow re-trigger
await saveUserAutomationState(userId, {
  activeRule: null,  // <-- activeRule is cleared here
  activeRuleName: null,
  activeSegment: null
});
```

This is CORRECT - it should clear and re-trigger. But what if it's happening every cycle?

**Check:** Is cooldown logic running every cycle instead of every N minutes?

## Next Steps for User

**Please collect the following and report back:**

1. **FoxESS counter readings** (10-minute test from above)
2. **Last 20 entries from automation audit trail** (from History page)
3. **Firebase Firestore doc:** `users/{uid}/automation/state` (screenshot or JSON)
4. **Automation logs** (from Firebase Console) showing last 30 minutes of activity

With this information, we can pinpoint the exact bug.

## Possible Fixes (if bug confirmed)

### Fix #1: Ensure activeRule persisted in continuing state

In `/api/automation/cycle` around line 2803:

```javascript
// Active rule is continuing - just update check timestamp
await saveUserAutomationState(userId, {
  lastCheck: Date.now(),
  inBlackout: false,
  // IMPORTANT: DO NOT clear activeRule - it should persist!
  activeSegmentEnabled: true
  // ... rest of fields ...
});
```

**Action:** Add `activeRule: state.activeRule` to ensure it's preserved

### Fix #2: Check activeRule comparison

Ensure `state.activeRule` is loaded correctly and matches rule IDs.

### Fix #3: Verify cooldown expiry logic

Make sure cooldown re-trigger only happens when cooldown ACTUALLY expired, not every cycle.

## Monitoring Moving Forward

Once fix is applied, monitor:
```
- FoxESS API calls per hour (should be ~48 for 5min cooldown)
- Audit trail entries (should be mostly "continuing" status)
- Rule state in Firestore (activeRule should be stable)
```

---

**Need Help?** Share the diagnostic data (counter readings, audit trail, Firestore state) and we'll identify and fix the bug.
