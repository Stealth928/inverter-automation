# Amber Historical Prices - Comprehensive Test Guide

## Pre-Testing Setup

### Requirements
- Amber API key configured in Settings
- At least 7 days of historical data available
- Internet connection
- Modern browser (Chrome, Firefox, Safari, Edge)

### Quick Check
1. Navigate to History & Reports page
2. Verify date pickers show sensible defaults
3. Verify "📈 Fetch Prices" button is visible
4. Verify Chart canvas element exists

---

## Test Case 1: Default State on Page Load

**Objective:** Verify page initializes correctly

**Steps:**
1. Clear browser cache (optional but recommended)
2. Navigate to `/history.html`
3. Scroll to "💰 Amber Price History" section

**Expected Results:**
- ✓ Start Date field contains a date 7 days ago
- ✓ End Date field contains today's date
- ✓ Resolution selector set to "30-minute"
- ✓ Chart container is visible but empty
- ✓ Statistics panel is hidden
- ✓ Promo banner explains the feature

**Failed?** Check browser console for errors

---

## Test Case 2: Successful Data Fetch (Happy Path)

**Objective:** Verify complete workflow with valid inputs

**Steps:**
1. Click "📈 Fetch Prices" button
2. Wait for loading to complete (2-10 seconds)
3. Observe the results

**Expected Results:**
- ✓ Button shows "⏳ Loading prices..." during fetch
- ✓ Status message shows "⏳ Fetching historical prices..."
- ✓ After completion, status shows "✓ Loaded XXX price intervals"
- ✓ Chart displays with orange and blue lines
- ✓ Chart shows interactive legend
- ✓ Statistics panel appears with 6 stat boxes
- ✓ All stat boxes show numeric values with ¢ symbol
- ✓ Stat boxes have appropriate colors (green/red)
- ✓ Timestamp updates to current time

**Failed?** Check:
- Internet connection
- Amber API key configured
- Browser console for errors
- API rate limiting

---

## Test Case 3: Chart Interactivity

**Objective:** Verify chart responds to user input

**Steps:**
1. Complete Test Case 2 (get chart displayed)
2. Hover over various points on the chart
3. Click legend items (Buy Price / Feed-in Price)

**Expected Results:**
- ✓ Tooltip appears on hover with format: "Buy Price (¢/kWh): XX.XX¢"
- ✓ Tooltip shows correct value for hovered point
- ✓ Clicking legend item toggles line visibility
- ✓ Both lines can be toggled independently
- ✓ Chart maintains aspect ratio on hover

**Failed?** Check:
- Chart.js library loaded (check Network tab)
- JavaScript console for Chart.js errors
- Browser version compatibility

---

## Test Case 4: Date Validation - Start Before End

**Objective:** Verify validation prevents invalid date ranges

**Steps:**
1. Set Start Date to tomorrow's date
2. Set End Date to today's date
3. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ Status shows error: "✗ Start date must be before end date"
- ✓ Button returns to normal state
- ✓ No API call is made
- ✓ Error message is red background
- ✓ Error auto-dismisses after 3 seconds

**Test Passes?** Move to next test
**Test Fails?** Check validation logic in JavaScript

---

## Test Case 5: Date Validation - Future Dates

**Objective:** Verify system prevents querying future data

**Steps:**
1. Click End Date picker
2. Try to select a future date (tomorrow or later)
3. Note if picker allows selection

**Expected Results:**
- ✓ Future dates not selectable in date picker (native browser behavior)
- OR if selectable:
  - Click "📈 Fetch Prices"
  - Status shows error: "✗ End date cannot be in the future"
  - No API call is made

**Note:** HTML5 date input may prevent this on most browsers

**Test Passes?** Move to next test

---

## Test Case 6: Date Validation - Maximum Range

**Objective:** Verify 90-day maximum range is enforced

**Steps:**
1. Set Start Date to 95 days ago
2. Set End Date to today
3. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ Status shows error: "✗ Maximum range is 90 days (you selected 95 days)"
- ✓ Button returns to normal state
- ✓ No API call is made
- ✓ Error is clear and actionable

**Test Passes?** Move to next test

---

## Test Case 7: Date Validation - Missing Fields

**Objective:** Verify required fields are enforced

**Steps:**
1. Clear Start Date field (delete the value)
2. Keep End Date filled
3. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ Status shows error: "✗ Start date is required"
- ✓ No API call made

**Steps (Part 2):**
1. Fill Start Date
2. Clear End Date field
3. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ Status shows error: "✗ End date is required"
- ✓ No API call made

**Test Passes?** Move to next test

---

## Test Case 8: Large Date Range Warning

