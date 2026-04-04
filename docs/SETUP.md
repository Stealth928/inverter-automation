# Setup Guide

Purpose: canonical setup reference for local development, provider onboarding,
runtime configuration, Firestore model, and deployment prerequisites.

Last updated: 2026-03-28

## 1. Prerequisites

- Node.js 22+
- Firebase CLI
- A Firebase project with Hosting, Authentication, Firestore, and Functions
- Java installed locally when running Firestore and Pub/Sub emulators

Install dependencies from repo root:

```bash
npm ci
npm --prefix functions ci
```

## 2. Firebase Project Setup

Enable and configure:

1. Authentication
2. Firestore Database
3. Hosting
4. Cloud Functions

Expected repo behaviors:

- Hosting serves `frontend/`
- `/api/**` rewrites to the `api` function
- `runAutomation` is deployed as a scheduled function
- `refreshAemoLiveSnapshots` is deployed as a scheduled function
- Firestore rules and indexes are tracked in source control

Useful checks:

```bash
firebase use
firebase projects:list
```

## 3. Frontend Project Configuration

Update Firebase web configuration in `frontend/js/firebase-config.js` for the
target project and ensure `.firebaserc` points at the intended project id.

The deployed frontend currently contains both public and authenticated surfaces.

Public crawlable pages:

- `/`
- `/battery-roi-calculator.html`
- `/battery-wear-estimator.html`
- `/market-insights/`
- `/rule-template-recommender/`
- `/blog/`
- `/amber-smartshift-vs-socrates/`
- `/home-battery-automation-options-compared/`
- `/battery-automation-roi-examples/`
- `/privacy.html`
- `/terms.html`

Authenticated or internal pages:

- `/login.html`
- `/reset-password.html`
- `/setup.html`
- `/app.html`
- `/control.html`
- `/history.html`
- `/roi.html`
- `/rules-library.html`
- `/market-insights.html`
- `/settings.html`
- `/admin.html`
- `/test.html`

## 4. Provider and Pricing Onboarding

### Guided setup versus Settings

The guided setup flow is still FoxESS-first, but the backend and Settings flow
support all current providers. `POST /api/config/validate-keys` accepts:

- FoxESS credentials
- Sungrow credentials
- SigenEnergy credentials
- AlphaESS credentials
- pricing-provider selection for Amber or AEMO
- optional weather/location input

### FoxESS

Required user inputs:

- FoxESS API token
- device serial number

Status:

- primary production path
- broadest support across telemetry, scheduler, diagnostics, quick control, and
  curtailment

### Sungrow

Required user inputs:

- account email
- account password
- device serial number

Status:

- supported in backend and Settings validation
- credentials are stored with write-only handling for passwords

### SigenEnergy

Required user inputs:

- account email
- account password
- region: `apac`, `eu`, `cn`, or `us`

Status:

- supported in backend and Settings validation
- work-mode support is live, but parity with FoxESS diagnostics is not claimed

### AlphaESS

Required user inputs:

- system serial number
- `appId`
- `appSecret`

Status:

- supported in backend and Settings validation
- normalized telemetry and control paths are live

### Pricing Provider

Supported providers:

- `amber`
- `aemo`

Supported AEMO regions:

- `NSW1`
- `QLD1`
- `VIC1`
- `SA1`
- `TAS1`

Notes:

- Amber uses customer/site-specific tariff data.
- AEMO uses public regional market pricing.
- AEMO is normalized onto the same buy/feed-in style surfaces used by Amber so
  automation, reporting, and ROI flows can reuse the same shape.

### Weather and Timezone

Location is operational, not cosmetic. It drives:

- weather lookups
- timezone resolution for automation
- forecast-based rule evaluation

## 5. Tesla EV Setup

Tesla support is part of the shipped product.

Current user-visible capability:

- OAuth onboarding in Settings
- VIN-based vehicle registration
- per-vehicle status
- command-readiness checks
- wake
- start charging
- stop charging
- set charge limit
- set charging amps

Prerequisites:

1. Tesla developer application configured for Fleet OAuth
2. redirect URI matching the deployed `settings.html` origin
3. allowed origins and top-level domains configured in Tesla developer app
4. hosted public key at:
   `/.well-known/appspecific/com.tesla.3p.public-key.pem`
5. Tesla scopes for status plus charging control

