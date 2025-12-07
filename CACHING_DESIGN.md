# Caching Architecture & Design

**Last Updated:** December 7, 2025  
**Scope:** Complete scan of all caching logic in functions, frontend, and Firestore

---

## 1. Executive Summary

The inverter-automation project uses a **multi-layered caching strategy**:
- **Per-user Firestore cache** for inverter telemetry and API history
- **Shared Firestore cache** for Amber pricing (global across all users)
- **Frontend localStorage** for test.html simulation state only (not used in production)

**Cache Location:** `users/{uid}/cache/{docId}` in Firestore

---

## 2. Cache Layer Overview

### 2.1 Inverter Data Cache

**Location:** `users/{uid}/cache/inverter`

**Purpose:** Cache FoxESS real-time inverter telemetry (SoC, temperatures, power flows)

**TTL Configuration:**
- Default: 300,000ms (5 minutes) - defined in config at line 46
- User override: `userConfig.automation.inverterCacheTtlMs` (if not set, falls back to default)
- **Important:** Currently, the user-configurable TTL field was removed from frontend (reverted during recent cleanup)

**Data Structure:**
```javascript
{
  data: {
    errno: 0,
    result: [{
      datas: [
        { name: 'SoC', value: 52 },
        { name: 'batTemperature', value: 29.6 },
        // ... other telemetry
      ]
    }]
  },
  timestamp: 1764926047652,  // When cached
  ttlMs: 300000              // TTL in milliseconds
}
```

**Validation Logic:**
- On each automation cycle, `getCachedInverterData()` is called (line 1590 in automation cycle)
- If `Date.now() - timestamp < ttlMs`, return cached data with `__cacheHit: true`
- Otherwise, fetch fresh from FoxESS and update cache
- Cache write failures are logged but don't block the cycle

**Function:** `getCachedInverterData()` (lines 61-107)

---

### 2.2 Amber Prices Cache

**Location:** `amber_prices/{siteId}` (global, shared across all users)

**Purpose:** Cache Amber electricity pricing data to minimize API calls (~100 req/hr limit)

**TTL:** 60 seconds (defined in config line 47)

**Data Structure:**
```javascript
{
  siteId: "ABC123",
  prices: [
    {
      startTime: "2025-12-07T12:00:00Z",
      endTime: "2025-12-07T12:30:00Z",
      perKwh: 25.5,                    // cents per kWh
      channelType: "general",          // "general" (buy) or "feedIn" (export)
      // ... other fields
    },
    // ... more price intervals (30-min chunks)
  ],
  lastUpdated: "2025-12-07T12:15:00Z",
  priceCount: 48
}
```

**Validation Logic:**
- When prices are needed, `getCachedAmberPrices(siteId, startDate, endDate)` is called
- Returns prices within requested date range that are cached
- If gaps exist in coverage, `findGaps()` identifies which ranges need API calls
- New prices fetched from Amber API are merged with existing via deduplication on `(startTime, channelType)` composite key
- Merged prices stored back via `cacheAmberPrices()`

**Functions:**
- `getCachedAmberPrices()` (lines 760-784)
- `findGaps()` (lines 789-848)
- `cacheAmberPrices()` (lines 856-900)

---

### 2.3 Inverter History Cache

**Location:** `users/{uid}/cache/history_{sn}_{begin}_{end}`

**Purpose:** Cache FoxESS historical data (generationPower, feedinPower, gridConsumptionPower) to reduce repeated API calls for same time range

**TTL:** 30 minutes (hardcoded in `getHistoryFromCacheFirestore()` at line 3745)

**Data Structure:**
```javascript
{
  timestamp: 1764926047652,
  data: {
    errno: 0,
    result: [{
      datas: [
        { time: '2025-12-07 12:00', generationPower: 4500, feedinPower: 2000, ... },
        // ... hourly data points
      ]
    }]
  }
}
```

