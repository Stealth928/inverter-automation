# Comprehensive Codebase Audit & Remediation Plan
**Date**: March 25, 2026  
**Scope**: Full-spectrum audit covering security, resilience, observability, data model, testing, and deployment  
**Status**: In progress (execution updated through March 25, 2026)

---

## Executive Summary

This audit extends the prior 7-finding scheduler observability analysis into a complete 20-finding assessment across 7 critical categories. The codebase has strong fundamentals (104 tests, solid dead-letter queue, proper auth middleware composition) but suffers from observability blind spots, resilience gaps, and silent error suppression patterns that undermine operational confidence.

**Key Risk Areas**:
- 28+ silent error swallowing sites (especially dangerous in scheduler mutations and vehicle cleanup)
- No circuit breakers for upstream APIs (FoxESS, Weather, Sungrow)
- Observability distortions in scheduler metrics (max-of-max aggregation, mixed-unit charts)
- No structured logging or request correlation IDs
- Untracked Firestore read/write costs (~30M reads/month at 100 users)

### Execution Snapshot (2026-03-25)

**Completed in repo**:
- Silent error handling fixes in scheduler/config/vehicle cleanup flows
- Admin-only global metrics, bounded user metrics queries, enabled-only rules lookups
- CORS allowlist, CSP, and targeted frontend XSS hardening
- Scheduler p95 queue-lag surfacing and API health chart split
- Request ID middleware and structured JSON logging foundation with AsyncLocalStorage context propagation
- Provider counter normalization for FoxESS, Amber, Weather, Sungrow, and EV/Tesla billable upstream calls
- Shared upstream circuit breakers for FoxESS, Weather, and Sungrow
- `/api/health` upstream status surface with cached probe state
- Dead-letter admin read model, UI panel, and manual retry action
- API-level rate limiting on `/api/**`
- Scheduler no-op reduction via idempotency preflight before lock acquisition
- Firestore quota monitoring and cache hit/miss visibility in admin operator metrics
- `Promise.allSettled()` graceful degradation for automation-cycle upstream fan-out

**Still remaining**:
- Broader conversion of legacy `console.*` logging call-sites to structured logger usage
- Larger long-term architecture items in Phase 4

---

## SECTION A — Prior Findings (7 items)

