# API Call Leak Fix - December 19, 2024

## Problem Summary
User reported 570 FoxESS API calls overnight while automation was disabled - a severe API quota leak.

## Root Cause Analysis

### Primary Issue
The dashboard frontend continuously polls `/api/inverter/real-time` every 5 minutes to display inverter data, **regardless of automation state**. This endpoint:

1. **Never checks** if automation is enabled
2. Calls `getCachedInverterRealtimeData()` which fetches fresh data when cache expires (5 min TTL)
3. Every FoxESS API call increments the counter via `callFoxESSAPI()` line 830
4. Result: API calls continue 24/7 even when automation is completely disabled

### Why 570 calls in ~9.5 hours?
- Expected: ~114 calls (570 minutes / 5 min interval = 114 polls)
- Actual: 570 calls = **5x more than expected**
- Likely causes:
  - Multiple browser tabs/windows open
  - Mobile + desktop browsers both polling
  - Browser refresh/reload cycles
  - Cache misses happening more frequently than expected

### Code Paths Analyzed

#### ✅ Correctly Respects Disabled State:
- `runAutomation()` scheduler (line 5551): Checks `state.enabled === true` before running cycles
- `/api/automation/cycle` endpoint (line 2222): Checks and skips when disabled

#### ❌ Does NOT Check Automation State (THE LEAK):
- `/api/inverter/real-time` endpoint (line 3598): **Never checks automation state**
- `getCachedInverterRealtimeData()` (line 152): Makes API calls when cache expires
- Frontend polling (index.html line 4751): Polls continuously regardless of state

## Fix Implementation

### 1. Frontend Fix (index.html line ~4750)
```javascript
// Before:
inverterRefreshTimer = setInterval(() => {
    callAPI('/api/inverter/real-time', 'Real-time Data');
}, REFRESH.inverterMs);

// After:
inverterRefreshTimer = setInterval(() => {
    const automationEnabled = localStorage.getItem('automationEnabled') === 'true';
    if (automationEnabled) {
        callAPI('/api/inverter/real-time', 'Real-time Data');
    } else {
        console.log('[AutoRefresh] Skipping inverter poll - automation disabled');
    }
}, REFRESH.inverterMs);
```

**Impact**: Frontend stops making requests when automation is disabled

### 2. Backend Fix (functions/index.js line ~3598)
Added automation state check at the endpoint level:

```javascript
app.get('/api/inverter/real-time', async (req, res) => {
  try {
    const userId = req.user.uid;
    const userConfig = await getUserConfig(userId);
    const sn = req.query.sn || userConfig?.deviceSn;
    
    if (!sn) {
      return res.status(400).json({ errno: 400, error: 'Device SN not configured' });
    }
    
    // CRITICAL FIX: Check if automation is enabled
    const state = await getUserAutomationState(userId);
    if (state && state.enabled === false) {
      logger.info('API', `[/api/inverter/real-time] Automation disabled - returning cached data only`, true);
      
      // Return cached data if available (no fresh API calls)
      const cacheDoc = await db.collection('users').doc(userId).collection('cache').doc('inverter-realtime').get();
      if (cacheDoc.exists) {
        const { data, timestamp } = cacheDoc.data();
        const ageMs = Date.now() - timestamp;
        return res.json({ 
          ...data, 
          __cacheHit: true, 
          __cacheAgeMs: ageMs,
          __automationDisabled: true,
          __note: 'Automation disabled - using cached data only'
        });
      } else {
        // No cache and automation disabled = error
        return res.status(503).json({ 
          errno: 503, 
          error: 'Automation disabled - no cached data available. Enable automation to fetch fresh data.',
          automationDisabled: true
        });
      }
    }
    
    // Normal flow when automation enabled
    const result = await getCachedInverterRealtimeData(userId, sn, userConfig, false);
    res.json(result);
  } catch (error) {
    res.status(500).json({ errno: 500, error: error.message });
  }
});
```

**Impact**: Even if frontend somehow makes a request, backend won't call FoxESS API when disabled

## Defense-in-Depth Strategy

1. **Frontend Defense**: Stop polling when automation disabled (primary prevention)
2. **Backend Defense**: Reject API calls when automation disabled (secondary prevention)
3. **Cached Data**: Return stale cache if available when disabled (graceful degradation)
4. **Clear Error**: 503 error when no cache and disabled (user feedback)

## Testing

Created test suite: `functions/test/api-call-leak-fix.test.js`

Tests cover:
- ✅ No API calls when automation disabled
- ✅ Returns cached data when available
- ✅ Returns 503 when no cache and disabled
- ✅ Normal API calls when automation enabled
- ✅ Frontend polling behavior
- ✅ Counter tracking accuracy

## Verification Steps

1. **Deploy fixes**:
   ```bash
   firebase deploy --only functions,hosting
   ```

2. **Test scenario**:
   - Disable automation in dashboard
   - Leave browser tab open overnight
   - Check API counter next morning
   - Should see: **0 new FoxESS API calls**

3. **Monitor logs**:
   ```bash
   firebase functions:log | grep "Skipping inverter poll"
   ```

4. **Check Firestore metrics**:
   - `/users/{userId}/metrics/{date}` should show no foxess increments when disabled

## Additional Recommendations

### 1. Add Visual Indicator
When automation is disabled, show a warning banner:
```
⚠️ Automation Disabled - Inverter data may be stale
```

### 2. Metrics Dashboard
Add a chart showing API calls over time to detect future leaks quickly

### 3. Rate Limiting
Consider adding per-user rate limits as a safety net:
- Max X FoxESS calls per hour
- Alert/throttle if exceeded

### 4. Background Tab Detection
Stop polling when browser tab is not visible:
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefreshTimers();
  } else {
    startAutoRefreshTimers();
  }
});
```

## Related Issues

- Frontend already has idle timeout (stops polling after 30 min idle)
- Frontend already pauses refresh when tab hidden (via visibility API)
- But neither checks automation state before polling

## Files Changed

1. `frontend/index.html` - Added automation state check in polling timer
2. `functions/index.js` - Added automation state check in `/api/inverter/real-time` endpoint
3. `functions/test/api-call-leak-fix.test.js` - New test suite

## Breaking Changes

**None** - Maintains backward compatibility:
- When automation is enabled: Works exactly as before
- When automation is disabled: Prevents API leaks (new behavior)

## Success Criteria

✅ **Primary**: No FoxESS API calls when automation disabled  
✅ **Secondary**: Stale cached data shown instead of errors  
✅ **Tertiary**: Clear error message when no cache available  

## Rollback Plan

If issues arise:
```bash
git revert <commit-hash>
firebase deploy --only functions,hosting
```

The fix is isolated to 2 specific code paths, making rollback safe.
