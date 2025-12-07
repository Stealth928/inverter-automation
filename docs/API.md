# API Reference

## Overview

All API endpoints are served via Firebase Cloud Functions at:
- **Production**: `https://inverter-automation-firebase.web.app/api/*`
- **Local Emulator**: `http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api/api/*`

All authenticated endpoints require a Firebase ID token in the `Authorization` header:
```
Authorization: Bearer <firebase-id-token>
```

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

---

## Rate Limits

| API | Limit | Cache TTL | Location |
|-----|-------|-----------|----------|
| FoxESS (Telemetry) | ~60 req/hour | 5 minutes | `users/{uid}/cache/inverter` |
| FoxESS (History) | ~60 req/hour | 30 minutes | `users/{uid}/cache/history_*` (per 24h chunk) |
| Amber (Prices) | ~100 req/hour | 24 hours | `amber_prices/{siteId}` (global, shared) |
| Open-Meteo (Weather) | Unlimited | 30 minutes | `users/{uid}/cache/weather` |

All caches use Firestore TTL field for auto-cleanup. Enable TTL policy in Firestore console for automatic document expiration.
