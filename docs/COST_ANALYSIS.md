# Cost Analysis 2026-03-27

Last Updated: 2026-03-27 (implementation status refreshed after code + test pass)
Purpose: canonical Firebase cost, load-complexity, and app performance review
for the current architecture.

## Scope and Method

This review is based on:

- Static inspection of backend, frontend, scheduler, and Firestore access paths.
- Current official Firebase and Google Cloud documentation reviewed on
  2026-03-27.
- Code-path analysis of hot routes, polling behavior, scheduler work, and cache
  retention behavior.

This review is not based on:

- Billing export data.
- Production trace sampling.
- Real user monitoring or synthetic Lighthouse runs.

Treat the findings below as architecture-level cost and performance risks that
should be validated against billing and monitoring data before large changes are
prioritized.

Implementation note:
The detailed findings capture the baseline risk profile at review time. Current
execution status for each high-priority item is tracked in
`Implementation Progress (2026-03-27)` below.

## Executive Summary

The largest likely Firebase cost issue in the current app is not a single
provider integration. It is Firestore read amplification caused by:

1. A polled metrics endpoint that reads an entire metrics subcollection before
   slicing the most recent days.
2. Read-only endpoints that always fetch both config and secrets, even when
   secrets are not needed.
3. A polled automation status route that reads state, all rules, config, and a
   parent user doc on every refresh.
4. A scheduler migration fallback that can scan the entire `users` collection
   every minute.

The largest likely app-speed issues are:

1. Large frontend JS payloads on the main authenticated pages.
2. Too many startup API calls on dashboard/settings flows.
3. Unused client Firestore SDK loading.
4. Short-lived static asset caching for JS/CSS.

The strongest near-term wins are low-risk:

1. Bound or materialize metrics reads.
2. Split config reads from secrets reads.
3. Shrink `/api/automation/status`.
4. Remove the scheduler zero-user migration scan.
5. Stop writing `/api/user/init-profile` on every authenticated page load.

## Ranked Opportunities

| Rank | Opportunity | Primary Benefit | Impact | Risk |
| --- | --- | --- | --- | --- |
| 1 | Replace full-scan user metrics reads with a bounded query or materialized latest-metrics doc | Firestore read reduction | Very high | Low |
| 2 | Split `getUserConfig()` into public config vs secrets access | Firestore read reduction on hot read-only paths | Very high | Low to medium |
| 3 | Redesign `/api/automation/status` to return lightweight status data only | Firestore read reduction and lower dashboard latency | Very high | Medium |
| 4 | Remove the scheduler zero-user migration scan and replace it with a one-off backfill or sentinel | Avoid worst-case O(all users) reads every minute | High | Low |
| 5 | Activate real TTL/retention policies for cache and audit collections | Lower storage growth and cleanup overhead | High | Low to medium |
| 6 | Stop unconditional `/api/user/init-profile` writes on every authenticated page load | Lower write volume and faster startup | High | Low |
| 7 | Remove unused client Firestore SDK, dedupe duplicate script loads, and improve static asset cache policy | Faster page loads and lower parse/transfer cost | Medium to high | Low to medium |
| 8 | Split the monolithic `api` function into hot-user, admin, and slow/background surfaces | Better regional placement and scaling control | Medium to high | Medium to high |
| 9 | Replace notifications unread `count()` polling with a stored counter or event-driven updates | Lower recurring reads | Medium | Medium |
| 10 | Reduce Tesla metrics write amplification by consolidating counters | Lower Firestore writes | Medium | Medium |

## Detailed Findings

### 1. User Metrics Endpoint Reads Entire Collections

The route backing `/api/metrics/api-calls?scope=user` loads the full user
metrics subcollection, sorts in memory, and then slices to the requested number
of days.

Evidence:

- [`functions/api/routes/metrics.js`](../functions/api/routes/metrics.js)
  `metricsCollection.get()` reads the full subcollection before sorting and
  slicing.
- [`frontend/js/dashboard.js`](../frontend/js/dashboard.js) polls
  `loadApiMetrics(1)` every 30 seconds.
- [`frontend/js/shared-utils.js`](../frontend/js/shared-utils.js) also exposes a
  shared metrics poller used across authenticated surfaces.

Why it matters:

- Cost scales with retained metrics documents, not with the requested `days`
  parameter.
- Open dashboard tabs create recurring Firestore reads even when the user only
  needs today’s counters.
- This is the highest-confidence direct Firestore spend issue in the codebase.

