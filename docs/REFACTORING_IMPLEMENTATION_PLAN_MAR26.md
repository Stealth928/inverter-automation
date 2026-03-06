# Refactoring Implementation Plan (March 2026)

Status: Active execution - Sprint 1 complete, P1 closeout pending, P2 Wave 3 step 2 complete with closeout evidence drafted, scheduler service-runner decoupling complete, and index.js reduction continuing (G2 blockers narrowing; admin + health route extraction landed, admin access + billing/monitoring + weather/cache helpers extracted, API metrics service extraction landed)
Scope: Planning + execution progress tracking  
Last Updated: 2026-03-06  
Primary Branch: `RefactoringMar26`

## Progress Tracker

| Workstream | Sprint 1 Items | Status | Completion |
|---|---|---|---:|
| CI and Quality Gates | 1-5 | ✅ Done | 5/5 |
| API Contract Baseline | 6-8 | ✅ Done | 3/3 |
| Dead Code and Cleanup | 9-11 | ✅ Done | 3/3 |
| Documentation and Security | 12-15 | ✅ Done | 4/4 |
| Governance | 16-19 | ✅ Done | 4/4 |
| Parallel Frontend Prep | 20-21 | ✅ Done | 2/2 |
| **Sprint 1 Total** | **1-21** | **✅ Done** | **21/21 (100%)** |

| Phase | Gate | Status | Progress | Next Focus |
|---|---|---|---|---|
| P0 | G0 | ✅ Complete | 100% | - |
| P1 | G1 | ⏳ In Progress | 10/10 tasks implemented; formal gate close pending | Capture closeout evidence + sign-off |
| P2 | G2 | In Progress | Wave 1 complete (3/3), Wave 2 complete, Wave 3 step 1 complete, Wave 3 step 2 complete; closeout evidence refreshed with verified metrics, admin + health route domains extracted, admin access + billing/monitoring + weather/cache + API metrics helper domains extracted, `index.js` at 2,327 lines (74.2% reduction), and inline routes reduced to 0 | Continue G2 blocker closure: complete remaining helper/service decomposition + test-harness normalization toward <1,500 line target |

Tracker hygiene rule: update this section at the end of every completed execution chunk.

---

## 0. Execution Progress

**Sprint 1 Status Snapshot**
- ✅ Completed: backlog items **1-21**
- ⏳ Pending: none (Sprint 1 complete)

**Execution Authorization Record**
- Status: ✅ named execution approver record captured in-repo for ongoing P1 execution.
- Execution start recorded: **2026-03-04** (Chunk 1).
- Governance note: P0 start sign-off record remains historical-gap, but P1 continuation approval is now explicitly logged in Section **14A**.

### ✅ 2026-03-04 - Chunk 1 (CI and quality-gate hardening)

- Completed Sprint 1 backlog items **1, 2, 3, 4**.
- Validation passed:
  - `node scripts/pre-deploy-check.js`
  - `npm --prefix functions run lint`
  - `npm --prefix functions run test:coverage -- --runInBand --passWithNoTests --silent --coverageReporters=text-summary`
- Coverage after scope expansion (`index.js` + `api/**/*.js` + `lib/**/*.js`):
  - Statements: **23.14%**
  - Branches: **19.02%**
  - Functions: **28.73%**
  - Lines: **24.02%**
- Additional cleanup done while completing item 4: removed dead `test:e2e:auth` script (also referenced missing `e2e-tests.js`).
- Next target chunk: Sprint 1 item **5** (wire Playwright E2E into CI).

### ✅ 2026-03-04 - Chunk 2 (Playwright E2E CI integration)

- Completed Sprint 1 backlog item **5**.
- Added `frontend-e2e` hard-gate job to `.github/workflows/qa-checks.yml`:
  - installs root deps (`npm ci`)
  - installs Playwright Chromium (`npx playwright install --with-deps chromium`)
  - runs frontend E2E (`npx playwright test --reporter=line --workers=1`, `CI=true`)
  - uploads Playwright artifacts (`playwright-report`, `test-results`) on every run
- Updated deployment gate dependencies to include `frontend-e2e`.
- Added root script: `npm run test:e2e:frontend`.
- Stabilized brittle E2E assertions so they are CI-safe:
  - `tests/frontend/control.spec.js`
  - `tests/frontend/history.spec.js`
  - `tests/frontend/dashboard.spec.js`
- Validation passed:
  - `npm run test:e2e:frontend -- --list`
  - `$env:CI='true'; npx playwright test --reporter=line --workers=1`
  - `$env:CI='true'; npx playwright test tests/frontend/control.spec.js tests/frontend/history.spec.js --reporter=list`
  - `$env:CI='true'; npx playwright test tests/frontend/dashboard.spec.js --reporter=list`

### ✅ 2026-03-04 - Chunk 3 (API contract baseline and drift guardrails)

- Completed Sprint 1 backlog items **6, 7, 8**.
- Added automated contract script: `scripts/api-contract-baseline.js`:
  - parses backend routes from `functions/index.js` (method, path, auth requirement, handler location)
  - parses APIClient endpoint methods from `frontend/js/api-client.js`
  - parses inline HTML endpoint usage across `frontend/*.html`
  - fails non-zero if APIClient route definitions drift from backend routes
- Generated authoritative baseline report: `docs/API_CONTRACT_BASELINE_MAR26.md` with current measured state:
  - backend routes discovered: **73**
  - APIClient endpoint-method entries: **19**
  - inline HTML endpoint paths discovered: **51**
  - inline HTML endpoint paths missing from APIClient: **38** (with source locations)
- Wired mismatch checks into hard pre-deploy gate:
  - `scripts/pre-deploy-check.js` now executes `node scripts/api-contract-baseline.js --silent` and fails on contract mismatch.
- Added root scripts for repeatability:
  - `npm run api:contract:check`
  - `npm run api:contract:refresh`
- Contract cleanup performed to satisfy hard check:
  - `frontend/js/api-client.js`: `/api/automation/rule/test` -> `/api/automation/test`
  - `frontend/js/api-client.js`: `/api/inverter/detail` -> `/api/inverter/real-time`
- Validation passed:
  - `node scripts/api-contract-baseline.js`
  - `node scripts/api-contract-baseline.js --write-doc`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: Sprint 1 items **9, 10, 11** (dead code and cleanup).

### ✅ 2026-03-04 - Chunk 4 (Dead code and cleanup)

- Completed Sprint 1 backlog items **9, 10, 11**.
- Item 9 completed:
  - removed `frontend/js/pwa-init.js`
  - removed last page include from `frontend/reset-password.html`
- Item 10 completed:
  - removed dead no-op block in `frontend/js/shared-utils.js` `loadApiMetrics()`
- Item 11 completed:
  - replaced placeholder assertion-only `functions/test/auth-flows.test.js` with explicit `test.todo()` coverage plan entries
- Validation passed:
  - `rg -n "pwa-init\\.js" frontend -g "*.html" -g "*.js"` (no runtime references)
  - `npm --prefix functions test -- auth-flows.test.js --runInBand`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: Sprint 1 items **12, 13, 14, 15** (documentation and security).

### ✅ 2026-03-04 - Chunk 5 (Documentation and security hardening)

- Completed Sprint 1 backlog items **12, 13, 14, 15**.
- Item 12 completed:
  - refreshed `docs/SETUP.md` Firestore schema to document the complete current data model, including all cache, metrics, quick-control, curtailment, and admin audit paths.
- Item 13 completed:
  - added explicit Firestore rules for:
    - `users/{uid}/cache/{cacheId}`
    - `users/{uid}/metrics/{metricId}`
    - `users/{uid}/quickControl/{docId}`
    - `users/{uid}/curtailment/{docId}`
    - `admin_audit/{auditId}`
- Item 14 completed:
  - synchronized admin role updates in `POST /api/admin/users/:uid/role` by updating both Firestore role and Firebase Auth custom claims via `setCustomUserClaims()`.
  - added best-effort custom-claim rollback if Firestore write fails after claim update.
- Item 15 completed:
  - replaced manual subcollection deletion in `POST /api/auth/cleanup-user` with shared recursive `deleteUserDataTree(userId)` so all nested collections are removed consistently.
- Validation passed:
  - `npm --prefix functions test -- admin.test.js cleanup-user.test.js --runInBand`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: Sprint 1 items **16, 17, 18, 19** (governance).

### ✅ 2026-03-04 - Chunk 6 (Governance deliverables)

- Completed Sprint 1 backlog items **16, 17, 18, 19**.
- Item 16 completed:
  - published ADR-001 for target architecture boundaries:
    - `docs/adr/ADR-001-target-architecture-boundaries.md`
- Item 17 completed:
  - published ADR-002 for v2 data model and migration strategy:
    - `docs/adr/ADR-002-v2-data-model-and-migration-strategy.md`
- Item 18 completed:
  - created migration and rollback checklist templates:
    - `docs/checklists/MIGRATION_SAFETY_CHECKLIST.md`
    - `docs/checklists/ROLLBACK_CHECKLIST.md`
- Item 19 completed:
  - added phase-gate tracker artifacts with `P0`/`G0` workflow support:
    - `docs/PHASE_GATE_DASHBOARD.md`
    - `.github/ISSUE_TEMPLATE/phase-gate-tracker.md`
- Documentation index updated:
  - `docs/INDEX.md`
- Next target chunk: Sprint 1 items **20, 21** (parallel frontend prep).

### ✅ 2026-03-04 - Chunk 7 (Parallel frontend prep completion + P1 kickoff)

- Completed Sprint 1 backlog items **20, 21**.
- Item 20 completed:
  - added shared Firebase Admin test harness:
    - `functions/test/helpers/firebase-mock.js`
  - migrated suites to shared helper:
    - `functions/test/admin.test.js`
    - `functions/test/cleanup-user.test.js`
- Item 21 completed:
  - expanded `frontend/js/api-client.js` endpoint coverage so inline frontend endpoint usage is now captured in APIClient methods.
  - regenerated contract baseline: `docs/API_CONTRACT_BASELINE_MAR26.md`
    - APIClient endpoint-method entries: **60**
    - inline HTML endpoint paths missing from APIClient: **0**
- Validation passed:
  - `npm --prefix functions test -- admin.test.js cleanup-user.test.js --runInBand`
  - `node scripts/api-contract-baseline.js --write-doc`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: Phase **P1** contract artifacts (bounded contexts, adapter interfaces, error taxonomy, OpenAPI workflow).

### ✅ 2026-03-04 - Chunk 8 (P1 contract artifacts kickoff)

- Started Phase **P1** deliverables for `G1`.
- Added architecture and contract implementation spec:
  - `docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md`
  - includes bounded contexts, dependency rules, tariff/device/EV adapter interfaces, canonical device variable map, and error taxonomy.
- Added OpenAPI source-of-truth baseline:
  - `docs/openapi/openapi.v1.yaml`
- Updated documentation and governance trackers:
  - `docs/INDEX.md`
  - `docs/PHASE_GATE_DASHBOARD.md` (P0/G0 set to Completed, P1/G1 set to In Progress)
- Next target chunk: continue P1 by defining legacy-to-v2 field mapping table in implementation-ready detail and adding CI OpenAPI validation.

### ✅ 2026-03-04 - Chunk 9 (Gate hygiene and tracker accuracy)

- Reconciled G0 compliance gaps identified in verification review.
- Updated P1 tracker accuracy:
  - phase tracker now reflects **6/8 tasks drafted, 1/8 partial, 1/8 pending**.
- Strengthened risk register for gate compliance:
  - added explicit **Owner** and **Trigger Threshold** columns for all risks in Section 13.
- Added governance approval tracking section:
  - `## 14A. Execution Approval Log` with explicit missing-signoff status for P0/G0 start.
- Updated phase-gate dashboard issue links:
  - replaced placeholders with prefilled GitHub issue creation links for `P0/G0` and `P1/G1`.
  - recorded local tooling limitation (`gh` CLI missing) so issue creation remains explicit and trackable.
- Annotated stale baseline items in Section 1A with Sprint 1 completion notes (APIClient coverage, `pwa-init.js`, CI gates, coverage scope/thresholds, shared test helper).
- Updated Exit Gate G0 wording to require owner/mitigation/trigger fields in the risk register.
- Next target chunk: continue P1 by defining legacy-to-v2 field mapping table in implementation-ready detail and adding CI OpenAPI validation.

### ✅ 2026-03-05 - Chunk 10 (P1 mapping + OpenAPI CI validation)

- Completed the two remaining P1 contract hardening items identified in chunk 8/9 follow-ups.
- Added implementation-ready legacy-to-v2 mapping matrix:
  - `docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md`
  - includes deterministic v2 entity ID rules, field-level source-to-target mappings, transform rules, dual-read order, and dual-write constraints.
- Added OpenAPI CI validation guard:
  - new script `scripts/openapi-contract-check.js` validates:
    - OpenAPI YAML syntax/structure
    - unique `operationId` values
    - OpenAPI path+method parity against backend route declarations in `functions/index.js`
  - wired into hard pre-deploy gate in `scripts/pre-deploy-check.js`
  - added runnable script entry: `npm run openapi:check`
- Validation passed:
  - `node scripts/openapi-contract-check.js`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: close G1 governance prerequisites (named approver record) and begin P2 extraction sequencing prep.

### ✅ 2026-03-05 - Chunk 11 (Target-state update: recurring billing objective)

- Added recurring subscription billing to target-state objectives:
  - support **weekly** and **monthly** billing cadences
  - enforce feature access via subscription entitlements
- Updated Phase P1 scope to include billing/paywall contracts (data model + adapter + webhook/idempotency expectations).
- No rollback/rework required for completed chunks (P0 and prior P1 deliverables remain valid); this introduces additional **forward** work items in P1 and later implementation phases.
- Next target chunk: draft/approve billing adapter and entitlement contract artifacts (new P1 tasks 9-10), then close G1 governance prerequisite.

### ✅ 2026-03-05 - Chunk 12 (P1 billing contract artifacts in code)

- Implemented non-breaking billing contract scaffolding under `functions/lib/`:
  - `functions/lib/adapters/payment-adapter.js`
  - `functions/lib/billing/entitlements.js`
  - `functions/lib/billing/webhook-idempotency.js`
- Added contract-focused tests:
  - `functions/test/payment-adapter-contract.test.js`
  - `functions/test/billing-entitlements.test.js`
  - `functions/test/billing-webhook-idempotency.test.js`
- Validation passed:
  - `npm --prefix functions test -- payment-adapter-contract.test.js billing-entitlements.test.js billing-webhook-idempotency.test.js --runInBand`
  - `npm --prefix functions run lint`
- Outcome: P1 tasks **9-10** now have implementation artifacts (contract definitions + executable tests) and are no longer pending.
- Next target chunk: close G1 governance prerequisite (named approver record) and lock P2 extraction kickoff list.

### ✅ 2026-03-05 - Chunk 13 (Local emulator restart/reseed incident runbook)

- Documented repeat emulator restart/reseed failure patterns and fixes:
  - `docs/LOCAL_DEV_KNOWN_ISSUES.md`
- Captured confirmed causes from live debugging:
  - UI (`:4000`) readiness can occur before Auth (`:9099`) is ready.
  - Seeding too early causes `ECONNREFUSED 127.0.0.1:9099`.
  - Orphan Firestore/PubSub Java listeners (`:8080`/`:8085`) can block next starts.
  - Multiple emulator instances for the same project create hub conflicts.
- Added deterministic, copy-pasteable restart + reseed flow:
  - port cleanup
  - explicit Java env
  - startup in persistent terminal
  - readiness check across all required ports
  - clear + seed + setup-status verification
- Next target chunk: codify the same readiness gating into automation scripts so manual runs and scripted runs behave identically.

### ✅ 2026-03-05 - Chunk 14 (Fast deterministic emulator reset automation)

- Replaced PowerShell-only npm emulator scripts with cross-platform Node-based orchestration:
  - `scripts/emulator-cli.js`
  - `package.json` scripts now use:
    - `npm run emu:start`
    - `npm run emu:seed`
    - `npm run emu:reset`
    - `npm run emu:stop`
    - `npm run emu:status`
- New reset flow (`emu:reset`) is deterministic and self-healing:
  - kills stale listeners on known emulator ports
  - validates Java availability
  - starts emulators in background
  - waits for all required ports (`4000`, `5000`, `5001`, `8080`, `8085`, `9099`)
  - clears and reseeds Auth + Firestore baseline data
  - verifies `/api/config/setup-status` before reporting success
- Updated operator docs to match runtime behavior:
  - `docs/SETUP.md`
  - `docs/LOCAL_DEV_KNOWN_ISSUES.md`
- Outcome: emulator restart/reseed is now a single command with readiness gating, removing the prior 10-15 minute manual recovery cycle.

### ✅ 2026-03-05 - Chunk 15 (Device telemetry normalization extraction + P2 kickoff lock)

- Continued P1/P2 bridge refactor by extracting inverter telemetry alias handling from `functions/index.js`:
  - new shared module: `functions/lib/device-telemetry.js`
  - `evaluateRule()` now uses `parseAutomationTelemetry(inverterData)` instead of inline alias lookups.
- Added contract-style unit coverage for telemetry normalization:
  - `functions/test/device-telemetry.test.js`
  - validates `SoC/SoC1/SoC_1`, `batTemperature/batTemperature_1`, and ambient temperature key normalization.
- Validation passed:
  - `npm --prefix functions test -- device-telemetry.test.js --runInBand`
  - `npm --prefix functions run lint`
- Locked P2 backend decomposition kickoff sequence in a dedicated artifact:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
  - includes Wave 0/1/2/3 extraction order, guardrails, and validation gates.
- Updated architecture/spec indexing for discoverability:
  - `docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md`
  - `docs/INDEX.md`
- Added prefilled P2/G2 phase-gate tracker link:
  - `docs/PHASE_GATE_DASHBOARD.md`
