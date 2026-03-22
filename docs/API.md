# API Reference

Last updated: 2026-03-22

## Overview

All API endpoints are served behind the hosting rewrite at `/api/**`.

Typical entry points:
- **Production**: `https://<your-host>/api/*` or your custom domain such as `https://socratesautomation.com/api/*`
- **Local Hosting Emulator**: `http://127.0.0.1:5000/api/*`
- **Direct Functions Emulator**: `http://127.0.0.1:5001/<project-id>/us-central1/api/api/*`

Use this file as the narrative companion to the incremental OpenAPI baseline in
`docs/openapi/openapi.v1.yaml`.

For the most complete measured route inventory, use
`docs/API_CONTRACT_BASELINE_MAR26.md` until OpenAPI coverage catches up.

This document focuses on commonly used product and operator workflows rather
than listing every backend route exhaustively.

## Admin Operator Metrics

### Shared Announcement Configuration
```
GET /api/admin/announcement
POST /api/admin/announcement
Authorization: Bearer <token>
```
Admin-only read/write endpoint for the shared announcement payload stored in `shared/serverConfig.announcement`.

The payload supports:
- `enabled`
- `id`
- `title`
- `body`
- `severity`: `info | success | warning | danger`
- `showOnce`
- `audience.requireTourComplete`
- `audience.requireSetupComplete`
- `audience.requireAutomationEnabled`
- `audience.minAccountAgeDays`
- `audience.onlyIncludeUids`
- `audience.includeUids`
- `audience.excludeUids`

For admin writes, the three manual audience lists accept either Firebase UIDs or login email addresses. Email entries are resolved to the current UID on save and the stored config remains UID-based.

The saved response also includes `updatedAt`, `updatedByUid`, and `updatedByEmail` metadata.

### Behaviour Analytics
```
GET /api/admin/behavior-metrics?days=30&limit=8
Authorization: Bearer <token>
```
Admin-only endpoint that returns aggregated GA4 usage data for the admin Behaviour tab.

- Uses the GA4 Data API via the Cloud Functions service account.
- Uses one of two property resolution paths:
  - Preferred automatic path: read the linked GA4 property directly from Firebase project analytics details
  - Secondary automatic path: resolve the GA4 property from the measurement id
  - Fallback explicit path: use a configured numeric property id
- Numeric property id can be configured on the server via one of:
  - `GA4_PROPERTY_ID`
  - `GOOGLE_ANALYTICS_PROPERTY_ID`
  - `ANALYTICS_PROPERTY_ID`
- Measurement id can be configured via one of:
  - `GA4_MEASUREMENT_ID`
  - `GOOGLE_ANALYTICS_MEASUREMENT_ID`
  - `ANALYTICS_MEASUREMENT_ID`
- This repo also defaults to the production measurement id already used by the web app: `G-MWF4ZBMREE`.
- When the Firebase project is linked to Google Analytics, the server first calls `projects.getAnalyticsDetails` on the Firebase Management API and can resolve the numeric GA4 property id without scanning GA accounts.
- Returns a non-failing setup payload when the property cannot be resolved yet.

Typical success payload:

```json
{
  "errno": 0,
  "result": {
    "configured": true,
    "source": "ga4-data-api",
    "propertyId": "123456789",
    "measurementId": "G-MWF4ZBMREE",
    "propertySource": "firebase-project-analytics",
    "updatedAt": "2026-03-21T03:14:15.000Z",
    "window": {
      "days": 30,
      "startDate": "30daysAgo",
      "endDate": "today"
    },
    "summary": {
      "activeUsers": 18,
      "pageViews": 146,
      "eventCount": 221,
      "avgEngagementSecondsPerUser": 51.8,
      "avgEventsPerUser": 12.3,
      "trackedPageCount": 6,
      "customEventTypes": 4
    },
    "pageSeries": [],
    "mainPageOptions": [
      { "key": "app", "label": "Dashboard" },
      { "key": "control", "label": "Control" },
      { "key": "history", "label": "History" },
      { "key": "settings", "label": "Settings" },
      { "key": "admin", "label": "Admin" }
    ],
    "pageSeriesByKey": {
      "app": [],
      "control": [],
      "history": [],
      "settings": [],
      "admin": []
    },
    "topPages": [],
    "topEvents": [],
    "warnings": []
  }
}
```

