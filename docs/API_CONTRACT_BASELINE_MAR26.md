# API Contract Baseline (March 2026)

Generated: 2026-03-04 via `node scripts/api-contract-baseline.js --write-doc`

## Summary

- Backend routes discovered: **73**
- APIClient endpoint-method entries: **19**
- Inline HTML endpoint paths discovered: **51**
- Inline HTML endpoint paths missing from APIClient: **38**
- APIClient mismatches vs backend routes: **0**

## Backend Route Inventory

| # | Method | Path | Auth Requirement | Handler | Consumer |
|---:|---|---|---|---|---|
| 1 | GET | `/api/admin/check` | authenticated | `functions/index.js:2280` | inline |
| 2 | GET | `/api/admin/firestore-metrics` | admin | `functions/index.js:1516` | inline |
| 3 | POST | `/api/admin/impersonate` | admin | `functions/index.js:2219` | inline |
| 4 | GET | `/api/admin/platform-stats` | admin | `functions/index.js:1852` | inline |
| 5 | GET | `/api/admin/users` | admin | `functions/index.js:1765` | inline |
| 6 | POST | `/api/admin/users/:uid/delete` | admin | `functions/index.js:2075` | inline |
| 7 | POST | `/api/admin/users/:uid/role` | admin | `functions/index.js:2052` | inline |
| 8 | GET | `/api/admin/users/:uid/stats` | admin | `functions/index.js:2134` | inline |
| 9 | GET | `/api/amber/prices` | optional | `functions/index.js:837` | APIClient |
| 10 | GET | `/api/amber/prices/actual` | authenticated | `functions/index.js:914` | APIClient |
| 11 | GET | `/api/amber/prices/current` | optional | `functions/index.js:759` | inline |
| 12 | GET | `/api/amber/sites` | optional | `functions/index.js:690` | APIClient |
| 13 | POST | `/api/auth/cleanup-user` | authenticated | `functions/index.js:7930` | server-only |
| 14 | POST | `/api/auth/forgot-password` | public | `functions/index.js:473` | server-only |
| 15 | POST | `/api/auth/init-user` | public | `functions/index.js:7881` | inline |
| 16 | GET | `/api/automation/audit` | public | `functions/index.js:5654` | inline |
| 17 | POST | `/api/automation/cancel` | public | `functions/index.js:4769` | server-only |
| 18 | POST | `/api/automation/cycle` | public | `functions/index.js:3702` | inline |
| 19 | POST | `/api/automation/enable` | public | `functions/index.js:3580` | inline |
| 20 | GET | `/api/automation/history` | public | `functions/index.js:5633` | APIClient |
| 21 | POST | `/api/automation/reset` | public | `functions/index.js:3676` | inline |
| 22 | POST | `/api/automation/rule/create` | public | `functions/index.js:5359` | APIClient |
| 23 | POST | `/api/automation/rule/delete` | public | `functions/index.js:5540` | APIClient |
| 24 | POST | `/api/automation/rule/end` | public | `functions/index.js:5260` | server-only |
| 25 | POST | `/api/automation/rule/update` | public | `functions/index.js:5399` | inline |
| 26 | GET | `/api/automation/status` | public | `functions/index.js:3308` | APIClient |
| 27 | POST | `/api/automation/test` | public | `functions/index.js:5788` | APIClient |
| 28 | POST | `/api/automation/toggle` | public | `functions/index.js:3533` | APIClient |
| 29 | POST | `/api/automation/trigger` | public | `functions/index.js:3633` | inline |
| 30 | GET | `/api/config` | public | `functions/index.js:3076` | APIClient |
| 31 | POST | `/api/config` | public | `functions/index.js:3183` | APIClient |
| 32 | POST | `/api/config/clear-credentials` | authenticated | `functions/index.js:3247` | inline |
| 33 | GET | `/api/config/setup-status` | optional | `functions/index.js:595` | inline |
| 34 | GET | `/api/config/system-topology` | public | `functions/index.js:3112` | inline |
| 35 | POST | `/api/config/system-topology` | public | `functions/index.js:3139` | inline |
| 36 | GET | `/api/config/tour-status` | authenticated | `functions/index.js:3270` | server-only |
| 37 | POST | `/api/config/tour-status` | authenticated | `functions/index.js:3287` | server-only |
| 38 | POST | `/api/config/validate-keys` | optional | `functions/index.js:493` | inline |
| 39 | GET | `/api/device/battery/forceChargeTime/get` | public | `functions/index.js:6207` | inline |
| 40 | POST | `/api/device/battery/forceChargeTime/set` | public | `functions/index.js:6221` | inline |
| 41 | GET | `/api/device/battery/soc/get` | public | `functions/index.js:5978` | inline |
| 42 | POST | `/api/device/battery/soc/set` | public | `functions/index.js:5992` | inline |
| 43 | POST | `/api/device/getMeterReader` | public | `functions/index.js:6235` | server-only |
| 44 | POST | `/api/device/setting/get` | authenticated | `functions/index.js:6030` | inline |
| 45 | POST | `/api/device/setting/set` | authenticated | `functions/index.js:6103` | inline |
| 46 | GET | `/api/device/status/check` | authenticated | `functions/index.js:6143` | server-only |
| 47 | GET | `/api/device/workmode/get` | public | `functions/index.js:6525` | inline |
| 48 | POST | `/api/device/workmode/set` | public | `functions/index.js:6540` | inline |
| 49 | GET | `/api/ems/list` | public | `functions/index.js:6471` | server-only |
| 50 | GET | `/api/health` | optional | `functions/index.js:437` | APIClient |
| 51 | GET | `/api/health/auth` | public | `functions/index.js:2298` | server-only |
| 52 | POST | `/api/inverter/all-data` | authenticated | `functions/index.js:6382` | inline |
| 53 | GET | `/api/inverter/discover-variables` | authenticated | `functions/index.js:6354` | inline |
| 54 | GET | `/api/inverter/generation` | authenticated | `functions/index.js:6301` | inline |
| 55 | GET | `/api/inverter/history` | authenticated | `functions/index.js:7961` | inline |
| 56 | GET | `/api/inverter/list` | public | `functions/index.js:5931` | APIClient |
| 57 | GET | `/api/inverter/real-time` | public | `functions/index.js:5941` | APIClient |
| 58 | GET | `/api/inverter/report` | authenticated | `functions/index.js:6265` | inline |
| 59 | GET | `/api/inverter/settings` | public | `functions/index.js:5963` | inline |
| 60 | GET | `/api/inverter/temps` | public | `functions/index.js:6250` | APIClient |
| 61 | GET | `/api/meter/list` | public | `functions/index.js:6513` | server-only |
| 62 | GET | `/api/metrics/api-calls` | optional | `functions/index.js:1028` | inline |
| 63 | GET | `/api/module/list` | public | `functions/index.js:6483` | server-only |
| 64 | GET | `/api/module/signal` | public | `functions/index.js:6495` | server-only |
| 65 | POST | `/api/quickcontrol/end` | authenticated | `functions/index.js:5072` | inline |
| 66 | POST | `/api/quickcontrol/start` | authenticated | `functions/index.js:4851` | inline |
| 67 | GET | `/api/quickcontrol/status` | authenticated | `functions/index.js:5200` | inline |
| 68 | POST | `/api/scheduler/v1/clear-all` | authenticated | `functions/index.js:6794` | APIClient |
| 69 | GET | `/api/scheduler/v1/get` | optional | `functions/index.js:6593` | APIClient |
| 70 | POST | `/api/scheduler/v1/set` | public | `functions/index.js:6631` | APIClient |
| 71 | POST | `/api/user/delete-account` | authenticated | `functions/index.js:3484` | server-only |
| 72 | POST | `/api/user/init-profile` | authenticated | `functions/index.js:3427` | server-only |
| 73 | GET | `/api/weather` | optional | `functions/index.js:6577` | APIClient |

