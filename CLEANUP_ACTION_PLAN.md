# CLEANUP ACTION PLAN - Priority Queue

## Priority 0: Critical Bugs (Fixes Required Today)

### Bug #1: Weather API Response Format
- **File**: `functions/index.js` line 1044
- **Issue**: Backend returns unwrapped `{source, hourly, ...}` but frontend expects wrapped `{errno, result, hourly}`
- **Frontend affected**: `test.html`, `history.html`, `control.html`
- **Fix**: Wrap response in `{ errno: 0, result: { source, place, hourly, daily, ... } }`
- **Lines to change**: 1044 (return statement)
- **Time**: 5 minutes

### Bug #2: Report Chart Not Rendering
- **File**: `frontend/history.html` line 950-980
- **Issue**: Fixed in previous commit - verify data parsing works
- **Status**: Already fixed ✅

---

## Priority 1: Dead Code Removal (1-2 hours)

### Task 1.1: Remove `callAmberAPIDirect()` Function
- **File**: `functions/index.js` lines 950-952
- **Usage**: Only called once in line 878
- **Action**: Delete function, replace line 878 with direct `callAmberAPI()` call
- **Verification**: Search for "callAmberAPIDirect" - should find 0 results after fix

### Task 1.2: Remove `updateSharedCache()` Function
- **File**: `functions/index.js` line 2609
- **Issue**: Empty skeleton with no implementation
- **Action**: Delete lines 2609-2614

### Task 1.3: Remove `processUserAutomation()` Function
- **File**: `functions/index.js` line 2618
- **Issue**: Empty skeleton, comment says handled by backend server.js
- **Action**: Delete lines 2618-2620

### Task 1.4: Remove `/api/debug/setup-trace` Endpoint
- **File**: `functions/index.js` lines 246-285
- **Issue**: Debug-only endpoint, 40 lines, no frontend usage
- **Action**: Delete entire endpoint
- **Verification**: Grep for "setup-trace" in frontend - should return 0 results

---

## Priority 2: Duplicate Endpoints Consolidation (2-3 hours)

### Task 2.1: Consolidate Scheduler v0 → Remove
- **File**: `functions/index.js` 
- **Endpoints to remove**:
  - `/api/scheduler/get` (line 2380)
  - `/api/scheduler/flag` (line 2391)
- **Verification**: Search frontend for these endpoint calls - should be 0
- **Action**: Delete both endpoints entirely (30 lines total)
- **Time**: 30 minutes

### Task 2.2: Consolidate Amber Endpoints
- **Endpoints**:
  - `/api/amber/prices/current` (line 401)
  - `/api/amber/prices` (line 426)
- **Current issue**: Both do same thing with different response formats
- **Option A (Simple)**: Keep both, standardize response format to `{errno, result}`
- **Option B (Better)**: Merge into single `/api/amber/prices` with query params
  - `?type=current` or `?type=historical&startDate=...&endDate=...`
- **Recommended**: Option A (2 hours) → Option B later (refactor)
- **Time**: 2 hours

---

## Priority 3: Response Format Standardization (3-4 hours)

### Task 3.1: Standardize All Responses to `{errno, result}`
**Affected endpoints** (count: 15+):
- `/api/amber/*` - Currently inconsistent (array, wrapped, error)
- `/api/weather` - Currently `{source, hourly, ...}` (no errno)
- `/api/inverter/*` - Mix of formats
- `/api/scheduler/*` - Currently mixed

**Process**:
1. Create helper function `normalizeResponse(data, errno=0)` in functions/index.js
2. For each endpoint, wrap final response: `res.json(normalizeResponse(data))`
3. For errors: `res.json(normalizeResponse(null, errorCode))`
4. Update frontend parsing to assume single format

**Files to update**:
- Backend: `functions/index.js` (wrap all responses)
- Frontend: `test.html`, `history.html`, `control.html`, `index.html` (update parsing logic)

**Time**: 3-4 hours

---

## Priority 4: Redundant API Calls (2-3 hours)

### Task 4.1: Fix Amber Historical Prices Double-Fetch
- **File**: `functions/index.js` lines 818-900
- **Issue**: Imbalance detection discards cache and refetches full range
- **Fix**: Implement one of:
  - Option A: Never cache incomplete channels (simpler, ~30 min)
  - Option B: Implement partial cache merging (better, ~2 hours)
- **Recommended**: Option A

### Task 4.2: Fix Module List Double-Fetch
- **File**: `functions/index.js` line 2264
- **Issue**: `/api/module/signal` calls module list API when moduleSN not provided
- **Fix Options**:
  - A: Make moduleSN required parameter
  - B: Cache module list for 5 minutes
- **Recommended**: A (faster, simpler - 15 min)

