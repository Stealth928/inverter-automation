# Engineering Review — SoCrates Inverter Automation
**Date:** 2026-03-30  
**Scope:** Full-repo due-diligence review  
**Reviewer:** Staff-level automated review (architecture, security, QA, SRE, product)  
**Status:** Verified combined edition. This version supersedes earlier draft claims wherever direct code and workflow review disagreed.

---

## 1. EXECUTIVE SUMMARY

### Overall Assessment
SoCrates is structurally stronger than the earlier draft suggested. The codebase already has meaningful modular decomposition, adapter boundaries, request-scoped logging, scheduler lock/idempotency markers, dead-letter recording, and real deploy-time contract checks. The main risk is now at the edges: provider-capability drift, manual-vs-scheduled control races, frontend failure handling, and a test suite whose raw size overstates its regression signal.

### Key Strengths
1. **Modular backend direction is real** — route/service/repository extraction is already established, not just planned
2. **Scheduler safety is partially implemented** — per-user locks, cycle-key reservation/idempotency markers, retries, dead letters, and metrics already exist
3. **Provider abstraction is coherent** — adapters and contract tests make cross-provider behavior inspectable
4. **Firestore access boundaries are sensible** — readable config and write-only secrets are separated
5. **Release discipline is stronger than average for this size** — route inventory, OpenAPI/baseline checks, predeploy checks, and hosted release-manifest verification are in place
6. **Structured logging is thoughtful** — AsyncLocalStorage-backed request context is already wired through the API stack
7. **Test breadth is wide** — there are many backend and frontend test files, even though depth and assertion quality still need work

### Core Risks
1. **Provider capability drift is the sharpest product risk** — live SigenEnergy schedule methods are stub/no-op yet can still return success if called
2. **Quick control and automation are not serialized at the write boundary** — the pause model exists, but the pre-write gap is still race-prone
3. **Scheduler overlap risk remains under slow or degraded runs** — idempotency exists, but the 2-minute lease and non-idempotent device writes still leave edge-case duplication risk
4. **In-memory rate limiting is not meaningful protection in a scaled serverless deployment**
5. **Test confidence is overstated by raw counts** — Jest thresholds are very low and many Playwright tests rely on sleeps, `networkidle`, or weak truthy assertions
6. **Frontend request handling is thin** — no timeout or retry means degraded backends become hanging UX
7. **Repo hygiene is materially worse than it needs to be** — 128 MB of AEMO CSV data and multiple one-off debug scripts are tracked in git
8. **Operational release safety is incomplete** — there is hosted manifest verification, but no post-deploy API smoke check or staging/canary path

### Corrections From Source Verification
1. **Scheduler idempotency is already implemented** — the live risk is overlap and lease behavior, not total absence of cycle-key protection
2. **A global CSP already exists in `firebase.json`** — the problem is permissiveness, not missing headers
3. **Deploy verification already exists for hosted release alignment** — the remaining gap is API/function health verification after deploy

### Top 10 Highest-Value Improvements
| # | Improvement | Impact | Effort |
|---|-----------|--------|--------|
| 1 | Return explicit unsupported errors for unimplemented provider control paths | Prevents false-success automation/control on partial adapters | S |
| 2 | Harden scheduler overlap handling with lease heartbeat + action-level idempotency | Reduces duplicate device writes under degraded runs | M |
| 3 | Add a pre-write quick-control/automation mutex | Prevents last-write-wins device conflicts | M |
| 4 | Move AEMO CSV data out of git | Reduces clone/CI weight immediately | S |
| 5 | Raise Jest thresholds and remove low-signal Playwright patterns | Makes CI failure signal believable | M |
| 6 | Add API client timeout + single retry in the frontend | Prevents hanging UI during backend/upstream issues | S |
| 7 | Replace in-memory rate limiting with a distributed control | Makes abuse protection real across instances | M |
| 8 | Add post-deploy API smoke checks | Catches broken functions after successful hosting deploy | S |
| 9 | Tighten auth/CORS/error-body hygiene | Removes avoidable token and body leakage paths | S |
| 10 | Generate a provider capability matrix from adapter truth | Aligns docs, UI, and runtime behavior | M |

---

## 2. SYSTEM MAP

### Architecture
```
┌─────────────────────────────────────────────────────────┐
│                    Firebase Hosting                       │
│  frontend/ → static HTML/JS/CSS (PWA, sw.js v67)        │
│  /api/** → Cloud Function "api" (Express, Node 22)      │
└─────────────┬───────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│              Cloud Functions (2nd gen)                    │
│                                                          │
│  exports.api           onRequest  (Express app, 60+ routes)
│  exports.runAutomation onSchedule (every 1 min, UTC)     │
│  exports.refreshAemoLiveSnapshots  (every 5 min, AU/Bris)│
│  exports.runAdminOperationalAlerts (every 5 min, UTC)    │
└──┬────────┬──────────┬───────────┬──────────────────────┘
   │        │          │           │
   ▼        ▼          ▼           ▼
Firestore  FoxESS    Amber      AEMO       Sungrow  
           Cloud     API        OpenNEM    iSolarCloud
           API                             
           AlphaESS  SigenEnergy  Weather  Tesla Fleet
           OpenAPI   Various      API      API
```

