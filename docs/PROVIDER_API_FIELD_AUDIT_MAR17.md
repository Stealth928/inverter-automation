# Provider API Field Audit

Date: 2026-03-17

## Purpose

This document audits the external provider integrations currently wired into the product and identifies:

1. Which upstream endpoints we actually call today.
2. Which fields the product currently leverages in dashboard, automation, history, setup, and EV control flows.
3. Which extra fields or metadata we are already receiving but not using.
4. Which nearby provider capabilities are partially wired or trivially reachable from the current integration surface but still unused.

Scope covered:

- Inverters: FoxESS, AlphaESS, Sungrow, SigenEnergy
- Pricing: Amber Electric
- EV: Tesla Fleet API
- Weather: Open-Meteo geocoding and forecast

This is a repository-grounded audit. Conclusions are based on the current code, tests, route surface, and in-repo documentation. Where a provider schema is not yet validated in this repo, that uncertainty is called out explicitly.

## Method

The audit was performed by tracing:

- Provider API clients under `functions/api/`
- Provider adapters under `functions/lib/adapters/`
- Route handlers under `functions/api/routes/`
- Automation services under `functions/lib/services/`
- Frontend consumption under `frontend/js/`
- Relevant tests under `functions/test/` and `tests/frontend/`

The key architectural pattern to keep in mind is that most inverter providers are normalized through a narrow canonical status envelope. That envelope is useful for cross-provider compatibility, but it is also the main place where upstream richness is lost.

## Executive Summary

The product currently extracts a relatively small common subset of each provider's data:

- Inverters: mostly SoC, temperatures, PV power, load, grid import/export, battery power, schedule/work mode.
- Amber: mainly buy price, feed-in price, renewable percentage, and site id.
- Tesla: mainly charge-state telemetry and command readiness.
- Weather: mainly temperature, rain, weather code, radiation, cloud cover, sunrise/sunset, wind, and timezone.

The biggest gaps are not evenly distributed.

Highest-value unused data, based on current repo evidence:

1. FoxESS diagnostics and power-quality data are available now but not surfaced into normal product views or automation.
2. Tesla `vehicle_data` is rich, but only charging telemetry is normalized. Climate, vehicle state, and schedule-related signals are mostly ignored.
3. Amber site metadata and interval metadata are underused, especially timezone, NMI/network information, and finer tariff attributes.
4. Weather already returns more than automation uses. Precipitation probability, humidity, direct vs diffuse radiation, and wind detail are largely unused in rule logic.
5. SigenEnergy is the least mature integration. The repo itself documents unverified schema assumptions and unimplemented reporting/scheduling support.
6. AlphaESS and Sungrow both expose additional operational and diagnostic fields beyond the current normalized status view, but the product primarily consumes their translated FoxESS-like shape.

## Current Product Leverage Model

### Cross-provider inverter status

The canonical device status shape is effectively:

```js
{
  socPct,
  batteryTempC,
  ambientTempC,
  pvPowerW,
  loadPowerW,
  gridPowerW,
  feedInPowerW,
  observedAtIso
}
```

Some providers also pass `batteryPowerW`, but the UI still centers on the common energy-flow tiles.

Core references:

- `functions/lib/adapters/device-adapter.js`
- `functions/lib/adapters/alphaess-adapter.js`
- `functions/lib/adapters/sungrow-adapter.js`
- `functions/lib/adapters/sigenergy-adapter.js`
- `functions/lib/adapters/foxess-adapter.js`

### Frontend surfaces actually using provider data today

Current meaningful product usage falls into these buckets:

- Dashboard inverter card: solar, house load, grid import/export, battery state, SoC, battery temp, ambient temp, inverter temp, PV string outputs when present.
- History page: generation, feed-in, grid import, house load, topology heuristics such as `meterPower2` for AC-coupled interpretation.
- Automation: SoC, battery temp / ambient temp, Amber prices, selected weather conditions, EV SoC / location / charging state.
- EV dashboard: SoC, charging state, plugged-in state, charge limit, range, time to full, energy/session gain, charging power/amps, command readiness.
- Setup and settings: credential validation, detected provider, some provider-specific identifiers, weather location, timezone synchronization.