### A1. Queue Lag Rises with Bounded Concurrency
- **File**: [functions/lib/services/automation-scheduler-service.js](../functions/lib/services/automation-scheduler-service.js#L110-L125)
- **Root Cause**: Default `maxConcurrentUsers: 10` processes serial cohorts; as user count grows, queue lag increases linearly
- **Impact**: Dashboard shows rising latency; real cause is scale, not regression
- **Mitigation**: Increase concurrency limit or implement per-shard scheduler instances

### A2. SLO Card Max-of-Max Aggregation Overstates Problems
- **File**: [functions/api/routes/admin.js](../functions/api/routes/admin.js#L3525-L3735)
- **Root Cause**: Daily aggregation uses `Math.max(summary.maxQueueLagMs, day.maxQueueLagMs)` twice (lines 3525+, 3729+)
- **Impact**: One outlier per day poisons the entire 24h and 14d windows
- **Fix**: Use percentile aggregation (p95) instead of max

### A3. API Health Chart Mixes Incompatible Metric Types
- **File**: [functions/api/routes/admin.js](../functions/api/routes/admin.js#L2170-L2326), [frontend/js/admin.js](../frontend/js/admin.js#L3241-L3290)
- **Root Cause**: Chart overlays "Provider calls" (Firestore rollups) with "Function executions" (Cloud Monitoring whole-service) on different y-axes
- **Impact**: Metrics appear correlated when they're independent; rate/absolute value confusion
- **Fix**: Split into two separate charts or normalize units

### A4. Provider Call Counting Inconsistent Across Providers
- **FoxESS** ([functions/api/foxess.js](../functions/api/foxess.js#L128)): Counts after success, excludes rate limits
- **Amber** ([functions/api/amber.js](../functions/api/amber.js#L71)): Counts before response at 3 sites
- **Weather** ([functions/lib/services/weather-service.js](../functions/lib/services/weather-service.js#L48)): Counts before response
- **EV** ([functions/api/routes/ev.js](../functions/api/routes/ev.js#L540)): Counts once per route, not per upstream call
- **Impact**: API budgets/usage appear inaccurate; can't reliably predict costs
- **Fix**: Normalize all to count every HTTP call attempt (pre-upstream, before retry) at a central point

### A5. Tail Alerting Thresholds Conflict with Card Alarms
- **Cards**: P99 > threshold → "BREACH" (implies urgent action)
- **Tail alerting** ([functions/lib/services/automation-scheduler-metrics-sink.js](../functions/lib/services/automation-scheduler-metrics-sink.js#L583-L585)): Requires 100% of tail runs above threshold OR ≥80% above threshold → "WATCH"
- **Impact**: Cards over-alert; tail alerts under-deliver context
- **Fix**: Unify thresholds and clearly document what each means

### A6. Scheduler Burns Capacity on No-Op Cycles
- **File**: [functions/lib/services/automation-scheduler-service.js](../functions/lib/services/automation-scheduler-service.js#L823-L860)
- **Root Cause**: 100+ lock-skipped or idempotent-skipped cycles per minute consume scheduling slots without doing work
- **Impact**: With 100 users on 10-second intervals, many hit the 1-minute scheduler; only 1% executed
- **Fix**: Make scheduler interval-aware or implement smarter candidate filtering

### A7. Parallel Upstream Fan-Out Amplifies Failure Coupling
- **File**: [functions/api/routes/automation-cycle.js](../functions/api/routes/automation-cycle.js#L596-L614)
- **Pattern**: `Promise.all([fetchFoxESS, fetchAmber, fetchWeather])`
- **Impact**: If any upstream slow/down, entire cycle blocks (or times out); affects all 100 users simultaneously
- **Fix**: Use `Promise.allSettled()` + graceful degradation; implement upstream-specific timeouts and circuit breakers

---

## SECTION B — New Findings (13 items)

### B1. No Circuit Breakers for FoxESS, Weather, Sungrow
**Severity**: HIGH | **Effort**: Medium | **Category**: Resilience

**Files Affected**:
- [functions/api/foxess.js](../functions/api/foxess.js)
- [functions/api/sungrow.js](../functions/api/sungrow.js)
- [functions/lib/services/weather-service.js](../functions/lib/services/weather-service.js)

**Problem**: When an upstream API fails (e.g., FoxESS 500), every automation cycle immediately retries with exponential backoff at the individual request level, but no provider-level circuit breaker exists. With 100 users on 1-minute cycles, a FoxESS outage generates 100 failing requests per minute with no reduction in traffic to FoxESS.

**Solution**: Implement shared-state circuit breaker (similar to [automation-scheduler-service.js:401-424](../functions/lib/services/automation-scheduler-service.js#L401)) that:
1. Counts consecutive failures per provider
2. Opens circuit after threshold (e.g., 3 failures)
3. Skips API calls for 60-90s
4. Probes with one request to detect recovery

**Estimated Cost**: $0 (no additional API calls; reduces load)

---

### B2. Silent Error Swallowing in Scheduler Mutations
**Severity**: HIGH | **Effort**: Low | **Category**: Correctness

**High-Risk Sites**:

| Location | Pattern | Consequence |
|----------|---------|-------------|
| [scheduler-mutations.js:59](../functions/api/routes/scheduler-mutations.js#L59) | `.getSchedule().catch(() => null)` | Device schedule updated in API; verification fails silently → user believes change persisted, but next cycle sees stale state |
| [scheduler-mutations.js:113](../functions/api/routes/scheduler-mutations.js#L113) | `.catch(() => {})` on automation flag set | Automation enable/disable flag write fails silently → user thinks automation is off, but it's still running |
| [vehicles-repository.js:38,53](../functions/lib/repositories/vehicles-repository.js#L38,53) | `.catch(() => {})` on vehicle tree delete | Vehicle deletion incomplete → orphaned Tesla OAuth tokens remain in Firestore; privacy/data leakage risk |
| [config-mutations.js:320](../functions/api/routes/config-mutations.js#L320) | `.catch(() => {})` on secrets deletion | Credential clear fails silently → stale provider passwords persist; security risk |

**Solution**: Replace silent catches with:
1. Log the error with context (user ID, operation, attempt count)
2. Return error to client with user-friendly message
3. Consider retry-after for transient failures
4. For non-safety-critical operations (metrics), at minimum log to Cloud Logging for visibility

**Example Fix**:
```javascript
// Before:
await device adapter.getSchedule(context).catch(() => null)

// After:
try {
  const schedule = await deviceAdapter.getSchedule(context);
  if (!schedule) throw new Error('Verification returned empty');
  return schedule;
} catch (e) {
  logger.warn('[Scheduler] Schedule verification failed after mutation', {
    userId, deviceSn: maskValue(sn), error: e.message, attempt: 2
  });
  // Return 500 or marked response indicating verification failed
  throw e;
}
```

---

### B3. No Correlation/Request IDs for Distributed Tracing
**Severity**: HIGH | **Effort**: Medium | **Category**: Observability

**Problem**: When debugging a user's failed automation cycle:
- Scheduler logs one event (timestamps only)
- Cycle handler logs another event (separate log line)
- Provider API logs a third (different service)
- Dead letter queue records a fourth

No way to correlate all four using a single request ID.

**Solution**: 
1. Add request ID middleware at [functions/index.js](../functions/index.js#L900-L950) that generates or extracts a trace ID
2. Pass trace ID through all async calls and log it in every statement
3. Export trace ID to Cloud Logging metadata
4. For scheduler cycles, use `cycleKey` as trace ID (already exists)

---

### B4. Unauthenticated Global Metrics Endpoint
**Severity**: MEDIUM | **Effort**: Low | **Category**: Security

**File**: [functions/api/routes/metrics.js](../functions/api/routes/metrics.js#L115-L206)

**Problem**: `GET /api/metrics/api-calls?scope=global` returns platform-wide API call counts to ANY unauthenticated user, exposing platform usage patterns (user volumes, provider distribution, call trends).

**Fix**: Add auth check:
```javascript
if (scope === 'global') {
  const uid = req.user?.uid;
  if (!uid || !isAdmin(uid)) {
    return res.status(401).json({ errno: 401, error: 'Unauthorized' });
  }
}
```

---

### B5. CORS Origin Wildcard
**Severity**: MEDIUM | **Effort**: Low | **Category**: Security

**File**: [functions/index.js](../functions/index.js#L908)

**Current**: `app.use(cors({ origin: true }))` — allows any origin

**Fix**: Restrict to known domains:
```javascript
app.use(cors({
  origin: [
    'https://socratesautomation.com',
    'https://www.socratesautomation.com'
  ],
  credentials: true
}));
```

---

### B6. XSS via innerHTML with Unescaped Error Messages
**Severity**: MEDIUM | **Effort**: Low | **Category**: Security

**Locations**:
- [frontend/js/admin.js](../frontend/js/admin.js#L1047): `Failed to load users: ${e.message}`
- [frontend/js/admin.js](../frontend/js/admin.js#L4131): `Failed to load stats: ${e.message}`
- [frontend/js/admin.js](../frontend/js/admin.js#L1167,1618,2040,2293,3248,3708,4007,4052,4100): showMessage() calls with unescaped `${e.message}`
- [frontend/js/shared-utils.js](../frontend/js/shared-utils.js#L46): `messageArea.innerHTML = ... ${message}` (directly unsanitized)
- [frontend/js/dashboard.js](../frontend/js/dashboard.js#L2529): `Error: ${e.message}` in innerHTML

**Risk**: Low-to-medium (errors originate mostly from our backend), but if upstream API is compromised, could reflect HTML into admin pages.

**Fix**: Either use `textContent` for error messages, or consistently apply `escapeHtml()` before innerHTML:
```javascript
// Preferred:
const errorEl = document.createElement('p');
errorEl.textContent = `Failed to load stats: ${e.message}`;
document.getElementById('statsDrawerBody').appendChild(errorEl);

// Or:
document.getElementById('statsDrawerBody').innerHTML = 
  `<p>Failed to load stats: ${escapeHtml(e.message)}</p>`;
```

---

### B7. Missing CSP Header
**Severity**: MEDIUM | **Effort**: Low | **Category**: Security

**File**: [firebase.json](../firebase.json#L374-L389)

**Current State**: `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` present, but **no Content-Security-Policy header**.

**Fix**: Add to firebase.json:
```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.firebaseio.com https://www.googleapis.com; img-src 'self' data: https:; font-src 'self' data:; frame-ancestors 'none';"
}
```

---

### B8. No API-Level Rate Limiting
**Severity**: MEDIUM | **Effort**: Medium | **Category**: Security

**Problem**: No per-user or per-endpoint rate limiting. A single user could exhaust the function's `maxInstances: 20` quota with rapid requests.

**Solution**: Add `express-rate-limit` middleware:
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // max 100 requests per minute per IP
  keyGenerator: (req) => req.user?.uid || req.ip, // Rate limit by user ID if authenticated
  skip: (req) => req.path.startsWith('/api/health'), // Exempt health checks
  message: { errno: 429, error: 'Too many requests' }
});

app.use('/api', limiter);
```

---

### B9. N+1 Query in getUserRules()
**Severity**: MEDIUM | **Effort**: Low | **Category**: Cost

**File**: [functions/lib/repositories/user-automation-repository.js](../functions/lib/repositories/user-automation-repository.js#L92-L108)

**Current**: Fetches ALL rules (enabled + disabled):
```javascript
const rulesSnapshot = await db.collection('users').doc(userId)
  .collection('rules').get(); // 1 read + N documents
```

**Improvement**: Filter at query time:
```javascript
const rulesSnapshot = await db.collection('users').doc(userId)
  .collection('rules')
  .where('enabled', '==', true) // Only fetch enabled rules
  .get();
```

**Savings**: ~30-40% fewer reads for users with many disabled rules.

---

### B10. User-Scope Metrics Unbounded Collection Scan
**Severity**: MEDIUM | **Effort**: Low | **Category**: Cost

**File**: [functions/api/routes/metrics.js](../functions/api/routes/metrics.js#L149-L170)

**Current**: 
```javascript
const metricsSnapshot = await db.collection('users').doc(userId)
  .collection('metrics').get(); // Reads ALL metrics docs, then slices in code
```

**Fix**: Use query limit + date range:
```javascript
const metricsSnapshot = await db.collection('users').doc(userId)
  .collection('metrics')
  .orderBy('__name__', 'desc')
  .limit(days) // Only fetch required days
  .get();
```

---

### B11. Dead Letter Queue Not Surfaced in Admin UI
**Severity**: MEDIUM | **Effort**: Medium | **Category**: Observability

**Problem**: Dead-letter queue exists and works well (see A), but admins must query Firestore directly to see queue depth, error distribution, or cycle keys since retry.

**Solution**: Add admin dashboard panel showing:
- Dead-letter count (last 24h, last 7d)
- Top error types
- Retry-ready cycles (oldest first)
- Manual retry button per cycle

**Files to Modify**:
- [functions/api/routes/admin.js](../functions/api/routes/admin.js) — add `/api/admin/dead-letters` endpoint
- [frontend/js/admin.js](../frontend/js/admin.js) — add panel in diagnostics section

---

### B12. Health Endpoint Doesn't Probe Upstream Services
**Severity**: MEDIUM | **Effort**: Medium | **Category**: Monitoring

**File**: [functions/api/routes/health.js](../functions/api/routes/health.js#L18-L54)

**Current**: Only checks whether user has credentials saved; doesn't validate they work.

**Enhancement**:
1. Add optional cache-controlled probes to FoxESS, Amber, Weather (every 5-10 minutes)
2. Return service-level health status
3. Export circuit breaker states
4. Return HTTP 503 if critical services unavailable

---

### B13. No Structured Logging
**Severity**: HIGH | **Effort**: High | **Category**: Observability

**Problem**: 
- All logging via `console.log/warn/error` or passthrough logger objects
- No JSON-structured metadata
- No log severity filtering in production
- Can't query logs in Cloud Logging by context (user ID, cycle key, provider)

**Solution**: Adopt Winston or Pino for structured logging:
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'automation-api' },
  transports: [
    new winston.transports.Console()
  ]
});

// Usage:
logger.error('Automation cycle failed', {
  userId,
  cycleKey,
  provider: 'foxess',
  errorMessage: e.message,
  attempt: 2
});
```

**Effort**: High due to pervasive console.log usage across 100+ files, but high ROI for production debugging.

---

## SECTION C — Cost Projections

### Monthly Firestore Cost at 100 Active Users

**Assumptions**:
- 100 active users
- 3 rules per user (average)
- 1-minute automation cycle interval
- 10 concurrent maximum

**Per-Minute Breakdown**:

| Phase | Reads | Writes |
|-------|-------|--------|
| Discovery query (enabled users) | 1 | 0 |
| Per-user eligibility check (100 × (4 + 3 rules)) | 700 | 0 |
| Lock acquisition (100 attempt, 10 concurrent) | 50 | 10 |
| Cycle execution (10 concurrent) | 40 | 30 |
| Metrics sink (per-run + daily aggregate) | 20 | 20 |
| **Total per minute** | **811** | **60** |

**Monthly Projection**:
- Reads: 811 × 60 × 24 × 30 = **34.8M reads** @ $0.06/100k = **$20.88**
- Writes: 60 × 60 × 24 × 30 = **2.6M writes** @ $0.18/100k = **$4.68**
- **Total: ~$25.56/month**

**Optimization Opportunities**:
- Apply `.where('enabled', '==', true)` → save ~30% reads (~$6.26/month)
- Batch rule updates instead of individual writes → save ~20% writes (~$0.94/month)
- Aggregate metrics less frequently → save ~10% writes (~$0.47/month)

---

## SECTION D — 20-Item Priority Matrix

| # | Finding | Severity | Effort | Category | Monthly Savings | Timeline |
|---|---------|----------|--------|----------|-----------------|----------|
| **1** | Fix max-of-max SLO aggregation | HIGH | Low | Observability | — | Week 1 |
| **2** | Fix mixed-unit API health chart | HIGH | Low | Observability | — | Week 1 |
| **3** | Silent error → logging in scheduler mutations | HIGH | Low | Correctness | — | Week 1 |
| **4** | No correlation/request IDs | HIGH | Medium | Observability | — | Week 2 |
| **5** | No circuit breakers (FoxESS, Weather, Sungrow) | HIGH | Medium | Resilience | — | Week 2-3 |
| **6** | No structured logging | HIGH | High | Observability | — | Week 3-4 |
| **7** | N+1 getUserRules() query | MEDIUM | Low | Cost | $6.26 | Week 1 |
| **8** | User metrics unbounded scan | MEDIUM | Low | Cost | — | Week 1 |
| **9** | Provider counter inconsistency | MEDIUM | Medium | Observability | — | Week 2 |
| **10** | Silent error swallowing (vehicles, config) | MEDIUM | Low | Correctness | — | Week 1 |
| **11** | Unauthenticated global metrics endpoint | MEDIUM | Low | Security | — | Week 1 |
| **12** | CORS origin wildcard | MEDIUM | Low | Security | — | Week 1 |
| **13** | XSS via innerHTML (admin/shared-utils) | MEDIUM | Low | Security | — | Week 1 |
| **14** | Missing CSP header | MEDIUM | Low | Security | — | Week 1 |
| **15** | No API-level rate limiting | MEDIUM | Medium | Security | — | Week 2 |
| **16** | Dead letter queue UI surface | MEDIUM | Medium | Observability | — | Week 2 |
| **17** | Health endpoint shallow (doesn't probe) | MEDIUM | Medium | Monitoring | — | Week 2 |
| **18** | Scheduler burns capacity on no-ops | MEDIUM | High | Performance | — | Week 3 |
| **19** | Prior: Queue lag structural rise | MEDIUM | Medium | Observability | — | Week 3 |
| **20** | Prior: Parallel fan-out failure coupling | MEDIUM | Medium | Resilience | — | Week 3 |

---

## SECTION E — 4-Phase Execution Plan

### Phase 1: Quick Wins (Week 1 — 5 days, Low Effort/High Impact)

**Goals**: De-risk critical bugs, fix observability distortions, improve security posture

**Tasks**:

1. **Fix SLO card max-of-max aggregation** (functions/api/routes/admin.js)
   - Replace line 3525, 3526, 3529, 3729, 3730, 3733, 3734, 3735 with percentile logic
   - Use P95 instead of MAX for queueLagMs, cycleDurationMs
   - Effort: 2 hours

2. **Fix API health chart mixed units** (functions/api/routes/admin.js + frontend/js/admin.js)
   - Split into two charts or normalize to per-user rates
   - Effort: 2 hours

3. **Fix scheduler mutation error handling** (functions/api/routes/scheduler-mutations.js)
   - Replace `.catch(() => null)` with proper logging and error return
   - Lines 59, 85, 111, 113
   - Effort: 1 hour

4. **Fix vehicle deletion silent errors** (functions/lib/repositories/vehicles-repository.js)
   - Log error on line 38, 53
   - Effort: 30 minutes

5. **Fix config mutation secret cleanup error** (functions/api/routes/config-mutations.js)
   - Log error on line 320
   - Effort: 30 minutes

6. **Restrict CORS origin** (functions/index.js:908)
   - Change `origin: true` to `origin: ['https://socratesautomation.com', 'https://www.socratesautomation.com']`
   - Effort: 15 minutes

7. **Restrict metrics endpoint to authenticated users** (functions/api/routes/metrics.js)
   - Add auth check for `scope=global`
   - Effort: 30 minutes

8. **Fix frontend XSS in admin/shared-utils** (frontend/js/admin.js, frontend/js/shared-utils.js)
   - Replace innerHTML assignments with textContent or escapeHtml()
   - Locations: admin.js 1047, 4131, and all showMessage calls
   - Effort: 2 hours

9. **Add CSP header** (firebase.json)
   - Add Content-Security-Policy to headers section
   - Effort: 30 minutes

10. **Add .where('enabled', '==', true) filter to getUserRules()** (functions/lib/repositories/user-automation-repository.js:108)
    - Effort: 30 minutes

11. **Optimize user metrics query with .limit()** (functions/api/routes/metrics.js:149)
    - Effort: 30 minutes

**Total Effort**: ~12 hours | **Cost Reduction**: ~$6.26/month | **Risk Reduction**: High

---

### Phase 2: Observability Foundation (Week 2 — 5 days, Medium Effort)

**Goals**: Enable production tracing, add request correlation, normalize provider counting

**Execution status**: Mostly complete. Request IDs, provider counter normalization, circuit breakers, dead-letter visibility/retry, and health status exposure are implemented. Remaining work in this phase is broader trace-ID adoption across older direct `console.*` call-sites.

**Tasks**:

1. **Add request ID middleware** (functions/index.js)
   - Generate trace ID or extract from header
   - Attach to res.locals for all downstream logging
   - For scheduler cycles, use cycleKey
   - Effort: 3 hours

2. **Normalize provider call counting** (functions/api/{foxess,amber,weather,sungrow}.js + functions/api/routes/ev.js)
   - Centralize counting logic (count every HTTP attempt pre-upstream)
   - Update all providers to use same pattern
   - Effort: 4 hours

3. **Add provider counter consistency tests** (functions/test/)
   - Add tests validating all providers count consistently
   - Effort: 2 hours

4. **Implement circuit breaker for FoxESS** (functions/api/foxess.js)
   - Implement shared-state circuit breaker (trips after 3 failures, opens for 60s)
   - Effort: 4 hours

5. **Implement circuit breaker for Weather** (functions/lib/services/weather-service.js)
   - Effort: 3 hours

6. **Implement circuit breaker for Sungrow** (functions/api/sungrow.js)
   - Effort: 3 hours

7. **Add circuit breaker state to `/api/health`** (functions/api/routes/health.js)
   - Return circuit states for each provider
   - Effort: 1 hour

8. **Add dead-letter queue admin endpoint** (functions/api/routes/admin.js)
   - New endpoint: `GET /api/admin/dead-letters?days=7`
   - Returns depth, top errors, oldest cycles
   - Effort: 3 hours

9. **Add dead-letter UI panel** (frontend/js/admin.js)
   - Show in diagnostics section
   - Display count, error distribution, manual retry button
   - Effort: 3 hours

10. **Add request ID to all critical logs** (functions/lib/services/automation-scheduler-service.js, functions/api/routes/automation-cycle.js, etc.)
    - Update key log statements to include traceId
    - Effort: 3 hours
   - Status: partially complete via structured logger + AsyncLocalStorage request context; older direct console logging remains to be converted

**Total Effort**: ~31 hours | **Cost Reduction**: ~0 (improvements offset by circuit breaker probe traffic) | **Risk Reduction**: Very High

---

### Phase 3: Resilience & Maturity (Week 3 — 5 days, High Effort)

**Goals**: Implement structured logging, add rate limiting, optimize scheduler no-ops

**Execution status**: Mostly complete. Structured JSON logging foundation, API rate limiting, scheduler no-op filtering, auth enforcement tests, circuit-breaker tests, upstream health probes, Firestore quota monitoring, and cache hit/miss visibility are implemented. Remaining work in this phase is broader structured-log migration across older direct `console.*` call-sites.

**Tasks**:

1. **Adopt structured logging** (functions/)
   - Add logger instance to functions/index.js
   - Update 100+ console.log calls to structured logger
   - Export logs to Cloud Logging
   - Effort: 12 hours

2. **Add API-level rate limiting** (functions/index.js)
   - Install `express-rate-limit`
   - Configure per-user rate limiter (100 req/min per user ID)
   - Effort: 2 hours

3. **Add auth enforcement tests** (functions/test/)
   - Test that unauthenticated requests to post-middleware routes get 401
   - Test that global metrics endpoint rejects unauthenticated access
   - Effort: 3 hours
   - Status: completed on 2026-03-25

4. **Implement smart scheduler candidate filtering** (functions/lib/services/automation-scheduler-service.js)
   - Reduce no-op cycles by pre-filtering against lastCheck + intervalMs
   - Effort: 3 hours
   - Status: completed on 2026-03-25 via idempotency preflight before lock acquisition

5. **Add circuit breaker tests** (functions/test/)
   - Test circuit breaker opens after N failures
   - Test requests fail fast when circuit open
   - Test recovery probe succeeds
   - Effort: 3 hours

6. **Update `/api/health` to probe upstreams with caching** (functions/api/routes/health.js)
   - Cache probe results for 5 minutes (prevent storm)
   - Effort: 3 hours

7. **Add Firestore quota monitoring** (functions/lib/admin-metrics.js)
   - Track Firestore read/write rates
   - Add alerts for approaching quota
   - Effort: 4 hours
   - Status: completed on 2026-03-25 via admin Firestore metrics quota summary + watch/breach alerts

8. **Add cache hit/miss rate tracking** (functions/api/amber.js, functions/index.js inverter cache, etc.)
   - Track cache effectiveness per source
   - Export metrics
   - Effort: 3 hours
   - Status: completed on 2026-03-25 via shared cache metrics collector surfaced in admin metrics

**Total Effort**: ~33 hours | **Cost Reduction**: 0 (resilience improvements may slightly increase API calls but prevent outages) | **Risk Reduction**: Critical

---

### Phase 4: Long-Term Optimizations (Week 4+, Ongoing)

**Goals**: Performance tuning, architectural improvement, operational excellence

**Tasks**:

1. **Implement per-shard scheduler** (functions/)
   - Shard user population across multiple scheduler instances
   - Reduces head-of-line blocking
   - Effort: 20+ hours (complex)

2. **Add Firestore composite indexes for history/metrics** (firestore.indexes.json)
   - Index: `users/{uid}/history` on `(timestamp DESC)`
   - Index: `metrics` on `(dateKey DESC)`
   - Effort: 1 hour (file update) + 10 min CloudSQL setup time

3. **Batch rule mutations** (functions/api/routes/automation-mutation-routes.js)
   - Allow bulk rule updates in single transaction
   - Saves ~20% writes
   - Effort: 5 hours

4. **Implement metrics aggregation consolidation** (functions/lib/services/automation-scheduler-metrics-sink.js)
   - Consolidate daily metrics after 30 days (reduce Firestore storage)
   - Complex migration for existing data
   - Effort: 10+ hours

5. **Implement Promise.allSettled() for upstream calls** (functions/api/routes/automation-cycle.js:596)
   - Allow cycle to continue if one upstream fails
   - Better degradation
   - Effort: 3 hours
   - Status: completed on 2026-03-25

---

## SECTION F — Implementation Checklist

### Before Starting
- [ ] Create feature branch: `git checkout -b audit/remediation-plan-mar25`
- [ ] Create test database backup
- [ ] Alert team: "Starting 4-week remediation plan, expect frequent PRs"

### Phase 1 Commits
- [x] `fix: replace max-of-max SLO aggregation with P95`
- [x] `fix: split API health chart into provider vs execution metrics`
- [x] `fix: add error logging to scheduler mutation verification`
- [x] `fix: add error logging to vehicle and config cleanup operations`
- [x] `fix: restrict CORS origin to known domains`
- [x] `fix: require auth for global metrics endpoint`
- [x] `fix: escape error messages in frontend innerHTML`
- [x] `feat: add CSP header to firebase.json`
- [x] `perf: add .where('enabled', '==', true) filter to getUserRules()`
- [x] `perf: optimize user metrics query with .limit()`

### Phase 2 Commits
- [x] `feat: add request ID middleware for request tracing`
- [x] `refactor: normalize provider call counting across all APIs`
- [x] `test: add provider counter consistency tests`
- [x] `feat: implement circuit breaker for FoxESS`
- [x] `feat: implement circuit breaker for Weather API`
- [x] `feat: implement circuit breaker for Sungrow API`
- [x] `feat: add circuit breaker state to health endpoint`
- [x] `feat: add dead-letter queue admin endpoint`
- [x] `feat: add dead-letter UI panel in diagnostics`
- [ ] `refactor: add trace ID to critical logs`

### Phase 3 Commits
- [x] `feat: adopt structured logging with structured JSON logger + request context`
- [x] `feat: add API-level rate limiting`
- [x] `test: add auth enforcement tests`
- [x] `perf: optimize scheduler candidate filtering to reduce no-ops`
- [x] `test: add circuit breaker behavior tests`
- [x] `feat: add upstream probes to health endpoint`
- [x] `feat: add Firestore quota monitoring`
- [x] `feat: track cache hit/miss rates`

---

## SECTION G — Success Metrics

### Phase 1
- [ ] Zero security vulnerabilities (XSS, CSRF, auth)
- [x] SLO cards show realistic trends (not max-poisoned)
- [x] API health chart correctly correlates
- [x] No silent failures in scheduler mutations
- [ ] Cost reduced by $6.26/month

### Phase 2
- [ ] Every critical log entry has trace ID
- [x] All providers count same way
- [x] Circuit breakers preventing cascading failures
- [x] Dead-letter queue visible in UI
- [x] Health endpoint shows upstream status

### Phase 3
- [ ] All logs structured and queryable
- [x] API rate limiting prevents DOS
- [ ] Scheduler no-ops reduced by 50%+
- [ ] Coverage of error paths >90%
- [ ] Production incident MTTR reduced by 30%+

### Phase 4
- [ ] Firestore cost stable or reduced
- [ ] Scheduler latency stable regardless of user count
- [ ] Zero cascading outages due to upstream failures

---

## Appendix: Risk Mitigation Strategy

### If Phase 1 Breaks Production
- Immediate rollback: Revert last 3 commits
- Safety: All Phase 1 changes are isolated; no breaking API changes
- Recommended: Deploy to staging first, run E2E tests

### If Phase 2 Circuit Breakers Fail
- Graceful fallback: If circuit breaker logic broken, skip it (provider calls proceed normally)
- Test extensively: Generate artificial upstream failures in staging

### If Phase 3 Logging Causes Disk Pressure
- Cap log retention: Cloud Logging has automatic daily rotation
- Filter: Only log to Cloud Logging at WARN+ level in production

---

## Appendix: Cost Justification

| Activity | Cost | Benefit | ROI |
|----------|------|---------|-----|
| Phase 1 fixes | 12 hours | $6.26/mo savings + security | 30:1 |
| Phase 2 resilience | 31 hours | Prevent $100+ incident cost | 10:1 |
| Phase 3 logging | 33 hours | Reduce MTTR from 30m → 10m | 20:1 |
| Phase 4 optimization | 50+ hours | Prepare for 1000 user scale | TBD |

**Total Investment**: ~125 hours (~3 person-weeks)  
**Expected Payoff**: Prevent 2-3 critical incidents, reduce operational overhead, improve customer experience

---

**Document Version**: 1.0  
**Last Updated**: March 25, 2026  
**Next Review**: After Phase 1 completion (April 1, 2026)
