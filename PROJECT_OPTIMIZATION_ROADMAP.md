# Project Optimization Roadmap
**Full Codebase Audit & Implementation Tracker**  
*Generated: February 15, 2026*  
*Audit Date: February 2026*

---

## Executive Summary

Comprehensive audit of entire inverter-automation project covering security, performance, cost optimization, technical debt, test coverage, and documentation quality. This document tracks all findings and implementation status.

**Audit Scope:**
- `functions/index.js` (7,326 lines, ~77 API endpoints)
- `functions/api/` modules (amber.js, foxess.js, tesla.js)
- Frontend code (8,377-line index.html)
- Firebase configuration (firebase.json, storage.rules, database.rules.json, firestore.rules)
- Test coverage (435 tests across 25 suites)
- Documentation (12+ docs in docs/ folder)

**Current Status:** 9 critical/high-priority items completed, 38+ optimization opportunities identified

---

## 🔴 CRITICAL SECURITY ISSUES

### ✅ COMPLETED

#### 1. Storage Rules Wide Open [CRITICAL] ✅
**Issue:** `storage.rules` had `allow read, write: if true` — any user could read/write all files  
**Impact:** Complete data breach risk  
**Fix Applied:** Changed to `allow read, write: if false`  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 2. Realtime Database Rules Wide Open [CRITICAL] ✅
**Issue:** `database.rules.json` had `.read: true, .write: true` — anyone could access RTDB  
**Impact:** Complete data breach risk  
**Fix Applied:** Changed to `.read: false, .write: false`  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 3. Sensitive Files in Git [HIGH] ✅
**Issue:** Firebase logs, test outputs, deployed HTML in git history  
**Impact:** Potential credential/data exposure  
**Fix Applied:** Added to .gitignore:
- `.firebase_logs.txt`
- `*.pid`
- `recent_logs_full.txt`
- `deployed-index.html`
- `restore-config.json`
- `test-output.txt`, `quick-control-test-output.txt`
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

### 🔶 PENDING

#### 4. API Keys Stored in Firestore [MEDIUM]
**Location:** `users/{uid}/config/main` stores FoxESS token, Amber API key as plaintext  
**Current Mitigation:** Protected by Firestore rules (user can only read own config)  
**Recommendation:** Consider Cloud Secret Manager for production keys  
**Priority:** MEDIUM (acceptable for current scale)  
**Status:** 🔶 DEFERRED (security-in-depth)

#### 5. No Request Rate Limiting [MEDIUM]
**Issue:** No per-user rate limiting on API endpoints  
**Risk:** API abuse possible  
**Recommendation:** Implement Firebase App Check + per-user rate limits  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 6. Tesla Private Key Security [MEDIUM]
**Issue:** User-generated Tesla private keys stored in Firestore plaintext  
**Current:** Protected by Firestore rules  
**Recommendation:** Encrypt at rest using Cloud KMS  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

---

## ⚡ PERFORMANCE & COST OPTIMIZATION

### ✅ COMPLETED

#### 7. Runtime Version Mismatch [HIGH] ✅
**Issue:** `functions/package.json` specified `nodejs20` but `firebase.json` had no runtime override → defaulting to older version  
**Impact:** Performance degradation, potential compatibility issues  
**Fix Applied:** Updated `firebase.json` to explicitly set `"runtime": "nodejs22"` for all functions  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 8. Scheduler Scanning All Users Every Minute [HIGH] ✅
**Issue:** `runAutomationHandler` called `db.collection('users').get()` — scanned ALL users every 1 minute regardless of automation status  
**Impact:** 1,440 full user collection scans/day, high Firestore read costs  
**Fix Applied:**
- Added `automationEnabled` flag on parent `users/{uid}` doc
- Pre-filter query: `.where('automationEnabled', '==', true).get()`
- Sync flag via `saveUserAutomationState()` when automation toggled
- Self-healing migration scan for existing users
**Savings:** ~90% reduction in scheduler Firestore reads  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 9. Security Headers Missing [MEDIUM] ✅
**Issue:** No security headers in hosting config  
**Fix Applied:** Added to `firebase.json` hosting headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 10. Image Caching Not Optimized [LOW] ✅
**Issue:** No cache headers for static images  
**Fix Applied:** Added `Cache-Control: public, max-age=2592000` for `**/*.{jpg,jpeg,png,gif,svg,ico}`  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 11. JS/CSS Caching Too Aggressive [MEDIUM] ✅
**Issue:** `Cache-Control: public, max-age=31536000, immutable` — users wouldn't get updates without hard refresh  
**Fix Applied:** Changed to `max-age=3600, stale-while-revalidate=86400`  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 12. Pre-deploy Checks Missing [MEDIUM] ✅
**Issue:** No automated lint/test run before deploy  
**Fix Applied:** Added predeploy hooks to `firebase.json`:
```json
"predeploy": [
  "npm --prefix functions run lint",
  "npm --prefix functions test"
]
```
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