That means a field counts as "not leveraged" here if it is not meaningfully used in the main app, automation, or diagnostics flows that influence the product experience.

## Provider-by-Provider Audit

## 1. FoxESS

### Upstream endpoints currently called

Real-time and status:

- `/op/v0/device/real/query`
- `/op/v0/device/real-time`
- `/op/v0/device/list`
- `/op/v0/device/variable/get`
- `/op/v0/device/setting/get`
- `/op/v0/device/battery/soc/get`
- `/op/v0/device/battery/forceChargeTime/get`

Scheduling and control:

- `/op/v1/device/scheduler/get`
- `/op/v1/device/scheduler/enable`
- `/op/v1/device/scheduler/set/flag`
- `/op/v0/device/setting/set`

History and reporting:

- `/op/v0/device/history/query`
- `/op/v0/device/report/query`
- `/op/v0/device/generation`

Extended device/diagnostic routes already present:

- `/op/v0/device/getMeterReader`
- `/op/v0/ems/list`
- `/op/v0/module/list`
- `/op/v0/module/getSignal`
- `/op/v0/gw/list`

Diagnostics route with expanded real-time variable request:

- `/api/inverter/all-data` requests many extra FoxESS variables through `/op/v0/device/real/query`

Key references:

- `functions/api/foxess.js`
- `functions/api/routes/inverter-read.js`
- `functions/api/routes/device-read.js`
- `functions/api/routes/diagnostics-read.js`

### What the product already uses

Used in the main product today:

- SoC
- PV power / total solar power
- House load
- Grid import and feed-in
- Battery charge/discharge power
- Battery temp, ambient temp, inverter temp
- PV string outputs `pv1Power` to `pv4Power` when present
- `meterPower2` heuristics for AC-coupled topology on dashboard/history/curtailment tooling
- Work mode and scheduler groups
- Report/generation totals

Important note: FoxESS is the only provider where the product already reaches beyond the narrow canonical status set in several places.

### Extra data already available but not leveraged

#### Power quality and electrical detail

Available in the diagnostics route or FoxESS real-time/query surfaces, but not used in dashboard or automation:

- Phase voltages: `RVolt`, `SVolt`, `TVolt`
- Phase currents: `RCurrent`, `SCurrent`, `TCurrent`
- Phase frequencies: `RFreq`, `SFreq`, `TFreq`
- Phase powers: `RPower`, `SPower`, `TPower`
- Reactive power: `ReactivePower`
- Power factor: `PowerFactor`
- Grid voltage / current / frequency style values depending on model aliasing

Why this matters:

- Could support grid health visibility.
- Could explain export throttling or unstable performance.
- Could surface power-quality issues before users interpret them as automation faults.

#### Battery electrical detail

Currently fetchable in diagnostics but not really surfaced:

- `batVolt`
- `batCurrent`
- `invBatVolt`
- `invBatCurrent`
- `invBatPower`
- `chargeTemperature`

Why this matters:

- Better battery diagnostics.
- Better distinction between low-power standby vs meaningful charge/discharge.
- More confidence when detecting topology or inverter state anomalies.

#### Fault and running-state detail

Currently fetchable but not used in core product decisions:

- `runningState`
- `currentFault`

Why this matters:

- Would materially improve supportability.
- Could block unsafe automation actions when the inverter is faulted.
- Could explain missing telemetry without sending the user into manual diagnostics.

#### EPS / backup circuit detail

Available in diagnostics expanded list but not surfaced:

- `epsPower`
- `epsVoltR`, `epsCurrentR`, `epsPowerR`
- `epsVoltS`, `epsCurrentS`, `epsPowerS`
- `epsVoltT`, `epsCurrentT`, `epsPowerT`

Why this matters:

- Useful for backup-load observability.
- Could support backup-mode optimization or outage-aware automation.

#### Module / meter / gateway metadata

Current internal API routes expose this, but it is not integrated into the main product experience:

- EMS list metadata
- Module list and module signal
- Gateway / meter list
- Meter reader data

Why this matters:

- Could provide installer-grade diagnostics.
- Could support richer topology discovery.
- Could reduce support cycles for miswired meters or weak communications.

### Extra information we could use with small incremental product work

High-value near-term FoxESS opportunities:

