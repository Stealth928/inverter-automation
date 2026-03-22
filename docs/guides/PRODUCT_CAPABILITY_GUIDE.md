# SoCrates Product Capability Guide

Last updated: 2026-03-22

## Purpose

This is the detailed product reference for the currently shipped SoCrates
product. It is intended to capture the full product surface, major workflows,
integration boundaries, and operator-facing capability with more precision than
the concise product guide.

Use this document when you need to answer any of the following accurately:

- what the product includes today
- where a capability appears in the UI
- which integrations are supported and with what caveats
- which behaviors are general product behavior versus provider-specific
- what boundaries should be stated in support, product, sales, or demo material

## Product Definition

SoCrates is a browser-based energy automation platform focused on residential
solar, battery, pricing, and EV-aware workflows. The product combines live data
from supported inverter providers with electricity pricing, weather forecast
context, automation rules, direct control tools, reporting, and selected
operator/admin functions.

At a high level, the shipped product provides:

- authenticated user accounts
- guided setup plus deeper settings-based configuration
- multi-provider inverter and site onboarding
- real-time telemetry and device state visibility
- rule-based automation evaluated on a recurring scheduler
- manual quick overrides and direct schedule editing
- pricing-aware and weather-aware decision inputs
- historical analysis, ROI, and market-oriented views
- solar curtailment configuration and diagnostics
- Tesla EV onboarding, status, readiness checks, and charging commands
- admin metrics, behavior analytics, announcements, and support tools

The product is delivered as a web app with PWA support. This repository does
not contain a separate native mobile application.

## Who Uses the Product

### End Users

Primary end users are home energy users who want to:

- monitor solar, battery, load, grid, and feed-in behavior
- automate battery behavior around tariffs and forecast conditions
- temporarily override automation when needed
- review historical outcomes and ROI
- optionally connect Tesla for EV status and charging control

### Support and Admin Users

Operator-facing users can:

- inspect user state and platform metrics
- manage shared announcements
- review scheduler health and analytics
- use advanced diagnostics and impersonation flows for support work

## Delivery Model

The current shipped experience is organized into public pages and authenticated
application pages.

### Public Surface

| Page | Purpose | Audience |
| --- | --- | --- |
| `index.html` | Landing page with product positioning, pricing, FAQ, and legal links | Public |
| `privacy.html` | Privacy policy | Public |
| `terms.html` | Terms of service | Public |
| `login.html` | Sign-in entry point | Public/auth |
| `reset-password.html` | Password reset flow | Public/auth |

### Authenticated Surface

| Page | Purpose | What users do there |
| --- | --- | --- |
| `setup.html` | Guided onboarding | Validate provider credentials, establish first-run config, complete setup milestones |
| `app.html` | Main dashboard | Monitor live telemetry, pricing, weather, automation state, quick control, EV summary |
| `control.html` | Advanced control page | Perform manual device actions, inspect scheduler, use discovery-oriented tools |
| `history.html` | Historical views | Review automation history, energy history, reports, and support-oriented raw data |
| `roi.html` | ROI analysis | Review automation savings and ROI-oriented reporting |
| `battery-roi-calculator.html` | Calculator workflow | Explore battery economics and scenario comparisons |
| `market-insights.html` | Market insights | Review pricing and market trend views |
| `rules-library.html` | Rule template library | Import and scale predefined rule templates |
| `settings.html` | Configuration hub | Manage provider credentials, location, automation options, curtailment, Tesla, account state |
| `admin.html` | Admin console | Review platform metrics, user data, analytics, and operational status |

## Product Capability Domains

### 1. Authentication and Account Lifecycle

The shipped product uses Firebase-backed authentication with email/password
flows.

Current visible behavior includes:

- sign-in via `login.html`
- password reset via `reset-password.html`
- authenticated session handling across the app
- post-signup initialization and cleanup flows on the backend

