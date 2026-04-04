# SoCrates Product Opportunity Map

Date: 2026-04-04

## Objective

Identify the highest-value product opportunities across the current SoCrates
page set using:

- the shipped product surface in this repo
- current external market signals
- current native inverter-app capabilities
- current adjacent software capabilities in Australia

The goal is not to chase parity with native inverter apps. The goal is to
decide where SoCrates should deliberately be better, clearer, and harder to
replace.

## Method

### 1. Mapped the current product surface

Primary internal source:

- `docs/guides/PRODUCT_CAPABILITY_GUIDE.md`

Key surfaces confirmed in the repo:

- public: landing page, ROI calculator, wear estimator, market insights preview,
  rule recommender, blog
- authenticated: setup, dashboard, controls, reports, ROI, rules library,
  market insights workspace, settings, automation lab, admin

### 2. Reviewed the current implementation

High-signal page files and scripts reviewed:

- `frontend/index.html`
- `frontend/setup.html`
- `frontend/app.html`
- `frontend/control.html`
- `frontend/history.html`
- `frontend/roi.html`
- `frontend/rules-library.html`
- `frontend/market-insights.html`
- `frontend/settings.html`
- `frontend/test.html`
- `frontend/js/dashboard.js`
- `frontend/js/control.js`
- `frontend/js/history.js`
- `frontend/js/roi.js`
- `frontend/js/rules-library.js`
- `frontend/js/automation-lab-backtest.js`
- `frontend/js/market-insights.js`

### 3. Researched the market

Research focused on four groups:

- native apps from supported or comparable hardware vendors
- retailer / optimization software
- adjacent energy / EV coordination tools
- Australian market and policy context

## Core Market Readout

### What is changing outside the product

1. The Australian battery market has moved from early-adopter niche to rapid
   acceleration. From 1 July 2025, the federal Cheaper Home Batteries Program
   introduced roughly a 30% upfront discount for eligible small-scale
   batteries. The Clean Energy Council reported 183,245 battery units sold in
   H2 2025 alone, and cumulative installations reaching 454,473 units. The
   Clean Energy Regulator said the first six months of the program exceeded
   expectations and projected 350,000 to 520,000 battery installs in 2026.
   [S2] [S3] [S4]

2. Price volatility and negative-price periods are not theoretical edge cases.
   The AER reported 3,598 negative-price 30-minute periods in Q1 2025, up 834
   year on year, with South Australia and Victoria leading. That means the
   economic value of active battery management is growing, especially when
   paired with rooftop solar. [S5]

3. Native inverter apps are climbing the stack. The old assumption that native
   apps only do passive monitoring is no longer true. FoxCloud2.0 now talks
   about AI mode, 7-day forecasting, VPP control, 5-second flow visualization,
   new analysis dashboards, and tariff functions. Sigenergy's mySigen now
   includes AI strategies, dynamic tariff support, VPP/grid-service history, EV
   charging controls, health diagnostics, and one-click charge/discharge
   periods. SolarEdge and Tesla both expose battery backup settings,
   weather-aware backup, EV coordination, and more. [S6] [S10] [S17] [S18]

4. Adjacent software is fragmenting into specialists. Amber is building
   retailer-led automation and manual battery controls. Evergen is leaning into
   optimization and fleet/VPP orchestration. Solar Analytics is leaning into
   plan comparison, fault detection, and battery-buying decisions using actual
   household data. Charge HQ is becoming the EV-specific control benchmark.
   [S12] [S13] [S14] [S15]

### What that means strategically

If SoCrates positions itself as:

- "another monitoring dashboard"
- "another AI optimizer"
- "another battery control app"

then it will get squeezed from both directions:

- hardware vendors own the device relationship and keep adding smarter control
- retailers / optimizers own tariff and dispatch narratives

SoCrates wins only if it becomes the operating layer above those systems:

- cross-brand
- explainable
- testable
- household-aware
- decision-centric
- proof-centric

## Strategic Thesis

SoCrates should differentiate around five pillars:

1. Cross-brand household orchestration
   Native apps are mostly device- or ecosystem-specific. SoCrates should be the
   system that coordinates battery, tariff, EV, weather, and household goals
   across vendor boundaries.

