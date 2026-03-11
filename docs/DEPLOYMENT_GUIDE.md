# Deployment Guide

Purpose: practical deployment runbook for production-safe releases.
Last updated: 2026-03-11

For full go/no-go criteria, use `docs/RELEASE_READINESS_CHECKLIST.md`.

## 1. Standard Safe Path

Run from repo root:

```bash
# 1) Static + contract + hygiene gates
npm --prefix functions run pre-deploy

# 2) Backend verification
npm --prefix functions test -- --runInBand

# 3) Frontend verification (required when frontend changed)
npm run test:e2e:frontend

# 4) Deploy functions first (safer rollback path)
firebase deploy --only functions

# 5) Deploy hosting/rules/indexes only when needed
firebase deploy --only hosting
firebase deploy --only firestore:rules,firestore:indexes
```

## 2. Pre-Deploy Guardrails

`npm --prefix functions run pre-deploy` must pass before any deploy.

It validates:
- linting (`npm --prefix functions run lint`)
- backend test execution (`npm --prefix functions test`)
- API contract drift (`npm run api:contract:check`)
- OpenAPI drift (`npm run openapi:check`)
- repo hygiene (`npm run hygiene:check`)

If any check fails, stop and fix before deployment.

## 3. Deployment Modes

Use the smallest blast radius for the change:
- `functions` only: backend logic/config changes
- `hosting` only: frontend static assets
- `firestore:rules,firestore:indexes`: data access/index updates
- full `firebase deploy`: coordinated release touching multiple surfaces

## 4. Immediate Verification (First 10 Minutes)

```bash
# Function logs
firebase functions:log | tail -50

# Health check
curl "https://<your-host>/api/health"
```

Expected health envelope:

```json
{"errno":0,"result":{"status":"OK"}}
```

Manual smoke checks:
- auth flows (login/logout/password reset)
- dashboard data loads (inverter + pricing)
- automation rule save/toggle/trigger
- settings persist and reload correctly
- admin endpoints work for admin and reject non-admin

## 5. Rollback Triggers

Start rollback immediately if any of the following occur:
- sustained elevated error rate after deploy
- scheduler misses multiple expected runs
- login/setup path broken for users
- security/rules regression affecting data access

Rollback procedure:
- `docs/PROD_BACKUP_ROLLBACK_RUNBOOK.md`
- `docs/checklists/ROLLBACK_CHECKLIST.md`

## 6. Release Hygiene

Before merge/deploy:
- use small, reversible commits
- avoid mixing migration + feature + refactor in one deploy
- include docs updates for any API/behavior/config changes
- keep `docs/API.md` and `docs/openapi/openapi.v1.yaml` aligned with runtime
