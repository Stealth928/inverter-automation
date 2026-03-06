# P2 / G2 Closeout Evidence (March 2026)

Status: Draft closeout evidence prepared — refreshed with verified metrics (gate decision pending)
Date: 2026-03-06 (last refreshed: 2026-03-06)
Owner: RefactoringMar26
Related plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`

## Scope

This document captures objective evidence for Exit Gate G2 after completing:
- P2 Wave 1 utility extraction
- P2 Wave 2 read-only route extraction
- P2 Wave 3 mutation-route extraction
- Wave 3 step 2 service decomposition, including residual action/persist helper extraction from `automation-cycle`
- Continued index.js reduction via setup-public, auth-lifecycle, quick-control, automation-history, device-mutation, config-read-status, and user-self route extractions

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
- `node scripts/pre-deploy-check.js`: pass
  - full Jest suite passed: `57/57` suites, `682` passing tests, `44` todo

### Code coverage (current verified)

- Statements: **50.29%** (2512/4995)
- Branches: **42.57%** (1817/4268)
- Functions: **62.36%** (280/449)
- Lines: **51.30%** (2450/4775)

### Decomposition footprint (current verified)

- `functions/index.js` line count: **4,053** (down from 9,019 baseline — 55% reduction)
- Inline routes remaining in `index.js`: **9** (all admin domain + health)
- Inline helper functions remaining in `index.js`: **~49**
- Extracted route modules (`functions/api/routes/*.js`): **19** files, **4,990** lines total
- Extracted service modules (`functions/lib/services/*.js`): **9** files, **1,031** lines total
- Extracted lib modules (`functions/lib/**/*.js` total): **2,157** lines total
- Integration modules (`functions/api/{amber,foxess,auth}.js`): **910** lines total
- Test suite: **58** test files, **14,921** lines total

## Exit Gate G2 Assessment

Gate criteria source: Section "Exit Gate G2" in `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`.

| Criterion | Status | Evidence |
|---|---|---|
| 1. Domain logic runs independently from Express internals | Partially Met | Scheduler no longer uses `app._router.stack`; it now invokes shared cycle handler directly via `runAutomationSchedulerCycle(...)`. Remaining coupling: scheduler still uses mock `req`/`res` envelope instead of pure service invocation |
| 2. Module boundaries are enforceable and documented | Partially Met | 19 route modules + 9 service modules extracted and documented in P2 kickoff + execution log; boundary enforcement is improved but composition root still carries ~49 inline helpers |
| 3. Legacy compatibility behavior validated by tests | Met | Legacy config mapping coverage in `functions/test/user-automation-repository.test.js`; emulator credential validation compatibility covered in `functions/test/routes-integration.test.js`; 682 passing tests |
| 4. `functions/index.js` is under 1,500 lines | Not Met | Current count is **4,053** lines (needs ~2,553 more lines extracted). Primary remaining domains: admin routes (~800 lines), GCP billing/monitoring (~200 lines), weather/cache (~300 lines), curtailment (~200 lines), Firestore data helpers (~400 lines), rule evaluation (~650 lines) |
| 5. No duplicated utility functions across modules | Partially Met | Numeric coercion deduplicated via `number-utils.js`; known duplication remains: `getUserConfig`, `setUserConfig`, `getUserRules`, `setUserRule`, `deleteUserRule`, `addHistoryEntry` exist in both `index.js` and `user-automation-repository.js`; time/comparison helpers overlap between monolith and extracted code |
| 6. Shared test utilities in place | Partially Met | Shared harness exists (`functions/test/helpers/firebase-mock.js`) but usage is not normalized across all 58 suites |

## Gate Recommendation

- Recommended gate decision: **Hold G2 closeout**
- Rationale: criterion 4 is the primary hard blocker (4,053 vs target 1,500); criteria 1, 2, 5 need final closure.

## Required Follow-up Work Before G2 Sign-off

1. Complete scheduler decoupling to a pure service runner (`runAutomationHandler` should stop constructing mock `req`/`res` and call service-layer cycle execution directly).
2. Reduce `functions/index.js` below `1,500` lines by extracting remaining domains:
   - **Admin routes** (~800 lines): extract to `functions/api/routes/admin.js`
   - **GCP billing/monitoring helpers** (~200 lines): extract to `functions/lib/services/gcp-billing-service.js`
   - **Weather API + cache** (~300 lines): extract to weather service module
   - **Curtailment logic** (~200 lines): extract to curtailment service module
   - **Duplicated Firestore data helpers** (~400 lines): rewire callers to use `user-automation-repository.js` exports
   - **Rule evaluation + comparison** (~650 lines): already partially extracted; complete migration to service modules
3. Delete duplicated repository functions from `index.js` and update all callers to use `user-automation-repository.js`.
4. Normalize shared test harness usage across route/service test suites.
5. Re-run full gate checks and refresh this evidence document with final pass status.

## Repo Hygiene Notes

- `exports/prod-rules-2026-03-03T11-40-15-274Z.json` is tracked by git but should be gitignored
- `functions/test-output.txt` and `functions/quick-control-test-output.txt` are tracked but listed in `.gitignore` (need git rm --cached)
- `docs/COST_ANALYSIS_2025.md` and `docs/FIREBASE_COST_ANALYSIS.md` overlap in scope — consider consolidating
- OpenAPI spec (`docs/openapi/openapi.v1.yaml`) covers only 4 of 73 routes — significant spec debt