2. Explainable automation
   Native apps increasingly market AI or smart modes. Most do not make the
   logic inspectable. SoCrates should be the place where a user can answer:
   "Why did this happen?", "What will happen next?", and "What would happen if I
   changed this rule?"

3. Evidence before action
   The strongest moat in this repo is already visible in ROI, backtesting, and
   the Automation Lab. SoCrates should be the product that proves value before
   asking the user to trust automation.

4. Household-specific decisions, not generic energy charts
   Market insights, weather, EV state, tariff type, backup goals, export
   settings, and provider limits all change what "best" means. SoCrates should
   translate abstract conditions into home-specific decisions.

5. Operational trust
   Users do not want automation that silently fights their inverter app,
   breaks because a credential expires, or hides uncertainty. SoCrates should
   surface integration health, provider limits, data quality, and likely
   conflicts explicitly.

## Page-by-Page Opportunity Map

## 1. Landing Page and Public Positioning

Current role:

- acquisition
- explanation
- showcase for tools and core product

Current competitive reality:

- native apps increasingly claim "smart", "AI", "savings", and "full visibility"
- Enphase, SolarEdge, Tesla, FoxESS, and Sigenergy all market integrated
  control, real-time flows, and savings narratives [S6] [S10] [S16] [S17] [S18]

Main risk:

- generic claims like "automate your energy" or "monitor your battery" are no
  longer enough to stand out

Best opportunities:

1. Reposition SoCrates as a "home energy operating system", not a battery app.
2. Build a proof-led comparison layer: native app vs SoCrates, retailer
   automation vs SoCrates, manual schedules vs SoCrates.
3. Add persona-specific entry points for battery owners, EV owners, dynamic
   pricing households, and users skeptical of black-box automation.
4. Make explainability visible in marketing with a real automation trace and a
   real backtest result.

Why this differentiates:

- Native apps market integration and visibility.
- SoCrates can market decision quality and proof.

Priority: P0

## 2. Setup / Onboarding

Current role:

- first-time connection
- provider validation
- weather / pricing / hardware setup

Current competitive reality:

- Amber explicitly documents that native battery settings and schedules often
  block automation onboarding and control tests [S12]
- native vendor apps expose their own schedules, battery modes, export modes,
  and reserve controls, which can conflict with third-party automation [S12]
  [S17] [S18]

Main risk:

- setup becomes the place where SoCrates loses trust before the user sees any
  value

Best opportunities:

1. Build a provider-specific pre-flight conflict scanner.
2. Create a migration assistant from native apps, not just a credential form.
3. Expand preview mode into a true digital-twin onboarding flow.
4. Make setup provider-native instead of FoxESS-first.
5. Pull in tariff context earlier so recommendations feel personalized from day
   one. [S10] [S14]

Why this differentiates:

- Native apps optimize device commissioning.
- SoCrates can optimize safe, conflict-free automation onboarding.

Priority: P0

## 3. Dashboard / Overview

Current role:

- daily home screen
- live telemetry, prices, weather, automation status, quick control, EV summary

Current competitive reality:

- FoxCloud2.0: 5-second flows, AI, analysis dashboard, VPP control [S6]
- mySigen: rich home energy flows, AI modes, grid-service history, EV control [S10]
- Enphase / SolarEdge / Tesla: strong real-time flows, outage/backup settings,
  appliance or EV coordination, strong native mobile framing [S16] [S17] [S18]

Main risk:

- raw telemetry is table stakes and increasingly well-covered natively

Best opportunities:

1. Turn the dashboard into a decision cockpit, not a status board.
2. Add a 24-hour operating plan for battery, grid, solar, export, and EV.
3. Add a "why this action" card with winning rule, blocked alternatives, and
   confidence level.
4. Add household operating intents like maximize savings, preserve backup, and
   prioritize EV.
5. Add anomaly detection that is human-readable.

Why this differentiates:

- Native apps tell users what the device is doing.
- SoCrates should tell users whether the home is operating intelligently.

Priority: P0

## 4. Controls Page

Current role:

- advanced controls
- scheduler edits
- SoC limits
- direct work mode
- force charge windows
- diagnostics

Current competitive reality:

- Amber offers charge / preserve / consume controls and already shows forecast
  impact for manual actions [S12]
- SolarEdge and Tesla expose backup levels, EV scheduling, weather-aware backup,
  and manual control options [S17] [S18]