**Objective:** Verify warning for large ranges (informational only)

**Steps:**
1. Set Start Date to 30 days ago
2. Set End Date to today
3. Open browser console (F12)
4. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ Fetch completes normally
- ✓ In browser console: "[Prices] Warning: Large range (30 days) may take a moment to load"
- ✓ UI still shows success message
- ✓ Chart displays all data

**Note:** This is a console warning, not a user-facing error

**Test Passes?** Move to next test

---

## Test Case 9: Resolution Options

**Objective:** Verify both resolution options work

**Steps:**
1. Set date range to 3 days
2. Set Resolution to "5-minute"
3. Click "📈 Fetch Prices"
4. Note the number of intervals loaded

**Expected Results:**
- ✓ Status shows success with interval count
- ✓ Chart displays smooth data
- ✓ ~288 intervals for 3 days (3*24*60/5)

**Steps (Part 2):**
1. Set same date range to 3 days
2. Set Resolution to "30-minute"
3. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ Status shows success with interval count
- ✓ Chart displays less dense data
- ✓ ~144 intervals for 3 days (3*24*60/30)
- ✓ Chart loads faster than 5-minute resolution

**Test Passes?** Move to next test

---

## Test Case 10: Statistics Accuracy

**Objective:** Verify statistics are calculated correctly

**Prerequisites:** Successful data fetch (Test Case 2)

**Steps:**
1. Note the Buy Price min/avg/max values
2. Examine the orange line on chart
3. Verify the min value matches lowest point on orange line
4. Verify the max value matches highest point on orange line

**Expected Results:**
- ✓ Min value is visually lowest point on orange line
- ✓ Max value is visually highest point on orange line
- ✓ Avg value is between min and max
- ✓ Same for feed-in prices on blue line

**Manual Verification:**
1. Hover over lowest point: value ≈ min stat box
2. Hover over highest point: value ≈ max stat box

**Test Passes?** Move to next test

---

## Test Case 11: Mobile Responsiveness

**Objective:** Verify UI works on mobile/tablet

**Steps:**
1. Open DevTools (F12)
2. Enable Device Emulation
3. Select iPhone 12 (or other mobile device)
4. Refresh page
5. Scroll to Amber section

**Expected Results:**
- ✓ Date inputs stack vertically on mobile
- ✓ Button is full-width or properly sized
- ✓ Statistics panel wraps gracefully (2-3 columns)
- ✓ Chart is visible and interactive
- ✓ No horizontal scrolling required

**Steps (Part 2):**
1. Select iPad (or tablet device)
2. Refresh page

**Expected Results:**
- ✓ Layout adjusts appropriately for tablet
- ✓ Still fully functional
- ✓ Statistics show in 3 columns

**Test Passes?** Move to next test

---

## Test Case 12: Error Handling - No Sites

**Objective:** Verify graceful error when no Amber sites available

**Precondition:** Amber API key not configured or invalid

**Steps:**
1. Go to Settings and clear Amber API key
2. Return to History page
3. Click "📈 Fetch Prices"

**Expected Results:**
- ✓ After short wait, status shows error
- ✓ Error message: "✗ No Amber sites available. Please configure your Amber API key in settings."
- ✓ Clear call-to-action to go to Settings
- ✓ Chart area shows error state
- ✓ Button returns to normal

**Test Passes?** Move to next test

---

## Test Case 13: Error Handling - Network Timeout

**Objective:** Verify timeout handling

**Steps:**
1. Use DevTools Network throttle (Throttle → Offline)
2. Set date range
3. Click "📈 Fetch Prices"
4. Wait for timeout (10 seconds)

**Expected Results:**
- ✓ After timeout, status shows error
- ✓ Error message indicates timeout or network issue
- ✓ Button returns to normal
- ✓ User can retry

**Steps (Part 2):**
1. Return network to normal (Throttle → No throttling)
2. Click "📈 Fetch Prices" again

**Expected Results:**
- ✓ Request succeeds
- ✓ Data loads normally

**Test Passes?** Move to next test

---

## Test Case 14: Multiple Consecutive Fetches

**Objective:** Verify app handles repeated queries correctly

**Steps:**
1. Fetch data for 3 days
2. Wait for completion
3. Fetch data for 7 days without clearing previous data
4. Wait for completion

**Expected Results:**
- ✓ First chart displays
- ✓ Second fetch overwrites first chart
- ✓ New statistics calculated
- ✓ No memory errors or performance degradation
- ✓ Browser console clean (no warnings)

**Repeat:**
1. Fetch data for 7 days
2. Change resolution to 5-minute
3. Fetch same date range again

