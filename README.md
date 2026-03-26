# Inverter Automation

SoCrates is a serverless home-energy automation platform for solar, battery,
pricing, weather, curtailment, and Tesla EV workflows. The repo ships a
Firebase-hosted web app, an `/api/**` backend, two scheduled Cloud Functions,
public decision tools, and admin/operator tooling.

## Current Capability Snapshot

- Inverter providers: FoxESS, Sungrow, SigenEnergy, AlphaESS
- Pricing providers: Amber Electric and AEMO regional market data
- Automation inputs: current price, forecast price, SoC, temperature, time,
  solar radiation, cloud cover, and EV-aware conditions
- Automation actions: `SelfUse`, `ForceCharge`, `ForceDischarge`, `Feedin`,
  `Backup` with provider-aware validation
- Manual tools: quick control, scheduler editing, diagnostics, Automation Lab
- Tesla EV: OAuth, vehicle registration, status, command-readiness, wake, and
  charging commands when transport/readiness allows it
- Admin tooling: user management, announcements, Firestore and scheduler
  metrics, API health, behavior analytics, dead-letter retry, and DataWorks ops
- Public web surface: landing page, ROI calculator, battery wear estimator,
  market insights preview, rule template recommender, blog, privacy, and terms

## Quick Start

```bash
npm ci
npm --prefix functions ci
firebase login
firebase deploy
```

Use [docs/SETUP.md](docs/SETUP.md) for local emulators, provider onboarding,
runtime secrets, Firestore paths, and production prerequisites.

## Documentation

Use [docs/INDEX.md](docs/INDEX.md) as the canonical map.

High-signal entry points:

| Document | Purpose |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Local development, provider onboarding, secrets, Firestore model, deployment prerequisites |
| [docs/API.md](docs/API.md) | Narrative API guide grouped by workflow and auth model |
| [docs/API_CONTRACT_BASELINE_MAR26.md](docs/API_CONTRACT_BASELINE_MAR26.md) | Generated live route inventory from mounted backend routes |
| [docs/openapi/openapi.v1.yaml](docs/openapi/openapi.v1.yaml) | Incremental machine-readable OpenAPI baseline |
| [docs/AUTOMATION.md](docs/AUTOMATION.md) | Rule model, supported conditions/actions, provider behavior |
| [docs/BACKGROUND_AUTOMATION.md](docs/BACKGROUND_AUTOMATION.md) | Scheduled jobs, cadence, locks, idempotency, metrics, alerting |
| [docs/AEMO_AGGREGATION_PIPELINE.md](docs/AEMO_AGGREGATION_PIPELINE.md) | Raw AEMO ingest, aggregate generation, published bundle flow, live snapshot job |
| [docs/guides/PRODUCT_GUIDE.md](docs/guides/PRODUCT_GUIDE.md) | Concise product surface and boundaries |
| [docs/guides/TESTING_GUIDE.md](docs/guides/TESTING_GUIDE.md) | Backend, frontend, contract, and release test tracks |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Practical production-safe release workflow |

## Architecture

```text
Firebase Hosting
  Public pages + authenticated app pages + PWA shell + published data assets
        |
        | /api/** rewrite
        v
Cloud Function export: api
  Express routes for setup, config, pricing, automation, devices, EV, admin,
  metrics, and diagnostics
        |
        +--> Firestore
        +--> Provider APIs (FoxESS, Sungrow, SigenEnergy, AlphaESS)
        +--> Amber Electric
        +--> AEMO adapters + Firestore live snapshots
        +--> Open-Meteo
        +--> Tesla Fleet API / signed-command proxy

Cloud Function export: runAutomation
  every 1 minute, UTC
  -> per-user automation orchestration

Cloud Function export: refreshAemoLiveSnapshots
  every 5 minutes, Australia/Brisbane
  -> refresh Firestore-backed current AEMO regional snapshots
```

## Repository Layout

```text
inverter-automation/
|-- firebase.json
|-- package.json
|-- frontend/
|   |-- index.html
|   |-- battery-roi-calculator.html
|   |-- battery-wear-estimator.html
|   |-- market-insights/
|   |-- rule-template-recommender/
|   |-- blog/
|   |-- app.html
|   |-- settings.html
|   |-- control.html
|   |-- history.html
|   |-- roi.html
|   |-- rules-library.html
|   |-- market-insights.html
|   |-- admin.html
|   |-- test.html
|   |-- data/
|   |-- js/
|   |-- css/
|-- functions/
|   |-- index.js
|   |-- api/routes/
|   |-- lib/services/
|   |-- lib/repositories/
|-- scripts/
|-- tests/
|   |-- frontend/
|   |-- scripts/
|-- docs/
```

## Local Development

Recommended emulator reset:

```bash
npm run emu:reset
```

Useful commands:

```bash
npm run emu:start
npm run emu:seed
npm run emu:status
npm run emu:stop
```

## Verification Commands

```bash
npm --prefix functions run lint
npm --prefix functions test -- --runInBand
npm run api:contract:check
npm run openapi:check
npm run test:market-insights:contracts
npm run test:pwa:versions
npm run test:release:manifest
npm run test:e2e:frontend
node scripts/pre-deploy-check.js
```

## Deployment Notes

- Functions runtime target is `nodejs22`.
- Hosting rewrites `/api/**` to the `api` Cloud Function export.
- Hosting predeploy runs `npm run aemo:dashboard:sync:hosting -- --strict` and
  `npm run release:manifest`.
- `npm run api:contract:refresh` regenerates the live route baseline from
  mounted routes only. Unmounted route modules are intentionally excluded.
- Keep API response envelopes backward compatible:
  `{ errno, result, error, msg }`.
