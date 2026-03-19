# SoCrates Product Guide

Last updated: 2026-03-17

## Purpose

This guide describes the product that is currently shipped in this repository.
It is grounded in the live frontend pages, current backend routes, and the
provider adapters wired into the runtime.

## Product Summary

SoCrates is a responsive web app for energy automation across solar, battery,
pricing, weather, and Tesla EV workflows. The platform combines:

- live device telemetry
- Amber pricing data and price history
- weather-aware and timezone-aware automation
- rule-based battery and scheduler control
- manual quick overrides and scheduler editing
- solar curtailment controls
- Tesla EV onboarding, status, wake, and charging commands
- reporting, ROI analysis, and admin/support tooling

The product ships as a web app plus PWA-capable frontend. There is no separate
native mobile app in this repository.

## Current Product Surface

| Page | What it does today | Notes |
| --- | --- | --- |
| `index.html` | Public landing page | Marketing, feature positioning, pricing, FAQ, legal links |
| `login.html` / `reset-password.html` | Authentication entry points | Email/password auth flow |
| `setup.html` | Guided first-run onboarding | Still FoxESS-first in the UX, even though backend support is broader |
| `app.html` | Main authenticated dashboard | Telemetry, pricing, weather, automation, quick control, manual scheduler, EV overview |
| `control.html` | Manual control surface | Advanced device and manual control workflows |
| `history.html` | History and reporting | Automation history, energy/history views, raw and support-oriented data |
| `roi.html` | ROI analysis | Automation ROI and related reporting workflows |
| `rules-library.html` | Template library | Import-ready rule templates with power scaling |
| `settings.html` | System settings | Provider credentials, location/timezone, automation options, curtailment, Tesla onboarding |
| `curtailment-discovery.html` | Advanced curtailment discovery surface | Admin/support-oriented curtailment and topology investigation |
| `admin.html` | Admin panel | User management, platform stats, Firestore metrics, scheduler metrics |
| `privacy.html` / `terms.html` | Legal pages | Publicly accessible |

## Core Capabilities

### 1. Automation Engine

The automation engine evaluates user rules on a recurring cadence.

- default cycle interval is 60 seconds
- per-user interval overrides are supported
- rules are sorted by numeric priority
- lower number means higher priority
- only the first fully matching rule wins a cycle
- rule evaluation remains AND-only

### 2. Rule Conditions

The current rule model supports:

- current buy price
- current feed-in price
- forecast price look-ahead
- battery SoC
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

### 4. Manual Override Paths

The product has two manual override surfaces:

- Quick Control for fast temporary charge/discharge actions
- Manual scheduler editing for direct schedule segment control

Important product behavior:

- quick control is time-boxed and pauses automation while active
- manual scheduler segments can later be overwritten by automation

### 5. Reporting and ROI

The reporting surface includes:

- Amber price history
- inverter history and report paths
- generation summaries
- automation history
- ROI analysis views
- support-oriented raw data access in selected views

### 6. Solar Curtailment

Curtailment is no longer just a future concept.

Current shipped behavior:

- users can enable curtailment in Settings
- users can configure a feed-in price threshold
- runtime tracks curtailment state separately from rule winners
- the advanced discovery page helps support/admin users inspect topology and
  export-limit behavior on supported FoxESS-style paths

The discovery surface is best described as an advanced support/admin feature
rather than a general first-time workflow.

### 7. Tesla EV Integration

Tesla support is part of the live product surface.

What is currently shipped:

- OAuth onboarding in Settings
- VIN-based vehicle registration
- dashboard EV overview and status
- manual wake
- start charging
- stop charging
- set charge limit
- set charging amps
- per-vehicle command readiness checks and transport hints

Important product nuance:

- some vehicles can use direct Tesla commands
- some require signed commands and supporting proxy infrastructure
- controls are only shown or enabled when command readiness allows it

## Supported Integrations

| Integration | Current status | Notes |
| --- | --- | --- |
| FoxESS | Primary production path | Broadest coverage across telemetry, reports, scheduler, quick control, diagnostics, and curtailment support |
| Sungrow | Supported | Adapter-backed telemetry, control, scheduling, and setup validation exist; FoxESS-only diagnostics do not apply |
| SigenEnergy | Supported with narrower maturity | Live telemetry and work-mode support are present; parity with FoxESS on every reporting/scheduling path is not claimed |
| AlphaESS | Supported | Settings validation and normalized status/control paths exist |
| Amber Electric | Production | Current pricing, short-horizon forecast pricing, site workflows, history, and ROI |
| Weather | Production | Forecast and timezone/location-driven automation context |
| Tesla EV | Production with readiness gating | Status plus charging controls are available when Tesla auth and command transport requirements are satisfied |

## Important Product Boundaries

Keep these constraints explicit in user-facing or operator-facing material:

- rule evaluation is AND-only
- only the first matching rule fires per cycle
- manual scheduler edits are not protected from later automation changes
- FoxESS remains the richest diagnostics and curtailment path
- the setup page UX is still more FoxESS-first than the backend capability map
- the curtailment discovery page is an advanced/support surface, not the normal
  onboarding path
- Tesla command availability is vehicle- and environment-dependent because of
  readiness checks and signed-command requirements

## Recommended User Journey

For most users, the most accurate product flow is:

1. sign in and complete guided setup
2. confirm provider credentials and location in Settings
3. connect Amber if price-aware automation is wanted
4. create or import rules from the Rules Library
5. monitor behavior in the dashboard and history pages
6. use Quick Control or manual scheduler only for temporary/manual interventions
7. connect Tesla from Settings if EV visibility or charging control is needed

## Positioning Guidance

Use these claims:

- SoCrates is a multi-provider energy automation platform.
- Tesla EV integration includes onboarding, status visibility, and charging
  controls when readiness checks pass.
- The app is delivered as a responsive web app/PWA.

Avoid these claims:

- every provider has identical feature parity
- Tesla commands are guaranteed for every vehicle without additional setup
- curtailment discovery is the standard first-run workflow for all users
