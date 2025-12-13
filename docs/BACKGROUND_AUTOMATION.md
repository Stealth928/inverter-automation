# Background Automation System

This document describes how the automation system runs in the background, independent of whether a user has the website open.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTOMATION TRIGGERS                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐           ┌─────────────────────────────────┐  │
│  │   FRONTEND TIMER    │           │     CLOUD SCHEDULER             │  │
│  │   (When on site)    │           │     (Background)                │  │
│  └──────────┬──────────┘           └──────────────┬──────────────────┘  │
│             │                                     │                     │
│             │  countdown = intervalMs             │  every 1 minute     │
│             │                                     │                     │
│             └──────────────┬──────────────────────┘                     │
│                            │                                            │
│                            ▼                                            │
│            ┌───────────────────────────────────┐                        │
│            │  POST /api/automation/cycle       │                        │
│            │  (Same logic for both triggers)   │                        │
│            └───────────────────────────────────┘                        │
│                            │                                            │
└────────────────────────────┼────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTOMATION CYCLE                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Check if enabled (state.enabled === true)                           │
│  2. Check blackout windows (skip if in blackout)                        │
│  3. Fetch live data (respects cache TTL):                               │
│     • Inverter data: getCachedInverterData() - 5 min TTL                │
│     • Amber prices: callAmberAPI() - 60 sec TTL                         │
│     • Weather: getCachedWeatherData() - 30 min TTL (if rules need it)   │
│  4. Evaluate rules by priority (lowest number first)                    │
│  5. Apply segment to inverter if rule triggers                          │
│  6. Update automation state (lastCheck, activeRule, etc.)               │
│  7. Return result                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## How It Works

### Dual-Trigger Design

The automation system uses the **same endpoint** (`POST /api/automation/cycle`) for both:

1. **Frontend Timer** - When user is on the website, a JavaScript countdown timer calls the endpoint when it reaches zero
2. **Cloud Scheduler** - When user is NOT on the website, Cloud Scheduler triggers cycles for all users

This ensures **identical behavior** whether the user is browsing or not.

### Cloud Scheduler Function

**Location:** `functions/index.js` (exports.runAutomation)  
**Schedule:** Every 1 minute  
**Timezone:** Australia/Sydney

```javascript
exports.runAutomation = functions.pubsub
  .schedule('every 1 minutes')
  .timeZone('Australia/Sydney')
  .onRun(async (_context) => {
    // For each user:
    //   1. Check if interval has elapsed since lastCheck
    //   2. If yes, call /api/automation/cycle endpoint logic
  });
```

### Timing Control

The scheduler checks **every 1 minute**, but only triggers a cycle when enough time has elapsed:

```javascript
const userIntervalMs = userConfig?.automation?.intervalMs || defaultIntervalMs;
const elapsed = Date.now() - (state?.lastCheck || 0);

if (elapsed < userIntervalMs) {
  // Skip - too soon for this user
  continue;
}

// Time to run a cycle
```

This allows different users to have different cycle frequencies while using a single scheduler.

## Configuration

### Server Defaults

**Location:** `functions/index.js` → `getConfig()`

```javascript
automation: {
  intervalMs: 60000,      // Default cycle interval: 60 seconds
  cacheTtl: {
    amber: 60000,         // Amber cache: 60 seconds
    inverter: 300000,     // Inverter cache: 5 minutes
    weather: 1800000      // Weather cache: 30 minutes
  }
}
```

### Per-User Overrides

**Location:** Firestore `users/{uid}/config/main`

```javascript
{
  deviceSn: "ABC123...",           // Required: FoxESS device serial
  foxessToken: "...",              // Required: FoxESS API token
  amberApiKey: "...",              // Required: Amber API key
  automation: {
    intervalMs: 120000,            // Optional: Override cycle interval (2 min)
    inverterCacheTtlMs: 600000,    // Optional: Override inverter cache (10 min)
    blackoutWindows: [             // Optional: Time windows to skip automation
      { enabled: true, start: "22:00", end: "06:00" }
    ]
  }
}
```

### Cache TTL Behavior

