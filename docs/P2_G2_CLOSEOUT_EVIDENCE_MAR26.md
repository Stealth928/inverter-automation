# P2 / G2 Closeout Evidence (March 2026)

Status: Draft closeout evidence prepared - refreshed with latest extraction and hygiene gate metrics (gate decision pending)
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
- Automated repo hygiene gating integrated into hard pre-deploy checks

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
  - full Jest suite passed: `70/70` suites, `746` passing tests, `44` todo

### Code coverage (latest measured)

- Statements: **50.29%** (2512/4995)
- Branches: **42.57%** (1817/4268)
- Functions: **62.36%** (280/449)
- Lines: **51.30%** (2450/4775)

### Decomposition footprint (current verified)

- `functions/index.js` line count: **944** (down from 9,019 baseline - 89.5% reduction)
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
| 2. Module boundaries are enforceable and documented | Partially Met | Route/service extraction is broad, but composition root still contains residual wrapper/helper glue that can be normalized |
| 3. Legacy compatibility behavior validated by tests | Met | Full gate passes with `746` passing tests across route-module and service-level coverage |
| 4. `functions/index.js` is under 1,500 lines | Met | Current count is **944** lines |
| 5. No duplicated utility functions across modules | Partially Met | High-volume duplication removed; remaining thin repository wrapper duplication in `index.js` should still be normalized |
| 6. Shared test utilities in place | Partially Met | Shared harness exists (`functions/test/helpers/firebase-mock.js`) but usage normalization is still incomplete across all suites |

## Gate Recommendation

- Recommended gate decision: **Conditional Go (technical blockers cleared; closeout hygiene/governance pending)**
- Rationale: hard technical blocker on `index.js` size is resolved and all quality gates pass; remaining items are documentation/harness normalization and formal sign-off packaging.

## Required Follow-up Work Before Final G2 Sign-off

1. Finalize G2 closeout package and explicit sign-off records in governance docs.
2. Normalize remaining thin repository wrapper duplication in `functions/index.js`.
3. Continue shared test-harness normalization across route/service suites.
4. Continue OpenAPI rollout coverage expansion (currently incremental mode).
5. Re-run full gate checks at sign-off time and refresh this evidence document with final gate decision.

## Repo Hygiene Notes

- Automated hygiene gate now enforces tracked-noise prevention and root-doc minimization (`scripts/repo-hygiene-check.js`).
- Cost analysis documentation is consolidated to `docs/COST_ANALYSIS.md`.
- OpenAPI spec (`docs/openapi/openapi.v1.yaml`) remains in incremental rollout mode (4 operations currently declared).
