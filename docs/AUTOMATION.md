# Automation Rules Engine

Last updated: 2026-03-26

## Overview

The automation engine evaluates user rules against live or cached telemetry,
pricing, weather, and EV state, then applies provider-aware scheduler actions
when a rule wins.

Core properties of the shipped runtime:

- default cycle cadence is 60 seconds
- per-user interval overrides are supported
- rules are sorted by numeric priority
- lower numeric priority wins
- rule evaluation is AND-only
- the first matching rule wins a cycle
- an active higher-priority rule can block or preempt a newly matching
  lower-priority rule
- quick control pauses normal automation while active

Automation can be triggered by:

- `POST /api/automation/cycle`
- the scheduled `runAutomation` Cloud Function

## Rule Storage and State

Important Firestore paths:

- `users/{uid}/rules/{ruleId}`
- `users/{uid}/automation/state`
- `users/{uid}/history/{docId}`
- `users/{uid}/automationAudit/{docId}`
- `users/{uid}/quickControl/state`
- `users/{uid}/curtailment/state`

## Rule Shape

The current rule model is stored as JSON-like documents and includes:

```json
{
  "name": "High Export Event",
  "enabled": true,
  "priority": 1,
  "cooldownMinutes": 5,
  "conditions": {
    "soc": { "enabled": true, "operator": ">=", "value": 80 },
    "price": { "enabled": true, "type": "feedIn", "operator": ">", "value": 25 },
    "time": { "enabled": true, "startTime": "16:00", "endTime": "20:00", "days": [1, 2, 3, 4, 5] }
  },
  "action": {
    "workMode": "ForceDischarge",
    "durationMinutes": 30,
    "fdPwr": 5000,
    "fdSoc": 20,
    "minSocOnGrid": 20,
    "maxSoc": 90
  }
}
```

## Supported Condition Keys

### Current state and price

- `soc`
  - battery state of charge
  - operators: `>`, `>=`, `<`, `<=`, `==`, `!=`, `between`
- `price`
  - preferred current-price condition
  - `type` is `feedIn` or `buy`
  - operators: `>`, `>=`, `<`, `<=`, `==`, `!=`, `between`
- `feedInPrice`
  - legacy export-price condition still evaluated for backward compatibility
- `buyPrice`
  - direct current buy-price condition

### Temperature

- `temperature`
- `temp`

Supported temperature types in the current helper logic:

- `battery`
- ambient/inverter-style legacy values, which map to ambient input in the
  current shared helper
- forecast daily max variants:
  `forecastMax`, `forecast_max`, `dailyMax`, `daily_max`
- forecast daily min variants:
  `forecastMin`, `forecast_min`, `dailyMin`, `daily_min`

Forecast temperature conditions may also use:

- `dayOffset`
- `operator`
- `value`
- `value2` for `between`

### Time windows

- `time`
- `timeWindow`

Supported fields:

- `startTime` or `start`
- `endTime` or `end`
- `days`

Behavior:

- supports overnight windows
- day filters accept weekday numbers or weekday names
- evaluation uses the resolved automation timezone

### Weather forecast conditions

- `solarRadiation`
  - forecast shortwave radiation
  - `checkType`: `average`, `min`, `max`
  - `lookAheadUnit`: `hours` or `days`
- `cloudCover`
  - forecast cloud cover
  - `checkType`: `average`, `min`, `max`
  - `lookAheadUnit`: `hours` or `days`
- `forecastPrice`
  - future Amber/AEMO-shaped price window
  - `type`: `general` or `feedIn`
  - `checkType`: `average`, `min`, `max`, `any`
  - `lookAheadUnit`: `minutes`, `hours`, or `days`

Weather legacy compatibility remains in place through `conditions.weather`.
That legacy path still supports:

- weather-code style `sunny`, `cloudy`, `rainy`
- older radiation/cloud-cover condition shapes

### EV-aware conditions

The evaluator now supports EV state when vehicle data is available:

- `evVehicleSoC`
  - optional `vehicleId`
  - numeric operators including `between`
- `evVehicleLocation`
  - optional `vehicleId`
  - `requireHome: true|false`
- `evChargingState`
  - optional `vehicleId`
  - `state`: string or array of strings

## Evaluation Behavior

Rule evaluation currently works like this:

1. Load the enabled conditions for a rule.
2. Evaluate each enabled condition.
3. Require every enabled condition to pass.
4. Respect cooldown and active-rule state.
5. Stop at the first winning rule in priority order.

Important implications:

- there is no OR tree or nested boolean expression support
- rules with no enabled conditions do not trigger
- lower-priority matching rules do not run once a higher-priority rule wins

## Supported Actions

The action validator accepts these work modes:

- `SelfUse`
- `ForceDischarge`
- `ForceCharge`
- `Feedin`
- `Backup`

