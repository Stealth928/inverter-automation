# Inverter Automation — API & Cost Optimizations

Last updated: 2025-12-24

Purpose: store all identified optimizations (API call reduction, caching, cost and speed improvements) so work can be picked up later.

---

## Executive summary

The application already has a strong caching and automation architecture. Primary wastes found are:
- Frontend auto-refresh bypassing server-side caches (huge multiplier of external calls).
- Repeated Firestore reads for configuration, rules, and per-user weather caches where data can be shared or cached longer.
- Missing generalized in-flight deduplication (only Amber prices deduped).

High-impact fixes (Phase 1) will reduce external API usage by ~60–75% and Firestore costs by ~40–50%.

---

## Prioritized action list (short)

1. Remove `forceRefresh=true` from frontend auto-refresh timers (Amber, inverter, weather). (Critical)
2. Implement server-side `getUserConfig()` in-memory TTL cache. (High)
3. Fetch only minimal weather days required by rules (not always 7 days); consider longer TTL for weather. (High)
4. Extend "in-flight" request deduplication to Amber `/prices`, `/sites`, FoxESS realtime/setting calls, and shared weather fetches. (High)
5. Only read enabled rules (`.where('enabled','==', true)`) and cache rules in-memory with invalidation on writes. (High)
6. Consolidate weather cache to shared location-based cache (`shared/weather_cache/{location}`). (High)
7. Prevent duplicate Amber `/sites` calls; always use `amberAPI.getCachedAmberSites()` wrapper. (Medium)
8. Add a small frontend API response cache in `frontend/js/api-client.js`. (Medium)
9. Parallelize chunked Amber historical fetches when retrieving multiple 30-day chunks. (Medium)
10. Audit and minimize double Firestore reads in curtailment and other helpers. (Medium)
11. Add metrics / logging to measure cache hit rates and API call counts before/after. (Medium)

---

## Detailed findings and suggested code changes

### 1) Frontend auto-refresh bypasses cache (critical)

Files: `frontend/index.html` (timers around amberRefreshTimer, inverterRefreshTimer, weatherRefreshTimer)

Issue: the page calls functions with `forceRefresh=true`, causing server to bypass TTL caches and call external APIs every interval (Amber every 60s, inverter every 5m, weather every 30m).

Suggested change (example):

- Replace calls like `getAmberCurrent(true)` with `getAmberCurrent(false)` or simply `getAmberCurrent()` so the backend cache can decide whether to fetch fresh data.
- Same for `callAPI('/api/inverter/real-time', ..., true)` -> pass `false` for `forceRefresh`.

Rationale: Letting backend caches and in-flight deduplication handle refresh dramatically reduces duplicate external calls.

Estimated impact: ~95% reduction in frontend-triggered API calls.

---

### 2) getUserConfig Firestore reads (high)

Files: `functions/index.js` `getUserConfig()` is called frequently in the automation scheduler and endpoints.

Issue: Reading user config from Firestore every cycle causes many reads per user per minute.

Suggestion: Add a lightweight in-memory cache with TTL (e.g., 5 minutes) inside `functions/index.js`:

```javascript
const userConfigCache = new Map(); // key: userId -> { config, ts }
const USER_CONFIG_CACHE_TTL = 5 * 60 * 1000;

async function getCachedUserConfig(userId) {
  const cached = userConfigCache.get(userId);
  if (cached && Date.now() - cached.ts < USER_CONFIG_CACHE_TTL) return cached.config;
  const cfg = await getUserConfig(userId);
  userConfigCache.set(userId, { config: cfg, ts: Date.now() });
  return cfg;
}
```

Invalidate `userConfigCache` on config write endpoints.

Estimated impact: ~60% reduction in Firestore reads.

---

### 3) Weather fetching strategy (high)

Files: `functions/index.js` automation logic

Issue: The automation cycle always fetches 7 days of weather data even if rules only need 1-2 days.

Suggestions:
- Compute `maxDaysNeeded` across enabled rules; request that many days (capped at the provider limit).
- Use a shared location-based cache (see section 6) and increase TTL (e.g., 2 hours) to reduce frequent requests.

Code sketch:

```javascript
let maxDaysNeeded = calculateMaxDaysNeeded(enabledRules); // 1..7
maxDaysNeeded = Math.min(maxDaysNeeded, 7);
const weatherData = await getCachedWeatherData(userId, place, maxDaysNeeded);
```

Estimated impact: up to 70% reduction for most users.

---

### 4) Extend in-flight request deduplication (high)

Files: `functions/api/amber.js` (has `amberPricesInFlight`), `functions/index.js` uses it.

Issue: Deduplication exists for Amber current prices but not for other frequently-requested resources (Amber `/sites`, FoxESS realtime, settings, weather shared fetches).

Suggestion: Implement a generalized `inFlightRequests` map and wrapper:

```javascript
const inFlightRequests = new Map();

function dedupe(key, fn) {
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);
  const p = (async () => await fn())();
  inFlightRequests.set(key, p);
  try { return await p; } finally { inFlightRequests.delete(key); }
}
```

Use `dedupe()` for any external call keyed by `(resourceType|userId|params)`.

Estimated impact: 30–40% reduction in concurrent duplicate calls.

---

### 5) Rules scanning and caching (high)

Files: `functions/index.js` (`.collection('rules').get()` every cycle)

Issue: The automation cycle reads all rules every run and evaluates them, even when disabled.

Suggestions:
- Query only enabled rules: `.where('enabled','==', true)`.
- Maintain an in-memory rules cache per user and invalidate when rules are created/updated/deleted.

Benefits: Reduce Firestore reads and CPU work.

---

### 6) Shared location-based weather cache (high)

Files: `functions/index.js`, `functions/api/*`

Issue: Currently weather cache is stored under `users/{uid}/cache/weather` causing duplication for many users in same location.

Suggestion: Store weather cache under `shared/weather_cache/{locationKey}` and include a TTL timestamp. Use hashed location keys.

Benefits: 80–90% reduction in stored documents and writes for weather data.

---

### 7) Prevent duplicate Amber `/sites` calls (medium)

Files: `functions/index.js` multiple locations called `/sites` directly

Issue: Some flows call `amberAPI.callAmberAPI('/sites', ...)` directly instead of `amberAPI.getCachedAmberSites(userId)`.

Suggestion: Audit and standardize to always call the cache wrapper; remove raw calls except inside the cache implementation.

---

### 8) Frontend API client response cache (medium)

Files: `frontend/js/api-client.js` (or pages that have custom fetch wrappers)

Issue: Each page implements fetch wrappers and may re-request identical data across tabs/pages.

Suggestion: implement a small in-memory response cache inside `api-client.js` with TTL and keying by URL+options. Allow pages to pass `cacheTTL` per-request.

Benefits: Reduced redundant requests from multiple open tabs and faster UI.

---

### 9) Parallelize Amber historical chunk fetches (medium)

Files: `functions/api/amber.js` chunk loop for `getCachedAmberPrices`

Issue: Current loop fetches chunks sequentially; for large date ranges this is slow.

Suggestion: batch chunk API calls with `Promise.all()` (with concurrency limit) to speed up responses.

Caveat: Respect rate limits; implement concurrency throttle (e.g., p-limit).

---

### 10) Backend: avoid duplicate state reads in curtailment (medium)

Files: `functions/index.js` `checkAndApplyCurtailment()` reads curtailment `state` multiple times.

Suggestion: read once and reuse value in function scope; reduce Firestore reads by 50% for curtailment flows.

---

## Testing & rollout plan

1. Add logging: `cacheHit` boolean and `_cacheAgeMs` metadata to responses where useful.
2. Add metrics tracking for `incrementApiCount()` already present — snapshot pre-change for 7 days.
3. Implement Phase 1 (frontend timer change + small server config cache) on a feature branch.
4. Deploy to staging/emulator and run load tests simulating X users (10, 50, 100) using `k6` or similar.
5. Verify API reduction in metrics and cache hit rate improvements.
6. Proceed with Phase 2 (in-flight dedupe and rules cache) and repeat tests.

Suggested commands for local/emulator testing:

```bash
# Install dev deps (functions)
cd functions && npm install

# Run emulator (functions only)
npm --prefix functions run serve

# Run unit tests (functions)
npm --prefix functions test
```

---

## Rollout checklist (minimal)

- [ ] Add telemetry for cache hits and API counters (if not already captured).
- [ ] Implement Phase 1 changes in a short PR (remove forceRefresh, add config cache).
- [ ] Deploy to staging emulator; run smoke tests and load tests.
- [ ] Verify metrics; proceed to Phase 2 in separate PRs.
- [ ] Monitor production metrics closely for 72 hours after rollout.

---

## Files changed in analysis (reference)

- `functions/index.js` — automation scheduler, `getUserConfig()`, `getCached*` methods
- `functions/api/amber.js` — cache helpers, in-flight map, chunk fetch
- `frontend/index.html` — timers and auto-refresh
- `frontend/settings.html`, `frontend/control.html`, `frontend/history.html`, `frontend/roi.html` — various duplicated fetches

(See repo for exact lines and context — this document captures the decisions and code sketches.)

---

## Next steps (pick-up guidance)

When you pick up this work later, follow the Phased approach in "Prioritized action list". Start with the frontend timer change and `getUserConfig()` cache — they are the lowest-risk, highest-impact changes.

If you want, I can open a branch and implement Phase 1 now, run the functions emulator, and produce a PR with tests and metrics. Reply with `implement phase1` to proceed and I will start the work and track progress in the TODO list.

---

## Appendix — code snippets

- `dedupe()` helper (see above)
- `getCachedUserConfig()` sketch (see above)
- Frontend change: remove `getAmberCurrent(true)` -> `getAmberCurrent()`

---

End of document.
