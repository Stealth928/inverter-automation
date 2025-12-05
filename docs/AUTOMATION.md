# Automation Rules Engine Documentation

## Overview

The automation engine runs every minute via Cloud Scheduler, evaluating user-defined rules against real-time data from FoxESS inverters, Amber electricity prices, and weather forecasts. When conditions are met, it automatically configures the inverter's scheduler to optimize energy usage and costs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloud Scheduler (Every 1 min)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   runAutomation() Function                       │
│  For each user with automation enabled:                         │
│    1. Fetch live data (Amber, Weather, Inverter)                │
│    2. Get user's rules (sorted by priority)                     │
│    3. Evaluate each rule's conditions                           │
│    4. If conditions met → Apply action (set scheduler segment)  │
│    5. Log result to automation history                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Rule Structure

Each automation rule has the following structure:

```javascript
{
  name: "High Feed-in Export",        // Unique rule identifier
  enabled: true,                       // Whether rule is active
  priority: 1,                         // Lower = higher priority (1-10)
  cooldownMinutes: 5,                  // Minimum time between triggers
  
  conditions: {
    feedInPrice: { enabled, operator, value, value2 },
    buyPrice: { enabled, operator, value, value2 },
    soc: { enabled, operator, value, value2 },
    temperature: { enabled, type, operator, value },
    weather: { enabled, condition },
    forecastPrice: { enabled, type, checkType, operator, value, lookAhead },
    time: { enabled, startTime, endTime }
  },
  
  action: {
    workMode: "ForceDischarge",        // SelfUse, ForceDischarge, ForceCharge, Backup
    durationMinutes: 30,               // How long the scheduler segment runs
    fdPwr: 5000,                       // Force discharge power (watts)
    fdSoc: 10,                         // Force discharge minimum SoC
    minSocOnGrid: 10,                  // Minimum SoC on grid
    maxSoc: 100                        // Maximum SoC limit
  }
}
```

---

## Condition Types

### 1. Feed-in Price (`feedInPrice`)
Triggers based on the current Amber feed-in (export) price.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `operator` | string | `>`, `>=`, `<`, `<=`, `between` |
| `value` | number | Price threshold in ¢/kWh |
| `value2` | number | Upper bound (only for `between`) |

**Example**: Export battery when feed-in price > 30¢/kWh
```javascript
feedInPrice: { enabled: true, operator: '>', value: 30 }
```

### 2. Buy Price (`buyPrice`)
Triggers based on the current Amber buy (import) price.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `operator` | string | `>`, `>=`, `<`, `<=`, `between` |
| `value` | number | Price threshold in ¢/kWh |
| `value2` | number | Upper bound (only for `between`) |

**Example**: Charge battery when buy price < 10¢/kWh
```javascript
buyPrice: { enabled: true, operator: '<', value: 10 }
```

### 3. Battery State of Charge (`soc`)
Triggers based on current battery SoC percentage.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `operator` | string | `>`, `>=`, `<`, `<=`, `between` |
| `value` | number | SoC percentage (0-100) |
| `value2` | number | Upper bound (only for `between`) |

**Example**: Only discharge when battery > 80%
```javascript
soc: { enabled: true, operator: '>', value: 80 }
```

### 4. Temperature (`temperature`)
Triggers based on battery, ambient, or inverter temperature.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `type` | string | `battery`, `ambient`, `inverter` |
| `operator` | string | `>`, `>=`, `<`, `<=` |
| `value` | number | Temperature in °C |

**Example**: Reduce charging if battery > 40°C
```javascript
temperature: { enabled: true, type: 'battery', operator: '>', value: 40 }
```

### 5. Weather Condition (`weather`)
Triggers based on current weather from Open-Meteo API.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `condition` | string | `sunny`, `cloudy`, `rainy`, `any` |

**Weather Code Mapping**:
| Condition | Weather Codes | Description |
|-----------|--------------|-------------|
| `sunny` | 0-1 | Clear sky, mainly clear |
| `cloudy` | 2-48 | Partly cloudy, overcast, fog |
| `rainy` | 51+ | Drizzle, rain, snow, thunderstorm |
| `any` | All | Always matches |

**Example**: Force discharge on sunny days (good solar production)
```javascript
weather: { enabled: true, condition: 'sunny' }
```

### 6. Forecast Price (`forecastPrice`)
Triggers based on **future** Amber prices (not current).

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `type` | string | `feedIn` (export) or `general` (buy) |
| `checkType` | string | `average`, `min`, `max`, `any` |
| `operator` | string | `>`, `>=`, `<`, `<=` |
| `value` | number | Price threshold in ¢/kWh |
| `lookAhead` | number | Minutes to look ahead (15, 30, 60) |

**Check Types**:
- `average`: Average price across all intervals
- `min`: Minimum price in the period
- `max`: Maximum price in the period
- `any`: Any single interval meets the threshold