`pageSeries` remains the all-pages aggregate used by default.
`mainPageOptions` and `pageSeriesByKey` allow the admin UI to filter the daily chart client-side for the core product pages without issuing extra requests after the initial cached fetch.

All authenticated endpoints require a Firebase ID token in the `Authorization` header:
```
Authorization: Bearer <firebase-id-token>
```

## Response Format

All endpoints follow a consistent response envelope:

```json
{
  "errno": 0,
  "result": { /* response data */ },
  "error": "Error message (only if errno != 0)"
}
```

- `errno: 0` = Success
- `errno > 0` = Error (see Error Codes section)
- `result` = Response data (only present on success)
- `error` = Error message string (only present on error)

**⚠️ Important**: All API failures now show as prominent **red error boxes** in the UI with the error code and message, enabling users to quickly identify and debug issues. This replaces previous subtle inline error indicators.

---

## Authentication Endpoints

### Health Check
```
GET /api/health
```
Unauthenticated health check.

**Response:**
```json
{
  "errno": 0,
  "result": { "status": "OK" },
  "ok": true,
  "FOXESS_TOKEN": false,
  "AMBER_API_KEY": false
}
```

### Authenticated Health Check
```
GET /api/health/auth
```
Verifies authentication is working.

**Response:**
```json
{ "ok": true, "user": "uid123" }
```

### Password Reset
```
POST /api/auth/forgot-password
Content-Type: application/json

{ "email": "user@example.com" }
```
Sends password reset email via Firebase Auth.

**Response:**
```json
{ "errno": 0, "msg": "Password reset email sent" }
```

### Initialize User
```
POST /api/auth/init-user
Authorization: Bearer <token>
```
Creates user profile and default settings after signup.

**Response:**
```json
{ "errno": 0, "msg": "User initialized", "userId": "uid123" }
```

---

## Configuration Endpoints

### Get User Config
```
GET /api/config
Authorization: Bearer <token>
```
Returns user's configuration.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "deviceSn": "60KB10305AKA064",
    "foxessToken": "xxx-xxx",
    "amberApiKey": "xxx",
    "amberSiteId": "site123",
    "location": "Sydney"
  }
}
```

### Save User Config
```
POST /api/config
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceSn": "60KB10305AKA064",
  "foxessToken": "xxx",
  "amberApiKey": "xxx"
}
```

**Response:**
```json
{ "errno": 0, "msg": "Config saved" }
```

### Get Eligible Announcement
```
GET /api/config/announcement
Authorization: Bearer <token>
```
Returns the currently eligible shared announcement for the signed-in user, or `null` when no announcement should be shown.

Eligibility is evaluated server-side from the shared announcement config plus lightweight user state:
- `tourComplete`
- `setupComplete`
- `automationEnabled`
- account age from `users/{uid}.createdAt`
- manual `onlyIncludeUids`
- manual `includeUids` and `excludeUids`
- previously dismissed show-once IDs from `announcementDismissedIds`

Audience precedence is:
- `excludeUids` always blocks
- when `onlyIncludeUids` has entries, users outside that list are blocked
- `includeUids` bypasses the maturity filters for remaining users
- otherwise the standard tour/setup/automation/account-age filters apply

**Response:**
```json
{
  "errno": 0,
  "result": {
    "announcement": {
      "enabled": true,
      "id": "release-note-1",
      "title": "Platform update",
      "body": "New market insights are live.",
      "severity": "warning",
      "showOnce": true,
      "audience": {
        "requireTourComplete": true,
        "requireSetupComplete": true,
        "requireAutomationEnabled": false,
        "minAccountAgeDays": 3,
        "onlyIncludeUids": [],
        "includeUids": [],
        "excludeUids": []
      }
    }
  }
}
```

When nothing is eligible, the endpoint still returns success:

```json
{
  "errno": 0,
  "result": {
    "announcement": null
  }
}
```

### Dismiss Show-Once Announcement
```
POST /api/config/announcement/dismiss
Authorization: Bearer <token>
Content-Type: application/json

