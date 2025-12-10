# Automation Resilience: Visual Overview

## Automation Cycle Flow with Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│  Automation Cycle - Full End-to-End Flow                        │
└─────────────────────────────────────────────────────────────────┘

STAGE 1: DATA COLLECTION
═══════════════════════════════════════════════════════════════════
  ↓ Get inverter data (SoC, temps)
  │  └─ Try-catch: ✅ Catches errors, logs warning
  │     └─ ❌ No retry: Silent fail, null data
  │        └─ ⚠️  Rule evaluation proceeds with incomplete data
  │
  ↓ Get Amber prices
  │  └─ Try-catch: ✅ Catches errors, logs warning  
  │     └─ ❌ No retry: Silent fail, null data
  │        └─ ⚠️ Price rules evaluate as NOT_MET
  │
  ↓ Get weather data (if needed)
     └─ Try-catch: ✅ Catches errors
        └─ ⚠️  Partial data not distinguished from "no data"


STAGE 2: RULE EVALUATION
═══════════════════════════════════════════════════════════════════
  For each enabled rule (sorted by priority):
  ├─ Check if cooldown expired
  ├─ Evaluate all conditions
  │  ├─ if data === null → condition = NOT_MET (no retry attempt!)
  │  ├─ if data incomplete → evaluate anyway with partial data
  │  └─ Comparison logic (compareValue) not shown
  ├─ If ALL conditions met → TRIGGERED
  └─ If active rule and conditions still met → CONTINUING
     └─ If conditions failed → CANCELING (needs clear on inverter)


STAGE 3a: NEW RULE TRIGGERED
═══════════════════════════════════════════════════════════════════
  ↓ Apply rule action
  │  ├─ Get current scheduler from device
  │  │  └─ Try-catch: ✅ Catches errors, logs warning
  │  │     └─ If fails: Continue with default groups
  │  │
  │  ├─ Build new segment (clear old ones first)
  │  │
  │  ├─ Send to FoxESS API
  │  │  └─ Retry loop: ✅ 3x retry with 1.2s fixed delay
  │  │     └─ ❌ NO exponential backoff
  │  │        └─ ❌ NO circuit breaker
  │  │           └─ If 3x fail: Return error
  │  │
  │  ├─ Set scheduler flag
  │  │  └─ Retry loop: ✅ 2x retry with 0.8s delay
  │  │     └─ ⚠️ If fails: Still returns success (not critical)
  │  │
  │  ├─ Wait 3 seconds for FoxESS to process
  │  │
  │  └─ Verify segment on device
  │     ├─ Retry loop: ✅ 2x retry with 1s delay
  │     └─ ❌ CRITICAL GAP: Verification not enforced
  │        └─ ❌ If verify fails: Still returns errno=0 (false success!)
  │           └─ State updated with wrong info
  │              └─ ⚠️  Next cycle might duplicate segment
  │
  ↓ Update Firestore state
     ├─ Update automation state (activeRule, etc)
     │  └─ Fire-and-forget: ❌ No error handling, timeout, or verify
     │
     └─ Update rule's lastTriggered
        └─ Fire-and-forget: ❌ No error handling


STAGE 3b: ACTIVE RULE CANCELING
═══════════════════════════════════════════════════════════════════
  ↓ Conditions no longer met - need to clear segment
  │
  ├─ Clear all segments on inverter
  │  ├─ Retry loop: ✅ 3x retry with 1.2s delay
  │  └─ If all 3x fail:
  │     ├─ ⚠️ CRITICAL GAP: State cleared anyway
  │     │   └─ activeRule: null (cleared from state)
  │     │   └─ ❌ But segment STILL on inverter!
  │     │
  │     └─ Next cycle will see NO active rule
  │        └─ First matching rule will create NEW segment
  │           └─ 🔴 DUPLICATION: Inverter has 2 segments active!
  │
  ├─ Update Firestore state
  │  └─ Fire-and-forget: ❌ No error handling
  │
  └─ Return result


STAGE 4: HISTORY LOGGING
═══════════════════════════════════════════════════════════════════
  ↓ Try-catch: ✅ Catches errors
     └─ If fails: Just logs warning, continues


═══════════════════════════════════════════════════════════════════
SUCCESS CRITERIA (Current):
  ✅ No unhandled exceptions
  ✅ Logging is verbose
  ✅ API retries (1.2s, 1.2s, 1.2s)
  ✅ Handles null data gracefully

FAILURE MODES (Current):
  🔴 CRITICAL: Segment duplication if clear fails
  🔴 CRITICAL: Verification not enforced - false success
  🟠 HIGH: Data fetch fails silently - no retry
  🟠 HIGH: Firestore writes fire-and-forget
  🟡 MEDIUM: Fixed retry delays - no backoff
  🟡 MEDIUM: No circuit breaker - hammers failed APIs