1. Surface `currentFault` and `runningState` in the dashboard and admin/support views.
2. Add a diagnostics panel for voltage, current, frequency, power factor, and reactive power.
3. Use module signal / meter-reader detail to improve topology and curtailment confidence.
4. Gate automation actions when the inverter reports a fault or unsupported state.

## 2. AlphaESS

### Upstream endpoints currently called

Setup and validation:

- `/api/getEssList`

Operational status and scheduling:

- `/api/getLastPowerData`
- `/api/getChargeConfigInfo`
- `/api/getDisChargeConfigInfo`
- `/api/updateChargeConfigInfo`
- `/api/updateDisChargeConfigInfo`

History:

- `/api/getOneDayPowerBySn`

Key references:

- `functions/api/alphaess.js`
- `functions/lib/adapters/alphaess-adapter.js`
- `functions/api/routes/setup-public.js`

### What the product already uses

Used today:

- SoC
- Battery temp and ambient temp when reported
- PV power
- Load power
- Grid import/export via signed `pgrid`
- Battery power
- Scheduler windows translated into FoxESS-style groups
- History from one-day power data
- AlphaESS-specific battery sign inversion and 15-minute scheduler rounding logic

### Extra data already available but not leveraged

#### Schedule configuration metadata

The product currently reduces AlphaESS scheduler config mostly to start/end windows and coarse enable flags. Not meaningfully surfaced:

- `batHighCap` beyond max-soc translation
- `batUseCap` beyond min-soc translation
- Distinction between charge and discharge control semantics
- Whether the provider-side configuration contains more nuance than the flat scheduler UI exposes

This matters because the AlphaESS API is more schedule-centric than work-mode-centric, and the product currently flattens that behavior.

#### Real-time operational diagnostics

The normalized AlphaESS status uses only:

- `soc`
- `batTemp`
- `temp`
- `ppv`
- `pload` or `load`
- `pgrid`
- `pbat` or `cobat`

Anything else returned by `getLastPowerData` is currently ignored.

Because the repo does not currently preserve or document a larger validated AlphaESS response schema, the safe conclusion is:

- We are using only the minimum energy-flow subset.
- We are not surfacing device-health, richer temperature, or fault-like state if AlphaESS returns it.
- The current adapter would discard any extra fields even if upstream already returns them.

#### Setup-time system metadata

`/api/getEssList` is used only to validate system access. The product does not persist or expose account-level system metadata from that response beyond validating `sysSn`.

Potentially useful examples if present in the provider response:

- System names
- Site/account labels
- Region/site metadata
- Multi-system accounts

### Known caveat

AlphaESS has a comparatively shallow verified schema in this repo. The integration is operational, but its extra-field opportunity is less concretely documented than FoxESS or Tesla because the repo only normalizes a narrow subset and does not preserve richer raw response docs.

### Highest-value opportunities

1. Preserve and inspect raw AlphaESS status payloads for fault/state fields.
2. Surface charge/discharge config metadata beyond start/end windows.
3. Add explicit support metadata for multi-system AlphaESS accounts returned from `getEssList`.

## 3. Sungrow

### Upstream endpoints currently called

Authentication and setup:

- `connect`
- `queryDeviceListByTokenAndType`

Runtime:

- `queryRealTimeDataByTokenAndType`
- `queryDevicePointByToken`
- `setDevicePoint`

History and reports:

- `queryDeviceHistData`
- `queryDeviceStatPoints`

Key references:

- `functions/api/sungrow.js`
- `functions/lib/adapters/sungrow-adapter.js`
- `functions/api/routes/setup-public.js`

### What the product already uses

Used today:

- SOC from `p187`
- Battery temp from `p190`
- PV power from `p83`
- Battery power from `p86`
- Load power from `p27`
- Grid net power from `p10994`
- EMS mode from `p27085`
- TOU start/end slots from `p27243` to `p27250`
- TOU enable from `p27251`
- History via `queryDeviceHistData`
- Energy report / generation totals via `queryDeviceStatPoints`

Important nuance: the Sungrow integration is more complete than it first appears. Unlike SigenEnergy, it already has functioning history/report/generation support.

### Extra data already available but not leveraged