| Data Type | Default TTL | Respects Per-User Override |
|-----------|-------------|---------------------------|
| Amber Prices | 60 seconds | No (server config only) |
| Inverter Data | 5 minutes | Yes (`automation.inverterCacheTtlMs`) |
| Weather | 30 minutes | No (server config only) |

## Frontend Integration

### CONFIG Loading

The frontend loads configuration from the backend on page load:

```javascript
// frontend/index.html - initializePageData()
const cfgResp = await authenticatedFetch('/api/config');
const cfg = await cfgResp.json();

// Apply backend config to frontend CONFIG
if (cfg.result.automation?.intervalMs) {
  CONFIG.automation.intervalMs = cfg.result.automation.intervalMs;
}
```

### Countdown Timer

The frontend countdown timer uses the same `intervalMs`:

```javascript
// Calculate remaining time
const elapsed = Math.floor((Date.now() - window.automationLastCheck) / 1000);
const intervalSec = CONFIG.automation.intervalMs / 1000;
const remaining = Math.max(0, intervalSec - elapsed);

// Trigger cycle when countdown reaches 0
if (remaining === 0 && window.automationEnabled) {
  runAutomationCycle();
}
```

### Frontend-Backend Consistency

| Setting | Frontend | Backend |
|---------|----------|---------|
| Default Interval | `CONFIG.automation.intervalMs = 60000` | `getConfig().automation.intervalMs = 60000` |
| Per-User Override | Loaded from `/api/config` | Loaded from Firestore |
| Timing Check | `elapsed >= intervalSec` | `elapsed >= userIntervalMs` |
| Same Endpoint | `POST /api/automation/cycle` | `POST /api/automation/cycle` (via route handler) |

## Use Cases

### Use Case 1: User Browsing Website
```
User opens dashboard
  ↓
Frontend loads /api/automation/status
  ↓
Frontend timer starts countdown (60s default)
  ↓
Timer hits 0 → calls /api/automation/cycle
  ↓
Cycle evaluates rules, applies segments
  ↓
Timer resets, countdown restarts
  ↓
(Meanwhile, Cloud Scheduler also runs, but skipped because too soon)
```

### Use Case 2: User Closes Browser
```
User closes browser
  ↓
Frontend timer stops
  ↓
Cloud Scheduler continues every 1 minute
  ↓
Scheduler checks: elapsed (120s) >= interval (60s) → YES
  ↓
Scheduler calls /api/automation/cycle for user
  ↓
Cycle evaluates rules, applies segments
  ↓
lastCheck updated in Firestore
```

### Use Case 3: Multiple Users, Different Intervals
```
Cloud Scheduler runs (T=0)
  │
  ├─ User A: interval=60s, lastCheck=T-65s → elapsed 65s ≥ 60s → RUN
  ├─ User B: interval=120s, lastCheck=T-90s → elapsed 90s < 120s → SKIP
  ├─ User C: interval=60s, lastCheck=T-30s → elapsed 30s < 60s → SKIP
  └─ User D: automation disabled → SKIP

Cloud Scheduler runs (T=60s)
  │
  ├─ User A: lastCheck=T-60s → elapsed 60s ≥ 60s → RUN
  ├─ User B: lastCheck=T-150s → elapsed 150s ≥ 120s → RUN
  ├─ User C: lastCheck=T-90s → elapsed 90s ≥ 60s → RUN
  └─ User D: automation disabled → SKIP
```

### Use Case 4: Blackout Windows
```
Time: 23:30 Sydney
User config: blackoutWindow 22:00-06:00

Cloud Scheduler triggers
  ↓
Cycle starts for user
  ↓
Check blackout: currentTime (23:30) is within 22:00-06:00
  ↓
Return: { skipped: true, reason: 'In blackout window' }
  ↓
No inverter commands sent
```

### Use Case 5: Rule Evaluation with Cache
```
Cycle runs (T=0)
  ├─ Inverter: cache empty → API call → Counter +1
  ├─ Amber: cache empty → API call → Counter +1
  └─ Rules evaluated...

Cycle runs (T=60s)
  ├─ Inverter: cache age 60s < TTL 300s → CACHE HIT → No API call
  ├─ Amber: cache age 60s ≥ TTL 60s → API call → Counter +1
  └─ Rules evaluated...

Cycle runs (T=120s)
  ├─ Inverter: cache age 120s < TTL 300s → CACHE HIT → No API call
  ├─ Amber: cache age 60s ≥ TTL 60s → API call → Counter +1
  └─ Rules evaluated...
```

