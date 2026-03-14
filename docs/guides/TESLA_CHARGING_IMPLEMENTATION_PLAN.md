# Tesla Charging Implementation Plan

Last updated: March 14, 2026
Purpose: implementation handoff for adding Tesla EV charging controls in the
smallest reliable way.

## Scope

This plan reintroduces Tesla control only for charging-related actions that are
documented in Tesla Fleet API and are a good fit for this app:

- start charging
- stop charging
- set charge limit
- set charging amps

This plan does not re-open broad Tesla remote control support.

## Verified Source Constraints

The following external sources were checked before writing this plan:

- Tesla Fleet API overview:
  https://developer.tesla.com/docs/fleet-api
- Tesla authentication scopes:
  https://developer.tesla.com/docs/fleet-api/authentication/overview
- Tesla vehicle endpoints:
  https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints
- Tesla vehicle commands:
  https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
- Tesla virtual key developer guide:
  https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide
- Official Tesla vehicle-command proxy:
  https://github.com/teslamotors/vehicle-command

Confirmed from those sources:

- `charge_start`, `charge_stop`, `set_charge_limit`, and
  `set_charging_amps` are documented Fleet API command endpoints.
- Tesla does not expose a general public "discharge" command for EV battery
  export/control through the same command set.
- Vehicles that require Vehicle Command Protocol need signed commands.
- The official Tesla vehicle-command proxy exposes the same REST command paths
  and is the simplest supported way to sign commands.
- Virtual-key enrollment is required for signed commands.
- The app already hosts the public PEM at the required `/.well-known/...`
  location, which remains the correct foundation for command enablement.

## Product Decision

The first command-capable Tesla release should include only:

1. Start charging
2. Stop charging
3. Set charge limit
4. Set charging amps

Explicitly excluded from this release:

- discharge controls
- climate controls
- lock or unlock
- generic arbitrary Tesla command execution
- charge schedules
- broad remote command expansion

## Recommended Architecture

Use a hybrid command transport model:

- Keep status reads on the current direct Fleet API path.
- Send charging commands directly to Fleet API only when the vehicle does not
  require signed commands.
- Send charging commands through Tesla's official signed-command proxy when the
  vehicle does require Vehicle Command Protocol.

This is the smallest reliable architecture because:

- it preserves the current status-only implementation for read paths
- it avoids rebuilding a custom Tesla proxy inside this repo
- it avoids pretending unsigned commands will work on modern Teslas
- it limits added complexity to the narrow command path only

Important rule:

- never fall back from signed-command flow to unsigned direct REST for a
  vehicle that requires Vehicle Command Protocol

## OAuth and Tesla Scope Changes

Current repo scope is status-first. Charging control requires expanding Tesla
authorization beyond `vehicle_device_data`.

Recommended requested scopes:

- `openid`
- `email`
- `offline_access`
- `vehicle_device_data`
- `vehicle_charging_cmds`

Do not add broader `vehicle_cmds` in the first implementation unless Tesla's
pairing or runtime behavior proves it is required for the exact command set
above.

## Vehicle Readiness Model

Do not show charging controls blindly. Each Tesla vehicle should have a command
readiness state derived from Tesla capability data.

Minimum readiness states:

- `read_only`: OAuth and status work, but charging commands are not ready
- `ready_direct`: charging commands can be sent directly to Fleet API
- `ready_signed`: charging commands can be sent through the signed-command proxy
- `missing_virtual_key`: Tesla command support blocked until app key is paired
- `proxy_unavailable`: vehicle needs signed commands but proxy is unreachable

Recommended data source:

- use Tesla `fleet_status` or equivalent command-readiness lookup to determine
  whether Vehicle Command Protocol is required and whether a key is present

The dashboard should only show charge controls for `ready_direct` and
`ready_signed`.

## Backend API Shape

Add one narrow endpoint:

- `POST /api/ev/vehicles/:vehicleId/command`

Request body:

```json
{
  "command": "startCharging",
  "commandId": "optional-idempotency-token",
  "targetSocPct": 80,
  "chargingAmps": 16
}
```

Rules:

- `command` is required
- `command` must be one of:
  - `startCharging`
  - `stopCharging`
  - `setChargeLimit`
  - `setChargingAmps`
- `targetSocPct` is required only for `setChargeLimit`
- `chargingAmps` is required only for `setChargingAmps`
- reject fields not relevant to the selected command

Response envelope should remain consistent with current EV routes:

```json
{
  "errno": 0,
  "result": {
    "accepted": true,
    "command": "setChargeLimit",
    "provider": "tesla",
    "transport": "direct",
    "vehicleId": "VIN...",
    "targetSocPct": 80,
    "asOfIso": "2026-03-14T00:00:00.000Z"
  }
}
```

Error responses should preserve the repo's `{ errno, result, error, msg }`
compatibility pattern.

## Backend Implementation Details

### 1. EV route module

File:

- `functions/api/routes/ev.js`

Add:

- command endpoint registration
- request validation
- per-vehicle readiness gating
- Tesla-specific error mapping for charge commands
- short cooldown or idempotency enforcement
- post-command status refresh hook when practical

Recommended route-level validations:

- charge limit bounds must be numeric and sensible
- charging amps must be numeric and within Tesla-supported bounds for the
  current session if known, otherwise within a conservative server-side range
- prevent duplicate command replay within a short interval

Recommended Tesla-specific error mappings:

- `is_charging` -> success-like or user-friendly no-op
- `not_charging` -> success-like or user-friendly no-op
- `already_set` -> success-like response for idempotent behavior
- `disconnected` -> 409 or 400 with clear charger-not-connected message
- `no_power` -> 409 with charger-power-unavailable message
- offline or asleep -> 408 or guarded fallback depending on command strategy
- proxy failure -> 502 with explicit signed-command infrastructure message

### 2. Tesla adapter

File:

- `functions/lib/adapters/tesla-fleet-adapter.js`

Add a narrow internal command layer, not a generic arbitrary command executor.

Recommended adapter surface:

- `getCommandReadiness(vehicleId, context)`
- `startCharging(vehicleId, context)`
- `stopCharging(vehicleId, context)`
- `setChargeLimit(vehicleId, targetSocPct, context)`
- `setChargingAmps(vehicleId, chargingAmps, context)`

Transport selection logic:

- direct command path for non-VCP vehicles
- official signed-command proxy path for VCP vehicles

Do not implement:

- generic `runTeslaCommand(name, payload)` exposed up-stack

### 3. EV adapter contract

File:

- `functions/lib/adapters/ev-adapter.js`

Keep the shared EV contract minimal.

Recommended change:

- add optional command-capability methods instead of making all EV providers
  implement Tesla command semantics

Example pattern:

- `supportsCommands()`
- `supportsChargingCommands()`

or document Tesla-only optional methods without promoting them to required
cross-provider contract.

### 4. Usage and safety guard

File:

- `functions/lib/services/ev-usage-control-service.js`

Reuse existing EV budget and rate-limit patterns for commands.

Minimum protections:

- per-user cooldown for repeat charge commands
- one generic EV counter increment per user command request
- Tesla detailed call recording per upstream request or proxy hop

## Proxy Strategy

If a vehicle requires signed commands, an extra service is operationally
necessary. The simplest supported option is:

- deploy Tesla's official `tesla/vehicle-command` image as a tiny HTTPS service
- keep signing keys out of this repo
- configure only the URL and auth material in app runtime config

Do not bring back:

- a custom Tesla proxy codebase in this repository
- broad Cloud Run-specific helper logic unless deployment requires it
- fallback behavior that masks signed-command requirements

Recommended runtime configuration shape:

- `TESLA_SIGNED_COMMAND_PROXY_URL`
- `TESLA_SIGNED_COMMAND_PROXY_TOKEN`
- signing key material managed only in the proxy runtime, not in Firebase
  Functions source

## Frontend Implementation Details

### Dashboard

Files:

- `frontend/app.html`
- `frontend/js/dashboard.js`
- `frontend/js/api-client.js`

Add only compact charging controls:

- start charging button
- stop charging button
- charge limit input with submit action
- charging amps input with submit action

Dashboard behavior:

- controls hidden unless selected vehicle is command-ready
- controls disabled while a command is in flight
- clear success and error messages near the EV card
- automatic EV status refresh after command completion
- no discharge button

Recommended UI rules:

- hide `setChargingAmps` when no charging session is active unless validated by
  Tesla runtime behavior
- show readiness hint when virtual key pairing is missing
- show proxy-specific warning when signed transport is required but unavailable

### Settings

Files:

- `frontend/settings.html`
- `frontend/js/settings.js`

Extend Tesla onboarding copy to explain:

- status reads can work after OAuth
- commands may additionally require virtual-key pairing
- users may need to open Tesla deep link:
  `https://tesla.com/_ak/<your-domain>?vin=<VIN>`
- vehicles that require signed commands will stay read-only until pairing and
  proxy readiness are complete

## File-Level Worklist

- `functions/api/routes/ev.js`
- `functions/lib/adapters/tesla-fleet-adapter.js`
- `functions/lib/adapters/ev-adapter.js`
- `functions/lib/services/ev-usage-control-service.js`
- `frontend/js/api-client.js`
- `frontend/js/dashboard.js`
- `frontend/app.html`
- `frontend/settings.html`
- `frontend/js/settings.js`
- `functions/test/ev-routes-modules.test.js`
- `functions/test/tesla-fleet-adapter.test.js`
- `tests/frontend/dashboard.spec.js`
- `docs/guides/TESLA_EV_INTEGRATION.md`
- `docs/guides/TESLA_ONBOARDING.md`
- `docs/API.md`

## Acceptance Criteria

Implementation is complete when all of the following are true:

1. A Tesla vehicle that does not require signed commands can start and stop
   charging through the app.
2. A Tesla vehicle that does require signed commands shows read-only state until
   signed-command prerequisites are satisfied.
3. Once proxy and virtual-key prerequisites are satisfied, the same VCP vehicle
   can execute the supported charging commands through the official proxy path.
4. The dashboard never shows unsupported discharge controls.
5. The app does not fall back to unsigned direct commands for VCP vehicles.
6. Command route responses preserve existing EV API envelope conventions.
7. Backend and frontend tests cover direct path, signed path, validation, and
   readiness gating.

## Recommended Execution Order

1. Expand Tesla scopes and add readiness discovery in adapter and route layer.
2. Implement backend command endpoint with validation and cooldown protection.
3. Implement direct command transport for non-VCP vehicles.
4. Integrate official signed-command proxy support for VCP vehicles.
5. Add dashboard controls and settings guidance.
6. Add tests.
7. Update public Tesla docs and API docs.

## Notes for the Implementer

- Keep the change narrow. This is a charging-control feature, not a general
  Tesla remote command rollout.
- Prefer one backend command endpoint over multiple route-specific endpoints.
- Prefer explicit readiness states over optimistic UI that fails after click.
- Preserve the current status-only behavior for users who never complete
  command prerequisites.