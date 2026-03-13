Purpose: end-user and operator guide for Tesla EV connection flow in Settings.
Last updated: March 13, 2026

## Scope

This guide documents the Tesla onboarding flow implemented in:

- `frontend/settings.html` (Tesla EV Integration section)
- `frontend/js/settings.js` (PKCE + callback handling)
- `functions/api/routes/ev.js` (OAuth and credential storage)
- `functions/lib/adapters/tesla-fleet-adapter.js` (Fleet API + command transport)

It describes what users do in the UI, what the app does behind the scenes,
and what must be configured with Tesla for production operation.

## Prerequisites

Before connecting Tesla in-app, you need:

1. A Tesla developer application configured for Fleet API OAuth.
2. Tesla Fleet `client_id` (required).
3. Tesla Fleet `client_secret` (optional; PKCE-only flow supported).
4. Vehicle VIN for each car you want to control (17 characters).
5. Redirect URI in Tesla app config that exactly matches the value shown in Settings (`/settings.html` on your deployed host).
6. Allowed origins and top-level domains configured in Tesla developer app.
7. Tesla app public key metadata hosted on your domain:
   - `/.well-known/appspecific/com.tesla.3p.public-key.pem`
8. For command control on modern vehicles: virtual-key pairing in Tesla app and signed-command transport configured by operator.

## User Flow (Settings UI)

1. Open `Settings` and find `Tesla EV Integration`.
2. Enter:
   - `Tesla Fleet Client ID` (required)
   - `Vehicle VIN` (required)
   - optional `Client Secret`
   - optional display name
   - region (`na` or `eu`)
3. Confirm the displayed `Redirect URI` is configured in Tesla developer settings.
4. Click `Connect Tesla`.
5. User is redirected to Tesla authorization page.
6. After consent, Tesla redirects back to `settings.html` with auth query params.
7. App completes token exchange and stores credentials for the VIN.
8. Connected vehicle appears in `Connected Tesla vehicles`.
9. If dashboard command pills show `Signed Command Required` or `Virtual Key Unpaired`, complete Tesla virtual-key pairing and operator-side signed-command setup.

## Behind-the-Scenes API Sequence

When `Connect Tesla` is clicked, the app does:

1. Register vehicle:
   - `POST /api/ev/vehicles`
   - payload includes `provider=tesla`, canonical `vehicleId` (VIN), and `vin`
2. Generate PKCE values in browser:
   - `codeVerifier` (random)
   - `codeChallenge = SHA256(codeVerifier)` (base64url)
   - `state` token (random)
3. Save pending OAuth context in `sessionStorage` key `teslaOauthPending`.
4. Request start URL:
   - `GET /api/ev/oauth/start?clientId=...&redirectUri=...&codeChallenge=...&region=...&state=...`
5. Redirect user to Tesla auth URL.

On callback:

1. Read `code` and `state` from URL.
2. Validate `state` against pending session.
3. Exchange code:
   - `POST /api/ev/oauth/callback`
   - payload includes `vehicleId`, `vin`, `clientId`, optional `clientSecret`, `redirectUri`, `code`, `codeVerifier`, `region`
4. Remove auth params from URL and clear pending OAuth state.
5. Refresh connected vehicles list.

## Command Readiness Model

Before command endpoints execute, backend performs Tesla readiness preflight:

- if VIN missing: blocks with `vin_required`
- if Tesla requires signed commands and transport is not configured: blocks with `signed_command_required`
- if signed transport exists but vehicle key is not paired: blocks with `virtual_key_not_paired`

Dashboard surfaces these states in EV status pills and disables command controls until ready.

## Status Caching Model

- EV status endpoint prefers cache only when cache age is fresh.
- Default freshness window is controlled by `EV_STATUS_CACHE_MAX_AGE_MS` (default 120000).
- Stale cache automatically falls back to live Tesla fetch.

## Vehicle Deletion Model

`DELETE /api/ev/vehicles/:vehicleId` performs recursive delete when available (`db.recursiveDelete`) and falls back to document-tree deletion when needed.

## Operator Configuration for Signed Commands

Set these environment variables if you run a signed-command proxy:

- `TESLA_SIGNED_COMMAND_PROXY_URL` (base URL, required to enable signed transport)
- `TESLA_SIGNED_COMMAND_PROXY_TOKEN` (optional auth token)

When configured, adapter routes protocol-required commands through the signed proxy.

## Tesla Approval / Compliance Checklist

For production readiness with Tesla, complete all of the following:

1. Tesla developer app configured with correct redirect URI(s).
2. Allowed origins and allowed top-level domains configured.
3. Fleet API scopes and region audience configured.
4. Public key metadata hosted at Tesla-required `/.well-known/...` location.
5. OAuth PKCE flow validated end-to-end in deployed environment.
6. Virtual-key pairing tested on target vehicle(s).
7. Signed-command transport configured and verified for protocol-required vehicles.

## Error Handling and Recovery

The UI handles these common failures:

- User denies Tesla consent: shows authorization failure.
- Missing/expired pending OAuth session: prompts reconnect.
- OAuth state mismatch: blocked; reconnect required.
- Missing PKCE verifier: blocked; reconnect required.
- Backend exchange errors: surfaced in onboarding status + toast.

Recovery controls:

- `Clear Pending Auth`: clears stale session state.
- `Refresh`: reloads connected Tesla vehicles.

## Verification Checklist

After connecting Tesla:

1. Tesla VIN appears in `Settings > Tesla EV Integration`.
2. Dashboard EV card shows vehicle tab and status values.
3. EV commands are enabled only when credentials and readiness checks pass.
4. For modern vehicles, signed-command + virtual-key path is validated.