**Example**: Pre-discharge if avg feed-in in next 30min > 25¢
```javascript
forecastPrice: { 
  enabled: true, 
  type: 'feedIn', 
  checkType: 'average', 
  operator: '>', 
  value: 25, 
  lookAhead: 30 
}
```

### 7. Time Window (`time`)
Restricts rule to specific hours of the day.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether this condition is active |
| `startTime` | string | Start time in HH:MM format |
| `endTime` | string | End time in HH:MM format |

**Note**: Supports overnight ranges (e.g., 22:00 to 06:00).

**Example**: Only between 6am and 6pm
```javascript
time: { enabled: true, startTime: '06:00', endTime: '18:00' }
```

---

## Condition Evaluation Logic

**All enabled conditions must be true** for a rule to trigger (AND logic).

```javascript
// Pseudocode
function evaluateRule(rule, cache, inverterData) {
  const results = [];
  
  // Check each enabled condition
  if (conditions.feedInPrice?.enabled) {
    const met = compareValue(cache.amber.feedInPrice, operator, value);
    results.push({ condition: 'feedInPrice', met, actual, target });
  }
  
  if (conditions.soc?.enabled) {
    const met = compareValue(inverterData.SoC, operator, value);
    results.push({ condition: 'soc', met, actual, target });
  }
  
  // ... other conditions ...
  
  // ALL must be met
  const allMet = results.length > 0 && results.every(r => r.met);
  return { triggered: allMet, results };
}
```

---

## Actions (Work Modes)

When a rule triggers, it creates a **scheduler segment** on the inverter.

### Work Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `SelfUse` | Prioritize self-consumption | Default mode, use solar first |
| `ForceDischarge` | Force battery to discharge | Export to grid when prices high |
| `ForceCharge` | Force battery to charge | Charge when prices low |
| `Backup` | Preserve battery for backup | Storm warning, grid instability |

### Action Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `workMode` | string | One of the work modes above |
| `durationMinutes` | number | How long the segment runs (5-1440) |
| `fdPwr` | number | Discharge power in watts (0-10000) |
| `fdSoc` | number | Min SoC for force discharge (0-100) |
| `minSocOnGrid` | number | Min SoC when on grid (0-100) |
| `maxSoc` | number | Max SoC limit (0-100) |

---

## Priority System

Rules are evaluated in **priority order** (lowest number first):
- Priority 1: Highest priority (evaluated first)
- Priority 10: Lowest priority (evaluated last)

**First matching rule wins** - once a rule triggers, remaining rules are skipped.

```javascript
// Example rule priorities
{ name: "Emergency High Price", priority: 1 }  // Checked first
{ name: "High Feed-in", priority: 2 }
{ name: "Low Buy Price", priority: 3 }
{ name: "Default Behavior", priority: 10 }     // Checked last
```

---

## Cooldown System

After a rule triggers, it enters a **cooldown period** to prevent rapid re-triggering.

- Default cooldown: 5 minutes
- Configurable per rule: 1-60 minutes
- Cooldown resets when:
  - Rule is manually disabled
  - Rule is manually cancelled
  - Active segment ends naturally

---

## Active Rule Management

### State Tracking
```javascript
// Firestore: users/{uid}/automation/state
{
  enabled: true,                    // Master automation toggle
  lastCheck: 1733400000000,         // Last cycle timestamp
  activeRule: "High Feed-in",       // Currently active rule name (or null)
  activeRuleId: "rule_abc123",      // Rule document ID
  activeUntil: 1733401800000,       // When segment expires
  inBlackout: false                 // In error recovery period
}
```

### Automatic Segment Expiry
When the active segment expires:
1. UI shows segment as no longer active
2. Rule exits active state
3. Rule becomes eligible for re-evaluation
4. Cooldown still applies

### Manual Cancellation
Users can cancel an active rule via the UI:
1. Clears all scheduler segments
2. Resets rule to SelfUse mode
3. Clears cooldown
4. Rule can trigger again immediately

---

## Data Sources

### Amber API
- **Current prices**: `CurrentInterval` with `channelType` = `general` (buy) or `feedIn`
- **Forecast prices**: `ForecastInterval` (next 12 intervals = 1 hour)
- **Price units**: Cents per kWh (¢/kWh)
- **Update frequency**: Every 5 minutes

### Weather API (Open-Meteo)
- **Current conditions**: Temperature, weather code
- **Forecast**: Daily forecasts for 3 days
- **Update frequency**: Every 30 minutes (cached)

### FoxESS API
- **Real-time data**: SoC, temperatures, power flows
- **Scheduler**: Get/set time-based work modes
- **Update frequency**: Every 5 minutes (rate limited)

---

## FoxESS Scheduler Behavior

