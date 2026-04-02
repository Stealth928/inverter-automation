# SoCrates Product Capability Guide

Last updated: 2026-03-28

## Purpose

This is the detailed product reference for the currently shipped SoCrates
product. Use it when you need an accurate answer to:

- what the product includes today
- which pages are public versus authenticated
- which workflows are live versus internal/support-oriented
- how provider support differs across integrations
- what product boundaries must be stated clearly

For a short legacy summary alias, see
[PRODUCT_GUIDE.md](PRODUCT_GUIDE.md). This file is the canonical product
reference.

## At a Glance

- Browser-based energy automation platform with PWA support
- Public surface includes the landing page, public battery tools, market
  insights preview, blog, and policy pages
- Authenticated surface includes the dashboard, control, history, ROI, rules
  library, full market workspace, settings, admin, and Automation Lab
- Core systems include rule-based automation, pricing integrations, provider
  adapters, Tesla EV, and solar curtailment

## Product Definition

SoCrates is a browser-based energy automation platform for residential solar,
battery, pricing, weather, and EV-aware workflows. The product combines:

- authenticated accounts
- provider onboarding and settings management
- live telemetry
- rule-based automation
- manual overrides and scheduler editing
- reporting and ROI surfaces
- market insights
- public decision tools
- Tesla EV onboarding and control
- admin/operator tooling

The product is delivered as a web app with PWA support. This repository does
not ship a separate native mobile app.

## Delivery Model

### Public surface

| Route | Purpose | Audience |
| --- | --- | --- |
| `/` | Landing page and product positioning | Public |
| `/battery-roi-calculator.html` | Public battery ROI calculator | Public |
| `/battery-wear-estimator.html` | Public battery wear economics estimator | Public |
| `/market-insights/` | Public AEMO market-insights preview | Public |
| `/rule-template-recommender/` | Public rule-template recommender | Public |
| `/blog/` | Blog index | Public |
| `/amber-smartshift-vs-socrates/` | Blog post | Public |
| `/home-battery-automation-options-compared/` | Blog post | Public |
| `/battery-automation-roi-examples/` | Blog post | Public |
| `/privacy.html` | Privacy policy | Public |
| `/terms.html` | Terms of service | Public |

### Authenticated and internal surface

| Page | Purpose | What users do there |
| --- | --- | --- |
| `login.html` | Sign-in | Start an authenticated session |
| `reset-password.html` | Password reset | Complete reset flow |
| `setup.html` | Guided onboarding | Validate first provider setup and initial pricing choices |
| `app.html` | Dashboard | Monitor telemetry, prices, automation state, EV summary, quick control |
| `control.html` | Control and diagnostics | Manual actions, scheduler editing, advanced diagnostics |
| `history.html` | Reporting/history | Review automation and energy history |
| `roi.html` | Member ROI analysis | Review automation savings and ROI views |
| `rules-library.html` | Rules library | Browse and import rule templates |
| `market-insights.html` | Full market workspace | Member market analysis experience |
| `settings.html` | Configuration hub | Provider credentials, automation config, curtailment, Tesla |
| `admin.html` | Admin console | Metrics, user ops, announcements, DataWorks, dead letters |
| `test.html` | Automation Lab | Two-mode testing surface: Quick Simulation for single-moment rule evaluation, and Backtesting/Optimisation for historical replay with visual savings reports, interval impact analysis, rule mix charts, tariff comparison, and explainable rule optimisation |

Important distinction:

- `/market-insights/` is the public preview
- `market-insights.html` is the authenticated full workspace
- `/rule-template-recommender/` is a public guide
- `rules-library.html` is the authenticated import/edit experience

## Capability Domains

### 1. Authentication and lifecycle

Current product behavior includes:

- email/password sign-in
- password reset flow
- authenticated session handling across pages
- user-profile initialization and cleanup hooks on the backend

The product also tracks account state used elsewhere in the app, such as:

- setup completion
- tour completion
- automationEnabled mirror state
- announcement dismissal state

### 2. Onboarding and configuration

Current onboarding/configuration behavior includes:

- guided setup through `setup.html`
- broader provider configuration through `settings.html`
- pricing-provider selection between Amber and AEMO
- location-driven weather and timezone configuration
- Tesla onboarding from Settings

Current backend-supported provider validation includes:

- FoxESS
- Sungrow
- SigenEnergy
- AlphaESS

Important nuance:

- the guided setup UX is still more FoxESS-first than the full backend support
  map
- the repo does not currently expose live mounted provider-account management
  routes even though repository helpers exist on disk