{ "id": "release-note-1" }
```
Persists a dismissed announcement ID for the current user. This is used by show-once announcements so they are not shown again after dismissal.

**Response:**
```json
{
  "errno": 0,
  "msg": "Announcement dismissed",
  "result": {
    "id": "release-note-1",
    "announcementDismissedIds": ["release-note-1"]
  }
}
```

### Get System Topology
```
GET /api/config/system-topology
Authorization: Bearer <token>
```
Returns persisted coupling hint used by reports/history pages to avoid repeated real-time topology probes.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "coupling": "ac",
    "isLikelyAcCoupled": true,
    "source": "auto",
    "confidence": 0.9,
    "lastDetectedAt": 1766900000000,
    "refreshAfterMs": 14400000
  }
}
```

### Save System Topology
```
POST /api/config/system-topology
Authorization: Bearer <token>
Content-Type: application/json

{
  "coupling": "ac",
  "source": "auto",
  "confidence": 0.9,
  "lastDetectedAt": 1766900000000,
  "refreshAfterMs": 14400000
}
```
Persists coupling hint in `users/{uid}/config/main.systemTopology`.

**Response:**
```json
{ "errno": 0, "msg": "System topology saved" }
```

### Validate API Keys
```
POST /api/config/validate-keys
Authorization: Bearer <token>  (optional — unauthenticated writes to shared/serverConfig)
Content-Type: application/json
```

**FoxESS provider fields:**
```json
{
  "device_sn": "AFTWXK7A123456",
  "foxess_token": "xxx",
  "amber_api_key": "xxx"
}
```

**Sungrow provider fields:**
```json
{
  "sungrow_device_sn": "A2350012345",
  "sungrow_username": "user@example.com",
  "sungrow_password": "secret",
  "amber_api_key": "xxx"
}
```

**SigenEnergy provider fields:**
```json
{
  "sigenergy_username": "user@example.com",
  "sigenergy_password": "secret",
  "sigenergy_region": "apac",
  "amber_api_key": "xxx"
}
```

**AlphaESS provider fields:**
```json
{
  "alphaess_system_sn": "ALP123456789",
  "alphaess_app_id": "app-id-from-alphaess-openapi",
  "alphaess_app_secret": "app-secret-from-alphaess-openapi",
  "amber_api_key": "xxx"
}
```

- `sigenergy_region`: one of `apac` (Asia-Pacific), `eu` (Europe), `cn` (China), `us` (North America). Defaults to `apac`.

Validates credentials (for Sungrow/SigenEnergy it performs a live login; for AlphaESS it validates app credentials by listing systems). On success saves config with `deviceProvider` set to the detected provider. Passwords/secrets are stored separately in a write-only secrets subcollection — they cannot be read back via the API.

**Response:**
```json
{ "errno": 0, "result": { "saved": true } }
```

### Setup Status
```
GET /api/config/setup-status
Authorization: Bearer <token>
```
Checks if user has completed initial setup, and returns the active device provider.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "hasConfig": true,
    "hasDevice": true,
    "hasAmber": true,
    "setupComplete": true,
    "deviceProvider": "foxess",
    "hasAlphaEssSystemSn": false,
    "hasAlphaEssAppId": false,
    "hasSungrowUsername": false,
    "hasSungrowDeviceSn": false,
    "hasSigenUsername": false,
    "hasSigenDeviceSn": false,
    "sigenRegion": null
  }
}
```

- `deviceProvider`: one of `foxess`, `sungrow`, `sigenergy`, `alphaess`
- `hasAlphaEssSystemSn` / `hasAlphaEssAppId`: credential presence flags for AlphaESS
- `hasSungrowUsername` / `hasSungrowDeviceSn`: credential presence flags for Sungrow
- `hasSigenUsername` / `hasSigenDeviceSn` / `sigenRegion`: credential presence flags for SigenEnergy

---

## Automation Endpoints

### Get Automation Status
```
GET /api/automation/status
Authorization: Bearer <token>
```
Returns automation state, rules, and last cycle info.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "enabled": true,
    "lastCheck": 1733400000000,
    "activeRule": "High Feed-in",
    "activeUntil": 1733401800000,
    "rules": {
      "rule1": {
        "name": "High Feed-in",
        "enabled": true,
        "priority": 1,
        "conditions": {...},
        "action": {...}
      }
    }
  }
}
```

