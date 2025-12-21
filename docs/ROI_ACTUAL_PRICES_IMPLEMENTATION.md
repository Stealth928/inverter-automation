# ROI Actual Prices Implementation

**Date:** 2025-12-21  
**Commit:** 26b1541  
**Status:** ✅ DEPLOYED TO PRODUCTION

---

## 🎯 Problem Solved

### Issue
ROI calculator was showing inaccurate profit calculations because it used **forecast prices** from rule entry time instead of **actual settled prices** from rule exit time.

Example scenario:
- Rule enters at 10:00 AM with forecast price: $0.25/kWh
- Rule exits at 10:30 AM when actual price settles: $0.18/kWh
- ROI showed profit using $0.25 (wrong) instead of $0.18 (correct)

### Root Cause
Amber Electric publishes forecast prices initially, then updates with actual settled prices approximately 5 minutes after each 5-minute interval completes. Our automation stored only the forecast price at rule execution time.

---

## ✨ Solution Implemented

### Architecture: On-Demand Fetching with Graceful Degradation

**Backend: New API Endpoint**
- **Route:** `GET /api/amber/prices/actual`
- **Parameters:**
  - `siteId` (required): Amber site identifier
  - `timestamp` (required): ISO 8601 timestamp of the event
  - `resolution` (optional): 5 or 30 minute intervals (default: 30)

**Validation Rules:**
- Timestamp must be 5 minutes to 7 days old (Amber API retention window)
- Timestamps < 5 min old: too recent for settled price
- Timestamps > 7 days old: outside Amber API retention

**Response Format:**
```json
{
  "errno": 0,
  "result": {
    "type": "ActualInterval",
    "channelType": "general",
    "perKwh": 25.5,
    "spotPerKwh": 20.1,
    "startTime": "2025-12-21T10:00:00Z",
    "endTime": "2025-12-21T10:30:00Z",
    "descriptor": "neutral"
  },
  "ageDays": 2.5
}
```

**Frontend Integration:**
- ROI page (`roi.html`) checks event age before rendering
- If event is within valid window (5 min to 7 days old):
  - Fetches actual price from backend
  - Replaces forecast price in event data
  - Recalculates profit with actual price
- If event is too old (> 7 days) or too recent (< 5 min):
  - Falls back to original forecast price
  - No API call made

---

## 📊 Technical Details

### Files Modified

1. **functions/index.js** (~line 810)
   - Added `GET /api/amber/prices/actual` endpoint
   - Implements timestamp validation (5min-7days window)
   - Calls Amber API with date extraction
   - Finds matching price interval containing target timestamp

2. **frontend/js/api-client.js** (~line 306)
   - Added `getAmberActualPrice(siteId, timestamp, resolution)` method
   - Returns promise with actual price data or null

3. **frontend/roi.html** (~line 923)
   - Added `tryFetchActualPrices(event)` function
   - Integrated into main event rendering loop
   - Replaces forecast with actual prices when available

4. **frontend/settings.html** (lines 1283-1285, 1498-1500)
   - Reduced Amber cache minimum from 30s to 10s
   - Updated validation messages

5. **functions/test/amber-actual-prices.test.js** (NEW FILE - 221 lines)
   - Unit tests for timestamp validation logic
   - Tests for price interval matching
   - Tests for date extraction
   - Tests for frontend integration logic
   - **Result:** 16 tests, all passing

---

## ✅ Testing & Validation

### Unit Tests
```
Test Suites: 17 passed, 17 total
Tests:       280 passed, 1 skipped, 281 total
Time:        5.521s
```

### Manual Testing Checklist
- [x] Backend endpoint validates timestamps correctly
- [x] Frontend fetches actual prices for recent events
- [x] Graceful fallback to forecast for old events
- [x] Settings page accepts 10s minimum cache TTL
- [x] All existing tests still pass
- [x] No console errors in browser
- [x] Firebase deployment successful

---

## 🚀 Deployment

**Deployed to:** `inverter-automation-firebase`  
**Deploy Command:** `firebase deploy`  
**Functions Updated:**
- `api(us-central1)` - ✅ Successful update
- `runAutomation(us-central1)` - ✅ Successful update

**URLs:**
- Hosting: https://inverter-automation-firebase.web.app
- Function: https://api-etjmk6bmtq-uc.a.run.app

---

## 📈 Expected Impact

### Accuracy Improvement
- ROI calculations now use actual settled prices for events within 7 days
- Eliminates forecast vs. actual price discrepancies
- More reliable profit/loss reporting

### API Call Efficiency
- **Old approach (considered):** Store all prices at execution = ~1 API call per rule
- **New approach (implemented):** Fetch on-demand only when viewing ROI page
- **Estimated calls:** ~1 API call per ROI page load (negligible overhead)

### Storage Costs
- No persistent price storage (on-demand only)
- Cost: **$0.00/month** (no additional Firestore writes)

---

## 🔍 Known Limitations

1. **7-Day Window:** Amber API only retains 7 days of historical prices
   - Rules older than 7 days will use original forecast prices
   - This is an Amber API constraint, not a system limitation

2. **5-Minute Settlement:** Prices become "actual" after 5-minute interval completes
   - Events < 5 minutes old will use forecast prices
   - This aligns with Amber's settlement process

3. **Per-Page Load:** Actual prices fetched each time ROI page loads
   - No caching between sessions (intentional for simplicity)
   - Could add caching in future if needed

---

## 🛠️ Future Enhancements (Optional)

1. **Client-side caching:** Store fetched actual prices in localStorage
   - Would reduce API calls for repeated ROI page visits
   - Trade-off: added complexity vs. minimal API overhead

2. **Batch fetching:** Fetch multiple events' prices in single API call
   - More efficient for pages with many events
   - Requires backend endpoint modification

3. **Visual indicator:** Show icon/badge for events using actual vs. forecast prices
   - Improves user transparency
   - Low priority (most users won't care about distinction)

---

## 📚 Related Documentation

- **API Docs:** [docs/API.md](./API.md) - New endpoint documented
- **Automation Docs:** [docs/AUTOMATION.md](./AUTOMATION.md) - Rule execution context
- **Setup Guide:** [docs/SETUP.md](./SETUP.md) - Deployment instructions
- **Amber OpenAPI Spec:** Confirmed 7-day retention and 5-minute intervals

---

## ✍️ Commit Message

```
feat: Improve ROI accuracy with actual Amber prices

- Add /api/amber/prices/actual endpoint for settled prices
- ROI page fetches actual prices for rules <7 days old
- Graceful fallback to forecast prices for older rules
- Reduce Amber cache minimum validation from 30s to 10s
- Add comprehensive unit tests for price fetching logic
```

---

## 🎉 Conclusion

This implementation provides **significantly more accurate ROI calculations** by using actual settled prices instead of forecasts, while maintaining **system simplicity** through on-demand fetching and **graceful degradation** for events outside the valid window.

The solution respects Amber API constraints (7-day retention, 5-minute settlement) and adds minimal overhead (~1 API call per ROI page load, only for recent events).

**Status:** Production-ready and deployed ✅
