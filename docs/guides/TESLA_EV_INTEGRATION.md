# Tesla EV Integration Guide

Last updated: March 13, 2026
Purpose: product and marketing reference for shipped Tesla EV functionality.

## Scope

This guide explains what Tesla EV functionality is currently live in SoCrates,
where users see it, and how to describe it accurately in product and marketing
copy.

For implementation-level setup and operator detail, use:
- `docs/guides/TESLA_ONBOARDING.md`

## What Is Live Today

- Tesla connect flow in `Settings` using OAuth PKCE
- VIN-based vehicle registration and credential storage
- EV overview card on dashboard with per-vehicle status
- dashboard commands:
  - `startCharging`
  - `stopCharging`
  - `setChargeLimit`
- readiness-aware command gating (VIN, signed-command requirements, virtual key
  pairing status)

## Where Users See Tesla Integration

| Surface | Location | What is shown |
| --- | --- | --- |
| Marketing landing page | `frontend/index.html` | Tesla EV integration callouts in hero/features/FAQ/pricing |
| Public ROI tool page | `frontend/battery-roi-calculator.html` | Tesla integration messaging in tool context and CTA |
| Settings | `frontend/settings.html` + `frontend/js/settings.js` | Tesla connect flow, VIN onboarding, connected vehicles list |
| Dashboard | `frontend/app.html` + `frontend/js/dashboard.js` | EV overview status + charging command controls |
| Backend EV routes | `functions/api/routes/ev.js` | Vehicle CRUD, status, commands, OAuth start/callback |

## User Outcomes

- connect Tesla once from Settings and keep vehicle credentials tied to account
- monitor connected vehicle status from the same dashboard as inverter data
- execute charging commands without leaving SoCrates
- keep command safety via readiness checks before command dispatch

## Command Readiness Notes

- Command controls may be blocked when Tesla preconditions are not met.
- Expected blocking states include:
  - `vin_required`
  - `signed_command_required`
  - `virtual_key_not_paired`
- These states are surfaced in the dashboard EV panel and should be described
  as setup prerequisites, not product defects.

## Marketing Positioning Guidance

Use these claims:
- "Tesla EV integration is available in Settings and Dashboard."
- "Connect by VIN using Tesla OAuth and monitor EV status in SoCrates."
- "Start/stop charging and set charge limits when Tesla readiness checks pass."

Avoid these claims:
- "All EV brands are supported."
- "Tesla commands always execute without prerequisites."
- "Signed-command setup is optional for every vehicle."

## Related Docs

- `docs/guides/PRODUCT_GUIDE.md`
- `docs/guides/TESLA_ONBOARDING.md`
- `docs/API.md`