## Inline HTML Endpoints Missing from APIClient

| Path | Backend Method(s) | Auth Requirement(s) | Example Source(s) |
|---|---|---|---|
| `/api/admin/check` | GET | authenticated | `frontend/admin.html:769` |
| `/api/admin/firestore-metrics` | GET | admin | `frontend/admin.html:1142` |
| `/api/admin/impersonate` | POST | admin | `frontend/admin.html:1284` |
| `/api/admin/platform-stats` | GET | admin | `frontend/admin.html:820` |
| `/api/admin/users` | GET | admin | `frontend/admin.html:796` |
| `/api/admin/users/:param/delete` | POST | admin | `frontend/admin.html:1018` |
| `/api/admin/users/:param/role` | POST | admin | `frontend/admin.html:1254` |
| `/api/admin/users/:param/stats` | GET | admin | `frontend/admin.html:1337` |
| `/api/amber/prices/current` | GET | optional | `frontend/index.html:4547, frontend/test.html:1449` |
| `/api/auth/init-user` | POST | public | `frontend/login.html:740` |
| `/api/automation/audit` | GET | public | `frontend/roi.html:1635` |
| `/api/automation/cycle` | POST | public | `frontend/index.html:7792, frontend/index.html:9157 (+2 more)` |
| `/api/automation/enable` | POST | public | `frontend/index.html:9186` |
| `/api/automation/reset` | POST | public | `frontend/index.html:9336` |
| `/api/automation/rule/update` | POST | public | `frontend/index.html:8974, frontend/index.html:9239 (+2 more)` |
| `/api/automation/trigger` | POST | public | `frontend/index.html:9307` |
| `/api/config/clear-credentials` | POST | authenticated | `frontend/settings.html:2319` |
| `/api/config/setup-status` | GET | optional | `frontend/login.html:592, frontend/setup.html:780 (+1 more)` |
| `/api/config/system-topology` | GET, POST | public | `frontend/history.html:1029, frontend/history.html:988` |
| `/api/config/validate-keys` | POST | optional | `frontend/settings.html:2289, frontend/setup.html:892` |
| `/api/device/battery/forceChargeTime/get` | GET | public | `frontend/control.html:819` |
| `/api/device/battery/forceChargeTime/set` | POST | public | `frontend/control.html:798` |
| `/api/device/battery/soc/get` | GET | public | `frontend/control.html:651` |
| `/api/device/battery/soc/set` | POST | public | `frontend/control.html:606` |
| `/api/device/setting/get` | POST | authenticated | `frontend/control.html:671, frontend/curtailment-discovery.html:727 (+1 more)` |
| `/api/device/setting/set` | POST | authenticated | `frontend/control.html:620, frontend/curtailment-discovery.html:1002 (+2 more)` |
| `/api/device/workmode/get` | GET | public | `frontend/control.html:738, frontend/index.html:2938` |
| `/api/device/workmode/set` | POST | public | `frontend/control.html:716, frontend/index.html:3006` |
| `/api/inverter/all-data` | POST | authenticated | `frontend/control.html:922` |
| `/api/inverter/discover-variables` | GET | authenticated | `frontend/control.html:884` |
| `/api/inverter/generation` | GET | authenticated | `frontend/history.html:1773` |
| `/api/inverter/history` | GET | authenticated | `frontend/history.html:1122, frontend/history.html:1203` |
| `/api/inverter/report` | GET | authenticated | `frontend/history.html:1515` |
| `/api/inverter/settings` | GET | public | `frontend/index.html:2927, frontend/index.html:3048 (+1 more)` |
| `/api/metrics/api-calls` | GET | optional | `frontend/control.html:855, frontend/history.html:1959 (+1 more)` |
| `/api/quickcontrol/end` | POST | authenticated | `frontend/index.html:5601, frontend/index.html:5638` |
| `/api/quickcontrol/start` | POST | authenticated | `frontend/index.html:5540` |
| `/api/quickcontrol/status` | GET | authenticated | `frontend/index.html:5318` |

## APIClient vs Backend Mismatch Check

No APIClient route mismatches detected.

## Notes

- Consumer classification priority: `APIClient` -> `inline` -> `server-only`.
- `Auth Requirement = optional` means no auth middleware on route declaration, but `tryAttachUser(req)` is used in the handler.
- This file is generated and should be refreshed whenever API routes or frontend endpoint calls change.

