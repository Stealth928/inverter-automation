# P1 Architecture and Contract Specification (March 2026)

Status: Final - approved for implementation and G1 closeout  
Last Updated: 2026-03-06  
Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Phase P1)  
Approval Record: 2026-03-06 (Approver: Stealth928)  
Related ADRs:
- `docs/adr/ADR-001-target-architecture-boundaries.md`
- `docs/adr/ADR-002-v2-data-model-and-migration-strategy.md`

---

## 1. Purpose

Define stable contracts before backend extraction starts in P2.  
This document is the implementation contract for:

1. Bounded context responsibilities and allowed dependencies.
2. Provider/device/EV adapter interfaces.
3. Billing/paywall adapter and entitlement contracts (weekly/monthly cadence).
4. Cross-layer response and error taxonomy.
5. Legacy-to-v2 data mapping rules for migration compatibility.
6. OpenAPI source-of-truth workflow.

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
| Billing/Entitlements (`lib/billing-*`, `lib/adapters/payment-*`) | Plan catalog, subscription lifecycle, entitlement checks, webhook event normalization | Payment adapters, repositories, shared utils | Device/provider adapters, route modules |
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

## 5A. Billing and Entitlement Contract (Recurring)

Supported billing cadence options:
- `WEEKLY`
- `MONTHLY`

Payment providers must implement:

```js
/**
 * @typedef {Object} CheckoutSession
 * @property {string} sessionId
 * @property {string} checkoutUrl
 * @property {string} providerCustomerId
 */

/**
 * @typedef {'active'|'grace_period'|'past_due'|'canceled'|'incomplete'} SubscriptionState
 */

class PaymentAdapter {
  async createCheckoutSession(context, planCode, cadence) {}
  async getSubscription(context, subscriptionId) {}
  async cancelSubscription(context, subscriptionId, options) {}
  async parseWebhookEvent(rawRequest) {}
  normalizeProviderError(error) {}
}
```

Entitlement lifecycle requirements:
1. Entitlements are derived from normalized subscription state, not directly from raw provider payloads.
2. Webhook processing must be idempotent (event ID dedupe + replay-safe transitions).
3. Feature access checks must use a centralized entitlement resolver (single policy path).

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
| `3600-3699` | Billing/Payment | subscription past-due, payment method required, webhook verification failure |
| `5000-5099` | Internal/Unknown | unexpected exception, unclassified failures |

Normalization rule:
- Existing provider-native errors (`errno`, HTTP status, message) are mapped into these ranges at adapter boundary.

---

## 7. Legacy-to-v2 Migration Mapping (Implementation-Ready)

### 7.1 Target v2 Collection Layout

All v2 entities remain user-scoped:
- `users/{uid}/providerAccounts/{providerAccountId}`
- `users/{uid}/sites/{siteId}`
- `users/{uid}/assets/{assetId}`
- `users/{uid}/connections/{connectionId}`
- `users/{uid}/automationPolicies/{policyId}`
- `users/{uid}/billingCustomers/{billingCustomerId}`
- `users/{uid}/subscriptions/{subscriptionId}`
- `users/{uid}/entitlements/{entitlementId}`
- `users/{uid}/billingEvents/{eventId}`

### 7.2 Deterministic ID Rules

| Entity | ID Rule | Example |
|---|---|---|
| `providerAccountId` (Amber) | `amber-main` (single-account legacy source) | `amber-main` |
| `providerAccountId` (FoxESS) | `foxess-main` (single-account legacy source) | `foxess-main` |
| `siteId` | `site-primary` by default; if `amberSiteId` exists, `amber-{amberSiteId}` | `amber-01f2abcd` |
| `assetId` | `asset-primary` by default; if `deviceSn` exists, `foxess-{deviceSn}` | `foxess-1234567890` |
| `connectionId` | `{providerAccountId}__{assetId}` | `amber-main__foxess-1234567890` |
| `policyId` | `default` for migrated single-policy users | `default` |

### 7.3 Field-level Mapping Matrix