### 🔶 PENDING

#### 13. No Firestore Index Optimization [MEDIUM]
**Issue:** Complex queries may not have optimal indexes  
**Recommendation:** Audit `firestore.indexes.json`, add composite indexes for common queries  
**Estimated Savings:** 10-20% reduction in query costs  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 14. Cold Start Optimization [MEDIUM]
**Issue:** Cloud Functions 2nd gen may have cold starts  
**Recommendation:** 
- Enable min instances (0→1) for `api` function during peak hours
- Consider function splitting for rarely-used endpoints
**Trade-off:** Cost vs latency  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 15. Excessive Logging in Production [LOW]
**Issue:** Verbose console.log statements in hot paths  
**Impact:** Slight increase in function execution time + Cloud Logging costs  
**Recommendation:** Use log levels, reduce debug logging in production  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 16. FoxESS API Caching Could Be Improved [MEDIUM]
**Issue:** Cache TTLs are fixed, could be adaptive based on data staleness  
**Recommendation:** Implement adaptive TTLs (e.g., 30s during active automation, 5min at night)  
**Estimated Savings:** 20-30% reduction in FoxESS API calls  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

---

## 🐛 BUG FIXES & CORRECTNESS

### ✅ COMPLETED

#### 17. Quick Control Segments Not Auto-Cleared [HIGH] ✅
**Issue:** After quick control expired, segments remained set until user clicked "Acknowledge"  
**Impact:** If user closed browser, segments would stay active indefinitely  
**Fix Applied:**
- Extracted `cleanupExpiredQuickControl()` helper function
- Modified `/api/quickcontrol/status` to auto-cleanup on expiry
- Modified `/api/automation/cycle` to use helper (deduplication)
- Frontend shows auto-completion message, no "Acknowledge" button needed
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

#### 18. Quick Control UI Unresponsive After Acknowledge [LOW] ✅
**Issue:** Clicking "Acknowledge" had no loading feedback  
**Fix Applied:** Added loading spinners to `acknowledgeQuickControlComplete()`, `stopQuickControl()`, `refreshQuickControlStatus()`  
**Status:** ✅ COMPLETED & DEPLOYED  
**Date:** Feb 15, 2026

### 🔶 PENDING

#### 19. Race Condition in Quick Control Cleanup [LOW]
**Issue:** If frontend and scheduler both detect expiry at same time, both call cleanup  
**Impact:** Duplicate history entries, redundant API calls (idempotent, but wasteful)  
**Recommendation:** Add distributed lock (Firestore transaction) or accept minor duplication  
**Priority:** LOW (cosmetic, no correctness issue)  
**Status:** 🔶 PENDING

#### 20. No Timeout on FoxESS API Calls [MEDIUM]
**Issue:** Some FoxESS API helper functions missing timeout, could hang forever  
**Recommendation:** Add 30-second timeout to all HTTP requests  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 21. Error Handling Inconsistent [LOW]
**Issue:** Some endpoints return `{ errno: 500 }`, others throw uncaught errors  
**Recommendation:** Add global Express error handler middleware  
**Priority:** LOW  
**Status:** 🔶 PENDING

---

## 🧪 TEST COVERAGE & QUALITY

### Current State
- **Test Suites:** 25 passed
- **Tests:** 435 passed, 1 skipped
- **Coverage:** ~7.38% actual code coverage (most tests re-implement logic inline)
- **Issue:** High duplication, low integration coverage

### 🔶 PENDING IMPROVEMENTS

#### 22. Test Coverage Too Low [HIGH]
**Issue:** Only 7.38% real code coverage — most critical paths untested  
**Recommendation:** 
- Add integration tests for `/api/automation/cycle` end-to-end
- Add tests for scheduler logic (`runAutomationHandler`)
- Add tests for Tesla signed command generation
- Target: 60%+ coverage of core automation logic
**Priority:** HIGH  
**Status:** 🔶 PENDING

#### 23. Test Code Duplication [MEDIUM]
**Issue:** Tests re-implement API logic instead of calling actual functions  
**Example:** `quick-control.test.js` duplicates segment calculation  
**Recommendation:** Refactor tests to call actual implementation, verify behavior  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 24. No E2E Tests [MEDIUM]
**Issue:** No Playwright tests covering critical user flows  
**Recommendation:** Add E2E tests for:
- Login → Enable automation → Verify cycle runs
- Start quick control → Wait for expiry → Verify cleanup
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 25. Emulator Tests Not in CI [MEDIUM]
**Issue:** `run-emulator-tests.ps1` exists but not in automated CI/CD  
**Recommendation:** Add GitHub Actions workflow to run emulator tests on PR  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

