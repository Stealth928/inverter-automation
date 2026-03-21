# Repo Opportunity Audit (2026-03-21)

Date: 2026-03-21  
Status: analysis only, no implementation in this pass

## Purpose

Persist the repo-wide scan of performance optimization opportunities, Firebase
cost opportunities, scheduler performance issues, stale or inaccurate docs,
and other notable debt or dead code.

This audit is code-path based. It does not include live Firebase billing
exports, Firestore index review, or Firestore console TTL policy inspection, so
cost and retention findings below should be treated as high-confidence code
observations rather than billing-ground-truth.

## Method

- Read key repo surfaces across `functions/`, `frontend/`, `docs/`,
  `scripts/`, and CI/workflow files.
- Reviewed scheduler, automation cycle, cache, weather, API metrics, and
  frontend service-worker/hosting behavior.
- Ran `node scripts/repo-hygiene-check.js` and it passed.
- Ran `npm run openapi:check`; result: `91` backend routes, `9` declared
  OpenAPI operations, `82` backend routes still outside the spec.
- Ran focused backend tests:
  `npm --prefix functions test -- --runInBand --runTestsByPath test/automation-scheduler-service.test.js test/automation-cycle-route-module.test.js test/admin-routes-modules.test.js`
  and got `45` passing tests across `3` suites.

## Suggested Triage Order

1. Firestore TTL and retention consistency
2. Scheduler pre-filter duplicate reads and blackout mismatch
3. Scheduler write amplification
4. Static asset caching and Hosting egress waste
5. Docs and contract drift cleanup

## Prioritized Opportunities

| Rank | Area | Opportunity | Impact | Change risk | Why it matters |
| --- | --- | --- | --- | --- | --- |
| 1 | Firebase cost, data retention | Normalize Firestore TTL and retention fields | Very high | Medium | Cache, audit, dead-letter, and idempotency docs use inconsistent retention field shapes; likely expiration debt and storage bloat risk |
| 2 | Scheduler, Firebase cost | Remove duplicate scheduler reads and fix blackout pre-check source | Very high | Medium | Scheduler reads extra data before handing off, and the blackout pre-check appears to read from the wrong structure |
| 3 | Scheduler, Firebase cost | Reduce per-cycle Firestore write amplification | High | Medium-High | Locking, idempotency, state writes, metrics, and dead letters add significant write volume per run |
| 4 | Frontend performance, Hosting cost | Stop defeating cache for market-insights JSON and screenshots | High | Low | Large static assets are fetched with `no-store`, increasing latency and Firebase Hosting egress |
| 5 | Docs accuracy, developer efficiency | Repair OpenAPI and narrative-doc drift; demote stale historical docs | High | Low | Current docs overstate accuracy and under-document the real runtime surface |
| 6 | Firebase cost | Collapse or sample API metrics writes | High | Low | Every tracked upstream API call writes both a global and a per-user metrics row |
| 7 | Backend performance, Firebase cost | Remove weather fetch and timezone write side effects from read-heavy paths | High | Low-Medium | Passive config/status reads can trigger external weather calls and Firestore writes |
| 8 | Scheduler, provider API load | Add cache discipline for non-FoxESS automation status reads | High | Medium | Non-FoxESS automation currently goes direct to provider adapters instead of reusing cache |
| 9 | Backend performance | Decompose the monolithic functions entrypoint | Medium-High | Medium-High | Hot API routes, admin routes, adapters, and scheduler concerns are bundled together, increasing cold-start and maintenance cost |
| 10 | Frontend performance, maintainability | Split or slim large frontend bundles and hero assets | Medium-High | Medium | Large JS files and oversized screenshots keep first-load heavy even after cache fixes |
| 11 | Debt, dead surface area | Reconcile dormant/staged routes, repos, and feature-flag code | Medium | Low-Medium | Some modules are present with tests/docs but are not wired through the main runtime entrypoint |
| 12 | Repo hygiene | Remove large generated artifacts from git and widen hygiene checks | Medium | Low | Large tracked data/artifact files inflate clone size and make the repo hygiene gate too forgiving |

## Detailed Notes

### 1. Normalize Firestore TTL and retention fields

- Impact: Very high
- Change risk: Medium
- Why:
  Several caches and retention-shaped records write numeric `ttl` or
  `expiresAt` values. The scheduler metrics sink uses a `Date`-shaped
  `expireAt` field instead. If Firestore TTL is intended for the numeric paths,
  these records may not be expiring automatically.
- Evidence:
  - [functions/lib/services/automation-scheduler-service.js](../functions/lib/services/automation-scheduler-service.js):
    idempotency and dead-letter retention fields
  - [functions/lib/services/automation-scheduler-metrics-sink.js](../functions/lib/services/automation-scheduler-metrics-sink.js):
    `expireAt` uses `new Date(...)`
  - [functions/lib/services/weather-service.js](../functions/lib/services/weather-service.js):
    weather cache `ttl`
  - [functions/api/amber.js](../functions/api/amber.js):
    Amber cache `ttl`
  - [functions/api/routes/inverter-history.js](../functions/api/routes/inverter-history.js):
    inverter history cache `ttl`
  - [functions/index.js](../functions/index.js):
    inverter caches and audit retention fields