Operationally, the product also tracks account state used by product logic,
including setup completion, tour completion, account age, and automation state.
Those states are used by announcement targeting and onboarding logic.

### 2. Guided Setup and Initial Onboarding

The product includes a guided setup experience through `setup.html`.

What setup covers today:

- provider credential validation
- first-run onboarding status
- baseline device and pricing setup
- progression toward a completed setup state

Important nuance:

- the setup experience is still more FoxESS-first than the backend support map
- broader provider capability is exposed more clearly in `settings.html` than
  in the guided setup flow

The backend supports validation and onboarding flows for FoxESS, Sungrow,
SigenEnergy, AlphaESS, and Amber-related configuration.

### 3. Provider Accounts and Site Management

The product supports more than a single credential blob. The current backend
and settings flows support provider account management and site-aware
configuration.

Current product behavior includes:

- listing provider accounts
- creating or updating provider accounts
- deleting provider accounts
- validating credentials before saving where supported
- listing accessible sites for supported providers
- retaining write-only handling for sensitive provider credentials where needed

This is important because the product is no longer limited to a single,
FoxESS-only configuration story even if some UI paths still emphasize FoxESS.

### 4. Live Telemetry and Dashboard Experience

The main dashboard in `app.html` is the central day-to-day operational view.

Current shipped dashboard capability includes:

- current inverter telemetry
- battery state of charge
- power-flow visibility across PV, load, battery, grid, and feed-in
- current pricing context
- weather context
- automation status visibility
- quick control entry points
- EV summary when Tesla is connected

The dashboard is the main user surface for monitoring whether automation is
behaving as intended without dropping into deeper settings or admin workflows.

### 5. Automation Rules Engine

Automation is a core product capability, not an experimental add-on.

### Execution Model

Current shipped behavior:

- background evaluation runs on a recurring 60-second cadence by default
- per-user interval overrides are supported
- rules are sorted by numeric priority
- lower number means higher priority
- only the first fully matching rule wins a cycle
- rule evaluation uses AND-only semantics
- outcomes are logged to automation history and related audit views

### Supported Rule Inputs

The current rule model supports conditions based on:

- current buy price
- current feed-in price
- forecast price look-ahead
- battery SoC
- battery temperature
- ambient temperature
- inverter temperature
- forecast temperature context
- time windows
- weekday filters
- solar radiation forecast look-ahead
- cloud-cover forecast look-ahead

These inputs make the product price-aware, weather-aware, and timezone-aware.

### Supported Rule Actions

The current action model includes these work modes:

- `SelfUse`
- `ForceCharge`
- `ForceDischarge`
- `Feedin`
- `Backup`

Depending on provider path and action, rules can also apply:

- duration minutes
- power setpoint
- force-discharge or target SoC controls
- minimum grid SoC
- maximum SoC
- cooldown minutes

### Practical Automation Boundaries

These behaviors are important enough to state explicitly in product material:

- rules do not support OR trees or arbitrary boolean nesting
- only the first matching rule fires in a cycle
- cooldowns reduce rapid retriggering but do not change the first-match model
- the product is rule-based, not a machine-learning optimizer

### 6. Pricing and Forecast Context

Price and forecast context are first-class parts of the shipped product.

### Amber Electric

Amber integration supports:

- current buy pricing
- current feed-in pricing
- historical price retrieval
- site-aware workflows
- price-aware automation inputs
- ROI and reporting support

Amber is optional in the product, but price-aware automation and several
history and ROI workflows are reduced without it.

### Weather Context

Weather capability supports:

- location-driven forecast retrieval
- timezone-aware automation context
- solar radiation values for solar availability estimation
- cloud-cover values for production outlook decisions
- forecast temperature context used in rule conditions

Weather is operational input, not decorative UI data.

### 7. Quick Control and Manual Overrides

The product supports deliberate temporary overrides without forcing users to
disable automation permanently.

### Quick Control

Quick Control supports:

- temporary charge actions
- temporary discharge actions
- explicit duration-based overrides
- runtime status visibility
- explicit start and end control paths

Quick Control is designed for short-lived interventions. While it is active,
automation is paused for that override path.

### Direct Device Control

The product also includes direct control capability on advanced surfaces,
including:

- battery SoC set/get workflows
- work-mode set/get workflows
- device setting inspection on supported paths
- provider-specific diagnostics and discovery utilities

This capability is strongest on the FoxESS path and is more operator-oriented
than the standard dashboard flow.

### 8. Scheduler Management

The product exposes direct scheduler visibility and mutation paths.

Current scheduler capability includes:

- fetching current live scheduler segments
- setting schedule segments
- clearing schedule segments
- editing segment timing, work mode, power, and SoC-related fields

Important boundary:

- manual scheduler edits are not protected from later automation writes

This is a real product behavior and should be described directly, because users
can otherwise assume scheduler changes are permanently reserved.

### 9. History, Reporting, and Auditability

The product includes several distinct retrospective views.

### History and Reporting

Users can access:

- inverter history
- generation summaries
- report-oriented views
- Amber price history
- automation history
- audit visibility for automation decisions
- selected raw-data and support-oriented views

### ROI and Analysis

The shipped product includes:

- ROI analysis in `roi.html`
- battery economics and scenario analysis in
  `battery-roi-calculator.html`
- supporting pricing context for savings-oriented interpretation

### Market Insights

The product also exposes a dedicated market-facing surface in
`market-insights.html`, reflecting that pricing analysis is part of the live
product rather than just a backend dependency.

### 10. Rules Library

The rules library is a user-facing acceleration feature rather than a static
demo asset.

Current capability includes:

- curated rule templates
- import-ready flows
- power scaling support

This lowers the barrier for users who do not want to author every rule from
scratch.

### 11. Solar Curtailment

Solar curtailment is shipped and active in runtime behavior.

### What Users Can Do

Current user-facing behavior includes:

- enabling curtailment in Settings
- defining a feed-in price threshold
- saving curtailment configuration into normal product settings

### What the Runtime Does

At runtime, the product:

- compares current feed-in price against the user threshold
- activates curtailment when the threshold logic requires it
- deactivates curtailment when conditions recover
- tracks curtailment state separately from the main automation rule winner

### Discovery and Diagnostics

The product also contains advanced discovery-oriented curtailment support for:

- topology investigation
- export-limit behavior inspection
- deeper support/admin troubleshooting

Important boundary:

- this advanced discovery surface is not the standard first-run user path
- curtailment is strongest and most clearly supported on the FoxESS-style path

### 12. Tesla EV Integration

Tesla support is part of the current shipped product, with clear readiness and
transport gating.

### What Is Shipped

The live Tesla feature set includes:

- OAuth onboarding from Settings
- VIN-based vehicle registration
- connected vehicle management
- dashboard EV status visibility
- manual wake
- start charging
- stop charging
- set charge limit
- set charging amps
- readiness messaging and command hints

### Readiness Model

The product does not present Tesla charging controls as universally available.
Per-vehicle readiness states determine whether commands are shown or enabled.

The notable readiness states include:

- `ready_direct`
- `ready_signed`
- `read_only`
- `setup_required`
- `proxy_unavailable`

This matters because the user experience is intentionally gated rather than
letting commands fail blindly.

### Tesla Product Boundaries

These boundaries should always be stated accurately:

- some vehicles allow direct commands
- some require signed commands
- signed-command transport may depend on separate proxy infrastructure
- when readiness is not satisfied, the product may remain in status-only mode
- Tesla rate limits and usage budgets are part of the shipped backend behavior

### 13. Settings and System Configuration

`settings.html` is the deeper configuration hub for the product.

Current settings capability includes:

- provider credentials and account management
- site selection where applicable
- location and timezone configuration
- automation enablement and related options
- curtailment configuration
- Tesla onboarding and connected-vehicle management
- onboarding and tour state persistence
- credential clearing flows

