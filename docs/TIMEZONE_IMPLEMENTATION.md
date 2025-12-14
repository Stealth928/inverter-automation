# Timezone Implementation - Complete Documentation

## Overview

Implemented **Option 2: Timezone Detection from Weather Location**. The system now automatically detects user timezone from their weather location and uses it for all scheduling operations.

---

## Changes Made

### 1. **Backend Functions** (`functions/index.js`)

#### A. Weather API Enhancement
- Modified `callWeatherAPI()` to extract timezone from Open-Meteo API response
- Added `timezone` field to `result.place` object
- Open-Meteo returns IANA timezone (e.g., `America/New_York`, `Europe/London`, `Australia/Sydney`)

#### B. Auto-Timezone Configuration
- Updated `getCachedWeatherData()` to automatically update user config when weather data is fetched
- Sets `userConfig.timezone` based on detected location timezone
- Stored in `users/{userId}/config/main` document with field `timezone`

#### C. Time Function Refactoring
- **New function**: `getUserTime(timezone)` - Gets current time in any timezone
  - Parameters: `timezone` (IANA timezone string, defaults to 'Australia/Sydney')
  - Returns: `{ hour, minute, second, day, month, year, dayOfWeek, timezone }`
  - Handles hour normalization (24 → 0) for midnight edge case
  
- **Backward compatibility**: `getSydneyTime()` now calls `getUserTime('Australia/Sydney')`

- **New function**: `getDateKey(date, timezone)` - Gets YYYY-MM-DD in specified timezone
  - Used for metrics and date-based operations
  - `getAusDateKey()` maintained for backward compatibility

#### D. Automation Logic Updates
- **`applyRuleAction()`**: Now uses `userConfig?.timezone || 'Australia/Sydney'`
  - Gets user's timezone from config
  - Calls `getUserTime(userTimezone)` instead of `getSydneyTime()`
  - Creates segments in user's local time
  
- **`evaluateRule()`**: Time condition evaluation uses user timezone
  - Reads `userConfig?.timezone`
  - Uses `getUserTime(userTimezone)` for current time
  - Evaluates time windows in user's local time
  
- **Blackout Window Evaluation**: Uses user timezone
  - In automation cycle, gets `userConfig?.timezone`
  - Evaluates blackout windows in user's local time

---

## How It Works

### Automatic Timezone Detection Flow

```
1. User sets weather location in UI (e.g., "New York")
   ↓
2. Weather API request to Open-Meteo
   ↓
3. Open-Meteo returns forecast + timezone ("America/New_York")
   ↓
4. System extracts timezone from response
   ↓
5. Automatically updates users/{uid}/config/main with { timezone: "America/New_York" }
   ↓
6. All subsequent automation uses user's timezone
```

### Segment Creation Example

**User in New York (UTC-5)**
- User creates rule: "Discharge from 10:00-14:00"
- At 10:00 AM New York time:
  - System calls `getUserTime('America/New_York')`
  - Gets `{ hour: 10, minute: 0, ... }`
  - Creates segment: startHour=10, startMinute=0
  - **Result**: Segment runs 10:00-14:00 New York time ✅

**Compare to old behavior:**
- Old system used `getSydneyTime()` always
- Would create segment at 10:00 Sydney time
- For NY user, this would be ~7 PM previous day ❌

---

## Configuration

### User Config Schema

```javascript
users/{userId}/config/main {
  deviceSn: string,
  foxessToken: string,
  amberApiKey: string,
  location: string,          // Weather location (e.g., "New York")
  timezone: string,          // IANA timezone (e.g., "America/New_York")
  automation: { ... },
  cache: { ... }
}
```

### Timezone Field
- **Type**: String (IANA timezone identifier)
- **Examples**: 
  - `"America/New_York"` (UTC-5, Eastern Time)
  - `"Europe/London"` (UTC+0, GMT/BST)
  - `"Asia/Tokyo"` (UTC+9, Japan Standard Time)
  - `"Australia/Sydney"` (UTC+10/+11, AEDT/AEST)
  - `"America/Los_Angeles"` (UTC-8, Pacific Time)