- Next target chunk: start Wave 1 utility extraction from `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md` (pricing normalization and repository helpers).

### ✅ 2026-03-05 - Chunk 16 (G1 governance sign-off record captured)

- Added explicit named approver entry for ongoing P1 execution in Section `14A`:
  - approver: `Stealth928` (repo owner profile)
  - evidence: explicit in-chat continuation directive for implementation work on 2026-03-05.
- Clarified governance status:
  - historical P0 start sign-off remains a record gap,
  - active P1 execution approval is now documented in-repo with approver + date.
- Next target chunk: execute Wave 1 utility extraction from the locked P2 kickoff sequence.

### ✅ 2026-03-05 - Chunk 17 (P2 Wave 1 step 1: pricing normalization extraction)

- Implemented shared pricing interval parsing utility:
  - `functions/lib/pricing-normalization.js`
  - exports `findCurrentInterval()` and `getCurrentAmberPrices()`.
- Replaced duplicated Amber current-interval parsing in `functions/index.js`:
  - automation rule evaluation now reads current feed-in/buy prices via `getCurrentAmberPrices(cache.amber)`
  - curtailment current feed-in lookup now uses `getCurrentAmberPrices(amberData)` with equivalent error behavior.
- Added focused unit tests:
  - `functions/test/pricing-normalization.test.js`
- Validation passed:
  - `npm --prefix functions test -- pricing-normalization.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated P2 kickoff tracker artifact:
  - marked Wave 1 item 1 as done in `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`.
- Next target chunk: P2 Wave 1 step 2 — extract scheduler segment construction into `lib/automation-actions.js`.

### ✅ 2026-03-05 - Chunk 18 (P2 Wave 1 step 2: scheduler action extraction)

- Implemented shared scheduler-action construction utilities:
  - `functions/lib/automation-actions.js`
  - includes default-group creation, group normalization/clear, segment build, and segment apply helpers.
- Rewired `applyRuleAction()` in `functions/index.js` to use extracted helpers:
  - replaced inline group-clear block with `clearSchedulerGroups(...)`
  - replaced inline segment object construction with `buildAutomationSchedulerSegment(...)`
  - replaced direct group assignment with `applySegmentToGroups(...)`
- Added focused unit tests:
  - `functions/test/automation-actions.test.js`
- Validation passed:
  - `npm --prefix functions test -- automation-actions.test.js pricing-normalization.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated P2 kickoff tracker artifact:
  - marked Wave 1 item 2 as done in `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`.
- Next target chunk: P2 Wave 1 step 3 — extract config/rules/history Firestore reads/writes into repository modules under `functions/lib/repositories/`.

### ✅ 2026-03-05 - Chunk 19 (P2 Wave 1 step 3: repository extraction completion)

- Expanded repository layer for user-scoped config/rules/history operations:
  - `functions/lib/repositories/user-automation-repository.js`
  - added helpers for config set/update, rule get/set/delete, rule cooldown reset batch, and history list retrieval.
- Rewired user-scoped config/rule/history flows in `functions/index.js` to repository helpers:
  - config writes/updates (`/api/config*`, weather timezone sync, setup validation persistence, init-user default config)
  - rule CRUD + rule runtime timestamp updates (`/api/automation/rule/*`, trigger/reset/cycle flows)
  - history reads/writes (`/api/automation/history`, scheduler clear history log)
- Added/expanded repository contract tests:
  - `functions/test/user-automation-repository.test.js`
  - now covers read fallbacks + write/query helpers.
- Validation passed:
  - `npm --prefix functions test -- user-automation-repository.test.js rule-action-validation-routes.test.js quick-control.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated kickoff tracker artifact:
  - marked Wave 1 item 3 as done in `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`.
- Next target chunk: P2 Wave 2 step 1 — start read-only route extraction into `functions/api/routes/` (`pricing.js`, `weather.js`, `metrics.js`).

### ✅ 2026-03-05 - Chunk 20 (P2 Wave 2 step 1: read-only route extraction)

- Extracted read-only route handlers into route modules under `functions/api/routes/`:
  - `functions/api/routes/pricing.js`
  - `functions/api/routes/weather.js`
  - `functions/api/routes/metrics.js`
- Rewired `functions/index.js` to register route modules while preserving existing paths and middleware behavior:
  - pre-auth route registration for pricing + metrics
  - post-auth route registration position preserved for weather
- Added focused supertest coverage for extracted modules:
  - `functions/test/read-only-routes-modules.test.js`
- Updated contract/gate tooling to handle multi-file route declarations (no longer `index.js`-only):
  - `scripts/api-contract-baseline.js`
  - `scripts/openapi-contract-check.js`
  - `scripts/pre-deploy-check.js`
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated kickoff tracker artifact:
  - marked Wave 2 item 1 as done in `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`.
- Next target chunk: P2 Wave 2 step 2 — continue route extraction coverage and add supertest coverage for remaining moved read-only handlers.

### ✅ 2026-03-05 - Chunk 21 (P2 Wave 2 step 2: coverage + contract gate alignment)

- Expanded supertest coverage for extracted read-only route modules:
  - `functions/test/read-only-routes-modules.test.js`
  - added checks for:
    - metrics user-scope auth enforcement and user-scope success path
    - pricing current cache-hit behavior
    - pricing actual endpoint auth gate + matching-interval response path
    - weather anonymous fallback behavior
- Aligned contract/gate scripts with route-module extraction architecture:
  - `scripts/api-contract-baseline.js` now discovers backend routes from:
    - `functions/index.js`
    - `functions/api/routes/**/*.js`
  - `scripts/openapi-contract-check.js` now validates parity against route declarations in:
    - `functions/index.js`
    - `functions/api/routes/**/*.js`
  - `scripts/pre-deploy-check.js` route presence checks now scan:
    - `functions/index.js`
    - `functions/api/routes/**/*.js`
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions test -- routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: P2 Wave 2 step 3 — evaluate remaining read-only candidates for extraction and keep `index.js` focused on composition/wiring.

### ✅ 2026-03-05 - Chunk 22 (P2 Wave 2 step 3: inverter read-only extraction)

- Extracted core inverter read-only GET endpoints from `functions/index.js` into:
  - `functions/api/routes/inverter-read.js`
  - routes moved:
    - `/api/inverter/list`
    - `/api/inverter/real-time`
    - `/api/inverter/settings`
    - `/api/inverter/temps`
    - `/api/inverter/report`
    - `/api/inverter/generation`
    - `/api/inverter/discover-variables`
- Rewired composition in `functions/index.js` via:
  - `registerInverterReadRoutes(app, { ... })`
- Added supertest coverage for the new module:
  - `functions/test/read-only-routes-modules.test.js`
  - coverage includes:
    - inverter list proxy request shape
    - real-time missing-SN guard + force-refresh path
    - generation yearly enrichment from report data
- Updated P2 kickoff tracker to mark Wave 2 item 2 as done:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue Wave 2 step 3 by extracting remaining read-only candidates (history + diagnostic read paths) to further reduce `functions/index.js` routing surface.

### ✅ 2026-03-05 - Chunk 23 (P2 Wave 2 step 3: inverter history route extraction)

- Extracted inverter history route and cache helpers from `functions/index.js` into:
  - `functions/api/routes/inverter-history.js`
  - moved:
    - `/api/inverter/history`
    - Firestore cache helpers previously inlined with history handling
- Rewired composition in `functions/index.js` via:
  - `registerInverterHistoryRoutes(app, { ... })`
- Added/expanded supertest coverage for extracted history route:
  - `functions/test/read-only-routes-modules.test.js`
  - coverage includes:
    - explicit auth middleware enforcement
    - cache-hit return path for single-range history requests
    - cache-miss fetch + cache-write path with normalized millisecond range inputs
- Hardened extracted route timeout handling:
  - replaced raw `Promise.race` timer pattern with a safe `withTimeout(...)` helper that clears timeout handles after completion.
- Updated P2 kickoff tracker artifact to reflect Wave 2 step 3 progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue Wave 2 step 3 by extracting remaining read-only diagnostic/device-read candidates so `functions/index.js` remains primarily composition and orchestration wiring.

### ✅ 2026-03-05 - Chunk 24 (P2 Wave 2 step 3: device read-route extraction)

- Extracted additional read-only device and diagnostics endpoints from `functions/index.js` into:
  - `functions/api/routes/device-read.js`
  - moved:
    - `/api/device/battery/soc/get`
    - `/api/device/status/check`
    - `/api/device/battery/forceChargeTime/get`
    - `/api/device/getMeterReader`
    - `/api/ems/list`
    - `/api/module/list`
    - `/api/module/signal`
    - `/api/meter/list`
    - `/api/device/workmode/get`
- Rewired composition in `functions/index.js` via:
  - `registerDeviceReadRoutes(app, { ... })`
- Expanded supertest route-module coverage:
  - `functions/test/read-only-routes-modules.test.js`
  - added checks for:
    - module signal required-parameter guard
    - battery SoC read missing-SN guard
    - workmode read proxy payload and user-scoped config usage
    - device status diagnostic envelope path
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 2 kickoff tracker note with latest extraction set:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 2 step 3 by extracting remaining read-only candidates (for example: safe diagnostic/read paths around device settings and inverter diagnostics) to further shrink `functions/index.js` routing surface.

### ✅ 2026-03-05 - Chunk 25 (P2 Wave 2 step 3: diagnostics read-route extraction + logging safety fix)

- Extracted remaining diagnostic read endpoints from `functions/index.js` into:
  - `functions/api/routes/diagnostics-read.js`
  - moved:
    - `/api/device/setting/get`
    - `/api/inverter/all-data`
- Rewired composition in `functions/index.js` via:
  - `registerDiagnosticsReadRoutes(app, { ... })`
- Added supertest coverage for extracted diagnostics routes:
  - `functions/test/read-only-routes-modules.test.js`
  - added checks for:
    - required-key guard on `/api/device/setting/get`
    - successful proxy payload/response flow on `/api/device/setting/get`
    - topology hint generation on `/api/inverter/all-data`
- Fixed runtime logging regression introduced by prior module extraction:
  - replaced `logger.log(...)` usage with `console.log(...)` in extracted read modules where runtime logger does not expose `.log`:
    - `functions/api/routes/inverter-read.js`
    - `functions/api/routes/device-read.js`
- Updated Wave 2 kickoff tracker note with latest extraction set:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue Wave 2 step 3 by evaluating whether `/api/scheduler/v1/get` should be isolated as read-only scheduler-route wiring before beginning Wave 3 mutation-route extraction.

### ✅ 2026-03-05 - Chunk 26 (P2 Wave 2 step 3: scheduler read-route extraction)

- Extracted scheduler read endpoint from `functions/index.js` into:
  - `functions/api/routes/scheduler-read.js`
  - moved:
    - `/api/scheduler/v1/get`
- Rewired composition in `functions/index.js` via:
  - `registerSchedulerReadRoutes(app, { ... })`
- Expanded read-route module supertest coverage:
  - `functions/test/read-only-routes-modules.test.js`
  - added checks for:
    - default scheduler payload when device SN is not configured
    - device-backed scheduler read path with `source: 'device'` tagging and SN override handling
- Updated Wave 2 kickoff tracker note with latest extraction set:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Validation passed:
  - `npm --prefix functions test -- read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: begin Wave 3 by extracting scheduler mutation endpoints (`/api/scheduler/v1/set`, `/api/scheduler/v1/clear-all`) so `index.js` keeps shrinking toward composition-only responsibilities.

### ✅ 2026-03-06 - Chunk 27 (P2 Wave 3 step 1: scheduler mutation-route extraction)

- Extracted scheduler mutation endpoints from `functions/index.js` into:
  - `functions/api/routes/scheduler-mutations.js`
  - moved:
    - `/api/scheduler/v1/set`
    - `/api/scheduler/v1/clear-all`
- Rewired composition in `functions/index.js` via:
  - `registerSchedulerMutationRoutes(app, { ... })`
- Added focused supertest coverage for mutation-route extraction:
  - `functions/test/scheduler-mutation-routes-modules.test.js`
  - added checks for:
    - missing-device guard on `/api/scheduler/v1/set`
    - scheduler set path (enable + flag update + verify + history write)
    - clear-all auth enforcement + 8-group clear payload + verify + history write
- Validation passed:
  - `npm --prefix functions test -- scheduler-mutation-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 2/3 tracker artifact for transition to mutation extraction:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 1 by extracting remaining state-changing route domains (`config`, `automation`) into route modules while preserving current API contracts.

### ✅ 2026-03-06 - Chunk 28 (Local reset hardening + runbook update)

- Captured emulator reset incident and codified permanent fix for fast local recovery:
  - `npm run emu:reset` previously failed on Windows with `spawn npx ENOENT` / `EINVAL` when launching detached child processes.
- Hardened emulator launcher in:
  - `scripts/emulator-cli.js`
  - Windows launcher now uses `cmd.exe /c ...` with fallback chain:
    - `npx firebase emulators:start ...`
    - `npm exec -- firebase emulators:start ...`
  - preserves existing readiness-gated stop/start/seed/status workflow.
- Updated reset/runbook docs:
  - `docs/LOCAL_DEV_KNOWN_ISSUES.md`
  - `docs/SETUP.md`
  - added explicit launcher-fallback guidance for legacy clones and cross-shell reliability notes.
- Validation passed:
  - `npm run emu:reset`
  - `npm run emu:status`
  - `GET http://127.0.0.1:5000/api/config/setup-status` returned HTTP 200
- Next target chunk: continue Wave 3 step 1 by extracting remaining state-changing route domains (`config`, `automation`) into route modules while preserving current API contracts.

### ✅ 2026-03-06 - Chunk 29 (P2 Wave 3 step 1: config mutation-route extraction)

- Extracted config mutation endpoints from `functions/index.js` into:
  - `functions/api/routes/config-mutations.js`
  - moved:
    - `POST /api/config/system-topology`
    - `POST /api/config`
    - `POST /api/config/clear-credentials`
    - `POST /api/config/tour-status`
- Rewired composition in `functions/index.js` via:
  - `registerConfigMutationRoutes(app, { ... })`
- Added focused supertest coverage for extracted config mutation routes:
  - `functions/test/config-mutation-routes-modules.test.js`
  - added checks for:
    - topology payload normalization + persistence
    - config save payload guards and timezone-priority/fallback paths
    - clear-credentials auth guard + field-clearing behavior
    - tour-status payload validation + persistence behavior
- Validation passed:
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect completed config-mutation extraction:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 1 by extracting remaining automation mutation routes into a dedicated route module while preserving current API contracts.

### ✅ 2026-03-06 - Chunk 30 (P2 Wave 3 step 1: automation mutation-route extraction)

- Extracted automation mutation endpoints from `functions/index.js` into:
  - `functions/api/routes/automation-mutations.js`
  - moved:
    - `POST /api/automation/toggle`
    - `POST /api/automation/enable`
    - `POST /api/automation/trigger`
    - `POST /api/automation/reset`
    - `POST /api/automation/cancel`
    - `POST /api/automation/rule/end`
    - `POST /api/automation/rule/create`
    - `POST /api/automation/rule/update`
    - `POST /api/automation/rule/delete`
    - `POST /api/automation/test`
- Rewired composition in `functions/index.js` via:
  - `registerAutomationMutationRoutes(app, { ... })`
- Added focused supertest coverage for extracted automation mutation routes:
  - `functions/test/automation-mutation-routes-modules.test.js`
  - added checks for:
    - toggle/enable/reset/trigger validation and state updates
    - cancel flow (device guard + scheduler clear + flag + verify + history write)
    - rule create/update/end guards and active-rule cleanup behavior
    - automation test simulation path returning first matching rule
- Validation passed:
  - `npm --prefix functions test -- automation-mutation-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect automation mutation extraction:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 by extracting `/api/automation/cycle` (largest remaining mutation route) and then stabilizing with targeted regression coverage before service-layer moves.

### ✅ 2026-03-06 - Chunk 31 (P2 Wave 3 step 1: automation cycle-route extraction)

- Extracted automation cycle route from `functions/index.js` into:
  - `functions/api/routes/automation-cycle.js`
  - moved:
    - `POST /api/automation/cycle`
- Rewired composition in `functions/index.js` via:
  - `registerAutomationCycleRoute(app, { ... })`
- Added focused supertest coverage for extracted cycle route module:
  - `functions/test/automation-cycle-route-module.test.js`
  - added checks for:
    - automation-disabled skip path
    - quick-control-active skip path
    - no-rules-configured skip path
- Validation passed:
  - `npm --prefix functions test -- automation-cycle-route-module.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to mark step 1 extraction complete:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`

### ✅ 2026-03-06 - Chunk 32 (P2 Wave 3 step 2: scheduler segment-clear service extraction)

- Introduced shared scheduler segment-clear service module:
  - `functions/lib/services/scheduler-segment-service.js`
  - added helper:
    - `clearSchedulerSegments({ foxessAPI, userConfig, userId, deviceSN, groupCount })`
- Rewired route modules to use shared service for clear-segment device calls:
  - `functions/api/routes/automation-cycle.js`
  - `functions/api/routes/automation-mutations.js`
  - `functions/api/routes/scheduler-mutations.js`
- Added focused unit coverage for new service:
  - `functions/test/scheduler-segment-service.test.js`
- Validation passed:
  - `npm --prefix functions test -- scheduler-segment-service.test.js automation-mutation-routes-modules.test.js scheduler-mutation-routes-modules.test.js automation-cycle-route-module.test.js automation-actions.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by extracting remaining repeated automation-cycle helper blocks into dedicated service modules while preserving current API behavior.

### ✅ 2026-03-06 - Chunk 33 (P2 Wave 3 step 2: automation audit-evaluation service extraction)

- Introduced shared automation audit-evaluation service module:
  - `functions/lib/services/automation-audit-service.js`
  - added helper:
    - `buildAllRuleEvaluationsForAudit(evaluationResults, sortedRules)`