**Why Multiple Docs:** The screenshot shows many `history_60KB10305AKA064_17644...` documents because:
- Each unique `(sn, begin, end)` tuple creates a separate cache entry
- FoxESS API limits responses to 24-hour windows (MAX_RANGE_MS)
- For longer requested ranges, the system chunks into 24-hour pieces
- Each chunk is cached independently with its own TTL

**Validation Logic:**
- When `/api/inverter/history` endpoint is called with date range, `getHistoryFromCacheFirestore()` checks for cached entry
- Cache key is composite: `history_{sn}_{begin}_{end}`
- If found and `Date.now() - timestamp < 30min`, return cached result
- Otherwise, fetch from FoxESS (potentially in multiple 24-hour chunks) and cache each chunk separately

**Functions:**
- `getHistoryFromCacheFirestore()` (lines 3739-3755)
- `setHistoryToCacheFirestore()` (lines 3757-3770)
- Called from `/api/inverter/history` endpoint (lines 3606-3680)

**Example Scenario:**
```
User requests history for Dec 1-7 (7 days = 168 hours)
→ System splits into chunks:
  - history_{sn}_1701388800000_1701475200000 (Dec 1, 24hr)
  - history_{sn}_1701475200000_1701561600000 (Dec 2, 24hr)
  - history_{sn}_1701561600000_1701648000000 (Dec 3, 24hr)
  ... etc
→ Each cached separately for 30 minutes
→ Subsequent requests for Dec 1-7 hit ALL chunks from cache
→ Only requests for NEW dates (after cache expires) trigger fresh API calls
```

---

### 2.4 Frontend localStorage (test.html only)

**Location:** Browser `localStorage` (not Firestore, not production)

**Items:**
- `cachedInverter` - Mock inverter data for automation lab
- `cachedPrices` - Mock Amber prices (includes feedIn and general channels)
- `cachedWeather` - Mock weather data
- `cacheState` - Metadata about what's cached
- `amberSiteId` - Selected Amber site ID

**Scope:** Used ONLY in `frontend/test.html` for the automation lab simulation feature

**TTL:** None (persistent in browser storage)

**Functions:** Set/loaded in test.html around lines 1027-1189

**Not Used In:** Production automation, API calls, or any backend logic

---

## 3. Configuration Overview

### 3.1 Default TTLs (in functions/index.js, lines 44-50)

```javascript
cacheTtl: {
  amber: 60000,      // 60 seconds - Amber pricing
  inverter: 300000,  // 5 minutes - Inverter telemetry (FoxESS)
  weather: 1800000   // 30 minutes - Weather forecasts
}
```

### 3.2 No Runtime Configuration

**Important:** User-facing TTL configuration was reverted during cleanup. The code still references `userConfig?.automation?.inverterCacheTtlMs` but:
- The frontend settings field was removed
- Users cannot currently override TTL
- Falls back to hardcoded defaults in config

---

## 4. Cache Mechanics

### 4.1 Inverter Data Flow

```
Automation Cycle (every 60s)
  ↓
getCachedInverterData(userId, deviceSN, userConfig, false)
  ↓
  Does cache exist at users/{uid}/cache/inverter?
  ├─ YES: Is age < TTL (300s default)?
  │   ├─ YES → Return cached data + __cacheHit: true ✅
  │   └─ NO  → Fetch fresh FoxESS
  └─ NO: Fetch fresh FoxESS
      ↓
      callFoxESSAPI(/op/v0/device/real/query)
      ↓
      Store result in cache (merge: true, so only updates data/timestamp/ttlMs)
      ↓
      Return fresh data + __cacheHit: false
```

**FoxESS Variables Cached:**
```
'SoC', 'batTemperature', 'ambientTemperation', 'pvPower', 
'loadsPower', 'gridConsumptionPower', 'feedinPower'
```

### 4.2 Amber Prices Flow

