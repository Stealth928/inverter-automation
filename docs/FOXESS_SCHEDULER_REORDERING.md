# FoxESS Scheduler Group Reordering Behavior

## Issue Summary

**CRITICAL**: FoxESS API **reorders scheduler groups** after you save them. This means:

- You send a segment to **Group 1 (index 0)**
- FoxESS API returns `errno=0` (success)
- When you read back, the segment appears in **Group 8** (or another position)

This behavior is undocumented but confirmed through testing on December 5, 2025.

## Example

### What we send:
```json
{
  "deviceSN": "60KB10305AKA064",
  "groups": [
    {
      "enable": 1,
      "workMode": "ForceDischarge",
      "startHour": 22,
      "startMinute": 54,
      "endHour": 23,
      "endMinute": 24,
      "minSocOnGrid": 20,
      "fdSoc": 35,
      "fdPwr": 2000,
      "maxSoc": 100
    },
    { "enable": 0, ... },  // Groups 2-8 all disabled
    { "enable": 0, ... },
    { "enable": 0, ... },
    { "enable": 0, ... },
    { "enable": 0, ... },
    { "enable": 0, ... },
    { "enable": 0, ... }
  ]
}
```

### What we get back from verify read:
```
Group 1: {"enable":0,"workMode":"SelfUse","startHour":0,...}  // EMPTY!
Group 2-7: all empty
Group 8: {"enable":1,"workMode":"ForceDischarge","startHour":22,"startMinute":54,...}  // OUR SEGMENT!
```

## Root Cause

FoxESS likely sorts/reorders segments based on:
1. Enabled status (enabled segments may be moved to specific positions)
2. Start time
3. Some internal priority system

The exact logic is unknown but the behavior is consistent.

## Impact

1. **Segment verification fails** if you check "did Group 1 get our values?" - it won't!
2. **Segment matching by position is impossible** - position changes
3. **UI shows "wrong" group numbers** - cosmetic issue only

## Solution Implemented

### 1. Don't verify by position
Instead of checking if Group 1 has our values, we scan ALL groups and log any enabled segments:

```javascript
// After setting segment, verify by scanning all groups
verify.result.groups.forEach((g, idx) => {
  if (g.enable === 1) {
    console.log(`[Automation] Verify Group ${idx + 1} ENABLED:`, JSON.stringify(g));
  }
});
```

### 2. Match by content, not position
When checking if our segment was applied, match by the unique combination of:
- startHour + startMinute
- endHour + endMinute
- workMode
- fdPwr (for ForceDischarge)

### 3. Don't pad to 10 groups
The device has 8 scheduler groups. Sending 10 groups causes issues. Always use the actual device count:

```javascript
// Get current groups from device
const current = await callFoxESSAPI('/op/v1/device/scheduler/get', ...);
const currentGroups = current?.result?.groups || [];
console.log(`Got ${currentGroups.length} groups from device`);  // Usually 8
```

### 4. Clean slate approach
Before adding a segment, clear ALL groups to known state:

```javascript
currentGroups.forEach((group, idx) => {
  currentGroups[idx] = {
    enable: 0,
    workMode: 'SelfUse',
    startHour: 0, startMinute: 0,
    endHour: 0, endMinute: 0,
    minSocOnGrid: 10,
    fdSoc: 10,
    fdPwr: 0,
    maxSoc: 100
  };
});
// Then set group 0 with our segment
currentGroups[0] = segment;
```

## Testing Verification

After applying a segment, the key check is:
- **errno=0** from the `/op/v1/device/scheduler/enable` call
- **Any enabled group in verify read** matches our segment values

The GROUP NUMBER doesn't matter - only that the segment EXISTS somewhere with correct values.

## Related Files

- `functions/index.js` - `applyRuleAction()` function
- `backend/server.js` - `applyRuleAction()` function (local version)

## Date Discovered

December 5, 2025 during automation debugging session.

## Symptoms That Indicate This Issue

1. API returns `errno=0` but verify shows empty Group 1
2. Segment appears in "wrong" group number in FoxESS app
3. Automation thinks segment wasn't applied but it actually was
4. "Segment missing" logs when segment actually exists in different position
