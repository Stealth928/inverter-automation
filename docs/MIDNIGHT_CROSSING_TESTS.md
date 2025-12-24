# Midnight Crossing Test Suite Added

Note: This document is a point-in-time report. For current test counts and coverage, see TESTING_GUIDE.md and docs/TEST_COVERAGE_REPORT.md.


## Test File Location
[functions/test/midnight-crossing.test.js](functions/test/midnight-crossing.test.js)

## Test Coverage Summary

**Total Tests: 17 all passing ✅**

### Test Categories

#### 1. Segment Time Validation (4 tests)
Tests the four primary scenarios from the FoxESS constraint:

- **Test Case 1: Late Evening Trigger**
  - Trigger: 23:30, Duration: 60min
  - Expected: Original end 00:30 (crosses midnight)
  - Actual: Capped at 23:59 (29min duration)
  - ✅ Validates midnight crossing detection

- **Test Case 2: Just Before Midnight**
  - Trigger: 23:50, Duration: 30min
  - Expected: Original end 00:20 (crosses midnight)
  - Actual: Capped at 23:59 (9min duration)
  - ✅ Validates maximum time boundary

- **Test Case 3: Daytime Trigger**
  - Trigger: 14:00, Duration: 30min
  - Expected: End 14:30 (no crossing)
  - Actual: No capping, 30min duration
  - ✅ Validates unaffected daytime triggers

- **Test Case 4: Early Morning Trigger**
  - Trigger: 01:00, Duration: 30min
  - Expected: End 01:30 (no crossing)
  - Actual: No capping, 30min duration
  - ✅ Validates early morning operation

#### 2. Midnight Boundary Edge Cases (4 tests)
Tests edge cases near the midnight boundary:

- Segment starting exactly at midnight (00:00)
- Segment ending exactly at 23:59 (maximum valid time)
- 1-minute segment near midnight (23:58-23:59)
- Maximum valid duration from 23:00 (59 minutes to 23:59)

#### 3. Duration Reduction Calculations (2 tests)
Verifies duration is correctly reduced when capping:

- 22:30 + 120min → capped to 22:30-23:59 (89min, 31min loss)
- 23:00 + 180min → capped to 23:00-23:59 (59min, 121min loss)

#### 4. Validation Before Sending to FoxESS (3 tests)
Safety checks that prevent invalid segments:

- Rejects segments with end time before start time
- Validates capped segments pass validation
- Validates all daytime segments pass validation

#### 5. Logging and Warnings (3 tests)
Verifies proper logging of midnight crossing events:

- Warning logged when midnight crossing detected
- Capping notification includes duration reduction details
- Error logged when validation fails

#### 6. FoxESS Constraint Compliance (1 test)
Comprehensive test ensuring no segment crosses midnight:

- Tests all 4 primary scenarios
- Verifies capping logic
- Confirms final segments are valid

## Test Results

```
Test Suites: 21 passed, 21 total (including existing test suites)
Tests:       360 total, 359 passed, 1 skipped
             ↑
             Includes 17 new midnight-crossing tests
```

### Individual Test Outputs

All 17 tests in midnight-crossing.test.js:
```
✅ should cap late evening trigger (23:30 start, 60min duration)
✅ should cap just-before-midnight trigger (23:50 start, 30min duration)
✅ should not cap daytime trigger (14:00 start, 30min duration)
✅ should not cap early morning trigger (01:00 start, 30min duration)
✅ should handle segment starting exactly at midnight (00:00)
✅ should accept segment ending at 23:59
✅ should handle 1-minute segment near midnight (23:58-23:59)
✅ should calculate maximum valid duration from 23:00 (59 minutes)
✅ should correctly calculate duration reduction from 22:30 + 120min
✅ should handle very large duration request from 23:00 + 180min
✅ should reject segment with end time before start time
✅ should pass validation after capping
✅ should pass validation for daytime segments
✅ should log warning when midnight crossing is detected
✅ should log capping notification with duration reduction details
✅ should log error when final validation fails
✅ should ensure no segment crosses midnight boundary
```

## Key Test Insights

### Midnight Crossing Detection
```javascript
const startTotalMins = startHour * 60 + startMinute;
const endTotalMins = endHour * 60 + endMinute;

if (endTotalMins <= startTotalMins) {
  // Midnight crossing detected - cap at 23:59
}
```

### Duration Loss Examples
| Scenario | Start | Requested | Capped End | Actual | Loss |
|----------|-------|-----------|-----------|--------|------|
| Late evening | 23:30 | 60min | 23:59 | 29min | 31min |
| Just before midnight | 23:50 | 30min | 23:59 | 9min | 21min |
| Very large | 23:00 | 180min | 23:59 | 59min | 121min |

### Unaffected Scenarios
- Daytime triggers (08:00, 12:00, 14:00, etc.) - No capping
- Early morning (01:00-06:00) - No capping
- Any trigger before 23:00 with duration ≤ 59min - No capping

## Code Under Test

The tests validate:
1. **Detection Logic** (lines 4945-4962 in functions/index.js)
   - Identifies when `endTotalMins <= startTotalMins`
   - Indicates modulo wraparound occurred

2. **Capping Logic** (lines 4945-4962)
   - Sets `endHour = 23, endMinute = 59`
   - Logs warning showing original vs capped times

3. **Validation** (lines 5000-5005)
   - Final safety check before API call
   - Ensures `endTotalMins > startTotalMins`
   - Throws error if invalid

## Running the Tests

```powershell
# Run only midnight-crossing tests
npm --prefix functions test -- midnight-crossing.test.js

# Run with verbose output
npm --prefix functions test -- midnight-crossing.test.js --verbose

# Run all tests (includes midnight-crossing)
npm --prefix functions test

# Run tests with coverage
npm --prefix functions test -- --coverage
```

## Integration with Automation

These tests ensure that the midnight-crossing fix:
1. ✅ Correctly detects segments that would cross midnight
2. ✅ Properly caps them at 23:59
3. ✅ Calculates duration reductions accurately
4. ✅ Passes final validation before FoxESS API calls
5. ✅ Logs all capping events for transparency
6. ✅ Never sends invalid segments to FoxESS

## Future Test Enhancements

Consider adding integration tests for:
- Full automation cycle with midnight-crossing rule
- FoxESS API response validation
- Database state updates with capped segments
- UI display of capped vs full duration
- Multiple time zones and DST transitions