---

## 📦 TECHNICAL DEBT & CODE QUALITY

### 🔴 CRITICAL

#### 26. Frontend Monolith (8,377-line index.html) [HIGH]
**Issue:** Entire dashboard in single HTML file with inline JS  
**Impact:** 
- Difficult to maintain
- High duplication (authentication logic repeated)
- No code reuse
- Large initial load size
**Recommendation:** 
- Extract to modular JS files (auth.js, quickcontrol.js, automation.js, etc.)
- Use ES modules or simple bundler
- Extract CSS to separate file
**Estimated Effort:** 2-3 days  
**Priority:** HIGH  
**Status:** 🔶 PENDING

#### 27. Main API File Too Large (7,326 lines) [HIGH]
**Issue:** `functions/index.js` contains ~77 endpoints + helpers + scheduler  
**Impact:** Hard to navigate, merge conflicts likely  
**Recommendation:** 
- Split into route modules (automation.routes.js, quickcontrol.routes.js, config.routes.js)
- Extract scheduler to separate file
- Keep index.js as orchestrator only
**Estimated Effort:** 1-2 days  
**Priority:** HIGH  
**Status:** 🔶 PENDING

### 🔶 MEDIUM PRIORITY

#### 28. Backup Files in Production Deployment [MEDIUM]
**Issue:** `functions/api/amber.js.backup`, `foxess.js.backup` included in deployment  
**Impact:** Increases deployment size, could expose old vulnerabilities  
**Recommendation:** Add to .gitignore, remove from deployment  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 29. No JSDoc Comments on Core Functions [LOW]
**Issue:** Many helper functions lack documentation  
**Recommendation:** Add JSDoc to `getUserAutomationState`, `saveUserAutomationState`, `cleanupExpiredQuickControl`, etc.  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 30. Magic Numbers in Code [LOW]
**Issue:** Hardcoded values like `3600000` (1 hour in ms), `86400` (1 day in seconds)  
**Recommendation:** Extract to named constants at top of file  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 31. Inconsistent Error Response Format [LOW]
**Issue:** Most endpoints use `{ errno, result, error }` but some return raw Express errors  
**Recommendation:** Standardize on envelope pattern everywhere  
**Priority:** LOW  
**Status:** 🔶 PENDING

---

## 📚 DOCUMENTATION ISSUES

### 🔶 PENDING

#### 32. Stale Documentation [MEDIUM]
**Files with Outdated Info:**
- `docs/SETUP.md` — references old runtime version
- `docs/API.md` — missing several new endpoints (quick control status, init-profile)
- `docs/AUTOMATION.md` — doesn't cover blackout windows fully
**Recommendation:** Audit all docs, update or mark as archived  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 33. Duplicate Documentation [LOW]
**Issue:** 
- `docs/LOGGING_AUDIT_REPORT.md` + `LOGGING_AUDIT_FINAL_REPORT.md` (root)
- `docs/COST_ANALYSIS_2025.md` + `docs/FIREBASE_COST_ANALYSIS.md`
**Recommendation:** Consolidate, keep one canonical version  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 34. Missing Architecture Diagram [MEDIUM]
**Issue:** No visual overview of system components  
**Recommendation:** Add Mermaid diagram showing:
- Frontend → Firebase Hosting
- API routes → Cloud Functions
- Scheduler → Firestore → FoxESS/Amber APIs
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 35. No Runbook for Common Issues [MEDIUM]
**Issue:** When automation fails, no troubleshooting guide  
**Recommendation:** Create `docs/TROUBLESHOOTING.md` with common scenarios:
- "Automation not running" → Check scheduler logs
- "FoxESS API errors" → Verify token, check rate limits
- "Segments not clearing" → Check quick control state
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

---

## 🔧 INFRASTRUCTURE & DEPLOYMENT

### ✅ COMPLETED