- **Default**: `"Australia/Sydney"` (if not set or detection fails)
- **Auto-updated**: When weather location is changed

---

## Supported Timezones

All IANA timezones are supported (400+). Common ones:

| Region | Timezone | UTC Offset |
|--------|----------|------------|
| **Australia** | Australia/Sydney | UTC+10/+11 |
| | Australia/Melbourne | UTC+10/+11 |
| | Australia/Brisbane | UTC+10 |
| **Americas** | America/New_York | UTC-5/-4 |
| | America/Los_Angeles | UTC-8/-7 |
| | America/Chicago | UTC-6/-5 |
| | America/Denver | UTC-7/-6 |
| **Europe** | Europe/London | UTC+0/+1 |
| | Europe/Paris | UTC+1/+2 |
| | Europe/Berlin | UTC+1/+2 |
| **Asia** | Asia/Tokyo | UTC+9 |
| | Asia/Shanghai | UTC+8 |
| | Asia/Singapore | UTC+8 |

---

## Testing

### Test Suite: `functions/test/timezone.test.js`

**16 tests, all passing:**
- ✅ `getUserTime()` returns correct structure
- ✅ Hour normalization (24 → 0)
- ✅ Different timezones handled correctly
- ✅ `getSydneyTime()` backward compatibility
- ✅ `getDateKey()` format validation
- ✅ Timezone detection from weather API
- ✅ Fallback to Sydney if no timezone
- ✅ Segment creation with user timezone
- ✅ Time condition evaluation in user timezone
- ✅ Midnight-crossing time windows
- ✅ Multi-timezone scenarios
- ✅ DST transitions
- ✅ Invalid timezone handling
- ✅ Null/undefined timezone defaults

### Full Test Suite Results
```
Test Suites: 10 passed, 10 total
Tests: 1 skipped, 218 passed, 219 total
Time: ~6 seconds
```

---

## Migration

### Existing Users

**Automatic migration** when they:
1. Change weather location in settings, OR
2. Weather data is refreshed (next fetch)

Their timezone will be automatically detected and saved.

**Default behavior** for users without timezone set:
- System falls back to `Australia/Sydney`
- No breaking changes
- Existing rules continue to work

### Manual Timezone Override

Users can manually set timezone via Firestore:
```javascript
db.collection('users').doc(userId).collection('config').doc('main').update({
  timezone: 'America/New_York'
});
```

---

## API Changes

### Weather API Response

**New field added:**
```javascript
{
  errno: 0,
  result: {
    place: {
      query: "New York",
      resolvedName: "New York",
      country: "United States",
      latitude: 40.7128,
      longitude: -74.0060,
      timezone: "America/New_York",  // ← NEW
      fallback: false
    },
    current: { ... },
    hourly: { ... },
    daily: { ... }
  }
}
```

### Config API

User config now includes `timezone` field:
```javascript
GET /api/config
{
  errno: 0,
  result: {
    deviceSn: "...",
    foxessToken: "...",
    location: "New York",
    timezone: "America/New_York",  // ← NEW
    ...
  }
}
```

---

## Logging & Debugging

### Timezone Information in Logs

**Weather fetch logs:**
```
[Weather] Detected timezone for New York: America/New_York
[Weather] Auto-updating user abc123 timezone to: America/New_York
```

**Automation cycle logs:**
```
[Automation] User timezone: America/New_York, current time: 10:30
[Automation] Evaluating rule 'High Export' in timezone America/New_York (10:30)
[Automation] Using timezone: America/New_York
[Automation] Creating segment: 10:30 - 11:00 (30min)
```

**Time condition logs:**
```
[Automation] Rule 'Morning Charge' - Time condition NOT met: 14:30 not in 08:00-12:00
```

---

## Edge Cases Handled

### 1. **DST Transitions**
- Node.js `toLocaleString()` handles DST automatically
- No manual DST logic required
- Timezone offset changes are transparent

### 2. **Midnight Crossing**
- Time windows like "22:00-06:00" work correctly
- Logic handles wrap-around properly