```
Automation Rule Evaluation / Prices Endpoint
  ↓
getCachedAmberPrices(siteId, startDate, endDate)
  ↓
Load all cached prices for siteId from amber_prices/{siteId}
  ↓
Filter to requested date range
  ├─ Full coverage → Return from cache ✅
  └─ Gaps exist → findGaps() returns ranges needing API calls
      ↓
      callAmberAPI() for each gap
      ↓
      cacheAmberPrices(siteId, newPrices)
      ├─ Merge new with existing (dedupe on startTime + channelType)
      ├─ Sort all by startTime
      └─ Save merged array back
```

### 4.3 History Cache Flow

```
GET /api/inverter/history?begin=X&end=Y
  ↓
If range ≤ 24 hours:
  ├─ Check: getHistoryFromCacheFirestore(userId, sn, begin, end)
  ├─ HIT → Return cached result ✅
  └─ MISS → Fetch FoxESS, cache, return
      
If range > 24 hours:
  ├─ Split into 24-hour chunks
  ├─ For each chunk:
  │   ├─ Check cache for chunk
  │   ├─ HIT → Use cached result ✅
  │   └─ MISS → Fetch FoxESS, cache chunk individually
  └─ Merge all chunk results into single response
```

---

## 5. Storage & Cleanup

### 5.1 Firestore TTL Policy (NOT ENABLED)

The code includes TTL fields in some documents but **Firestore TTL auto-cleanup is NOT configured**:

```javascript
// Example: audit logs had ttl field
ttl: Math.floor(48 * 60 * 60)  // 48 hours in seconds
```

**Current Reality:**
- History cache documents do NOT have TTL - they persist indefinitely
- Inverter cache documents do NOT have TTL - they persist indefinitely  
- Amber prices cache grows indefinitely as new prices are added
- **Manual cleanup would be needed** or TTL policy must be enabled in Firestore console

### 5.2 Storage Cost Estimate

Per user:
- **Inverter cache:** ~10KB per 5-min refresh = ~300KB/day = ~9MB/month
- **History cache:** ~100KB per 24-hr chunk cached = ~3MB/month (varies by usage)
- **Total per user:** ~10-15MB/month at high usage

Global (shared):
- **Amber prices cache:** ~50KB per site, grows ~5KB/day = ~150KB/month per site
- **5 sites:** ~750KB/month

---

## 6. Issues & Observations

### 6.1 Status of Previous Issues

All identified issues have been **FIXED** as of this update:

1. ✅ **Weather Cache Now Implemented**
   - `getCachedWeatherData()` function added (lines 1224-1266)
   - Caches to `users/{uid}/cache/weather` with 30-min TTL
   - Integrates with Firestore TTL auto-cleanup

2. ✅ **Firestore TTL Fields Added**
   - Inverter cache: `ttl` field in seconds (line 98)
   - Weather cache: `ttl` field in seconds (line 1251)
   - History cache: `ttl` field in seconds (line 3821)
   - Amber prices cache: `ttl` field in seconds (line 893)
   - All set to appropriate expiration times for auto-cleanup

3. ✅ **Documentation Updated**
   - SETUP.md now shows actual cache structure (lines 228-232)
   - API.md expanded with complete cache info (lines 526-531)
   - AUTOMATION.md references corrected
   - This design document created with comprehensive details

### 6.2 Remaining Configuration (Manual)

1. **History Cache Uses Different TTL Than Others**
   - Inverter: 5 minutes (config-driven)
   - History: 30 minutes (hardcoded at line 3745)
   - Amber: 60 seconds (config-driven)
   - **Reason:** History cache is expensive (large data), so longer TTL makes sense

2. **Inverter Cache TTL Configuration Is Dead Code**
   - Code checks `userConfig?.automation?.inverterCacheTtlMs`
   - But frontend field was removed (reverted)
   - Falls back to default 5 minutes always