## Deployment

### Deploy Functions
```bash
firebase deploy --only functions
```

This deploys both:
- `api` - The HTTP API endpoint
- `runAutomation` - The Cloud Scheduler function

### Verify Deployment
```bash
# Check functions are deployed
firebase functions:list

# Expected output:
# ┌──────────────────┬────────────────────┬─────────────┐
# │ Function         │ Trigger            │ Location    │
# ├──────────────────┼────────────────────┼─────────────┤
# │ api              │ https              │ us-central1 │
# │ runAutomation    │ pubsub (scheduled) │ us-central1 │
# └──────────────────┴────────────────────┴─────────────┘
```

### Monitor Scheduler
```bash
# Watch scheduler logs in real-time
firebase functions:log --only runAutomation --follow

# Expected logs:
# [Scheduler] ========== Background check {id} START ==========
# [Scheduler] Found 5 users
# [Scheduler] User abc123: Triggering cycle (elapsed=65000ms, interval=60000ms)
# [Scheduler] User abc123: ✅ Rule 'High Feed-in' triggered
# [Scheduler] User def456: ⏭️ Skipped: Automation disabled
# [Scheduler] ========== Background check {id} COMPLETE ==========
# [Scheduler] 5 users: 2 cycles, 1 too soon, 2 disabled, 0 errors (1234ms)
```

## Troubleshooting

### Automation Not Running in Background

1. **Check scheduler is deployed:**
   ```bash
   firebase functions:list | grep runAutomation
   ```

2. **Check scheduler logs:**
   ```bash
   firebase functions:log --only runAutomation
   ```

3. **Verify user has automation enabled:**
   - Firestore: `users/{uid}/automation/state` → `enabled: true`

4. **Verify user has device configured:**
   - Firestore: `users/{uid}/config/main` → `deviceSn: "..."`

### API Counters Not Updating

1. **Check if cache is working (expected behavior):**
   - Amber counter: Should increment roughly every 60 seconds
   - Inverter counter: Should increment roughly every 5 minutes
   - Weather counter: Should increment roughly every 30 minutes

2. **Check lastCheck is updating:**
   - Firestore: `users/{uid}/automation/state` → `lastCheck` timestamp

3. **Check for errors in logs:**
   ```bash
   firebase functions:log --only runAutomation | grep "Error\|❌"
   ```

### Different Behavior Frontend vs Backend

Both should behave identically because:
1. Both call the same endpoint (`POST /api/automation/cycle`)
2. Both use the same `intervalMs` configuration
3. Both rely on the same `lastCheck` timestamp

If they differ, check:
- Frontend CONFIG is loading from backend `/api/config`
- No local overrides in frontend code
- `lastCheck` is being saved correctly in Firestore

## API Reference

### POST /api/automation/cycle

Runs one automation cycle for the authenticated user.

**Request:**
```http
POST /api/automation/cycle
Authorization: Bearer {firebase-id-token}
Content-Type: application/json

{}
```

**Response (rule triggered):**
```json
{
  "errno": 0,
  "result": {
    "triggered": true,
    "status": "new_trigger",
    "rule": {
      "name": "High Feed-in",
      "priority": 1
    },
    "action": {
      "workMode": "ForceDischarge",
      "durationMinutes": 30
    }
  }
}
```

**Response (skipped):**
```json
{
  "errno": 0,
  "result": {
    "skipped": true,
    "reason": "In blackout window"
  }
}
```

### GET /api/automation/status

Returns current automation state and all rules.

**Response:**
```json
{
  "errno": 0,
  "result": {
    "enabled": true,
    "lastCheck": 1702531200000,
    "activeRule": "high_feedin",
    "activeRuleName": "High Feed-in",
    "inBlackout": false,
    "rules": {
      "high_feedin": {
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
