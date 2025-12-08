# Lookahead Bugs - Technical Verification

## Summary of Issues Found

### Issue #1: Solar Radiation includes CURRENT hour
- **Problem**: `if (t.getHours() >= currentHour)` matches current hour
- **Fix**: Changed to `if (t.getHours() > currentHour)` to skip current hour
- **Result**: Now correctly starts from NEXT hour

### Issue #2: Cloud Cover includes CURRENT hour  
- **Problem**: Identical to solar radiation - `if (t.getHours() >= currentHour)`
- **Fix**: Changed to `if (t.getHours() > currentHour)` to skip current hour
- **Result**: Now correctly starts from NEXT hour

### Issue #3: Forecast Price requests exceed API availability
- **Problem**: Amber API provides ~1 hour but docs promise up to 7 days with no warning
- **Fix**: Added detection of incomplete data and console warning
- **Result**: Logs warn when requested timeframe exceeds available data

### Issue #4: No validation that full timeframe was retrieved
- **Problem**: Silent failure when data is incomplete, no logs or flags
- **Fix**: Added `incomplete` flag and `hoursRequested`/`intervalsAvailable` tracking
- **Result**: Incomplete data now visible in logs and API responses

---

## Code Locations Fixed

### Solar Radiation (lines 3014-3070)
```javascript
// OLD CODE (line ~3030):
if (t.getHours() >= currentHour && t.getDate() === now.getDate()) {
  startIdx = i;
  break;
}

// NEW CODE (line ~3037):  
if (t.getHours() > currentHour && t.getDate() === now.getDate()) {
  startIdx = i;
  break;
}

// PLUS new handling for end-of-day wraparound:
if (startIdx === -1 && hourly.time.length > 0) {
  startIdx = 0; // Will get data from next day
}

// PLUS new variable declarations:
const hoursRequested = lookAheadHours;
const hoursRetrieved = radiationValues.length;
```

### Solar Radiation Results (lines ~3049-3072)
```javascript
// NEW: Add validation warning
const hasIncompleteData = hoursRetrieved < hoursRequested;
if (hasIncompleteData) {
  console.warn(`[Automation] Rule '${rule.name}' - Solar radiation: Only got ${hoursRetrieved} of ${hoursRequested} hours requested`);
}

// NEW: Add incomplete flag to results
results.push({
  condition: 'solarRadiation',
  met,
  actual: actualValue?.toFixed(0),
  operator,
  target: threshold,
  unit: 'W/m²',
  lookAhead: lookAheadDisplay,
  checkType,
  hoursChecked: radiationValues.length,
  hoursRequested,        // ← NEW FIELD
  incomplete: hasIncompleteData  // ← NEW FIELD
});
```

### Cloud Cover (lines 3087-3130)
- **Same fixes as solar radiation** applied to cloud cover condition
- Changed `if (t.getHours() >= currentHour)` → `if (t.getHours() > currentHour)`
- Added `hoursRequested` and `hoursRetrieved` tracking
- Added incomplete data warning
- Added `incomplete` flag to results

### Forecast Price (lines 3243-3303)
```javascript
// NEW: Variables added after intervalsNeeded calculation
const intervalsRequested = intervalsNeeded;
const intervalsActuallyAvailable = forecasts.length;
const hasIncompleteData = relevantForecasts.length < intervalsNeeded;

// NEW: Warning for insufficient data
if (hasIncompleteData && intervalsActuallyAvailable < intervalsNeeded) {
  console.warn(`[Automation] Rule '${rule.name}' - Forecast ${priceType}: Only ${intervalsActuallyAvailable} intervals available in Amber API (limit ~1 hour), but requested ${lookAheadMinutes} minutes`);
}

// NEW: Added incomplete flag to results
results.push({
  condition: 'forecastPrice',
  met,
  actual: actualValue?.toFixed(1),
  operator,
  target: value,
  type: priceType,
  lookAhead: lookAheadDisplay,
  lookAheadMinutes,
  checkType,
  intervalsChecked: relevantForecasts.length,
  intervalsAvailable: forecasts.length,
  incomplete: hasIncompleteData  // ← NEW FIELD
});
```

---

## Documentation Changes

### File: docs/AUTOMATION.md

**Solar Radiation section** - Added warning:
```markdown
**⚠️ Important**: The lookAhead period starts from the **next full hour** 
(current hour is skipped since it's already partially elapsed). If current 
time is 14:23 and you request "next 6 hours", you get 15:00-21:00 
(not 14:00-20:00).
```

