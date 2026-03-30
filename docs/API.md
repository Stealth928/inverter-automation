# API Reference

Last updated: 2026-03-26

## Overview

All backend endpoints are served behind the Hosting rewrite at `/api/**`.

Use this document as the narrative guide for the live API surface. For the
generated route inventory, line-level handler map, and frontend-consumer audit,
use [API_CONTRACT_BASELINE_MAR26.md](API_CONTRACT_BASELINE_MAR26.md).

Use [openapi/openapi.v1.yaml](openapi/openapi.v1.yaml) as the incremental
machine-readable subset. It does not yet cover every live route.

## Auth Model

There are four practical auth classes in the live backend:

### 1. Public

No auth required and no user attachment required.

Examples:

- `GET /api/pricing/sites`
- `GET /api/pricing/current`
- `GET /api/pricing/prices`
- `POST /api/auth/forgot-password`

### 2. Optional-auth

Mounted before the global `/api` auth middleware and may attach a user when a
valid token is present.

Examples:

- `GET /api/health`
- `GET /api/metrics/api-calls`
- `POST /api/config/validate-keys`
- `GET /api/config/setup-status`

Important nuance:

- `GET /api/metrics/api-calls?scope=user` requires a signed-in user.
- `GET /api/metrics/api-calls?scope=global` requires an admin user.

### 3. Authenticated

Protected by the global `app.use('/api', authenticateUser)` middleware or by an
explicit per-route auth middleware.

Pass a Firebase ID token:

```text
Authorization: Bearer <firebase-id-token>
```

### 4. Admin

Authenticated routes with `requireAdmin`.

## Response Envelope

The backend uses a consistent envelope:

```json
{
  "errno": 0,
  "result": {},
  "error": "Only present on failures",
  "msg": "Present on selected success or failure responses"
}
```

Notes:

- `errno: 0` means success.
- `result` shape varies by endpoint.
- selected routes also use `msg` for user-facing status text.
- legacy fields are retained on some older routes for compatibility.

## Public and Optional-auth Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/auth/forgot-password` | public | Password-reset initiation |
| `POST` | `/api/config/validate-keys` | optional | Validates FoxESS, Sungrow, SigenEnergy, or AlphaESS credentials; also supports Amber or AEMO pricing selection |
| `GET` | `/api/config/setup-status` | optional | Returns setup completion, detected provider, and effective interval/cache defaults |
| `GET` | `/api/health` | optional | Health envelope plus upstream summary and legacy token-presence flags |
| `GET` | `/api/metrics/api-calls` | optional | Global or per-user daily API metrics, with scope-specific auth rules |
| `GET` | `/api/pricing/sites` | public | Amber site list for signed-in users, or supported AEMO regions |
| `GET` | `/api/pricing/current` | public | Current price intervals for Amber or AEMO |
| `GET` | `/api/pricing/prices` | public | Forecast or historical pricing intervals |
| `GET` | `/api/amber/sites` | public | Legacy alias of `/api/pricing/sites` |
| `GET` | `/api/amber/prices/current` | public | Legacy alias of `/api/pricing/current` |
| `GET` | `/api/amber/prices` | public | Legacy alias of `/api/pricing/prices` |

Pricing notes:

- supported providers are `amber` and `aemo`
- supported AEMO regions are `NSW1`, `QLD1`, `VIC1`, `SA1`, `TAS1`
- AEMO interval objects may also include `demand`, `demandForecast`, and `generation` in MW when those fields are available from the snapshot source
- `/api/pricing/actual` and `/api/amber/prices/actual` are authenticated

## Authenticated User Endpoints