Recommended change:

- Prefer a single materialized `latestMetrics` document per user for UI display.
- If historical daily docs must stay, query only the most recent N docs by a
  sortable key instead of scanning the full collection.
- Stop polling this route outside views that visibly render the metrics.

### 2. `getUserConfig()` Over-Reads Secrets on Hot Paths

`getUserConfig()` always reads both the user config document and the secrets
document.

Evidence:

- [`functions/lib/repositories/user-automation-repository.js`](../functions/lib/repositories/user-automation-repository.js)
  reads `config/main` and `secrets/credentials` together.
- Read-only routes using this path include:
  - [`functions/api/routes/config-read-status.js`](../functions/api/routes/config-read-status.js)
    for `/api/config`
  - [`functions/api/routes/setup-public.js`](../functions/api/routes/setup-public.js)
    for `/api/config/setup-status`
  - [`functions/api/routes/config-read-status.js`](../functions/api/routes/config-read-status.js)
    for `/api/automation/status`
- Scheduler eligibility checks also use `getUserConfig()` in
  [`functions/lib/services/automation-scheduler-service.js`](../functions/lib/services/automation-scheduler-service.js).

Why it matters:

- Many hot paths only need safe config state, not credentials.
- Every unnecessary secrets read increases Firestore spend and route latency.
- It also broadens the amount of sensitive data loaded in memory on routine
  reads.

Recommended change:

- Introduce separate repository methods such as:
  - `getUserConfigPublic()`
  - `getUserConfigWithSecrets()`
- Default all GET/status routes to the public version.
- Restrict secrets reads to provider verification, token refresh, and mutation
  paths.

### 3. `/api/automation/status` Is Too Expensive for a Polled Route

The dashboard polls `/api/automation/status` every 30 seconds, but the route
does more work than a status heartbeat should.

Evidence:

- [`functions/api/routes/config-read-status.js`](../functions/api/routes/config-read-status.js)
  loads:
  - automation state
  - all rules
  - full user config through `getUserConfig()`
  - parent user doc for migration sync
  - weather data in some timezone-repair cases
- [`functions/lib/repositories/user-automation-repository.js`](../functions/lib/repositories/user-automation-repository.js)
  shows `getUserRules()` loads the full rules collection unless `enabledOnly` is
  explicitly requested.
- [`frontend/js/dashboard.js`](../frontend/js/dashboard.js) calls
  `loadBackendAutomationStatus()` on init and every 30 seconds.

Why it matters:

- Cost scales with user rule count.
- Latency scales with both Firestore work and conditional weather/cache work.
- This route is user-visible and therefore directly affects perceived snappiness.

Recommended change:

- Split status into:
  - a lightweight polled status route
  - a heavier on-demand details route for rules/config views
- Return only:
  - enabled state
  - active rule
  - last run/check metadata
  - small summary counts
- Avoid loading secrets and avoid loading all rules for heartbeat refresh.

### 4. Scheduler Fallback Can Scan All Users Every Minute

The scheduler first queries users with `automationEnabled == true`. If no users
match, it falls back to a migration scan across the full `users` collection.

Evidence:

- [`functions/lib/services/automation-scheduler-service.js`](../functions/lib/services/automation-scheduler-service.js)
  reads all users, then reads each user’s automation state when the prefilter
  returns zero rows.

Why it matters:

- Worst-case load becomes O(all users) every minute.
- This is especially wasteful during low-adoption periods or after migration
  drift.
- The risk is silent because it only appears in specific state combinations.

Recommended change:

- Replace the repeating scan with:
  - a one-time migration script
  - an admin-triggered remediation command
  - or a persisted migration sentinel/version check
- Do not retain a full fallback scan in the steady-state scheduler loop.

### 5. TTL-Like Fields Exist, but Only One TTL Policy Is Declared in Repo

The code writes several `ttl` or `expireAt` style fields, but the checked-in
Firestore config only activates TTL for `runs.expireAt`.

Evidence:

- [`firestore.indexes.json`](../firestore.indexes.json) only declares TTL for
  `runs.expireAt`.
- Other collections write TTL-style fields:
  - weather cache in
    [`functions/lib/services/weather-service.js`](../functions/lib/services/weather-service.js)
  - inverter cache in [`functions/index.js`](../functions/index.js)
  - Amber cached history in [`functions/api/amber.js`](../functions/api/amber.js)
  - scheduler dead letters in
    [`functions/lib/services/automation-scheduler-service.js`](../functions/lib/services/automation-scheduler-service.js)

