# API Contract Baseline (March 2026)

Generated: 2026-03-26 via `node scripts/api-contract-baseline.js --write-doc`

## Summary

- Backend routes discovered: **104**
- Mounted route modules scanned: **22**
- Unmounted route modules excluded: **2**
- APIClient endpoint-method entries: **78**
- Inline HTML endpoint paths discovered: **1**
- Inline HTML endpoint paths missing from APIClient: **0**
- APIClient mismatches vs backend routes: **0**

## Backend Route Inventory

| # | Method | Path | Auth Requirement | Handler | Consumer |
|---:|---|---|---|---|---|
| 1 | GET | `/api/admin/announcement` | admin | `functions/api/routes/admin.js:1166` | server-only |
| 2 | POST | `/api/admin/announcement` | admin | `functions/api/routes/admin.js:1176` | server-only |
| 3 | GET | `/api/admin/api-health` | admin | `functions/api/routes/admin.js:2542` | APIClient |
| 4 | GET | `/api/admin/behavior-metrics` | admin | `functions/api/routes/admin.js:2252` | server-only |
| 5 | GET | `/api/admin/check` | authenticated | `functions/api/routes/admin.js:5110` | APIClient |
| 6 | POST | `/api/admin/dataworks/dispatch` | admin | `functions/api/routes/admin.js:4404` | APIClient |
| 7 | GET | `/api/admin/dataworks/ops` | admin | `functions/api/routes/admin.js:4386` | APIClient |
| 8 | GET | `/api/admin/dead-letters` | admin | `functions/api/routes/admin.js:4622` | server-only |
| 9 | POST | `/api/admin/dead-letters/:userId/:deadLetterId/retry` | admin | `functions/api/routes/admin.js:4704` | server-only |
| 10 | GET | `/api/admin/firestore-metrics` | admin | `functions/api/routes/admin.js:1951` | APIClient |
| 11 | POST | `/api/admin/impersonate` | admin | `functions/api/routes/admin.js:5049` | APIClient |
| 12 | GET | `/api/admin/platform-stats` | admin | `functions/api/routes/admin.js:3390` | APIClient |
| 13 | GET | `/api/admin/scheduler-metrics` | admin | `functions/api/routes/admin.js:3571` | APIClient |
| 14 | GET | `/api/admin/users` | admin | `functions/api/routes/admin.js:2891` | APIClient |
| 15 | POST | `/api/admin/users/:uid/delete` | admin | `functions/api/routes/admin.js:4549` | APIClient |
| 16 | POST | `/api/admin/users/:uid/role` | admin | `functions/api/routes/admin.js:4491` | APIClient |
| 17 | GET | `/api/admin/users/:uid/stats` | admin | `functions/api/routes/admin.js:4774` | APIClient |
| 18 | GET | `/api/amber/prices` | public | `functions/api/routes/pricing.js:481` | server-only |
| 19 | GET | `/api/amber/prices/actual` | authenticated | `functions/api/routes/pricing.js:483` | server-only |
| 20 | GET | `/api/amber/prices/current` | public | `functions/api/routes/pricing.js:479` | server-only |
| 21 | GET | `/api/amber/sites` | public | `functions/api/routes/pricing.js:477` | server-only |
| 22 | POST | `/api/auth/cleanup-user` | authenticated | `functions/api/routes/auth-lifecycle.js:84` | server-only |
| 23 | POST | `/api/auth/forgot-password` | public | `functions/api/routes/setup-public.js:100` | server-only |
| 24 | POST | `/api/auth/init-user` | authenticated | `functions/api/routes/auth-lifecycle.js:39` | APIClient |
| 25 | GET | `/api/automation/audit` | authenticated | `functions/api/routes/automation-history.js:30` | APIClient |
| 26 | POST | `/api/automation/cancel` | authenticated | `functions/api/routes/automation-mutations.js:355` | server-only |
| 27 | POST | `/api/automation/cycle` | authenticated | `functions/api/routes/automation-cycle.js:1129` | APIClient |
| 28 | POST | `/api/automation/enable` | authenticated | `functions/api/routes/automation-mutations.js:255` | APIClient |
| 29 | GET | `/api/automation/history` | authenticated | `functions/api/routes/automation-history.js:18` | APIClient |
| 30 | POST | `/api/automation/reset` | authenticated | `functions/api/routes/automation-mutations.js:335` | APIClient |
| 31 | POST | `/api/automation/rule/create` | authenticated | `functions/api/routes/automation-mutations.js:495` | APIClient |
| 32 | POST | `/api/automation/rule/delete` | authenticated | `functions/api/routes/automation-mutations.js:663` | APIClient |
| 33 | POST | `/api/automation/rule/end` | authenticated | `functions/api/routes/automation-mutations.js:396` | server-only |
| 34 | POST | `/api/automation/rule/update` | authenticated | `functions/api/routes/automation-mutations.js:535` | APIClient |
| 35 | GET | `/api/automation/status` | authenticated | `functions/api/routes/config-read-status.js:360` | APIClient |
| 36 | POST | `/api/automation/test` | authenticated | `functions/api/routes/automation-mutations.js:743` | APIClient |
| 37 | POST | `/api/automation/toggle` | authenticated | `functions/api/routes/automation-mutations.js:224` | APIClient |
| 38 | POST | `/api/automation/trigger` | authenticated | `functions/api/routes/automation-mutations.js:292` | APIClient |
| 39 | GET | `/api/config` | authenticated | `functions/api/routes/config-read-status.js:230` | APIClient |
| 40 | POST | `/api/config` | authenticated | `functions/api/routes/config-mutations.js:202` | APIClient |
| 41 | GET | `/api/config/announcement` | authenticated | `functions/api/routes/config-read-status.js:329` | server-only |
| 42 | POST | `/api/config/announcement/dismiss` | authenticated | `functions/api/routes/config-mutations.js:356` | server-only |
| 43 | POST | `/api/config/clear-credentials` | authenticated | `functions/api/routes/config-mutations.js:284` | APIClient |
| 44 | GET | `/api/config/setup-status` | optional | `functions/api/routes/setup-public.js:521` | APIClient |
| 45 | GET | `/api/config/system-topology` | authenticated | `functions/api/routes/config-read-status.js:269` | APIClient |
| 46 | POST | `/api/config/system-topology` | authenticated | `functions/api/routes/config-mutations.js:134` | APIClient |
| 47 | GET | `/api/config/telemetry-mappings` | authenticated | `functions/api/routes/config-read-status.js:296` | server-only |
| 48 | POST | `/api/config/telemetry-mappings` | authenticated | `functions/api/routes/config-mutations.js:178` | server-only |
| 49 | GET | `/api/config/tour-status` | authenticated | `functions/api/routes/config-read-status.js:313` | server-only |
| 50 | POST | `/api/config/tour-status` | authenticated | `functions/api/routes/config-mutations.js:336` | server-only |
| 51 | POST | `/api/config/validate-keys` | optional | `functions/api/routes/setup-public.js:120` | APIClient |
| 52 | GET | `/api/device/battery/forceChargeTime/get` | authenticated | `functions/api/routes/device-read.js:167` | APIClient |
| 53 | POST | `/api/device/battery/forceChargeTime/set` | authenticated | `functions/api/routes/device-mutations.js:143` | APIClient |
| 54 | GET | `/api/device/battery/soc/get` | authenticated | `functions/api/routes/device-read.js:88` | APIClient |
| 55 | POST | `/api/device/battery/soc/set` | authenticated | `functions/api/routes/device-mutations.js:53` | APIClient |
| 56 | POST | `/api/device/getMeterReader` | authenticated | `functions/api/routes/device-read.js:182` | server-only |
| 57 | POST | `/api/device/setting/get` | authenticated | `functions/api/routes/diagnostics-read.js:220` | APIClient |
| 58 | POST | `/api/device/setting/set` | authenticated | `functions/api/routes/device-mutations.js:98` | APIClient |
| 59 | GET | `/api/device/status/check` | authenticated | `functions/api/routes/device-read.js:103` | server-only |
| 60 | GET | `/api/device/workmode/get` | authenticated | `functions/api/routes/device-read.js:256` | APIClient |
| 61 | POST | `/api/device/workmode/set` | authenticated | `functions/api/routes/device-mutations.js:164` | APIClient |
| 62 | GET | `/api/ems/list` | authenticated | `functions/api/routes/device-read.js:198` | server-only |
| 63 | POST | `/api/ev/oauth/callback` | authenticated | `functions/api/routes/ev.js:2357` | APIClient |
| 64 | GET | `/api/ev/oauth/start` | authenticated | `functions/api/routes/ev.js:2156` | APIClient |
| 65 | POST | `/api/ev/partner/check-domain-access` | authenticated | `functions/api/routes/ev.js:2179` | APIClient |
| 66 | POST | `/api/ev/partner/register-domain` | authenticated | `functions/api/routes/ev.js:2252` | APIClient |
| 67 | GET | `/api/ev/tesla-app-config` | authenticated | `functions/api/routes/ev.js:2084` | APIClient |
| 68 | POST | `/api/ev/tesla-app-config` | admin | `functions/api/routes/ev.js:2113` | APIClient |
| 69 | GET | `/api/ev/vehicles` | authenticated | `functions/api/routes/ev.js:844` | APIClient |
| 70 | POST | `/api/ev/vehicles` | authenticated | `functions/api/routes/ev.js:859` | APIClient |
| 71 | DELETE | `/api/ev/vehicles/:vehicleId` | authenticated | `functions/api/routes/ev.js:912` | APIClient |
| 72 | POST | `/api/ev/vehicles/:vehicleId/command` | authenticated | `functions/api/routes/ev.js:1785` | APIClient |
| 73 | GET | `/api/ev/vehicles/:vehicleId/command-readiness` | authenticated | `functions/api/routes/ev.js:1391` | APIClient |
| 74 | GET | `/api/ev/vehicles/:vehicleId/status` | authenticated | `functions/api/routes/ev.js:931` | APIClient |
| 75 | POST | `/api/ev/vehicles/:vehicleId/wake` | authenticated | `functions/api/routes/ev.js:1647` | APIClient |
| 76 | POST | `/api/ev/vehicles/command-readiness` | authenticated | `functions/api/routes/ev.js:1220` | APIClient |
| 77 | GET | `/api/health` | optional | `functions/api/routes/health.js:19` | APIClient |
| 78 | GET | `/api/health/auth` | authenticated | `functions/api/routes/auth-lifecycle.js:34` | server-only |
| 79 | POST | `/api/inverter/all-data` | authenticated | `functions/api/routes/diagnostics-read.js:297` | APIClient |
| 80 | GET | `/api/inverter/discover-variables` | authenticated | `functions/api/routes/inverter-read.js:480` | APIClient |
| 81 | GET | `/api/inverter/generation` | authenticated | `functions/api/routes/inverter-read.js:415` | APIClient |
| 82 | GET | `/api/inverter/history` | authenticated | `functions/api/routes/inverter-history.js:66` | APIClient |
| 83 | GET | `/api/inverter/list` | authenticated | `functions/api/routes/inverter-read.js:292` | APIClient |
| 84 | GET | `/api/inverter/real-time` | authenticated | `functions/api/routes/inverter-read.js:303` | APIClient |
| 85 | GET | `/api/inverter/report` | authenticated | `functions/api/routes/inverter-read.js:367` | APIClient |
| 86 | GET | `/api/inverter/settings` | authenticated | `functions/api/routes/inverter-read.js:335` | APIClient |
| 87 | GET | `/api/inverter/temps` | authenticated | `functions/api/routes/inverter-read.js:351` | APIClient |
| 88 | GET | `/api/meter/list` | authenticated | `functions/api/routes/device-read.js:243` | server-only |
| 89 | GET | `/api/metrics/api-calls` | optional | `functions/api/routes/metrics.js:123` | APIClient |
| 90 | GET | `/api/module/list` | authenticated | `functions/api/routes/device-read.js:211` | server-only |
| 91 | GET | `/api/module/signal` | authenticated | `functions/api/routes/device-read.js:224` | server-only |
| 92 | GET | `/api/pricing/actual` | authenticated | `functions/api/routes/pricing.js:482` | APIClient |
| 93 | GET | `/api/pricing/current` | public | `functions/api/routes/pricing.js:478` | APIClient |
| 94 | GET | `/api/pricing/prices` | public | `functions/api/routes/pricing.js:480` | APIClient |
| 95 | GET | `/api/pricing/sites` | public | `functions/api/routes/pricing.js:476` | APIClient |
| 96 | POST | `/api/quickcontrol/end` | authenticated | `functions/api/routes/quick-control.js:338` | APIClient |
| 97 | POST | `/api/quickcontrol/start` | authenticated | `functions/api/routes/quick-control.js:79` | APIClient |
| 98 | GET | `/api/quickcontrol/status` | authenticated | `functions/api/routes/quick-control.js:478` | APIClient |
| 99 | POST | `/api/scheduler/v1/clear-all` | authenticated | `functions/api/routes/scheduler-mutations.js:135` | APIClient |
| 100 | GET | `/api/scheduler/v1/get` | authenticated | `functions/api/routes/scheduler-read.js:42` | APIClient |
| 101 | POST | `/api/scheduler/v1/set` | authenticated | `functions/api/routes/scheduler-mutations.js:70` | APIClient |
| 102 | POST | `/api/user/delete-account` | authenticated | `functions/api/routes/user-self.js:91` | APIClient |
| 103 | POST | `/api/user/init-profile` | authenticated | `functions/api/routes/user-self.js:34` | APIClient |
| 104 | GET | `/api/weather` | authenticated | `functions/api/routes/weather.js:18` | APIClient |

## Inline HTML Endpoints Missing from APIClient

No inline-only endpoints were detected.

## APIClient vs Backend Mismatch Check

No APIClient route mismatches detected.

## Notes

- Consumer classification priority: `APIClient` -> `inline` -> `server-only`.
- `Auth Requirement = optional` means the route is mounted before the global `/api` auth middleware and calls `tryAttachUser(req)` inside the handler.
- Routes mounted after `app.use('/api', authenticateUser)` inherit `authenticated` even when their route modules omit explicit middleware.
- Unmounted route modules are intentionally excluded from this report: `functions/api/routes/assets.js`, `functions/api/routes/provider-accounts.js`.
- This file is generated and should be refreshed whenever API routes or frontend endpoint calls change.