- Rewired automation cycle route to use shared audit-evaluation mapper:
  - `functions/api/routes/automation-cycle.js`
- Added focused unit coverage for new service:
  - `functions/test/automation-audit-service.test.js`
- Validation passed:
  - `npm --prefix functions test -- automation-audit-service.test.js automation-cycle-route-module.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`

### ✅ 2026-03-06 - Chunk 34 (P2 Wave 3 step 2: automation ROI house-load service extraction)

- Introduced shared automation ROI/house-load service module:
  - `functions/lib/services/automation-roi-service.js`
  - added helpers:
    - `normalizeInverterDatas(inverterData)`
    - `findValue(arr, keysOrPatterns)`
    - `extractHouseLoadWatts(inverterData, logger)`
- Rewired automation cycle route to use shared ROI house-load extractor:
  - `functions/api/routes/automation-cycle.js`
- Added focused unit coverage for new service:
  - `functions/test/automation-roi-service.test.js`
- Validation passed:
  - `npm --prefix functions test -- automation-roi-service.test.js automation-cycle-route-module.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`

### ✅ 2026-03-06 - Chunk 35 (P2 Wave 3 step 2: automation ROI revenue-estimation extraction)

- Extended shared automation ROI service module:
  - `functions/lib/services/automation-roi-service.js`
  - added helper:
    - `calculateRoiEstimate({ action, result, houseLoadW })`
- Rewired automation cycle route to use shared ROI revenue estimator:
  - `functions/api/routes/automation-cycle.js`
- Added focused unit coverage for extracted estimator logic:
  - `functions/test/automation-roi-service.test.js`
  - added checks for:
    - force-charge positive/negative buy-price revenue behavior
    - force-discharge export clamping behavior
    - non-grid-mode zero-revenue behavior
- Validation passed:
  - `npm --prefix functions test -- automation-roi-service.test.js automation-cycle-route-module.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by extracting any remaining ROI snapshot assembly/parsing helpers into dedicated service modules while preserving current API behavior.

### ✅ 2026-03-06 - Chunk 36 (P2 Wave 3 step 2: automation ROI snapshot-assembly extraction)

- Extended shared automation ROI service module:
  - `functions/lib/services/automation-roi-service.js`
  - added helper:
    - `buildRoiSnapshot({ action, inverterData, logger, result })`
- Rewired automation cycle route to use shared ROI snapshot assembly helper:
  - `functions/api/routes/automation-cycle.js`
- Added focused unit coverage for extracted ROI snapshot assembly:
  - `functions/test/automation-roi-service.test.js`
  - added checks for:
    - discharge-mode snapshot assembly with parsed house load
    - missing-house-load fallback behavior
- Validation passed:
  - `npm --prefix functions test -- automation-roi-service.test.js automation-cycle-route-module.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/api-contract-baseline.js --silent`
  - `node scripts/openapi-contract-check.js --silent`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by extracting automation-cycle data-fetch helpers (inverter + Amber) into shared service modules while preserving current API behavior.

### ✅ 2026-03-06 - Chunk 37 (P2 Wave 3 step 2: automation-cycle data-fetch service extraction)

- Introduced shared automation-cycle data-fetch service module:
  - `functions/lib/services/automation-cycle-data-service.js`
  - added helpers:
    - `fetchAutomationInverterData({ userId, deviceSN, userConfig, getCachedInverterData, getCachedInverterRealtimeData, logger })`
    - `fetchAutomationAmberData({ userId, userConfig, amberAPI, amberPricesInFlight, logger })`
- Rewired automation cycle route to use shared inverter/Amber data-fetch helpers:
  - `functions/api/routes/automation-cycle.js`
- Added focused unit coverage for new service:
  - `functions/test/automation-cycle-data-service.test.js`
  - added checks for:
    - inverter cache primary-hit and realtime-fallback behavior
    - Amber cache-miss fetch/caching behavior
    - Amber in-flight de-dup success and retry-on-failure behavior
- Validation passed:
  - `npm --prefix functions test -- automation-cycle-data-service.test.js automation-cycle-route-module.test.js automation-roi-service.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by extracting remaining blackout-window and weather look-ahead helper blocks into dedicated service modules while preserving current API behavior.

### ✅ 2026-03-06 - Chunk 38 (P2 Wave 3 step 2: blackout-window + weather-fetch-plan service extraction)

- Introduced shared automation-cycle rule-evaluation helper service module:
  - `functions/lib/services/automation-cycle-rule-service.js`
  - added helpers:
    - `evaluateBlackoutWindow(blackoutWindows, currentMinutes)`
    - `hasWeatherDependentRules(enabledRules, isForecastTemperatureType)`
    - `buildWeatherFetchPlan({ enabledRules, isForecastTemperatureType, automationForecastDays })`
- Rewired automation cycle route to use shared blackout and weather planning helpers:
  - `functions/api/routes/automation-cycle.js`
- Added focused unit coverage for new service:
  - `functions/test/automation-cycle-rule-service.test.js`
  - added checks for:
    - same-day and midnight-wrapping blackout windows
    - disabled blackout-window handling
    - weather-dependent rule detection
    - weather look-ahead day calculation and clamp behavior
- Validation passed:
  - `npm --prefix functions test -- automation-cycle-rule-service.test.js automation-cycle-route-module.test.js automation-cycle-data-service.test.js automation-roi-service.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by extracting remaining rule-loop lifecycle/cooldown helper blocks from `automation-cycle` into service modules while preserving current API behavior.

### ✅ 2026-03-06 - Chunk 39 (Frontend settings timing UI: 1-decimal minute display precision)

- Updated settings timing display formatting so minute translations render with one decimal:
  - `frontend/settings.html`
  - `formatMs(ms)` minute branch now uses `toFixed(1)` (for example `1.0m`, `5.0m`, `30.0m`)
- Aligned initial timing badges with runtime formatter output:
  - automation/amber/inverter/weather timing cards now initialize to `1.0m` / `5.0m` / `30.0m` style display
- Added explicit frontend regression assertion for minute badge precision:
  - `tests/frontend/settings-persistence.spec.js`
  - verifies `#automation_intervalMs_display`, `#cache_amber_display`, `#cache_inverter_display`, `#cache_weather_display`
- Validation passed:
  - `npx playwright test tests/frontend/settings.spec.js tests/frontend/settings-persistence.spec.js --project=chromium`
  - `npx playwright test tests/frontend/settings-persistence.spec.js --project=chromium`
- Next target chunk: continue Wave 3 step 2 backend extraction by decomposing remaining rule-loop lifecycle/cooldown helper blocks from `automation-cycle`.

### ✅ 2026-03-06 - Chunk 40 (P2 Wave 3 step 2: rule-loop lifecycle/cooldown service extraction)

- Introduced shared automation-cycle lifecycle helper service module:
  - `functions/lib/services/automation-cycle-lifecycle-service.js`
  - added helpers:
    - `evaluateRuleCooldown({ isActiveRule, lastTriggered, cooldownMinutes, nowMs })`
    - `buildCooldownEvaluationResult(ruleName, cooldownRemainingSeconds)`
    - `buildContinuingEvaluationResult({ ruleName, activeForSeconds, cooldownRemainingSeconds, details })`
    - `buildClearedActiveRuleState({ includeLastCheck, lastCheckMs, inBlackout })`
    - `buildTriggeredRuleState({ ruleId, ruleName, actionResult, lastCheckMs, lastTriggeredMs })`
    - `buildTriggeredRuleSummary({ ruleId, rule, isNewTrigger })`
- Rewired automation-cycle route to consume shared lifecycle/cooldown helpers:
  - `functions/api/routes/automation-cycle.js`
  - moved repeated cooldown calculation and active-rule state object assembly behind `lib/services/*` while preserving API behavior.
- Added focused unit coverage for the new lifecycle service:
  - `functions/test/automation-cycle-lifecycle-service.test.js`
