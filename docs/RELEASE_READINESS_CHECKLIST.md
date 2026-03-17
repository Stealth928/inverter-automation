# Release Readiness Checklist

> Use this checklist before every production deployment of inverter-automation.
> All items must be ✅ before merging to `main` and running the deploy.

---

## 1. Pre-Deploy Code Quality Gates

| Check | Command | Expected |
|---|---|---|
| Backend lint | `npm --prefix functions run lint` | 0 errors |
| Backend tests | `npm --prefix functions test -- --runInBand` | All tests pass |
| Pre-deploy script | `node scripts/pre-deploy-check.js` | Exit 0 |
| API contract check | `npm run api:contract:check` | No diffs |
| OpenAPI check | `npm run openapi:check` | No diffs |

---

## 2. Security Checks

- [ ] `npm audit --prefix functions` — no critical or high vulnerabilities
- [ ] `npm audit` (root) — no critical or high vulnerabilities
- [ ] No secrets or credentials committed to source (`git grep -i "apiKey\|secret\|password"`)
- [ ] Firestore security rules reviewed for new collections/paths introduced in this release
- [ ] Authentication is enforced on all new `/api/**` routes (use `authenticateUser`)

---

## 3. Environment Configuration

- [ ] Firebase project is set to **production** (check `firebase use`)
- [ ] `FUNCTIONS_EMULATOR` env var is **not set** in production
- [ ] `FIRESTORE_EMULATOR_HOST` is **not set** in production
- [ ] `firebase.json` runtime is `nodejs22`
- [ ] All Cloud Function secrets and environment variables are configured in the deployed runtime, with secrets managed through Firebase Secret Manager where required
- [ ] Rate-limit and cache settings are appropriate for production load

---

## 4. Frontend Checks

- [ ] No HTML file has more than 200 lines of inline `<script>` content:
  ```powershell
  # Run from frontend/ folder
  Get-ChildItem *.html | ForEach-Object {
    $c=[System.IO.File]::ReadAllText($_.FullName)
    $rx=[regex]'(?s)<script([^>]*)>(.*?)</script>'
    $ms=$rx.Matches($c)
    $inline=$ms|Where-Object{$_.Groups[1].Value -notmatch 'src='}
    $tot=($inline|ForEach-Object{($_.Groups[2].Value -split "`n").Count}|Measure-Object -Sum).Sum
    "$($_.Name): $tot inline lines"
  }
  ```
- [ ] All page JS sourced from `js/*.js` (no large inline blocks)
- [ ] `firebase-auth.js` `window.authenticatedFetch` is the only definition — no per-page duplicates
- [ ] No raw `fetch()` in page scripts (all go through APIClient / `authenticatedFetch`)
- [ ] Amber site selection persists across pages (uses `getStoredAmberSiteId` from `shared-utils.js`)
- [ ] Service Worker (`sw.js`) cache version bumped if static assets changed
- [ ] PWA manifest (`manifest.webmanifest`) is valid

---

## 5. API Contract Verification

- [ ] All `/api/**` routes are documented in `docs/API.md` or intentionally covered by domain-level narrative plus OpenAPI
- [ ] `docs/openapi/openapi.v1.yaml` is in sync with actual routes and remains the contract source of truth
- [ ] Response envelope unchanged: `{ errno, result, error, msg }`
- [ ] New endpoints follow auth pattern: `authenticateUser` for protected, `tryAttachUser` for optional-auth
- [ ] No existing endpoint signatures were changed without a version bump

---

## 6. Database / Firestore

- [ ] `firestore.rules` reviewed — no unintended read/write exposure
- [ ] `firestore.indexes.json` includes all indexes needed by new queries
- [ ] Any new Firestore collections are defined in rules (deny-by-default)
- [ ] Data migration scripts (if any) have been tested in emulator and staged

---

## 7. Functional Smoke Tests (Manual)

After deploying to a staging / preview channel, verify:

- [ ] Login, logout, and password reset flows work
- [ ] Dashboard loads live inverter data
- [ ] Amber prices load and site selection persists across page navigation
- [ ] Automation rules can be saved, enabled, and triggered
- [ ] Quick Control start/stop cycle completes without errors
- [ ] Settings page saves config changes successfully
- [ ] Admin panel accessible for admin users, blocked for non-admins
- [ ] History page fetch returns data and renders charts
- [ ] ROI calculator loads and displays results
- [ ] Curtailment discovery scan completes

---

## 8. Playwright E2E Tests

```bash
npm run test:e2e:frontend
```

- [ ] All Playwright tests pass

---

## 9. Post-Deploy Monitoring (first 30 minutes)

- [ ] Cloud Functions logs show no uncaught exceptions
- [ ] Error rate in Cloud Monitoring is at baseline
- [ ] Scheduler function (`runAutomation`) fires on its 1-minute cadence
- [ ] `/api/health` returns `{ errno: 0 }` from production URL
- [ ] Spot-check 2-3 live users: no JS console errors, no broken API calls

---

## 10. Rollback Trigger Criteria

Initiate rollback (see `docs/PROD_BACKUP_ROLLBACK_RUNBOOK.md`) if any of:

- Error rate exceeds 5× baseline in first 30 minutes
- Scheduler misses 3+ consecutive runs
- Login or setup flow is broken for new or existing users
- Any P0/P1 Firestore security rule regression discovered

---

_Last updated: 2026-03-11. Owner: on-call engineer._
