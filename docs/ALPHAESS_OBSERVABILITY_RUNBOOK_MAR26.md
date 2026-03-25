# AlphaESS Observability Runbook

## Purpose

This runbook documents the temporary AlphaESS observability added in March 2026 to diagnose the two current AlphaESS users.

Scope:

- `GET /api/inverter/real-time`
- `POST /api/inverter/all-data`
- Admin API Health tab guidance

The intent is diagnosis, not a permanent telemetry pipeline.

## What Was Added

The runtime now computes an in-memory `alphaessDiagnostics` object from the existing AlphaESS status response.

It records:

- selected kW interpretation
- native vs inverted battery-flow balance
- anomaly codes for suspicious readings
- operator context such as route, user id, user email, and device SN

## Cost And Safety

This implementation is intentionally low-cost.

- No extra provider API calls are made.
- No extra Firestore writes are made.
- No extra storage writes are made.
- Live realtime requests only emit logs when the reading is suspicious.
- Manual deep diagnostics emit logs on every invocation because they are operator-triggered and infrequent.

Operational implication:

- steady-state AlphaESS cost impact is log volume only, and only for suspicious live reads plus explicit manual diagnostics.

## What To Look For

Primary anomaly codes:

- `negative-load-power`
  - house load is negative; treat the AlphaESS load channel as semantically suspect
- `small-feed-in-value-may-be-watts`
  - export is a small positive integer that may actually be watts
- `small-grid-import-value-may-be-watts`
  - import is a small positive integer that may actually be watts
- `power-unit-normalization-ambiguity`
  - strict watt conversion and heuristic conversion disagree materially
- `energy-flow-imbalance`
  - sources and sinks do not reconcile after the chosen battery sign is applied
- `temperature-sensors-not-reporting`
  - battery and ambient temperatures are both zero; expected on some AlphaESS installs

Key fields to inspect in the logged payload:

- `selectedKw`
- `flowBalance.selected.residualKw`
- `flowBalance.native`
- `flowBalance.inverted`
- `batterySign.invertApplied`
- `systemTopology.configuredCoupling`

## When To Check

Check AlphaESS diagnostics when any of the following are true:

- immediately after deploying AlphaESS normalization or battery-sign changes
- after onboarding a new AlphaESS user or rotating AlphaESS credentials
- when a user reports negative house load or impossible export/import combinations
- when battery charge/discharge direction appears wrong
- after running `all-data` manually to confirm whether a bad reading is reproducible

## Admin UX

The Admin API Health tab now includes an AlphaESS observability panel with:

- current logging mode
- cost guardrails
- anomaly guide
- timing guide
- rollback summary

This panel is static guidance backed by the admin API response and does not trigger additional provider traffic.

## Rollback

Rollback is code-only.

1. Remove `functions/lib/alphaess-diagnostics.js` usage from:
   - `functions/api/routes/inverter-read.js`
   - `functions/api/routes/diagnostics-read.js`
2. Remove the `observability.alphaess` payload from `GET /api/admin/api-health`.
3. Remove the AlphaESS observability panel from:
   - `frontend/admin.html`
   - `frontend/js/admin.js`
4. Redeploy functions and hosting.

No Firestore cleanup, data migration, or background repair job is required.

## Verification

Backend verification:

- `npm --prefix functions run lint`
- `npm --prefix functions test -- --runInBand read-only-routes-modules.test.js`
- `npm --prefix functions test -- --runInBand admin-routes-modules.test.js`

Frontend verification:

- `npm run test:e2e:frontend -- admin-behavior.spec.js`