- Validation passed:
  - `npm --prefix functions test -- automation-cycle-lifecycle-service.test.js automation-cycle-route-module.test.js automation-cycle-rule-service.test.js automation-cycle-data-service.test.js automation-roi-service.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by extracting remaining segment-clear retry/cancellation helper blocks from `automation-cycle` into `lib/services/*` with no behavior changes.

### ✅ 2026-03-06 - Chunk 41 (P2 Wave 3 step 2: segment-clear retry/cancellation service extraction)

- Extended shared scheduler segment service with retry/cancellation helper:
  - `functions/lib/services/scheduler-segment-service.js`
  - added `clearSchedulerSegmentsWithRetry({ deviceSN, foxessAPI, userConfig, userId, maxAttempts, retryDelayMs, settleDelayMs, logger })`.
- Rewired automation-cycle cancellation path to use shared retry flow:
  - `functions/api/routes/automation-cycle.js`
  - replaced inline segment-clear retry loop/delay block under active-rule cancellation with `clearSchedulerSegmentsWithRetry(...)` while preserving existing behavior (`3` attempts, `1200ms` retry delay, `2500ms` settle delay, abort-on-failure semantics).
- Added focused retry behavior coverage:
  - `functions/test/scheduler-segment-service.test.js`
  - new assertions cover retry-until-success, fail-after-max-attempts, and throw propagation.
- Validation passed:
  - `npm --prefix functions run lint`
  - `npm --prefix functions test -- scheduler-segment-service.test.js automation-cycle-route-module.test.js automation-cycle-lifecycle-service.test.js --runInBand`
  - `node scripts/pre-deploy-check.js`
- Updated Wave 3 tracker artifact to reflect service extraction progress:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: continue Wave 3 step 2 by normalizing remaining one-shot segment-clear/pacing call sites in `automation-cycle` into shared helpers with no behavior changes.

### ✅ 2026-03-06 - Chunk 42 (P2 Wave 3 step 2: one-shot segment-clear/pacing helper normalization)

- Extended shared scheduler segment service with one-shot helper:
  - `functions/lib/services/scheduler-segment-service.js`
  - added `clearSchedulerSegmentsOneShot({ deviceSN, foxessAPI, userConfig, userId, settleDelayMs })`.
- Rewired automation-cycle one-shot clear call sites to use shared helper:
  - `functions/api/routes/automation-cycle.js`
  - migrated disable-path and disable-flag segment-clear branches to `clearSchedulerSegmentsOneShot(...)`.
  - migrated higher-priority preemption clear + pacing path to `clearSchedulerSegmentsOneShot(..., settleDelayMs: 2500)`.
- Added focused regression coverage:
  - `functions/test/scheduler-segment-service.test.js`
  - new assertions cover one-shot success and failure envelopes.
  - `functions/test/automation-cycle-route-module.test.js`
  - added clearSegmentsOnNextCycle branch coverage to confirm route behavior and FoxESS clear call wiring.
- Validation passed:
  - `npm --prefix functions test -- scheduler-segment-service.test.js automation-cycle-route-module.test.js --runInBand`
  - `npm --prefix functions run lint`
- Updated Wave 3 tracker artifact to reflect helper extraction completion:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: prepare G2 closeout evidence and run a residual inline-helper scan for any remaining extraction candidates.

### 2026-03-06 - Chunk 43 (P2 Wave 3 step 2: trigger action/persist helper extraction)

- Completed residual inline-helper scan and extracted repeated trigger action/persist flow from `automation-cycle` into shared service module:
  - `functions/lib/services/automation-cycle-action-service.js`
  - added `applyTriggeredRuleAction(...)` and `persistTriggeredRuleState(...)` to centralize apply + state persistence behavior.
- Rewired automation-cycle route call sites to use shared helper flow with no API envelope changes:
  - `functions/api/routes/automation-cycle.js`
  - replaced duplicated trigger-action + save-state blocks in both cooldown-expiry re-trigger and new-trigger branches.
- Added focused unit coverage for new shared service:
  - `functions/test/automation-cycle-action-service.test.js`
- Validation passed:
  - `npm --prefix functions test -- automation-cycle-action-service.test.js automation-cycle-route-module.test.js automation-cycle-lifecycle-service.test.js scheduler-segment-service.test.js --runInBand`
  - `npm --prefix functions run lint`
- Updated Wave 3 tracker artifact to reflect residual extraction completion:
  - `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`
- Next target chunk: prepare G2 closeout evidence package and finalize sign-off checklist.

### 2026-03-06 - Chunk 44 (P2/G2 closeout evidence draft + residual utility dedupe)

- Prepared dedicated G2 closeout evidence package with objective gate-by-gate status:
  - `docs/P2_G2_CLOSEOUT_EVIDENCE_MAR26.md`
  - captured contract/lint/pre-deploy verification, decomposition footprint metrics, and explicit G2 blocker list.
- Updated phase-gate tracker references to reflect active G2 closeout drafting:
  - `docs/PHASE_GATE_DASHBOARD.md`
  - `docs/INDEX.md`
- Reduced residual helper duplication found during closeout scan:
  - added shared numeric utility `functions/lib/services/number-utils.js` via `toFiniteNumber(...)`.
  - rewired `functions/lib/services/automation-cycle-lifecycle-service.js` and `functions/lib/services/automation-cycle-action-service.js` to consume shared utility.
  - added focused coverage in `functions/test/number-utils.test.js`.
- Validation passed:
  - `npm run api:contract:check`
  - `npm run openapi:check`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
  - `npm --prefix functions test -- number-utils.test.js automation-cycle-lifecycle-service.test.js automation-cycle-action-service.test.js automation-cycle-route-module.test.js --runInBand`
- Next target chunk: execute G2 blockers with implementation changes (scheduler decoupling from Express internals, `functions/index.js` reduction toward <1500 lines, and shared test-harness adoption normalization).

### 2026-03-06 - Chunk 45 (G2 blocker execution: scheduler route-stack decoupling)

- Removed scheduler dependency on Express internal route stack traversal:
  - `functions/api/routes/automation-cycle.js`
    - `registerAutomationCycleRoute(...)` now returns the registered `automationCycleHandler`.
  - `functions/index.js`
    - captured handler reference at registration time (`const automationCycleHandler = registerAutomationCycleRoute(...)`).
    - replaced `app._router.stack.find(...)` route lookup in `runAutomationHandler(...)` with direct `automationCycleHandler(mockReq, mockRes)` invocation.
- Updated G2 closeout evidence to reflect this blocker progress:
  - `docs/P2_G2_CLOSEOUT_EVIDENCE_MAR26.md`
  - criterion 1 moved from "Not Met" to "Partially Met" (route-stack coupling removed; pure service-runner decoupling still pending).
- Validation passed:
  - `npm --prefix functions test -- routes-integration.test.js automation-cycle-route-module.test.js automation-cycle-action-service.test.js automation-cycle-lifecycle-service.test.js number-utils.test.js --runInBand`
  - `npm --prefix functions run lint`
- Next target chunk: execute remaining G2 blockers (continue `functions/index.js` reduction toward <1500 lines and utility/test-harness normalization).

### 2026-03-06 - Chunk 46 (G2 blocker execution: public setup/auth route extraction)

- Continued `functions/index.js` reduction by extracting public setup/auth handlers into a dedicated route module:
  - `functions/api/routes/setup-public.js`
  - moved:
    - `POST /api/auth/forgot-password`
    - `POST /api/config/validate-keys`
    - `GET /api/config/setup-status`
- Rewired composition in `functions/index.js`:
  - added `registerSetupPublicRoutes(...)` import and registration.
  - removed duplicated inline handler bodies while preserving API envelopes and validation behavior.
- Added focused regression coverage for extracted route module:
  - `functions/test/setup-public-routes-modules.test.js`
  - covers dependency guardrails, forgot-password validation, validate-keys error/success paths, emulator shortcut behavior, authenticated config persistence, and setup-status user envelope behavior.
- Validation passed:
  - `npm --prefix functions test -- setup-public-routes-modules.test.js routes-integration.test.js cleanup-user.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue remaining G2 blockers (additional `index.js` route-domain extraction and shared test-harness normalization).

### 2026-03-06 - Chunk 47 (G2 blocker execution: auth lifecycle route extraction)

- Continued `functions/index.js` reduction by extracting protected auth lifecycle handlers into a dedicated route module:
  - `functions/api/routes/auth-lifecycle.js`
  - moved:
    - `GET /api/health/auth`
    - `POST /api/auth/init-user`
    - `POST /api/auth/cleanup-user`
- Rewired composition in `functions/index.js`:
  - added `registerAuthLifecycleRoutes(...)` import and registration after API auth middleware setup.
  - removed duplicated inline handler bodies while preserving auth requirements and response envelopes.
- Added focused regression coverage for extracted route module:
  - `functions/test/auth-lifecycle-routes-modules.test.js`
  - covers dependency guardrails, auth enforcement for health check, init-user persistence flow, and cleanup-user recursive-delete invocation.
- Validation passed:
  - `npm --prefix functions test -- auth-lifecycle-routes-modules.test.js routes-integration.test.js cleanup-user.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue remaining G2 blockers (additional high-volume route-domain extraction and shared test-harness normalization).

### 2026-03-06 - Chunk 48 (G2 blocker execution: quick-control route extraction)

- Continued `functions/index.js` reduction by extracting quick manual-control endpoints into a dedicated route module:
  - `functions/api/routes/quick-control.js`
  - moved:
    - `POST /api/quickcontrol/start`
    - `POST /api/quickcontrol/end`
    - `GET /api/quickcontrol/status`
- Rewired composition in `functions/index.js`:
  - added `registerQuickControlRoutes(...)` import and registration.
  - removed large inline quick-control handler block while preserving retry/verification/state-history behavior.
- Added focused regression coverage for extracted route module:
  - `functions/test/quick-control-routes-modules.test.js`
  - covers dependency guardrails, start validation branch, no-op end branch, inactive status envelope, and expired status auto-cleanup envelope.
- Validation passed:
  - `npm --prefix functions test -- quick-control-routes-modules.test.js quick-control.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue remaining G2 blockers (extract remaining large inline route domains and continue shared test-harness normalization).

### 2026-03-06 - Chunk 49 (G2 blocker execution: automation history/audit route extraction)

- Continued `functions/index.js` reduction by extracting automation history and audit read endpoints into a dedicated route module:
  - `functions/api/routes/automation-history.js`
  - moved:
    - `GET /api/automation/history`
    - `GET /api/automation/audit`
- Rewired composition in `functions/index.js`:
  - added `registerAutomationHistoryRoutes(...)` import and registration.
  - removed inline history/audit route handler block while preserving date-range parsing, rule-event reconstruction, and response envelope semantics.
- Added focused regression coverage for extracted route module:
  - `functions/test/automation-history-routes-modules.test.js`
  - covers dependency guardrails, history limit parsing, invalid explicit date range handling, complete rule-event assembly, and ongoing rule-event assembly.
- Validation passed:
  - `npm --prefix functions test -- automation-history-routes-modules.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- Next target chunk: continue remaining G2 blockers (extract remaining inline mutation route domains and continue shared test-harness normalization).

### 2026-03-06 - Chunk 50 (G2 blocker execution: device mutation route extraction)

- Continued `functions/index.js` reduction by extracting device mutation endpoints into a dedicated route module:
  - `functions/api/routes/device-mutations.js`
  - moved:
    - `POST /api/device/battery/soc/set`
    - `POST /api/device/setting/set`
    - `POST /api/device/battery/forceChargeTime/set`
    - `POST /api/device/workmode/set`
- Rewired composition in `functions/index.js`:
  - added `registerDeviceMutationRoutes(...)` import and registration.
  - removed inline device mutation handler block while preserving validation, FoxESS payload semantics, and response envelopes.
- Added focused regression coverage for extracted route module:
  - `functions/test/device-mutation-routes-modules.test.js`
  - covers dependency guardrails, missing-SN handling, auth enforcement, required-key validation, invalid work-mode guard, and `FeedinFirst` to `WorkMode=1` mapping.
- Validation passed:
  - `npm --prefix functions test -- device-mutation-routes-modules.test.js auth-lifecycle-routes-modules.test.js quick-control-routes-modules.test.js automation-history-routes-modules.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **4,051 lines** (from 9,019 baseline, ~55.1% reduction).
- Inline route declarations remaining in `functions/index.js`: **15** (`app.get/post/put/delete/patch` registrations).
- Next target chunk: continue remaining G2 blockers (extract remaining inline device/admin/config domains and continue shared test-harness normalization).

### 2026-03-06 - Chunk 51 (G2 blocker execution: config/status + user-self route extraction)

- Continued `functions/index.js` reduction by extracting remaining inline config/status and self-service user routes into dedicated route modules:
  - `functions/api/routes/config-read-status.js`
  - moved:
    - `GET /api/config`
    - `GET /api/config/system-topology`
    - `GET /api/config/tour-status`
    - `GET /api/automation/status`
  - `functions/api/routes/user-self.js`
  - moved:
    - `POST /api/user/init-profile`
    - `POST /api/user/delete-account`
- Rewired composition in `functions/index.js`:
  - added `registerConfigReadStatusRoutes(...)` and `registerUserSelfRoutes(...)` imports + registrations.
  - removed inline handler blocks while preserving migration sync, blackout evaluation, config envelope behavior, profile init defaults, and account-delete safety checks.
- Added focused regression coverage for extracted route modules:
  - `functions/test/config-read-status-routes-modules.test.js`
  - `functions/test/user-self-routes-modules.test.js`
  - covers dependency guardrails, config/system-topology/tour-status envelopes, automation-status blackout + migration sync behavior, init-profile defaults, and delete-account validation/safety/cleanup paths.
- Validation passed:
  - `npm --prefix functions test -- config-read-status-routes-modules.test.js user-self-routes-modules.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **3,772 lines** (from 9,019 baseline, ~58.2% reduction).
- Inline route declarations remaining in `functions/index.js`: **9** (`app.get/post/put/delete/patch` registrations).
- Next target chunk: continue remaining G2 blockers by extracting the inline admin route domain and final residual helpers.

### 2026-03-06 - Chunk 52 (G2 blocker execution: admin route domain extraction)

- Continued `functions/index.js` reduction by extracting the remaining inline admin route domain into a dedicated route module:
  - `functions/api/routes/admin.js`
  - moved:
    - `GET /api/admin/firestore-metrics`
    - `GET /api/admin/users`
    - `GET /api/admin/platform-stats`
    - `POST /api/admin/users/:uid/role`
    - `POST /api/admin/users/:uid/delete`
    - `GET /api/admin/users/:uid/stats`
    - `POST /api/admin/impersonate`
    - `GET /api/admin/check`
- Rewired composition in `functions/index.js`:
  - added `registerAdminRoutes(...)` import and registration.
  - removed the full inline admin handler block while preserving auth/admin guards, metrics/billing fallbacks, and audit semantics.
- Added focused regression coverage for extracted module:
  - `functions/test/admin-routes-modules.test.js`
  - covers dependency guardrails, admin-check auth and response envelope, googleapis-unavailable guard, role validation, and delete confirmation validation.
- Validation passed:
  - `npm --prefix functions test -- admin-routes-modules.test.js admin.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **2,987 lines** (from 9,019 baseline, ~66.9% reduction).
- Inline route declarations remaining in `functions/index.js`: **1** (`GET /api/health`).
- Next target chunk: continue G2 blocker closure by decomposing remaining large helper/service domains from `index.js` (billing/monitoring helpers, weather/cache helpers, and residual repository utility duplication).

### 2026-03-06 - Chunk 53 (G2 blocker execution: health route extraction)

- Completed route-domain extraction by moving the final inline health endpoint into a dedicated route module:
  - `functions/api/routes/health.js`
  - moved:
    - `GET /api/health`
- Rewired composition in `functions/index.js`:
  - added `registerHealthRoutes(...)` import and registration.
  - removed final inline route declaration while preserving token-presence envelope behavior and unauthenticated-safe response semantics.
- Added focused regression coverage for extracted module:
  - `functions/test/health-routes-modules.test.js`
  - covers dependency guardrails, unauthenticated health envelope, and attached-user token-presence reporting.
- Validation passed:
  - `npm --prefix functions test -- health-routes-modules.test.js routes-integration.test.js credential-masking.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **2,958 lines** (from 9,019 baseline, ~67.2% reduction).
- Inline route declarations remaining in `functions/index.js`: **0** (`app.get/post/put/delete/patch` registrations).
- Next target chunk: continue G2 blocker closure by decomposing remaining large helper/service domains from `index.js` (billing/monitoring helpers, weather/cache helpers, and residual repository utility duplication) toward the <1,500 target.

### 2026-03-06 - Chunk 54 (G2 blocker execution: admin helper-domain extraction)

- Continued `functions/index.js` reduction by extracting residual admin helper domains into shared `lib` modules:
  - `functions/lib/admin-access.js`
    - moved admin-role lookup + middleware composition (`isAdmin`, `requireAdmin`, `SEED_ADMIN_EMAIL`).
  - `functions/lib/admin-metrics.js`
    - moved admin monitoring/billing helper stack:
      - runtime project-id resolution
      - monitoring time-series pagination + aggregation
      - metric error normalization
      - Firestore usage-based MTD cost estimation
      - Cloud Billing API fetch/parsing and fallback helper primitives
- Rewired composition in `functions/index.js`:
  - replaced inline admin access/middleware block with `createAdminAccess({ db, logger: console })`.
  - removed inline billing/monitoring helper implementations and injected extracted module functions into `registerAdminRoutes(...)` via project-id/billing wrappers.
- Added focused regression coverage for new helper modules:
  - `functions/test/admin-access.test.js`
  - `functions/test/admin-metrics.test.js`
  - covers dependency guardrails, admin seed/firestore role resolution and middleware enforcement, monitoring series aggregation behavior, metric error normalization, pricing estimate math, and missing-googleapis failure handling.
- Validation passed:
  - `npm --prefix functions test -- admin-access.test.js admin-metrics.test.js admin-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **2,561 lines** (from 9,019 baseline, ~71.6% reduction).
- Inline route declarations remaining in `functions/index.js`: **0** (`app.get/post/put/delete/patch` registrations).
- Next target chunk: continue G2 blocker closure by decomposing remaining non-route helper domains (weather/cache + repository/utilities + automation condition/action residuals) toward the <1,500 target.

### 2026-03-06 - Chunk 55 (G2 blocker execution: weather/cache helper extraction)

- Continued `functions/index.js` reduction by extracting the weather/cache helper domain into a shared service module:
  - `functions/lib/services/weather-service.js`
  - moved:
    - `callWeatherAPI(...)`
    - `getCachedWeatherData(...)`
- Rewired composition in `functions/index.js`:
  - added `createWeatherService(...)` import.
  - initialized extracted weather service with existing dependencies (`db`, `getConfig`, `incrementApiCount`, `setUserConfig`) and removed inline weather/cache helper bodies.
  - preserved existing route/service call signatures so downstream route modules required no API contract changes.
- Added focused regression coverage for the extracted service:
  - `functions/test/weather-service.test.js`
  - covers dependency guardrails, AU-prioritized geocoding selection, fallback-to-Sydney behavior, cache-hit short-circuit behavior, cache refresh on location change, and timezone persistence updates.
- Validation passed:
  - `npm --prefix functions test -- weather-service.test.js config-mutation-routes-modules.test.js automation-cycle-route-module.test.js read-only-routes-modules.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **2,382 lines** (from 9,019 baseline, ~73.6% reduction).
- Inline route declarations remaining in `functions/index.js`: **0** (`app.get/post/put/delete/patch` registrations).
- Next target chunk: continue G2 blocker closure by extracting residual repository/state/time helper domains from `functions/index.js` toward the <1,500 target.

### 2026-03-06 - Chunk 56 (G2 blocker execution: API metrics helper extraction)

- Continued `functions/index.js` reduction by extracting API metrics/date-key helper domain into a shared service module:
  - `functions/lib/services/api-metrics-service.js`
  - moved:
    - `getDateKey(...)`
    - `getAusDateKey(...)`
    - `incrementApiCount(...)`
    - `incrementGlobalApiCount(...)`
- Rewired composition in `functions/index.js`:
  - added `createApiMetricsService(...)` import.
  - initialized extracted metrics service with existing dependencies (`admin`, `db`, `DEFAULT_TIMEZONE`, `serverTimestamp`, `logger`) and removed inline API metrics/date-key helper bodies.
  - preserved existing downstream call signatures for route modules and external API adapters.
- Added focused regression coverage for extracted service:
  - `functions/test/api-metrics-service.test.js`
  - covers dependency guardrails, date-key generation, per-user transaction increments, global metric increments, userId-null global-only updates, and `FieldValue.increment` fallback behavior.
- Validation passed:
  - `npm --prefix functions test -- api-metrics-service.test.js read-only-routes-modules.test.js routes-integration.test.js --runInBand`
  - `npm --prefix functions run lint`
  - `node scripts/pre-deploy-check.js`
- `functions/index.js` current size after this chunk: **2,327 lines** (from 9,019 baseline, ~74.2% reduction).
- Inline route declarations remaining in `functions/index.js`: **0** (`app.get/post/put/delete/patch` registrations).
- Next target chunk: continue G2 blocker closure by extracting residual repository/state/time helper domains from `functions/index.js` toward the <1,500 target.

---

## 1. Purpose

This document defines a systematic implementation plan to refactor the project for:

1. Expansion to more electricity providers.
2. Expansion to more batteries and inverters.
3. Proper EV integration at production quality with an extensible design.
4. Long-term maintainability, scalability, and delivery safety.
5. Sanity of cost and effectiveness - we don't want unnecessary complexity or API calls etc.
6. Introduce recurring-user monetization with subscription options (weekly or monthly) and entitlement-based access control.

This plan is execution-ready. Work starts when explicitly approved (see Section **14A** for recorded approval status).

---

## 1A. Current State Baseline (Codebase Audit Findings)

This section captures the actual state of the codebase as of 2026-03-04, measured against the refactoring goals. Every claim in the plan should be traceable back to these findings.

### 1A.1 Backend Monolith

- **`functions/index.js`:** 9,019 lines at baseline. Contains **65 Express routes**, **47 inline helper functions**, **2 Cloud Function exports** (`api`, `runAutomation`), and all business logic for **11 distinct domains** (auth, config, automation, pricing, devices, quick control, curtailment, weather, metrics, admin, scheduler).
- **Only ~12% of backend logic has been extracted to modules.** The `functions/lib/` directory contains 1 file (298 lines). The `functions/api/` directory contains 3 files (~913 lines total: `amber.js`, `foxess.js`, `auth.js`).
- Route handlers directly call Firestore, external APIs, and each other. Zero separation of concerns between HTTP transport, business logic, and persistence.
- ✅ **P2 update (2026-03-05):** `functions/index.js` reduced to **7,194 lines** (~20% reduction). **47 routes remain inline**; 8 read-only route modules extracted to `functions/api/routes/` (2,328 lines total). `functions/lib/` expanded to 8 modules (1,114 lines total) covering automation-actions, device-telemetry, pricing-normalization, repositories, billing, and adapters.
- ✅ **P2 update (2026-03-06, verified):** `functions/index.js` reduced to **4,053 lines** (55% reduction from 9,019 baseline). **9 routes remain inline** (admin domain + health); **19 route modules** extracted to `functions/api/routes/` (4,990 lines total). `functions/lib/` expanded to **14 modules** across services/repositories/adapters/billing (2,157 lines total). **9 service modules** in `functions/lib/services/` (1,031 lines). Test suite: **57 suites, 682 tests passing**. Coverage: **50.3% statements, 42.6% branches, 62.4% functions, 51.3% lines**.
- ✅ **P2 update (2026-03-06, latest):** `functions/index.js` reduced to **2,327 lines** (74.2% reduction from 9,019 baseline). **0 inline routes remain**; **21 route modules** extracted to `functions/api/routes/`. `functions/lib/` now contains **21 JS modules** (including **11 services**), with admin access, monitoring/billing, weather/cache, and API metrics helper domains extracted. Full gate validation currently passes with **65 test suites** and **766 tests** (`44` marked `todo`).

### 1A.2 Frontend Monolith

- **16,729 lines of inline JavaScript** are embedded in HTML `<script>` tags across 12 pages. `index.html` alone has ~7,478 lines of inline JS (~9,934 total).
- **`APIClient`** (358 lines) defines methods for 20 endpoints, but inline scripts call **~15 additional endpoints** directly (`/api/quickcontrol/*`, `/api/device/workmode/*`, `/api/inverter/settings`, `/api/user/*`, `/api/admin/*`, `/api/metrics/*`) bypassing the client entirely.
- Auth token retrieval logic is **copy-pasted in 3 places:** `APIClient.request()`, `APIClient.fetch()`, and `FirebaseAuth.fetchWithAuth()`.
- Every page re-defines its own `authenticatedFetch()` wrapper locally; some pages make raw `fetch('/api/...')` calls without any auth header.
- No ES module system, no bundler — everything uses global `<script>` tags and `window.*` globals.
- `pwa-init.js` (59 lines) is fully superseded by `app-shell.js` but still loaded.
- ✅ **Sprint 1 update (2026-03-04):** `pwa-init.js` removed from runtime page includes.
- ✅ **Sprint 1 update (2026-03-04):** API contract baseline now reports **60 APIClient endpoint methods** and **0 inline endpoint gaps** (`docs/API_CONTRACT_BASELINE_MAR26.md`).

### 1A.3 External Integrations (Current)

| Integration | Module | Abstracted? | API Calls In |
|---|---|---|---|
| FoxESS Cloud | `api/foxess.js` (148 lines) | ❌ No adapter interface | 20+ direct `callFoxESSAPI()` calls scattered through `index.js` with vendor-specific paths, work modes, and response parsing |
| Amber Electric | `api/amber.js` (651 lines) | ❌ No adapter interface | Direct calls in index.js; Amber-specific cache keys, rate-limit handling, response shapes |
| Open-Meteo Weather | Inline in `index.js` | ❌ Not even a separate module | Single `callWeatherAPI()` function inlined |
| GCP Monitoring/Billing | Inline in `index.js` | ❌ | Admin-only functions inlined |

**FoxESS coupling is pervasive:** Work modes (`SelfUse`, `ForceCharge`, `ForceDischarge`, `Feedin`, `Backup`) are hardcoded string constants. Scheduler management assumes FoxESS's 8-timeslot model. Real-time variable names (`SoC`, `SoC1`, `SoC_1`, `pvPower`, `batTemperature`, etc.) are matched by literal string comparison. Recently discovered: some inverters return `SoC_1` and `batTemperature_1` (with `_1` suffix) which were not matched, requiring ad-hoc fallback chains.

### 1A.4 Firestore Data Model (Current — Undocumented)

| Path | Purpose | Documented? |
|---|---|---|
| `users/{uid}` | User profile (email, displayName, role, automationEnabled) | Partially |
| `users/{uid}/config/main` | Per-user config (deviceSn, foxessToken, amberApiKey, amberSiteId, timezone, location, systemTopology) | Partially |
| `users/{uid}/automation/state` | Runtime automation state (enabled, lastCheck, activeRule, activeRuleName, inBlackout, clearSegmentsOnNextCycle) | Partially |
| `users/{uid}/rules/{ruleId}` | Automation rules (name, enabled, priority, conditions, action) | Partially |
| `users/{uid}/history/{docId}` | Immutable event log (type, rule, result, timestamp) | Partially |
| `users/{uid}/automationAudit/{auditId}` | Per-cycle audit with ROI snapshot; 7-day TTL | ❌ Missing |
| `users/{uid}/cache/inverter` | Cached FoxESS telemetry; 5-min TTL | ❌ Missing |
| `users/{uid}/cache/inverter-realtime` | Cached full real-time data; 5-min TTL | ❌ Missing |
| `users/{uid}/cache/weather` | Cached weather; 30-min TTL | ❌ Missing |
| `users/{uid}/cache/amber_sites` | Cached Amber sites | ❌ Missing |
| `users/{uid}/cache/amber_current_{siteId}` | Cached current Amber prices; 60s TTL | ❌ Missing |
| `users/{uid}/cache/amber_{siteId}` | Cached historical Amber prices | ❌ Missing |
| `users/{uid}/cache/history_{sn}_{begin}_{end}` | Cached FoxESS history chunks; 30-min TTL | ❌ Missing |
| `users/{uid}/metrics/{YYYY-MM-DD}` | Per-user daily API call counters | ❌ Missing |
| `users/{uid}/quickControl/state` | Quick-control override (type, power, expiresAt) | ❌ Missing |
| `users/{uid}/curtailment/state` | Curtailment state (active, threshold, lastActivated) | ❌ Missing |
| `shared/serverConfig` | Legacy unauthenticated setup config | Partially |
| `metrics/{YYYY-MM-DD}` | Platform-wide daily API counters | ❌ Missing |
| `admin_audit/{docId}` | Admin action audit trail | ❌ Missing |

### 1A.5 Scheduler/Orchestration (Current)

- **Schedule:** `runAutomation` runs every 1 minute via Cloud Scheduler (PubSub).
- **User iteration:** Queries `users` WHERE `automationEnabled == true`. Self-healing migration scan if zero results.
- **Cycle dispatch:** Finds the Express route handler for `POST /api/automation/cycle` from `app._router.stack` and calls it with **mock req/res objects** — zero HTTP overhead but tightly coupled to Express internals and entirely untestable in isolation.
- **Concurrency:** All candidate user cycles run in parallel via `Promise.all`. **No distributed lock.** No per-user locking on `lastCheck` read-check-update. If two scheduler invocations overlap, they can both execute cycles for the same user.
- **Error isolation:** Good — each user runs in its own `try/catch` inside `Promise.all`.
- **Timing risk:** With many users, parallel FoxESS/Amber API calls with 10s timeouts can exceed the 1-minute scheduler interval.
- **Idempotency:** ❌ None. No Firestore transactions guard `lastCheck`. No idempotency keys on cycles.

### 1A.6 Test Infrastructure (Current)

- **Coverage thresholds:** 3% statements, 1% branches, 0.5% functions — effectively unenforced.
- **Coverage scope:** Only collects from `functions/index.js`. Does NOT include `functions/api/*.js` or `functions/lib/*.js`.
- **Unit tests:** 30 files, ~10,187 lines. No shared test utilities or mock factories — each test file re-creates firebase-admin mocks from scratch.
- **Placeholder tests:** `auth-flows.test.js` has no real assertions — just documents what should be tested.
- **Dead npm scripts:** `test:integration`, `test:e2e`, `test:e2e:prod`, `test:all` reference files (`integration-test.js`, `e2e-tests.js`) that do not exist.
- **E2E:** 11 Playwright specs exist (tests/frontend/) but are **not run in CI**.
- **CI gates:** `.github/workflows/qa-checks.yml` has `continue-on-error: true` on lint, security audit, and pre-deploy checks — failures do not block PRs.
- ✅ **Sprint 1 update (2026-03-04):** coverage thresholds were raised to **20%/10%/5%/20%** (statements/branches/functions/lines).
- ✅ **Sprint 1 update (2026-03-04):** coverage scope now includes `functions/api/**/*.js` and `functions/lib/**/*.js`.
- ✅ **Sprint 1 update (2026-03-04):** Playwright frontend E2E is now a hard CI gate.
- ✅ **Sprint 1 update (2026-03-04):** shared Firebase Admin test helper added at `functions/test/helpers/firebase-mock.js`.

### 1A.7 Security Findings

| Finding | Severity | Detail |
|---|---|---|
| Admin role sync gap | Medium | Server code checks `Firestore role` field; security rules check `request.auth.token.admin` custom claim. The role-assignment endpoint sets the Firestore field but **never** calls `admin.auth().setCustomUserClaims()`. These two mechanisms are not synchronized. |
| Pre-auth endpoint exposure | Medium | `validate-keys`, `setup-status`, Amber sites/prices endpoints are accessible without auth via `shared/serverConfig` fallback. Anyone with the API URL can read Amber prices using the shared API key. |
| User self-delete data gaps | Low | `POST /api/auth/cleanup-user` deletes subcollections `config`, `automation`, `rules`, `history`, `notifications`, `metrics` but **misses** `automationAudit`, `quickControl`, `curtailment`, `cache`. The admin-delete path uses `recursiveDelete` correctly. |
| Firestore rules gaps | Low | Five subcollections used in code have no explicit security rules: `cache`, `metrics`, `quickControl`, `curtailment`, `admin_audit`. Safe due to default-deny, but should be explicit. |
| API keys in plaintext | Low | FoxESS/Amber credentials stored as plaintext strings in Firestore. Encrypted at rest by Google but readable by any Admin SDK caller. |
| Hardcoded seed admin | Info | `SEED_ADMIN_EMAIL` is a hardcoded constant. Acceptable for bootstrapping but should be documented. |

### 1A.8 EV Integration (Current)

**No EV/Tesla/vehicle/charger code exists anywhere in `functions/`.** The plan references "test-only" EV integration, but this is entirely greenfield. There are docs referencing Tesla key setup (`docs/TESLA_KEY_SETUP_GUIDE.md`, `docs/TESLA_SIGNED_COMMANDS.md`) and key generation scripts in `scripts/`, but zero backend integration code.

---

## 2. Outcomes and Success Criteria

### 2.1 Product outcomes

1. Add a second electricity provider with minimal custom glue code.
2. Add a second inverter or battery vendor using a common adapter model.
3. Promote EV integration from test-only to production-grade under feature flags.
4. Support recurring user billing with weekly/monthly plans and subscription-aware feature gating.

### 2.2 Engineering outcomes

1. Decompose monolithic backend logic into clear module boundaries.
2. Remove critical contract drift between frontend calls, backend routes, and docs.
3. Enforce hard CI quality gates and meaningful coverage thresholds.
4. Improve scheduler reliability with idempotent, non-overlapping execution.

### 2.3 Measurable targets

1. New provider integration lead time: <= 2 weeks after framework completion.
2. New device adapter integration lead time: <= 3 weeks after framework completion.
3. Core automation path coverage: >= 60% line/branch in critical modules.
4. CI gate enforcement: 100% hard-fail for lint, tests, and contract checks.
5. No high-severity production incidents caused by migration regressions.
6. `functions/index.js` reduced to < 1,500 lines (routing, middleware, and glue only).
7. Zero inline `<script>` blocks exceeding 200 lines in any HTML file.
8. 100% of API calls flow through `APIClient` — zero raw `fetch()` in page scripts.
9. ⏳ Coverage collection includes all source files under `functions/` (not only `index.js`).
10. Subscription billing cycle success rate (weekly + monthly renewals): >= 99.5%.
11. Entitlement enforcement coverage: 100% of paid features guarded by centralized checks.

---

## 3. Scope

### 3.1 In scope

1. Backend architecture refactor.
2. Domain model refactor for multi-provider and multi-asset support.
3. Scheduler and orchestration redesign.
4. Frontend API/state consolidation needed for correctness and persistence.
5. Test and CI/CD hardening.
6. Security and operational readiness improvements.
7. Firestore data model documentation and security rules alignment.
8. Dead code and dead npm script cleanup.
9. ⏳ Device variable name normalization (e.g., `SoC` vs `SoC_1` vs `SoC1`).
10. Subscription billing architecture (weekly/monthly cadence), payment-provider abstraction, and entitlement gating.

### 3.2 Out of scope

1. Full UX redesign unrelated to refactoring goals.
2. Net-new commercial features **other than** recurring subscription billing (e.g., coupons, affiliate/referral systems, complex invoicing workflows).
3. Immediate migration to a new frontend framework.
4. Migration from global `<script>` tags to ES modules or a bundler (can happen later; focus is on extracting inline JS to separate files first).

---

## 4. Program Principles

1. No big-bang rewrite.
2. Backward compatibility first during migration.
3. Prefer dual-read and dual-write transitions where data model changes.
4. Feature-flag all high-risk changes.
5. Use explicit rollback paths for every release.
6. Keep production behavior stable while internals change.

---

## 5. Workstreams

| ID | Workstream | Objective | Main Deliverables |
|---|---|---|---|
| WS-A | Architecture | Establish maintainable backend boundaries | Module split, service interfaces, ADRs |
| WS-B | Data Model | Support multi-provider and multi-asset | v2 schema, migration scripts, compatibility layer |
| WS-C | Tariff Providers | Make electricity provider integrations pluggable | Provider adapter contracts, registry, second provider |
| WS-D | Devices | Make inverter/battery integrations pluggable | Device adapter contracts, capability matrix, second device adapter |
| WS-E | EV | Productionize EV integration with extensibility | EV adapter contract, production rollout, orchestration guards |
| WS-F | Orchestration | Make automation execution safe and scalable | Queue-based cycle execution, locks, idempotency |
| WS-G | Frontend | Remove duplicated client logic and persistence drift | Unified API client usage, deterministic selection state |
| WS-H | Quality | Raise confidence and prevent regressions | Contract tests, integration tests, hard CI gates |
| WS-I | Security | Align auth and admin model, improve secrets posture | Unified role model, policy cleanup, controls |
| WS-J | Observability | Improve operational visibility and reliability | Structured logs, dashboards, alerts, runbooks |
| WS-K | Billing and Entitlements | Monetize safely with recurring plans | Billing adapter contract, subscription model (weekly/monthly), entitlement guards, webhook/idempotency handling |

---

## 6. Phase Plan and Timeline

Assumption: 2-week sprint cadence, one active branch (`RefactoringMar26`) with frequent integration to `main` through PRs.

| Phase | Duration | Objective | Exit Gate |
|---|---:|---|---|
| P0 | 2 weeks | Stabilize delivery baseline and quality controls | G0 |
| P1 | 3 weeks | Finalize target architecture and contracts | G1 |
| P2 | 4 weeks | Decompose backend and extract domain services | G2 |
| P3 | 3 weeks | Harden scheduler and execution orchestration | G3 |
| P4 | 3 weeks | Enable multi-provider and multi-device flows | G4 |
| P5 | 3 weeks | Productionize EV integration | G5 |
| P6 | 2 weeks | Frontend consolidation and final hardening | G6 |

Total planned window: 20 weeks.

---

## 7. Detailed Implementation Backlog

## Phase P0 - Foundation and Controls (Weeks 1-2)

### Objectives

1. Make quality checks enforceable.
2. Remove ambiguity in API contracts.
3. Prepare governance, risk, and migration guardrails.
4. Clean up dead code and broken references.

### Tasks

1. Create authoritative API contract baseline from current implemented routes.
   - **Audit finding:** 65 routes exist; 20 are in `APIClient`, ~15 are called inline from HTML, ~30 are server-only or admin-only. Document all 65 with method, path, auth requirement, and consumer.
2. Identify endpoint drift between frontend client methods and backend routes.
   - **Audit finding:** These endpoints are called from inline HTML but NOT defined in `APIClient`: `/api/quickcontrol/start`, `/api/quickcontrol/end`, `/api/quickcontrol/status`, `/api/device/workmode/get`, `/api/device/workmode/set`, `/api/device/setting/get`, `/api/device/setting/set`, `/api/inverter/settings`, `/api/device/status/check`, `/api/device/battery/soc/get`, `/api/device/battery/soc/set`, `/api/user/init-profile`, `/api/user/delete-account`, `/api/admin/impersonate`, `/api/admin/users`, `/api/metrics/api-calls`.
3. Make CI checks hard-fail (remove soft-fail behavior on critical jobs).
   - **Audit finding:** `.github/workflows/qa-checks.yml` has `continue-on-error: true` on lint, security, and pre-deploy jobs. These must become hard-fail.
4. Set incremental but meaningful coverage thresholds by tier.
   - **Audit finding:** Current thresholds are 3% statements / 1% branches / 0.5% functions — effectively zero. Set meaningful initial targets (e.g., 20% statements, 10% branches for P0, ramping to 60% for critical modules by P2).
5. Fix coverage collection scope.
   - **Audit finding:** `jest.config.js` `collectCoverageFrom` only includes `index.js`. Must also include `api/*.js` and `lib/*.js`.
6. Add contract test harness (frontend call map vs backend/OpenAPI).
7. Remove dead npm scripts.
   - **Audit finding:** `test:integration`, `test:e2e`, `test:e2e:prod`, `test:all` reference nonexistent files (`integration-test.js`, `e2e-tests.js`). Remove or create the missing files.
8. Remove dead/superseded frontend code.
   - **Audit finding:** `pwa-init.js` is fully superseded by `app-shell.js`. `loadApiMetrics()` in `shared-utils.js` has dead code (`normalizeFetchResponse` block at L103-108). `auth-flows.test.js` is a placeholder with no real assertions.
9. ⏳ Wire Playwright E2E tests into CI.
   - **Audit finding:** 11 Playwright spec files exist in `tests/frontend/` but are not referenced in any CI workflow.
10. ⏳ Align docs and runtime/tooling references to current configuration.
    - **Audit finding:** `docs/SETUP.md` schema documentation omits `automationAudit`, `quickControl`, `curtailment`, `metrics`, `admin_audit`, and all `cache/*` subcollections. Node engine in `package.json` says `22` but copilot-instructions.md says `20`.
11. ⏳ Add explicit Firestore security rules for all used collections.
    - **Audit finding:** `cache`, `metrics`, `quickControl`, `curtailment`, `admin_audit` subcollections have no rules. Default-deny is safe but explicit deny rules document intent.
12. ⏳ Establish ADR log and record initial architecture decisions.
13. ⏳ Create risk register with owner, mitigation, and trigger thresholds.
14. ⏳ Define feature-flag and rollback standards for this refactor program.

### Exit Gate G0

1. CI hard gates enforced (lint, tests, security — no `continue-on-error`).
2. API contract baseline published (all 65 routes documented).
3. Frontend-to-backend contract drift inventory complete.
4. Coverage collection includes all source files.
5. Dead scripts and dead code removed.
6. Risk register active with owner + mitigation + trigger thresholds.
7. Refactor governance process approved.

## Phase P1 - Target Architecture and Data Contracts (Weeks 3-5)

### Objectives

1. Define stable contracts before code movement.
2. Lock v2 data model and compatibility plan.
3. Design device variable normalization layer.
4. Define subscription billing/paywall contracts for weekly and monthly plans.

### Tasks

1. Define bounded contexts:
   - API transport layer (Express routes, middleware, response envelopes)
   - automation domain (rule evaluation, condition matching, action dispatch)
   - orchestration (scheduler, cycle lifecycle, locking)
   - provider adapters (tariff fetching, price normalization)
   - device adapters (inverter status, schedule management, work mode control)
   - EV adapters (vehicle status, charge control)
   - repositories (Firestore access patterns, caching layer)
   - **Audit finding:** Current code has zero boundaries. The automation engine (`evaluateRule`, 650+ lines) directly parses FoxESS variable names, Amber response shapes, and weather data inline. The cycle handler (`POST /api/automation/cycle`, 1,000+ lines) mixes HTTP handling, Firestore reads, API calls, rule evaluation, and scheduler segment construction.
2. Define v2 entities and schema conventions:
   - `providerAccounts` — replace flat `amberApiKey`/`amberSiteId` fields on config doc
   - `sites` — support multi-site (Amber supports multiple NMIs per account)
   - `assets` — replace flat `deviceSn`/`foxessToken` with multi-device registry
   - `connections` — link assets to providers to users
   - `automationPolicies` — v2 rule format with provider-agnostic conditions
   - **Audit finding:** Current config shape (`users/{uid}/config/main`) is a flat document with ~15 fields mixing FoxESS config (`deviceSn`, `foxessToken`, `foxessBaseUrl`), Amber config (`amberApiKey`, `amberSiteId`), and general settings (`timezone`, `location`, `automationInterval`). This flat shape cannot support multi-provider or multi-device without redesign.
3. Define legacy compatibility mapping from current single-field config shape.
   - **Audit finding:** Must map: `config.main.foxessToken` → `assets[0].credentials.token`, `config.main.amberApiKey` → `providerAccounts[0].credentials.apiKey`, `config.main.amberSiteId` → `sites[0].externalId`, `config.main.deviceSn` → `assets[0].serialNumber`.
4. Define tariff provider adapter interface and error model.
   - **Audit finding:** Minimum interface must normalize: `getCurrentPrices(userId, siteId) → { buyPriceCentsPerKWh, feedInPriceCentsPerKWh, renewablePercentage?, forecastIntervals[] }`. Must handle Amber-specific quirks (negative feed-in values, 429 rate limits with Retry-After header) behind the adapter.
5. Define device adapter interface and capability matrix.
   - **Audit finding:** Must normalize: `getStatus(userId, assetId) → { soc, batteryTemp, ambientTemp, pvPower, loadPower, gridPower, feedInPower }`. Must abstract: `setSchedule()`, `getSchedule()`, `clearSchedule()`, `setWorkMode()`. FoxESS-specific: 8-timeslot scheduler model, MD5 signature auth, `errno`-based error codes (40402 = rate limit). A second vendor (e.g., GoodWe, Sungrow, Enphase) will have entirely different auth, scheduling, and telemetry models.
   - **Device variable normalization:** Must define a canonical variable name map. Currently the code does ad-hoc fallback chains like `SoC || SoC1 || SoC_1`. The adapter should return normalized names regardless of device firmware version.
6. Define EV adapter interface and command lifecycle model.
   - **Audit finding:** This is greenfield. No existing code to migrate. Design from scratch based on Tesla Fleet API (OAuth2, fleet telemetry, signed commands) and plan for future charger integrations (OCPP, Wallbox API).
7. Define cross-layer validation and error taxonomy.
   - **Audit finding:** Current API uses `{ errno, result, error }` envelope inconsistently. Some endpoints return `{ errno: 0, result: {...} }`, others return `{ success: true/false }`, others return raw Express error responses. Standardize.
8. Define OpenAPI versioning and source-of-truth workflow.
   - **Audit finding:** No OpenAPI spec exists today. The only contract documentation is `docs/API.md` which may be outdated.
9. Define recurring billing data model and cadence policy.
   - minimum entities: `billingCustomers`, `subscriptions`, `entitlements`, `billingEvents`.
   - required billing cadence options: `WEEKLY`, `MONTHLY`.
   - **Audit finding:** Billing/paywall domain is currently absent in backend and data model (greenfield).
10. Define payment adapter interface and webhook/idempotency model.
   - normalize provider events (checkout completed, renewal succeeded/failed, cancellation, chargeback/refund).
   - enforce idempotent webhook processing and replay safety.
   - standardize entitlement transition semantics (active, grace_period, past_due, canceled).

### Exit Gate G1

1. Approved architecture spec with bounded context diagram.
2. Approved interface contracts for provider, device, and EV adapters.
3. Approved v2 schema design with field-level migration mapping.
4. Device variable normalization spec published.
5. Approved migration plan with backward compatibility strategy.
6. Approved billing/paywall contract covering weekly/monthly subscription cadence and entitlement lifecycle.

## Phase P2 - Backend Decomposition (Weeks 6-9)

### Objectives

1. Extract domain logic from route handlers.
2. Replace implicit coupling with explicit service boundaries.
3. Reduce `functions/index.js` from ~9,000 lines to routing-and-glue only (<1,500 lines).

### Tasks

1. Extract automation evaluation into pure domain service modules.
   - **Audit finding:** `evaluateRule()` (650+ lines starting at L7525) and `applyRuleAction()` should move to `lib/automation-engine.js`. `compareValue()` duplicates `compareNumeric()` from `lib/automation-conditions.js` — consolidate. `isTimeInRange()`, `getTimeInTimezone()`, `getUserTime()`, `addMinutes()` duplicate helpers in `lib/automation-conditions.js` — consolidate.
2. Split backend by context — target module structure:
   - `api/routes/config.js` — 7 config routes
   - `api/routes/automation.js` — 12 automation routes
   - `api/routes/device.js` — 16 device/inverter routes
   - `api/routes/admin.js` — 6 admin routes
   - `api/routes/pricing.js` — 4 Amber/pricing routes
   - `api/routes/quickcontrol.js` — 3 quick-control routes
   - `api/routes/scheduler.js` — 3 scheduler routes
   - `api/routes/user.js` — 5 user/auth routes
   - `api/routes/weather.js` — 1 weather route
   - `api/routes/metrics.js` — 1 metrics route
   - `lib/automation-engine.js` — rule evaluation, condition matching
   - `lib/automation-actions.js` — action dispatch, scheduler segment construction
   - `lib/curtailment.js` — curtailment logic (~200 lines currently inline)
   - `lib/cache-manager.js` — unified caching layer (currently scattered across inline functions and amber.js)
   - `lib/time-utils.js` — timezone/time helpers (currently duplicated between index.js and automation-conditions.js)
3. Introduce repository layer for Firestore access.
   - `lib/repositories/user-config.js` — `getUserConfig()`, `saveUserConfig()` with request-scoped memoization
   - `lib/repositories/automation-state.js` — state read/write with transactional guards
   - `lib/repositories/rules.js` — CRUD with validation
   - `lib/repositories/history.js` — append-only event log
   - `lib/repositories/audit.js` — audit entry management with TTL
   - `lib/repositories/metrics.js` — counter increment with transactions (currently `incrementApiCount` and `incrementGlobalApiCount` inline)
   - **Audit finding:** `getUserConfig()` is called in 20+ locations with no memoization. Each call hits Firestore. Add per-request or per-cycle caching.
4. Move integration calls behind adapter interfaces.
   - Extract `callWeatherAPI()` + `getCachedWeatherData()` into `api/weather.js` (currently inline, ~200 lines).
   - Move FoxESS-specific path constants and response parsing out of route handlers.
   - Move admin metrics functions into `api/routes/admin.js` or a dedicated module (~750 lines of GCP Monitoring/Billing code).
5. Remove direct route-stack invocation dependency from scheduler flow.
   - **Audit finding:** `runAutomationHandler()` at L8174 finds the Express route handler for `POST /api/automation/cycle` from `app._router.stack` and calls it with mock `req`/`res` objects. Replace with direct service-layer call: scheduler → `automationService.runCycle(userId, config, cache)`.
6. Fix the deferred module initialization pattern.
   - **Audit finding:** `amber.js`, `foxess.js`, `auth.js` are initialized with `init({ db: null, logger: null, ... })` at module load, then re-initialized at runtime (~L6736). Any code running between initial load and reinitialization uses stale `null` references. Replace with explicit lazy initialization or proper dependency injection.
7. Add consistent error mapping and response envelopes.
   - **Audit finding:** Standardize all routes on `{ errno: 0, result }` for success and `{ errno: N, error: 'message' }` for failure. Currently some endpoints return `{ success: true/false }` or raw error text.
8. Add unit tests for extracted services and repositories.
   - Create shared test utility module with common firebase-admin mocks, Firestore stubs, and fixture factories. Currently every test file creates its own mocks from scratch.
9. ⏳ Add migration compatibility tests for old and new config shapes.

### Exit Gate G2

1. Domain logic runs independently from Express internals.
2. Module boundaries are enforceable and documented.
3. Legacy compatibility behavior validated by tests.
4. `functions/index.js` is under 1,500 lines.
5. No duplicated utility functions across modules.
6. Shared test utilities in place.

## Phase P3 - Orchestration Hardening (Weeks 10-12)

### Objectives

1. Ensure safe execution at scale.
2. Prevent overlap, duplication, and action conflicts.

### Tasks

1. Implement queue-driven per-user automation cycle execution.
   - **Audit finding:** Currently all candidate users cycle in a single `Promise.all` with unbounded parallelism. With many users this risks: exceeding FoxESS/Amber rate limits, exceeding Cloud Function memory/timeout, overwhelming Firestore with concurrent reads. Replace with bounded-concurrency executor (e.g., process N users at a time with backpressure).
2. Add per-user idempotency keys.
   - **Audit finding:** No idempotency mechanism exists. Each cycle should carry a unique cycle ID. Before executing, check if that cycle ID was already processed. This prevents duplicate actions when scheduler invocations overlap.
3. Add execution lock semantics to prevent overlapping cycles.
   - **Audit finding:** The `lastCheck` timestamp is read and written without a transaction. Two concurrent invocations can read the same stale `lastCheck`, both decide to run, and both execute. Solution: use Firestore transactions or a distributed lock document (`users/{uid}/automation/lock` with lease expiry) to serialize cycles.
4. Add bounded concurrency and backpressure controls.
   - Limit parallel user cycles (e.g., 10 at a time instead of unbounded `Promise.all`).
   - Track per-provider API call budget per cycle to avoid rate-limit storms.
5. Add retry policy with jitter and dead-letter handling.
   - Currently failed cycles are logged but never retried. Add configurable retry (1-2 attempts with exponential backoff + jitter) for transient failures (API timeouts, Firestore contention).
6. Decouple scheduler from Express router.
   - **Audit finding (critical):** After P2 extracts domain services, the scheduler should call `automationService.runCycle()` directly instead of fishing for route handlers in `app._router.stack`. This is prerequisite for any orchestration improvement.
7. Add orchestration observability:
   - queue lag (time between schedule trigger and cycle start)
   - cycle duration per user
   - error rates by failure type (API timeout, rate limit, Firestore contention)
   - retry counts
   - skipped-user counts (why: interval not elapsed, blackout, no config, quick-control active)
8. Add integration and failure-path tests for orchestration behavior.
   - Test: overlapping invocations do not duplicate actions.
   - Test: lock acquisition and release under normal and failure conditions.
   - Test: retry behavior with transient failures.
   - Test: backpressure under high user count.

### Exit Gate G3

1. No conflicting overlapping cycle actions in stress tests.
2. Retry and dead-letter behavior validated.
3. Scheduler health dashboards available.
4. `Promise.all` replaced with bounded-concurrency executor.
5. Per-user locking validated under concurrent scheduler invocations.

## Phase P4 - Multi-Provider and Multi-Device Enablement (Weeks 13-15)

### Objectives

1. Prove the adapter architecture with real additional integrations.
2. Extend the adapter model to recurring payments for weekly/monthly subscription plans.

### Tasks

1. Implement provider registry and account-to-site mapping.
   - Replace flat `amberApiKey`/`amberSiteId` on `config/main` with `providerAccounts` collection.
   - Provider registry maps provider type → adapter module.
2. Implement Amber adapter behind tariff provider interface.
   - **Audit finding:** `api/amber.js` (651 lines) has sophisticated caching (multi-layer with gap detection, in-flight dedup via `amberPricesInFlight` Map, TTL-based Firestore caching). This must be preserved during adapter extraction. The adapter wraps this module and normalizes its output.
   - Amber-specific quirks to encapsulate: negative feed-in values (currently negated inline), 429 rate limits with `Retry-After` header, `channelType` field for routing (feedIn vs general vs controlledLoad).
3. Implement canonical persistence for provider and site selection.
4. Integrate second electricity provider through tariff adapter contract.
   - Candidate providers: Octopus Energy AU (growing market share), AGL/Origin (if API available), or a mock provider for testing.
5. Implement asset registry and device capability checks.
   - Replace flat `deviceSn`/`foxessToken` on `config/main` with `assets` collection.
   - Capability matrix should declare: supports scheduled charging, supports work mode switching, supports SoC reading, supports multi-battery, supports EPS/backup mode.
6. Implement FoxESS adapter behind device adapter interface.
   - **Audit finding:** 20+ direct `callFoxESSAPI()` calls in index.js use FoxESS-specific: paths (`/op/v0/device/real/query`), auth (MD5 signature), error codes (errno 40402 = rate limit), work modes (`SelfUse`/`ForceCharge`/`ForceDischarge`), scheduler model (8 timeslots), and variable names. All must be encapsulated.
   - Device variable normalization: map device-specific names (`SoC`, `SoC1`, `SoC_1`, `batTemperature`, `batTemperature_1`) to canonical names (`batterySOC`, `batteryTemp`, etc.) inside the adapter.
7. Integrate second inverter or battery vendor through device adapter contract.
   - Candidate vendors: GoodWe (SEMS API), Sungrow (iSolarCloud API), Enphase (Envoy local API), SolarEdge (monitoring API).
8. Add migration and backfill jobs for existing single-device users.
   - Read legacy flat config → create asset + provider account documents → set compatibility pointer.
9. ⏳ Add end-to-end tests across both providers and both device adapters.
10. Add payment provider integration behind billing adapter contract.
   - Implement normalized billing events (`checkout_completed`, `renewal_succeeded`, `renewal_failed`, `canceled`, `refund`).
   - Implement plan cadence support: `WEEKLY`, `MONTHLY`.
   - Persist canonical subscription state and entitlement transitions.

### Exit Gate G4

1. Two electricity providers work through the same contract.
2. Two device vendors work through the same contract.
3. Existing users continue to function without manual migration steps.
4. Device variable names are normalized regardless of firmware version or vendor.
5. Amber caching sophistication is preserved (no regression in API call efficiency).
6. Billing provider adapter supports weekly/monthly subscriptions with normalized lifecycle events.

## Phase P5 - EV Integration (Weeks 16-18)

### Objectives

1. Build EV integration from scratch with extensible adapter design.

> **Audit correction:** The original plan references "moving EV integration from test-only to production." In reality, **no EV code exists** in the backend (`functions/`). There are Tesla key generation scripts in `scripts/` and documentation in `docs/TESLA_*.md`, but zero API endpoints, zero data model, zero feature flags, zero test code for EV/Tesla. This is entirely greenfield and the timeline should be evaluated accordingly. Three weeks may be tight for a production-grade integration starting from zero.

### Tasks

1. Define EV data model in Firestore:
   - `users/{uid}/vehicles/{vehicleId}` — vehicle registration, auth tokens, capabilities
   - `users/{uid}/vehicles/{vehicleId}/state` — cached vehicle state (SoC, charging status, location)
   - `users/{uid}/vehicles/{vehicleId}/commands/{commandId}` — command audit log with idempotency
2. Implement EV adapter interface:
   - `getVehicleStatus(vehicleId) → { soc, chargingState, chargeLimit, isPluggedIn, isHome }`
   - `startCharging(vehicleId, options) → { commandId, status }`
   - `stopCharging(vehicleId) → { commandId, status }`
   - `setChargeLimit(vehicleId, percent) → { commandId, status }`
   - `wakeVehicle(vehicleId) → { commandId, status }`
3. Implement Tesla Fleet API adapter:
   - OAuth2 flow (partner authentication, user authorization, token storage)
   - Token refresh and revocation lifecycle
   - Fleet telemetry subscription (if using streaming data)
   - Signed command support (using existing key infrastructure from `scripts/generate-tesla-keys.js`)
   - Rate limiting and retry logic
4. Implement feature-flag cohort system.
   - **Audit finding:** No feature-flag infrastructure exists. Must build or adopt a simple flag system (e.g., Firestore document `featureFlags/{flagName}` with user cohort lists or percentage rollout).
5. Implement EV command orchestration controls:
   - Idempotency (prevent duplicate charge/stop commands)
   - Wake → wait → command sequencing (Tesla vehicles must be woken before commands)
   - Cooldown between commands (avoid rapid toggle)
   - Conflict detection (don't start charging while automation is discharging battery)
6. Add EV conditions to automation rules:
   - Vehicle SoC condition (e.g., "start charging when vehicle SoC < 50%")
   - Vehicle location condition (e.g., "only when vehicle is home")
   - Combined conditions (e.g., "charge EV when buy price < 5c AND vehicle SoC < 80%")
7. Add EV telemetry and diagnostics endpoints.
8. Add EV integration tests for auth, command flows, and recovery paths.

### Exit Gate G5

1. EV integration is production-ready under progressive rollout.
2. Operational runbook and alerts are in place.
3. At least one real Tesla vehicle successfully controlled through the adapter.
4. Command idempotency validated (no duplicate commands under concurrent conditions).

## Phase P6 - Frontend Consolidation and Final Hardening (Weeks 19-20)

### Objectives

1. Remove frontend duplication that causes persistence and behavior drift.
2. Extract inline JavaScript from HTML files into maintainable modules.

### Tasks

1. Standardize all pages on shared API client and auth utilities.
   - **Audit finding:** 15+ endpoints are called directly from inline HTML scripts, bypassing `APIClient`. Must add methods for all used endpoints to `APIClient` and replace inline `fetch()` calls.
   - **Audit finding:** Token retrieval logic is copy-pasted in 3 places (`APIClient.request()`, `APIClient.fetch()`, `FirebaseAuth.fetchWithAuth()`). Consolidate to one path.
   - **Audit finding:** Each page defines its own `authenticatedFetch()` wrapper. Remove all local wrappers and use `APIClient` exclusively.
2. Extract inline JavaScript from HTML files.
   - **Audit finding (critical):** 16,729 lines of inline JS across 12 HTML files. Priority extractions:
     - `index.html` → `js/dashboard.js` (~7,478 lines of inline JS)
     - `history.html` → `js/history.js` (~1,627 lines)
     - `settings.html` → `js/settings.js` (~1,341 lines)
     - `roi.html` → `js/roi.js` (~1,100 lines)
     - `admin.html` → `js/admin.js` (~823 lines)
   - Target: no HTML file should have more than 200 lines of inline `<script>`.
   - **Note:** This is a large task. Consider starting inline JS extraction during P2-P3 in parallel with backend work, closing during P6.
3. Remove duplicated site-selection and persistence logic.
4. Consolidate provider and asset selection state handling.
5. Align Firebase SDK usage to one version strategy.
6. Remove dead frontend code.
   - **Audit finding:** `pwa-init.js` is fully superseded by `app-shell.js` `ensurePwaHeadTags()`. Dead code block in `shared-utils.js` `loadApiMetrics()` (L103-108). Triple fallback auth pattern in `loadApiMetrics()` should use `APIClient`.
7. Add frontend contract tests and persistence regression tests.
8. Add missing endpoints to APIClient and verify complete coverage:
   - `/api/quickcontrol/start`, `/api/quickcontrol/end`, `/api/quickcontrol/status`
   - `/api/device/workmode/get`, `/api/device/workmode/set`
   - `/api/device/setting/get`, `/api/device/setting/set`
   - `/api/device/battery/soc/get`, `/api/device/battery/soc/set`
   - `/api/device/battery/forceChargeTime/get`, `/api/device/battery/forceChargeTime/set`
   - `/api/device/status/check`
   - `/api/inverter/settings`, `/api/inverter/report`, `/api/inverter/generation`
   - `/api/inverter/discover-variables`, `/api/inverter/all-data`
   - `/api/ems/list`, `/api/module/list`, `/api/module/signal`, `/api/meter/list`
   - `/api/user/init-profile`, `/api/user/delete-account`
   - `/api/admin/impersonate`, `/api/admin/users`, `/api/admin/platform-stats`
   - `/api/metrics/api-calls`
   - `/api/automation/cycle`, `/api/automation/cancel`, `/api/automation/enable`, `/api/automation/reset`
   - `/api/automation/rule/end`, `/api/automation/rule/update`
   - `/api/automation/audit`, `/api/automation/test`
9. ⏳ Finalize docs and release checklists.
10. Add subscription management and billing status UI flows.
   - expose current plan, cadence, next renewal date, and subscription state.
   - wire frontend to entitlement-aware API responses and graceful downgrade messaging.

### Exit Gate G6

1. Deterministic provider selection persistence across pages.
2. No duplicated low-level fetch/auth wrappers across pages.
3. All API calls go through `APIClient` — zero raw `fetch()` in page scripts.
4. No HTML file has more than 200 lines of inline `<script>`.
5. Release readiness checklist complete.
6. Subscription management UX and entitlement-aware flows validated for both weekly and monthly plans.

---

## 8. Dependency Order

1. P0 must complete before P1.
2. P1 contracts must complete before deep P2 extraction.
3. P3 orchestration work depends on P2 domain extraction (specifically: scheduler must call service layer, not route stack).
4. P4 adapter onboarding depends on P1 interface contracts and P2 adapter infrastructure.
5. P5 EV integration depends on P3 orchestration controls and P4 adapter registry infrastructure.
6. Billing/paywall implementation depends on P1 billing contracts and P4 payment adapter infrastructure.
7. P6 frontend consolidation can begin inline JS extraction in parallel with P2-P3 (no backend dependency for extracting scripts to files). Full P6 closure depends on P4/P5 completing the API surface.
8. **New:** Frontend inline JS extraction (P6 task 2) should start during P2 as a parallel workstream — it is independent of backend changes and the 16,729-line inline JS problem is too large to compress into 2 weeks at the end.

---

## 8A. Parallel Work Opportunities

The following tasks have no cross-phase dependencies and can run in parallel with their officially scheduled phase:

| Task | Can Start During | Officially In |
|---|---|---|
| Extract inline JS from HTML to separate files | P1 | P6 |
| Add missing endpoints to `APIClient` | P0 | P6 |
| Remove dead frontend code (`pwa-init.js`, dead npm scripts) | P0 | P0 |
| Write shared test utilities and mock factories | P0 | P2 |
| Firestore security rules alignment | P0 | P0 |
| Document complete Firestore data model | P0 | P0 |
| Build feature-flag infrastructure | P2 | P5 |
| Draft billing plan catalog + entitlement policy | P1 | P4 |

---

## 9. Definition of Done (DoD)

### 9.1 Ticket-level DoD

1. Behavior implemented and documented.
2. Unit and integration tests added or updated.
3. Contract compatibility checked.
4. Observability added for new critical paths.
5. Rollback note included if behavior is high risk.

### 9.2 Phase-level DoD

1. Exit gate criteria passed.
2. No open P0/P1 severity defects in new flows.
3. Migration and rollback strategy validated in staging.
4. Release checklist signed off.

---

## 10. Quality and CI Policy

1. Fail build on:
   - test failures
   - lint failures
   - contract check failures
   - security check failures above defined threshold
   - **Audit finding:** Currently all of the above have `continue-on-error: true` in `.github/workflows/qa-checks.yml`. P0 must remove this.
2. Enforce coverage thresholds:
   - P0: 20% statements, 10% branches (up from 3%/1%)
   - P2: 40% statements, 25% branches
   - P4+: 60% statements, 40% branches for critical modules (`lib/automation-engine.js`, `lib/automation-conditions.js`, adapters)
   - **Audit finding:** `collectCoverageFrom` in `jest.config.js` only includes `index.js`. Must expand to `['index.js', 'api/**/*.js', 'lib/**/*.js']`.