### 3. Dashboard and live telemetry

The main dashboard is the everyday operational surface.

Current shipped behavior includes:

- live inverter and battery telemetry
- power-flow visibility
- pricing context
- weather context
- automation status and next-cycle context
- quick-control entry points
- EV summary when Tesla is connected

### 4. Automation engine

Automation is a core product capability.

Current execution behavior:

- recurring default cadence of 60 seconds
- per-user interval overrides
- rules sorted by numeric priority
- AND-only rule logic
- first matching rule wins
- audit and history writes for outcomes

Current supported rule-input families:

- current buy/feed-in price
- forecast price look-ahead
- battery SoC
- temperature and forecast temperature
- time windows and weekday filters
- solar radiation
- cloud cover
- EV SoC, location, and charging state

Current supported work modes:

- `SelfUse`
- `ForceCharge`
- `ForceDischarge`
- `Feedin`
- `Backup`

Important product boundary:

- SoCrates is rule-based and deterministic, not a machine-learning optimizer

### 5. Manual overrides and scheduler control

Current manual-intervention capability includes:

- quick control for temporary charge/discharge overrides
- direct scheduler read/write flows
- advanced control/diagnostics on authenticated pages

Important boundary:

- manual scheduler edits are not protected from later automation writes

### 6. Pricing, weather, and market insight

Current pricing/weather behavior includes:

- Amber Electric integration
- AEMO regional pricing integration
- weather-driven automation inputs
- location-aware timezone resolution

Current market surfaces include:

- pricing context inside the app
- member market-insights workspace
- public market-insights preview backed by the published AEMO bundle

### 7. Reporting, ROI, and public tools

Current reporting and analysis surfaces include:

- automation history
- inverter history and generation views
- member ROI analysis in `roi.html`
- public ROI calculator
- public battery wear estimator

The repo also includes a public rule-template recommender that maps visitors to
starter rules before handing off to the authenticated rules library.

### 8. Rules library and template handoff

Current rules-library capability includes:

- curated rule templates
- import-ready flows
- power scaling relative to inverter capacity
- duplicate-priority handling during import

Public companion capability:

- `/rule-template-recommender/` explains starter bundles and can hand users into
  the authenticated rules-library flow

### 9. Solar curtailment

Curtailment is part of the live product.

Current user-facing behavior includes:

- enabling curtailment in Settings
- saving a feed-in price threshold
- runtime curtailment state tracking

Current runtime boundary:

- live export-limit mutation support is FoxESS-only
- non-FoxESS providers are reported as unsupported for curtailment actions

### 10. Tesla EV integration

Tesla is part of the shipped product surface.

Current live capability includes:

- OAuth onboarding
- VIN-based vehicle registration
- EV status
- command-readiness checks
- wake
- start/stop charge
- charge-limit updates
- charging-amps control

Important boundary:

- Tesla controls are readiness-gated
- some vehicles can use direct commands
- some require signed-command transport and proxy infrastructure

### 11. Admin and operator tooling

Current operator-facing capability includes:

- user management
- role changes
- user deletion
- impersonation
- shared announcements
- Firestore metrics
- platform stats
- scheduler metrics
- API health metrics
- behavior analytics
- dead-letter retry
- DataWorks workflow diagnostics and dispatch

## Integration Matrix

| Integration | Current status | Notes |
| --- | --- | --- |
| FoxESS | Primary production path | Richest support across telemetry, scheduler, diagnostics, quick control, curtailment |
| Sungrow | Supported | Adapter-backed telemetry and control are live |
| SigenEnergy | Supported with narrower maturity | Work-mode support is live; parity with FoxESS is not claimed |
| AlphaESS | Supported | Validation, normalized telemetry, and control paths are live |
| Amber Electric | Production | Pricing, history, automation context, ROI |
| AEMO | Production | Regional pricing, public preview, member market-insights workspace |
| Weather | Production | Forecast-aware and timezone-aware automation input |
| Tesla EV | Production with readiness gating | Commands depend on auth, permissions, and transport readiness |

## Important Product Boundaries

Keep these constraints explicit in product and support material:

- only one rule wins per cycle
- automation logic is AND-only
- provider parity is not identical
- the setup flow is narrower than the full backend capability map
- the public market-insights preview is not the full member workspace
- the public rule-template recommender is not the rules library itself
- `test.html` is the Automation Lab with two modes: Quick Simulation and Backtesting/Optimisation
- Tesla commands are not guaranteed for every vehicle/environment
