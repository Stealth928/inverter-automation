# Deployment Guide & Quality Control

## Overview

This guide establishes quality control procedures to prevent critical bugs from reaching production. The app serves live users and requires rigorous testing before every deployment.

---

## Pre-Deployment Checklist

**BEFORE running `firebase deploy`, you MUST:**

### 1. Run Pre-Deployment Checks ✓
```bash
npm --prefix functions run pre-deploy
```

This script verifies:
- ✓ All tests pass (Jest test suite)
- ✓ No linting errors (ESLint)
- ✓ All critical modules are exported correctly
- ✓ All critical modules are imported in `index.js`
- ✓ All critical routes are defined
- ✓ No common refactoring mistakes (missing module prefixes, missing imports)
- ✓ `firebase.json` rewrites are configured correctly

**Script will exit with code 1 if ANY check fails. Do not deploy if this fails.**

### 2. Run Full Test Suite ✓
```bash
npm --prefix functions test
```

Requires:
- All 323+ tests passing
- No test errors or failures
- Coverage for all API endpoints

### 3. Code Review ✓
- Review all code changes since last deployment
- Look for: module imports, API signatures, breaking changes
- Check: migration steps if database schema changed

### 4. Manual Testing (Critical Paths) ✓

Test these critical user flows in development/staging:

**Amber Electricity Prices:**
- [ ] Load dashboard with Amber configured
- [ ] Verify prices load (not "No data")
- [ ] Refresh prices via 🔄 button
- [ ] Check browser console for errors

**FoxESS Inverter Data:**
- [ ] Real-time data loads and updates
- [ ] Scheduler display shows correct times
- [ ] Device info displays correctly

**Automation Engine:**
- [ ] Rules load correctly
- [ ] Automation can be toggled on/off
- [ ] Scheduled tasks execute on time

**Weather Data:**
- [ ] Forecast loads for configured location
- [ ] Map displays correctly
- [ ] Days selector works

### 5. Verify Firebase Configuration ✓
```bash
firebase projects:list
firebase config:list
```

Ensure:
- Correct project is selected
- API keys are valid
- Database rules are correct

---

## Deployment Steps

### Step 1: Run Pre-Deployment Checks
```bash
cd /path/to/inverter-automation
npm --prefix functions run pre-deploy
```

If ANY check fails, **STOP**. Fix the issues before proceeding.

### Step 2: Deploy Functions Only (Safer)
```bash
firebase deploy --only functions
```

**Why `--only functions`?**
- Deploys only Cloud Functions (no hosting changes)
- Faster deployment
- Easier to rollback if needed
- Database rules/indexes updated separately if needed

**Full deployment (when needed):**
```bash
firebase deploy
```

### Step 3: Verify Deployment Success
```bash
firebase functions:log | tail -20
```

Check for:
- ✓ Functions deployed successfully
- ✓ No initialization errors
- ✓ No "is not defined" errors
- ✓ No authentication failures

### Step 4: Smoke Test in Production
Visit your production app and verify:
- [ ] Can log in
- [ ] Dashboard loads all widgets
- [ ] Amber prices display (not "No data")
- [ ] Inverter data shows
- [ ] Automation page loads
- [ ] No console errors

---

## Critical Checks Explanation

### What Each Check Does

#### 1. Test Suite (Jest)
- Runs 323+ unit tests across all modules
- Validates API endpoints with supertest
- Tests automation logic, timezone handling, caching
- Catches: logic errors, broken routes, middleware issues

#### 2. ESLint (Code Quality)
- Validates code style and best practices
- Detects unused variables and imports
- Catches: typos, syntax errors, dead code
- Does NOT block deployment if warnings only

#### 3. Module Exports/Imports
- Verifies critical modules are properly exported:
  - `amber.js` exports: `init`, `amberPricesInFlight`
  - `foxess.js` exports: `init`
  - `auth.js` exports: `init`
- Verifies `index.js` imports all required modules
- Catches: "is not defined" errors like the amber prices bug

#### 4. Critical Routes
- Verifies these routes are defined and available:
  - `/api/amber/sites`
  - `/api/amber/prices/current`
  - `/api/inverter/real-time`
  - `/api/health`
- Catches: deleted routes, route definition errors

#### 5. Common Mistakes
- Checks for `callAmberAPI()` without `amberAPI.` prefix
- Checks for `callFoxESSAPI()` without `foxessAPI.` prefix
- Checks for use of global variables that should be imported
- Catches: refactoring errors, missing module references

#### 6. Firebase Configuration
- Verifies `firebase.json` has hosting rewrites
- Verifies `/api/**` correctly routes to `api` function
- Catches: misconfigured hosting, broken API routing

---

## Automated Quality Control (GitHub Actions)

Every push to `main` branch automatically runs:

1. **Unit Tests** - All 323 tests must pass
2. **Linting** - Code quality checks
3. **Module Verification** - Exports/imports validated
4. **Security Audit** - npm audit for vulnerabilities