Why it matters:

- If TTL is not configured elsewhere, stale cache/audit docs never auto-delete.
- Storage cost and query clutter will grow over time.
- TTL deletes are billable, but controlled retention is usually cheaper than
  indefinite storage.

Recommended change:

- Audit every cache/audit collection that writes expiry metadata.
- Activate real TTL on the intended field for each collection group.
- Where TTL is not appropriate, add explicit cleanup jobs and retention limits.

### 6. `/api/user/init-profile` Writes on Every Authenticated Page Load

Every authenticated shell startup posts to `/api/user/init-profile`.

Evidence:

- [`frontend/js/app-shell.js`](../frontend/js/app-shell.js) calls
  `/api/user/init-profile` before setup checks.
- [`functions/api/routes/user-self.js`](../functions/api/routes/user-self.js)
  reads the user doc, writes `lastUpdated`, then reads automation state and
  conditionally creates it.

Why it matters:

- Existing users generate avoidable writes and extra startup latency.
- This adds cost across every authenticated page, not just the dashboard.

Recommended change:

- Make this route idempotent and read-light for already initialized users.
- Only call it:
  - once per session
  - on first sign-in
  - or when user profile/version markers are missing
- Avoid writing `lastUpdated` unless a real field changed.

### 7. Frontend Load Is Heavier Than It Needs To Be

The app ships large page-level assets and performs multiple API calls during
startup.

Evidence:

- Large scripts include:
  - `frontend/js/dashboard.js`
  - `frontend/js/admin.js`
  - `frontend/js/settings.js`
- Dashboard init fans out into config, pricing, inverter, weather, EV, status,
  and metrics calls in
  [`frontend/js/dashboard.js`](../frontend/js/dashboard.js).
- The client initializes Firestore in
  [`frontend/js/firebase-auth.js`](../frontend/js/firebase-auth.js), but repo
  search only found that initialization site.
- `firebase-firestore-compat.js` is loaded across multiple pages even though the
  frontend appears to use authenticated API calls instead of direct Firestore
  access.
- [`frontend/history.html`](../frontend/history.html) loads
  `firebase-app-compat.js` twice.
- [`firebase.json`](../firebase.json) caches JS/CSS for only 60 seconds.

Why it matters:

- More network transfer, parse time, and main-thread work.
- Slower authenticated startup, especially on mobile or constrained devices.
- Lower cache efficiency for assets that likely change only on deploy.

Recommended change:

- Remove unused Firestore client SDK from authenticated pages.
- Dedupe duplicate script includes.
- Fingerprint bundles and raise cache TTL for versioned assets.
- Defer non-critical panels until visible or user-initiated.

### 8. Notifications and EV Metrics Add Secondary Read/Write Amplification

These are not the largest issues, but they are recurring.

Evidence:

- Notifications poll every minute in
  [`frontend/js/app-shell.js`](../frontend/js/app-shell.js).
- [`functions/lib/services/notifications-service.js`](../functions/lib/services/notifications-service.js)
  performs a page query plus unread count retrieval.
- Tesla call metering writes global, user, and vehicle metrics docs in
  [`functions/lib/services/ev-usage-control-service.js`](../functions/lib/services/ev-usage-control-service.js).
- Billable EV calls also increment the general API metrics in
  [`functions/lib/services/api-metrics-service.js`](../functions/lib/services/api-metrics-service.js)
  and [`functions/api/routes/ev.js`](../functions/api/routes/ev.js).

Why it matters:

- These paths create steady low-level Firestore activity.
- The EV write path multiplies writes per billable upstream event.

Recommended change:

- Maintain a stored unread counter instead of polling `count()` on every refresh.
- Consolidate Tesla metrics when multiple counters can be updated together or
  sampled less frequently.

### 9. Regional Placement Is Likely Suboptimal for an Australia-Centric App

This is an inference, not a confirmed deployment fact.

Evidence:

- [`firebase.json`](../firebase.json) rewrites all `/api/**` traffic to a single
  function.
- [`functions/index.js`](../functions/index.js) exports the HTTP and scheduled
  functions without an explicit `region`.

Inference:

- Unless region is configured outside the repo, Firebase will use the default
  `us-central1` region for these functions.
- The official region guidance recommends placing functions close to Firestore
  and other resources they access, and notes that cross-region placement can add
  latency and billing cost.

