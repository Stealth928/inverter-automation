# Documentation Governance

Last updated: 2026-04-02
Purpose: define which docs must stay current, which code changes trigger doc
updates, and where docs alignment is enforced.

## 1. Current vs Historical Docs

This repo keeps two kinds of markdown:

- current canonical docs that must describe the product and operational reality
  as it exists now
- historical evidence and dated project records that explain how we got here

Current canonical docs should use stable filenames where practical. Historical
evidence can keep dated filenames because it is preserved as an audit trail.

## 2. Canonical Docs That Must Stay Current

These are the primary maintained docs for shipped behavior and operator flows:

- `README.md`
- `docs/INDEX.md`
- `docs/SETUP.md`
- `docs/API.md`
- `docs/API_CONTRACT_BASELINE.md`
- `docs/openapi/openapi.v1.yaml`
- `docs/AUTOMATION.md`
- `docs/BACKGROUND_AUTOMATION.md`
- `docs/AEMO_AGGREGATION_PIPELINE.md`
- `docs/DEPLOYMENT_GUIDE.md`
- `docs/RELEASE_READINESS_CHECKLIST.md`
- `docs/LOGGING_GUIDE.md`
- `docs/USER_DEBUGGING_RUNBOOK.md`
- `docs/guides/PRODUCT_CAPABILITY_GUIDE.md`
- `docs/guides/FRONTEND_CONTENT_GUIDE.md`
- `docs/guides/TESTING_GUIDE.md`
- `docs/guides/TESLA_ONBOARDING.md`

Historical evidence under `docs/evidence/`, dated phase plans, and closeout
artifacts are intentionally retained for context. They are not the day-to-day
source of truth for shipped behavior.

## 3. Docs Impact Matrix

Use this matrix when code changes land.

| Change area | Typical code paths | Update one or more of |
| --- | --- | --- |
| Live API surface, auth model, endpoint contracts | `functions/index.js`, `functions/api/**`, `frontend/js/api-client.js`, `scripts/api-contract-baseline.js`, `scripts/openapi-contract-check.js` | `docs/API.md`, `docs/openapi/openapi.v1.yaml`, `docs/API_CONTRACT_BASELINE.md` |
| Automation runtime, scheduler, rule behavior, quick control, Automation Lab | `functions/api/routes/automation*`, `functions/api/routes/quick-control.js`, `functions/api/routes/scheduler*`, `functions/lib/services/automation*`, `functions/lib/services/quick-control-service.js`, `functions/lib/services/scheduler*`, `functions/lib/services/backtest-service.js`, `frontend/test.html`, `frontend/control.html`, `frontend/settings.html`, `frontend/app.html`, `frontend/js/automation-lab-backtest.js`, `frontend/js/dashboard.js`, `frontend/js/control.js`, `frontend/js/settings.js` | `docs/AUTOMATION.md`, `docs/BACKGROUND_AUTOMATION.md`, `docs/guides/PRODUCT_CAPABILITY_GUIDE.md` |
| Public or authenticated product surface | `frontend/**`, `frontend/js/**`, `frontend/css/**`, `frontend/*.html`, `frontend/*/index.html`, `frontend/sitemap.xml`, `frontend/llms*.txt`, `frontend/manifest.webmanifest` | `docs/guides/PRODUCT_CAPABILITY_GUIDE.md`, `docs/guides/FRONTEND_CONTENT_GUIDE.md`, `README.md` |
| Market-insights pipeline and published data flow | `scripts/generate-aemo-market-insights.js`, `scripts/aemo-market-insights-delta-update.js`, `scripts/sync-hosted-market-insights.js`, `frontend/data/aemo-market-insights/**`, `frontend/market-insights/**`, `frontend/js/market-insights*.js` | `docs/AEMO_AGGREGATION_PIPELINE.md`, `docs/guides/PRODUCT_CAPABILITY_GUIDE.md`, `docs/guides/FRONTEND_CONTENT_GUIDE.md` |
| Deployment, release gates, CI, repo policy | `.github/workflows/**`, `.github/copilot-instructions.md`, `firebase.json`, `package.json`, `functions/package.json`, `scripts/pre-deploy-check.js`, `scripts/repo-hygiene-check.js`, `scripts/generate-release-manifest.js`, `scripts/verify-release-alignment.js` | `docs/DEPLOYMENT_GUIDE.md`, `docs/RELEASE_READINESS_CHECKLIST.md`, `docs/guides/TESTING_GUIDE.md`, `docs/DOCUMENTATION_GOVERNANCE.md` |
| Firestore contracts, local setup, seed/restore flows | `firestore.rules`, `firestore.indexes.json`, `functions/scripts/seed-emulator-state.js`, `functions/scripts/restore-user-config.js`, `functions/scripts/cleanup-stale-state.js` | `docs/SETUP.md`, `docs/PROD_BACKUP_ROLLBACK_RUNBOOK.md`, `docs/checklists/MIGRATION_SAFETY_CHECKLIST.md`, `docs/checklists/ROLLBACK_CHECKLIST.md` |

When in doubt, prefer updating an existing canonical doc instead of creating a
new overlapping one.

## 4. Enforcement Points

The repo now checks docs alignment in four places:

1. `npm run docs:impact:check`
2. `node scripts/pre-deploy-check.js`
3. `.github/workflows/qa-checks.yml`
4. `.github/pull_request_template.md`

The docs-impact checker maps changed files to the matrix above and expects at
least one corresponding canonical doc to change in the same diff.

## 5. No-doc-impact Escape Hatch

Pure internal refactors and invisible test-only changes do happen.

If a mapped code path changed but no canonical doc needs an update:

- in a pull request, fill in `No doc impact:` with a short reason
- locally, pass `npm run docs:impact:check -- --allow-no-docs "<reason>"`

This should be the exception, not the default.

## 6. Maintenance Rules

- Prefer stable filenames for current source-of-truth docs.
- Keep generated truth surfaces generated from code where possible.
- Refresh generated docs in the same change that updates the underlying
  behavior.
- If a document becomes historical, mark it as such from `docs/INDEX.md`.
