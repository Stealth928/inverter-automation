# SoCrates Product Guide

Last updated: March 13, 2026

## Purpose

This guide describes the product that is currently shipped in this repository.
It is intentionally based on the live frontend, current backend routes, and the
provider adapters in code. Older FoxESS-only wording and older "preview mode"
language have been removed where the product has moved on.

## Product Summary

SoCrates is a cloud-hosted energy automation web app for hybrid inverter and
battery systems. It combines:

- live device telemetry
- Amber pricing data
- weather forecasts and timezone-aware scheduling
- user-defined automation rules
- manual scheduler control and quick overrides
- Tesla EV integration for vehicle status and charging commands
- reporting, ROI analysis, and support diagnostics

The product is shipped as a responsive web app with PWA support, so it works on
desktop and mobile browsers.

## Best Fit

SoCrates is best suited to:

- households with solar and battery systems
- Amber Electric users who want price-aware charge/discharge/export automation
- power users who want both automation and manual override
- support/installers who need diagnostics for unusual setups such as
  AC-coupled solar

If you do not connect Amber, the platform can still use time, SoC, temperature,
weather, and manual controls, but price-aware automation and Amber-based
reporting are reduced.

## Current Product Surface

| Page | What it does today | Notes |
| --- | --- | --- |
| `Setup` | Guided onboarding for credentials, location/timezone, Amber key, inverter size, and battery size | Current self-service onboarding is FoxESS-first in the UI; the backend and settings flows are broader |
| `Overview` | Main dashboard with live inverter status, electricity prices, weather, quick controls, EV overview, manual scheduler, active automation, and rule management | Users can also customise which dashboard cards are visible |
| `Automation Lab` | Safe simulation page for rule testing | No live inverter commands are sent; includes mock scheduler output and payload preview |
| `Reports` | Amber price history, inverter history, energy reports, generation summary, and raw data viewer | Data is fetched on demand to reduce API pressure |
| `Automation ROI` | Savings/ROI analysis plus recent automation history | Current ROI workflow is oriented around short date windows and the UI caps ranges to 7 days |
| `Controls` | Advanced controls for SoC limits, work mode, force-charge windows, and topology diagnostics | Some cards are FoxESS-only and are hidden for unsupported providers |
| `Rules Library` | Import/remove prebuilt rule templates | Imported rules arrive inactive and priorities are auto-adjusted to avoid clashes |
| `Settings` | Credentials, automation timing, cache TTLs, blackout windows, curtailment, preferences, default rule settings, and Tesla EV onboarding | Weather location also controls automation timezone |
| `WIP - Topology Discovery` | Advanced FoxESS-focused topology detection, export-limit probing, and curtailment testing | Hidden/admin-style page for advanced use and support |
| `Admin` | Platform metrics and admin workflows | Only visible to admins |

## Core Capabilities

### 1. Automation Engine

The automation engine evaluates user rules on a recurring schedule.

- Default rule cadence is 60 seconds
- User-configurable automation interval is supported in Settings
  (20 seconds to 10 minutes)
- Rules are sorted by numeric priority
- Lower number = higher priority
- Only the first matching rule runs in a cycle
- All enabled conditions on a rule must pass

Important: rule logic is currently AND-only. The product does not provide a
general OR-rule builder in the live rule evaluation path.

### 2. Rule Conditions

The current rule model supports:

- current buy price
- current feed-in price
- forecast price look-ahead
- battery SoC
- battery, inverter, ambient, and forecast temperature checks
- time windows and weekday filtering
- solar radiation look-ahead
- cloud-cover look-ahead
- legacy weather-type conditions for older rules

### 3. Rule Actions

The current action model supports these work modes:

- `SelfUse`
- `ForceCharge`
- `ForceDischarge`
- `Feedin`
- `Backup`

Depending on the action, rules can also carry:

- duration
- target or stop SoC values
- power setpoint
- minimum SoC on grid
- maximum SoC
- cooldown minutes

### 4. Quick Control

Quick Control is the fast manual override path on the dashboard.