### Config, Profile, and Settings

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Return sanitized user config plus effective automation/cache/default settings |
| `POST` | `/api/config` | Save user config |
| `GET` | `/api/config/system-topology` | Read persisted topology/coupling hint |
| `POST` | `/api/config/system-topology` | Save persisted topology/coupling hint |
| `GET` | `/api/config/telemetry-mappings` | Read telemetry-mapping overrides |
| `POST` | `/api/config/telemetry-mappings` | Save telemetry-mapping overrides |
| `GET` | `/api/config/tour-status` | Read tour completion state |
| `POST` | `/api/config/tour-status` | Save tour completion or dismissal state |
| `GET` | `/api/config/announcement` | Read the currently eligible shared announcement for the signed-in user |
| `POST` | `/api/config/announcement/dismiss` | Persist show-once announcement dismissal |
| `POST` | `/api/config/clear-credentials` | Clear stored provider credentials and disable automation |
| `POST` | `/api/user/init-profile` | Initialize user profile |
| `POST` | `/api/user/delete-account` | Delete current user account and data |

### Automation, Rules, History, Quick Control

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/automation/status` | Current automation state, active rule, and saved rules |
| `POST` | `/api/automation/toggle` | Toggle automation state |
| `POST` | `/api/automation/enable` | Explicitly enable automation |
| `POST` | `/api/automation/trigger` | Trigger automation logic |
| `POST` | `/api/automation/reset` | Reset automation state |
| `POST` | `/api/automation/cancel` | Cancel active automation state |
| `POST` | `/api/automation/rule/create` | Create rule |
| `POST` | `/api/automation/rule/update` | Update rule |
| `POST` | `/api/automation/rule/delete` | Delete rule |
| `POST` | `/api/automation/rule/end` | End active rule |
| `POST` | `/api/automation/test` | Evaluate a rule against supplied/mock inputs |
| `POST` | `/api/automation/cycle` | Run the shared automation cycle handler for the current user |
| `GET` | `/api/automation/history` | User automation history |
| `GET` | `/api/automation/audit` | Rule-evaluation and audit view |
| `POST` | `/api/quickcontrol/start` | Start time-boxed quick charge/discharge override |
| `POST` | `/api/quickcontrol/end` | End active quick control |
| `GET` | `/api/quickcontrol/status` | Read quick-control state |

Behavior notes:

- rule evaluation is AND-only
- rules are processed in priority order
- the first matching rule wins a cycle
- quick control pauses normal automation while active

### Scheduler, Weather, Pricing Actuals

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/scheduler/v1/get` | Read live/current scheduler groups |
| `POST` | `/api/scheduler/v1/set` | Replace scheduler groups |
| `POST` | `/api/scheduler/v1/clear-all` | Clear scheduler groups |
| `GET` | `/api/weather` | Weather data for the authenticated user context |
| `GET` | `/api/pricing/actual` | Resolved settled price at a timestamp |
| `GET` | `/api/amber/prices/actual` | Legacy alias of `/api/pricing/actual` |

Important auth note:

- `GET /api/weather` and `GET /api/scheduler/v1/get` are authenticated in the
  live backend because they are mounted after the global `/api` auth middleware,
  even though their route modules still use `tryAttachUser(...)`.

### Device, Diagnostics, and Inverter Data

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/device/battery/soc/get` | Read battery SoC |
| `POST` | `/api/device/battery/soc/set` | Set battery SoC-related control |
| `GET` | `/api/device/battery/forceChargeTime/get` | Read force-charge time settings |
| `POST` | `/api/device/battery/forceChargeTime/set` | Set force-charge time settings |
| `GET` | `/api/device/workmode/get` | Read current work mode |
| `POST` | `/api/device/workmode/set` | Set work mode |
| `POST` | `/api/device/setting/get` | Read provider/device setting data |
| `POST` | `/api/device/setting/set` | Mutate provider/device setting data |
| `GET` | `/api/device/status/check` | Device health/status check |
| `POST` | `/api/device/getMeterReader` | Meter-reader details |
| `GET` | `/api/ems/list` | EMS list |
| `GET` | `/api/module/list` | Module inventory |
| `GET` | `/api/module/signal` | Module signal data |
| `GET` | `/api/meter/list` | Meter list |
| `GET` | `/api/inverter/list` | Inverter inventory |
| `GET` | `/api/inverter/real-time` | Current normalized inverter telemetry |
| `GET` | `/api/inverter/settings` | Inverter settings |
| `GET` | `/api/inverter/temps` | Temperature view |
| `GET` | `/api/inverter/report` | Report-oriented inverter data |
| `GET` | `/api/inverter/generation` | Generation-oriented view |
| `GET` | `/api/inverter/history` | Historical inverter data |
| `GET` | `/api/inverter/discover-variables` | Variable-discovery tooling |
| `POST` | `/api/inverter/all-data` | Deep diagnostics/all-data read |

### Auth Lifecycle

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health/auth` | Authenticated auth-health check |
| `POST` | `/api/auth/init-user` | Initialize signed-in user data |
| `POST` | `/api/auth/cleanup-user` | Cleanup user data lifecycle state |