### ⚠️ Important: Group Reordering

FoxESS API **reorders scheduler groups** after saving. This is undocumented behavior:

- You send a segment to Group 1
- FoxESS API returns success
- When you read back, segment may be in Group 8

**Our solution**: Match segments by content (time, mode), not by position.

See `FOXESS_SCHEDULER_REORDERING.md` for details.

### Scheduler Limits
- **8 groups maximum** per device
- **Each group**: start/end time, work mode, power settings
- **Minimum duration**: 5 minutes
- **Times**: 24-hour format (HH:MM)

---

## Error Handling

### Blackout Period
After certain errors, automation enters a "blackout" period:
- Duration: 5 minutes
- Prevents rapid retry on persistent errors
- Auto-clears after period expires

### Common Errors
| Error | Cause | Resolution |
|-------|-------|------------|
| `errno: 41808` | FoxESS rate limit | Wait 5 minutes |
| `No inverter data` | Device offline | Check device connection |
| `No Amber data` | API key invalid | Verify Amber settings |
| `No conditions enabled` | Empty rule | Add at least one condition |

---

## UI Debug Information

The automation panel shows real-time debug info:

```
✅ Triggered: High Feed-in Export
   ✓ feedInPrice: 32.5¢ > 30¢
   ✓ soc: 85% > 80%
   ✓ time: 14:30 in 06:00-18:00
   → API: errno=0

Evaluated: 3/5 rules
```

- ✓ Green checkmark = condition met
- ✗ Red X = condition not met
- Shows actual vs target values for debugging

---

## Example Rules

### 1. High Feed-in Export
Export battery when feed-in price is high and battery is charged.

```javascript
{
  name: "High Feed-in Export",
  priority: 1,
  conditions: {
    feedInPrice: { enabled: true, operator: '>', value: 30 },
    soc: { enabled: true, operator: '>', value: 80 },
    time: { enabled: true, startTime: '06:00', endTime: '20:00' }
  },
  action: {
    workMode: "ForceDischarge",
    durationMinutes: 30,
    fdPwr: 5000,
    fdSoc: 20
  }
}
```

### 2. Cheap Rate Charging
Charge battery when electricity is cheap overnight.

```javascript
{
  name: "Cheap Night Charge",
  priority: 2,
  conditions: {
    buyPrice: { enabled: true, operator: '<', value: 10 },
    soc: { enabled: true, operator: '<', value: 50 },
    time: { enabled: true, startTime: '00:00', endTime: '06:00' }
  },
  action: {
    workMode: "ForceCharge",
    durationMinutes: 60,
    maxSoc: 100
  }
}
```

### 3. Sunny Day Self-Use
Maximize self-consumption on sunny days.

```javascript
{
  name: "Sunny Self-Use",
  priority: 5,
  conditions: {
    weather: { enabled: true, condition: 'sunny' },
    soc: { enabled: true, operator: '<', value: 90 }
  },
  action: {
    workMode: "SelfUse",
    durationMinutes: 120,
    minSocOnGrid: 20
  }
}
```

### 4. Pre-emptive Discharge
Discharge before predicted high prices.

```javascript
{
  name: "Pre-emptive Discharge",
  priority: 3,
  conditions: {
    forecastPrice: { 
      enabled: true, 
      type: 'feedIn', 
      checkType: 'average', 
      operator: '>', 
      value: 25, 
      lookAhead: 30 
    },
    soc: { enabled: true, operator: '>', value: 70 }
  },
  action: {
    workMode: "ForceDischarge",
    durationMinutes: 30,
    fdPwr: 3000
  }
}
```

---

## API Endpoints

### Automation Control
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/automation/status` | GET | Get automation state and rules |
| `/api/automation/toggle` | POST | Enable/disable automation |
| `/api/automation/cycle` | POST | Force immediate evaluation cycle |
| `/api/automation/cancel` | POST | Cancel active rule |
| `/api/automation/reset` | POST | Reset automation state |

### Rule Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/automation/rule/create` | POST | Create new rule |
| `/api/automation/rule/update` | POST | Update existing rule |
| `/api/automation/rule/delete` | POST | Delete rule |

### History
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/automation/history` | GET | Get automation event history |

---

## Troubleshooting

### Rule Not Triggering
1. Check if automation is enabled (master toggle)
2. Check if rule is enabled
3. Check cooldown status
4. Verify all conditions are met (see debug panel)
5. Check rule priority (higher priority rule may be blocking)

### Segment Not Applied
1. Check FoxESS API connectivity
2. Verify device serial number in settings
3. Check for API rate limiting (errno 41808)
4. Review scheduler read-back (may be in different group)

### Stale Data
1. Check cache TTLs (Amber: 60s, Weather: 30min)
2. Force refresh with automation cycle trigger
3. Verify API keys are valid
