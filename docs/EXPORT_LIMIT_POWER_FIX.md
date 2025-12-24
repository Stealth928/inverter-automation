# ExportLimitPower Empty Result Fix

**Date:** December 24, 2025  
**Issue:** `ExportLimitPower` setting returns empty `{}` result while `ExportLimit` works correctly  
**Status:** ✅ Fixed with retry logic and diagnostic improvements

## Problem Description

When reading the `ExportLimitPower` setting via `/api/device/setting/get`, the FoxESS API was returning:
```json
{
  "errno": 0,
  "msg": "Operation successful",
  "result": {}
}
```

Meanwhile, `ExportLimit` was returning the expected structured result:
```json
{
  "errno": 0,
  "msg": "Operation successful",
  "result": {
    "unit": "W",
    "precision": 1,
    "range": {"min": 0, "max": 30000},
    "value": "0"
  }
}
```

## Root Cause Analysis

The empty `result: {}` response from FoxESS typically indicates one of:

1. **Transient API Failure** - FoxESS API briefly unavailable or timed out
2. **Device Doesn't Support Setting** - The specific device doesn't have `ExportLimitPower` configured
3. **Device Offline** - Device is temporarily offline and not responding to API queries
4. **API Rate Limiting** - Request was rate-limited and silently rejected

## Solution Implemented

### 1. Retry Logic in Backend (`/api/device/setting/get`)

Added automatic retry mechanism:
- When an empty result `{}` is received, the endpoint now retries after a 500ms delay
- Maximum 1 retry (2 total attempts)
- Only retries if result is empty **and** there's no explicit error code
- Logs clearly indicate retry attempts

**Code Location:** [functions/index.js - DeviceSetting handler](../functions/index.js#L3638)

```javascript
// Retry logic: if result is empty, retry once after short delay
let result = null;
let retryCount = 0;
const maxRetries = 1;

while (retryCount <= maxRetries) {
  if (retryCount > 0) {
    console.log(`[DeviceSetting] Retry ${retryCount}/${maxRetries} for key ${key} after 500ms delay...`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  result = await foxessAPI.callFoxESSAPI('/op/v0/device/setting/get', 'POST', { sn, key }, userConfig, req.user.uid);
  
  // Check if result is not empty or if we got an explicit error (don't retry those)
  const resultIsEmpty = result?.result && Object.keys(result.result).length === 0;
  const hasError = result?.errno !== 0 && result?.error;
  
  if (!resultIsEmpty || hasError) {
    break; // Either we got data or an explicit error - don't retry
  }
  
  if (resultIsEmpty && retryCount < maxRetries) {
    retryCount++;
    continue;
  }
}
```

### 2. Improved Frontend Error Message

The frontend now provides clearer guidance when `ExportLimitPower` is unavailable:

**Before:**
```
⚠️ ExportLimitPower is not available on this device. Use ExportLimit for power control.
```

**After:**
```
⚠️ ExportLimitPower Not Available

This device does not report the ExportLimitPower setting. This can happen if:
• The FoxESS API is temporarily unavailable
• Your device firmware doesn't support this setting
• The setting was recently disabled in the device configuration

[🔄 Retry Reading]
```

**Code Location:** [frontend/curtailment-discovery.html - readCurrentSettings()](../frontend/curtailment-discovery.html#L883)

### 3. Device Status Diagnostic Endpoint

Added `/api/device/status/check` to diagnose connectivity and API issues:

**Endpoint:** `GET /api/device/status/check?sn=DEVICE_SN`

**Response:**
```json
{
  "errno": 0,
  "result": {
    "deviceSn": "DEVICE_SN",
    "deviceFound": true,
    "deviceInfo": {
      "sn": "DEVICE_SN",
      "deviceName": "My Inverter",
      "deviceType": "KH3.7"
    },
    "realtimeWorking": true,
    "settingResponseOk": true,
    "settingHasData": true,
    "diagnosticSummary": {
      "apiResponsive": true,
      "deviceOnline": true,
      "realtimeDataAvailable": true,
      "settingReadSupported": true,
      "potentialIssues": []
    }
  }
}
```

**Checks Performed:**
- ✅ API connectivity (via `/op/v0/device/list`)
- ✅ Device online status (checks if device in device list)
- ✅ Real-time data availability (via `/op/v0/device/real-time`)
- ✅ Settings API responsiveness (via `/op/v0/device/setting/get`)
- ✅ Returns potential issues if any checks fail

**Code Location:** [functions/index.js - Device Status Endpoint](../functions/index.js#L3763)

## How to Test

### Test Case 1: Transient Failure Recovery
1. Open Solar Topology page → Curtailment Discovery
2. Click "Read Current Settings"
3. If you see retry attempts in the server logs, the fix is working

### Test Case 2: Verify Retry Logic
Check the server logs for:
```
[DeviceSetting] Retry 1/1 for key ExportLimitPower after 500ms delay...
```

### Test Case 3: Diagnose Issues
Call the diagnostic endpoint:
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5000/api/device/status/check?sn=YOUR_DEVICE_SN"
```

## Behavior Summary

### If `ExportLimitPower` is Truly Unavailable
1. First request returns empty `{}`
2. Backend retries after 500ms
3. Second request still returns empty `{}`
4. Frontend displays warning with retry button
5. User can click retry to check again

### If `ExportLimitPower` is Temporarily Unavailable
1. First request returns empty `{}`
2. Backend retries after 500ms
3. Second request returns full data structure
4. Frontend displays the setting value
5. ✅ Issue resolved by retry

### If There's an API Error
1. Backend receives explicit error (errno !== 0)
2. No retry (explicit errors shouldn't be retried)
3. Frontend displays API error message
4. User can click retry button to try again

## Migration Notes

- **No frontend changes required** - Retry logic is transparent to the UI
- **No breaking API changes** - Response format unchanged
- **Optional diagnostic endpoint** - New endpoint `/api/device/status/check` for troubleshooting

## Known Limitations

- **Single retry only** - If device is completely offline, one retry won't help
- **500ms delay** - If API is rate-limited, delay may not be enough
- **No exponential backoff** - Uses fixed 500ms delay

## Future Improvements

1. **Adaptive retry strategy** - Increase delay if initial retry fails
2. **Configurable retry settings** - Allow users to adjust retry count/delay
3. **Telemetry** - Track empty result frequency to identify systematic issues
4. **Device status cache** - Cache device online status for 1 minute to avoid repeated checks
5. **Fallback values** - Allow users to configure fallback settings if API unavailable

## Related Documentation

- [CURTAILMENT_DISCOVERY_PAGE.md](CURTAILMENT_DISCOVERY_PAGE.md) - UI page details
- [API.md](API.md) - API endpoint documentation
- [SOLAR_CURTAILMENT_ASSESSMENT.md](SOLAR_CURTAILMENT_ASSESSMENT.md) - Curtailment feature overview

