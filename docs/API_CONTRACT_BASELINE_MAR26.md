# API Contract Baseline (March 2026)

Generated: 2026-03-13 via `node scripts/api-contract-baseline.js --write-doc`

## Summary

- Backend routes discovered: **92**
- APIClient endpoint-method entries: **67**
- Inline HTML endpoint paths discovered: **1**
- Inline HTML endpoint paths missing from APIClient: **0**
- APIClient mismatches vs backend routes: **0**

## Backend Route Inventory

| # | Method | Path | Auth Requirement | Handler | Consumer |
|---:|---|---|---|---|---|
| 1 | GET | `/api/admin/check` | authenticated | `functions/api/routes/admin.js:1655` | APIClient |
| 2 | GET | `/api/admin/firestore-metrics` | admin | `functions/api/routes/admin.js:75` | APIClient |
| 3 | POST | `/api/admin/impersonate` | admin | `functions/api/routes/admin.js:1594` | APIClient |
| 4 | GET | `/api/admin/platform-stats` | admin | `functions/api/routes/admin.js:446` | APIClient |
| 5 | GET | `/api/admin/scheduler-metrics` | admin | `functions/api/routes/admin.js:671` | APIClient |
| 6 | GET | `/api/admin/users` | admin | `functions/api/routes/admin.js:359` | APIClient |
| 7 | POST | `/api/admin/users/:uid/delete` | admin | `functions/api/routes/admin.js:1264` | APIClient |
| 8 | POST | `/api/admin/users/:uid/role` | admin | `functions/api/routes/admin.js:1207` | APIClient |
| 9 | GET | `/api/admin/users/:uid/stats` | admin | `functions/api/routes/admin.js:1323` | APIClient |
| 10 | GET | `/api/amber/prices` | public | `functions/api/routes/pricing.js:404` | server-only |
| 11 | GET | `/api/amber/prices/actual` | authenticated | `functions/api/routes/pricing.js:405` | server-only |
| 12 | GET | `/api/amber/prices/current` | public | `functions/api/routes/pricing.js:403` | server-only |
| 13 | GET | `/api/amber/sites` | public | `functions/api/routes/pricing.js:402` | server-only |
| 14 | GET | `/api/assets` | authenticated | `functions/api/routes/assets.js:38` | server-only |
| 15 | DELETE | `/api/assets/:assetId` | authenticated | `functions/api/routes/assets.js:83` | server-only |
| 16 | POST | `/api/assets/migrate` | authenticated | `functions/api/routes/assets.js:61` | server-only |
| 17 | POST | `/api/auth/cleanup-user` | authenticated | `functions/api/routes/auth-lifecycle.js:84` | server-only |
| 18 | POST | `/api/auth/forgot-password` | public | `functions/api/routes/setup-public.js:64` | server-only |
| 19 | POST | `/api/auth/init-user` | authenticated | `functions/api/routes/auth-lifecycle.js:39` | APIClient |
| 20 | GET | `/api/automation/audit` | public | `functions/api/routes/automation-history.js:30` | APIClient |
| 21 | POST | `/api/automation/cancel` | public | `functions/api/routes/automation-mutations.js:355` | server-only |
| 22 | POST | `/api/automation/cycle` | public | `functions/api/routes/automation-cycle.js:1064` | APIClient |
| 23 | POST | `/api/automation/enable` | public | `functions/api/routes/automation-mutations.js:255` | APIClient |
| 24 | GET | `/api/automation/history` | public | `functions/api/routes/automation-history.js:18` | APIClient |
| 25 | POST | `/api/automation/reset` | public | `functions/api/routes/automation-mutations.js:335` | APIClient |
| 26 | POST | `/api/automation/rule/create` | public | `functions/api/routes/automation-mutations.js:495` | APIClient |
| 27 | POST | `/api/automation/rule/delete` | public | `functions/api/routes/automation-mutations.js:663` | APIClient |
| 28 | POST | `/api/automation/rule/end` | public | `functions/api/routes/automation-mutations.js:396` | server-only |
| 29 | POST | `/api/automation/rule/update` | public | `functions/api/routes/automation-mutations.js:535` | APIClient |
| 30 | GET | `/api/automation/status` | public | `functions/api/routes/config-read-status.js:178` | APIClient |
| 31 | POST | `/api/automation/test` | public | `functions/api/routes/automation-mutations.js:743` | APIClient |
| 32 | POST | `/api/automation/toggle` | public | `functions/api/routes/automation-mutations.js:224` | APIClient |
| 33 | POST | `/api/automation/trigger` | public | `functions/api/routes/automation-mutations.js:292` | APIClient |
| 34 | GET | `/api/config` | public | `functions/api/routes/config-read-status.js:95` | APIClient |
| 35 | POST | `/api/config` | public | `functions/api/routes/config-mutations.js:119` | APIClient |
| 36 | POST | `/api/config/clear-credentials` | authenticated | `functions/api/routes/config-mutations.js:201` | APIClient |
| 37 | GET | `/api/config/provider-accounts` | authenticated | `functions/api/routes/provider-accounts.js:40` | server-only |
| 38 | POST | `/api/config/provider-accounts` | authenticated | `functions/api/routes/provider-accounts.js:72` | server-only |
| 39 | DELETE | `/api/config/provider-accounts/:id` | authenticated | `functions/api/routes/provider-accounts.js:110` | server-only |
| 40 | POST | `/api/config/provider-accounts/migrate` | authenticated | `functions/api/routes/provider-accounts.js:133` | server-only |
| 41 | GET | `/api/config/setup-status` | optional | `functions/api/routes/setup-public.js:479` | APIClient |
| 42 | GET | `/api/config/sites` | authenticated | `functions/api/routes/provider-accounts.js:161` | server-only |
| 43 | GET | `/api/config/system-topology` | public | `functions/api/routes/config-read-status.js:134` | APIClient |
| 44 | POST | `/api/config/system-topology` | public | `functions/api/routes/config-mutations.js:75` | APIClient |
| 45 | GET | `/api/config/tour-status` | authenticated | `functions/api/routes/config-read-status.js:161` | server-only |
| 46 | POST | `/api/config/tour-status` | authenticated | `functions/api/routes/config-mutations.js:245` | server-only |
| 47 | POST | `/api/config/validate-keys` | optional | `functions/api/routes/setup-public.js:84` | APIClient |
| 48 | GET | `/api/device/battery/forceChargeTime/get` | public | `functions/api/routes/device-read.js:114` | APIClient |
| 49 | POST | `/api/device/battery/forceChargeTime/set` | public | `functions/api/routes/device-mutations.js:125` | APIClient |
| 50 | GET | `/api/device/battery/soc/get` | public | `functions/api/routes/device-read.js:35` | APIClient |
| 51 | POST | `/api/device/battery/soc/set` | public | `functions/api/routes/device-mutations.js:35` | APIClient |
| 52 | POST | `/api/device/getMeterReader` | public | `functions/api/routes/device-read.js:129` | server-only |
| 53 | POST | `/api/device/setting/get` | authenticated | `functions/api/routes/diagnostics-read.js:196` | APIClient |
| 54 | POST | `/api/device/setting/set` | authenticated | `functions/api/routes/device-mutations.js:77` | APIClient |
| 55 | GET | `/api/device/status/check` | authenticated | `functions/api/routes/device-read.js:50` | server-only |
| 56 | GET | `/api/device/workmode/get` | public | `functions/api/routes/device-read.js:203` | APIClient |
| 57 | POST | `/api/device/workmode/set` | public | `functions/api/routes/device-mutations.js:146` | APIClient |
| 58 | GET | `/api/ems/list` | public | `functions/api/routes/device-read.js:145` | server-only |
| 59 | POST | `/api/ev/oauth/callback` | authenticated | `functions/api/routes/ev.js:693` | APIClient |
| 60 | GET | `/api/ev/oauth/start` | authenticated | `functions/api/routes/ev.js:675` | APIClient |
| 61 | GET | `/api/ev/vehicles` | authenticated | `functions/api/routes/ev.js:332` | APIClient |
| 62 | POST | `/api/ev/vehicles` | authenticated | `functions/api/routes/ev.js:347` | APIClient |
| 63 | DELETE | `/api/ev/vehicles/:vehicleId` | authenticated | `functions/api/routes/ev.js:400` | APIClient |
| 64 | GET | `/api/ev/vehicles/:vehicleId/status` | authenticated | `functions/api/routes/ev.js:419` | APIClient |
| 65 | GET | `/api/health` | optional | `functions/api/routes/health.js:18` | APIClient |
| 66 | GET | `/api/health/auth` | authenticated | `functions/api/routes/auth-lifecycle.js:34` | server-only |
| 67 | POST | `/api/inverter/all-data` | authenticated | `functions/api/routes/diagnostics-read.js:273` | APIClient |
| 68 | GET | `/api/inverter/discover-variables` | authenticated | `functions/api/routes/inverter-read.js:487` | APIClient |
| 69 | GET | `/api/inverter/generation` | authenticated | `functions/api/routes/inverter-read.js:422` | APIClient |
| 70 | GET | `/api/inverter/history` | authenticated | `functions/api/routes/inverter-history.js:56` | APIClient |
| 71 | GET | `/api/inverter/list` | public | `functions/api/routes/inverter-read.js:291` | APIClient |
| 72 | GET | `/api/inverter/real-time` | public | `functions/api/routes/inverter-read.js:302` | APIClient |
| 73 | GET | `/api/inverter/report` | authenticated | `functions/api/routes/inverter-read.js:374` | APIClient |
| 74 | GET | `/api/inverter/settings` | public | `functions/api/routes/inverter-read.js:342` | APIClient |
| 75 | GET | `/api/inverter/temps` | public | `functions/api/routes/inverter-read.js:358` | APIClient |
| 76 | GET | `/api/meter/list` | public | `functions/api/routes/device-read.js:190` | server-only |
| 77 | GET | `/api/metrics/api-calls` | optional | `functions/api/routes/metrics.js:131` | APIClient |
| 78 | GET | `/api/module/list` | public | `functions/api/routes/device-read.js:158` | server-only |
| 79 | GET | `/api/module/signal` | public | `functions/api/routes/device-read.js:171` | server-only |
| 80 | GET | `/api/pricing/actual` | authenticated | `functions/api/routes/pricing.js:405` | APIClient |
| 81 | GET | `/api/pricing/current` | public | `functions/api/routes/pricing.js:403` | APIClient |
| 82 | GET | `/api/pricing/prices` | public | `functions/api/routes/pricing.js:404` | APIClient |
| 83 | GET | `/api/pricing/sites` | public | `functions/api/routes/pricing.js:402` | APIClient |
| 84 | POST | `/api/quickcontrol/end` | authenticated | `functions/api/routes/quick-control.js:331` | APIClient |
| 85 | POST | `/api/quickcontrol/start` | authenticated | `functions/api/routes/quick-control.js:72` | APIClient |
| 86 | GET | `/api/quickcontrol/status` | authenticated | `functions/api/routes/quick-control.js:469` | APIClient |
| 87 | POST | `/api/scheduler/v1/clear-all` | authenticated | `functions/api/routes/scheduler-mutations.js:82` | APIClient |
| 88 | GET | `/api/scheduler/v1/get` | optional | `functions/api/routes/scheduler-read.js:42` | APIClient |
| 89 | POST | `/api/scheduler/v1/set` | public | `functions/api/routes/scheduler-mutations.js:32` | APIClient |
| 90 | POST | `/api/user/delete-account` | authenticated | `functions/api/routes/user-self.js:91` | APIClient |
| 91 | POST | `/api/user/init-profile` | authenticated | `functions/api/routes/user-self.js:34` | APIClient |
| 92 | GET | `/api/weather` | optional | `functions/api/routes/weather.js:18` | APIClient |

## Inline HTML Endpoints Missing from APIClient

No inline-only endpoints were detected.

## APIClient vs Backend Mismatch Check

No APIClient route mismatches detected.

## Notes

- Consumer classification priority: `APIClient` -> `inline` -> `server-only`.
- `Auth Requirement = optional` means no auth middleware on route declaration, but `tryAttachUser(req)` is used in the handler.
- This file is generated and should be refreshed whenever API routes or frontend endpoint calls change.