3. Require integration tests for:
   - automation cycle execution
   - provider adapter calls
   - device action paths
4. Require release-candidate smoke suite before production deploy.
5. Wire Playwright E2E tests into CI pipeline.
   - **Audit finding:** 11 spec files exist; none are run in CI. Add a CI job that starts emulators, serves frontend, and runs Playwright.
6. Establish shared test utilities.
   - **Audit finding:** 30 test files, each creating its own firebase-admin mock. Create `test/helpers/firebase-mock.js` with shared Firestore/Auth stubs and fixture factories.

---

## 11. Migration Strategy

1. Introduce v2 model alongside legacy model.
2. Use dual-read first:
   - read v2 if present, fallback to legacy.
3. Use dual-write where practical during transition.
4. Backfill existing users to v2 in controlled batches.
5. Track migration metrics:
   - migration success rate
   - fallback read rate
   - regression count
6. Decommission legacy paths only after stability window and zero fallback trend.

---

## 12. Release and Rollback Strategy

1. Rollout stages:
   - internal users
   - small beta cohort
   - progressive rollout
   - full rollout
2. Rollback triggers:
   - elevated error rates
   - scheduler conflict detection
   - contract mismatch incidents
3. Rollback actions:
   - disable feature flags
   - route traffic to stable path
   - suspend migration jobs
   - execute rollback runbook

