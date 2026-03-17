# Tesla EV Integration Guide

Last updated: 2026-03-17
Purpose: product and marketing reference for the Tesla EV functionality that is
currently live in SoCrates.

## Scope

This guide explains what Tesla EV functionality is shipped today, where users
see it, and how to describe it accurately in product, demo, and marketing copy.

For implementation-level and operator-level onboarding detail, use
[TESLA_ONBOARDING.md](TESLA_ONBOARDING.md).

## What Is Live Today

- Tesla connect flow in Settings using OAuth PKCE
- VIN-based vehicle registration and credential storage
- EV overview card on the dashboard with per-vehicle status
- per-vehicle command readiness checks
- manual wake for sleeping vehicles
- start charging
- stop charging
- set charge limit
- set charging amps
- hosted Tesla public key metadata at the required `/.well-known/...` path

## Where Users See Tesla Integration

| Surface | Location | What is shown |
| --- | --- | --- |
| Landing page | `frontend/index.html` | Tesla integration positioning and product messaging |
| Settings | `frontend/settings.html` | Tesla onboarding, connected vehicle management, readiness messaging |
| Dashboard | `frontend/app.html` | EV status, wake flow, and charging controls when readiness allows |
| Backend EV routes | `functions/api/routes/ev.js` | vehicle CRUD, status, readiness, wake, command, OAuth, partner-domain ops |

## User Outcomes

Users can:

- connect Tesla from the same app used for inverter automation
- keep VIN-linked vehicles attached to their account
- monitor charging state and related EV telemetry from the dashboard
- wake a sleeping vehicle when needed
- use charging controls once Tesla command readiness is satisfied

## Product Boundary

Use these boundaries in external or internal descriptions:

- Tesla support is not generic "all commands for all vehicles" support.
- Charging controls are readiness-gated.
- Some vehicles work with direct commands; others require signed-command
  transport.
- If the required signed-command infrastructure is unavailable, the app keeps
  the user in status-only mode for that vehicle.

## Positioning Guidance

Use claims like:

- "Connect Tesla in Settings and manage EV status from the same SoCrates dashboard."
- "Tesla charging controls are available when vehicle readiness and command transport requirements are met."

Avoid claims like:

- "Every Tesla command works out of the box for every vehicle."
- "Tesla charging controls never require additional infrastructure."
- "All EV brands have identical command support in this product."

## Demo Guidance

When demonstrating Tesla support:

1. show the Settings onboarding flow first
2. show a connected vehicle in the dashboard EV card
3. point out readiness messaging before using controls
4. explain that signed-command requirements vary by vehicle/environment

## Related Docs

- [TESLA_ONBOARDING.md](TESLA_ONBOARDING.md)
- [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md)
- [../API.md](../API.md)