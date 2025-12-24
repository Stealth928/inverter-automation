# Midnight Crossing Fix - Critical Automation Bug Resolution

## Issue Summary

**Problem:** Rules were showing as "ACTIVE" in the UI but no segments were being enabled on the FoxESS inverter, particularly for late-night triggers (23:XX).

**Root Cause:** FoxESS API **does not allow scheduler segments that cross midnight (00:00)**. When a rule triggered at 23:45 with a 30-minute duration, the system was calculating an end time of 00:15 (next day), which FoxESS silently rejected or ignored.

## Technical Details

### Before the Fix

The `addMinutes` function used modulo arithmetic:
```javascript
const totalMins = startHour * 60 + startMinute + minutesToAdd;
const hour = Math.floor(totalMins / 60) % 24;  // Wraps at midnight!
```

**Example:**
- Start: 23:45 (1425 minutes)
- Duration: 30 minutes
- Total: 1455 minutes
- Calculated end: 1455 % 1440 = 15 minutes → 00:15 (next day)
- **FoxESS rejects this segment!**

### The Fix

Added midnight-crossing detection and capping logic in `applyRuleAction`:

```javascript
// Calculate end time
const endTimeObj = addMinutes(startHour, startMinute, durationMins);
let endHour = endTimeObj.hour;
let endMinute = endTimeObj.minute;

// Detect midnight crossing
const startTotalMins = startHour * 60 + startMinute;
const endTotalMins = endHour * 60 + endMinute;

if (endTotalMins <= startTotalMins) {
  // Would cross midnight - cap at 23:59
  console.warn(`[SegmentSend] ⚠️ MIDNIGHT CROSSING DETECTED`);
  console.warn(`[SegmentSend]    Original: ${startHour}:${String(startMinute).padStart(2,'0')} → ${endHour}:${String(endMinute).padStart(2,'0')} (${durationMins}min)`);
  
  endHour = 23;
  endMinute = 59;
  const actualDuration = (23 * 60 + 59) - startTotalMins;
  console.warn(`[SegmentSend] 🔧 CAPPED at 23:59 - Reduced duration from ${durationMins}min to ${actualDuration}min to respect FoxESS constraint`);
}

// Final validation before segment creation
const endTotalMinsCheck = endHour * 60 + endMinute;
if (endTotalMinsCheck <= startTotalMins) {
  throw new Error(`Invalid segment: end time must be after start time (no midnight crossing allowed by FoxESS)`);
}
```

## Behavioral Changes

### Before
- ❌ Rule triggers at 23:45 with 30min duration
- ❌ Segment calculated as 23:45-00:15 (crosses midnight)
- ❌ FoxESS API returns success but segment not applied
- ❌ `activeSegmentEnabled` stays false
- ❌ UI shows "⚠️ PENDING" indefinitely

### After
- ✅ Rule triggers at 23:45 with 30min duration
- ✅ Midnight crossing detected
- ✅ Segment capped at 23:45-23:59 (14min actual)
- ✅ FoxESS API accepts segment
- ✅ `activeSegmentEnabled` set to true
- ✅ UI shows "✅ ACTIVE"
- ℹ️ Warning logged showing duration reduction

## Log Examples

### Successful Capping
```
[SegmentSend] ========== START applyRuleAction ==========
[SegmentSend] Device: ABC123456, Action: {"durationMinutes":30,"workMode":"SelfUse",...}
[SegmentSend] ⚠️ MIDNIGHT CROSSING DETECTED
[SegmentSend]    Original: 23:45 → 00:15 (30min)
[SegmentSend] 🔧 CAPPED at 23:59 - Reduced duration from 30min to 14min to respect FoxESS constraint
[SegmentSend] 📡 Segment prepared: {"enable":1,"workMode":"SelfUse","startHour":23,"startMinute":45,"endHour":23,"endMinute":59,...}
[SegmentSend] 🔄 API Attempt 1/3 - Sending scheduler/enable request...
[SegmentSend] 📥 API Response (took 1234ms): {"errno":0,"msg":"success"}
[SegmentSend] ✅ SUCCESS - Segment sent successfully
```