- start ad-hoc charge or discharge without creating a rule
- choose power and duration
- active quick control pauses automation automatically
- automation resumes after expiry

The backend currently validates quick-control durations from 2 to 360 minutes.

### 5. Manual Scheduler

The dashboard also exposes direct scheduler segment editing.

- view current segments
- add or edit time segments manually
- clear all segments

Important: if automation fires later, it can overwrite manual scheduler
segments. The product warns about this in the UI.

### 6. Rules Library

The Rules Library is now a first-class feature, not a future concept.

- ready-made templates across price, battery, solar, time, seasonal, and
  EV-friendly categories
- template power is scaled to the user's configured inverter capacity
- imported rules are saved as inactive
- already-imported rules are highlighted
- priorities are shifted automatically where needed to avoid collisions

### 7. Automation Lab

Automation Lab is the product's dry-run workflow.

- test rules against hypothetical price, SoC, time, and weather inputs
- preview which rule would win
- inspect the mock scheduler outcome
- inspect the request payload shape

This replaces the older idea of a generic "Preview Mode". The shipped product
uses a dedicated testing page instead.

### 8. Reporting and ROI

The reporting surface is broader than the older guide described.

- Amber price history
- real-time inverter history
- daily and monthly energy reports
- generation summary
- raw data viewer for support/debugging
- ROI analysis page
- automation rule history alongside ROI

### 9. Solar Curtailment and Topology Diagnostics

The product includes both operational curtailment settings and advanced support
tools.

- curtailment can be enabled in Settings with a feed-in price threshold
- topology data can be stored and reused
- advanced FoxESS tooling can probe export-limit capabilities
- the Controls and Topology pages help investigate AC-coupled systems where PV
  is not visible as direct `pvPower`

This is especially useful for split-inverter or AC-coupled installations.

### 10. Tesla EV Integration

Tesla EV support is part of the live product surface, not roadmap copy.

- Tesla onboarding is available in `Settings` via OAuth PKCE flow
- connected VIN-based vehicles appear in the dashboard EV overview
- commands supported today: start charging, stop charging, set charge limit
- command controls are gated by Tesla readiness checks (VIN, signed-command
  requirements, virtual-key pairing state)
- detailed onboarding and operational requirements are documented in:
  - `docs/guides/TESLA_ONBOARDING.md`
  - `docs/guides/TESLA_EV_INTEGRATION.md`

## Supported Integrations and Current Status

| Integration | Status today | Notes |
| --- | --- | --- |
| FoxESS | Primary production path | Full live dashboard, scheduler, quick control, reports, and FoxESS-specific diagnostics/curtailment tooling |
| Sungrow (iSolarCloud) | Supported in platform | Adapter-backed status, work mode, scheduling, history/report/generation paths exist; FoxESS-only endpoints/tools do not apply |
| SigenEnergy | Partial / limited | Real-time status and work mode support exist, but scheduler/history/report coverage is not yet at parity |
| Amber Electric | Production | Current pricing, short-horizon forecast pricing, price history, and ROI workflows |
| Weather (Open-Meteo) | Production | Forecasts plus timezone/location resolution used by rules and dashboard |
| Tesla EV (Settings + Dashboard) | Available | Users can connect Tesla via Settings OAuth flow (PKCE + callback), manage connected VIN-based vehicles, monitor EV status on the dashboard, and issue start/stop/set-charge-limit commands when readiness checks pass |

## Provider Notes You Should Know

### FoxESS

FoxESS remains the most complete end-to-end path:

- default onboarding path in the setup UI
- deepest diagnostics coverage
- full curtailment discovery workflow
- widest direct low-level device control surface

### Sungrow

Sungrow is no longer just roadmap language. There is real adapter coverage in
the backend and settings flow. However:

- the self-service setup page is still FoxESS-first in the current UI
- FoxESS-specific tools such as export-limit probing are not generic Sungrow
  features

### SigenEnergy

SigenEnergy support is real but incomplete.

Use this description in user-facing material:

- live status: yes
- work-mode control: yes
- scheduler automation: limited
- history/reporting: limited
- topology/curtailment tooling: not equivalent to FoxESS