### Toggle Automation
```
POST /api/automation/toggle
Authorization: Bearer <token>
Content-Type: application/json

{ "enabled": true }
```

**Response:**
```json
{ "errno": 0, "enabled": true }
```

### Force Automation Cycle
```
POST /api/automation/cycle
Authorization: Bearer <token>
```
Triggers an immediate rule evaluation cycle.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "triggered": true,
    "rule": { "name": "High Feed-in", "actionResult": {...} },
    "evaluationResults": [
      { "rule": "High Feed-in", "result": "triggered", "details": {...} }
    ],
    "rulesEvaluated": 3,
    "totalRules": 5
  }
}
```

### Cancel Active Rule
```
POST /api/automation/cancel
Authorization: Bearer <token>
```
Cancels the currently active rule and clears scheduler.

**Response:**
```json
{ "errno": 0, "msg": "Cancelled", "clearedSegments": 1 }
```

### Reset Automation State
```
POST /api/automation/reset
Authorization: Bearer <token>
```
Resets automation state and clears active rules.

**Response:**
```json
{ "errno": 0, "msg": "Reset complete" }
```

### End Orphan Rule
```
POST /api/automation/rule/end
Authorization: Bearer <token>
Content-Type: application/json

{
  "ruleId": "high_feed_in",
  "endTime": 1733401800000
}
```
Manually ends an orphan ongoing rule that got stuck without proper termination. Creates a completion audit entry with the specified end time.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "ended": true,
    "ruleName": "High Feed-in",
    "ruleId": "high_feed_in",
    "startTime": 1733400000000,
    "endTime": 1733401800000,
    "durationMs": 1800000,
    "message": "Orphan rule successfully ended with completion timestamp"
  }
}
```

### Get Automation Audit Logs
```
GET /api/automation/audit?limit=500&days=7
Authorization: Bearer <token>
```
Returns detailed automation cycle audit logs with rule on/off events for ROI calculation.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "entries": [...],
    "ruleEvents": [
      {
        "type": "complete",
        "ruleId": "high_feed_in",
        "ruleName": "High Feed-in",
        "startTime": 1733400000000,
        "endTime": 1733401800000,
        "durationMs": 1800000,
        "roiSnapshot": {
          "houseLoadW": 1500,
          "feedInPrice": 35.5,
          "buyPrice": 28.2,
          "estimatedRevenue": 1.25
        }
      }
    ],
    "count": 150,
    "eventsCount": 25,
    "period": "7 days"
  }
}
```

---

## Rule Management Endpoints

### Create Rule
```
POST /api/automation/rule/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "High Feed-in Export",
  "enabled": true,
  "priority": 1,
  "cooldownMinutes": 5,
  "conditions": {
    "feedInPrice": { "enabled": true, "operator": ">", "value": 30 },
    "soc": { "enabled": true, "operator": ">", "value": 80 }
  },
  "action": {
    "workMode": "ForceDischarge",
    "durationMinutes": 30,
    "fdPwr": 5000
  }
}
```

Validation:
- `action.workMode` must be one of: `SelfUse`, `ForceDischarge`, `ForceCharge`, `Feedin`, `Backup`.
- `action.durationMinutes` (if provided) must be `5-1440`.
- `action.fdPwr` must be `> 0` for `ForceDischarge`, `ForceCharge`, `Feedin`.
- `action.fdPwr` must not exceed configured inverter capacity (`inverterCapacityW`, fallback 10000W).

**Response:**
```json
{ "errno": 0, "ruleId": "rule_abc123" }
```

### Update Rule
```
POST /api/automation/rule/update
Authorization: Bearer <token>
Content-Type: application/json

{
  "ruleName": "high_feed_in_export",
  "name": "High Feed-in Export",
  "enabled": false,
  ...
}
```

Notes:
- `ruleName` or `name` is required to identify the rule.
- Partial `action` updates are merged with existing action before validation.
- The same action validation rules from create apply to update.

**Response:**
```json
{ "errno": 0, "msg": "Rule updated" }
```

### Delete Rule
```
POST /api/automation/rule/delete
Authorization: Bearer <token>
Content-Type: application/json