#### 36. Predeploy Hooks Added ✅
**Status:** ✅ COMPLETED (see #12 above)

### 🔶 PENDING

#### 37. No CI/CD Pipeline [MEDIUM]
**Issue:** Deployments are manual via `firebase deploy`  
**Recommendation:** Add GitHub Actions workflow:
- On PR: Run lint + tests + emulator tests
- On merge to main: Auto-deploy to production
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 38. No Staging Environment [MEDIUM]
**Issue:** All changes go directly to production  
**Recommendation:** Add staging Firebase project, deploy there first for manual QA  
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 39. No Rollback Plan [LOW]
**Issue:** If deployment breaks, no quick rollback mechanism  
**Recommendation:** Document rollback procedure (Firebase console → Functions → Revert)  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 40. Emulator State Management [LOW]
**Issue:** Manual emulator cleanup scripts (stop-and-clean-emulators.ps1)  
**Recommendation:** Add npm scripts for common emulator tasks  
**Priority:** LOW  
**Status:** 🔶 PENDING

---

## 📊 MONITORING & OBSERVABILITY

### 🔶 PENDING

#### 41. No Structured Logging [MEDIUM]
**Issue:** Logs use console.log/console.error inconsistently  
**Recommendation:** Use Cloud Logging SDK with structured logs:
```js
logger.log({ severity: 'INFO', message: 'Cycle complete', userId, ruleId });
```
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 42. No Error Alerting [MEDIUM]
**Issue:** Errors only visible in Cloud Logging, no proactive alerts  
**Recommendation:** Set up Cloud Monitoring alerts:
- Scheduler fails 3 times in 5 minutes
- FoxESS API 500 errors exceed threshold
- Function execution time > 30s
**Priority:** MEDIUM  
**Status:** 🔶 PENDING

#### 43. No Performance Metrics [LOW]
**Issue:** No tracking of automation cycle latency, API call duration  
**Recommendation:** Add `[Metrics]` logging for key operations, export to Cloud Monitoring  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 44. No User Analytics [LOW]
**Issue:** No visibility into feature usage (how many users use quick control vs automation)  
**Recommendation:** Add privacy-respecting analytics (Firebase Analytics or simple usage counters)  
**Priority:** LOW  
**Status:** 🔶 PENDING

---

## 🚀 FEATURE ENHANCEMENTS

### 🔶 PENDING (Low Priority)

#### 45. Mobile App [LOW]
**Recommendation:** Consider React Native or Flutter app for better mobile UX  
**Priority:** LOW (current web UI works)  
**Status:** 🔶 PENDING

#### 46. Multi-Device Support [LOW]
**Issue:** Currently 1 device per user  
**Recommendation:** Extend data model to support array of devices  
**Priority:** LOW  
**Status:** 🔶 PENDING

#### 47. Historical Data Visualization [LOW]
**Issue:** History exists but no charts/graphs  
**Recommendation:** Add Chart.js visualization of automation triggers over time  
**Priority:** LOW  
**Status:** 🔶 PENDING

---

## Implementation Priority Matrix

### 🔥 HIGH PRIORITY (Next Sprint)
1. ✅ ~~Storage/Database rules lockdown~~ (DONE)
2. ✅ ~~Scheduler pre-filtering optimization~~ (DONE)
3. ✅ ~~Runtime version fix~~ (DONE)
4. ✅ ~~Quick control auto-cleanup~~ (DONE)
5. 🔶 **Test coverage improvements (#22)**
6. 🔶 **Frontend refactoring (#26)**
7. 🔶 **Main API file splitting (#27)**
8. 🔶 **Firestore index optimization (#13)**

### 🔸 MEDIUM PRIORITY (Q2 2026)
9. 🔶 Rate limiting + App Check (#5)
10. 🔶 Cold start optimization (#14)
11. 🔶 FoxESS API timeout fixes (#20)
12. 🔶 Documentation audit (#32)
13. 🔶 CI/CD pipeline (#37)
14. 🔶 Staging environment (#38)
15. 🔶 Error alerting (#42)

### 🔹 LOW PRIORITY (Backlog)
16. 🔶 Tesla key encryption (#6)
17. 🔶 Request rate limiting per user (#5)
18. 🔶 Structured logging (#41)
19. 🔶 All other LOW priority items

---

## Cost Savings Summary (Completed Items)

| Optimization | Estimated Monthly Savings |
|--------------|---------------------------|
| Scheduler pre-filtering (#8) | $5-10 (90% reduction in Firestore reads) |
| JS/CSS caching fix (#11) | $2-5 (reduced re-downloads) |
| Image caching (#10) | $1-3 (reduced bandwidth) |
| **Total Estimated Savings** | **$8-18/month** |

**Note:** Actual savings depend on user count and usage patterns.

---

## Next Steps

1. **Immediate (This Week):**
   - Review this roadmap with team
   - Prioritize HIGH items for next sprint
   - Create GitHub issues for each pending item

2. **Short-term (Next 2 Weeks):**
   - Start frontend refactoring (#26)
   - Improve test coverage (#22)
   - Add Firestore indexes (#13)

3. **Medium-term (Next Month):**
   - Set up CI/CD pipeline (#37)
   - Complete API file splitting (#27)
   - Add error alerting (#42)

4. **Ongoing:**
   - Monitor logs for new issues
   - Track cost metrics in Firebase console
   - Update this roadmap as items are completed

---

## Document Maintenance

**Last Updated:** February 15, 2026  
**Next Review:** March 15, 2026  
**Owner:** Primary Maintainer  

**How to Update:**
- Mark items ✅ when completed, add completion date
- Add new findings as discovered
- Update priority based on evolving needs
- Archive completed sections after 90 days
