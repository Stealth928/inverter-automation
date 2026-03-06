# P2 / G2 Closeout Evidence (March 2026)

Status: Draft closeout evidence prepared (gate decision pending)
Date: 2026-03-06
Owner: RefactoringMar26
Related plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`

## Scope

This document captures objective evidence for Exit Gate G2 after completing:
- P2 Wave 1 utility extraction
- P2 Wave 2 read-only route extraction
- P2 Wave 3 mutation-route extraction
- Wave 3 step 2 service decomposition, including residual action/persist helper extraction from `automation-cycle`

## Evidence Snapshot

### Quality and contract checks

- `npm --prefix functions run lint`: pass
- `npm run api:contract:check`: pass
  - backend routes discovered: `73`
  - APIClient endpoint-method entries: `60`
  - inline HTML paths missing from APIClient: `0`
  - APIClient mismatches vs backend: `0`
- `npm run openapi:check`: pass (incremental rollout mode)
  - OpenAPI operations declared: `4`
  - backend routes not yet in OpenAPI: `69` (expected under incremental rollout)
- `node scripts/pre-deploy-check.js`: pass
  - full Jest suite passed: `51/51` suites, `653` passing tests, `44` todo

### Decomposition footprint (current)

- `functions/index.js` line count: `4864`
- extracted route modules (`functions/api/routes/*.js`): `12`
- extracted service modules (`functions/lib/services/*.js`): `8`

## Exit Gate G2 Assessment

Gate criteria source: Section "Exit Gate G2" in `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`.

| Criterion | Status | Evidence |
|---|---|---|
| 1. Domain logic runs independently from Express internals | Partially Met | Scheduler no longer uses `app._router.stack`; it now invokes shared cycle handler directly via `registerAutomationCycleRoute(...)` return. Remaining coupling: scheduler still uses mock `req`/`res` envelope instead of pure service invocation |
| 2. Module boundaries are enforceable and documented | Partially Met | Route/service extraction completed and documented in P2 kickoff + execution log; boundary enforcement is improved but not fully isolated from composition root |
| 3. Legacy compatibility behavior validated by tests | Met | Legacy config mapping coverage in `functions/test/user-automation-repository.test.js`; emulator credential validation compatibility covered in `functions/test/routes-integration.test.js` |
| 4. `functions/index.js` is under 1,500 lines | Not Met | Current count is `4866` lines |
| 5. No duplicated utility functions across modules | Partially Met | Residual dedupe performed for numeric coercion via `functions/lib/services/number-utils.js`; known time/comparison helper overlap remains between monolith and extracted helpers |
| 6. Shared test utilities in place | Partially Met | Shared harness exists (`functions/test/helpers/firebase-mock.js`) but usage is not yet normalized across all suites |

## Gate Recommendation

- Recommended gate decision: **Hold G2 closeout**
- Rationale: criteria 1 and 4 are hard blockers; criteria 2, 5, and 6 need additional closure work.

## Required Follow-up Work Before G2 Sign-off

1. Complete scheduler decoupling to a pure service runner (`runAutomationHandler` should stop constructing mock `req`/`res` and call service-layer cycle execution directly).
2. Reduce `functions/index.js` below `1500` lines by moving remaining domains/helpers into extracted modules.
3. Complete utility deduplication pass for time/comparison helpers still split between monolith and shared libs.
4. Normalize shared test harness usage across route/service test suites.
5. Re-run full gate checks and refresh this evidence document with final pass status.