- Notes:
  This is both a cost issue and a cleanup issue. Idempotency docs are also
  created per user-cycle key and can accumulate if retention is ineffective.

### 2. Remove duplicate scheduler reads and fix blackout pre-check source

- Impact: Very high
- Change risk: Medium
- Why:
  The scheduler preloads user state/config, then loads rules for due users to
  inspect `userRules.blackoutWindows`, but runtime blackout windows are stored
  on `userConfig.automation.blackoutWindows`. After that pre-check, the
  automation cycle re-reads config and rules again.
- Evidence:
  - [functions/lib/services/automation-scheduler-service.js](../functions/lib/services/automation-scheduler-service.js):
    preload and blackout pre-check logic
  - [functions/api/routes/config-read-status.js](../functions/api/routes/config-read-status.js):
    blackout windows read from config
  - [functions/api/routes/automation-cycle.js](../functions/api/routes/automation-cycle.js):
    runtime blackout logic also reads from config, then rules
- Notes:
  This looks like both a correctness bug and a cost/performance issue.

### 3. Reduce per-cycle Firestore write amplification

- Impact: High
- Change risk: Medium-High
- Why:
  A single automation cycle can write lock state, idempotency state, cycle
  state, metrics, and dead letters. This is likely a major Firestore write
  driver for active users.
- Evidence:
  - [functions/lib/services/automation-scheduler-service.js](../functions/lib/services/automation-scheduler-service.js):
    lock acquire/release, idempotency, dead-letter writes
  - [functions/api/routes/automation-cycle.js](../functions/api/routes/automation-cycle.js):
    repeated `lastCheck` and state persistence branches
  - [functions/lib/services/automation-scheduler-metrics-sink.js](../functions/lib/services/automation-scheduler-metrics-sink.js):
    per-run metrics and aggregate writes
- Notes:
  The best opportunities are likely batching, reducing duplicate state updates,
  or shifting some operational telemetry out of Firestore if not queried often.

### 4. Stop defeating cache for market-insights JSON and screenshots

- Impact: High
- Change risk: Low
- Why:
  Market-insights region JSON files are each about `1.09 MB`, yet the frontend
  fetches them with `cache: 'no-store'`, the service worker bypasses cache for
  that path, and Hosting headers are conservative. Screenshot assets are also
  forced uncached despite being static deploy assets.
- Evidence:
  - [frontend/js/market-insights.js](../frontend/js/market-insights.js):
    `cache: 'no-store'`
  - [frontend/sw.js](../frontend/sw.js):
    bypass for market-insights data and screenshots
  - [firebase.json](../firebase.json):
    JS/CSS `max-age=60`, market-insights and screenshot cache headers
  - [frontend/data/aemo-market-insights](../frontend/data/aemo-market-insights):
    published JSON payload sizes
  - [frontend/images/screenshots](../frontend/images/screenshots):
    large PNG assets
- Notes:
  This is one of the clearest user-visible performance wins and a direct
  Hosting egress opportunity.

### 5. Repair OpenAPI and narrative-doc drift; demote stale historical docs

- Impact: High
- Change risk: Low
- Why:
  The repo presents OpenAPI and narrative docs as authoritative, but the actual
  parity gap is still large. Some narrative docs still describe outdated cache
  behavior, and the main docs index promotes historical planning material as
  if it were still current.
- Evidence:
  - [docs/openapi/openapi.v1.yaml](openapi/openapi.v1.yaml):
    partial runtime coverage relative to the route inventory
  - [docs/API.md](API.md):
    stale cache/rate-limit details, including Amber cache behavior
  - [docs/AUTOMATION.md](AUTOMATION.md):
    stale cache TTL note
  - [docs/INDEX.md](INDEX.md):
    still promotes the refactor plan in the active architecture section
  - [docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md](REFACTORING_IMPLEMENTATION_PLAN_MAR26.md):
    contains statements already invalidated by current code
  - [frontend/index.html](../frontend/index.html):
    public landing page still labels some supported providers as "Soon"
- Notes:
  This is low implementation risk and high leverage for reducing operator and
  contributor confusion.

### 6. Collapse or sample API metrics writes

- Impact: High
- Change risk: Low
- Why:
  Each tracked upstream API call increments both a global metrics doc and a
  per-user metrics doc. That means every external provider/weather call pays
  double Firestore writes before the underlying feature work is counted.
- Evidence:
  - [functions/lib/services/api-metrics-service.js](../functions/lib/services/api-metrics-service.js):
    global daily metrics increment
  - [functions/lib/services/api-metrics-service.js](../functions/lib/services/api-metrics-service.js):
    per-user daily metrics increment
- Notes:
  This may be appropriate for some analytics, but it should be an explicit
  tradeoff because the write pattern is very direct.