### EV and Tesla

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ev/vehicles` | List registered vehicles |
| `POST` | `/api/ev/vehicles` | Register/update a vehicle |
| `DELETE` | `/api/ev/vehicles/:vehicleId` | Remove a vehicle |
| `GET` | `/api/ev/vehicles/:vehicleId/status` | Current normalized vehicle status |
| `POST` | `/api/ev/vehicles/command-readiness` | Batch command-readiness evaluation |
| `GET` | `/api/ev/vehicles/:vehicleId/command-readiness` | Single-vehicle readiness detail |
| `POST` | `/api/ev/vehicles/:vehicleId/wake` | Wake sleeping vehicle |
| `POST` | `/api/ev/vehicles/:vehicleId/command` | Issue EV command |
| `GET` | `/api/ev/tesla-app-config` | Read shared Tesla app config for onboarding |
| `GET` | `/api/ev/oauth/start` | Start Tesla OAuth flow |
| `POST` | `/api/ev/oauth/callback` | Complete Tesla OAuth exchange |
| `POST` | `/api/ev/partner/check-domain-access` | Check Tesla partner-domain access |
| `POST` | `/api/ev/partner/register-domain` | Register Tesla partner domain |

Tesla notes:

- command availability depends on readiness
- some vehicles are `ready_direct`
- some require signed commands and proxy support
- the EV APIs expose both status and command-readiness separately

## Admin Endpoints

All endpoints in this section require an authenticated admin user.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/check` | Authenticated admin-status check for the current user |
| `GET` | `/api/admin/announcement` | Read shared announcement config |
| `POST` | `/api/admin/announcement` | Save shared announcement config |
| `POST` | `/api/admin/announcement/audience-count` | Preview eligible audience size plus show-once dismissal visibility |
| `GET` | `/api/admin/platform-stats` | Platform KPIs and trends |
| `GET` | `/api/admin/firestore-metrics` | Firestore usage, quota, billing, cache metrics |
| `GET` | `/api/admin/scheduler-metrics` | Scheduler metrics and SLO views |
| `GET` | `/api/admin/api-health` | API health metrics and alerts |
| `GET` | `/api/admin/behavior-metrics` | GA4-backed product behavior analytics |
| `GET` | `/api/admin/users` | User list |
| `GET` | `/api/admin/users/:uid/stats` | Per-user stats |
| `POST` | `/api/admin/users/:uid/role` | Role change |
| `POST` | `/api/admin/users/:uid/delete` | Admin delete user |
| `GET` | `/api/admin/dead-letters` | Scheduler dead-letter inventory |
| `POST` | `/api/admin/dead-letters/:userId/:deadLetterId/retry` | Retry captured dead-letter automation cycle |
| `POST` | `/api/admin/impersonate` | Strict impersonation flow |
| `GET` | `/api/admin/dataworks/ops` | GitHub workflow and market-data operations summary |
| `POST` | `/api/admin/dataworks/dispatch` | Dispatch the DataWorks workflow |

## Known Repo-only Route Modules

The repo still contains route modules that are not mounted by `functions/index.js`
and therefore are not part of the live API surface:

- `functions/api/routes/assets.js`
- `functions/api/routes/provider-accounts.js`

Do not document or rely on them as live functionality unless they are mounted in
the backend composition root.