---

## 13. Risk Register (Audit-Informed)

| # | Risk | Owner | Likelihood | Impact | Mitigation | Trigger Threshold | Source |
|---|---|---|---|---|---|---|---|
| R1 | Migration regressions for existing users | Data Migration Lead | Medium | High | Dual-read/write, canary migrations, rollback flags | Fallback-read rate > 5% for 24h after a migration batch, or batch failure rate > 1% | Plan |
| R2 | Adapter abstraction complexity delays delivery | Architecture Lead | Medium | Medium | Keep interfaces minimal, prioritize contract-first MVP | P2 extraction slips by > 1 sprint, or 3+ unresolved interface disputes remain open > 7 days | Plan |
| R3 | Scheduler race conditions persist | Backend Orchestration Lead | High | High | Idempotency keys, Firestore transaction locks, bounded concurrency, failure tests | Any duplicate cycle execution for same user within 60s, or scheduler error rate > 1% daily | Audit: no locking, no idempotency, no transactions on lastCheck |
| R4 | Frontend drift returns after refactor | Frontend Lead | Medium | Medium | Single API client policy, contract tests, lint rules | Any new raw `fetch('/api/...')` in page scripts, or contract drift check failure in CI | Plan |
| R5 | Documentation drifts from implementation | Documentation Owner | High | Medium | Docs update required in PR checklist, periodic doc audits | 2 consecutive API/schema PRs merged without docs updates in same PR | Audit: SETUP.md missing 10+ collections |
| R6 | P5 EV timeline too aggressive | EV Workstream Lead | High | Medium | Re-scope P5 to MVP (one vehicle, one command type); extend to 4-5 weeks if needed | Fleet auth/command MVP not proven by end of P4, or P5 scope grows > 20% from MVP | Audit: zero existing EV code and P5 is greenfield |
| R7 | Frontend inline JS extraction scale | Frontend Refactor Lead | High | Medium | Start during P2 as parallel workstream; prioritize `index.html` (7,478 lines) first | Extraction throughput < 1,500 inline JS lines per sprint for 2 consecutive sprints | Audit: 16,729 lines of inline JS across 12 files |
| R8 | FoxESS adapter extraction breaks caching | Device Adapter Lead | Medium | High | Extract caching layer first, add regression tests before moving adapter code | Cache hit rate drops > 20%, or FoxESS API calls/user/day increase > 30% after extraction | Audit: Amber caching has multi-layer gap detection and in-flight dedup |
| R9 | Admin role model inconsistency | Auth/Security Lead | Medium | Medium | Synchronize Firestore `role` and custom claims in one migration; test both paths | Any mismatch detected between Firestore role and auth custom claim in audit script/tests | Audit: server checks Firestore, rules check custom claims |
| R10 | Pre-auth endpoint data leakage | Security Lead | Low | Medium | Add rate limiting to unauthenticated endpoints; consider requiring auth for price data | Unauthenticated price endpoint traffic grows > 50% above baseline, or abuse alert is raised | Audit: Amber prices accessible without auth via shared config |
| R11 | Device variable name fragmentation | Device Integration Lead | Medium | Medium | Build canonical variable map in device adapter; regression test all known variants | New firmware alias observed without map update, or > 2 variable-parse incidents/day | Audit: SoC/SoC1/SoC_1 and batTemperature/batTemperature_1 already caused issues |
| R12 | User data cleanup gaps | User Lifecycle Lead | Low | Low | Align `cleanup-user` with `deleteUserDataTree`; test all subcollections are cleaned | Any regression test failure proving incomplete subtree cleanup, or cleanup incident ticket | Audit: cleanup-user previously missed 4 subcollections |