View results at: https://github.com/Stealth928/inverter-automation/actions

**Status badge** (add to README):
[![QA Checks](https://github.com/Stealth928/inverter-automation/actions/workflows/qa-checks.yml/badge.svg)](https://github.com/Stealth928/inverter-automation/actions)

---

## Common Deployment Issues & Solutions

### Issue: "amberPricesInFlight is not defined"
**Cause:** Module not imported in index.js
**Solution:** 
```javascript
const { amberPricesInFlight } = amberModule;
```
**Prevention:** Pre-deploy check catches this

### Issue: "TypeError: callAmberAPI is not a function"
**Cause:** Using global function instead of module method
**Solution:**
```javascript
// Wrong:
callAmberAPI(...)

// Correct:
amberAPI.callAmberAPI(...)
```
**Prevention:** Pre-deploy check detects missing prefixes

### Issue: Prices show "No data"
**Root Causes:**
1. API key not configured
2. amberPricesInFlight not imported
3. Amber API rate limited
4. Cache TTL too short

**Debug:**
```bash
firebase functions:log | grep -i amber
```

### Issue: Routes returning 404
**Cause:** Route definition missing after refactoring
**Solution:** Verify in pre-deploy check
**Debug:**
```bash
curl https://your-function-url/api/health
```

---

## Rollback Procedure

If deployment breaks production:

### Quick Rollback (Firebase Console)
1. Go to Firebase Console → Cloud Functions
2. Click the `api` function
3. In "General" tab, click "Manage all revisions"
4. Deploy previous working revision

### Manual Rollback (Git)
```bash
# Revert to previous commit
git revert HEAD
git push origin main

# Redeploy
firebase deploy --only functions
```

### Check What Broke
```bash
firebase functions:log | grep -E "error|ERROR|\[.*\] .*error"
```

---

## Module Dependency Map

Understanding the architecture helps prevent future issues:

```
index.js (5,576 lines)
├─ api/amber.js (729 lines)
│  ├─ callAmberAPI()
│  ├─ getCachedAmberSites()
│  ├─ getCachedAmberPricesCurrent()
│  └─ amberPricesInFlight (Map)
├─ api/foxess.js (146 lines)
│  ├─ callFoxESSAPI()
│  └─ generateFoxESSSignature()
└─ api/auth.js (98 lines)
   ├─ authenticateUser
   └─ tryAttachUser
```

**Critical:** Each module exports an `init()` function and critical state/functions. Index.js must import and use them correctly.

---

## Testing Best Practices

### Before Committing Code
```bash
npm --prefix functions run lint
npm --prefix functions test
```

### Before Merging PR
- All GitHub Actions checks must pass ✓
- At least one code review ✓
- Pre-deploy checks run ✓

### Before Deploying
```bash
npm --prefix functions run pre-deploy
firebase deploy --only functions
```

---

## Monitoring Deployments

### Setup Alerts
1. Go to Firebase Console
2. Cloud Functions → Monitoring
3. Set up alerts for:
   - Function errors
   - High latency
   - Memory usage

### View Logs
```bash
# Last 50 lines
firebase functions:log | tail -50

# Filter by type
firebase functions:log | grep "\[Amber\]"

# Real-time monitoring
firebase functions:log --follow
```

### Check Health
```bash
curl https://api-XXXXXXXX.a.run.app/api/health
```

Should return:
```json
{"errno": 0, "result": "OK"}
```

---

## Version Control Best Practices

### Commit Message Format
```
[TYPE] Brief description

Longer explanation of what changed and why.

Fixes: #123
Breaking: None
```

**Types:**
- `FEAT:` New feature
- `FIX:` Bug fix
- `REFACTOR:` Code restructuring (no functional change)
- `CRITICAL FIX:` Production issue fix
- `DOCS:` Documentation only
- `TEST:` Test additions/modifications

### Example Commit for Bug Fix
```
CRITICAL FIX: Import amberPricesInFlight from amber module

amberPricesInFlight Map was moved to amber.js but index.js
was using it without importing. Caused:
  "amberPricesInFlight is not defined"
  Amber prices showing "No data" on dashboard

Fix: Import amberPricesInFlight destructuring from amberModule

Fixes: https://github.com/Stealth928/inverter-automation/issues/42
```

---

## Future Improvements

Planned quality improvements:

- [ ] Add E2E tests for critical paths (Playwright)
- [ ] Staging environment for pre-production testing
- [ ] Load testing for automation scheduler
- [ ] Database migration testing
- [ ] API rate limiting tests
- [ ] Multi-user concurrency tests
- [ ] Mobile UI testing

---

## Questions?

For deployment issues or process improvements:
1. Check this guide
2. Review GitHub Actions logs
3. Check Firebase logs: `firebase functions:log`
4. Consult team members

**Last Updated:** 2025-12-22