**Expected Results:**
- ✓ Chart updates with new resolution
- ✓ Statistics recalculate
- ✓ No duplicate charts or memory leaks

**Test Passes?** Move to next test

---

## Test Case 15: Browser Compatibility

**Objective:** Verify feature works across browsers

**Test in each browser:**
1. Chrome/Chromium
2. Firefox
3. Safari
4. Edge

**Steps (in each):**
1. Load History page
2. Fetch 3-day price range
3. Interact with chart
4. Check browser console

**Expected Results in all browsers:**
- ✓ Page loads without errors
- ✓ Data fetches successfully
- ✓ Chart displays correctly
- ✓ Chart is interactive
- ✓ Statistics accurate
- ✓ No console errors

---

## Test Case 16: CSS and Styling

**Objective:** Verify UI appearance is consistent

**Steps:**
1. Compare colors to design system:
   - Orange (#f0883e) for buy prices
   - Blue (#58a6ff) for feed-in prices
   - Green (#7ee787) for good values
   - Red (#f85149) for bad values
   - Grey (#8b949e) for neutral
2. Check spacing matches other cards
3. Verify font sizes are consistent
4. Check dark theme is applied

**Expected Results:**
- ✓ All colors match design system
- ✓ Spacing consistent with page
- ✓ Typography matches application
- ✓ Dark theme applied throughout
- ✓ No broken layout or text cutoff

**Test Passes?** Move to next test

---

## Test Case 17: Accessibility

**Objective:** Verify keyboard navigation and screen reader support

**Steps:**
1. Open page
2. Press Tab repeatedly
3. Verify focus moves through: Start Date → End Date → Resolution → Button
4. Press Enter to interact with focused elements
5. Test with screen reader (optional - NVDA, JAWS, etc.)

**Expected Results:**
- ✓ Tab order is logical
- ✓ All controls are keyboard accessible
- ✓ Labels are associated with inputs
- ✓ Error messages announced by screen reader
- ✓ Status updates announced

**Test Passes?** All validation complete

---

## Performance Testing

### Load Time Benchmarks

```
Date Range  Resolution  Expected Load Time
3 days      30-min      2-3 seconds
7 days      30-min      3-5 seconds
14 days     30-min      5-8 seconds
30 days     30-min      8-15 seconds
90 days     30-min      20-30 seconds

3 days      5-min       4-6 seconds
7 days      5-min       6-10 seconds
```

**Test:**
1. Open DevTools Network tab
2. Fetch 7-day range
3. Note "Finish" time

**Expected:** ~4-5 seconds for 7-day 30-min range

**If slower:**
- Check network speed (DevTools throttle)
- Check API server response time
- Check browser performance (other tabs)

---

## Documentation Tests

### Test Case 18: Documentation Completeness

**Verify these files exist and are complete:**
- ✓ `AMBER_HISTORICAL_PRICES.md` (User guide)
- ✓ `IMPLEMENTATION_SUMMARY.md` (Technical overview)
- ✓ `DEPLOYMENT_CHECKLIST.md` (Deployment guide)
- ✓ `QUICK_REFERENCE.md` (Quick guide)

**Each should contain:**
- ✓ Clear title and description
- ✓ Table of contents or sections
- ✓ Step-by-step instructions
- ✓ Examples or use cases
- ✓ Troubleshooting section
- ✓ Links to other docs

---

## Final Verification Checklist

**Before declaring "READY FOR PRODUCTION":**

- [ ] All 18 test cases passed
- [ ] No console errors or warnings
- [ ] Performance acceptable for target date ranges
- [ ] Mobile responsive verified
- [ ] Browser compatibility verified
- [ ] Styling matches design system
- [ ] Accessibility features working
- [ ] Documentation complete and accurate
- [ ] Error messages helpful and clear
- [ ] Statistics calculations verified
- [ ] Chart rendering smooth
- [ ] No memory leaks detected
- [ ] API integration working
- [ ] Validation working correctly

---

## Test Execution Summary

**Date:** ___________
**Tester:** ___________
**Browser:** ___________
**OS:** ___________

**Results:**
- [ ] All tests PASSED
- [ ] Some tests failed (note below)
- [ ] Critical issues found (note below)

**Notes/Issues:**
```
[Record any issues found during testing]
```

**Sign-off:** ___________

---

## Quick Retest After Bug Fixes

If issues were found and fixed:

1. Run Test Case 2 (Happy Path) - ensures basic functionality
2. Run specific test case that failed
3. Run Test Case 14 (Multiple Fetches) - ensures no regressions
4. Run Test Case 16 (Styling) - ensures UI still intact
5. Check browser console for new errors

If all pass → ready to re-deploy
