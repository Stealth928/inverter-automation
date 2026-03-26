# Release Readiness Checklist

Last updated: 2026-03-26

Use this checklist before every production deployment. All items should be
complete before merging to `main` and deploying.

## 1. Core Quality Gates

- [ ] `npm --prefix functions run lint`
- [ ] `npm --prefix functions test -- --runInBand`
- [ ] `node scripts/pre-deploy-check.js`
- [ ] `npm run api:contract:check`
- [ ] `npm run openapi:check`
- [ ] `npm run test:market-insights:contracts`
- [ ] `npm run test:pwa:versions`
- [ ] `npm run test:release:manifest`

## 2. Security and Environment

- [ ] `npm audit --prefix functions` has no unresolved critical or high issues
- [ ] `npm audit` at repo root has no unresolved critical or high issues
- [ ] no secrets or credentials were committed to source
- [ ] Firestore security rules were reviewed for any new collections or paths
- [ ] all new authenticated routes are protected by the current auth model
- [ ] Firebase project target is correct for the intended environment
- [ ] emulator-only environment variables are not present in production
- [ ] required function secrets and env vars are configured in deployed runtime

## 3. API and Documentation Alignment

- [ ] `docs/API_CONTRACT_BASELINE_MAR26.md` was refreshed after route changes
- [ ] `docs/API.md` matches the live API behavior and auth model
- [ ] `docs/openapi/openapi.v1.yaml` still matches the routes it declares
- [ ] response envelopes remain backward compatible:
  `{ errno, result, error, msg }`
- [ ] unmounted route modules are not being treated as live functionality
- [ ] product, setup, and deployment docs were updated for shipped behavior

## 4. Frontend and Public Content

- [ ] authenticated pages remain `noindex`
- [ ] public pages remain correctly listed in `sitemap.xml`
- [ ] `llms.txt` and `llms-full.txt` reflect the current public surface
- [ ] no large accidental inline script regressions were introduced
- [ ] frontend API calls still go through the current shared fetch/client paths
- [ ] `manifest.webmanifest`, `sw.js`, and `js/app-shell.js` are aligned
- [ ] public tools and market-insights preview still load on desktop and mobile

## 5. Hosting and Release Assets

- [ ] hosting predeploy assumptions are understood:
  `aemo:dashboard:sync:hosting -- --strict` and `release:manifest`
- [ ] `/data/release-manifest.json` will be generated from the current checkout
- [ ] published market-insights bundle is current
- [ ] `npm run release:verify-live` was run when branch/live alignment matters

## 6. Data and Firestore Contracts

- [ ] `firestore.rules` were reviewed for new access patterns
- [ ] `firestore.indexes.json` includes all indexes needed by new queries
- [ ] migrations were tested in emulator or staging if applicable
- [ ] new Firestore paths are documented in canonical setup/operations docs

## 7. Manual Smoke Coverage

- [ ] login, logout, and password reset work
- [ ] dashboard loads telemetry and pricing
- [ ] automation rules can be saved, enabled, and triggered
- [ ] quick control start/stop works
- [ ] settings save and reload correctly
- [ ] market-insights preview loads
- [ ] authenticated market-insights workspace loads
- [ ] rules library and rule-template recommender still hand off correctly
- [ ] admin panel works for admins and rejects non-admins

## 8. Post-deploy Monitoring Plan

- [ ] `/api/health` will be checked immediately after deploy
- [ ] `runAutomation` logs will be watched after deploy
- [ ] `refreshAemoLiveSnapshots` logs will be watched after deploy
- [ ] release-manifest and PWA asset alignment will be spot-checked after
  hosting deploy
- [ ] market-insights bundle freshness will be spot-checked after hosting deploy

## 9. Rollback Criteria

- [ ] rollback plan is ready if error rate spikes materially
- [ ] rollback plan is ready if scheduler cadence breaks
- [ ] rollback plan is ready if login/setup flows break
- [ ] rollback plan is ready if release assets or market-insights bundle ship in
  a broken state
- [ ] rollback plan is ready if any security regression is discovered