### Validation Failure (Should Never Happen)
```
[SegmentSend] ❌ CRITICAL: Final validation failed - end time 00:15 is not after start time 23:45
Error: Invalid segment: end time must be after start time (no midnight crossing allowed by FoxESS)
```

## Testing Scenarios

### Test Case 1: Late Evening Trigger
- **Setup:** Create rule with 23:30 trigger time, 60min duration
- **Expected:** Segment capped at 23:30-23:59 (29min actual)
- **Verify:** Check inverter scheduler shows segment, logs show capping warning

### Test Case 2: Just Before Midnight
- **Setup:** Create rule with 23:50 trigger time, 30min duration
- **Expected:** Segment capped at 23:50-23:59 (9min actual)
- **Verify:** UI shows "✅ ACTIVE", logs show significant duration reduction

### Test Case 3: Daytime Trigger (No Crossing)
- **Setup:** Create rule with 14:00 trigger time, 30min duration
- **Expected:** Segment 14:00-14:30 (30min, no capping)
- **Verify:** No midnight crossing warnings in logs

### Test Case 4: Early Morning Trigger
- **Setup:** Create rule with 01:00 trigger time, 30min duration
- **Expected:** Segment 01:00-01:30 (30min, no capping)
- **Verify:** Works normally, no midnight issues

## Impact on Existing Rules

- **Rules triggering before 23:00:** No change, segments work as before
- **Rules triggering 23:00-23:29:** May have segments capped if duration > 60min
- **Rules triggering 23:30-23:59:** Will always be capped, actual duration reduced
- **Continuing rules:** Benefit from automatic retry logic, failed segments now re-attempted

## Alternative Approaches Considered

1. **Split segments at midnight** - Create two segments (23:45-23:59 + 00:00-00:16)
   - ❌ Complex, requires multiple API calls
   - ❌ Unclear if FoxESS supports two active segments
   - ❌ May cause unexpected behavior at midnight transition

2. **Delay trigger until after midnight** - Wait and start at 00:00
   - ❌ Defeats immediate action purpose
   - ❌ Pricing/weather conditions may change
   - ❌ User expects immediate response

3. **Reject late-night rules** - Prevent creation of rules that might cross midnight
   - ❌ Too restrictive, valid use cases exist
   - ❌ Hard to predict trigger times (weather/price based)
   - ❌ Poor user experience

4. **Cap at 23:59 (Selected Approach)**
   - ✅ Simple, immediate action maintained
   - ✅ Respects FoxESS constraint
   - ✅ Transparent via warning logs
   - ✅ Maximum valid duration preserved

## Related Fixes

This fix was deployed alongside:
1. **activeSegmentEnabled state bug** - Removed false positive flag on continuing rules
2. **Automatic retry logic** - Re-attempts segment send when `activeSegmentEnabled === false`
3. **Enhanced UI status badges** - Shows "✅ ACTIVE" vs "⚠️ PENDING" based on device state
4. **Comprehensive logging** - Added 10+ detailed log blocks throughout automation cycle

## Deployment

- **Deployed:** 2024 (current session)
- **Functions:** `api`, `runAutomation` updated
- **Frontend:** No changes required
- **Migration:** Automatic, no action needed from users

## Monitoring

Watch Firebase Functions logs for:
- `⚠️ MIDNIGHT CROSSING DETECTED` - Capping occurred
- `🔧 CAPPED at 23:59` - Duration reduction applied
- `❌ CRITICAL: Final validation failed` - Should never happen, indicates logic error

## Future Enhancements (Optional)

1. **UI warning for late-night rules** - Show message when creating rules that may be capped
2. **Smart duration adjustment** - Automatically suggest shorter duration for late-night triggers
3. **Next-day continuation** - Option to create follow-up rule for remaining duration after midnight
4. **Multi-day segments** - If FoxESS adds support, implement segment spanning

## References

- User insight: "Fox does not allow segments that overlap and go over midnight"
- FoxESS API: `/op/v1/device/scheduler/enable`, `/get`, `/set/flag`
- Code: `functions/index.js` lines 4945-5020
- Related docs: `AUTOMATION.md`, `SCHEDULER_TROUBLESHOOTING.md`
