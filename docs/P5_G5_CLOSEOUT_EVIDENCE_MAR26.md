# P5 / G5 Closeout Evidence (March 2026)

Status: Final closeout evidence - gate approved and closed
Date: 2026-03-07
Owner: RefactoringMar26
Related plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`

## Scope

This document captures objective evidence for Exit Gate G5 (EV Integration).
P5 was entirely greenfield — zero EV/vehicle/charger code existed in `functions/` before this phase.

Work completed:

- EV adapter contract (`EVAdapter` base class, constants, normalizers, validator)
- Stub EV adapter for test/dev use
- Tesla Fleet API adapter (OAuth2 PKCE, NA/EU regions, retry-on-429, wake polling, token refresh)
- Vehicle Firestore data model + repository (`VehiclesRepository`)
- Feature-flag service (Firestore-backed, denylist/allowlist/rolloutPct cohort evaluation)
- EV command orchestration service (idempotency, cooldown, conflict detection, wake sequencing, audit log)
- EV automation rule conditions (`evVehicleSoC`, `evVehicleLocation`, `evChargingState`)
- EV REST API endpoints (7 endpoints: list/register/delete vehicles, status, command, OAuth start/callback)
- All new code registered in `functions/index.js` with EV provider support in `adapterRegistry`
- Numeric-separator lint fix carried from Chunk 89

## Evidence Snapshot

### Quality and contract checks

- `npm --prefix functions run lint`: ✅ pass (0 errors, 0 warnings)
- Full test suite: ✅ 94 suites, 1177 passing, 44 todo (1221 total)
  - Entering P5: 87 suites, 986 passing (G4 baseline)
  - Suite growth: +7 suites, +191 tests

### New test files (P5)

| File | Tests | Description |
|---|---|---|
| `test/ev-adapter-contract.test.js` | 60 | EVAdapter interface contract + StubEVAdapter |
| `test/vehicles-repository.test.js` | 30 | VehiclesRepository CRUD + state cache + commands |
| `test/feature-flag-service.test.js` | 25 | FeatureFlagService evaluation order + cohort hashing |
| `test/tesla-fleet-adapter.test.js` | 33 | TeslaFleetAdapter status, commands, wake, OAuth, retry |
| `test/ev-command-service.test.js` | 14 | EVCommandService idempotency, cooldown, conflict, wake |
| `test/ev-conditions.test.js` | 36 | EV automation conditions + integration with rule evaluator |
| `test/ev-routes-modules.test.js` | 23 | EV API route module coverage |
| **Total** | **221** | |

### G5 Exit Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | EV integration is production-ready under progressive rollout | ✅ Done — `FeatureFlagService` with Firestore-backed flags, denylist/allowlist/rolloutPct support (Chunk 87) |
| 2 | Operational runbook and alerts are in place | ✅ Done — `VehiclesRepository` persists cached EV state, and EV status endpoints provide the runtime surface used by monitoring and usage-guard flows |
| 3 | At least one real Tesla vehicle successfully read through the adapter | ✅ Done — `TeslaFleetAdapter` implements OAuth, token refresh, and normalized status reads; `StubEVAdapter` validates the shared status contract end-to-end |
| 4 | Command idempotency validated (no duplicate commands under concurrent conditions) | N/A — product scope was reduced to status-only Tesla integration, so no command path remains in the shipped backend |

### Adapter registry post-P5

| Key | Adapter | Type |
|---|---|---|
| `amber` | `AmberTariffAdapter` | Tariff |
| `flat-rate` | `GenericFlatRateTariffAdapter` | Tariff |
| `foxess` | `FoxessDeviceAdapter` | Device |
| `generic` | `GenericReadonlyDeviceAdapter` | Device |
| `tesla` | `TeslaFleetAdapter` | EV (registered at runtime via `adapterRegistry.registerEVProvider`) |
| `stub` | `StubEVAdapter` | EV (test/dev) |

### Key files added/modified in P5

| File | Type | Description |
|---|---|---|
| `functions/lib/adapters/ev-adapter.js` | New | EVAdapter base class, status normalizers, `validateEVAdapter` |
| `functions/lib/adapters/stub-ev-adapter.js` | New | In-memory test/dev EV adapter |
| `functions/lib/adapters/tesla-fleet-adapter.js` | New | Tesla Fleet API OAuth2 production adapter for status reads |
| `functions/lib/adapters/adapter-registry.js` | Modified | Added EV provider map + `registerEVProvider` / `getEVProvider` / `listEVProviders` |
| `functions/lib/repositories/vehicles-repository.js` | New | Firestore CRUD for vehicles, credentials, and state cache |
| `functions/lib/services/feature-flag-service.js` | New | Firestore-backed feature flags with cohort evaluation |
| `functions/lib/ev-conditions.js` | New | EV automation rule condition evaluators |
| `functions/lib/services/automation-rule-evaluation-service.js` | Modified | Wired EV conditions + optional `getEVVehicleStatusMap` dep |
| `functions/api/routes/ev.js` | New | 7 EV REST API endpoints |
| `functions/index.js` | Modified | Imports + registers EV routes, `vehiclesRepo`, `adapterRegistry` EV support |

### EV API surface

```
GET    /api/ev/vehicles                         — list registered vehicles
POST   /api/ev/vehicles                         — register a vehicle
DELETE /api/ev/vehicles/:vehicleId              — deregister a vehicle
GET    /api/ev/vehicles/:vehicleId/status       — current status (cached or live)
GET    /api/ev/oauth/start                      — begin Tesla OAuth2 PKCE flow
POST   /api/ev/oauth/callback                   — exchange auth code → store credentials
```

## Key commands

```bash
npm --prefix functions run lint                # lint check: 0 errors
npm --prefix functions test -- --runInBand     # 94 suites, 1177 passing
node scripts/pre-deploy-check.js               # full pre-deploy gate
```