3. **No Composite Key Conflict Prevention for History Cache**
   - Cache key format: `history_{sn}_{begin}_{end}` (lines 3741, 3766)
   - If FoxESS SN contains special chars, could cause key collisions
   - Very unlikely in practice (SNs are alphanumeric)

### 6.2 Remaining Configuration (Manual)

**Important:** TTL fields are now in all cache documents, but **Firestore TTL Policy must still be manually enabled** in Firebase Console:

1. Navigate to Firestore → Collections
2. For each collection (`users/{uid}/cache`, `amber_prices`):
   - Click "TTL" button
   - Set `ttl` as the TTL field
3. Firestore will automatically delete expired documents

---

### 6.3 Inconsistencies Found (Resolved)

---

## 7. Complete Cache Directory Listing

### In Firestore

**Per-User:**
```
users/{uid}/cache/
  ├── inverter                    # Single doc, per-user
  └── history_{sn}_{begin}_{end}  # Multiple docs, one per chunked query
```

**Global:**
```
amber_prices/
  └── {siteId}                    # One doc per Amber site
```

### In Browser (test.html only)

```
localStorage:
  ├── cachedInverter
  ├── cachedPrices
  ├── cachedWeather
  ├── cacheState
  └── amberSiteId
```

---

## 8. Recommendations

### 8.1 Action Required (Manual Setup)

1. **Enable Firestore TTL Policy** (via Firestore console - REQUIRED)
   - Navigate to Firestore Console
   - Go to Collections → `users` (or any user doc) → `cache`
   - Click "TTL" button and select `ttl` field
   - Repeat for `amber_prices` collection
   - **Without this step, cache documents will persist indefinitely**

### 8.2 Optional Enhancements

1. **Re-enable User TTL Configuration**
   - If approved, add back the `inverterCacheTtlMs` field to frontend settings
   - Validate range (60s-10min as originally designed)
   - Update documentation

2. **Storage Monitoring**
   - Add metrics tracking cache document counts
   - Alert if storage grows unexpectedly

3. **Cache Invalidation**
   - Add manual "clear cache" button for troubleshooting
   - Implement cache version field to force invalidation on code changes

---

## 9. Testing Cache Behavior

### Console Logs to Monitor

```javascript
[Cache] Inverter data fresh (age: 15234ms, TTL: 300000ms)        // Hit
[Cache] Inverter data expired (age: 312000ms, TTL: 300000ms)     // Expired
[Cache] No cached inverter data - fetching fresh                  // First run
[Cache] Stored fresh inverter data in cache (TTL: 300000ms)      // Write
[Cache] Found 48 cached prices total, 30 in requested range      // Amber hit
[Cache] No cached data found for site ABC123                      // Amber miss
[History] Cache HIT for chunk ...                                 // History hit
```

### To Verify Cache Working

1. Watch console logs during automation cycles
2. Should see `[Cache] Inverter data fresh` every 5+ minutes
3. Should see FoxESS API calls only when cache expires
4. Amber prices should be reused across cycles

---

## 10. Summary Table

| Cache Type | Location | TTL | Scope | Size/Doc | Growth | Status | TTL Field |
|------------|----------|-----|-------|----------|--------|--------|-----------|
| Inverter Telemetry | `users/{uid}/cache/inverter` | 5 min | Per-user | ~10KB | Stable | ✅ Working | ✅ Added |
| Weather Forecast | `users/{uid}/cache/weather` | 30 min | Per-user | ~100KB | Stable | ✅ Working | ✅ Added |
| Amber Prices | `amber_prices/{siteId}` | 24 hr | Global | ~50KB | +5KB/day | ✅ Working | ✅ Added |
| History | `users/{uid}/cache/history_*` | 30 min | Per-user | ~100KB/chunk | ~3MB/mo | ✅ Working | ✅ Added |
| Frontend (test.html) | Browser localStorage | Infinite | Test UI only | ~50KB | Static | ℹ️ No-op | N/A |

---

**End of Caching Design Document**