Do not describe SigenEnergy as "full support".

## Key Settings and Configuration

The Settings page currently covers:

- provider-specific credentials
- optional Amber API key
- Tesla EV onboarding and control setup (client ID, optional client secret, vehicle VIN, region, OAuth connect flow, connected vehicle management)
- automation interval
- cache TTLs for Amber, inverter, and weather data
- blackout windows
- solar curtailment enable/threshold
- weather location
- timezone via location sync
- default cooldown and duration for new rules

Notable behavior:

- weather location is operational, not cosmetic; it drives timezone handling
  for rules
- automation interval is configurable from the UI
- blackout windows pause automation without deleting rules
- Tesla EV command buttons are shown only when the selected vehicle is in a
  command-ready state
- curtailment runs separately from the main rule match

## Guided Setup Flow

The current setup flow asks for:

1. inverter/provider credentials
2. weather location
3. optional Amber API key
4. inverter capacity
5. battery capacity

Those hardware values are used in live validation and in rule-library template
power scaling.

Current nuance:

- the backend can validate FoxESS, Sungrow, and SigenEnergy credentials
- the setup UI currently exposes FoxESS as the default self-service path and
  still marks Sungrow/SigenEnergy options as coming soon
- the Settings page already contains provider-specific credential sections for
  broader platform support

## Current Weather and Pricing Behavior

### Pricing

Amber integration currently provides:

- current buy price
- current feed-in price
- short-horizon forecast pricing
- historical price views in Reports

### Weather

Weather features currently include:

- current weather
- cloud cover
- solar radiation
- temperature
- multi-day forecast display on the dashboard (1 to 16 days)
- location resolution and timezone inference

## Important Caveats

These points are important for accurate user expectations:

- Rule evaluation is AND-only.
- Only the first matching rule fires in a cycle.
- Manual scheduler segments can be overwritten by automation.
- Quick Control is temporary and is meant for overrides, not long-term policy.
- Some device-control pages contain FoxESS-specific tools and will not map
  cleanly to every provider.
- SigenEnergy should still be treated as partial support.
- "Preview Mode" is not the right term for the current product; use
  "Automation Lab".
- There is no separate native mobile app shipped here; the delivered mobile
  experience is the responsive web app/PWA.

## Recommended User Workflow

For a new user, the most accurate current workflow is:

1. Complete Setup with device credentials, location, and hardware sizing.
2. Review Settings for timezone, blackout windows, curtailment, and defaults.
3. Import a small number of Rules Library templates if needed.
4. Use Automation Lab to test any non-trivial rule before enabling it.
5. Enable automation from Overview.
6. Use Reports and Automation ROI to review outcomes and refine rules.

## Support and Troubleshooting Shortlist

When a user says automation is "not working", check these first:

- automation master toggle enabled
- rule itself enabled
- rule cooldown not still active
- blackout window not currently active
- device credentials valid
- Amber key valid if price conditions are involved
- weather location/timezone correct if time-based rules look wrong
- provider limitations understood for Sungrow/SigenEnergy
- Tesla vehicle connected in Settings (VIN + OAuth credentials)
- Tesla readiness status on the dashboard (signed-command and virtual-key
  requirements may block command execution)

For unusual solar topologies or split-inverter setups, use:

- `Controls` for topology diagnostics
- `WIP - Topology Discovery` for FoxESS-specific probing
- `Reports` to inspect generation/history behavior

## Bottom Line

SoCrates is now more than a FoxESS automation dashboard. The shipped product
includes:

- live automation and manual control
- rule simulation
- rule-template import
- Tesla EV onboarding and dashboard command controls
- reporting and ROI analysis
- multi-provider groundwork and active provider adapters
- advanced support tooling for topology and curtailment

The main accuracy traps to avoid are:

- calling it FoxESS-only
- describing rules as AND/OR
- referring to a generic preview mode instead of Automation Lab
- overstating SigenEnergy support
- ignoring the current Tesla EV integration in Settings and dashboard flows
- ignoring the current Rules Library, Reports, Controls, and topology tooling