- FoxESS and Sigenergy increasingly expose more direct scheduling and AI modes
  natively [S6] [S10]

Main risk:

- a raw control page is valuable but not yet clearly superior

Best opportunities:

1. Add impact preview before apply for every manual action.
2. Add safe re-entry into automation after temporary overrides.
3. Add scenario controls instead of only parameter controls.
4. Add a provider-normalized control confidence model.
5. Add schedule conflict management across SoCrates, native schedules, and
   manual overrides.

Why this differentiates:

- Native apps expose controls.
- SoCrates can expose safe, explainable, cross-provider control.

Priority: P0

## 5. Reports / History

Current role:

- inverter history
- reports
- generation views
- pricing context and quality labels

Current competitive reality:

- Enphase and SolarEdge are strong in historical visualization [S16] [S17]
- Solar Analytics is strong in performance monitoring, fault identification,
  plan optimization, and monetized household energy reporting [S14]

Main risk:

- charts alone are easy to copy and increasingly common

Best opportunities:

1. Move from charts to attributable narratives.
2. Create "what changed?" reporting for savings, cycling, EV share, export
   windows, and telemetry quality.
3. Add reliability reporting for automation quality, not only energy output.
4. Add household load intelligence to highlight the home behaviors shaping
   automation outcomes.

Why this differentiates:

- Native apps show what happened.
- SoCrates should show why it mattered and what to improve.

Priority: P1

## 6. ROI Page

Current role:

- member ROI
- triggered rule value estimates
- automation history
- passive self-use baseline from backtests

Current competitive reality:

- Solar Analytics differentiates by using actual household data for plan and
  battery decisions [S14]
- Evergen markets savings uplift but includes important caveats around outcomes
  not being guaranteed [S13]
- native apps increasingly talk about savings but usually stop at high-level
  reporting [S6] [S16] [S17]

Main risk:

- gross value alone can look less credible as the market becomes more skeptical
  of savings claims

Best opportunities:

1. Make ROI the product's trust engine by separating measured and estimated
   value.
2. Introduce confidence bands by provider and data source.
3. Add rule-level and bundle-level contribution analysis.
4. Add counterfactuals that matter: SoCrates vs passive self-use, static TOU,
   native AI mode, or retailer automation equivalent.
5. Connect public tools to member ROI so users can see how real data changed
   the earlier estimate.

Why this differentiates:

- Native apps promise savings.
- SoCrates can prove and decompose savings.

Priority: P0

## 7. Rules Library

Current role:

- browse templates
- filter/search
- import starter rules
- handoff into automation

Current competitive reality:

- most native apps expose fixed modes, schedules, or guided AI choices rather
  than a visible strategy library [S6] [S10] [S17] [S18]
- Home Assistant offers deep automation flexibility but with a much steeper DIY
  burden and more generic tooling [S19]

Main risk:

- a static library can feel like a list of examples rather than a product moat

Best opportunities:

1. Turn the rules library into a strategy library organized by outcomes, not
   just categories.
2. Add expected impact, prerequisites, and provider support to each rule or
   bundle.
3. Promote bundle-level recommendations over single-rule browsing.
4. Make simulation the default next step after selection.
5. Add lifecycle management flags like high-performing, conflicting, or
   superseded.

Why this differentiates:

- Native apps offer modes.
- SoCrates can offer inspectable, reusable household operating strategies.

Priority: P0

## 8. Automation Lab

Current role:

- quick simulation
- historical backtesting
- optimization
- tariff comparison
- explainable replay

Current competitive reality:

- this is the clearest existing SoCrates moat
- Home Assistant offers traces and testing for automations, but not a focused
  household energy operating lab [S19]
- native apps increasingly ship AI modes, but not transparent household
  backtesting in the same consumer-facing way [S6] [S10]

Main risk:

- the feature remains too internal, too expert, or too admin-gated to become a
  mainstream differentiator

Best opportunities:

1. Productize the trace explorer for rule evaluation and dispatch outcomes.
2. Make the lab the default decision surface for meaningful changes.
3. Add guided optimization instead of opaque optimization.
4. Add competitor-mode counterfactuals.
5. Add scenario packs such as volatile summer week, cloudy winter stretch, or
   EV-heavy household.

Why this differentiates:

- Native apps can claim intelligence.
- SoCrates can claim inspectable intelligence.

Priority: P0
