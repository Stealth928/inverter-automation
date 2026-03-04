# P1 Architecture and Contract Specification (March 2026)

Status: Draft for implementation review  
Last Updated: 2026-03-04  
Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Phase P1)  
Related ADRs:
- `docs/adr/ADR-001-target-architecture-boundaries.md`
- `docs/adr/ADR-002-v2-data-model-and-migration-strategy.md`

---

## 1. Purpose

Define stable contracts before backend extraction starts in P2.  
This document is the implementation contract for:

1. Bounded context responsibilities and allowed dependencies.
2. Provider/device/EV adapter interfaces.
3. Cross-layer response and error taxonomy.
4. OpenAPI source-of-truth workflow.

---

## 2. Bounded Contexts

| Context | Responsibility | Allowed Dependencies | Must Not Depend On |
|---|---|---|---|
| API Transport (`api/routes/*`) | HTTP parsing, auth middleware, input validation, response envelope | Services | Repositories, vendor API modules |
| Automation Domain (`lib/automation-*`) | Rule evaluation, action planning, cycle decisions | Repositories, adapters, shared utils | Route-layer modules |
| Orchestration (`lib/orchestration/*`) | Scheduler lifecycle, locking, idempotency controls | Services, repositories, shared utils | Express internals (`app._router.stack`) |
| Provider Adapters (`lib/adapters/tariff-*`) | Tariff retrieval/normalization and provider-specific retry handling | Provider API modules, shared utils | Repositories, route modules |
| Device Adapters (`lib/adapters/device-*`) | Device telemetry normalization and command translation | Device API modules, shared utils | Repositories, route modules |
| EV Adapters (`lib/adapters/ev-*`) | Vehicle/charger telemetry and charge command lifecycle | EV provider SDK/HTTP clients, shared utils | Repositories, route modules |
| Repositories (`lib/repositories/*`) | Firestore read/write patterns, transactions, schema mapping | Firestore SDK, shared utils | Routes, adapters |
| Shared Infrastructure (`lib/logger.js`, `lib/time-utils.js`, `lib/cache-manager.js`) | Cross-cutting utilities | None (leaf-only helpers) | Business/domain-specific modules |

### 2.1 Dependency Flow

```
Routes -> Services -> (Repositories + Adapters) -> External APIs / Firestore
       -> Shared Utils can be used by all layers
```

---

## 3. Tariff Provider Adapter Contract

All tariff providers must implement:

```js
/**
 * @typedef {Object} TariffInterval
 * @property {string} startIso
 * @property {string} endIso
 * @property {number} buyCentsPerKwh
 * @property {number} feedInCentsPerKwh
 * @property {number|null} renewablePct
 * @property {'actual'|'forecast'} source
 */

/**
 * @typedef {Object} TariffSnapshot
 * @property {number} buyCentsPerKwh
 * @property {number} feedInCentsPerKwh
 * @property {string} asOfIso
 * @property {TariffInterval[]} intervals
 */

class TariffProviderAdapter {
  async getCurrentPrices(context) {}
  async getHistoricalPrices(context, startIso, endIso, resolutionMinutes) {}
  normalizeProviderError(error) {}
}
```

Context minimum fields:
- `userId`
- `providerAccountId`
- `siteId`
- `timezone`

---

## 4. Device Adapter Contract

All device providers must implement:

```js
/**
 * @typedef {Object} DeviceStatus
 * @property {number|null} socPct
 * @property {number|null} batteryTempC
 * @property {number|null} ambientTempC
 * @property {number|null} pvPowerW
 * @property {number|null} loadPowerW
 * @property {number|null} gridPowerW
 * @property {number|null} feedInPowerW
 * @property {string} observedAtIso
 */

/**
 * @typedef {Object} DeviceCapabilities
 * @property {boolean} scheduler
 * @property {boolean} workMode
 * @property {boolean} minSoc
 * @property {boolean} forceChargeWindow
 */

class DeviceAdapter {
  async getStatus(context) {}
  async getCapabilities(context) {}
  async getSchedule(context) {}
  async setSchedule(context, groups) {}
  async clearSchedule(context) {}
  async getWorkMode(context) {}
  async setWorkMode(context, mode) {}
  normalizeProviderError(error) {}
}
```

### 4.1 Canonical Variable Mapping (Initial)

| Canonical Field | Known Provider Keys |
|---|---|
| `socPct` | `SoC`, `SoC1`, `SoC_1` |
| `batteryTempC` | `batTemperature`, `batTemperature_1` |
| `pvPowerW` | `pvPower`, `pv_power` |
| `loadPowerW` | `loadsPower`, `loadPower`, `load_power` |
| `gridPowerW` | `gridConsumptionPower`, `gridPower` |
| `feedInPowerW` | `feedinPower`, `feedInPower` |

This map is owned by the adapter layer and must not be duplicated in route handlers.

---

## 5. EV Adapter Contract (Greenfield)

```js
class EvAdapter {
  async getVehicleStatus(context) {}
  async startCharging(context, options) {}
  async stopCharging(context) {}
  async setChargeLimit(context, targetPct) {}
  normalizeProviderError(error) {}
}
```

Command lifecycle requirements:
1. Return command id for async providers.
2. Poll command completion status when provider uses eventual consistency.
3. Surface provider throttling/authorization errors through normalized taxonomy.

---

## 6. Response Envelope and Error Taxonomy

### 6.1 Standard API Envelope

Success:

```json
{ "errno": 0, "result": {}, "error": null, "meta": { "requestId": "..." } }
```

Failure:

```json
{ "errno": 3201, "result": null, "error": "Provider rate limited", "meta": { "retryAfterSec": 30 } }
```

### 6.2 Error Code Ranges

| Range | Class | Examples |
|---|---|---|
| `1000-1099` | Validation/Input | missing fields, invalid enum, malformed dates |
| `2000-2099` | AuthN/AuthZ | missing token, invalid claim, admin required |
| `3000-3099` | Repository/Data | not found, transaction conflict, schema mismatch |
| `3200-3299` | Provider/External | rate-limited, upstream timeout, provider auth failure |
| `3400-3499` | Device Command | unsupported capability, command rejected |
| `5000-5099` | Internal/Unknown | unexpected exception, unclassified failures |

Normalization rule:
- Existing provider-native errors (`errno`, HTTP status, message) are mapped into these ranges at adapter boundary.

---

## 7. OpenAPI Source-of-Truth Workflow

Source file:
- `docs/openapi/openapi.v1.yaml`
- Baseline coverage at P1 kickoff (2026-03-04): **3 of 73** backend routes documented; expand incrementally each PR.

Rules:
1. Route changes and OpenAPI changes ship in same PR.
2. New endpoints are not considered complete until spec + examples are included.
3. Deprecated endpoints are tagged with deprecation date and replacement path.

Validation workflow:
1. Keep `scripts/api-contract-baseline.js` as current drift guard between runtime and frontend usage.
2. Add OpenAPI validation in CI in P1 (syntax + path/method parity checks).
3. In P2, route modules become primary source for generated contract checks.

---

## 8. P1 Exit-Criteria Mapping (G1)

| G1 Requirement | Artifact in Repo |
|---|---|
| Approved architecture spec with bounded contexts | This document + ADR-001 |
| Provider/device/EV interface contracts | Sections 3, 4, 5 of this document |
| v2 schema design + migration mapping | ADR-002 |
| Device variable normalization spec | Section 4.1 of this document |
| Migration compatibility strategy | ADR-002 + checklists in `docs/checklists/` |