### 7. Remove weather fetch and timezone write side effects from read-heavy paths

- Impact: High
- Change risk: Low-Medium
- Why:
  Config/status reads can trigger weather fetches and config writes purely to
  sync timezone. That means a read path mutates state and can call an external
  API under normal browsing.
- Evidence:
  - [functions/api/routes/config-read-status.js](../functions/api/routes/config-read-status.js):
    aggressive timezone sync on config read
  - [functions/lib/services/weather-service.js](../functions/lib/services/weather-service.js):
    weather refresh writing timezone back to config
- Notes:
  Even if this behavior is convenient, it is easy to overpay for and hard to
  reason about operationally.

### 8. Add cache discipline for non-FoxESS automation status reads

- Impact: High
- Change risk: Medium
- Why:
  Non-FoxESS automation paths go directly to `deviceAdapter.getStatus()` when a
  FoxESS-shaped cache payload is unavailable, while the FoxESS path benefits
  from established cache handling. That creates avoidable upstream load during
  scheduler cadence.
- Evidence:
  - [functions/lib/services/automation-cycle-data-service.js](../functions/lib/services/automation-cycle-data-service.js):
    direct adapter call for non-FoxESS providers
  - [functions/index.js](../functions/index.js):
    existing inverter cache patterns
- Notes:
  This is especially relevant as provider support broadens beyond the original
  FoxESS-first path.

### 9. Decompose the monolithic functions entrypoint

- Impact: Medium-High
- Change risk: Medium-High
- Why:
  `functions/index.js` acts as a large composition root for hot user APIs,
  admin routes, adapters, scheduler, cache services, and optional admin cost
  metrics integrations. That increases cold-start footprint and makes module
  boundaries harder to maintain.
- Evidence:
  - [functions/index.js](../functions/index.js):
    single large wiring surface
  - [functions/package.json](../functions/package.json):
    includes `googleapis`
- Notes:
  This is a medium-term architecture opportunity, not the first thing to do,
  but it keeps showing up as a source of complexity.

### 10. Split or slim large frontend bundles and hero assets

- Impact: Medium-High
- Change risk: Medium
- Why:
  Even after cache improvements, initial page weight remains high. The largest
  tracked JS bundles are `dashboard.js` at about `580 KB`, `settings.js` at
  about `182 KB`, and `admin.js` at about `156 KB`. The landing page also ships
  screenshot assets up to about `1.5 MB`.
- Evidence:
  - [frontend/js/dashboard.js](../frontend/js/dashboard.js)
  - [frontend/js/settings.js](../frontend/js/settings.js)
  - [frontend/js/admin.js](../frontend/js/admin.js)
  - [frontend/index.html](../frontend/index.html)
  - [frontend/images/screenshots](../frontend/images/screenshots)
- Notes:
  This is partly a performance issue and partly a maintainability issue.

### 11. Reconcile dormant or staged routes, repositories, and flags

- Impact: Medium
- Change risk: Low-Medium
- Why:
  Some modules are present, documented, and tested, but are not wired through
  the main runtime entrypoint right now. They may be intentionally staged, but
  they still increase the maintenance and cognitive surface area.
- Evidence:
  - [functions/api/routes/assets.js](../functions/api/routes/assets.js)
  - [functions/api/routes/provider-accounts.js](../functions/api/routes/provider-accounts.js)
  - [functions/lib/repositories/asset-registry-repository.js](../functions/lib/repositories/asset-registry-repository.js)
  - [functions/lib/repositories/provider-accounts-repository.js](../functions/lib/repositories/provider-accounts-repository.js)
  - [functions/lib/services/feature-flag-service.js](../functions/lib/services/feature-flag-service.js)
  - [functions/index.js](../functions/index.js):
    absence of route wiring for the modules above
- Notes:
  The choice here is not necessarily "delete now"; it is to decide whether
  these are active rollout surfaces, historical remnants, or future work.

### 12. Remove large generated artifacts from git and widen hygiene checks

- Impact: Medium
- Change risk: Low
- Why:
  The repo still tracks large generated artifacts and run outputs. The
  `aemo-aggregated-data/` tree alone is about `134.8 MB`. The current hygiene
  gate blocks obvious logs/temp files but does not protect against large
  generated data or one-off run archives being committed.
- Evidence:
  - [aemo-aggregated-data](../aemo-aggregated-data)
  - [scripts/repo-hygiene-check.js](../scripts/repo-hygiene-check.js)
  - [frontend/data/aemo-market-insights](../frontend/data/aemo-market-insights)
- Notes:
  This is mostly repo health, clone speed, and review hygiene rather than
  runtime performance, but the repository size is now meaningful enough to
  warrant policy.

## Follow-Up Recommendation

If this audit becomes the basis of an implementation pass, use the following
order:

1. Retention and TTL normalization
2. Scheduler read/write path simplification
3. Frontend static cache policy correction
4. Docs and OpenAPI cleanup
5. Monolith and bundle decomposition work