### Subsystem Inventory
| Subsystem | Location | Files | Purpose |
|-----------|----------|-------|---------|
| Composition root | `functions/index.js` | 1 (1666 lines) | DI wiring, Express app, exports |
| Route modules | `functions/api/routes/` | 24 | HTTP endpoint handlers |
| API clients | `functions/api/` | 6 (foxess, amber, aemo, sungrow, alphaess, sigenergy) | Upstream API integration |
| Services | `functions/lib/services/` | 24 | Business logic |
| Repositories | `functions/lib/repositories/` | 6 | Firestore data access |
| Adapters | `functions/lib/adapters/` | 15 | Provider abstraction |
| Frontend pages | `frontend/` | 24 HTML files | 11 public + 13 authenticated |
| Frontend JS | `frontend/js/` | 29 modules | App shell, features, tools |
| Backend tests | `functions/test/` | 115 files | Jest unit/integration |
| Frontend tests | `tests/frontend/` | 21 files | Playwright E2E |
| Contract tests | `tests/scripts/` | 5 files | PWA, AEMO, release |
| Scripts | `scripts/` | 20+ | CI gates, deploy, data pipeline |
| Docs | `docs/` | 50+ files | Architecture, API, ops, runbooks |

### Key Runtime Flows
1. **User request** → Firebase Hosting → `/api/**` rewrite → Cloud Function → Express middleware (CORS, rate limit, auth, JSON parse) → route handler → service → adapter/repository → Firestore/upstream API
2. **Automation cycle** → `runAutomation` scheduled trigger → fetch all enabled users → parallel cycle execution (10 concurrent) → lock acquire → rule evaluation → action execution → metrics/audit → lock release
3. **AEMO data refresh** → `refreshAemoLiveSnapshots` → fetch 5 regions → update Firestore snapshots
4. **AEMO pipeline (CI)** → GitHub Actions daily → download CSVs → aggregate → generate market insights → deploy to hosting

### Important Integration Boundaries
- **FoxESS**: richest production path across scheduler, quick control, diagnostics, and curtailment
- **Amber**: API key auth, 429 detection, and in-flight dedup exist, but dedup is still per-process only
- **AEMO**: public data with both scheduled refreshes and a larger CI-driven pipeline for market-insights assets
- **Sungrow**: live, but control semantics are TOU-window based rather than full exact-power parity
- **AlphaESS**: live, but work-mode and scheduler semantics are narrower than FoxESS
- **SigenEnergy**: setup and limited work-mode support exist, but scheduler-backed rule execution is not implemented in the current adapter
- **Tesla**: commands depend on auth, permissions, transport readiness, and the separate signed-command proxy
- **v2 account/asset surfaces**: route modules and repositories exist on disk, but `assets` and `provider-accounts` are not mounted in the live Express app

---

## 3. FINDINGS BY DOMAIN

### Architecture

**ARCH-1: Composition root still large at 1666 lines**
- Severity: **Medium**
- Why: Despite good route extraction, `functions/index.js` still wires 60+ dependency injections, making changes risky and reviews slow
- Evidence: [functions/index.js](functions/index.js) — 1666 lines, mix of DI wiring, middleware setup, and 4 Cloud Function exports
- Impact: High cognitive load for any backend change; merge conflicts likely
- Fix: Extract DI container creation into `functions/lib/container.js`; move scheduled job handlers to `functions/lib/jobs/`
- Effort: M | Confidence: High

**ARCH-2: Provider capability truth is fragmented across adapters, frontend maps, docs, and marketing**
- Severity: **High**
- Why: Capability rules live in multiple places: adapter implementations, frontend capability maps, internal docs, and public site copy. They do not derive from one source.
- Evidence: public landing says Sigenergy and SunGrow are coming soon; authenticated setup accepts both; `shared-utils.js` disables Sigenergy scheduler/quick control; `docs/AUTOMATION.md` still describes adapter-backed schedule reads/writes for Sigenergy
- Impact: Product and support teams can form incompatible mental models of what is actually live
- Fix: Make adapters publish machine-readable capabilities and generate UI/docs from that contract
- Effort: M | Confidence: High

**ARCH-3: Unmounted v2 route modules create dark-launch surfaces**
- Severity: **Medium**
- Why: `functions/api/routes/assets.js` and `functions/api/routes/provider-accounts.js` are implemented and tested, but not registered in `functions/index.js`
- Impact: Engineers can mistake non-production APIs for live behavior; docs and future work can anchor to dead surfaces
- Fix: Either mount behind an explicit feature flag with route-baseline updates, or delete until the migration is ready
- Effort: S | Confidence: High

### Backend/API

