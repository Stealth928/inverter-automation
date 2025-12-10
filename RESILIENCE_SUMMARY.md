# Automation Resilience Summary

## Current State Assessment

**Overall Resilience**: ⚠️ **Adequate for happy path, fragile for failures**

### What Works Well ✅
- Retry logic on critical FoxESS operations (3x retries on segment apply)
- Comprehensive logging with context tags
- Graceful exception handling (try-catch around data fetches)
- Cooldown logic prevents rule spam
- Data caching reduces API calls
- Rate limiting protection for Amber API

### Critical Gaps ❌
1. **Verification not enforced** - Segment reports success before confirming device has it
2. **Data fetch failures silent** - Rules evaluate with null data instead of retrying
3. **No circuit breaker** - Persistent API failures hammer same endpoint for hours
4. **Segment duplication risk** - Clear failures leave segment on device, next cycle duplicates it
5. **Firestore writes fire-and-forget** - No retry, timeout, or verification
6. **No exponential backoff** - Fixed 1.2s delays might not give APIs time to recover

---

## Impact Assessment

### Scenario 1: Amber API Down for 30 minutes
**Current behavior**:
- Cycle 1: Try to fetch Amber, fail, warn, continue with null prices
- Cycles 2-30: Same thing, repeat every minute
- Rules with price conditions: Never trigger (evaluate as false with null data)
- User impact: 🔴 **High** - They think automation is broken

**With fixes**:
- Circuit breaker opens after 3 failures
- Cycles 4-30: Skip Amber operations entirely
- UI shows "Amber API temporarily unavailable"
- User knows to check back in 5 minutes
- User impact: 🟡 **Medium** - Expected, recovers automatically

---

### Scenario 2: Segment Apply Succeeds But Verification Fails
**Current behavior**:
- Segment sent to FoxESS successfully (errno=0)
- Verification read times out or returns old data
- System reports success → state updated → next cycle thinks segment active
- FoxESS might not have segment (timeout) or might have wrong one
- Inverter is in unknown state
- User impact: 🔴 **Critical** - Automation unreliable

**With fixes**:
- Verification is retry 3x with longer waits
- If verification doesn't match, entire apply operation fails
- Next cycle automatically retries with exponential backoff
- User gets alert if repeated failures
- User impact: 🟢 **Safe** - Guarantees consistency

---

### Scenario 3: Active Rule Cancellation Fails
**Current behavior**:
- Active rule conditions fail (e.g., price drops below threshold)
- System tries to clear segment from inverter
- Clear fails (network issue, FoxESS timeout, etc.)
- System clears state anyway (`activeRule: null`)
- Next cycle evaluates all rules, first match-ing rule creates new segment
- Inverter now has OLD segment (still running) + NEW segment (just created)
- User impact: 🔴 **Critical** - Overlapping automation segments

**With fixes**:
- If clear fails, keep `activeRule` set (don't clear state)
- Track `clearFailureAttempts` counter
- Next cycle sees activeRule still set, tries to clear again
- After 5 failed attempts, send alert to user
- User impact: 🟡 **Medium** - Stuck but contained, user gets alert

---

## Fix Priority Matrix

| Fix | Effort | Impact | Priority | Status |
|-----|--------|--------|----------|--------|
| Verification enforcement | 30min | 🔴 Critical | 1 | Recommended |
| Fix segment duplication risk | 45min | 🔴 Critical | 2 | Recommended |
| Exponential backoff | 1hr | 🟠 High | 3 | Recommended |
| Circuit breaker | 1hr | 🟠 High | 4 | Nice-to-have |
| User alerts | 1hr | 🟡 Medium | 5 | Nice-to-have |
| Firestore atomic updates | 2hr | 🟡 Medium | 6 | Nice-to-have |

---

## Recommended Implementation Plan

### Week 1: Critical Safety (2-3 hours total)
1. ✅ Add verification enforcement to `applyRuleAction()`
2. ✅ Fix segment duplication by keeping `activeRule` on clear failure
3. ⏳ Test both changes with emulator

**Risk reduction**: 🔴 → 🟠 (prevents 2 critical failure modes)

### Week 2: Data Reliability (1-2 hours)
4. Implement retry utility with exponential backoff
5. Replace inline retry loops with reusable RetryStrategy
6. Update inverter/Amber fetches to use new retry

**Risk reduction**: 🟠 → 🟡 (better recovery from transient failures)

### Week 3: Observability (1-2 hours)
7. Create circuit breaker utility
8. Add for Amber, FoxESS, Weather APIs
9. Log circuit status changes
10. Show circuit status in UI (optional)

**Risk reduction**: 🟡 → 🟢 (prevents cascading failures)

### Week 4+: Polish (2+ hours)
11. Add user-facing alerts for critical failures
12. Make Firestore updates atomic where needed
13. Add integration tests for failure scenarios

**Risk reduction**: 🟢 → 🟢+ (better UX)

---

## Key Lessons

### 1. Verification is Essential
Never trust that a command succeeded until you read it back. Network partitions are common.

```javascript
// Don't do this:
await send(command);
console.log('Success'); // Too early!

// Do this:
await send(command);
const verify = await read();
if (verify matches what we sent) console.log('Success');
else throw error;
```

### 2. State Consistency Matters More Than Speed
It's better to retry slowly and correctly than fail fast and leave state inconsistent.

### 3. Circuit Breakers Prevent Cascades
When an API is down, don't keep hammering it. Let it recover.

### 4. Exponential Backoff is Your Friend
1s, 2s, 4s, 8s delays give systems time to recover without overwhelming them.

### 5. Users Need to Know About Failures
Silent failures are worse than known timeouts. Make status visible.

---

## Monitoring Checklist (Post-Implementation)

After implementing fixes, monitor:

- ✅ `[Automation]` log lines with "VERIFIED" keyword (should see regularly)
- ✅ `[Automation]` log lines with "❌" (should be rare, investigate each)
- ✅ Circuit breaker state changes (should be occasional, not constant)
- ✅ `clearFailureAttempts` counter (should be 0, alert if > 0)
- ✅ User alerts for critical failures (should send only when needed)
- ✅ API call counts (should drop if circuit breaker working)
- ✅ Cycle duration (should still complete in < 5 seconds for happy path)

---

## Testing Checklist

Before deploying critical fixes, manually test:

- [ ] Amber API timeout → cycle continues, rules without Amber trigger
- [ ] Segment apply succeeds but verify times out → operation fails, retry next cycle
- [ ] Active rule condition fails → segment clears, next rule evaluated
- [ ] Clear fails → activeRule stays set, retries next cycle
- [ ] Multiple failures → counter increments, user gets alert at threshold
- [ ] Network partition during database write → write retried, no silent loss

---

## Conclusion

The automation system works well in the happy path but has **3 critical vulnerabilities**:
1. Verification not enforced
2. Segment duplication on clear failure  
3. No intelligent retry/circuit breaker

Implementing the **Week 1 fixes (2-3 hours)** would eliminate all critical risks and significantly improve resilience. The system would then gracefully degrade under failure instead of producing inconsistent states.

**Recommended next step**: Implement verification enforcement first (30 min, highest ROI).