The settings area is where the product's broader backend capability is most
visible when compared with the narrower guided setup path.

### 14. Admin and Support Capability

The admin panel is part of the shipped product surface, not just internal code.

Current operator-facing capability includes:

- user management
- user-role changes
- user deletion flows
- per-user stats inspection
- platform statistics
- Firestore metrics
- scheduler metrics and SLO-oriented monitoring
- GA4-backed behavior analytics
- shared announcement management
- impersonation for support investigation

This means the product is not only a user dashboard. It also includes a real
operator layer for support and service management.

### 15. Diagnostics and Health

The backend includes health and diagnostics capability that supports both
operations and support workflows.

Current areas include:

- API health checks
- authenticated health checks
- API-call metrics
- inverter discovery utilities
- low-level device-setting reads on supported providers
- broader all-data support endpoints

These are not all end-user marketing features, but they are part of the shipped
product capability and matter for support, debugging, and advanced operations.

## Integration Matrix

| Integration | Status | Key shipped strengths | Important caveats |
| --- | --- | --- | --- |
| FoxESS | Primary production path | Broad telemetry, control, scheduler, reporting, diagnostics, curtailment | Richest support path; several advanced diagnostics are FoxESS-specific |
| Sungrow | Supported | Telemetry, control, scheduling, validation, settings-based onboarding | Diagnostics are narrower than FoxESS; setup UX is not as prominent |
| SigenEnergy | Supported with narrower maturity | Live telemetry, work-mode support, validation, adapter-backed runtime | Full parity with FoxESS is not claimed, especially across history and scheduling maturity |
| AlphaESS | Supported | Validation, normalized telemetry, control, scheduling support | Feature depth and diagnostics are narrower than FoxESS |
| Amber Electric | Production | Current prices, history, site workflows, automation inputs, ROI context | Optional, but many price-aware workflows are reduced without it |
| Weather | Production | Forecast temperature, solar radiation, cloud cover, timezone-aware context | Forecast quality depends on location and provider data availability |
| Tesla EV | Production with readiness gating | OAuth onboarding, vehicle management, status, wake, charging controls | Command availability depends on readiness, permissions, and possibly signed-command infrastructure |

## Most Important Product Boundaries

The following points should remain explicit anywhere the product is described in
detail.

1. Rule evaluation is AND-only.
2. Only the first matching rule fires in a cycle.
3. Manual scheduler edits can be overwritten by automation.
4. FoxESS remains the richest diagnostics and curtailment path.
5. Provider support exists across several vendors, but feature parity is not
   identical.
6. The setup page is still more FoxESS-first than the backend capability map.
7. Curtailment discovery tooling is an advanced support surface rather than the
   normal onboarding flow.
8. Tesla charging controls are readiness-gated and may require signed-command
   infrastructure.
9. The product is a web app with PWA support, not a native mobile application.

## Recommended Product Narrative

When describing the product accurately, the best summary is:

SoCrates is a multi-provider home energy automation platform delivered as a web
app. It combines live inverter telemetry, pricing, weather context, rule-based
battery and scheduler control, manual override tools, reporting, solar
curtailment, Tesla EV workflows, and admin/support tooling in a single product.

## Claims to Avoid

Avoid overstating the product in these ways:

- claiming all providers have identical maturity or depth
- implying the setup flow presents every supported provider equally well
- implying manual scheduler edits are protected from automation
- implying Tesla commands always work for every connected vehicle
- implying curtailment discovery is a normal first-run flow for all users
- implying the product includes generic EV support beyond Tesla

## Related Docs

- `PRODUCT_GUIDE.md`
- `../SETUP.md`
- `../AUTOMATION.md`
- `../CURTAILMENT_QUICK_START.md`
- `TESLA_ONBOARDING.md`
- `TESLA_EV_INTEGRATION.md`
- `../API.md`