| Legacy Source Path(s) | v2 Target Path | Transform Rule | Compatibility Notes |
|---|---|---|---|
| `users/{uid}/config/main.deviceSn`, fallback `users/{uid}.deviceSn`, fallback `users/{uid}.credentials.device_sn` | `users/{uid}/assets/{assetId}.serialNumber` | Copy as string; trim whitespace. | If empty, do not create `serialNumber` field. |
| `users/{uid}/config/main.foxessToken`, fallback `users/{uid}.foxessToken`, fallback `users/{uid}.credentials.foxess_token` | `users/{uid}/assets/{assetId}.credentials.token` | Copy as string; preserve exact token bytes. | Redact in logs; never emit token in API responses. |
| `users/{uid}/config/main.foxessBaseUrl` | `users/{uid}/assets/{assetId}.providerConfig.baseUrl` | Copy URL string if present. | Optional override for non-default FoxESS regions. |
| `users/{uid}/config/main.amberApiKey`, fallback `users/{uid}.amberApiKey`, fallback `users/{uid}.credentials.amber_api_key` | `users/{uid}/providerAccounts/{providerAccountId}.credentials.apiKey` | Copy as string. | Store `provider = 'amber'` on provider account doc. |
| `users/{uid}/config/main.amberSiteId` | `users/{uid}/sites/{siteId}.externalId` | Copy as string. | Also set `provider = 'amber'` on site doc. |
| `users/{uid}/config/main.location`, fallback `preferences.weatherPlace`, fallback `weatherPlace` | `users/{uid}/sites/{siteId}.displayName` | Choose first non-empty source in priority order. | Preserve original location text; no geocoding in migration step. |
| `users/{uid}/config/main.timezone` | `users/{uid}/sites/{siteId}.timezone` | Validate as IANA timezone; if invalid, omit and fall back at read time. | Keep legacy timezone until v2 read rollout reaches 100%. |
| `users/{uid}/config/main.batteryCapacityKWh` | `users/{uid}/assets/{assetId}.battery.capacityKWh` | Parse numeric; drop if NaN or <= 0. | Use numeric type only. |
| `users/{uid}/config/main.inverterCapacityW` | `users/{uid}/assets/{assetId}.inverter.ratedPowerW` | Parse numeric; round to integer watts. | Clamp validation remains in service layer, not migration layer. |
| `users/{uid}/config/main.systemTopology.*` | `users/{uid}/assets/{assetId}.topology.*` | Copy object as-is (`coupling`, `source`, `confidence`, `evidence`, timestamps). | Keep unknown keys to avoid information loss. |
| `users/{uid}/config/main.automation.intervalMs` | `users/{uid}/automationPolicies/default.evaluation.intervalMs` | Parse numeric; default `60000` if invalid/missing. | Matches existing runtime default behavior. |
| `users/{uid}/config/main.blackoutWindows[]` | `users/{uid}/automationPolicies/default.blackoutWindows[]` | Copy array values; preserve `enabled === false` semantics. | No schema rewrite in P1; strict normalization deferred to P3. |
| `users/{uid}/config/main.curtailment.enabled` | `users/{uid}/automationPolicies/default.features.curtailment.enabled` | Coerce to boolean. | Must preserve false explicitly (not omitted). |
| `users/{uid}/config/main.curtailment.priceThreshold` | `users/{uid}/automationPolicies/default.features.curtailment.priceThreshold` | Parse numeric; keep null when missing. | Unit remains cents/kWh in both shapes. |
| `users/{uid}/config/main.createdAt`, `updatedAt` | `*.meta.createdAt`, `*.meta.updatedAt` on new docs | Reuse timestamp if present; otherwise set server timestamp on migration write. | Applied to created v2 docs only. |
| `users/{uid}/config/main.setupComplete` | `users/{uid}/connections/{connectionId}.ready` | Preserve boolean when present; otherwise derive from credentials presence. | Derivation: `deviceSn && foxessToken` from legacy semantics. |
| _No legacy billing field exists_ | `users/{uid}/subscriptions/{subscriptionId}` and `users/{uid}/entitlements/{entitlementId}` | Initialize as absent; default entitlement policy applies until checkout/activation. | Billing/paywall is greenfield in this codebase. |

### 7.4 Dual-read and Dual-write Rules

Read order (mandatory during migration window):
1. Read v2 entities (`assets`, `providerAccounts`, `sites`, `connections`, `automationPolicies`).
2. If missing/incomplete, read legacy `users/{uid}/config/main`.
3. If still missing, read legacy fallbacks on `users/{uid}` (`credentials.*`, top-level keys).

Write policy during rollout:
1. Legacy `config/main` remains source-compatible until G2 closes.
2. New v2 writes must be additive and idempotent (safe to rerun per user).
3. Do not delete legacy fields in the migration writer; removals are a separate decommission phase.
4. Billing entities are created only via billing flows (checkout/webhook/admin override), not via config migration.

Fields intentionally out of v2 scope for this phase (remain in `config/main`):
- `tourComplete`, `tourCompletedAt`, `tourDismissedAt`
- transient request-only field `browserTimezone`

---

## 8. OpenAPI Source-of-Truth Workflow

Source file:
- `docs/openapi/openapi.v1.yaml`
- Baseline coverage at P1 kickoff (2026-03-04): **3 of 73** backend routes documented; expand incrementally each PR.

Rules:
1. Route changes and OpenAPI changes ship in same PR.
2. New endpoints are not considered complete until spec + examples are included.
3. Deprecated endpoints are tagged with deprecation date and replacement path.

Validation workflow:
1. Keep `scripts/api-contract-baseline.js` as current drift guard between runtime and frontend usage.
2. Run `scripts/openapi-contract-check.js` in pre-deploy and CI for:
   - YAML syntax/structure validation
   - OpenAPI path+method parity against backend route declarations
   - duplicate `operationId` detection
3. In P2, route modules become primary source for generated contract checks.

---

## 9. P1 Exit-Criteria Mapping (G1)

| G1 Requirement | Artifact in Repo |
|---|---|
| Approved architecture spec with bounded contexts | This document + ADR-001 |
| Provider/device/EV/billing interface contracts | Sections 3, 4, 5, 5A of this document |
| v2 schema design + migration mapping | Section 7 of this document + ADR-002 |
| Device variable normalization spec | Section 4.1 of this document |
| Migration compatibility strategy | ADR-002 + checklists in `docs/checklists/` |
| Weekly/monthly billing contract + entitlement lifecycle | Section 5A + Section 7 billing entities |

---

## 10. Implementation Artifacts (2026-03-05)

Executable contract scaffolding added to backend codebase:

- Payment adapter contract and normalization helpers:
  - `functions/lib/adapters/payment-adapter.js`
- Entitlement derivation and feature-access resolver:
  - `functions/lib/billing/entitlements.js`
- Webhook idempotency utilities:
  - `functions/lib/billing/webhook-idempotency.js`
- Device telemetry normalization helper (canonical alias resolution for rule evaluation):
  - `functions/lib/device-telemetry.js`

Contract-level tests:

- `functions/test/payment-adapter-contract.test.js`
- `functions/test/billing-entitlements.test.js`
- `functions/test/billing-webhook-idempotency.test.js`
- `functions/test/device-telemetry.test.js`
