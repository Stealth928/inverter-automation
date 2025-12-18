# Phantom FOX API Call Diagnosis & Fixes
**Date:** December 18, 2025  
**Issue:** API counters advancing when rules are continuing and when automation is disabled
**Status:** ✅ FIXED (PR ready)

---

## SUMMARY OF FIXES

Three critical phantom API call issues have been identified and fixed:

| Issue | Location | Problem | Fix | Impact |
|-------|----------|---------|-----|--------|
| **#1** | Line 2194 | Automation disabled → clears segments with `userId` → counter ++ | Pass `null` instead of `userId` | Disable/re-enable won't increment counter |
| **#2** | Line 2318 | Rule disabled flag clear → clears segments with `userId` → counter ++ | Pass `null` instead of `userId` | Disable rule won't trigger phantom count |
| **#3** | Line 2350 | Active rule disabled → clears segments with `userId` → counter ++ | Pass `null` instead of `userId` | Active rule disable won't increment |
| **#4** | Line 2715 | Priority-based rule cancel → clears segments with `userId` → counter ++ | Pass `null` instead of `userId` | Rule preemption won't increment |

---

## CRITICAL BUGS FOUND & FIXED ✅

### BUG #1: API Call Increment on AUTOMATION DISABLED (Line 2194) ✅ FIXED
**Severity:** HIGH  
**Location:** `functions/index.js`, lines 2177-2217

When automation is **DISABLED**, the code executes:
```javascript
// BEFORE (WRONG):
const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { 
  deviceSN, groups: clearedGroups 
}, userConfig, userId);  // ⚠️ userId is passed!

// AFTER (FIXED):
const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { 
  deviceSN, groups: clearedGroups 
}, userConfig, null);  // ✅ null userId - NO counter increment!
```

**The Problem (Original Code):**
- When `userId` is passed to `callFoxESSAPI()`, line 785 ALWAYS increments the counter:
  ```javascript
  if (userId) {
    incrementApiCount(userId, 'foxess').catch(() => {});
  }
  ```
- This caused phantom count increases every time a user toggled automation off/on

**The Fix:**
- Pass `null` instead of `userId` for maintenance/system calls
- Counter only increments for explicit user-initiated actions (new rule triggers)
- Automation disable now clears segments without phantom counter increases ✅

---

### BUG #2: API Call Increment on RULE DISABLED (Line 2318) ✅ FIXED
**Severity:** HIGH  
**Location:** `functions/index.js`, lines 2298-2331

When a rule is disabled during cycle evaluation:
```javascript
// BEFORE (WRONG):
const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { 
  deviceSN, groups: clearedGroups 
}, userConfig, userId);  // ⚠️ Counter incremented

// AFTER (FIXED):
const clearResult = await callFoxESSAPI('/op/v1/device/scheduler/enable', 'POST', { 
  deviceSN, groups: clearedGroups 
}, userConfig, null);  // ✅ null userId
```

**The Problem:**
- Disabling a rule that has a `clearSegmentsOnNextCycle` flag would increment counter
- Phantom call on every rule disable action

**The Fix:**
- Pass `null` userId for maintenance segments clear
- Rule disable operations no longer affect API counter ✅

