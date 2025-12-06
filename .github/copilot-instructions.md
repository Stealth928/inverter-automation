<!-- Copilot / AI agent guidance for the Inverter Automation repo -->
# Repo Overview

- **Purpose:** Serverless inverter automation: Firebase Hosting (frontend), Firebase Cloud Functions (API & automation), and Firestore for per-user state. See `README.md` and `docs/SETUP.md` for full context.
- **Primary code areas:** `functions/` (Cloud Functions / Express API), `frontend/` (static UI), `firebase.json` (hosting + rewrites), `docs/` (automation & API docs).

# High-level architecture (quick)

- Frontend served from `frontend/` via Firebase Hosting. Requests to `/api/**` are rewritten to the functions code (see `firebase.json` rewrites).
- `functions/index.js` implements an Express app exported as the `api` Cloud Function and the scheduled automation (`runAutomation`) via PubSub schedule (every 1 minute).
- Firestore collections: user configs at `users/{uid}/config/main`, automation rules at `users/{uid}/rules`, and runtime state/history at `users/{uid}/history` (see `docs/SETUP.md`).

# What matters when editing code

- Follow the existing API envelope pattern: responses commonly use `{ errno, result, error }` where `errno: 0` means success. Keep this for compatibility with the frontend.
- Use `tryAttachUser(req)` for endpoints that accept optional authentication and `authenticateUser` for required auth paths (see `functions/index.js` middleware).
- Preserve caching & rate-limit behavior for external APIs (Amber, FoxESS, Weather). TTLs and retry settings are centralized in `functions/index.js` — reuse those constants rather than hard-coding new timing.
- Exported function names and rewrites matter: the hosting rewrite maps `/api/**` → function name `api` (defined in `functions/index.js`). Avoid renaming that export without updating `firebase.json`.

# Local dev & test workflows (explicit commands)

- Install dependencies for functions: `cd functions && npm install`.
- Start local functions emulator: `npm --prefix functions run serve` (runs `firebase emulators:start --only functions`).
- Run unit tests for functions: `npm --prefix functions test` (Jest).
- Run linter: `npm --prefix functions run lint`.
- Frontend quick-serve (separate terminal): `cd frontend && python -m http.server 8000` → open `http://localhost:8000`.
- End-to-end emulator test (Windows): run `d:/inverter-automation/archive/run-emulator-tests.ps1` (script starts the emulator and runs `test-emulator.js`).

# Secrets & config

- Secrets can come from `functions.config()` (Firebase Functions config) or environment variables used in code. Common names:
  - `foxess.token` / `FOXESS_TOKEN`
  - `amber.api_key` / `AMBER_API_KEY`
  - `FOXESS_BASE_URL`, `AMBER_BASE_URL`
- Client-side Firebase config lives in `frontend/js/firebase-config.js` and `.firebaserc` maps the project id. Do not hardcode or commit API keys.

# Patterns and examples (copyable)

- Optional-auth endpoint pattern: use `tryAttachUser(req)` to attach user if ID token present, but return safe empty results when unauthenticated (see `/api/amber/prices` and `/api/amber/sites`).
- Validation/setup flow: `/api/config/validate-keys` validates FoxESS and Amber credentials and saves to `users/{uid}/config/main` or `shared/serverConfig` for unauthenticated setups.
- Rule format examples are authoritative in `docs/AUTOMATION.md` — follow those JSON shapes when modifying rule creation or evaluation logic.

# Debugging & logs

- Functions logs: `firebase functions:log` or `npm --prefix functions run logs` (package.json `logs` script).
- When debugging locally, use the emulator UI (default at `http://localhost:4000`) and check emulator console for errors. The project includes verbose request logging in `functions/index.js` to help trace requests.

# Code conventions & notes for PRs

- Node runtime: `node 20` (see `functions/package.json` engines). Prefer modern syntax but maintain compatibility with the deployed runtime.
- Avoid changing public API shapes or the `{ errno, result }` envelope unless you update both frontend and API docs.
- Run `npm --prefix functions test` and `npm --prefix functions run lint` before opening PRs touching `functions/`.

# Files to reference while coding

- `functions/index.js` — main API, auth middleware, caching, automation scheduler.
- `functions/package.json` — scripts and dependency versions.
- `firebase.json` — hosting rewrites and headers (important if you change URLs).
- `docs/SETUP.md`, `docs/AUTOMATION.md`, `docs/API.md` — deployment, rule formats, and API contract.
- `archive/run-emulator-tests.ps1`, `archive/backend/server.js` — useful local test harnesses and legacy server behavior to reference (not deployed).

# If you are an AI agent: checklist

1. Search `functions/index.js` for the endpoint you will change; follow existing middleware and response envelope.
2. Run `npm --prefix functions install` and `npm --prefix functions run lint` locally before tests.
3. Validate behavior with `npm --prefix functions run serve` + serving frontend locally.
4. Update `docs/` (API.md or AUTOMATION.md) if you change request/response shapes.
5. Keep changes small and test with the emulator; note any required Firebase config changes in the PR description.

---
If anything here is unclear or you want me to expand a section (examples, test commands, or code snippets), tell me which part to improve.