### Task 4.3: Fix Metrics Timer Duplication
- **File**: `frontend/js/shared-utils.js` line 149
- **Issue**: Multiple pages can start timers without cleanup
- **Fix**: Implement singleton pattern
  ```javascript
  let metricsTimerId = null;
  function startMetricsAutoRefresh(intervalMs) {
      if (metricsTimerId) return; // Already running
      metricsTimerId = setInterval(loadApiMetrics, intervalMs);
  }
  window.addEventListener('beforeunload', () => {
      if (metricsTimerId) clearInterval(metricsTimerId);
  });
  ```
- **Time**: 20 minutes

---

## Priority 5: Logging Reduction (1-2 hours)

### Task 5.1: Add Debug Mode Flag
- **File**: `functions/index.js` line 28
- **Action**: Add to `getConfig()`:
  ```javascript
  debug: process.env.DEBUG_MODE === 'true'
  ```
- **Time**: 5 minutes

### Task 5.2: Reduce Verbose Logging
**Hot paths to simplify**:
- `callFoxESSAPI()` - 3+ logs per call → 1 log per call + error only
- `callAmberAPI()` - 4+ logs per call → 1 log per call + error only
- `findGaps()` - 5+ logs → 2 logs (start + gap summary)
- `authenticateUser()` - 2+ logs per request → 0 logs (or debug-only)

**Pattern**:
```javascript
// BEFORE
console.log('[FoxESS] Calling API...');
console.log('[FoxESS] Response:', resp);
console.log('[FoxESS] Status:', resp.status);

// AFTER
if (DEBUG) console.log('[FoxESS] Calling API...');
if (!resp.ok) console.error('[FoxESS] API failed:', resp.status);
```

**Time**: 1 hour

---

## Priority 6: Code Organization (2-3 hours)

### Task 6.1: Extract Constants to Config
**Magic numbers to centralize**:
```javascript
// In getConfig():
timeouts: {
  amber: 10000,
  foxess: 10000,
  weather: 15000
},
cache: {
  amberHistoryTTL: 30 * 24 * 60 * 60 * 1000,
  metricsRefreshInterval: 60000,
  moduleListTTL: 24 * 60 * 60 * 1000
},
limits: {
  channelImbalanceThreshold: 50,
  maxChunkDays: 30,
  metricsMaxDays: 30
}
```
- **Time**: 30 minutes

### Task 6.2: Create Response Normalization Module
- **File**: `functions/helpers/response.js` (new)
- **Exports**:
  ```javascript
  module.exports = {
    success: (data) => ({ errno: 0, result: data }),
    error: (code, message) => ({ errno: code, error: message }),
    debug: (data, debugInfo) => ({ ...data, _debug: debugInfo })
  };
  ```
- **Time**: 20 minutes
- **Impact**: Simplifies 50+ endpoints

---

## Implementation Timeline

### Week 1 (Sprint)
- **Monday**: Priority 0 (critical bugs) + Priority 1 (dead code) = 2-3 hours
- **Tuesday-Wednesday**: Priority 3 (response format) = 3-4 hours
- **Thursday**: Priority 4 (redundant calls) + Priority 5 (logging) = 2-3 hours
- **Friday**: Testing + Priority 6 (organization) = 2-3 hours

### Total Effort: 12-16 hours (~2 developer days)

---

## Verification Checklist

After each task, verify:

```bash
# Search for dead references
grep -r "callAmberAPIDirect" frontend/ functions/
grep -r "setup-trace" frontend/ functions/
grep -r "/api/scheduler/get[^/]" frontend/

# Verify response formats
grep -r "errno:" frontend/js/ | wc -l  # Should be consistent
grep -r "\.result" frontend/js/ | wc -l # Should be consistent

# Check logging
grep "console.log" functions/index.js | wc -l  # Should decrease by 50%

# Verify endpoints removed
curl -s https://api.example.com/api/debug/setup-trace  # Should 404
```

---

## Rollback Plan

If issues arise:
1. Keep git history for each commit
2. Tag before major refactors: `git tag pre-consolidation`
3. Can revert individual commits if needed
4. Test each change before moving to next

---

## Success Metrics

After cleanup:
- ✅ Code volume reduced by 15-20%
- ✅ API call count reduced by 20-30%
- ✅ Response time improved by 10-15%
- ✅ Console output reduced by 70%
- ✅ Dead code: 0 functions
- ✅ Duplicate endpoints: 0
- ✅ All responses follow `{errno, result}` format
- ✅ All tests pass

---

## Notes

- Do NOT merge cleanup without testing
- Each task is independent - can be done in any order within priority level
- Frontend changes depend on backend response format standardization
- Recommend code review for any changes >100 lines