Relevant action fields:

- `durationMinutes`
- `fdPwr`
- `fdSoc`
- `minSocOnGrid`
- `maxSoc`

Scheduler-segment defaults applied by the current segment builder:

- `minSocOnGrid`: `20`
- `fdSoc`: `35`
- `maxSoc`: `90`

Safety and validation rules:

- `fdPwr` is required for `ForceDischarge`, `ForceCharge`, and `Feedin`
- `fdPwr` must be greater than zero for those modes
- `fdPwr` is capped by effective inverter capacity
- `durationMinutes` must be between `5` and `1440`
- `fdSoc` is clamped so it cannot be lower than `minSocOnGrid`
- midnight-crossing segments are capped at `23:59`

## Provider-specific Behavior

### Action execution

- FoxESS uses the direct FoxESS scheduler path.
- Sungrow, SigenEnergy, and AlphaESS use adapter-backed schedule reads and
  writes when adapters are registered.

### Work-mode restrictions

- `Backup` is currently rejected for:
  - `alphaess`
  - `sigenergy`

### Diagnostics and maturity

- FoxESS remains the richest diagnostics path.
- Cross-provider support exists, but feature parity is not identical across all
  device integrations.

## Quick Control and Manual Scheduler Interplay

Important runtime behavior:

- quick control is a temporary override path
- quick control cleanup runs before normal automation evaluation
- while quick control is active, normal automation is effectively paused
- manual scheduler changes can later be overwritten by automation

## Curtailment Interplay

Curtailment is evaluated alongside automation but tracked separately.

Current behavior:

- curtailment state lives under `users/{uid}/curtailment/state`
- curtailment compares current feed-in price against the user threshold
- FoxESS is the only provider with live export-limit mutation support
- for non-FoxESS providers, the runtime reports unsupported-provider state and
  deactivates any previously active curtailment state

## Operational Endpoints

Main automation-facing endpoints:

- `GET /api/automation/status`
- `POST /api/automation/toggle`
- `POST /api/automation/enable`
- `POST /api/automation/trigger`
- `POST /api/automation/reset`
- `POST /api/automation/cancel`
- `POST /api/automation/rule/create`
- `POST /api/automation/rule/update`
- `POST /api/automation/rule/delete`
- `POST /api/automation/rule/end`
- `POST /api/automation/test`
- `POST /api/automation/cycle`
- `GET /api/automation/history`
- `GET /api/automation/audit`

## Practical Boundaries

Keep these product and support constraints explicit:

- rule logic is deterministic and rule-based, not ML-driven
- only one rule wins a cycle
- provider capability is not identical across all integrations
- quick control and manual scheduling are not reservation systems; automation can
  overwrite later scheduler state
- curtailment is operationally strongest on the FoxESS path

## Automation Lab

The Automation Lab (`test.html`) provides two modes:

### Quick Simulation

Single-moment rule evaluation with mocked or live inputs. Tests which rule
would win, what scheduler segment would be created, and what API payload would
be sent. Supports quick presets aligned to rule-library templates (High Export,
Cheap Import, Price Spike, Low Battery, Hot Battery, Cloudy Day, Sunny Peak).

### Backtesting / Optimisation

Replays historical data at 5-minute intervals to compare rule sets, tariffs, or
optimization variants against a passive self-use baseline.

Key characteristics:

- maximum lookback: 90 days
- maximum scenarios per run: 3
- replay grid: fixed 5-minute intervals in UTC
- baseline always generated for comparison (passive self-use)
- supports manual tariff plans with time-of-use import/export windows
- supports provider interval tariffs from Amber API history
- failed runs retain provider failure details so Automation Lab can show mapped recovery guidance while still exposing the raw technical error

Delta convention for results:

- `deltaVsBaseline.billAud`: positive = scenario saved money vs baseline
- `deltaVsBaseline.importKWh`: positive = scenario imported less
- `deltaVsBaseline.exportKWh`: positive = scenario exported more
- `deltaVsBaseline.throughputKWh`: informational (positive = more cycling)
- `intervalImpact.helped/hurt/neutral`: count of 5-min intervals where scenario
  beat, lost to, or matched baseline

Unsupported conditions in backtesting:

- EV vehicle conditions (requires vehicle data history)
- Battery temperature history (only forecast/ambient temps available)
- Legacy weather conditions (replaced by solar radiation and cloud cover)

Related endpoints:

- `POST /api/backtests/runs`
- `GET /api/backtests/runs`
- `GET /api/backtests/runs/:runId`
- `GET /api/backtests/tariff-plans`
- `POST /api/backtests/tariff-plans`
- `POST /api/backtests/tariff-plans/:planId`
- `DELETE /api/backtests/tariff-plans/:planId`
