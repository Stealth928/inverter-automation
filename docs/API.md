# API Reference

## Overview

All API endpoints are served via Firebase Cloud Functions at:
- **Production**: `https://inverter-automation-firebase.web.app/api/*`
- **Local Emulator**: `http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api/api/*`

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
{ "ok": true }
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

### Validate API Keys
```
POST /api/config/validate-keys
Authorization: Bearer <token>
Content-Type: application/json

{
  "foxessToken": "xxx",
  "amberApiKey": "xxx"
}
```
Tests API credentials without saving.

**Response:**
```json
{
  "errno": 0,
  "foxess": { "valid": true, "devices": 1 },
  "amber": { "valid": true, "sites": 1 }
}
```

### Setup Status
```
GET /api/config/setup-status
Authorization: Bearer <token>
```
Checks if user has completed initial setup.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "hasConfig": true,
    "hasDevice": true,
    "hasAmber": true,
    "setupComplete": true
  }
}
```

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
  "ruleId": "rule_abc123",
  "name": "High Feed-in Export",
  "enabled": false,
  ...
}
```

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

## Inverter Endpoints (FoxESS)

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

## Tesla Integration

### Overview

Tesla integration uses the **Tesla Fleet API** with per-user OAuth credentials and the **Tesla Vehicle Command Protocol** for signed commands. See [TESLA_SIGNED_COMMANDS.md](TESLA_SIGNED_COMMANDS.md) for detailed implementation documentation.

⚠️ **Important**: As of October 2023, Tesla requires cryptographic signatures for all vehicle commands. Direct REST API endpoints are deprecated.

### Save Private Key
```
POST /api/tesla/save-private-key
Authorization: Bearer <firebase-id-token>
```

Save user's ECDSA P-256 private key for signing vehicle commands.

**Request:**
```json
{
  "privateKey": "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI...\n-----END EC PRIVATE KEY-----"
}
```

**Response:**
```json
{
  "errno": 0,
  "result": { "success": true },
  "msg": "Private key saved successfully"
}
```

**Errors:**
- `400`: Invalid or missing private key
- `500`: Failed to save key to Firestore

**Key Generation:**
```bash
openssl ecparam -name prime256v1 -genkey -noout -out tesla-private-key.pem
```

### Get Public Key
```
GET /api/tesla/public-key
Authorization: Bearer <firebase-id-token>
```

Retrieve user's public key (derived from private key) for Tesla Fleet API registration.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMFkwEwYH...\n-----END PUBLIC KEY-----"
  },
  "msg": "Use this public key to register with Tesla Fleet API at https://developer.tesla.com"
}
```

**Errors:**
- `404`: No private key found (generate and save key first)
- `500`: Failed to derive public key

**Next Steps:**
1. Copy the public key
2. Visit https://developer.tesla.com
3. Navigate to your application → Vehicle Command Keys
4. Paste and save the public key

### Vehicle Commands

All commands now use signed protocol automatically. See [TESLA_SIGNED_COMMANDS.md](TESLA_SIGNED_COMMANDS.md) for details.

#### Start Charging
```
POST /api/tesla/vehicles/{vehicleTag}/charge/start
Authorization: Bearer <firebase-id-token>
```

#### Stop Charging
```
POST /api/tesla/vehicles/{vehicleTag}/charge/stop
Authorization: Bearer <firebase-id-token>
```

#### Set Charging Amps
```
POST /api/tesla/vehicles/{vehicleTag}/charge/set-amps
Authorization: Bearer <firebase-id-token>

Body:
{
  "amps": 16
}
```

#### Set Charge Limit
```
POST /api/tesla/vehicles/{vehicleTag}/charge/set-limit
Authorization: Bearer <firebase-id-token>

Body:
{
  "percent": 80
}
```

**Command Response:**
```json
{
  "errno": 0,
  "result": {
    "result": true
  }
}
```

**Common Errors:**
- `404`: No private key found (save key first)
- `401`: Invalid signature (check key registration)
- `500`: Command execution failed

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

---

## Rate Limits

| API | Limit | Cache TTL | Location |
|-----|-------|-----------|----------|
| FoxESS (Telemetry) | ~60 req/hour | 5 minutes | `users/{uid}/cache/inverter` |
| FoxESS (History) | ~60 req/hour | 30 minutes | `users/{uid}/cache/history_*` (per 24h chunk) |
| Amber (Prices) | ~100 req/hour | 24 hours | `amber_prices/{siteId}` (global, shared) |
| Open-Meteo (Weather) | Unlimited | 30 minutes | `users/{uid}/cache/weather` |
| Tesla Fleet API | Per-user OAuth limits | N/A | Token-based rate limiting |
