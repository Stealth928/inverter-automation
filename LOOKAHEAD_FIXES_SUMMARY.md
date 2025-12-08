# Lookahead Time Window Fixes - Summary

## Overview
Scanned and fixed critical bugs in the rule evaluation logic for time-based lookAhead conditions affecting solar radiation, cloud cover, and forecast price evaluations.

---

## Bugs Fixed

### 1. ✅ Solar Radiation - Wrong Time Window
**Issue**: Started from CURRENT hour instead of NEXT hour  
**Fix**: Changed condition from `t.getHours() >= currentHour` to `t.getHours() > currentHour`  
**Lines**: functions/index.js ~3033  
**Impact**: Rules now correctly forecast 6 hours into the future (not including the current partial hour)

### 2. ✅ Cloud Cover - Wrong Time Window  
**Issue**: Same as solar radiation - started from CURRENT hour  
**Fix**: Applied identical fix to cloud cover logic  
**Lines**: functions/index.js ~3100  
**Impact**: Cloud cover forecasts now accurate for specified lookahead period

### 3. ✅ Forecast Price - Silent Data Loss
**Issue**: Amber API only provides ~1 hour of forecast, but docs promised up to 7 days with no warning  
**Fix**: Added detection and warning when requested period exceeds available data  
**Lines**: functions/index.js ~3260  
**Impact**: Logs now warn when forecast price data is incomplete

### 4. ✅ Data Validation - No Error Visibility
**Issue**: No indication when system couldn't retrieve full timeframe  
**Fix**: Added `incomplete` flag and warning logs to all three conditions  
**Lines**: functions/index.js throughout condition checks  
**Impact**: Users can see in logs and API responses when data is incomplete

---

## Code Changes

### Functions/index.js - Solar Radiation (lines 3015-3050)
```javascript
// BEFORE: Included current hour
if (t.getHours() >= currentHour && ...) { startIdx = i; }

// AFTER: Skips current hour, starts from NEXT hour
if (t.getHours() > currentHour && ...) { startIdx = i; }
// Plus handle wraparound at end of day
if (startIdx === -1 && hourly.time.length > 0) { startIdx = 0; }
```

### Functions/index.js - Cloud Cover (lines 3087-3125)
Same fix as solar radiation applied to cloud cover.

### Functions/index.js - Forecast Price (lines 3243-3285)
```javascript
// NEW: Detect incomplete data from Amber API
const hasIncompleteData = relevantForecasts.length < intervalsNeeded;
if (hasIncompleteData && intervalsActuallyAvailable < intervalsNeeded) {
  console.warn(`Forecast: Only ${intervalsActuallyAvailable} intervals available (Amber API limit ~1 hour)`);
}

// Include in results
results.push({
  ...existing fields...,
  hoursRequested,     // NEW
  incomplete: hasIncompleteData  // NEW
});
```

---

## Documentation Updates

### docs/AUTOMATION.md - Solar Radiation Section
Added note explaining that lookAhead starts from NEXT hour:
> "The lookAhead period starts from the **next full hour** (current hour is skipped since it's already partially elapsed). If current time is 14:23 and you request "next 6 hours", you get 15:00-21:00 (not 14:00-20:00)."

### docs/AUTOMATION.md - Cloud Cover Section
Same explanation as solar radiation.

### docs/AUTOMATION.md - Forecast Price Section
Added prominent warning about Amber API 1-hour limitation:
> "The Amber API provides approximately **1 hour of forecast data** (~12 × 5-min intervals). When you request longer periods (e.g., 2 hours, 7 days), the system returns only the available ~1 hour of data and logs a warning."

---

## Files Modified

1. **functions/index.js** - Core fixes for all three conditions
2. **docs/AUTOMATION.md** - Documentation updates with caveats
3. **test-lookahead-bugs.js** - Test script demonstrating all bugs (NEW)
4. **LOOKAHEAD_BUGS_REPORT.md** - Detailed bug report with analysis (NEW)

---

## Verification

### Before Fix Example
At 14:30, requesting "next 6 hours" of solar radiation:
- Gets hours: 14:00, 15:00, 16:00, 17:00, 18:00, 19:00, 20:00
- **Wrong** - includes current hour which is 30 minutes elapsed

### After Fix Example
At 14:30, requesting "next 6 hours" of solar radiation:
- Gets hours: 15:00, 16:00, 17:00, 18:00, 19:00, 20:00
- **Correct** - skips current hour, 6 full hours into future

---

## Impact

| Condition | Impact | Severity |
|-----------|--------|----------|
| Solar Radiation | Rules using radiation forecasts were looking at wrong hours | HIGH |
| Cloud Cover | Rules using cloud forecasts were off by 1 hour | HIGH |
| Forecast Price | Extended lookAhead didn't work as documented | MEDIUM |
| Data Validation | Silent failures made debugging impossible | MEDIUM |

**Recommendation**: Deploy fixes immediately and monitor logs for "incomplete" warnings to identify any edge cases.

---

## Testing

Run the included test script to verify bugs and understand the fixes:
```bash
node test-lookahead-bugs.js
```

Output demonstrates:
- ✓ Solar radiation bug and fix
- ✓ Cloud cover bug and fix  
- ✓ Forecast price API limitation
- ✓ Edge cases (midnight, data loss)
- ✓ Time calculation impact

