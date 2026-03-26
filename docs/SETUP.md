# Setup Guide

Purpose: canonical setup reference for local development, deployment
configuration, provider onboarding, and runtime environment requirements.

Last updated: 2026-03-17

## 1. Prerequisites

- Node.js 22+
- Firebase CLI
- A Firebase project with Hosting, Authentication, Firestore, and Functions
- Java installed locally if you run Firestore and Pub/Sub emulators

Install dependencies from repo root:

```bash
npm ci
npm --prefix functions ci
```

## 2. Firebase Project Setup

Enable these services in the Firebase project:

1. Authentication
2. Firestore Database
3. Hosting
4. Cloud Functions

Recommended baseline:

- Email/password auth enabled
- Firestore created in production mode
- Hosting configured to serve `frontend/`
- Functions runtime left on `nodejs22`

The repo already expects these Firebase behaviors:

- `/api/**` rewrites to the `api` function
- `runAutomation` is deployed as a scheduled function
- Firestore rules and indexes are tracked in source control

## 3. Frontend Project Configuration

Update Firebase web configuration in `frontend/js/firebase-config.js` for the
target project, and ensure `.firebaserc` points at the intended Firebase
project id.

Deploy target check:

```bash
firebase use
```

## 4. Deployment Commands

Common deploy commands:

```bash
firebase deploy
firebase deploy --only functions
firebase deploy --only hosting
firebase deploy --only firestore:rules,firestore:indexes
```

Use [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) and
[RELEASE_READINESS_CHECKLIST.md](RELEASE_READINESS_CHECKLIST.md) before
production releases.

## 5. Supported Provider Onboarding

Users configure provider credentials from the app. The guided setup page and the
Settings page do not expose exactly the same breadth of capability, so use the
notes below.

### FoxESS

Current status: most complete production path.

Users need:

- FoxESS API token
- device serial number

Available in setup flow: yes.

### Sungrow

Users need:

- Sungrow / iSolarCloud account email
- account password
- device serial number

Available in guided setup: limited / not the primary self-service path.

Available in Settings validation flow: yes.

Notes:

- backend performs a live login during validation
- password is stored write-only in a user secrets subcollection and is not
  returned by the API

### SigenEnergy

Users need:

- account email
- account password
- region: `apac`, `eu`, `cn`, or `us`

Available in guided setup: limited / not the primary self-service path.

Available in Settings validation flow: yes.

Notes:

- backend performs a live OAuth login during validation
- work-mode support is live, but scheduling/history coverage is still less
  mature than FoxESS

### AlphaESS

Users need:

- `system SN (sysSn)`
- `appId`
- `appSecret`

Available in guided setup: not the primary self-service path.

Available in Settings validation flow: yes.

Notes:

- validation confirms app credentials by listing accessible systems
- AlphaESS is supported in the backend and settings flows even though the first
  run setup UX is still more FoxESS-first

### Pricing Provider

Users can choose either pricing source during setup or later in Settings:

- `Amber`
- `AEMO`

Amber users need:

- Amber API token
- site selection after validation where applicable

AEMO users need:

- region selection only
- one of `NSW1`, `QLD1`, `VIC1`, `SA1`, `TAS1`

Notes:

- A pricing source remains optional, but price-aware automation, history, and
  ROI workflows are reduced without one.
- AEMO uses public regional market pricing rather than a customer-specific
  retailer tariff.
- In the product, AEMO market pricing is normalized onto the same buy/feed-in
  and forecast surfaces used by Amber so existing pricing views and rules keep
  working.

### Weather

Users configure a location. That location is operational, not cosmetic:

- it drives weather lookups
- it influences timezone resolution for automation

## 6. Tesla EV Setup

Tesla support is live in the shipped product.

Current user-visible capabilities:

- OAuth onboarding from Settings
- VIN-based vehicle registration
- dashboard EV status
- manual wake
- start charging
- stop charging
- set charge limit
- set charging amps

Important prerequisites:

1. Tesla developer app configured for Fleet OAuth
2. Redirect URI exactly matching the deployed `settings.html` origin
3. Allowed origins and top-level domains configured in Tesla developer app
4. Public PEM hosted at:
   `/.well-known/appspecific/com.tesla.3p.public-key.pem`
5. Appropriate Tesla scopes for status and charging control

Important operational nuance:

- some vehicles allow direct charging commands
- some require signed commands
- the app checks readiness per vehicle and only enables controls when Tesla
  access and command transport are ready

Related docs:

- [guides/TESLA_ONBOARDING.md](guides/TESLA_ONBOARDING.md)
- [guides/TESLA_EV_INTEGRATION.md](guides/TESLA_EV_INTEGRATION.md)

## 7. Runtime Secrets and Environment Variables

There are two main categories of runtime configuration.