---

## 14. Governance and Execution Cadence

1. Weekly architecture review:
   - ADR approvals
   - interface changes
   - migration risk decisions
2. Twice-weekly implementation sync:
   - blocker review
   - dependency alignment
3. Sprint planning and sprint review every 2 weeks.
4. Go/no-go release review for each phase gate.

## 14A. Execution Approval Log

| Date | Phase/Gate | Status | Approver | Notes |
|---|---|---|---|---|
| 2026-03-04 | P0 / G0 execution start | Missing formal sign-off record | TBD | Sprint 1 execution began and completed; approval evidence needs explicit in-repo entry. |
| 2026-03-04 | G1 prerequisite governance update | In progress | RefactoringMar26 owner | Formal named approver + date must be recorded before G1 close. |
| 2026-03-05 | P1 / G1 execution continuation | Approved (recorded) | Stealth928 | User-directed continuation of implementation work recorded in chat; used as explicit execution approval evidence. |

---

## 15. Sprint 1 Starter Backlog (Ready to run)

Use this exact backlog when execution begins.
Status key: ✅ = done, ⏳ = pending.

### CI and Quality Gates
1. ✅ [DONE 2026-03-04] Remove `continue-on-error: true` from lint, security, and pre-deploy jobs in `.github/workflows/qa-checks.yml`.
2. ✅ [DONE 2026-03-04] Expand `collectCoverageFrom` in `functions/jest.config.js` to include `api/**/*.js` and `lib/**/*.js`.
3. ✅ [DONE 2026-03-04] Raise coverage thresholds from 3%/1%/0.5% to 20%/10%/5%.
4. ✅ [DONE 2026-03-04] Remove dead npm scripts in `functions/package.json`: `test:integration`, `test:e2e`, `test:e2e:prod`, `test:all` (or create the missing files).  
   Note: also removed `test:e2e:auth` because it referenced missing `e2e-tests.js`.
5. ✅ [DONE 2026-03-04] Add Playwright E2E job to CI workflow.

### API Contract Baseline
6. ✅ [DONE 2026-03-04] Build authoritative backend route inventory: all backend routes with method, path, auth requirement, handler location, and consumer (APIClient/inline/server-only).  
   Output: `docs/API_CONTRACT_BASELINE_MAR26.md` (currently 73 routes).
7. ✅ [DONE 2026-03-04] Document the 15+ endpoints called from inline HTML that are missing from `APIClient`.  
   Output: `docs/API_CONTRACT_BASELINE_MAR26.md` (initially 38 inline paths missing; now 0 after item 21).
8. ✅ [DONE 2026-03-04] Add contract mismatch checks between frontend API client and backend routes.  
   Implementation: `scripts/api-contract-baseline.js` + hard gate in `scripts/pre-deploy-check.js`.

### Dead Code and Cleanup
9. ✅ [DONE 2026-03-04] Remove `frontend/js/pwa-init.js` (superseded by `app-shell.js`).
10. ✅ [DONE 2026-03-04] Remove dead code block in `shared-utils.js` `loadApiMetrics()` (L103-108).
11. ✅ [DONE 2026-03-04] Fix `auth-flows.test.js` — marked planned coverage scenarios as explicit `test.todo()` entries.

### Documentation and Security
12. ✅ [DONE 2026-03-04] Document complete Firestore data model (all 20+ paths from Section 1A.4).
13. ✅ [DONE 2026-03-04] Add explicit Firestore security rules for `cache`, `metrics`, `quickControl`, `curtailment`, `admin_audit` subcollections.
14. ✅ [DONE 2026-03-04] Synchronize admin role: update `POST /api/admin/users/:uid/role` to also call `admin.auth().setCustomUserClaims()`.
15. ✅ [DONE 2026-03-04] Fix `POST /api/auth/cleanup-user` to include missing subcollections: `automationAudit`, `quickControl`, `curtailment`, `cache`.

### Governance
16. ✅ [DONE 2026-03-04] Publish ADR-001 (target architecture boundaries).
17. ✅ [DONE 2026-03-04] Publish ADR-002 (v2 data model and migration strategy).
18. ✅ [DONE 2026-03-04] Create migration safety checklist and rollback checklist templates.
19. ✅ [DONE 2026-03-04] Add phase gate dashboard issue tracker (`P0`, `G0` labels).

### Parallel Frontend Prep (can start immediately)
20. ✅ [DONE 2026-03-04] Create `test/helpers/firebase-mock.js` with shared test utilities.
21. ✅ [DONE 2026-03-04] Begin adding missing endpoint methods to `APIClient` (non-breaking, additive).

---

## 16. Start Protocol

When execution is approved, run phases in order:

1. Start with `P0`.
2. Pass `G0` before opening `P1`.
3. Do not run full migration jobs before `P2` and `P3` stability tests pass.
4. Keep all high-risk changes behind feature flags until gate approval.

---

## 17. Change Log