{ "ruleName": "High Feed-in Export" }
```

**Response:**
```json
{ "errno": 0, "msg": "Rule deleted" }
```

---

## Inverter Endpoints (FoxESS only)

> **Provider restriction**: The endpoints in this section proxy directly to the FoxESS Open API and only work when `deviceProvider` is `foxess`. Requests from Sungrow, SigenEnergy, or AlphaESS users will receive `400 { errno: 400, error: "Not supported for provider: <provider>" }`.

### List Devices
```
GET /api/inverter/list
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": [
    { "deviceSN": "60KB10305AKA064", "deviceType": "H3-10.0-E" }
  ]
}
```

### Real-time Data
```
GET /api/inverter/real-time?sn=60KB10305AKA064
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": [
    { "variable": "SoC", "value": 85, "unit": "%" },
    { "variable": "batTemperature", "value": 28.5, "unit": "°C" },
    { "variable": "pvPower", "value": 4.2, "unit": "kW" }
  ]
}
```

### Get Scheduler
```
GET /api/scheduler/v1/get?sn=60KB10305AKA064
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": {
    "groups": [
      {
        "enable": 1,
        "workMode": "ForceDischarge",
        "startHour": 14, "startMinute": 0,
        "endHour": 14, "endMinute": 30,
        "fdPwr": 5000,
        "fdSoc": 20,
        "minSocOnGrid": 10,
        "maxSoc": 100
      },
      { "enable": 0, ... }
    ]
  }
}
```

### Set Scheduler
```
POST /api/scheduler/v1/set
Authorization: Bearer <token>
Content-Type: application/json

{
  "sn": "60KB10305AKA064",
  "groups": [...]
}
```

**Response:**
```json
{ "errno": 0, "msg": "Scheduler updated" }
```

### Clear All Scheduler Segments
```
POST /api/scheduler/v1/clear-all
Authorization: Bearer <token>
Content-Type: application/json

{ "sn": "60KB10305AKA064" }
```

**Response:**
```json
{ "errno": 0, "cleared": 8 }
```

### Discover Device Variables
```
GET /api/inverter/discover-variables?sn=60KB10305AKA064
Authorization: Bearer <token>
```
Returns all available variables for a device (useful for topology detection).

**Response:**
```json
{
  "errno": 0,
  "result": ["pvPower", "pv1Power", "pv2Power", "SoC", "batTemperature", ...]
}
```

### Get All Device Data
```
POST /api/inverter/all-data
Authorization: Bearer <token>
Content-Type: application/json

