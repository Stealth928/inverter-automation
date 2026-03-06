# P2 / G2 Closeout Evidence (March 2026)

Status: Final closeout evidence - Gate G2 approved and closed
Date: 2026-03-06 (last refreshed: 2026-03-06)
Owner: RefactoringMar26
Related plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`

## Scope

This document captures objective evidence for Exit Gate G2 after completing:
- P2 Wave 1 utility extraction
- P2 Wave 2 read-only route extraction
- P2 Wave 3 mutation-route extraction
- Wave 3 step 2 service decomposition, including residual action/persist helper extraction from `automation-cycle`
- Continued `functions/index.js` reduction via setup-public, auth-lifecycle, quick-control, automation-history, device-mutation, config-read-status, and user-self route extractions
- Composition-root repository wrapper normalization in `functions/index.js`
- Quick-control expired-state cleanup extraction into shared service (`functions/lib/services/quick-control-service.js`)
- Automated repo hygiene gating integrated into hard pre-deploy checks
- Final G2 governance closeout pass with refreshed metrics from current workspace state

## Evidence Snapshot

### Quality and contract checks

- `npm --prefix functions run lint`: pass (zero warnings)
- `npm run api:contract:check`: pass
  - backend routes discovered: `73`
  - APIClient endpoint-method entries: `60`
  - inline HTML paths missing from APIClient: `0`
  - APIClient mismatches vs backend: `0`
- `npm run openapi:check`: pass (incremental rollout mode)
  - OpenAPI operations declared: `4`
  - backend routes not yet in OpenAPI: `69` (expected under incremental rollout)
- `npm run hygiene:check`: pass
- `node scripts/pre-deploy-check.js`: pass
  - full Jest suite passed: `71/71` suites, `750` passing tests, `44` todo
- Additional closeout verification:
  - `(Get-Content functions/index.js).Length` -> `918`
  - `(Get-ChildItem functions/api/routes -File -Filter *.js | Measure-Object).Count` -> `21`
  - `(rg "\\bapp\\.(get|post|put|delete|patch)\\(" functions/index.js -g "*.js" | Measure-Object).Count` -> `0`
  - `rg -n "app\\._router\\.stack" functions/index.js functions/api/routes functions/lib -g "*.js"` -> no matches
  - duplicate-utility sweep (targeted prior overlap domains):
    - `rg -n "function (getTimeInTimezone|isTimeInRange|getUserTime|addMinutes)\\b" functions/index.js functions/lib -g "*.js"` -> definitions only in `functions/lib/time-utils.js`
    - `rg -n "function (cleanupExpiredQuickControl|toFiniteNumber|compareValue)\\b" functions/index.js functions/lib functions/api/routes -g "*.js"` -> single definitions in shared service modules

### Code coverage (latest measured)

- Statements: **50.29%** (2512/4995)
- Branches: **42.57%** (1817/4268)
- Functions: **62.36%** (280/449)
- Lines: **51.30%** (2450/4775)

### Decomposition footprint (current verified)

- `functions/index.js` line count: **918** (down from 9,019 baseline - 89.8% reduction)
- Inline routes remaining in `index.js`: **0**
- Scheduler dispatch coupling to `app._router.stack`: **removed**
- High-volume helper domains extracted from `index.js` include:
  - admin access/metrics
  - weather/cache
  - API metrics
  - automation state repository + time utilities
  - curtailment
  - rule-action
  - rule-evaluation

## Exit Gate G2 Assessment

Gate criteria source: Section "Exit Gate G2" in `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`.

| Criterion | Status | Evidence |
|---|---|---|
| 1. Domain logic runs independently from Express internals | Met | Scheduler no longer uses `app._router.stack`; shared cycle handler reference is injected and invoked through service composition |
| 2. Module boundaries are enforceable and documented | Met | `functions/index.js` now acts as composition root with route registration + service wiring, architecture boundaries are documented (`docs/P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md`, `docs/adr/ADR-001-target-architecture-boundaries.md`), and hard checks run in pre-deploy |
| 3. Legacy compatibility behavior validated by tests | Met | Full gate passes with `750` passing tests across route-module and service-level coverage |
| 4. `functions/index.js` is under 1,500 lines | Met | Current count is **918** lines |
| 5. No duplicated utility functions across modules | Met | Final duplicate-utility sweep confirms formerly duplicated helper domains now have single shared definitions (time helpers, numeric coercion, quick-control cleanup, rule comparison utility boundary) |
| 6. Shared test utilities in place | Met | Shared Firebase Admin harness is established at `functions/test/helpers/firebase-mock.js` and consumed by modularized suites (`admin.test.js`, `cleanup-user.test.js`) with ongoing reuse for new route/service testing |

## Gate Recommendation

- Recommended gate decision: **Go (Gate G2 closed on 2026-03-06)**
- Rationale: all six G2 exit criteria are met, technical blockers are resolved, and full quality gates are passing with current workspace metrics.

## Carry-Forward Work (Non-blocking, post-G2)

1. Continue OpenAPI rollout coverage expansion (currently incremental mode).
2. Continue incremental shared-harness adoption across remaining legacy-heavy suites where beneficial.
3. Maintain repo hygiene checks as hard pre-deploy gates and keep root-level noise files excluded.

## Repo Hygiene Notes

- Automated hygiene gate now enforces tracked-noise prevention and root-doc minimization (`scripts/repo-hygiene-check.js`).
- Cost analysis documentation is consolidated to `docs/COST_ANALYSIS.md`.
- OpenAPI spec (`docs/openapi/openapi.v1.yaml`) remains in incremental rollout mode (4 operations currently declared).