**Cloud Cover section** - Added identical warning about next full hour

**Forecast Price section** - Added extensive warning:
```markdown
⚠️ **Important API Limitation**: 
The Amber API provides approximately **1 hour of forecast data** (~12 × 5-min intervals).
When you request longer periods (e.g., 2 hours, 7 days), the system:
- Returns only the available ~1 hour of data
- Logs a warning to indicate incomplete data
- Still evaluates the rule correctly on available data
- Includes `incomplete: true` flag in result object

For multi-day electricity cost optimization, consider using `solarRadiation` and 
`cloudCover` conditions (which have 7-day forecasts) combined with shorter 
`forecastPrice` windows.
```

---

## Test Script Created

**File**: test-lookahead-bugs.js

Tests all 5 bugs:
1. Solar Radiation hour calculation
2. Cloud Cover hour calculation
3. Forecast Price API limitation
4. Edge case at midnight
5. Incomplete time window handling

Run with: `node test-lookahead-bugs.js`

---

## Before/After Behavior

### Scenario: Current time 14:23, requesting "next 6 hours" solar radiation

**BEFORE FIX**:
```
currentHour = 14
t.getHours() = 14 (for 14:00-15:00 slot)
Condition: 14 >= 14? YES → startIdx = index of 14:00 slot
Result gets: [14:00, 15:00, 16:00, 17:00, 18:00, 19:00]
❌ WRONG: Includes current partial hour + only 5 future hours
```

**AFTER FIX**:
```
currentHour = 14
Loop looking for t.getHours() > 14:
t.getHours() = 14 (for 14:00-15:00 slot)? 14 > 14? NO
t.getHours() = 15 (for 15:00-16:00 slot)? 15 > 14? YES → startIdx = index of 15:00 slot
Result gets: [15:00, 16:00, 17:00, 18:00, 19:00, 20:00]
✅ CORRECT: Pure future data, 6 full hours as requested
```

### Scenario: Requesting "48 hours" forecast prices

**BEFORE FIX**:
```
lookAheadMinutes = 2880 (48 * 60)
intervalsNeeded = 576 (ceil(2880 / 5))
amberData has ~12 forecast intervals (Amber API limit)
relevantForecasts = slice(0, 576) = only 12 intervals (out of 576 requested)
No warning logged
❌ WRONG: Got 1 hour of data, expecting 48 hours, silent failure
```

**AFTER FIX**:
```
lookAheadMinutes = 2880 (48 * 60)
intervalsNeeded = 576 (ceil(2880 / 5))
amberData has ~12 forecast intervals
relevantForecasts = slice(0, 576) = only 12 intervals
hasIncompleteData = true (12 < 576)
intervalsActuallyAvailable = 12
Log warning: "Only 12 intervals available in Amber API (limit ~1 hour), but requested 2880 minutes"
Result includes: incomplete: true
✅ CORRECT: Got 1 hour of data with clear warning about API limitation
```

---

## Validation Checklist

- [x] Solar radiation now uses `t.getHours() > currentHour` (not >=)
- [x] Cloud cover now uses `t.getHours() > currentHour` (not >=)
- [x] End-of-day wraparound handled for both conditions
- [x] Forecast price warns when data incomplete
- [x] All three conditions track `hoursRequested` or `intervalsRequested`
- [x] All three conditions include `incomplete` flag in results
- [x] Warning logs show when full timeframe not available
- [x] Documentation updated with caveats
- [x] No syntax errors in modified code
- [x] Test script demonstrates all bugs and fixes
- [x] Backward compatibility maintained (existing rules still work)

---

## Impact Assessment

| Component | Before | After | Impact |
|-----------|--------|-------|--------|
| Solar radiation timeframe | Includes current hour | Starts from next hour | HIGH |
| Cloud cover timeframe | Includes current hour | Starts from next hour | HIGH |
| Forecast price 48h request | Returns 1h silently | Returns 1h with warning | MEDIUM |
| Data validation | None | Logs warnings | MEDIUM |
| Documentation | Missing caveats | Includes API limitations | LOW |

---

## Deployment Notes

1. **No breaking changes** - Existing rules continue to work
2. **Warning logs** added for incomplete data - monitor in production
3. **API responses** now include `incomplete` flag - frontend can display warning
4. **Backward compatible** - old rule formats still work
5. **Recommended**: Update user-facing docs about Amber price forecast limitations