{ "sn": "60KB10305AKA064" }
```
Returns ALL real-time data for a device without variable filtering. Used for topology analysis and diagnostics.

**Response:**
```json
{
  "errno": 0,
  "result": [...],
  "topologyHints": {
    "pvPower": 0,
    "meterPower": 2500,
    "meterPower2": 1800,
    "batChargePower": 1500,
    "likelyTopology": "AC-coupled (external PV via meter)"
  }
}
```

---

## EV Endpoints

### List EV Vehicles
```
GET /api/ev/vehicles
Authorization: Bearer <token>
```

Returns registered EVs for the current user. Tesla vehicles expose `hasCredentials` so the frontend can distinguish fully connected vehicles from those still waiting on OAuth completion.

**Response:**
```json
{
  "errno": 0,
  "result": [
    {
      "vehicleId": "5YJ3E1EA7JF000001",
      "provider": "tesla",
      "displayName": "Model Y Home",
      "region": "na",
      "hasCredentials": true
    }
  ]
}
```

### Get EV Status
```
GET /api/ev/vehicles/:vehicleId/status?live=1
Authorization: Bearer <token>
```

Returns the latest cached or live EV status for the selected vehicle.

**Response:**
```json
{
  "errno": 0,
  "source": "live",
  "result": {
    "socPct": 74,
    "chargingState": "charging",
    "isPluggedIn": true,
    "isHome": true,
    "rangeKm": 410,
    "ratedRangeKm": 438,
    "chargeLimitPct": 90,
    "timeToFullChargeHours": 1.75,
    "chargeEnergyAddedKwh": 8.4,
    "rangeAddedKm": 56,
    "chargingPowerKw": 7,
    "chargingAmps": 24,
    "asOfIso": "2026-03-14T00:00:00.000Z"
  },
  "audit": {
    "routeName": "status",
    "teslaApiCalls": 1,
    "teslaBillableApiCalls": 1
  }
}
```

### Get EV Command Readiness
```
GET /api/ev/vehicles/:vehicleId/command-readiness
Authorization: Bearer <token>
```

Returns whether Tesla charging controls can be shown for the selected vehicle.

Typical readiness states:

- `ready_direct`: direct Tesla Fleet charging commands are available
- `ready_signed`: the vehicle is command-ready but must use signed commands
- `proxy_unavailable`: the vehicle requires signed commands and the proxy is not configured
- `read_only`: status visibility is available but charging controls are not ready
- `setup_required`: Tesla OAuth credentials are missing or need to be refreshed

**Response:**
```json
{
  "errno": 0,
  "result": {
    "state": "ready_signed",
    "transport": "signed",
    "source": "fleet_status",
    "vehicleVin": "5YJ3E1EA7JF000001",
    "vehicleCommandProtocolRequired": true,
    "totalNumberOfKeys": 4,
    "firmwareVersion": "2026.2.1"
  },
  "audit": {
    "routeName": "command_readiness",
    "teslaApiCalls": 1,
    "teslaBillableApiCalls": 1
  }
}
```

### Wake EV Vehicle Manually
```
POST /api/ev/vehicles/:vehicleId/wake
Authorization: Bearer <token>
Content-Type: application/json
```

Requests a manual Tesla wake for a sleeping or offline vehicle. This endpoint is intentionally separate from charging commands so the app never auto-wakes a vehicle during refreshes or automation.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "accepted": true,
    "command": "wakeVehicle",
    "provider": "tesla",
    "vehicleId": "5YJ3E1EA7JF000001",
    "transport": "direct",
    "status": "online",
    "wakeState": "online",
    "asOfIso": "2026-03-14T00:00:00.000Z"
  }
}
```

### Send EV Charging Command
```
POST /api/ev/vehicles/:vehicleId/command
Authorization: Bearer <token>
Content-Type: application/json
```

Supported Tesla commands:

- `startCharging`
- `stopCharging`
- `setChargeLimit`
- `setChargingAmps`

**Request:**
```json
{
  "command": "setChargeLimit",
  "targetSocPct": 80,
  "commandId": "cmd-123"
}
```

**Response:**
```json
{
  "errno": 0,
  "result": {
    "accepted": true,
    "command": "setChargeLimit",
    "provider": "tesla",
    "vehicleId": "5YJ3E1EA7JF000001",
    "transport": "direct",
    "status": "confirmed",
    "targetSocPct": 80,
    "asOfIso": "2026-03-14T00:00:00.000Z"
  },
  "audit": {
    "routeName": "command_setChargeLimit",
    "teslaApiCalls": 1,
    "teslaBillableApiCalls": 1
  }
}
```

**Command Validation Errors:**
```json
{
  "errno": 400,
  "error": "targetSocPct must be between 50 and 100"
}
```

**Readiness / Infrastructure Errors:**
```json
{
  "errno": 503,
  "error": "Tesla vehicle requires signed commands, but the signed-command proxy is not configured.",
  "result": {
    "reasonCode": "signed_command_proxy_unavailable"
  }
}
```

---

## Amber Endpoints

### List Sites
```
GET /api/amber/sites
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": [
    { "id": "site123", "nmi": "123456789", "network": "Ausgrid" }
  ]
}
```

### Current Prices
```
GET /api/amber/prices/current?siteId=site123&next=12
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": [
    {
      "type": "CurrentInterval",
      "channelType": "general",
      "perKwh": 25.5,
      "spotPerKwh": 20.1
    },
    {
      "type": "CurrentInterval",
      "channelType": "feedIn",
      "perKwh": -8.2
    },
    {
      "type": "ForecastInterval",
      "channelType": "general",
      "perKwh": 28.3
    }
  ]
}
```