#### Requested but not surfaced as user-facing fields

`p9` is requested in the default real-time points but is not surfaced as a first-class UI concept. The adapter comment calls it an inverter output power diagnostic.

This is a concrete example of data we already fetch but mostly discard.

#### Parameter-space richness beyond current point list

The adapter only requests a narrow fixed set of realtime point ids. The current default list does not attempt to fetch:

- Inverter temperature point(s)
- Power quality points
- Battery voltage/current points
- Grid voltage/current/frequency points
- Model-specific diagnostics

The repo comments explicitly note that point codes are model-dependent, which is why the integration stays conservative.

This means the gap is not theoretical. The product architecture is choosing a safe minimal point set rather than a richer provider-specific view.

#### Schedule semantics lost during translation

The product flattens Sungrow TOU periods into FoxESS-style scheduler groups with conservative defaults:

- Work mode is inferred from the first active group.
- Reverse translation defaults active TOU slots to `ForceCharge`.
- More nuanced Sungrow scheduling semantics are not retained in UI form.

#### Energy reporting still omits some potentially useful detail

The product already uses the documented energy stat points:

- `p58` generation
- `p91` feed-in
- `p89` grid consumption
- `p90` battery charge energy
- `p93` battery discharge energy

But it does not expose richer report metadata such as:

- Provider-native labels or units
- Any quality or completeness flags from the upstream response
- Additional model-specific stats outside the current five mapped points

### Highest-value opportunities

1. Add optional Sungrow diagnostics mode to request extra electrical and temperature point ids on supported models.
2. Surface `p9` and other non-core diagnostics where useful.
3. Preserve more provider-native TOU semantics instead of flattening everything into FoxESS-shaped groups.

## 4. SigenEnergy

### Upstream endpoints currently called

Authentication and station discovery:

- `auth/oauth/token`
- `device/owner/station/home`

Runtime:

- `device/sigen/station/energyflow`
- `device/energy-profile/mode/current/{stationId}`
- `device/energy-profile/mode`

Key references:

- `functions/api/sigenergy.js`
- `functions/lib/adapters/sigenergy-adapter.js`
- `functions/api/routes/setup-public.js`

### What the product already uses

Used today:

- Station id and device serial discovery during setup
- Work mode read/set for supported mapped modes
- Basic status normalization from `energyflow`

Setup also stores:

- `sigenRegion`
- `sigenStationId`
- `sigenDeviceSn`

### Extra data already available but not leveraged

#### Station metadata already returned and mostly unused in product UX

`device/owner/station/home` is normalized to include:

- `hasPv`
- `hasEv`
- `hasAcCharger`
- `acSnList`
- `dcSnList`
- `onGrid`
- `pvCapacity`
- `batteryCapacity`

Today, only the identifiers needed for configuration are materially persisted for runtime use. The rest is not surfaced to users as system-capability metadata.

Why this matters:

- `hasEv` and `hasAcCharger` could drive onboarding and rule suggestions.
- `onGrid` could influence automation guardrails.
- `pvCapacity` and `batteryCapacity` could prefill or validate user-entered capacity settings instead of relying on manual input.

#### Energy-flow schema uncertainty is itself a product gap

The repo explicitly marks the SigenEnergy energy-flow field names as placeholders. That means:

- We cannot claim a complete field inventory from this repo alone.
- We also cannot trust that we are extracting the best available fields yet.
- The current integration almost certainly leaves useful data unused simply because the schema has not been validated against a live response.

This is the clearest maturity gap in the entire provider set.

#### Mode-space is partially mapped

The adapter knows these Sigen modes:

- `MSC` -> `SelfUse`
- `FFG` -> `Feedin`
- `VPP`
- `NBI`

But only a subset is productized. `VPP` and `NBI` are not meaningfully exposed as product concepts.

#### Scheduling, history, report, generation are effectively missing

Current state in repo:

- `getSchedule` is a stub
- `setSchedule` is a stub
- `getHistory` returns `null`
- `getReport` returns `null`
- `getGeneration` returns `null`

This is more than an unused-field issue. It means the SigenEnergy integration is missing whole classes of provider capability.

### Highest-value opportunities

