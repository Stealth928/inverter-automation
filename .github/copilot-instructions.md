<!-- Copilot / AI agent guidance for the Inverter Automation repo -->
# Repo Overview

- Purpose: serverless inverter automation on Firebase Hosting + Cloud Functions + Firestore.
- Main code areas:
  - `functions/`: backend API and scheduler
  - `frontend/`: static UI pages and shared JS
  - `scripts/`: repo-level quality gates, emulator tooling, and contract checks
  - `docs/`: architecture, API, setup, refactoring plan

# Architecture Snapshot

- Hosting rewrites `/api/**` to the `api` Cloud Function in `firebase.json`.
- Backend exports in `functions/index.js`:
  - `exports.api = functions.https.onRequest(app)`
  - `exports.runAutomation = onSchedule({ schedule: 'every 1 minutes', timeZone: 'UTC' }, ...)`
- `functions/index.js` is still the composition root, but major route/service decomposition is in progress:
  - route modules under `functions/api/routes/` now include read and mutation domains
  - services and repositories under `functions/lib/services/` and `functions/lib/repositories/`

# API and Auth Rules

- Preserve API envelope compatibility: success/error responses should stay consistent with `{ errno, result, error, msg }` patterns used by frontend.
- Use `authenticateUser` for required-auth routes.
- Use `tryAttachUser(req)` for optional-auth routes that should still return safe responses when unauthenticated.
- Do not rename `api` export or change `/api/**` rewrite behavior without updating `firebase.json`.

# Setup/Credential Flow Notes

- `POST /api/config/validate-keys` lives in `functions/api/routes/setup-public.js`.
- In emulator mode (`FUNCTIONS_EMULATOR` or `FIRESTORE_EMULATOR_HOST`), FoxESS live validation is intentionally bypassed for local setup.
- On successful validation:
  - authenticated users write to `users/{uid}/config/main`
  - unauthenticated setup writes to `shared/serverConfig`

# Local Dev and Verification Commands

- Install deps:
  - `npm ci`
  - `npm --prefix functions ci`
- Emulator workflows (root scripts):
  - `npm run emu:reset` (recommended clean restart + reseed + health checks)
  - `npm run emu:start`
  - `npm run emu:status`
  - `npm run emu:stop`
- Backend checks:
  - `npm --prefix functions run lint`
  - `npm --prefix functions test -- --runInBand`
  - `node scripts/pre-deploy-check.js`
- Contract/OpenAPI checks:
  - `npm run api:contract:check`
  - `npm run openapi:check`
- Frontend E2E:
  - `npm run test:e2e:frontend`

# CI Reality (from `.github/workflows/qa-checks.yml`)

- CI runs Node `22.x`.
- Required jobs:
  - quality assurance (`pre-deploy-check`, tests, coverage)
  - lint
  - security (`npm audit`)
  - Playwright frontend E2E

# Coding Conventions

- Runtime target is Node 22 (`functions/package.json` + `firebase.json` runtime).
- Prefer extracting new logic into route/service/repository modules instead of growing `functions/index.js`.
- Preserve rate-limit and cache behavior when touching FoxESS/Amber/Weather paths.
- If API shapes change, update docs (`docs/API.md`, `docs/openapi/openapi.v1.yaml`) and related tests in the same PR.

# High-Value Files

- `functions/index.js`: backend composition root and exports
- `functions/api/routes/`: extracted route registration modules
- `functions/lib/services/`: extracted domain services
- `functions/lib/repositories/`: Firestore access helpers
- `functions/api/{amber,foxess,auth}.js`: integration/auth modules
- `scripts/pre-deploy-check.js`: gate script used locally and in CI
- `firebase.json`: rewrites/runtime/emulator config
- `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md`: active decomposition tracker

# AI Agent Checklist

1. Locate the endpoint/service in `functions/index.js`, `functions/api/routes/`, and `functions/lib/services/` before editing.
2. Keep response envelopes and auth behavior backward compatible.
3. Add or update focused tests for changed behavior.
4. Run `npm --prefix functions run lint` and relevant tests before finishing.
5. For larger backend changes, run `node scripts/pre-deploy-check.js`.
6. Update docs when contracts, endpoints, or operational workflows change.