| Date | Change | Author |
|---|---|---|
| 2026-03-04 | Initial execution-ready refactoring implementation plan created | Codex |
| 2026-03-04 | Deep codebase audit and plan review: added Section 1A (Current State Baseline) with 8 subsections covering backend monolith (9,019 lines), frontend monolith (16,729 lines inline JS), external integrations (4, zero abstraction), Firestore data model (20+ paths, 10+ undocumented), scheduler gaps (no locking/idempotency), test infra (3% thresholds, dead scripts, no E2E in CI), security findings (6 issues), and EV greenfield reality. Amended all phases (P0-P6) with specific audit-backed tasks and findings. Updated risk register from 5 to 12 items with severity sourced from audit. Updated measurable targets with 4 additional metrics. Expanded Sprint 1 backlog from 8 to 21 items. Added Section 8A (Parallel Work Opportunities), Section 18 (Target Module Structure), and Section 19 (Timeline Realism Assessment). | Copilot |
| 2026-03-04 | Execution started. Completed Sprint 1 CI/quality items 1-4: removed soft-fail CI flags (`qa-checks.yml`), expanded Jest coverage scope to `api/**/*.js` and `lib/**/*.js`, raised coverage thresholds to 20/10/5/20, removed dead test scripts in `functions/package.json` (including extra cleanup of `test:e2e:auth`). Verified with pre-deploy check, lint, and coverage run (23.14% statements, 19.02% branches, 28.73% functions, 24.02% lines). | Codex |
| 2026-03-04 | Completed Sprint 1 item 5 by wiring Playwright E2E into CI as a hard gate (`frontend-e2e` job). Added root `test:e2e:frontend` script and made deployment readiness depend on E2E success. Stabilized flaky frontend E2E assertions in `dashboard.spec.js`, `control.spec.js`, and `history.spec.js` for CI reliability. | Codex |
| 2026-03-04 | Completed Sprint 1 API contract baseline items 6-8. Added automated contract scanner (`scripts/api-contract-baseline.js`) that inventories backend routes, APIClient endpoints, and inline HTML endpoint usage; generated `docs/API_CONTRACT_BASELINE_MAR26.md`; documented 38 inline endpoint paths missing from APIClient; and added contract mismatch hard-gate execution in `scripts/pre-deploy-check.js`. | Codex |
| 2026-03-04 | Completed Sprint 1 dead-code/cleanup items 9-11. Removed superseded `frontend/js/pwa-init.js` and its last include, removed dead `loadApiMetrics()` no-op block in `frontend/js/shared-utils.js`, and converted `functions/test/auth-flows.test.js` into explicit `test.todo()` coverage plan entries. Verified via targeted auth test and full pre-deploy gate. | Codex |
| 2026-03-04 | Completed Sprint 1 documentation/security items 12-15. Updated `docs/SETUP.md` with full current Firestore schema inventory; added explicit Firestore rules for `users/{uid}/cache`, `users/{uid}/metrics`, `users/{uid}/quickControl`, `users/{uid}/curtailment`, and `admin_audit`; synchronized admin role updates to custom claims in `POST /api/admin/users/:uid/role`; and switched `POST /api/auth/cleanup-user` to shared recursive delete for full subcollection coverage. Added regression tests in `functions/test/admin.test.js` and new `functions/test/cleanup-user.test.js`. | Codex |
| 2026-03-04 | Completed Sprint 1 governance items 16-19. Published ADR-001 (target architecture boundaries) and ADR-002 (v2 data model + migration strategy), added migration and rollback checklist templates, and added a phase-gate dashboard plus issue template for `P0`/`G0` tracking. Updated `docs/INDEX.md` with these new governance artifacts. | Codex |
| 2026-03-04 | Completed Sprint 1 parallel frontend prep items 20-21. Added shared Firebase Admin test harness (`functions/test/helpers/firebase-mock.js`) and migrated `admin.test.js` + `cleanup-user.test.js` to use it. Expanded APIClient endpoint coverage and refreshed baseline report to 60 APIClient methods with 0 inline endpoint gaps. | Codex |
| 2026-03-04 | Started P1/G1 contract artifacts. Added `docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md` (bounded contexts, adapter interfaces, variable normalization, error taxonomy) and `docs/openapi/openapi.v1.yaml` as the OpenAPI source-of-truth baseline. Updated phase dashboard status: P0/G0 completed, P1/G1 in progress. | Codex |
| 2026-03-04 | Applied verification follow-ups: corrected P1 tracker progress, upgraded Section 13 risk register with owner + trigger-threshold columns, added Section 14A execution approval log, and annotated stale Section 1A baseline items with Sprint 1 completion notes. | Codex |
| 2026-03-05 | Completed P1 follow-up chunk for contract hardening: added implementation-ready legacy-to-v2 field mapping rules (deterministic IDs, field-level transforms, dual-read/dual-write guidance) to `docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md`; added `scripts/openapi-contract-check.js` for OpenAPI syntax + path/method parity + duplicate operationId validation; and wired the new check into `scripts/pre-deploy-check.js` and root script `openapi:check`. | Codex |
| 2026-03-05 | Updated target-state objectives to include recurring subscription billing/paywall support (weekly/monthly cadence). Extended P1 with billing contract tasks, added billing workstream and measurable targets, and scheduled implementation expectations across P4/P6 without invalidating completed P0/P1 refactor work. | Codex |
| 2026-03-05 | Implemented P1 billing contract scaffolding in backend code: added payment adapter contract module, entitlement derivation utilities, webhook idempotency helpers, and dedicated unit tests to make the weekly/monthly billing contract executable and regression-checked before payment-provider integration work. | Codex |
| 2026-03-05 | Extracted device telemetry variable normalization into `functions/lib/device-telemetry.js` and wired `evaluateRule()` to shared parsing (`parseAutomationTelemetry`) to remove inline alias coupling. Added regression tests in `functions/test/device-telemetry.test.js` and passed lint/test validation. | Codex |
| 2026-03-05 | Locked P2 backend decomposition kickoff sequence in `docs/P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md`, and updated architecture/index docs (`docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md`, `docs/INDEX.md`) to track executable refactor artifacts and sequencing guardrails. | Codex |
| 2026-03-05 | Updated governance records for active P1 execution: captured explicit named approver evidence in Section 14A and aligned execution-authorization status wording to reflect recorded in-repo approval for continuation work. | Codex |
| 2026-03-05 | Completed P2 Wave 1 step 1 extraction: centralized Amber current-interval parsing in `functions/lib/pricing-normalization.js`, rewired automation and curtailment call sites in `functions/index.js`, added `functions/test/pricing-normalization.test.js`, and validated with full pre-deploy checks. | Codex |
| 2026-03-05 | Completed P2 Wave 1 step 2 extraction: moved scheduler segment/group construction logic into `functions/lib/automation-actions.js`, rewired `applyRuleAction()` to shared helpers, added `functions/test/automation-actions.test.js`, and validated with full pre-deploy checks. | Codex |
| 2026-03-05 | Continued P2 Wave 2 extraction by moving core inverter read-only GET handlers into `functions/api/routes/inverter-read.js`, rewiring composition in `functions/index.js`, expanding supertest coverage in `functions/test/read-only-routes-modules.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-05 | Continued P2 Wave 2 step 3 by extracting `/api/inverter/history` and history cache helpers into `functions/api/routes/inverter-history.js`, wiring route composition in `functions/index.js`, expanding route-module supertest coverage, and validating all contract/pre-deploy gates. | Codex |
| 2026-03-05 | Continued P2 Wave 2 step 3 by extracting additional device read-only endpoints into `functions/api/routes/device-read.js`, wiring registration in `functions/index.js`, adding route-module tests for device/module/workmode/diagnostic reads, and validating all quality and contract gates. | Codex |
| 2026-03-05 | Continued P2 Wave 2 step 3 by extracting diagnostics read endpoints into `functions/api/routes/diagnostics-read.js`, wiring registration in `functions/index.js`, extending route-module tests for device-setting/all-data diagnostic reads, and patching extracted route logging calls (`logger.log` -> `console.log`) to match runtime logger capabilities. | Codex |
| 2026-03-05 | Continued P2 Wave 2 step 3 by extracting scheduler read route `/api/scheduler/v1/get` into `functions/api/routes/scheduler-read.js`, wiring module registration in `functions/index.js`, extending read-route module supertest coverage for defaults/device-source paths, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Began P2 Wave 3 step 1 by extracting scheduler mutation routes into `functions/api/routes/scheduler-mutations.js`, wiring module registration in `functions/index.js`, adding dedicated supertest coverage for `/api/scheduler/v1/set` and `/api/scheduler/v1/clear-all`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Hardened local emulator reset reliability after Windows launcher failures: updated `scripts/emulator-cli.js` to use a resilient detached launch chain (`cmd /c npx ...` then `cmd /c npm exec -- ...`), documented the incident and fallback workflow in `docs/LOCAL_DEV_KNOWN_ISSUES.md` and `docs/SETUP.md`, and re-verified local reset/status/setup-health flows. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 1 by extracting config mutation routes into `functions/api/routes/config-mutations.js`, wiring module registration in `functions/index.js`, adding focused supertest coverage in `functions/test/config-mutation-routes-modules.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 1 by extracting automation mutation routes into `functions/api/routes/automation-mutations.js` (toggle/enable/trigger/reset/cancel/rule CRUD/test), wiring module registration in `functions/index.js`, adding focused supertest coverage in `functions/test/automation-mutation-routes-modules.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Completed P2 Wave 3 step 1 by extracting `POST /api/automation/cycle` into `functions/api/routes/automation-cycle.js`, wiring `registerAutomationCycleRoute(...)` in `functions/index.js`, adding focused route-module tests in `functions/test/automation-cycle-route-module.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared scheduler segment-clear service `functions/lib/services/scheduler-segment-service.js`, rewiring automation/scheduler mutation and cycle routes to use it, adding focused service coverage in `functions/test/scheduler-segment-service.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared audit-evaluation service `functions/lib/services/automation-audit-service.js`, rewiring `functions/api/routes/automation-cycle.js` to consume it, adding focused service coverage in `functions/test/automation-audit-service.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared ROI house-load service `functions/lib/services/automation-roi-service.js`, rewiring `functions/api/routes/automation-cycle.js` to consume it, adding focused service coverage in `functions/test/automation-roi-service.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by extracting ROI charge/discharge revenue estimation into shared helper `calculateRoiEstimate(...)` in `functions/lib/services/automation-roi-service.js`, rewiring `functions/api/routes/automation-cycle.js`, expanding `functions/test/automation-roi-service.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by extracting ROI snapshot assembly into shared helper `buildRoiSnapshot(...)` in `functions/lib/services/automation-roi-service.js`, rewiring `functions/api/routes/automation-cycle.js`, expanding `functions/test/automation-roi-service.test.js`, and re-validating lint + contract + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared automation-cycle data-fetch service `functions/lib/services/automation-cycle-data-service.js` (inverter cache + realtime fallback, Amber sites/current-price fetch with in-flight de-dup), rewiring `functions/api/routes/automation-cycle.js`, adding focused service coverage in `functions/test/automation-cycle-data-service.test.js`, and re-validating lint + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared automation-cycle blackout/weather helper service `functions/lib/services/automation-cycle-rule-service.js` (blackout-window evaluation + weather fetch planning), rewiring `functions/api/routes/automation-cycle.js`, adding focused coverage in `functions/test/automation-cycle-rule-service.test.js`, and re-validating lint + pre-deploy gates. | Codex |
| 2026-03-06 | Updated `frontend/settings.html` automation/cache timing controls to seconds-based UX (`sec` units), implemented explicit UI-seconds↔API-milliseconds conversion helpers for load/change/save/reset paths, aligned automation FAQ wording with the new units, and expanded frontend persistence tests to assert ms payload translation plus unit/FAQ consistency (`tests/frontend/settings-persistence.spec.js`, `tests/frontend/settings.spec.js`). | Codex |
| 2026-03-06 | Fixed credentials save flow in `frontend/settings.html` to handle masked hidden tokens safely: when token is unchanged-but-hidden and no in-memory actual value exists, avoid posting placeholder characters to `/api/config/validate-keys`; persist editable credential fields via authenticated `/api/config` merge and refresh badge/status from server state. | Codex |
| 2026-03-06 | Repaired UTF-8 text/icon rendering in `frontend/settings.html` after mojibake corruption (navigation labels, section headers, FAQ icons, status/action glyphs), then re-ran frontend settings Playwright suites (`tests/frontend/settings.spec.js`, `tests/frontend/settings-persistence.spec.js`) to confirm rendering and persistence behavior remained stable. | Codex |
| 2026-03-06 | Updated settings timing minute conversion display to one-decimal precision in `frontend/settings.html` (`formatMs` minute branch now `toFixed(1)`), aligned initial timing badges (`1.0m`/`5.0m`/`30.0m`), and expanded `tests/frontend/settings-persistence.spec.js` with explicit minute-display assertions. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared rule-loop lifecycle/cooldown helpers in `functions/lib/services/automation-cycle-lifecycle-service.js`, rewiring `functions/api/routes/automation-cycle.js` to use the shared cooldown/state builders, adding focused coverage in `functions/test/automation-cycle-lifecycle-service.test.js`, and re-validating lint + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared segment-clear retry/cancellation helper `clearSchedulerSegmentsWithRetry(...)` in `functions/lib/services/scheduler-segment-service.js`, rewiring the active-rule cancellation path in `functions/api/routes/automation-cycle.js`, extending `functions/test/scheduler-segment-service.test.js`, and re-validating lint + pre-deploy gates. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 by introducing shared one-shot segment-clear/pacing helper `clearSchedulerSegmentsOneShot(...)` in `functions/lib/services/scheduler-segment-service.js`, rewiring disable/disable-flag + preemption clear paths in `functions/api/routes/automation-cycle.js`, extending `functions/test/scheduler-segment-service.test.js`, adding clear-flag branch coverage in `functions/test/automation-cycle-route-module.test.js`, and re-validating lint + targeted backend tests. | Codex |
| 2026-03-06 | Continued P2 Wave 3 step 2 residual helper extraction by introducing shared action/persist helpers `applyTriggeredRuleAction(...)` and `persistTriggeredRuleState(...)` in `functions/lib/services/automation-cycle-action-service.js`, rewiring duplicated trigger branches in `functions/api/routes/automation-cycle.js`, adding focused coverage in `functions/test/automation-cycle-action-service.test.js`, and re-validating lint + targeted backend tests. | Codex |
| 2026-03-06 | Continued implementation by drafting P2/G2 closeout evidence in `docs/P2_G2_CLOSEOUT_EVIDENCE_MAR26.md`, updating phase-gate/index tracker references, running contract/lint/pre-deploy validations, and reducing residual helper duplication by extracting shared `toFiniteNumber(...)` utility to `functions/lib/services/number-utils.js` with focused coverage in `functions/test/number-utils.test.js`. | Codex |
| 2026-03-06 | Continued G2 blocker execution by removing scheduler route-stack coupling: `registerAutomationCycleRoute(...)` now returns `automationCycleHandler` (`functions/api/routes/automation-cycle.js`) and `runAutomationHandler(...)` now invokes that handler reference directly instead of traversing `app._router.stack` (`functions/index.js`), with targeted route/integration regression coverage and lint validation. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting public setup/auth endpoints (`/api/auth/forgot-password`, `/api/config/validate-keys`, `/api/config/setup-status`) into `functions/api/routes/setup-public.js`, wiring `registerSetupPublicRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/setup-public-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting protected auth lifecycle endpoints (`/api/health/auth`, `/api/auth/init-user`, `/api/auth/cleanup-user`) into `functions/api/routes/auth-lifecycle.js`, wiring `registerAuthLifecycleRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/auth-lifecycle-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting quick-control endpoints (`/api/quickcontrol/start`, `/api/quickcontrol/end`, `/api/quickcontrol/status`) into `functions/api/routes/quick-control.js`, wiring `registerQuickControlRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/quick-control-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting automation history/audit endpoints (`/api/automation/history`, `/api/automation/audit`) into `functions/api/routes/automation-history.js`, wiring `registerAutomationHistoryRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/automation-history-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting device mutation endpoints (`/api/device/battery/soc/set`, `/api/device/setting/set`, `/api/device/battery/forceChargeTime/set`, `/api/device/workmode/set`) into `functions/api/routes/device-mutations.js`, wiring `registerDeviceMutationRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/device-mutation-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting config/status read endpoints (`/api/config`, `/api/config/system-topology`, `/api/config/tour-status`, `/api/automation/status`) into `functions/api/routes/config-read-status.js` and self-service user endpoints (`/api/user/init-profile`, `/api/user/delete-account`) into `functions/api/routes/user-self.js`, wiring both registrations in `functions/index.js`, adding focused module coverage in `functions/test/config-read-status-routes-modules.test.js` and `functions/test/user-self-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting the full admin route domain (`/api/admin/firestore-metrics`, `/api/admin/users`, `/api/admin/platform-stats`, `/api/admin/users/:uid/role`, `/api/admin/users/:uid/delete`, `/api/admin/users/:uid/stats`, `/api/admin/impersonate`, `/api/admin/check`) into `functions/api/routes/admin.js`, wiring `registerAdminRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/admin-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting `GET /api/health` into `functions/api/routes/health.js`, wiring `registerHealthRoutes(...)` in `functions/index.js`, adding focused module coverage in `functions/test/health-routes-modules.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting residual admin helper domains into `functions/lib/admin-access.js` and `functions/lib/admin-metrics.js`, rewiring `functions/index.js` to compose admin middleware + billing/monitoring helpers via shared modules, adding focused helper coverage in `functions/test/admin-access.test.js` and `functions/test/admin-metrics.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting weather/cache helpers into `functions/lib/services/weather-service.js`, rewiring `functions/index.js` to compose `callWeatherAPI(...)` and `getCachedWeatherData(...)` via `createWeatherService(...)`, adding focused coverage in `functions/test/weather-service.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |
| 2026-03-06 | Continued G2 blocker execution by extracting API metrics/date helpers into `functions/lib/services/api-metrics-service.js`, rewiring `functions/index.js` to compose `getDateKey(...)`, `getAusDateKey(...)`, `incrementApiCount(...)`, and `incrementGlobalApiCount(...)` via `createApiMetricsService(...)`, adding focused coverage in `functions/test/api-metrics-service.test.js`, and re-validating targeted tests, lint, and full pre-deploy checks. | Codex |

---

## 18. Target Module Structure (Post-P2)

```
functions/
├── index.js                          # < 1,500 lines: Express app, middleware, route mounting, exports
├── package.json
├── jest.config.js
├── api/
│   ├── amber.js                      # Amber Electric API client (existing, to be wrapped by adapter)
│   ├── foxess.js                     # FoxESS Cloud API client (existing, to be wrapped by adapter)
│   ├── auth.js                       # Firebase Auth middleware (existing)
│   ├── weather.js                    # Open-Meteo API client (extract from index.js)
│   └── routes/
│       ├── config.js                 # 7 config routes
│       ├── automation.js             # 12 automation routes
│       ├── device.js                 # 16 device/inverter routes
│       ├── admin.js                  # 6 admin routes + GCP monitoring code
│       ├── pricing.js                # 4 pricing routes
│       ├── quickcontrol.js           # 3 quick-control routes
│       ├── scheduler.js              # 3 FoxESS scheduler routes
│       ├── user.js                   # 5 user/auth routes
│       ├── weather.js                # 1 weather route
│       └── metrics.js                # 1 metrics route
├── lib/
│   ├── automation-conditions.js      # Condition evaluation (existing, to be extended)
│   ├── automation-engine.js          # Rule evaluation + action dispatch (extract from index.js)
│   ├── automation-actions.js         # Scheduler segment construction (extract from index.js)
│   ├── curtailment.js                # Curtailment logic (extract from index.js)
│   ├── cache-manager.js              # Unified caching layer
│   ├── time-utils.js                 # Timezone/time helpers (consolidate duplicates)
│   ├── logger.js                     # Structured logger (extract from index.js)
│   ├── adapters/
│   │   ├── tariff-provider.js        # Interface definition
│   │   ├── amber-adapter.js          # Amber implementation
│   │   ├── device-adapter.js         # Interface definition
│   │   ├── foxess-adapter.js         # FoxESS implementation
│   │   ├── ev-adapter.js             # Interface definition (P5)
│   │   └── tesla-adapter.js          # Tesla implementation (P5)
│   └── repositories/
│       ├── user-config.js            # Config CRUD with memoization
│       ├── automation-state.js       # State read/write with transactions
│       ├── rules.js                  # Rule CRUD with validation
│       ├── history.js                # Append-only event log
│       ├── audit.js                  # Audit entries with TTL
│       └── metrics.js                # Counter management
└── test/
    ├── helpers/
    │   ├── firebase-mock.js          # Shared Firestore/Auth mock factory
    │   └── fixtures.js               # Test data factories
    └── ... (existing + new test files)
```

---

## 19. Timeline Realism Assessment

| Phase | Original | Revised Assessment | Concern |
|---|---|---|---|
| P0 | 2 weeks | 2 weeks | Achievable. Sprint 1 backlog is well-defined with 21 concrete items. |
| P1 | 3 weeks | 3 weeks | Achievable. Contract design is mostly documentation work. |
| P2 | 4 weeks | **5-6 weeks ⚠️** | Extracting 7,500+ lines from a 9,019-line monolith into 15+ modules while maintaining backward compatibility is higher effort than 4 weeks. The deferred initialization pattern and scheduler-to-router coupling add complexity. Consider splitting into P2a (extract services/repos) and P2b (extract routes/adapters). |
| P3 | 3 weeks | 3 weeks | Achievable once P2 decouples scheduler from Express router. |
| P4 | 3 weeks | 3-4 weeks | Achievable if second provider/device has a well-documented API. Risk: discovering a second vendor's API is poorly documented. |
| P5 | 3 weeks | **4-5 weeks ⚠️** | Greenfield from zero. Tesla Fleet API has complex auth (partner tokens, user tokens, fleet keys, signed commands). Three weeks is aggressive for production-grade starting from nothing. Recommend MVP scope: one command (start/stop charging), no fleet telemetry, basic auth flow. |
| P6 | 2 weeks | **3-4 weeks ⚠️** | 16,729 lines of inline JS extraction is a large, error-prone task even with no logic changes. Mitigated by starting extraction during P2 as a parallel workstream. If parallel extraction is done, 2 weeks for final P6 is achievable. |

**Revised total:** 22-27 weeks (vs original 20 weeks). Recommend planning for 24 weeks with 2-week buffer.

**Critical path mitigation:** Start frontend inline JS extraction during P2 (parallel). Start feature-flag infrastructure during P2. Start EV research/prototyping during P3-P4.
