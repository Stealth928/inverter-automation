# Configuration Architecture

## Overview
All timing constants, thresholds, and configurable values have been centralized to eliminate hardcoded values and improve maintainability. This document describes the configuration architecture.

## Backend Configuration (`backend/server.js`)

All configuration is centralized in the `CONFIG` object at the top of `server.js`:

```javascript
const CONFIG = {
    // Automation timing
    automation: {
        intervalMs: 60 * 1000,              // How often automation cycles run (60s)
        startDelayMs: 5000,                  // Delay before starting automation loop after server start (5s)
        gatherDataTimeoutMs: 8000            // Timeout for gathering data in automation cycle (8s)
    },
    
    // Cache TTLs - how long to cache data before refreshing
    cache: {
        amber: 60 * 1000,                    // 60 seconds - Amber prices change frequently
        inverter: 5 * 60 * 1000,             // 5 minutes - FoxESS has rate limits
        weather: 30 * 60 * 1000              // 30 minutes - weather changes slowly
    },
    
    // Default values for automation rules
    defaults: {
        cooldownMinutes: 5,                  // Default cooldown between rule triggers
        durationMinutes: 30,                 // Default segment duration
        fdPwr: 5000                          // Default force discharge power (watts)
    }
};
```

### Configuration API Endpoint

The configuration is exposed to the frontend via:
```
GET /api/config
```

Response:
```json
{
    "errno": 0,
    "result": {
        "automation": { ... },
        "cache": { ... },
        "defaults": { ... }
    }
}
```

## Frontend Configuration (`frontend/index.html`)

All configuration is centralized in the `CONFIG` object:

```javascript
const CONFIG = {
    // Data refresh intervals (should match backend cache TTLs)
    refresh: {
        amberPricesMs: 60 * 1000,      // 60 seconds - Amber prices
        inverterMs: 5 * 60 * 1000,     // 5 minutes - Inverter data
        weatherMs: 30 * 60 * 1000      // 30 minutes - Weather data
    },
    
    // Automation timing
    automation: {
        intervalMs: 60 * 1000,         // How often automation cycles run (must match backend)
        countdownUpdateMs: 1000        // How often to update countdown display
    },
    
    // UI timing
    ui: {
        statusFadeMs: 5000,            // How long to show status messages
        schedulerReloadDelayMs: 800,   // Delay before reloading scheduler after changes
        amberRetryDelayMs: 500,        // Delay before retrying Amber API call
        toggleAnimationDelayMs: 100,   // Delay for toggle button position update
        automationLoadDelayMs: 300,    // Delay before loading automation status
        tickerIntervalMs: 1000,        // Update interval for 'time since' labels
        copyButtonResetMs: 2000,       // Time to show 'copied' state on copy button
        clearAllDelayMs: 2000          // Delay in clear all segments
    },
    
    // API timeouts
    timeout: {
        schedulerMs: 30000,            // Timeout for scheduler API calls
        testAutomationMs: 15000        // Timeout for test automation calls
    },
    
    // Display limits
    display: {
        forecastLimit: 48,             // Max forecast intervals to show
        defaultAmberNext: 12           // Default number of Amber forecast intervals
    }
};
```

## Benefits of Centralized Configuration

### 1. **Single Source of Truth**
- All timing values are defined in one place
- Easy to find and modify configuration values
- No hidden hardcoded values scattered throughout code

### 2. **Consistency**
- Frontend and backend timing values stay in sync
- Configuration API endpoint exposes backend config to frontend
- Ensures automation timing matches between client and server

### 3. **Maintainability**
- Changes to timing values only need to be made in one location
- Self-documenting code with clear comments
- Easy to understand system behavior

### 4. **Flexibility**
- Can be extended to load from environment variables
- Can be made user-configurable in the future
- Easy to add new configuration options

## Key Configuration Relationships

### Automation Interval Synchronization
- `CONFIG.automation.intervalMs` must match between frontend and backend
- Frontend countdown timer uses this value to display accurate countdowns
- Backend automation loop uses this value for cycle timing

### Cache TTL Synchronization
- Frontend refresh intervals should match backend cache TTLs
- Prevents unnecessary API calls (frontend won't refresh before backend cache expires)
- Optimizes rate limit usage for FoxESS and Amber APIs

### Default Rule Values
- Cooldown prevents rules from triggering too frequently
- Duration determines how long scheduler segments run
- Force discharge power controls battery discharge rate

## Future Enhancements

### Environment Variables
Configuration could be extended to support environment variables:
```javascript
const CONFIG = {
    automation: {
        intervalMs: parseInt(process.env.AUTOMATION_INTERVAL_MS) || 60 * 1000,
        // ...
    }
};
```

### User Configuration UI
A future enhancement could allow users to customize timing values through a UI:
- Automation cycle frequency
- Cache expiration times
- Default rule values
- API timeouts

### Configuration Validation
Add validation to ensure configuration values are within acceptable ranges:
```javascript
function validateConfig(config) {
    if (config.automation.intervalMs < 10000) {
        throw new Error('Automation interval must be at least 10 seconds');
    }
    // ... more validation
}
```

## Migration Notes

All previously hardcoded values have been migrated to the centralized configuration:
- ✅ Automation cycle interval (60 seconds)
- ✅ Cache TTLs (Amber, inverter, weather)
- ✅ Startup delays
- ✅ API timeouts
- ✅ UI status message fade times
- ✅ Scheduler reload delays
- ✅ Default rule values (cooldown, duration, power)

No hardcoded timing values remain in the codebase.
