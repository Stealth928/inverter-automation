# Deployment Guide

Purpose: practical deployment runbook for production-safe releases.
Last updated: 2026-04-02

Use [RELEASE_READINESS_CHECKLIST.md](RELEASE_READINESS_CHECKLIST.md) for the
full go/no-go list.

## 1. Standard Safe Path

Run from repo root:

```bash
# 1) Core gate bundle
node scripts/pre-deploy-check.js

# 2) Release asset and PWA gates
npm run test:pwa:versions
npm run test:release:manifest

# 3) Frontend verification when frontend changed
npm run test:e2e:frontend

# 4) Deploy functions first when backend changed
firebase deploy --only functions

# 5) Deploy hosting when frontend/public assets changed
firebase deploy --only hosting

# 6) Deploy Firestore rules/indexes when data-access contracts changed
firebase deploy --only firestore:rules,firestore:indexes
```

## 2. Pre-deploy Guardrails

`node scripts/pre-deploy-check.js` must pass before deployment.

It currently validates:

- backend Jest suite
- market-insights contract tests
- ESLint
- docs-impact alignment
- critical module/export wiring
- Firebase rewrite sanity checks
- API contract parity
- OpenAPI parity
- repo hygiene checks

Additional release checks to run when relevant:

- `npm run docs:impact:check`
- `npm run test:pwa:versions`
- `npm run test:release:manifest`
- `npm run release:verify-live`

## 3. Deployment Modes

Use the smallest blast radius that matches the change:

- `functions` only
  - backend logic, provider behavior, scheduler changes, admin API changes
- `hosting` only
  - public pages, authenticated frontend, PWA shell, published market bundle
- `firestore:rules,firestore:indexes`
  - rules and index changes
- full `firebase deploy`
  - coordinated multi-surface release

## 4. Hosting-specific Notes

Hosting deploys are not just static file uploads.

Current Hosting predeploy in `firebase.json` runs:

1. `npm run aemo:dashboard:sync:hosting -- --strict`
2. `npm run release:manifest`

Implications:

- deploys fail if the hosted market-insights bundle cannot be validated in
  strict mode
- each hosting deploy writes `frontend/data/release-manifest.json`
- release-manifest freshness and PWA asset alignment are part of the release
  contract now

If you are performing a branch-sensitive or DataWorks-assisted deploy, run:

```bash
npm run release:verify-live
```

before the hosting deploy so you do not push a mismatched checkout over the
live branch unexpectedly.

## 5. Immediate Verification

### First 10 minutes

Check:

```bash
curl "https://<your-host>/api/health"
firebase functions:log --only runAutomation
firebase functions:log --only refreshAemoLiveSnapshots
```

Manual smoke checks:

- login, logout, and password reset
- dashboard data loads
- automation rule save/toggle/cycle
- settings persist and reload
- public tools load
- public market-insights preview loads
- admin endpoints work for admins and reject non-admins

### Release asset verification

After hosting deploy, verify:

- `/data/release-manifest.json` exists
- `/sw.js` and `/js/app-shell.js` are aligned with the expected PWA versions
- `/data/aemo-market-insights/index.json` is present and fresh

## 6. Rollback Triggers

Initiate rollback if any of the following occur:

- sustained elevated error rate after deploy
- scheduler misses expected runs
- login/setup path broken for users
- market-insights bundle missing or stale after hosting deploy
- release-manifest or PWA shell alignment is broken
- security/rules regression affecting data access

Rollback references:

- [PROD_BACKUP_ROLLBACK_RUNBOOK.md](PROD_BACKUP_ROLLBACK_RUNBOOK.md)
- [checklists/ROLLBACK_CHECKLIST.md](checklists/ROLLBACK_CHECKLIST.md)

## 7. Release Hygiene

Before merge or deploy:

- use small, reversible commits
- avoid mixing migrations, refactors, and features in one release when possible
- update docs for behavior, API, or operational-flow changes
- run `npm run docs:impact:check`
- refresh `docs/API_CONTRACT_BASELINE.md` after live route changes
- keep `docs/API.md` and `docs/openapi/openapi.v1.yaml` aligned with runtime
- keep public-content changes aligned with `sitemap.xml`, `llms.txt`,
  `llms-full.txt`, and `firebase.json`
