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
- hosted Tesla public key metadata at the required `/.well-known/...` path

## Minimum Viable Setup

The current product scope is read-only Tesla support:

1. OAuth connect
2. VIN registration
3. vehicle status reads
4. Tesla public PEM hosted on the app domain

Remote command support is intentionally not part of the active product scope.

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
- keep Tesla setup limited to connection and status visibility

## Product Boundary

- Tesla commands are not exposed in the dashboard.
- No signed-command proxy is required for the current repo scope.
- No Cloud Run service is required for the current repo scope.

## Marketing Positioning Guidance

Use these claims:
- "Tesla EV integration is available in Settings and Dashboard."
- "Connect by VIN using Tesla OAuth and monitor EV status in SoCrates."

Avoid these claims:
- "All EV brands are supported."
- "Tesla remote commands are currently available in the dashboard."

## Related Docs

- `docs/guides/PRODUCT_GUIDE.md`
- `docs/guides/TESLA_ONBOARDING.md`
- `docs/API.md`