**API-1: In-memory rate limiter resets on cold start**
- Severity: **High**
- Why: Cloud Functions scale to multiple instances and cold-start frequently. Each instance has its own rate limit state. A determined attacker can bypass limits by causing new instances.
- Evidence: [functions/lib/services/api-rate-limiter.js](functions/lib/services/api-rate-limiter.js#L12) — `const store = new Map()`
- Impact: Rate limiting is decorative under load or attack
- Fix: Use Firestore-backed rate limiting with TTL documents, or use Firebase App Check
- Effort: M | Confidence: High

**API-2: No request timeout on upstream API calls from frontend**
- Severity: **High**
- Why: `api-client.js` uses `fetch()` without `AbortController` timeout. Browser defaults vary (Chrome ~600s). Users see perpetual loading spinners.
- Evidence: [frontend/js/api-client.js](frontend/js/api-client.js) — no timeout or retry logic
- Impact: Poor UX during upstream degradation; no retry on transient failures
- Fix: Add 20s timeout with AbortController; retry once on 408/429/5xx
- Effort: S | Confidence: High

**API-3: JSON parse error leaks raw body in response**
- Severity: **Medium**
- Why: On malformed JSON, the error handler returns up to 1000 chars of raw body to the client, which could contain sensitive data if a proxy forwards bodies.
- Evidence: [functions/index.js](functions/index.js#L1191) — `raw: req.rawBody.slice(0, 1000)`
- Impact: Information disclosure risk (low probability, but unnecessary)
- Fix: Remove `raw` field from error response; log it server-side only
- Effort: S | Confidence: High

**API-4: CORS allows any localhost origin**
- Severity: **Medium**
- Why: `isLocalhost` check accepts any port on localhost/127.0.0.1 as valid CORS origin, including malicious localhost services
- Evidence: [functions/index.js](functions/index.js#L1149-L1151) — `const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'`
- Impact: Any local process can make credentialed cross-origin requests to the API in dev
- Fix: Only allow localhost in emulator mode: `isLocalhost && process.env.FUNCTIONS_EMULATOR`
- Effort: S | Confidence: High

**API-5: Token accepted via query parameter**
- Severity: **Medium**
- Why: `req.query.idToken` is accepted as auth mechanism. Query params appear in server logs, browser history, and referrer headers.
- Evidence: [functions/api/auth.js](functions/api/auth.js#L59) — `req.query.idToken`
- Impact: Token leakage via logs or referrer
- Fix: Deprecate query param auth; only support Authorization header. If redirect flows require it, use short-lived nonces instead.
- Effort: S | Confidence: High

### Automation / Scheduling / Background Jobs

**AUTO-1: Scheduler idempotency exists, but overlap windows remain**
- Severity: **High**
- Why: `automation-scheduler-service.js` already reserves per-user cycle keys and marks outcomes, but the 2-minute lock lease can still expire during slower runs and device actions themselves are not independently idempotent
- Evidence: `buildCycleKey()`, `defaultShouldRunCycleKey()`, `defaultMarkCycleOutcome()`, and `lockLeaseMs: 120000`
- Impact: Duplicate or conflicting device writes remain possible under degraded runtimes, retries, or boundary timing
- Fix: Keep the cycle-key layer, add a heartbeat or lease extension, and make downstream action application idempotent per user+window
- Effort: M | Confidence: High

**AUTO-2: Quick control and automation still race at the pre-write boundary**
- Severity: **High**
- Why: Automation pauses when `quickControlActive` is already persisted, but quick control writes the device schedule before `saveQuickControlState()` completes
- Evidence: `quick-control.js` writes `setSchedule()` or the FoxESS scheduler first and only then persists quick-control state; `automation-cycle.js` consults quick-control state to decide whether to pause
- Impact: A scheduler cycle starting in that gap can still overwrite a just-started manual override
- Fix: Reserve quick-control state before the device write and enforce a shared mutex across quick control, automation, and manual scheduler mutations
- Effort: M | Confidence: High

**AUTO-3: Live SigenEnergy schedule operations are stubbed yet return success**
- Severity: **High**
- Why: The mounted SigenEnergy adapter returns `{ errno: 0, result: { _stub: true } }` for `getSchedule()`, `setSchedule()`, and `clearSchedule()`
- Evidence: `functions/lib/adapters/sigenergy-adapter.js`, its dedicated tests, live registration in `functions/index.js`, and non-FoxESS schedule writes in `automation-rule-action-service.js` / `quick-control.js`
- Impact: Automation or control paths can report success without mutating the device, which is a trust and support problem
- Fix: Return explicit unsupported errors for scheduler-backed control on SigenEnergy until the adapter is implemented; block those write paths server-side as well as in the UI
- Effort: S | Confidence: High

**AUTO-4: Dead letter handling records failures but has no operator recovery path**
- Severity: **Medium**
- Why: Failed cycles are written with TTL, but there is no replay flow and no obvious admin surface for inspection
- Evidence: `automation-scheduler-service.js` dead-letter writes; no mounted retry UI or recovery job found
- Impact: Affected users can silently stay degraded until someone inspects raw data
- Fix: Surface DLQ depth in admin tooling and add explicit replay/ack flows
- Effort: M | Confidence: High

**AUTO-5: DST and transition-hour behavior still deserves explicit tests**
- Severity: **Medium**
- Why: Rule evaluation is heavily minute-based and timezone-aware, but there is still no focused DST regression suite for skipped and repeated local times
- Evidence: Timezone logic exists, but no dedicated DST transition tests were found
- Impact: Twice-yearly edge-case misfires remain plausible for affected users
- Fix: Add DST boundary fixtures covering both missing and repeated local-time windows
- Effort: M | Confidence: Medium

### Data Model / Storage

**DATA-1: FoxESS API token stored in readable config, not secrets**
- Severity: **Medium**
- Why: FoxESS token is functionally equivalent to a password but stored in `users/{uid}/config/main` which is client-readable per Firestore rules, unlike Sungrow/AlphaESS/SigenEnergy passwords.
- Evidence: [functions/api/routes/setup-public.js](functions/api/routes/setup-public.js) stores `foxessToken` in config; [firestore.rules](firestore.rules#L43) allows user read on config
- Impact: Token exposed to client-side code; inconsistent security posture across providers
- Fix: Move `foxessToken` to `users/{uid}/secrets/credentials`; update foxess.js to read from secrets via Admin SDK
- Effort: M | Confidence: High

**DATA-2: No field-level validation in Firestore rules**
- Severity: **Medium**
- Why: Firestore rules validate document structure (required fields) but not field values. A malicious client could write extreme values.
- Evidence: [firestore.rules](firestore.rules) — `hasRequiredFields()` checks existence, not content
- Impact: Data corruption if client bypasses frontend validation
- Fix: Add value constraints for critical fields (e.g., `resource.data.inverterCapacityW > 0 && resource.data.inverterCapacityW < 100000`)
- Effort: M | Confidence: Medium

**DATA-3: 128 MB of AEMO CSV data committed to git**
- Severity: **High**
- Why: 321 CSV files (128.6 MB) tracked in git. Bloats initial clone, increases CI time, and pollutes git history.
- Evidence: `aemo-aggregated-data/` — 321 files, `git ls-files` confirms tracked
- Impact: Slow clones (~10x larger than code alone); unnecessary CI bandwidth
- Fix: Add to `.gitignore`; download via CI action (already done in `aemo-market-insights-delta.yml`); use GCS for persistent storage
- Effort: S | Confidence: High

### Security / Auth / Secrets

**SEC-1: Emulator bypass has no production guard**
- Severity: **High**
- Why: Setup credential validation is skipped when `FUNCTIONS_EMULATOR` or `FIRESTORE_EMULATOR_HOST` is set. If these env vars leak to production, all credential validation is bypassed.
- Evidence: [functions/api/routes/setup-public.js](functions/api/routes/setup-public.js#L136-L144)
- Impact: Fake credentials could be stored, breaking automation for affected users
- Fix: Add explicit guard: `if (process.env.K_SERVICE && isEmulator) throw new Error('Emulator bypass in production')`
- Effort: S | Confidence: High

**SEC-2: Admin impersonation has no scoping or time limit**
- Severity: **Medium**
- Why: Admin creates custom tokens for any user without TTL limit or action scoping. Compromised admin = full system compromise.
- Evidence: `admin.js` — `admin.auth().createCustomToken(uid, { impersonatedBy: req.user.uid })`
- Impact: Unlimited impersonation window
- Fix: Set `expiresIn` on custom tokens (5 min max); log all impersonation actions to immutable audit; add second-factor for impersonation
- Effort: M | Confidence: High

**SEC-3: Global CSP exists, but it is too permissive to rely on strongly**
- Severity: **Medium**
- Why: Hosting sets a global `Content-Security-Policy`, but it still allows `'unsafe-inline'`, `'unsafe-eval'`, broad `https:` script/style/connect sources, and localhost connect/frame allowances
- Evidence: `firebase.json` global `**` headers block
- Impact: There is some XSS defense-in-depth, but materially less than the earlier header presence might imply
- Fix: Tighten production CSP with nonces or hashes where possible, remove localhost allowances from production config, and narrow `script-src` / `connect-src`
- Effort: M | Confidence: High

**SEC-4: Setup persists the Amber API key in localStorage**
- Severity: **Medium**
- Why: Successful setup stores `foxess_setup_amber_api_key` in localStorage, it is not read anywhere else in the frontend, and sign-out does not clear it
- Evidence: `frontend/js/setup.js` writes the key; no corresponding reader was found; `frontend/js/firebase-auth.js` sign-out clears only a small subset of keys
- Impact: Unnecessary secret persistence on shared or compromised browsers
- Fix: Stop persisting the key, or limit it to sessionStorage for the immediate redirect hop and clear it on completion
- Effort: S | Confidence: High

### Testing / QA / Contract Safety

**TEST-1: Jest coverage thresholds are too low**
- Severity: **High**
- Why: Thresholds at 20% statements / 10% branches / 5% functions allow massive test-free code to ship.
- Evidence: [functions/jest.config.js](functions/jest.config.js#L11-L17) — `statements: 20, branches: 10, functions: 5, lines: 20`
- Impact: Regressions pass CI undetected
- Fix: Raise thresholds incrementally: 50→60→70% over 90 days
- Effort: S (config change) + M (writing missing tests) | Confidence: High

**TEST-2: Frontend E2E coverage is both happy-path heavy and low-signal**
- Severity: **High**
- Why: There are still no real API failure-path specs, and many Playwright tests rely on `waitForTimeout()`, `waitForLoadState('networkidle')`, or weak assertions such as `expect(true).toBeTruthy()`
- Evidence: Broad grep across `tests/frontend/**/*.spec.js`
- Impact: Test counts overstate protection; flaky or behaviorally empty tests can pass while real regressions ship
- Fix: Replace sleeps with condition-based waits, remove truthy-placeholder assertions, and add explicit 401/503/timeout/offline scenarios
- Effort: M | Confidence: High

**TEST-3: OpenAPI checks are structural, not behavioral**
- Severity: **Medium**
- Why: `openapi-contract-check.js` validates YAML syntax and path parity, but never validates that actual API responses match the schema.
- Evidence: [scripts/openapi-contract-check.js](scripts/openapi-contract-check.js) — structural checks only
- Impact: Schema drift between spec and implementation
- Fix: Add response schema validation in integration tests using `ajv` against OpenAPI schemas
- Effort: M | Confidence: Medium

**TEST-4: No concurrent/race-condition coverage for the live control model**
- Severity: **High**
- Why: There are no tests that exercise scheduler lock expiry, quick-control pre-write races, or unsupported provider control paths end-to-end
- Evidence: Scheduler tests are sequential; no Firestore-emulator contention suite; no end-to-end test proving Sigenergy control paths fail safely
- Impact: The highest-risk production behaviors are learned from source inspection instead of CI
- Fix: Add concurrency tests with the Firestore emulator plus provider-specific "must fail, not stub-success" tests
- Effort: L | Confidence: High

**TEST-5: Firestore rules are untested**
- Severity: **Medium**
- Why: Rules exist, but no `@firebase/rules-unit-testing` suite was found
- Evidence: No Firestore rules unit test harness in repo
- Impact: Client-side validation gaps can turn into security or integrity gaps without automated guardrails
- Fix: Add rules tests for config, secrets, admin, and audit collections
- Effort: M | Confidence: High

### Performance / Cost

**PERF-1: Cold start not instrumented or mitigated**
- Severity: **Medium**
- Why: Node 22 + 512 MiB Cloud Function with multiple heavy imports. No min-instances configured. Cold start likely 500-800ms but unmeasured.
- Evidence: [functions/index.js](functions/index.js) exports; no `minInstances` in function config
- Impact: First request after idle period is slow; user-visible latency
- Fix: Set `minInstances: 1` for the API function; instrument cold start timing
- Effort: S | Confidence: High

**PERF-2: Amber in-flight dedup uses in-memory Map**
- Severity: **Low**
- Why: `amberPricesInFlight` Map prevents duplicate concurrent API calls per process, but doesn't work across instances.
- Evidence: `functions/api/amber.js` — `const amberPricesInFlight = new Map()`
- Impact: Under multi-instance load, duplicate Amber API calls still possible
- Fix: Accept as known limitation or use Firestore-based dedup
- Effort: M | Confidence: Medium

### Observability / Operations

**OPS-1: No API uptime/availability SLO**
- Severity: **High**
- Why: Only the automation scheduler has SLO monitoring. The API itself has no availability target, latency tracking, or error budget.
- Evidence: Only `automation-scheduler-metrics-sink.js` and `scheduler-slo-alert-notifier.js` exist for SLO
- Impact: API degradation goes unnoticed until users report it
- Fix: Add per-endpoint latency histograms + error rate tracking; set 99.5% availability target with alerting
- Effort: M | Confidence: High

**OPS-2: Alerting is single-channel (webhook only)**
- Severity: **Medium**
- Why: SLO alerts go to a single webhook URL. If the webhook is down, alerts are silently lost.
- Evidence: `scheduler-slo-alert-notifier.js` — single `alertWebhookUrl`
- Impact: Missed alerts during webhook outage
- Fix: Add fallback channel (email via Firebase Extensions, or Firestore-based alert queue)
- Effort: S | Confidence: High

**OPS-3: No distributed tracing across async operations**
- Severity: **Medium**
- Why: Request IDs are scoped to HTTP requests. Scheduler cycles, cron jobs, and background tasks have no correlation IDs.
- Evidence: `structured-logger.js` uses AsyncLocalStorage for HTTP only
- Impact: Hard to trace a scheduler failure back to the triggering cron invocation
- Fix: Generate and propagate `cycleId` through all scheduler phases; include in metrics
- Effort: M | Confidence: Medium

### Docs / Repo Hygiene / Dead Code

**HYGIENE-1: 10 one-off debug scripts tracked in git**
- Severity: **Medium**
- Why: Files like `check-cache-config.js`, `debug-amber-cache.js`, `test-api-endpoints.js` are tracked in git, add noise, and contain hardcoded config/paths.
- Evidence: `git ls-files` confirms 10 files tracked; none referenced from `package.json`
- Impact: Repo clutter; risk of confusion with real scripts
- Fix: Delete from repo; add `*.debug.js` and `tmp-*.js` to `.gitignore`
- Effort: S | Confidence: High

**HYGIENE-2: `runAdminOperationalAlerts` is still under-documented**
- Severity: **Medium**
- Why: Third scheduled Cloud Function not mentioned in `docs/BACKGROUND_AUTOMATION.md`
- Evidence: [functions/index.js](functions/index.js) exports 3 scheduled functions; docs only describe 2
- Impact: Operators may not know about operational alerting
- Fix: Add to `BACKGROUND_AUTOMATION.md`
- Effort: S | Confidence: High

**HYGIENE-3: Provider maturity messaging is split across public, private, and runtime surfaces**
- Severity: **High**
- Why: Public marketing still says Sigenergy and SunGrow are coming soon, the authenticated product supports setup for both, the capability guide says SigenEnergy is supported with narrower maturity, and automation docs still describe adapter-backed schedule reads/writes
- Evidence: `frontend/index.html`, `frontend/js/setup.js`, `docs/guides/PRODUCT_CAPABILITY_GUIDE.md`, `docs/AUTOMATION.md`
- Impact: Users and engineers can form incompatible mental models of what is actually live
- Fix: Publish one capability matrix derived from adapter truth and reuse it across marketing, setup, dashboard, and internal docs
- Effort: M | Confidence: High

### SEO / Metadata / Crawlability

**SEO-1: Service worker offline fallback ignores auth state**
- Severity: **Low**
- Why: Offline fallback serves `/app.html` regardless of whether user is authenticated. An unauthenticated user hitting offline mode sees the app shell instead of login page.
- Evidence: [frontend/sw.js](frontend/sw.js#L10) — `OFFLINE_FALLBACK_PAGE = '/app.html'`
- Impact: Confusing UX for unauthenticated offline users; minor
- Fix: Add auth check or serve `/login.html` as offline fallback for unauthenticated
- Effort: S | Confidence: Low

**SEO-2: App pages don't set dynamic `document.title`**
- Severity: **Low**
- Why: Authenticated pages share generic title. Browser tabs and bookmarks all show same name.
- Evidence: No `document.title` assignment found in page controllers
- Impact: Poor browser tab UX; accessibility issue for screen readers navigating tabs
- Fix: Set `document.title = 'Dashboard | SoCrates'` etc. in `app-shell.js` based on current page
- Effort: S | Confidence: High

---

## 4. DOCS VS CODE MISMATCHES

| # | Document | Claim | Reality | Severity |
|---|----------|-------|---------|----------|
| 1 | `BACKGROUND_AUTOMATION.md` | Lists 2 scheduled functions | Code exports 3 (`runAdminOperationalAlerts` missing) | Medium |
| 2 | `AUTOMATION.md` | Sungrow, SigenEnergy, and AlphaESS use adapter-backed schedule reads and writes | Sungrow and AlphaESS do; SigenEnergy schedule methods are stub/no-op and the dashboard hides scheduler editing | High |
| 3 | `AUTOMATION.md` | Work-mode lists read as broadly shared capability | AlphaESS and SigenEnergy reject `Backup`; SigenEnergy only exposes a limited live work-mode subset | Medium |
| 4 | `SETUP.md` and `PRODUCT_CAPABILITY_GUIDE.md` | SigenEnergy is supported with narrower maturity | Directionally true, but it understates that scheduler-backed rule execution is not implemented and server paths can still stub-success if called | High |
| 5 | `frontend/index.html` | Sigenergy and SunGrow integration is coming soon | Authenticated setup already accepts both providers and internal product surfaces expose partial live support | Medium |
| 6 | `API.md` | API surface documentation omits response rate-limit headers | API emits `X-RateLimit-*` headers | Low |
| 7 | No doc | No documentation on admin impersonation capabilities or constraints | Admin can impersonate any user without an explicit scoped expiry policy | Medium |
| 8 | No doc | No documentation on unmounted v2 `assets` / `provider-accounts` surfaces | Route modules and tests exist, but the routes are not live | Medium |

---

## 5. TEST GAP ANALYSIS

### Well-Tested
- Automation rule evaluation (conditions, operators, priorities)
- Device variable normalization (exhaustive firmware alias coverage)
- Adapter contracts (interface compliance for device, tariff, EV, payment)
- SigenEnergy's current stub behavior is explicitly tested, which confirms it is a known limitation rather than an accidental omission
- API call leak prevention (phantom call detection)
- Cache date-range filtering, dedup, merge
- Billing webhook idempotency
- ROI calculation correctness
- Timezone and midnight-crossing edge cases

### Under-Tested
- Frontend error paths (0 meaningful tests for API failure, timeout, 401 expiry)
- Negative auth paths (expired/wrong tokens, missing headers)
- Provider-specific error codes and fallback behavior
- Provider control safety semantics (unsupported paths should fail loudly, not return stub success)
- Feature flag integration effects on business logic
- Input validation edge cases (boundary values, malformed data)
- Automation scheduler concurrent execution
- Frontend happy-path specs often use sleeps, `networkidle`, and weak truthy assertions, lowering confidence

### Missing Entirely
- **Concurrent lock contention** (two cycles same user)
- **Quick control + automation race** (simultaneous device writes)
- **DST boundary rule evaluation**
- **Firestore security rules** (no rules-unit-testing-library tests)
- **Provider fail-safe control tests** (e.g. Sigenergy control must error, not stub-success)
- **Load/stress testing** (no k6, artillery, or equivalent)
- **Offline/service worker behavior** (no PWA offline tests)
- **Cross-tab state synchronization**
- **Memory leak detection** (intervals, event listeners)
- **AEMO data pipeline end-to-end** (CSV download → aggregation → hosting)

### Highest-Value New Tests
1. **Frontend API error and offline scenarios** (401, 503, timeout, empty data, offline fallback)
2. **Concurrent automation cycle lock and lease contention** (Jest + Firestore emulator)
3. **Quick control + automation pre-write mutex behavior**
4. **Firestore security rules unit tests** (using `@firebase/rules-unit-testing`)
5. **Provider fail-safe control behavior** (especially Sigenergy must-error rather than stub-success)

---

## 6. DEAD CODE / STALE SURFACES / HYGIENE

### Likely Dead Modules
| File | Evidence | Action |
|------|----------|--------|
| `check-cache-config.js` | Debug script, no reference | Delete |
| `check-inverter-api.js` | Debug script, hardcoded URL | Delete |
| `debug-amber-cache.js` | Debug script, no reference | Delete |
| `debug-cache-ttl.js` | Debug script, no reference | Delete |
| `diagnose-amber.js` | Debug script, no reference | Delete |
| `test-api-endpoints.js` | Debug script, no reference | Delete |
| `test-cache-function.js` | Debug script, no reference | Delete |
| `test-cache-read.js` | Debug script, no reference | Delete |
| `tmp-fix-conflict.js` | One-off git merge helper | Delete |
| `verify-seed.js` | Debug script, no reference | Delete |
| `disable-user-automation.js` | Useful but misplaced | Move to `scripts/` |

### Unmounted Runtime Surfaces
| Surface | Evidence | Action |
|---------|----------|--------|
| `functions/api/routes/assets.js` | Implemented and unit-tested, but not mounted in `functions/index.js` | Mount behind explicit feature flag or delete until live |
| `functions/api/routes/provider-accounts.js` | Implemented and unit-tested, but not mounted in `functions/index.js` | Mount behind explicit feature flag or delete until live |

### Stale/Redundant Data
| Item | Size | Status |
|------|------|--------|
| `aemo-aggregated-data/` | 128.6 MB (321 files) | Move to .gitignore; download via CI |
| `tmp-user-debug-hudakharrufa.json` | PII file | Not tracked (safe), but should not exist on disk |
| `emulator.pid` | Runtime artifact | Add to .gitignore |
| `.tmp-lighthouse-*.json` | Build artifact | Add to .gitignore |

### Naming That Obscures Reality
- `disable-user-automation.js` in root suggests it's a core script; it's a one-off admin tool
- `test-*.js` root files look like test suites but are debug scripts
- `functions/index.js` at 1666 lines is more than "composition root" — it's still partly a monolith

---

## 7. PRIORITIZED IMPROVEMENT ROADMAP

### Next 7 Days
1. Return explicit unsupported errors for SigenEnergy scheduler-backed write paths
2. Delete tracked root debug scripts and ignore runtime artifacts that do not belong in git
3. Add 20s timeout + single retry to frontend `api-client.js`
4. Remove `raw` body field from JSON parse error responses
5. Restrict localhost CORS allowances to emulator or dev mode only
6. Stop persisting the Amber API key in localStorage
7. Add a post-deploy API smoke check to `firebase-deploy.yml`
8. Raise Jest thresholds modestly and clean the noisiest Playwright `waitForTimeout()` / `expect(true)` patterns

### Next 30 Days
9. Add shared mutexing between quick control, automation, and manual scheduler mutations
10. Add scheduler lease heartbeat and action-level idempotency hardening
11. Replace in-memory rate limiting with a distributed mechanism
12. Move `foxessToken` to the secrets collection
13. Tighten the global CSP and strip localhost allowances from production headers
14. Add 5-10 frontend error, offline, and auth-expiry E2E tests
15. Publish a single provider capability matrix generated from adapter truth
16. Document `runAdminOperationalAlerts`, admin impersonation limits, and dark-launch route surfaces
17. Decide whether to mount or remove the `assets` and `provider-accounts` v2 routes
18. Add a production guard for emulator bypass env vars

### Next 90 Days
19. Add Firestore security rules unit tests
20. Add API uptime or availability SLOs and per-endpoint latency/error metrics
21. Add concurrency tests for scheduler lease expiry and quick-control races
22. Introduce a user-scoped browser cache model and consistent sign-out cleanup
23. Extract DI and container wiring out of `functions/index.js`
24. Raise coverage thresholds again after the new tests land
25. Add a staging or canary deployment flow
26. Instrument cold-start timing and evaluate `minInstances`

### Later Strategic Work
27. Make provider capability declarations first-class in adapters and generate docs or UI from them
28. Build explicit replay and operator workflows for automation dead letters
29. Implement real SigenEnergy scheduler or Northbound control support, or demote the integration to read-only or setup-only
30. Add automated load testing to CI
31. Revisit frontend state management for multi-tab coherence and long-lived event cleanup
32. Normalize the v2 provider or account rollout so dark-launch route surfaces disappear

---

## 8. QUICK WINS (High Impact, Low Effort)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | Return explicit unsupported errors for Sigenergy scheduler writes | Stops false-success control paths | S |
| 2 | Delete 10 root debug scripts | Cleaner repo and fewer misleading surfaces | S |
| 3 | Ignore `aemo-aggregated-data/`, `emulator.pid`, and temp artifacts | Smaller clones and less repo noise | S |
| 4 | Add 20s fetch timeout and single retry in `api-client.js` | Prevents hanging UI | S |
| 5 | Remove `raw` body from parse errors | Closes an avoidable information leak | S |
| 6 | Restrict localhost CORS to emulator or dev mode | Tightens the local auth surface | S |
| 7 | Stop storing the Amber API key in localStorage | Reduces browser secret exposure | S |
| 8 | Add post-deploy API smoke check | Finds broken functions sooner | S |
| 9 | Document `runAdminOperationalAlerts` and capability caveats | Reduces support confusion | S |
| 10 | Set page-specific `document.title` values | Low-cost UX and accessibility gain | S |

---

## 9. DEEP REFACTOR CANDIDATES

### 1. Automation Control Serialization Overhaul
**Scope:** `automation-scheduler-service.js`, scheduler mutations, quick-control routes, action-application layer
**Why:** Cycle-key idempotency already exists, but scheduler leasing, manual control, and downstream device writes are still not unified into one safe serialization model.
**Approach:** Keep the existing cycle-key layer, add lease heartbeat, introduce one action ledger or mutex across automation/manual writes, and make provider writes idempotent per user/window.
**Effort:** L | Risk: Medium (touches the critical control path)

### 2. DI Container Extraction
**Scope:** `functions/index.js` → `functions/lib/container.js`
**Why:** 1666-line composition root is a bottleneck for review and testing. All 60+ dependency wirings are co-located.
**Approach:** Extract dependency creation into a testable container module; index.js becomes ~300 lines of Express setup + exports.
**Effort:** L | Risk: Low (mechanical refactor)

### 3. Frontend State and Browser Cache Model
**Scope:** `api-client.js`, `firebase-auth.js`, `app-shell.js`, `dashboard.js`, page controllers
**Why:** Browser storage is a mix of generic localStorage keys, partial sign-out cleanup, and page-level state assumptions. This is survivable now, but brittle as providers and admin impersonation grow.
**Approach:** Introduce user-scoped cache keys, centralized invalidation, a single token-refresh path, and explicit lifecycle cleanup for long-lived listeners or intervals.
**Effort:** L | Risk: Medium (touches all frontend modules)

### 4. Provider Parity Framework
**Scope:** All adapters, docs, UI
**Why:** Five inverter providers sit at different maturity levels, and the current capability truth is duplicated across code, docs, and marketing.
**Approach:** Codify capability declarations in adapters (for example `supportedWorkModes`, `supportsScheduler`, `supportsDiagnostics`, `controlMode`); surface them in setup and dashboard UI; generate docs automatically.
**Effort:** L | Risk: Low

---

## 10. FINAL TOP 20 ACTIONS

| Rank | Action | Severity | Effort | Category |
|------|--------|----------|--------|----------|
| 1 | Return explicit unsupported errors for SigenEnergy scheduler or control writes | High | S | Product/Reliability |
| 2 | Add quick-control ↔ automation pre-write mutex | High | M | Reliability |
| 3 | Harden scheduler lease handling with heartbeat and action-level idempotency | High | M | Reliability |
| 4 | Move AEMO CSV data out of git | High | S | Hygiene |
| 5 | Raise Jest thresholds and remove low-signal Playwright assertions or waits | High | M | Testing |
| 6 | Add frontend API timeout + retry | High | S | UX |
| 7 | Replace in-memory rate limiter | High | M | Security |
| 8 | Add production emulator env guard | High | S | Security |
| 9 | Delete root debug scripts | Medium | S | Hygiene |
| 10 | Add post-deploy API smoke check | High | S | Operations |
| 11 | Move `foxessToken` to secrets | Medium | M | Security |
| 12 | Tighten CSP and remove production localhost allowances | Medium | M | Security |
| 13 | Stop persisting the Amber API key in localStorage | Medium | S | Security |
| 14 | Restrict localhost CORS to emulator | Medium | S | Security |
| 15 | Remove raw body from JSON errors | Medium | S | Security |
| 16 | Publish provider capability matrix from adapter truth | High | M | Product/Docs |
| 17 | Decide fate of unmounted `assets` and `provider-accounts` routes | Medium | S | Architecture |
| 18 | Add Firestore security rules tests | Medium | M | Testing |
| 19 | Add API uptime or availability SLO | High | M | Operations |
| 20 | Add frontend error, offline, and auth-expiry E2E tests | High | M | Testing |

---

*End of review. This document should be treated as a living engineering backlog input, not a final scorecard. Priorities should be adjusted based on current user load, upcoming feature plans, and team capacity.*

