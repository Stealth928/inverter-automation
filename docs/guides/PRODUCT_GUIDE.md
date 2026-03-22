# SoCrates Product Guide

Last updated: 2026-03-22

## Purpose

This is the concise product guide for the currently shipped SoCrates product.
It is intended to stay short, accurate, and safe for product, support, and
customer-facing use.

For the exhaustive product reference, use [PRODUCT_CAPABILITY_GUIDE.md](PRODUCT_CAPABILITY_GUIDE.md)
alongside this document.

## Product Summary

SoCrates is a responsive web application for home energy automation. It brings
together inverter telemetry, battery control, electricity pricing, weather
forecast context, manual control tools, reporting, solar curtailment, and Tesla
EV workflows in a single browser-based product.

The shipped product includes:

- live inverter and battery telemetry
- multi-provider device onboarding and account management
- Amber pricing integration and price history
- weather-aware and timezone-aware automation
- rule-based battery and scheduler control
- quick temporary overrides and direct scheduler editing
- history, reporting, and ROI views
- solar curtailment controls and advanced diagnostics
- Tesla EV onboarding, status, readiness checks, wake, and charging commands
- admin and support tooling including platform metrics and behavior analytics

The product ships as a web app with PWA support. There is no separate native
mobile app in this repository.

## Current Product Surface

| Page | What it does today | Notes |
| --- | --- | --- |
| `index.html` | Public landing page | Product positioning, pricing, FAQ, and legal links |
| `login.html` / `reset-password.html` | Authentication entry points | Email/password sign-in and reset flow |
| `setup.html` | Guided onboarding | Still more FoxESS-first than the backend capability map |
| `app.html` | Main dashboard | Telemetry, prices, weather, automation status, quick control, EV summary |
| `control.html` | Advanced manual control | Device control, scheduler editing, diagnostics, and discovery-oriented tools |
| `history.html` | History and reporting | Automation history, energy views, and support-oriented raw views |
| `roi.html` | ROI analysis | Automation ROI and related savings views |
| `battery-roi-calculator.html` | ROI calculator | Battery economics calculator and scenario analysis |
| `market-insights.html` | Market insights | Pricing and market trend views |
| `rules-library.html` | Rule template library | Import-ready templates with scaling support |
| `settings.html` | Settings and integrations | Provider credentials, location, automation options, curtailment, Tesla onboarding |
| `admin.html` | Admin panel | User management, platform metrics, Firestore metrics, scheduler metrics, behavior analytics |
| `privacy.html` / `terms.html` | Legal pages | Publicly accessible |

## Core Capabilities

### 1. Automation Engine

The automation engine evaluates user rules on a recurring cadence.

- default cycle interval is 60 seconds
- per-user interval overrides are supported
- rules are sorted by numeric priority
- lower number means higher priority
- only the first fully matching rule wins a cycle
- rule evaluation is AND-only

### 2. Rule Inputs

Current rule conditions include:

- current buy price
- current feed-in price
- forecast price look-ahead
- battery state of charge
- battery, ambient, inverter, and forecast temperature checks
- time windows and weekday filters
- solar radiation look-ahead
- cloud-cover look-ahead

### 3. Rule Actions

The current action model includes:

- `SelfUse`
- `ForceCharge`
- `ForceDischarge`
- `Feedin`
- `Backup`

Depending on provider support and action type, rules may also apply:

- duration
- target or stop SoC values
- power setpoint
- minimum grid SoC
- maximum SoC
- cooldown minutes

### 4. Manual Control Paths

The shipped product has two main manual override surfaces:

- Quick Control for temporary charge or discharge actions
- manual scheduler editing for direct schedule segment control

Important behavior:

- quick control is time-boxed and pauses automation while active
- manual scheduler segments can later be overwritten by automation

### 5. Reporting, History, and ROI

The reporting surface includes:

- Amber price history
- inverter history and report paths
- generation summaries
- automation history and audit visibility
- ROI analysis and calculator views
- support-oriented raw data access in selected views

### 6. Solar Curtailment

Curtailment is part of the current shipped product.

Current behavior includes:

- users can enable curtailment in Settings
- users can configure a feed-in price threshold
- runtime tracks curtailment state separately from rule winners
- advanced discovery and diagnostics help support or admin users inspect
  topology and export-limit behavior on supported paths

The discovery surface is an advanced support workflow, not the normal first-run
path for most users.

### 7. Tesla EV Integration

Tesla support is part of the live product surface.

What is shipped today:

- OAuth onboarding in Settings
- VIN-based vehicle registration
- dashboard EV status and overview
- manual wake
- start charging
- stop charging
- set charge limit
- set charging amps
- per-vehicle command readiness checks and transport hints

Important nuance:

- some vehicles can use direct Tesla commands
- some require signed commands and supporting proxy infrastructure
- controls are shown or enabled only when readiness allows them

### 8. Admin and Support Tooling

The product also includes operator-facing capability:

- user management
- shared announcement management
- platform and Firestore metrics
- scheduler SLO metrics
- GA4-backed behavior analytics
- support diagnostics and impersonation flows

## Supported Integrations

| Integration | Current status | Notes |
| --- | --- | --- |
| FoxESS | Primary production path | Broadest coverage across telemetry, reports, scheduler, quick control, diagnostics, and curtailment |
| Sungrow | Supported | Adapter-backed telemetry, control, scheduling, and validation exist; FoxESS-only diagnostics do not apply |
| SigenEnergy | Supported with narrower maturity | Live telemetry and work-mode support are present; full parity with FoxESS is not claimed |
| AlphaESS | Supported | Validation, normalized telemetry, and control paths exist |
| Amber Electric | Production | Current pricing, history, site workflows, automation context, and ROI |
| Weather | Production | Forecast and timezone/location-driven automation context |
| Tesla EV | Production with readiness gating | Status and charging controls are available when Tesla auth and command transport requirements are satisfied |

## Important Product Boundaries

Keep these constraints explicit in product and support material:

- rule evaluation is AND-only
- only the first matching rule fires per cycle
- manual scheduler edits are not protected from later automation changes
- FoxESS remains the richest diagnostics and curtailment path
- provider feature parity is not identical across all integrations
- the setup page UX is still more FoxESS-first than the backend capability map
- the curtailment discovery tooling is an advanced support surface, not the
  default onboarding path
- Tesla command availability is vehicle- and environment-dependent because of
  readiness checks, permissions, and signed-command requirements

## Recommended User Journey

For most users, the most accurate current product flow is:

1. sign in and complete guided setup
2. confirm provider credentials, site selection, and location in Settings
3. connect Amber if price-aware automation or ROI analysis is wanted
4. create or import rules from the Rules Library
5. monitor behavior from the dashboard, history, and market views
6. use Quick Control or manual scheduler editing only for temporary or manual
   interventions
7. connect Tesla from Settings if EV visibility or charging control is needed

## Positioning Guidance

Use these claims:

- SoCrates is a multi-provider home energy automation platform.
- The product combines live telemetry, pricing, weather context, rules,
  manual controls, reporting, and admin tooling in one web app.
- Tesla EV integration includes onboarding, status visibility, and charging
  controls when readiness checks pass.
- The app is delivered as a responsive web app with PWA support.

Avoid these claims:

- every provider has identical feature parity
- every product surface is equally mature for every supported integration
- Tesla commands are guaranteed for every vehicle without additional setup
- curtailment discovery is the standard first-run workflow for all users