1. Validate live `energyflow` payloads and replace placeholder field mapping with real schema.
2. Surface station metadata such as `hasEv`, `onGrid`, `pvCapacity`, `batteryCapacity`.
3. Implement Northbound / schedule support.
4. Implement history/report/generation so Sigen users reach parity with FoxESS and Sungrow.

## 5. Amber Electric

### Upstream endpoints currently called

- `/sites`
- `/sites/{siteId}/prices/current`
- `/sites/{siteId}/prices`

Key references:

- `functions/api/amber.js`
- `functions/lib/adapters/amber-adapter.js`
- `functions/api/routes/pricing.js`

### What the product already uses

Used today:

- Site selection via `siteId`
- Buy price
- Feed-in price
- Renewable percentage when present
- Historical actual/forecast interval retrieval
- Price-based automation conditions
- EV cost estimation using current tariff

### Extra data already available but not leveraged

#### Site metadata

The product does not meaningfully expose richer site metadata from `/sites`. Depending on the Amber payload actually returned for a given account, useful fields may include:

- Human-friendly site name
- Site timezone
- NMI and network information
- Additional site/location descriptors
- Controllable-load related metadata

The repo currently treats `/sites` largely as an id discovery mechanism.

Why this matters:

- Site timezone could be used more explicitly instead of inferring local behavior elsewhere.
- NMI/network data could improve support tooling and tariff explainability.
- Multi-site users would benefit from better site labeling.

#### Interval metadata the product collapses away

Amber intervals are normalized down to:

- `startIso`
- `endIso`
- `buyCentsPerKwh`
- `feedInCentsPerKwh`
- `renewablePct`
- `source`

Everything else in the row is effectively discarded.

Potentially useful examples include:

- Channel distinctions beyond `general` and `feedin`
- Underlying interval type nuance
- Provider-native timing / billing metadata
- Additional tariff attributes if present in the raw row

#### Renewable percentage is underused

`renewablePct` is preserved in normalization, but current product usage is limited compared with price fields.

This is a concrete opportunity because the data is already normalized and available.

### Highest-value opportunities

1. Surface site metadata in settings and multi-site UX.
2. Add automation conditions based on `renewablePct` and potentially other Amber row attributes.
3. Preserve more provider-native interval metadata for ROI, auditing, and operator views.

## 6. Tesla Fleet API

### Upstream endpoints currently called

Auth and token management:

- `auth.tesla.com/oauth2/v3/token`

Vehicle data and readiness:

- `/api/1/vehicles/{id}/vehicle_data`
- `/api/1/vehicles/fleet_status`
- `/api/1/vehicles/{id}/wake_up`

Charging commands:

- `/api/1/vehicles/{id}/command/charge_start`
- `/api/1/vehicles/{id}/command/charge_stop`
- `/api/1/vehicles/{id}/command/set_charge_limit`
- `/api/1/vehicles/{id}/command/set_charging_amps`

Signed proxy path for VCP vehicles:

- `/api/1/vehicles/{vin}/command/{command}` through the signed-command proxy

Key references:

- `functions/lib/adapters/tesla-fleet-adapter.js`
- `functions/lib/adapters/ev-adapter.js`

### What the product already uses

Used today from normalized Tesla vehicle status:

- `socPct`
- `chargingState`
- `chargeLimitPct`
- `isPluggedIn`
- `isHome`
- `rangeKm`
- `ratedRangeKm`
- `timeToFullChargeHours`
- `chargeEnergyAddedKwh`
- `rangeAddedKm`
- `chargingPowerKw`
- `chargingAmps`

Used from `fleet_status`:

- Signed-command readiness state
- Transport choice (`direct` vs `signed`)
- Whether VCP is required
- Whether a virtual key appears missing
- `firmwareVersion` and `totalNumberOfKeys` only indirectly through readiness logic

### Extra data already available but not leveraged

The largest concrete Tesla gap is that the repo fetches full `vehicle_data` but normalizes only charging-related fields.

#### `charge_state` richness currently ignored

Likely available in the current payload but not normalized:

- Scheduled charging state and times
- Preconditioning flags and timing
- Detailed port / latch state
- Cold-weather charging indicators
- More conservative battery-level variants such as usable battery level

Why this matters:

