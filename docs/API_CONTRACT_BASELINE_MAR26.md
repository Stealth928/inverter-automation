# API Contract Baseline (March 2026)

Generated: 2026-03-04 via `node scripts/api-contract-baseline.js --write-doc`

## Summary

- Backend routes discovered: **73**
- APIClient endpoint-method entries: **60**
- Inline HTML endpoint paths discovered: **51**
- Inline HTML endpoint paths missing from APIClient: **0**
- APIClient mismatches vs backend routes: **0**

## Backend Route Inventory

| # | Method | Path | Auth Requirement | Handler | Consumer |
|---:|---|---|---|---|---|
| 1 | GET | `/api/admin/check` | authenticated | `functions/index.js:2314` | APIClient |
| 2 | GET | `/api/admin/firestore-metrics` | admin | `functions/index.js:1516` | APIClient |
| 3 | POST | `/api/admin/impersonate` | admin | `functions/index.js:2253` | APIClient |
| 4 | GET | `/api/admin/platform-stats` | admin | `functions/index.js:1852` | APIClient |
| 5 | GET | `/api/admin/users` | admin | `functions/index.js:1765` | APIClient |
| 6 | POST | `/api/admin/users/:uid/delete` | admin | `functions/index.js:2109` | APIClient |
| 7 | POST | `/api/admin/users/:uid/role` | admin | `functions/index.js:2052` | APIClient |
| 8 | GET | `/api/admin/users/:uid/stats` | admin | `functions/index.js:2168` | APIClient |
| 9 | GET | `/api/amber/prices` | optional | `functions/index.js:837` | APIClient |
| 10 | GET | `/api/amber/prices/actual` | authenticated | `functions/index.js:914` | APIClient |
| 11 | GET | `/api/amber/prices/current` | optional | `functions/index.js:759` | APIClient |
| 12 | GET | `/api/amber/sites` | optional | `functions/index.js:690` | APIClient |
| 13 | POST | `/api/auth/cleanup-user` | authenticated | `functions/index.js:7964` | server-only |
| 14 | POST | `/api/auth/forgot-password` | public | `functions/index.js:473` | server-only |
| 15 | POST | `/api/auth/init-user` | public | `functions/index.js:7915` | APIClient |
| 16 | GET | `/api/automation/audit` | public | `functions/index.js:5688` | APIClient |
| 17 | POST | `/api/automation/cancel` | public | `functions/index.js:4803` | server-only |
| 18 | POST | `/api/automation/cycle` | public | `functions/index.js:3736` | APIClient |
| 19 | POST | `/api/automation/enable` | public | `functions/index.js:3614` | APIClient |
| 20 | GET | `/api/automation/history` | public | `functions/index.js:5667` | APIClient |
| 21 | POST | `/api/automation/reset` | public | `functions/index.js:3710` | APIClient |
| 22 | POST | `/api/automation/rule/create` | public | `functions/index.js:5393` | APIClient |
| 23 | POST | `/api/automation/rule/delete` | public | `functions/index.js:5574` | APIClient |
| 24 | POST | `/api/automation/rule/end` | public | `functions/index.js:5294` | server-only |
| 25 | POST | `/api/automation/rule/update` | public | `functions/index.js:5433` | APIClient |
| 26 | GET | `/api/automation/status` | public | `functions/index.js:3342` | APIClient |
| 27 | POST | `/api/automation/test` | public | `functions/index.js:5822` | APIClient |
| 28 | POST | `/api/automation/toggle` | public | `functions/index.js:3567` | APIClient |
| 29 | POST | `/api/automation/trigger` | public | `functions/index.js:3667` | APIClient |
| 30 | GET | `/api/config` | public | `functions/index.js:3110` | APIClient |
| 31 | POST | `/api/config` | public | `functions/index.js:3217` | APIClient |
| 32 | POST | `/api/config/clear-credentials` | authenticated | `functions/index.js:3281` | APIClient |
| 33 | GET | `/api/config/setup-status` | optional | `functions/index.js:595` | APIClient |
| 34 | GET | `/api/config/system-topology` | public | `functions/index.js:3146` | APIClient |
| 35 | POST | `/api/config/system-topology` | public | `functions/index.js:3173` | APIClient |
| 36 | GET | `/api/config/tour-status` | authenticated | `functions/index.js:3304` | server-only |
| 37 | POST | `/api/config/tour-status` | authenticated | `functions/index.js:3321` | server-only |
| 38 | POST | `/api/config/validate-keys` | optional | `functions/index.js:493` | APIClient |
| 39 | GET | `/api/device/battery/forceChargeTime/get` | public | `functions/index.js:6241` | APIClient |
| 40 | POST | `/api/device/battery/forceChargeTime/set` | public | `functions/index.js:6255` | APIClient |
| 41 | GET | `/api/device/battery/soc/get` | public | `functions/index.js:6012` | APIClient |
| 42 | POST | `/api/device/battery/soc/set` | public | `functions/index.js:6026` | APIClient |
| 43 | POST | `/api/device/getMeterReader` | public | `functions/index.js:6269` | server-only |
| 44 | POST | `/api/device/setting/get` | authenticated | `functions/index.js:6064` | APIClient |
| 45 | POST | `/api/device/setting/set` | authenticated | `functions/index.js:6137` | APIClient |
| 46 | GET | `/api/device/status/check` | authenticated | `functions/index.js:6177` | server-only |
| 47 | GET | `/api/device/workmode/get` | public | `functions/index.js:6559` | APIClient |
| 48 | POST | `/api/device/workmode/set` | public | `functions/index.js:6574` | APIClient |
| 49 | GET | `/api/ems/list` | public | `functions/index.js:6505` | server-only |
| 50 | GET | `/api/health` | optional | `functions/index.js:437` | APIClient |
| 51 | GET | `/api/health/auth` | public | `functions/index.js:2332` | server-only |
| 52 | POST | `/api/inverter/all-data` | authenticated | `functions/index.js:6416` | APIClient |
| 53 | GET | `/api/inverter/discover-variables` | authenticated | `functions/index.js:6388` | APIClient |
| 54 | GET | `/api/inverter/generation` | authenticated | `functions/index.js:6335` | APIClient |
| 55 | GET | `/api/inverter/history` | authenticated | `functions/index.js:7986` | APIClient |
| 56 | GET | `/api/inverter/list` | public | `functions/index.js:5965` | APIClient |
| 57 | GET | `/api/inverter/real-time` | public | `functions/index.js:5975` | APIClient |
| 58 | GET | `/api/inverter/report` | authenticated | `functions/index.js:6299` | APIClient |
| 59 | GET | `/api/inverter/settings` | public | `functions/index.js:5997` | APIClient |
| 60 | GET | `/api/inverter/temps` | public | `functions/index.js:6284` | APIClient |
| 61 | GET | `/api/meter/list` | public | `functions/index.js:6547` | server-only |
| 62 | GET | `/api/metrics/api-calls` | optional | `functions/index.js:1028` | APIClient |
| 63 | GET | `/api/module/list` | public | `functions/index.js:6517` | server-only |
| 64 | GET | `/api/module/signal` | public | `functions/index.js:6529` | server-only |
| 65 | POST | `/api/quickcontrol/end` | authenticated | `functions/index.js:5106` | APIClient |
| 66 | POST | `/api/quickcontrol/start` | authenticated | `functions/index.js:4885` | APIClient |
| 67 | GET | `/api/quickcontrol/status` | authenticated | `functions/index.js:5234` | APIClient |
| 68 | POST | `/api/scheduler/v1/clear-all` | authenticated | `functions/index.js:6828` | APIClient |
| 69 | GET | `/api/scheduler/v1/get` | optional | `functions/index.js:6627` | APIClient |
| 70 | POST | `/api/scheduler/v1/set` | public | `functions/index.js:6665` | APIClient |
| 71 | POST | `/api/user/delete-account` | authenticated | `functions/index.js:3518` | APIClient |
| 72 | POST | `/api/user/init-profile` | authenticated | `functions/index.js:3461` | APIClient |
| 73 | GET | `/api/weather` | optional | `functions/index.js:6611` | APIClient |

## Inline HTML Endpoints Missing from APIClient

No inline-only endpoints were detected.

## APIClient vs Backend Mismatch Check

No APIClient route mismatches detected.

## Notes

- Consumer classification priority: `APIClient` -> `inline` -> `server-only`.
- `Auth Requirement = optional` means no auth middleware on route declaration, but `tryAttachUser(req)` is used in the handler.
- This file is generated and should be refreshed whenever API routes or frontend endpoint calls change.