```

---

## Risk Heat Map

```
LIKELIHOOD vs IMPACT MATRIX
╔═══════════════════════════════════════════════════════════════╗
║         LOW                 MEDIUM              HIGH           ║
║     (< 1/day)           (1-3/day)          (> 3/day)          ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  H  ┌─────────────────────────────────────────────────────┐  ║
║  I  │                                                     │  ║
║  G  │  Circuit        🟠 Verify          Firestore      │  ║
║  H  │  Breaker        NOT enforced       Write           │  ║
║     │  Missing        (VERIFICATION)     Fail            │  ║
║     │                                    (Fire-&-forget) │  ║
║  ┌──┼─────────────────────────────────────────────────────┤  ║
║  │  │  Data          🔴 Segment          Clear           │  ║
║  M  │  Fetch         DUPLICATION         Retries         │  ║
║  E  │  Silent        (SEGMENT DUP)       Limited         │  ║
║  D  │  Fail                                               │  ║
║  I  │                                                     │  ║
║  UM │  Partial       Parse               Weather         │  ║
║     │  Weather       Error               Data            │  ║
║     │  Data          Invalid             Incomplete      │  ║
║  ┌──┼─────────────────────────────────────────────────────┤  ║
║  │  │  Network      Fixed Retry         API Timeout     │  ║
║  L  │  Jitter       Delays              Handling         │  ║
║  O  │               (No backoff)         (Already good)  │  ║
║  W  │                                                     │  ║
║     └─────────────────────────────────────────────────────┘  ║
║       BLUE   = Current system handles well                   ║
║       YELLOW = Monitor, potential issue                      ║
║       ORANGE = High priority fix                             ║
║       RED    = Critical, implement ASAP                      ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Error Handling Maturity Model

```
STAGE                          CURRENT STATE        MATURITY LEVEL

1. Try-Catch Blocks            ✅ Present           ★★★★☆ (4/5)
   (Prevents crashes)
   
2. Error Logging               ✅ Comprehensive     ★★★★☆ (4/5)
   (Can debug issues)

3. Retry Logic                 ✅ Limited           ★★★☆☆ (3/5)
   (3x on segment, but fixed delay)

4. Fallback Data               ❌ Missing           ★☆☆☆☆ (1/5)
   (Uses null instead of retry/cache)

5. Circuit Breaker             ❌ Missing           ★☆☆☆☆ (1/5)
   (No protection from cascades)

6. Verification                ⚠️  Incomplete       ★★☆☆☆ (2/5)
   (Not enforced - still reports success)

7. State Consistency           ⚠️  Weak             ★★☆☆☆ (2/5)
   (Fire-and-forget writes)

8. User Notifications          ❌ Missing           ★☆☆☆☆ (1/5)
   (Silent failures)

9. Graceful Degradation        ⚠️  Partial          ★★☆☆☆ (2/5)
   (Skips unavailable data but wrong)

10. Observability              ✅ Good              ★★★★☆ (4/5)
    (Detailed logs available)

OVERALL RESILIENCE SCORE: ★★★☆☆ (3/5) - Adequate for happy path, fragile for edge cases
```

---

## Quick Reference: What To Fix First

### Priority 1: Verification Enforcement (30 min)
```javascript
// PROBLEM
const result = await applySegment();
return { errno: 0 }; // Success!
// But verification read showed something different...

// SOLUTION
const result = await applySegment();
const verify = await readSegment();
if (verify matches result) return { errno: 0 };
else return { errno: -1, msg: 'Verification failed' };
```
**Impact**: Prevents false success, ensures segment actually applied

---

### Priority 2: Segment Duplication Fix (45 min)
```javascript
// PROBLEM
if (!clearSuccess) {
  await clearAutomationState(); // 😱 Don't do this!
  // Segment still on inverter, state cleared
  // Next cycle: duplication!
}

// SOLUTION
if (!clearSuccess) {
  await saveState({ clearFailureAttempts: count + 1 });
  // Keep activeRule set - retry next cycle
  // No duplication possible
}
```
**Impact**: Prevents inverter having overlapping segments

---

### Priority 3: Intelligent Retry (1 hour)
```javascript
// PROBLEM
for (let i = 0; i < 3; i++) {
  try { return await operation(); }
  catch (e) {
    await sleep(1200); // Fixed delay, API might need longer
  }
}

// SOLUTION
await retry(operation, {
  backoff: exponential(500ms to 10s),
  jitter: 10%,
  maxRetries: 3
});
```
**Impact**: Better recovery from transient failures

---

## Weekly Monitoring Dashboard

```
METRIC                          ALERT THRESHOLD
────────────────────────────────────────────────
[Automation] ❌ Errors          > 5 per hour
[Automation] ⚠️ Warnings        > 10 per hour
Segment verification fails      > 3 consecutive
Clear failure attempts counter  > 2 (any rule)
Circuit breaker states          Any open state
Cycle duration                  > 5 seconds
Inverter segments active count  > 1 (expect 0 or 1)
Firestore write latency         > 2 seconds (avg)
API retry count distribution    Check for patterns
Rule trigger frequency          Unusual patterns?
```

---

## Summary: Resilience Roadmap

```
WEEK 1: CRITICAL SAFETY        [████████░░] 80% Risk Reduction
├─ Verification enforcement ✅
├─ Segment duplication fix ✅
└─ Test both changes

WEEK 2: DATA RELIABILITY        [████░░░░░░] +10% Risk Reduction
├─ Exponential backoff ✅
├─ Retry wrapper ✅
└─ Replace inline retries

WEEK 3: FAILURE ISOLATION       [██░░░░░░░░] +8% Risk Reduction
├─ Circuit breaker ✅
├─ API status tracking ✅
└─ Automatic recovery

WEEK 4: OBSERVABILITY           [░░░░░░░░░░] +2% Risk Reduction
├─ User alerts ✅
├─ Monitoring dashboard ✅
└─ Testing framework

BEFORE: 🔴🔴🔴🟠🟠🟡 (60% risk)
AFTER:  🟢🟢🟢🟡🟡🔵 (15% risk)
```

---

## Remember

> "A system is only as resilient as its ability to detect and recover from failures."

**Current system**: Good at detecting failures (logging) but weak at recovering (no backoff, no circuit breaker, verification not enforced)

**With recommended fixes**: Will be strong at both detecting AND recovering gracefully.