Important runtime nuance:

- some vehicles allow direct commands
- some require signed commands
- the product checks readiness per vehicle and only enables controls when the
  required transport is available

Related docs:

- [guides/TESLA_ONBOARDING.md](guides/TESLA_ONBOARDING.md)

## 6. Runtime Secrets and Environment Variables

### Firebase Secret Manager / deployed function secrets

Current code uses:

- `SUNGROW_APP_KEY`
- `SUNGROW_APP_SECRET`
- `TESLA_SIGNED_COMMAND_PROXY_URL`
- `TESLA_SIGNED_COMMAND_PROXY_TOKEN`
- `GITHUB_DATAWORKS_TOKEN`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

For web push in production, all three `WEB_PUSH_VAPID_*` values must be
present on the API runtime. The notifications bootstrap endpoint reports push
as unconfigured when any of them are missing, and Settings will show:
`Push transport is not configured on the server yet.`

Typical secret setup:

```bash
firebase functions:secrets:set WEB_PUSH_VAPID_PUBLIC_KEY
firebase functions:secrets:set WEB_PUSH_VAPID_PRIVATE_KEY
firebase functions:secrets:set WEB_PUSH_VAPID_SUBJECT
```

`WEB_PUSH_VAPID_SUBJECT` should usually be a contact URI such as
`mailto:ops@example.com`.

### Scheduler, cache, and SLO tuning

Examples used by runtime code:

- `AUTOMATION_SCHEDULER_MAX_CONCURRENCY`
- `AUTOMATION_SCHEDULER_RETRY_ATTEMPTS`
- `AUTOMATION_SCHEDULER_RETRY_BASE_DELAY_MS`
- `AUTOMATION_SCHEDULER_RETRY_JITTER_MS`
- `AUTOMATION_SCHEDULER_LOCK_LEASE_MS`
- `AUTOMATION_SCHEDULER_IDEMPOTENCY_TTL_MS`
- `AUTOMATION_SCHEDULER_DEAD_LETTER_TTL_MS`
- `AUTOMATION_SCHEDULER_SLO_ERROR_RATE_PCT`
- `AUTOMATION_SCHEDULER_SLO_DEAD_LETTER_RATE_PCT`
- `AUTOMATION_SCHEDULER_SLO_MAX_QUEUE_LAG_MS`
- `AUTOMATION_SCHEDULER_SLO_MAX_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_P99_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_TAIL_P99_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_TAIL_WINDOW_MINUTES`
- `AUTOMATION_SCHEDULER_SLO_TAIL_MIN_RUNS`
- `AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL`
- `AUTOMATION_SCHEDULER_SLO_ALERT_COOLDOWN_MS`

### Tesla EV rate and usage controls

- `EV_STATUS_CACHE_MAX_AGE_MS`
- `EV_TESLA_COMMAND_COOLDOWN_MS`
- `EV_TESLA_COMMAND_DEDUP_TTL_MS`
- `EV_TESLA_WAKE_COOLDOWN_MS`
- `EV_TESLA_RATE_WINDOW_MS`
- `EV_TESLA_RATE_STATUS_PER_WINDOW`
- `EV_TESLA_RATE_COMMAND_PER_WINDOW`
- `EV_TESLA_DAILY_BILLABLE_LIMIT_PER_VEHICLE`
- `EV_TESLA_MONTHLY_BILLABLE_LIMIT_PER_VEHICLE`
- `EV_TESLA_MONTHLY_BILLABLE_LIMIT_PER_USER`
- `EV_TESLA_DEGRADED_MODE`

### DataWorks / market-insights admin controls

- `GITHUB_DATAWORKS_OWNER`
- `GITHUB_DATAWORKS_REPO`
- `GITHUB_DATAWORKS_WORKFLOW`
- `GITHUB_DATAWORKS_REF`
- `GITHUB_DATAWORKS_REF_MODE`

Use Secret Manager for secrets and keep deployed environment settings aligned
with the intended runtime behavior.

## 7. Local Development

Recommended reset:

```bash
npm run emu:reset
```

Useful commands:

```bash
npm run emu:start
npm run emu:seed
npm run emu:seed:live
npm run emu:reset:live
npm run emu:status
npm run emu:stop
```

### Live local seed users

If you want the emulator to include local-only live FoxESS users:

