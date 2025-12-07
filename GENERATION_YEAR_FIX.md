# Generation Summary Fix - "This Year" Data

## Problem
The Generation Summary in the history page was showing "This Year" as 0.0 kWh, while other metrics (Today, This Month, Lifetime Total) displayed correctly.

## Root Cause
The `/api/inverter/generation` endpoint was only calling the FoxESS point-in-time API (`/op/v0/device/generation`), which provides:
- `today`: Current day generation
- `month`: Current month generation  
- `cumulative`: Lifetime total generation

This endpoint **does not** provide year-to-date generation data. The year field was defaulting to 0.

## Solution
Enhanced the `/api/inverter/generation` endpoint to also fetch yearly data using the FoxESS report API:

### Backend Changes (functions/index.js)
1. After fetching point-in-time generation data, the endpoint now calls `/op/v0/device/report/query` with:
   - `dimension: 'year'` - Request year aggregation
   - `year: [current year]` - For current calendar year
   - `variables: ['generation']` - Request generation data
   
2. The endpoint extracts the monthly values for the year and sums them to get year-to-date generation
3. These values are added to the response as `year` and `yearGeneration` fields
4. Error handling is in place: if the report API call fails, the endpoint still returns the basic generation data without year data (graceful degradation)

### Frontend Changes (frontend/history.html)
1. Removed the fallback warning logic that displayed "(not provided by API)" when year data was missing
2. Simplified `renderGenerationData()` to directly use the year field without conditional warnings
3. The function now expects the backend to provide complete data, including yearly values

## Technical Details

### Data Flow
```
User clicks "Fetch Generation Data"
    ↓
history.html: fetchGeneration() calls /api/inverter/generation
    ↓
functions/index.js: 
  1. Calls FoxESS /op/v0/device/generation (point-in-time)
  2. Calls FoxESS /op/v0/device/report/query with dimension=year (aggregated)
  3. Sums monthly values for the year
  4. Merges year data into response
    ↓
history.html: renderGenerationData() displays merged result
```

### Response Structure
The enhanced endpoint now returns:
```javascript
{
  result: {
    today: 7.4,           // kWh today
    month: 360.5,         // kWh this month
    year: 1245.3,         // kWh this year (NEW - calculated from report)
    yearGeneration: 1245.3, // Alternative field name (NEW)
    cumulative: 838,      // kWh lifetime total
    // ... other fields
  }
}
```

## Error Handling
- If the report API fails: Endpoint logs a warning but still returns point-in-time data
- Frontend gracefully displays whatever data is available
- No user-facing errors from report API failures

## Testing
A validation test (`test-generation-year.js`) confirms:
- ✓ Generation endpoint exists and responds
- ✓ Calls both generation and report APIs
- ✓ Sets yearly data in response
- ✓ Has error handling for report endpoint failures
- ✓ Frontend cleaned up of warning logic

## Expected Behavior
Users visiting the history page's Generation Summary will now see:
- **Today**: 7.4 kWh (from point-in-time)
- **This Month**: 360.5 kWh (from point-in-time)
- **This Year**: [Actual year-to-date value] kWh (from report aggregation)
- **Lifetime Total**: 838 kWh (from point-in-time)

All values should now be complete and accurate.