Recommended change:

- Confirm the deployed Firestore region and current function region.
- If the app is primarily Australia-based and resources permit it, move hot
  user-facing functions closer to the data/users.
- Consider separating admin and public/user traffic into different functions so
  region and scaling behavior can be tuned independently.

## Load Complexity Review

### Dashboard

Current startup work is approximately:

- `O(1)` startup calls across multiple domains of state:
  config, setup/bootstrap, pricing, inverter, weather, EV, automation status,
  metrics.
- `O(rule_count)` on each automation status refresh.
- `O(days_retained)` on each metrics refresh because the current route scans the
  full metrics subcollection.

Current recurring timers include:

- pricing heartbeat
- inverter refresh
- weather refresh
- EV status refresh
- metrics refresh
- automation status refresh

Good existing control:

- [`frontend/js/dashboard.js`](../frontend/js/dashboard.js) already has an
  in-flight GET de-duplication mechanism.

### Scheduler

Steady-state scheduler work is approximately:

- `O(enabled_users)`
- plus `O(enabled_rules_per_user)`

The scheduler already has one useful optimization:

- [`functions/api/routes/automation-cycle.js`](../functions/api/routes/automation-cycle.js)
  reuses scheduler context to avoid re-reading state/config/rules inside the
  cycle route.

Main remaining concerns:

- config/secrets over-read
- full-user migration scan fallback
- per-user rule collection reads during eligibility checks

### Admin

Admin routes intentionally scan broad datasets and should be treated as a
separate optimization track.

Evidence:

- [`functions/api/routes/admin.js`](../functions/api/routes/admin.js) builds
  user rosters from full Firestore and Auth scans.

Priority guidance:

- Do not optimize admin paths before user-facing hot paths unless billing data
  shows admin usage is unexpectedly high.

## Performance and Speed Review

### Page Weight

Observed large assets in the repo include:

- `frontend/js/dashboard.js`
- `frontend/js/admin.js`
- `frontend/js/settings.js`
- large page HTML files such as `frontend/admin.html` and `frontend/app.html`

Likely impact:

- parse/compile cost
- slower startup on mobile
- more re-downloads than necessary due to short cache TTL

### Startup Waterfalls

The dashboard and app shell currently fetch multiple pieces of state in parallel
or sequence before the interface settles.

Likely improvements:

- one authenticated bootstrap endpoint for shell data
- lazy panel loading
- view-based or visibility-based refresh suspension
- skip metrics/notifications refresh when their UI is hidden

### Static Asset Caching

`firebase.json` currently serves JS/CSS with:

- `Cache-Control: public, max-age=60, stale-while-revalidate=600`

That is conservative for non-fingerprinted assets, but it leaves meaningful
performance on the table if release-manifest or fingerprinted bundle flows are
available.

Recommended direction:

- keep HTML no-cache
- fingerprint JS/CSS
- give fingerprinted static assets long TTLs

## Logging Cost Note

Logging does not appear to be the primary cost problem today, but it should stay
under review.

Evidence:

- [`functions/index.js`](../functions/index.js) gates structured logger debug and
  verbose behavior behind environment flags.

Risk note:

- There are many logging callsites across the codebase, including some verbose
  debug traces in automation evaluation and diagnostics flows.
- If `DEBUG` or `VERBOSE` are enabled in production, Cloud Logging ingestion
  could become material.

Recommendation:

- Keep production defaults non-verbose.
- Review logging ingestion monthly alongside billing.

## Firebase and Google Cloud Pricing Notes

As of the official documentation reviewed on 2026-03-27:

- Cloud Firestore charges for documents and index entries read to satisfy a
  query, plus writes, deletes, and storage.
- Aggregation queries such as `count()` are billed by index entries read, with a
  minimum charge of one document read per query.
- Every query has a minimum charge of one document read, even if it returns no
  results.
- TTL deletes do not use the Firestore free tier and count toward delete costs.
- Cloud Functions for Firebase 2nd gen runs on Cloud Run pricing behavior, so
  scaling, concurrency, and kept-warm instances can affect cost and latency.
- Scheduled functions create Cloud Scheduler jobs; the per-job charge is small
  relative to repeated Firestore and function work, and Firebase currently notes
  an allowance of three free jobs per Google account.
- Function region placement affects both latency and potential cross-region
  billing.

## Validation Plan

Before large refactors, validate with data:

1. Export Google Cloud billing by service and SKU.
2. Break out Firestore reads/writes/deletes by route and scheduler path.
3. Measure route call frequency for:
   - `/api/metrics/api-calls`
   - `/api/automation/status`
   - `/api/user/init-profile`
   - `/api/notifications`
4. Confirm deployed function region and Firestore region.
5. Audit which collections actually have active TTL policies in production.
6. Measure dashboard cold-start and interactive-ready time before and after
   frontend changes.

## Immediate Implementation Order

Recommended sequence:

1. Fix user metrics full-scan reads.
2. Split public config from secrets reads.
3. Slim `/api/automation/status`.
4. Remove scheduler zero-user migration scan.
5. Make profile init session-aware and write-light.
6. Remove unused Firestore compat SDK and duplicate script loads.
7. Add or verify TTL policies for intended cache/audit collections.
8. Revisit region placement and function decomposition after the above wins land.

## Implementation Progress (2026-03-27)

Status update against the immediate implementation order:

| Sequence Item | Status | Implementation Notes |
| --- | --- | --- |
| 1. Fix user metrics full-scan reads | Implemented | `/api/metrics/api-calls?scope=user` now reads the last `N` date-keyed daily docs directly, removing the previous full-scan path and avoiding Firestore index dependencies. |
| 2. Split public config from secrets reads | Implemented | Added `getUserConfigPublic()` and `getUserConfigWithSecrets()`. Hot read routes now use public config by default. |
| 3. Slim `/api/automation/status` | Implemented (phase 1) | Added lightweight `GET /api/automation/status-summary` and moved dashboard interval polling to this summary route. Full status route remains for detailed data. |
| 4. Remove scheduler zero-user migration scan | Implemented | Removed full `users` collection fallback scan from steady-state scheduler. Scheduler now exits early when prefilter finds zero enabled users. |
| 5. Make profile init session-aware and write-light | Implemented | `/api/user/init-profile` now avoids writes when user profile + automation state are already initialized. |
| 6. Remove unused Firestore compat SDK and duplicate script loads | Pending | Not included in this implementation pass. |
| 7. Add or verify TTL policies for intended cache/audit collections | Pending | Not included in this implementation pass. |
| 8. Revisit region placement and function decomposition | Pending | Not included in this implementation pass. |

## Validation Evidence (2026-03-27)

- Full functions test suite passed:
  `npm --prefix functions test` -> `115` suites, `1566` tests, `0` failures.
- Lint passed:
  `npm --prefix functions run lint`.
- Full pre-deploy gate passed:
  `npm --prefix functions run pre-deploy` -> tests, contract checks, lint, import/export checks, API/OpenAPI contract parity, and repo hygiene all passed.
- Targeted regression suites for touched modules were also run during implementation and passed (metrics route, config/status routes, setup/health routes, scheduler service, user profile init route, repository split tests).

## Production Hotfix (2026-03-27)

- Follow-up production log review found that the first bounded metrics implementation was still falling back in prod because the query shape required a Firestore index that was not present.
- The production-safe fix was to replace the query with direct reads of the last `N` date-keyed user metrics documents.
- Hotfix validation passed locally and via the full pre-deploy gate, and the `api` function was redeployed successfully to production.

## Rollout and Regression Notes

- Backward compatibility: `getUserConfig()` still returns full (with secrets) behavior, while new callers can opt into public config reads.
- Frontend safety: dashboard summary polling keeps the last known `rules` payload cached from full status loads, and falls back to full status if summary fetch fails.
- Remaining optimization phases (frontend SDK trim, TTL policy expansion, region/function decomposition) are intentionally staged to avoid mixing higher-risk deployment changes into this cost-read reduction release.

## Source Links

- Firestore pricing:
  https://firebase.google.com/docs/firestore/pricing
- Firestore TTL:
  https://firebase.google.com/docs/firestore/ttl
- Cloud Functions locations:
  https://firebase.google.com/docs/functions/locations
- Cloud Functions scaling and concurrency:
  https://firebase.google.com/docs/functions/manage-functions
- Scheduled functions:
  https://firebase.google.com/docs/functions/schedule-functions
- Cloud Run pricing:
  https://cloud.google.com/run/pricing

## Update Cadence

- Refresh this doc after major scheduler, caching, frontend boot, or API-route
  changes.
- Prefer replacing rough static estimates with real billing-export evidence when
  available.
- Keep this document as the canonical cost/performance review and avoid adding
  overlapping cost audit docs unless they are clearly marked historical.