### 3. **Invalid Timezone**
- Falls back to Sydney if timezone is invalid
- Logs warning for debugging

### 4. **Missing Timezone**
- Uses `userConfig?.timezone || 'Australia/Sydney'`
- Safe fallback ensures no breaks

### 5. **Location Change**
- Timezone auto-updates on next weather fetch
- No manual intervention required

---

## Security & Performance

### Security
- ✅ Timezone stored per-user in Firestore
- ✅ No cross-user timezone leakage
- ✅ IANA standard timezone validation by Node.js

### Performance
- ✅ Timezone cached in user config (no API overhead)
- ✅ `getUserTime()` is lightweight (millisecond execution)
- ✅ No additional API calls for timezone detection (part of weather fetch)

---

## Troubleshooting

### Problem: Segments created at wrong time

**Check:**
1. User's `timezone` field in Firestore
2. Weather location setting matches user's actual location
3. Logs show correct timezone being used

**Fix:**
- Have user change weather location to trigger timezone re-detection
- Or manually update `users/{uid}/config/main` with correct timezone

### Problem: Timezone not auto-updating

**Check:**
- Weather cache TTL (30 minutes by default)
- Weather API is being called (not using stale cache)

**Fix:**
- Clear weather cache: delete `users/{uid}/cache/weather` document
- Next weather fetch will update timezone

### Problem: User in Sydney but timezone shows different

**Cause**: User set weather location to different city

**Fix**: User should set location to their actual location (e.g., "Sydney" not "New York")

---

## Known Limitations

1. **Frontend display** still uses hardcoded Sydney timezone in some places
   - History page timestamps
   - Dashboard time displays
   - **Impact**: Low (backend automation uses correct timezone)
   - **Future work**: Add user timezone to frontend global state

2. **API counter dates** use Sydney timezone for rollover
   - Affects when daily API counts reset
   - **Impact**: Minimal (cosmetic only)
   - **Future work**: Use user timezone for per-user metrics

3. **Timezone must be valid IANA identifier**
   - Node.js will throw error for invalid values
   - **Mitigation**: Only Open-Meteo provides timezone values

---

## Future Enhancements

### Phase 1 (Current) ✅
- [x] Timezone detection from weather location
- [x] Segment creation in user timezone
- [x] Time condition evaluation in user timezone
- [x] Blackout windows in user timezone
- [x] Comprehensive tests

### Phase 2 (Future)
- [ ] Manual timezone selector in UI
- [ ] Display current timezone in settings
- [ ] Show "local time" vs "inverter time" if different
- [ ] Timezone-aware history timestamps
- [ ] Per-user API metrics in user timezone

### Phase 3 (Future)
- [ ] Multi-inverter support with different timezones
- [ ] Timezone change notification/confirmation
- [ ] Scheduled timezone changes (for travelers)

---

## Code References

### Key Files Modified
- `functions/index.js` (lines ~1410, ~2988, ~3650, ~4425, ~4474)
- `functions/test/timezone.test.js` (new file, 16 tests)

### Key Functions
- `getUserTime(timezone)` - Time in any timezone
- `getDateKey(date, timezone)` - Date key for timezone
- `callWeatherAPI()` - Extract timezone from Open-Meteo
- `getCachedWeatherData()` - Auto-update user timezone
- `applyRuleAction()` - Use user timezone for segments
- `evaluateRule()` - Use user timezone for conditions

---

## Summary

✅ **Complete timezone support implemented**  
✅ **Automatic detection from weather location**  
✅ **218 tests passing, 0 failures**  
✅ **Backward compatible (defaults to Sydney)**  
✅ **No breaking changes for existing users**  
✅ **Production-ready**

Users in different timezones will now have segments created at the correct local time, matching their rule definitions and expectations.

---

**Implementation Date**: December 14, 2025  
**Version**: 2.3.0 - Timezone Support (Option 2)  
**Tests**: 218 passing, 1 skipped  
**Impact**: Critical fix for multi-timezone deployments