### Historical Prices
```
GET /api/amber/prices?siteId=site123&startDate=2025-12-01&endDate=2025-12-05&resolution=30
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": [
    {
      "type": "ActualInterval",
      "channelType": "general",
      "perKwh": 24.5,
      "startTime": "2025-12-01T00:00:00+11:00"
    }
  ]
}
```

### Get Actual Price at Timestamp
```
GET /api/amber/prices/actual?timestamp=1733400000000&siteId=site123
Authorization: Bearer <token>
```
Returns the actual settled price for a specific historical timestamp. Used by ROI calculator to get real prices instead of forecasts. Only works for timestamps older than 5 minutes (prices take time to settle).

**Response:**
```json
{
  "errno": 0,
  "result": {
    "timestamp": 1733400000000,
    "targetDate": "2025-12-05",
    "general": {
      "perKwh": 24.52,
      "spotPerKwh": 20.15,
      "startTime": "2025-12-05T14:00:00+11:00",
      "endTime": "2025-12-05T14:30:00+11:00"
    },
    "feedIn": {
      "perKwh": -8.35,
      "spotPerKwh": -5.20,
      "startTime": "2025-12-05T14:00:00+11:00",
      "endTime": "2025-12-05T14:30:00+11:00"
    }
  }
}
```

**Error Response (timestamp too recent):**
```json
{
  "errno": 400,
  "error": "Timestamp is only 3.5 minutes old - price may not be settled yet. Wait at least 5 minutes."
}
```

---

## Weather Endpoint

### Get Weather
```
GET /api/weather?place=Sydney&days=3
Authorization: Bearer <token>
```

**Response:**
```json
{
  "errno": 0,
  "result": {
    "current_weather": {
      "temperature": 24.5,
      "weathercode": 1,
      "windspeed": 12.3
    },
    "daily": {
      "time": ["2025-12-05", "2025-12-06", "2025-12-07"],
      "weathercode": [1, 3, 61],
      "temperature_2m_max": [28, 25, 22]
    }
  }
}
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 400 | Bad request (missing/invalid parameters) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 500 | Internal server error |
| 41808 | FoxESS rate limit exceeded |
### Provider-Specific Error Ranges

| Range | Provider | Notes |
|-------|----------|-------|
| 3200–3299 | FoxESS | FoxESS API errors (mirrors upstream errno) |
| 3300–3399 | Sungrow | iSolarCloud API errors |
| 3400–3499 | SigenEnergy | SigenEnergy cloud API errors |

FoxESS, Sungrow, and SigenEnergy upstream errors are proxied in the `errno` field with the provider's original code. The `error` field contains a human-readable description.
---

## Provider Rate Limits and Cache Behavior

Provider quotas change over time and some integrations are user-configurable, so
the table below documents current cache behavior in code rather than claiming a
single hard quota contract.

| Integration | Practical rate-limit note | Effective cache behavior | Location |
|-------------|---------------------------|--------------------------|----------|
| FoxESS telemetry | Treat `~60 req/hour` as rough planning guidance only | Default `5 minutes`; effective user value exposed by `GET /api/config` as `result.cacheTtl.inverter` | `users/{uid}/cache/inverter`, `users/{uid}/cache/inverter-realtime` |
| FoxESS history | Upstream/provider pressure depends on requested ranges | Default `30 minutes` per history cache key | `users/{uid}/cache/history_*` |
| Amber current prices | Upstream calls are deduplicated in-flight per `userId:siteId` | Default `60 seconds`; user override via `cache.amber` or server default | `users/{uid}/cache/amber_current_{siteId}` |
| Amber site list | Low-churn metadata | `7 days` | `users/{uid}/cache/amber_sites` |
| Amber historical prices | Range fetches fill gaps and merge into a per-user cache | Stored in a merged per-user cache with a `30 day` retention field | `users/{uid}/cache/amber_{siteId}` |
| Open-Meteo weather | No meaningful app-level quota pressure is enforced here | Default `30 minutes`; user override via `cache.weather` or server default | `users/{uid}/cache/weather` |

Current server defaults come from `getConfig().automation.cacheTtl`, and
`GET /api/config` returns the effective user-specific TTLs used by the app.