- Could improve EV planning and automation guardrails.
- Could explain why a charge is delayed or slower than expected.

#### `drive_state` detail currently ignored

The adapter uses `drive_state` only to infer `isHome`. It does not expose:

- Location coordinates
- Heading
- Motion context
- GPS timestamp

Why this matters:

- Could support richer location-aware automation.
- Could improve diagnostics when a vehicle appears unavailable for commands.

#### `vehicle_state` detail currently ignored

The adapter uses only limited bits of `vehicle_state` for home detection. It does not expose:

- Software update state
- Power state
- Odometer
- Sentry/security state
- More detailed door/window/vehicle-status metadata

Why this matters:

- Strong support/debug value.
- Potentially useful user-facing EV health and readiness context.

#### `climate_state` is effectively unused

The current normalization does not expose climate telemetry.

Potentially useful examples:

- Cabin temperature
- Outside temperature
- HVAC state
- Preconditioning context

Why this matters:

- Strong candidate for preconditioning-aware charge logic.
- Better user understanding of why the car is drawing power.

#### `fleet_status` operator metadata is underused

Current readiness logic consumes only enough to choose command transport.
The product does not really surface:

- `firmwareVersion`
- `totalNumberOfKeys`
- VCP requirement as an understandable status concept

### Highest-value opportunities

1. Expose selected `vehicle_data` fields from `vehicle_state`, `drive_state`, and `climate_state` in the EV dashboard.
2. Surface scheduled charging and preconditioning status.
3. Show clearer operator-facing readiness diagnostics such as firmware version and virtual-key state.
4. Use cabin/outside temperature and scheduled state to improve EV automation.

## 7. Weather (Open-Meteo)

### Upstream endpoints currently called

Geocoding:

- `https://geocoding-api.open-meteo.com/v1/search`

Forecast:

- `https://api.open-meteo.com/v1/forecast`

Requested hourly variables:

- `temperature_2m`
- `precipitation`
- `precipitation_probability`
- `weathercode`
- `shortwave_radiation`
- `direct_radiation`
- `diffuse_radiation`
- `cloudcover`
- `windspeed_10m`
- `relativehumidity_2m`
- `uv_index`

Requested daily variables:

- `temperature_2m_max`
- `temperature_2m_min`
- `precipitation_sum`
- `weathercode`
- `shortwave_radiation_sum`
- `uv_index_max`
- `sunrise`
- `sunset`
- `precipitation_probability_max`

Also returned:

- `current_weather`
- detected `timezone`

Key references:

- `functions/lib/services/weather-service.js`
- `functions/api/routes/weather.js`
- `frontend/js/dashboard.js`
- `functions/lib/services/automation-rule-evaluation-service.js`

### What the product already uses

Used in the product today:

- Resolved place name, country, latitude, longitude, timezone, fallback metadata
- Current temperature and weather code
- Rain summary
- Wind speed and direction
- Current shortwave radiation and cloud cover
- Daily max/min temp
- Daily rain
- Sunrise/sunset
- Daily weather descriptions
- Daily derived average cloud cover and radiation

Used in automation today:

- Temperature-based conditions
- Solar radiation conditions
- Cloud-cover conditions
- Legacy weather-code conditions

### Extra data already available but not leveraged

#### Requested from Open-Meteo but lightly used in automation

Already requested but not meaningfully central to rules today:

- `precipitation_probability`
- `precipitation_probability_max`
- `relativehumidity_2m`
- `uv_index`
- `uv_index_max`
- `direct_radiation`
- `diffuse_radiation`

Why this matters:

- Rain probability is more actionable than daily rainfall totals for short-horizon decisions.
- Humidity and UV can improve comfort or heat-related charge decisions.
- Direct vs diffuse radiation can improve solar yield estimation beyond plain shortwave radiation.

#### Requested and shown, but not strongly exploited

`weathercode` is used for labels and a legacy automation condition, but the product does not build richer behavior around severe conditions.

Examples:

- Storm-aware charge suppression
- Rain probability gating for export-vs-charge rules
- Low-visibility or high-wind operational warnings

#### Timezone/location intelligence is underexploited

Weather already gives the repo one of its best sources of local context:

- resolved place
- fallback status
- timezone
- coordinates

