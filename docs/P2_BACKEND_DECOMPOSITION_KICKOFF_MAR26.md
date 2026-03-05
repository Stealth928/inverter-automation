# P2 Backend Decomposition Kickoff (March 2026)

Status: Ready  
Phase: P2 (Backend Decomposition) preparation  
Owner: RefactoringMar26

## Purpose

Lock the first implementation sequence for P2 so backend extraction starts with low-risk moves and preserves production behavior.

## Guardrails

1. No behavior changes during extraction PRs.
2. Keep route signatures and response envelopes unchanged.
3. Move code behind shared helpers first, then extract route modules.
4. Every extraction PR must include targeted tests and regression checks.

## Kickoff Sequence

### Wave 0 (completed in P1 handoff)

- Extract device telemetry alias normalization from `functions/index.js` into:
  - `functions/lib/device-telemetry.js`
- Wire automation rule evaluation to shared helper (`parseAutomationTelemetry`).
- Add unit tests:
  - `functions/test/device-telemetry.test.js`

### Wave 1 (utility-first extraction, no route moves)

1. Extract pricing interval parsing helpers from `index.js` into `lib/pricing-normalization.js`.
2. Extract scheduler group construction into `lib/automation-actions.js`.
3. Extract Firestore read/write helpers for config/rules/history into `lib/repositories/*.js`.

Validation for Wave 1:
- `npm --prefix functions run lint`
- `npm --prefix functions test -- --runInBand`
- `node scripts/pre-deploy-check.js`

### Wave 2 (read-only route extraction)

1. Create route modules under `functions/api/routes/` for read-only endpoints:
   - `pricing.js`
   - `weather.js`
   - `metrics.js`
2. Keep existing route paths and middleware chain unchanged.
3. Keep `functions/index.js` as composition/root wiring only.

Validation for Wave 2:
- Existing API contract checks remain green:
  - `npm run api:contract:check`
  - `npm run openapi:check`
- Add supertest coverage for moved route handlers.

### Wave 3 (state-changing route extraction)

1. Extract config and automation mutation endpoints:
   - `config.js`
   - `automation.js`
   - `scheduler.js`
2. Introduce service modules (`lib/services/*`) only after route extraction is stable.

Validation for Wave 3:
- Regression suite for automation cycle, rule CRUD, scheduler endpoints.
- Emulator smoke test:
  - `npm run emu:reset`
  - verify `/api/config/setup-status`
  - verify rule import + automation cycle baseline flow.

## Definition of “P2 Kickoff Locked”

P2 kickoff is considered locked when:

1. This sequence is referenced by the main plan.
2. Wave 1 extraction checklist is accepted by owner.
3. P2/G2 tracker issue is created from dashboard template and linked.