1. Copy `functions/scripts/emulator-live-user.local.example.json` to
   `functions/scripts/emulator-live-user.local.json`.
2. Fill in the real credentials locally.
3. Use `npm run emu:reset:live` or `npm run emu:seed:live`.

Notes:

- `functions/scripts/emulator-live-user.local.json` is gitignored.
- The `:live` commands fail fast when that file is missing, which avoids a
  silent reset that recreates only the built-in mock users.

Default local endpoints:

- Hosting: `http://127.0.0.1:5000`
- Functions: `http://127.0.0.1:5001`
- Emulator UI: `http://127.0.0.1:4000`
- Auth emulator: `http://127.0.0.1:9099`

Notes:

- Firestore and Pub/Sub emulators require Java.
- Use [LOCAL_DEV_KNOWN_ISSUES.md](LOCAL_DEV_KNOWN_ISSUES.md) for emulator and
  service-worker troubleshooting.

## 8. Verification Commands

Run these before substantial backend or release work:

```bash
npm --prefix functions run lint
npm --prefix functions test -- --runInBand
npm run api:contract:check
npm run openapi:check
npm run test:market-insights:contracts
npm run test:pwa:versions
npm run test:release:manifest
npm run test:e2e:frontend
node scripts/pre-deploy-check.js
```

## 9. Firestore Model Summary

### Top-level docs and collections used by runtime code

| Path | Purpose |
| --- | --- |
| `users/{uid}` | user profile, auth metadata, admin role, automationEnabled mirror |
| `metrics/{YYYY-MM-DD}` | global daily API usage counters |
| `metrics/automationScheduler/runs/{runId}` | per-run scheduler metrics |
| `metrics/automationScheduler/daily/{YYYY-MM-DD}` | daily scheduler aggregates |
| `metrics/automationScheduler/alerts/current` | latest scheduler alert state |
| `metrics/automationScheduler/alerts/{YYYY-MM-DD}` | historical alert snapshots |
| `shared/serverConfig` | shared config such as announcements and legacy pre-auth setup state |
| `shared/serverCredentials` | legacy shared credentials for setup fallback mode |
| `shared/teslaAppConfig` | shared Tesla app configuration readable by authenticated users |
| `sharedPrivate/teslaAppSecret` | private Tesla app secret storage |
| `aemoSnapshots/{region}` | current Firestore-backed AEMO regional price snapshots |
| `admin_audit/{docId}` | admin action audit trail |
| `featureFlags/{name}` | feature-flag documents |

### Important user-scoped docs and subcollections

| Path | Purpose |
| --- | --- |
| `users/{uid}/config/main` | main user config, provider details, location, automation preferences |
| `users/{uid}/secrets/credentials` | write-only provider secrets where needed |
| `users/{uid}/rules/{ruleId}` | automation rules |
| `users/{uid}/automation/state` | runtime automation state |
| `users/{uid}/automation/lock` | scheduler lock doc |
| `users/{uid}/automation/idempotency_<cycleKey>` | scheduler idempotency markers |
| `users/{uid}/automation_dead_letters/{docId}` | repeated scheduler failures awaiting operator follow-up |
| `users/{uid}/history/{docId}` | automation and operational history entries |
| `users/{uid}/automationAudit/{docId}` | rule-evaluation and ROI-oriented audit entries |
| `users/{uid}/quickControl/state` | active quick-control override state |
| `users/{uid}/curtailment/state` | curtailment state and timestamps |
| `users/{uid}/cache/*` | pricing, inverter, weather, and EV-related cache docs |
| `users/{uid}/metrics/{YYYY-MM-DD}` | per-user daily API metrics |
| `users/{uid}/vehicles/{vehicleId}` | EV records and metadata |
| `users/{uid}/vehicles/{vehicleId}/state/current` | cached EV status |
| `users/{uid}/vehicles/{vehicleId}/state/commandReadiness` | cached EV command-readiness |

## 10. First Production Smoke Check

After deployment, verify:

1. `/api/health` returns success
2. login and password-reset flows work
3. dashboard loads telemetry and pricing
4. settings save and reload correctly
5. automation rule save, toggle, and cycle flows work
6. Tesla-enabled accounts show EV status and readiness
7. public tools and public market-insights preview still load
8. admin dashboard works for admins and rejects non-admins