### Deployed function secrets / env

Examples used by the codebase include:

- `SUNGROW_APP_KEY`
- `SUNGROW_APP_SECRET`
- `TESLA_SIGNED_COMMAND_PROXY_URL`
- `TESLA_SIGNED_COMMAND_PROXY_TOKEN`

Scheduler SLO and orchestration tuning is also environment-driven. Examples:

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

Tesla EV usage-control and cache knobs include:

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

Use Firebase Secret Manager for secrets and ensure deploy-time environment
configuration matches the intended runtime behavior.

Optional DataWorks admin controls can also be configured for the admin panel:

- Secret:
  `GITHUB_DATAWORKS_TOKEN`
- Optional environment overrides:
  `GITHUB_DATAWORKS_OWNER`, `GITHUB_DATAWORKS_REPO`,
  `GITHUB_DATAWORKS_WORKFLOW`, `GITHUB_DATAWORKS_REF`,
  `GITHUB_DATAWORKS_REF_MODE`

Example:

```bash
firebase functions:secrets:set GITHUB_DATAWORKS_TOKEN

# Optional overrides if you do not want the built-in defaults
# Default owner: Stealth928
# Default repo: inverter-automation
# Default workflow: aemo-market-insights-delta.yml
# Default ref mode: auto
# Auto mode follows the branch currently live on hosting.
# Set GITHUB_DATAWORKS_REF to pin dispatch/guard checks to a branch.
# Set GITHUB_DATAWORKS_REF_MODE=live to force live-branch targeting.
```

Without `GITHUB_DATAWORKS_TOKEN`, the DataWorks tab stays read-only and only
shows cached GitHub workflow diagnostics. With it configured, admins can
manually dispatch the market-insights workflow from the DataWorks panel.
Use a token that can dispatch GitHub Actions for this repository.

### User-scoped secrets and config

Provider credentials entered in the app are stored under the user record, with
sensitive write-only credentials kept in a secrets subcollection where needed.

## 8. Local Development

Recommended path:

```bash
npm run emu:reset
```

Useful commands:

```bash
npm run emu:start
npm run emu:seed
npm run emu:status
npm run emu:stop
```

Local endpoints:

- Hosting: `http://127.0.0.1:5000`
- Functions: `http://127.0.0.1:5001`
- Emulator UI: `http://127.0.0.1:4000`
- Auth emulator: `http://127.0.0.1:9099`

Notes:

- Firestore and Pub/Sub emulators require Java.
- Windows emulator launcher fallbacks are already handled in the repo scripts.
- Use [LOCAL_DEV_KNOWN_ISSUES.md](LOCAL_DEV_KNOWN_ISSUES.md) for known emulator
  and service-worker issues.

## 9. Verification Commands

Run these before substantial backend or deployment work:

```bash
npm --prefix functions run lint
npm --prefix functions test -- --runInBand
npm run api:contract:check
npm run openapi:check
npm run test:e2e:frontend
node scripts/pre-deploy-check.js
```

## 10. Firestore Model Summary

Top-level collections currently used by runtime code:

| Path | Purpose |
| --- | --- |
| `users/{uid}` | user profile, auth-linked metadata, admin role, automation flags |
| `shared/serverConfig` | legacy shared pre-auth setup storage for selected flows |
| `metrics/{YYYY-MM-DD}` | daily API usage counters |
| `metrics/automationScheduler/runs/{runId}` | per-run scheduler metrics |
| `metrics/automationScheduler/daily/{YYYY-MM-DD}` | daily scheduler aggregates |
| `metrics/automationScheduler/alerts/current` | latest scheduler alert state |
| `metrics/automationScheduler/alerts/{YYYY-MM-DD}` | daily watch/breach alert snapshots |
| `admin_audit/{docId}` | admin action audit trail |

Important user-scoped docs and subcollections:

| Path | Purpose |
| --- | --- |
| `config/main` | main user config, provider data, timezone, automation preferences |
| `automation/state` | runtime automation state and last-check metadata |
| `rules/{ruleId}` | automation rules |
| `history/{docId}` | automation history |
| `automationAudit/{auditId}` | per-cycle evaluation and ROI context |
| `metrics/{YYYY-MM-DD}` | per-user API usage counters |
| `quickControl/state` | manual override state |
| `curtailment/state` | curtailment state |
| `cache/*` | pricing, telemetry, and weather caches |
| `vehicles/{vehicleId}` | Tesla EV records and credentials metadata |

## 11. First Production Smoke Check

After deployment, verify:

1. `/api/health` returns success
2. login and password reset work
3. dashboard loads telemetry and pricing
4. settings save and reload correctly
5. automation rule save/toggle/cycle work
6. EV onboarding and EV status render for Tesla-enabled accounts
7. admin dashboard works for admins and rejects non-admins