The product uses timezone sync, but there is room to use this metadata more consistently across provider/site UX.

### Highest-value opportunities

1. Add rain-probability and wind-aware automation conditions.
2. Use `direct_radiation` and `diffuse_radiation` to improve forecasted solar confidence.
3. Surface UV/humidity in the dashboard or heat-risk automation.

## Cross-Provider Gaps

These are the broad patterns causing underuse across the whole product.

### 1. Canonical normalization is intentionally narrow

Cross-provider compatibility is good, but it comes at a real cost:

- Provider-specific richness is often dropped at the adapter boundary.
- The UI mostly assumes FoxESS-shaped realtime concepts.
- Advanced provider semantics are flattened into a lowest-common-denominator model.

### 2. Diagnostics data exists separately from the main product

Several rich data sources already exist but live in specialized diagnostic routes rather than product features:

- FoxESS expanded realtime diagnostics
- device/module/meter/gateway metadata
- Tesla readiness metadata

This means the information is available to engineering, but not to users or automation.

### 3. Automation rules are materially narrower than available upstream context

Current automation mainly uses:

- SoC
- temperature
- time
- Amber price
- solar radiation / cloud cover / legacy weather code
- EV state

It does not yet exploit:

- Inverter fault state
- grid quality
- richer weather probability signals
- Amber metadata beyond price
- Tesla climate and schedule state

### 4. Setup flows discover metadata but do not feed richer runtime UX

Examples:

- Sigen station capabilities
- Sungrow device-list context
- AlphaESS account/system list context

We often validate with this metadata, then discard it.

## Priority Backlog

If the goal is to extract more product value from already-available provider APIs without over-expanding scope, this is the recommended order.

### Priority 1

1. FoxESS fault/state diagnostics in the main dashboard and automation guardrails.
2. Tesla vehicle-state and climate-state exposure in EV overview.
3. SigenEnergy schema validation and parity work for history/report/schedule.

### Priority 2

1. Weather automation upgrades using rain probability, humidity, UV, and radiation composition.
2. Amber site metadata and renewable-aware rule support.
3. Sungrow optional diagnostics mode for non-core point ids.

### Priority 3

1. Better multi-site and multi-system provider metadata in setup/settings UX.
2. Provider-native schedule semantics where current FoxESS-shaped translation loses detail.
3. Admin/support tooling that exposes the already-fetched metadata more clearly.

## Bottom Line

The product is not leaving equal value on the table everywhere.

- FoxESS already has the richest integration, but its diagnostics and electrical detail are still underused.
- Tesla has the richest single payload-to-usage gap: we fetch full `vehicle_data` and use only a charging subset.
- Amber and weather are operationally useful today, but both have extra context that could sharpen automation and user trust.
- Sungrow is in solid shape for core telemetry/reporting, but still intentionally conservative on provider-specific detail.
- SigenEnergy is the biggest maturity gap and should be treated as a schema-validation and capability-parity project, not just a field-exposure tweak.

## Source Files Reviewed

- `functions/api/foxess.js`
- `functions/api/alphaess.js`
- `functions/api/sungrow.js`
- `functions/api/sigenergy.js`
- `functions/api/amber.js`
- `functions/lib/adapters/device-adapter.js`
- `functions/lib/adapters/foxess-adapter.js`
- `functions/lib/adapters/alphaess-adapter.js`
- `functions/lib/adapters/sungrow-adapter.js`
- `functions/lib/adapters/sigenergy-adapter.js`
- `functions/lib/adapters/amber-adapter.js`
- `functions/lib/adapters/ev-adapter.js`
- `functions/lib/adapters/tesla-fleet-adapter.js`
- `functions/lib/services/weather-service.js`
- `functions/lib/services/automation-rule-evaluation-service.js`
- `functions/api/routes/inverter-read.js`
- `functions/api/routes/device-read.js`
- `functions/api/routes/diagnostics-read.js`
- `functions/api/routes/pricing.js`
- `functions/api/routes/weather.js`
- `functions/api/routes/setup-public.js`
- `frontend/js/dashboard.js`
- `frontend/js/history.js`
- `frontend/js/control.js`
- relevant provider adapter and frontend tests under `functions/test/` and `tests/frontend/`