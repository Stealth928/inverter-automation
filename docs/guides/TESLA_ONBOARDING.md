# Tesla EV Onboarding Guide

Purpose: operator and end-user guide for Tesla connection flow, command
readiness, and charging control behavior in the shipped product.

Last updated: 2026-03-17

## At a Glance

- Canonical Tesla guide for the shipped OAuth, readiness, and charging flow
- Covers the Settings onboarding path, dashboard controls, signed-command
  transport, and operational setup
- The legacy product-framing alias is
  [TESLA_EV_INTEGRATION.md](TESLA_EV_INTEGRATION.md)

## Scope

This guide documents the Tesla flow implemented in:

- `frontend/settings.html`
- `frontend/js/settings.js`
- `frontend/js/dashboard.js`
- `functions/api/routes/ev.js`
- `functions/lib/adapters/tesla-fleet-adapter.js`
- `functions/lib/services/ev-usage-control-service.js`

It covers:

- OAuth onboarding in Settings
- connected-vehicle lifecycle
- per-vehicle command readiness
- dashboard charging controls
- signed-command prerequisites where applicable

## What Is Live Today

Tesla support in the current product includes:

- vehicle registration by VIN
- Tesla OAuth onboarding from Settings
- dashboard EV status
- manual wake for sleeping vehicles
- start charging
- stop charging
- set charge limit
- set charging amps

Charging controls are not shown as blindly available for every connected Tesla.
The app first checks command readiness for the selected vehicle.

## Prerequisites

Before connecting Tesla in-app, you need:

1. a Tesla developer application configured for Fleet OAuth
2. Tesla Fleet `client_id`
3. optional `client_secret` when your app requires it
4. VIN for each Tesla you want to connect
5. redirect URI configured exactly to the deployed `settings.html` origin
6. allowed origins and top-level domains configured in the Tesla developer app
7. public key metadata hosted at:
   `/.well-known/appspecific/com.tesla.3p.public-key.pem`

For charging controls, ensure your Tesla app permissions cover both status and
charging command access.

## User Flow in Settings

1. Open `Settings`.
2. Go to `Tesla EV Integration`.
3. Enter:
   - Tesla Fleet client id
   - optional client secret
   - vehicle VIN
   - optional display name
   - region
4. Confirm the redirect URI shown in the UI matches Tesla developer settings.
5. Click `Connect Tesla`.
6. Complete Tesla consent.
7. Return to `settings.html` for token exchange and connection finalization.
8. Confirm the vehicle appears in the connected Tesla vehicle list.

## Behind-the-Scenes API Flow

When the user clicks `Connect Tesla`, the app:

1. registers or updates the vehicle record
2. generates PKCE values in-browser
3. stores pending OAuth state in session storage
4. calls `GET /api/ev/oauth/start`
5. redirects the user to Tesla auth

On callback, the app:

1. validates the OAuth state token
2. calls `POST /api/ev/oauth/callback`
3. stores credentials for the VIN-linked vehicle
4. clears temporary OAuth state
5. refreshes connected vehicle data in Settings

## Command Readiness Model

The dashboard and settings flow both rely on per-vehicle readiness states.

Current notable readiness states:

- `ready_direct`: direct Tesla Fleet charging commands are available
- `ready_signed`: charging commands are available via signed-command transport
- `read_only`: status is available but charging controls are not ready
- `setup_required`: reconnect or permissions review required
- `proxy_unavailable`: signed commands are required but supporting proxy
  infrastructure is unavailable

Settings uses these states to tell the user whether the vehicle is fully ready,
needs reconnection, or needs infrastructure work before charging controls can be
enabled.

## Dashboard Controls

When command readiness allows it, the dashboard EV card exposes:

- `Start charging`
- `Stop charging`
- `Set charge limit`
- `Set charging amps`
- `Wake vehicle` when wake is appropriate but direct controls are not yet ready

The dashboard also shows command hints derived from readiness state, including
cases where Tesla permissions, reconnect, or signed-command proxy setup are
required.

## Signed-Command Requirements

Not every Tesla vehicle behaves the same way.

Important runtime behavior:

- some vehicles allow direct charging commands
- some require signed commands
- the app does not pretend unsigned direct control is universally valid
- if signed commands are required and the proxy is unavailable, the UI warns the
  user and withholds charging controls

Relevant deployed secrets when signed commands are used:

- `TESLA_SIGNED_COMMAND_PROXY_URL`
- `TESLA_SIGNED_COMMAND_PROXY_TOKEN`

## Partner Domain and Public Key

Tesla requires the hosted public key metadata path to stay available at:

```text
https://<your-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem
```

The backend also contains partner-domain helper routes for admin/operator use:

- `POST /api/ev/partner/check-domain-access`
- `POST /api/ev/partner/register-domain`

Those routes are operational tools, not part of the normal end-user onboarding
path.

## Usage Controls and Rate Limiting

Tesla integration is budget- and rate-aware.

The EV usage-control service can enforce:

- live-status request rate limits
- command rate limits
- per-vehicle daily/monthly billable budgets
- per-user monthly billable budgets
- degraded mode when configured

Relevant env vars include:

- `EV_TESLA_RATE_WINDOW_MS`
- `EV_TESLA_RATE_STATUS_PER_WINDOW`
- `EV_TESLA_RATE_COMMAND_PER_WINDOW`
- `EV_TESLA_DAILY_BILLABLE_LIMIT_PER_VEHICLE`
- `EV_TESLA_MONTHLY_BILLABLE_LIMIT_PER_VEHICLE`
- `EV_TESLA_MONTHLY_BILLABLE_LIMIT_PER_USER`
- `EV_TESLA_DEGRADED_MODE`

## Verification Checklist

After onboarding a Tesla vehicle, verify:

1. vehicle appears in `Settings`
2. dashboard EV tab renders status for the vehicle
3. command-readiness request succeeds
4. charging controls appear only when readiness permits them
5. wake, start/stop charge, and limit updates behave correctly for that vehicle

## Common Failure Modes

### Reconnect required

Symptoms:

- Tesla credentials expired or were revoked
- dashboard prompts reconnect
- settings shows setup/action-needed status

Action:

- reconnect Tesla from Settings

### Permission denied

Symptoms:

- status or readiness calls succeed partially but charging controls stay blocked
- settings warns that Tesla denied access for the vehicle

Action:

- review Tesla app permissions and reconnect

### Proxy unavailable

Symptoms:

- vehicle needs signed commands
- dashboard warns that proxy infrastructure is unavailable

Action:

- configure or repair signed-command proxy secrets/infrastructure

### Vehicle asleep or offline

Symptoms:

- command readiness is not enough for an immediate command
- dashboard offers wake action

Action:

- wake the vehicle, then retry once status and readiness refresh
