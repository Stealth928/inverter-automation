# SoCrates Product Guide

Last updated: 2026-03-26

## Purpose

This is the concise product guide for the currently shipped SoCrates product.
Use it for accurate product, support, and customer-facing summaries.

For the detailed reference, see
[PRODUCT_CAPABILITY_GUIDE.md](PRODUCT_CAPABILITY_GUIDE.md).

## Product Summary

SoCrates is a responsive web application for home solar, battery, pricing,
weather, and EV-aware automation. It combines live device telemetry,
rule-driven automation, temporary overrides, reporting, market insights, public
decision tools, and operator/admin tooling in a single browser-based product.

The product ships as a web app with PWA support. There is no separate native
mobile app in this repository.

## Public Surface

Current crawlable/public pages:

- `/`
- `/battery-roi-calculator.html`
- `/battery-wear-estimator.html`
- `/market-insights/`
- `/rule-template-recommender/`
- `/blog/`
- `/home-battery-automation-options-compared/`
- `/battery-automation-roi-examples/`
- `/privacy.html`
- `/terms.html`

Key public roles:

- marketing and product positioning
- battery economics tools
- public AEMO market-insights preview
- rule-template discovery before login
- blog and SEO content

## Authenticated Surface

| Page | What it does today | Notes |
| --- | --- | --- |
| `login.html` / `reset-password.html` | Authentication entry points | Public auth pages, not crawl targets |
| `setup.html` | Guided onboarding | Still more FoxESS-first than the full backend capability map |
| `app.html` | Main dashboard | Telemetry, prices, weather, automation status, quick control, EV summary |
| `control.html` | Advanced control page | Device control, scheduler editing, diagnostics, and discovery tools |
| `history.html` | History and reporting | Automation history, reports, and support-oriented views |
| `roi.html` | Member ROI analysis | Automation ROI and savings-oriented reporting |
| `rules-library.html` | Rules library | Import-ready templates and scaling logic |
| `market-insights.html` | Full member market workspace | Distinct from the public preview at `/market-insights/` |
| `settings.html` | Settings and integrations | Provider credentials, location, automation, curtailment, Tesla |
| `admin.html` | Admin panel | Metrics, announcements, user ops, DataWorks, dead-letter handling |
| `test.html` | Automation Lab | Internal QA/test surface, not customer-facing |

## Core Capabilities

### Automation engine

- recurring rule evaluation with a default 60-second cadence
- per-user interval overrides
- priority-ordered evaluation
- AND-only rule logic
- first matching rule wins a cycle

### Current rule inputs

- current buy price
- current feed-in price
- forecast price look-ahead
- battery SoC
- battery and ambient temperature
- forecast daily min/max temperature
- time windows and weekday filters
- solar radiation look-ahead
- cloud-cover look-ahead
- EV SoC, EV location, and EV charging-state conditions

### Rule actions

- `SelfUse`
- `ForceCharge`
- `ForceDischarge`
- `Feedin`
- `Backup`

### Manual controls

- quick control for temporary override flows
- direct scheduler editing
- advanced diagnostics and control tooling on authenticated pages

### Market and reporting surfaces

- dashboard pricing context
- member market-insights workspace
- public market-insights preview
- history and reporting views
- member ROI view
- public ROI calculator
- public battery wear estimator

### Tesla EV

- OAuth onboarding in Settings
- vehicle registration
- dashboard EV status
- command-readiness checks
- wake
- start/stop charge
- charge-limit updates
- charging-amps control when readiness allows it

### Admin and support tooling

- user management
- shared announcements
- platform and Firestore metrics
- scheduler SLO metrics
- API health views
- GA4 behavior analytics
- dead-letter retry
- DataWorks workflow visibility and dispatch

## Supported Integrations

| Integration | Current status | Notes |
| --- | --- | --- |
| FoxESS | Primary production path | Richest support across telemetry, scheduler, diagnostics, quick control, and curtailment |
| Sungrow | Supported | Adapter-backed telemetry and control paths are live |
| SigenEnergy | Supported with narrower maturity | Work-mode support is live; parity with FoxESS is not claimed |
| AlphaESS | Supported | Validation, normalized telemetry, and control paths are live |
| Amber Electric | Production | Pricing, history, automation context, and ROI |
| AEMO | Production | Regional pricing plus public and member market-insights surfaces |
| Weather | Production | Forecast and timezone-aware automation context |
| Tesla EV | Production with readiness gating | Status and charging controls are shown when Tesla auth and transport readiness permit |

## Important Product Boundaries

- rule evaluation is AND-only
- only one rule wins a cycle
- manual scheduler edits are not reserved against later automation writes
- provider feature parity is not identical across all integrations
- the guided setup UX is still more FoxESS-first than the backend support map
- the public market-insights preview is not the full member workspace
- the rule-template recommender is a public guide, not the rules library itself
- `test.html` is an internal Automation Lab and not a customer-facing product
- Tesla command availability is vehicle- and environment-dependent
