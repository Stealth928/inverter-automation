# Inverter Automation

SoCrates is a serverless energy automation platform for solar, battery, pricing,
weather, and EV workflows. The current product ships a Firebase-hosted web app,
an API surface behind `/api/**`, and a one-minute background scheduler that
evaluates user rules, applies inverter actions, manages curtailment, and records
admin-grade metrics.

## Current Capability Snapshot

- Multi-provider inverter support: FoxESS, Sungrow, SigenEnergy, AlphaESS
- Amber Electric pricing integration for current, forecast, and history views
- Weather-aware automation using forecast temperature, radiation, and cloud cover
- Rule engine with priorities, cooldowns, time windows, blackout windows, and
  provider-aware action execution
- Manual scheduler editing plus quick charge/discharge overrides
- Tesla EV integration with OAuth onboarding, vehicle status, wake, charging
  commands, charge-limit updates, and charging-amps control when command
  readiness allows it
- Admin tooling for user management, platform stats, Firestore cost visibility,
  scheduler metrics, and SLO alerting
- Responsive frontend with PWA support and public landing/legal pages

## Quick Start

```bash
npm ci
npm --prefix functions ci
firebase login
firebase deploy
```

For local development, provider setup, emulator workflows, and operational env
vars, start with [docs/SETUP.md](docs/SETUP.md).

## Documentation

Use [docs/INDEX.md](docs/INDEX.md) as the canonical doc map.

High-value entry points:

| Document | Purpose |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Local development, deployment prerequisites, provider onboarding, runtime configuration |
| [docs/API.md](docs/API.md) | Narrative API guide for common product and operator workflows; not the exhaustive route inventory |
| [docs/openapi/openapi.v1.yaml](docs/openapi/openapi.v1.yaml) | Incremental OpenAPI contract baseline used by contract checks |
| [docs/API_CONTRACT_BASELINE_MAR26.md](docs/API_CONTRACT_BASELINE_MAR26.md) | Current measured backend/frontend route inventory while OpenAPI coverage catches up |
| [docs/AUTOMATION.md](docs/AUTOMATION.md) | Rule model, conditions, actions, and provider behavior |
| [docs/BACKGROUND_AUTOMATION.md](docs/BACKGROUND_AUTOMATION.md) | Scheduler orchestration, cadence, concurrency, metrics, and alerting |
| [docs/guides/PRODUCT_GUIDE.md](docs/guides/PRODUCT_GUIDE.md) | Product-facing description of shipped UI and capability |
| [docs/guides/TESTING_GUIDE.md](docs/guides/TESTING_GUIDE.md) | Backend/frontend test execution and CI alignment |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Production-safe release workflow |

## Architecture

```text
Frontend (Firebase Hosting)
  Public pages + authenticated app shell + PWA assets
        |
        | /api/** rewrite
        v
HTTP API (Cloud Function export: api)
  Express routes for setup, config, pricing, device control,
  automation, history, EV, admin, diagnostics, and metrics
        |
        +--> Firestore (user config, rules, caches, audit, metrics)
        +--> Provider APIs (FoxESS, Sungrow, SigenEnergy, AlphaESS)
        +--> Amber Electric
        +--> Open-Meteo
        +--> Tesla Fleet API / signed-command proxy when needed

Background Scheduler (Cloud Function export: runAutomation)
  1-minute cadence -> per-user orchestration -> automation cycle execution
```

## Repository Layout

```text
inverter-automation/
|-- firebase.json
|-- package.json
|-- frontend/
|   |-- index.html                  # Public landing page
|   |-- app.html                    # Authenticated dashboard
|   |-- setup.html                  # Guided setup flow
|   |-- settings.html               # Credentials, automation, Tesla, curtailment
|   |-- control.html                # Manual control workflows
|   |-- history.html                # Reports and history
|   |-- roi.html                    # ROI analysis
|   |-- rules-library.html          # Rule templates
|   |-- admin.html                  # Admin dashboard
|   |-- js/
|   |-- css/
|-- functions/
|   |-- index.js                    # Composition root + exports
|   |-- api/routes/                 # Route registration modules
|   |-- lib/services/               # Automation, EV, admin, and runtime services
|   |-- lib/repositories/           # Firestore data access helpers
|-- scripts/                        # Quality gates, emulator tooling, contract checks
|-- docs/                           # Canonical docs, runbooks, audits, and historical evidence
```

## Local Development

Recommended emulator workflow:

```bash
npm run emu:reset
```

Other useful commands:

```bash
npm run emu:start
npm run emu:seed
npm run emu:status
npm run emu:stop
```

Verification commands:

```bash
npm --prefix functions run lint
npm --prefix functions test -- --runInBand
npm run api:contract:check
npm run openapi:check
npm run test:e2e:frontend
node scripts/pre-deploy-check.js
```

## Deployment Notes

- Node runtime target is `nodejs22`
- Hosting rewrites `/api/**` to the `api` Cloud Function
- The scheduled automation export is `runAutomation`
- Keep response envelopes backward compatible: `{ errno, result, error, msg }`
- Update docs and focused tests when changing API behavior or operational flows
