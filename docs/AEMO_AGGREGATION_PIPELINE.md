# AEMO Market Data Pipeline

Last updated: 2026-04-04

Purpose: document the current end-to-end AEMO data flow in this repo, from raw
monthly CSV files to published market-insights JSON bundles and live current
snapshot refreshes.

## Pipeline Overview

The repo now has four distinct AEMO-related layers:

1. Raw monthly CSV files in `aemo-aggregated-data/`
2. Aggregate CSV outputs in `aemo-aggregated-data/aggregates/`
3. Published frontend JSON bundle in `frontend/data/aemo-market-insights/`
4. Firestore-backed current-price snapshots in `aemoSnapshots/{region}`

Those layers serve different jobs:

- aggregates power the historical market-insights experience
- published JSON powers the public preview and authenticated market-insights UI
- Firestore snapshots power current AEMO pricing and admin health views

## Current Scripts and Package Commands

### Historical aggregate and bundle generation

| Command | Script | Purpose |
| --- | --- | --- |
| `npm run aemo:dashboard:build` | `scripts/generate-aemo-market-insights.js` | Build the published frontend JSON bundle from aggregate CSVs |
| `npm run aemo:dashboard:update:delta` | `scripts/aemo-market-insights-delta-update.js` | Re-aggregate only changed raw CSV months, update manifest/state, then rebuild published JSON |
| `npm run test:market-insights:contracts` | `tests/scripts/aemo-market-insights-*.test.js` | Contract tests for the published market-insights data bundle |

### Legacy/raw Python aggregation path

| Script | Purpose |
| --- | --- |
| `download_aemo_monthly.py` | Download raw monthly AEMO `PRICE_AND_DEMAND` CSV files |
| `aggregate_aemo_monthly.py` | Build aggregate CSV outputs and manifest from raw monthly CSV files |

### Hosting synchronization

| Command | Script | Purpose |
| --- | --- | --- |
| `npm run aemo:dashboard:sync:hosting` | `scripts/sync-hosted-market-insights.js` | Compare local bundle freshness with hosted bundle and sync the fresher hosted copy into `frontend/data/aemo-market-insights/` |

This command is part of Hosting predeploy and is run in strict mode from
`firebase.json`.

## Historical Aggregate Inputs and Outputs

### Inputs

Raw monthly CSVs live in:

- `aemo-aggregated-data/`

Expected filename shape:

- `NSW202601.csv`
- `QLD202601.csv`
- `VIC202601.csv`
- `SA202601.csv`
- `TAS202601.csv`

### Aggregate outputs

Aggregate CSVs and manifest live in:

- `aemo-aggregated-data/aggregates/`

Current aggregate outputs:

- `monthly_summary.csv`
- `daily_summary.csv`
- `hourly_summary.csv`
- `quality_report.csv`
- `manifest.json`
- `delta-state.json` for incremental tracking

## Published Frontend Bundle

The published bundle lives in:

- `frontend/data/aemo-market-insights/`

Current asset shape:

- `index.json`
- one per-region file for each published region, such as `NSW.json`

`index.json` currently carries:

- `generatedAt`
- `sourceGeneratedAt`
- `regions`
- `files`
- `defaults`
- `bounds`
- `counts`
- `dataworks`

Each region file currently contains:

- `region`
- `generatedAt`
- `sourceGeneratedAt`
- `latestDate`
- `latestPeriod`
- `daily`
- `monthly`
- `quality`
- `qualityPeriods`

This bundle is consumed by:

- the public preview at `/market-insights/`
- the authenticated member workspace at `/market-insights.html`

## Delta Update Flow

`scripts/aemo-market-insights-delta-update.js` performs the current incremental
historical refresh.

High-level flow:

1. inspect raw monthly CSV files under `aemo-aggregated-data/`
2. compare file size and modification time against `delta-state.json`
3. identify changed regions and periods
4. run `aggregate_aemo_monthly.py` only for the changed month range and regions
5. merge updated aggregate CSV slices back into the full aggregate outputs
6. rewrite `manifest.json`
7. update `delta-state.json`
8. rebuild the published JSON bundle by running
   `scripts/generate-aemo-market-insights.js`

This means the repo is no longer limited to full historical rebuilds for every
update.

## Hosted Sync and Deploy Flow

`scripts/sync-hosted-market-insights.js` compares:

- local bundle freshness
- hosted bundle freshness from the configured/default hosting origins

Behavior:

- if hosted data is fresher, local files are replaced
- if local data is current or fresher, nothing changes
- in strict mode, failure to fetch the hosted bundle aborts the command
- this is expected during release prep when production already has a newer
  published bundle; the checked-in `frontend/data/aemo-market-insights/`
  directory is refreshed before deploy so `test:market-insights:contracts`
  and Hosting stay aligned with live freshness

This protects Hosting deploys from shipping an older checked-out local bundle
when the live site already has a newer published dataset.

## Live Snapshot Refresh Job

Historical bundle generation is separate from current AEMO snapshot refreshes.

The scheduled Cloud Function:

- export name: `refreshAemoLiveSnapshots`
- schedule: every 5 minutes
- time zone: `Australia/Brisbane`

writes current-region snapshots into:

- `aemoSnapshots/{region}`

These live snapshots support:

- `/api/pricing/current?provider=aemo`
- `/api/pricing/prices?provider=aemo`
- `/api/pricing/actual?provider=aemo`
- admin health and DataWorks diagnostics

## Admin and DataWorks Integration

The admin surface now includes DataWorks operations for market-data visibility
and dispatch.

Relevant endpoints:

- `GET /api/admin/dataworks/ops`
- `POST /api/admin/dataworks/dispatch`

Current DataWorks-related behavior includes:

- GitHub workflow status summary
- freshness and quality summary derived from the published bundle
- snapshot health summary derived from Firestore `aemoSnapshots`
- manual workflow dispatch when `GITHUB_DATAWORKS_TOKEN` is configured

## Recommended Commands

### Full historical rebuild

```bash
python aggregate_aemo_monthly.py --source aemo-aggregated-data --out aemo-aggregated-data/aggregates
npm run aemo:dashboard:build
```

### Incremental update

```bash
npm run aemo:dashboard:update:delta
```

### Contract verification

```bash
npm run test:market-insights:contracts
```

### Hosting freshness sync

```bash
npm run aemo:dashboard:sync:hosting -- --strict
```

## Validation Checklist

After updating historical data, verify:

1. `aemo-aggregated-data/aggregates/manifest.json` has plausible counts and
   expected regions
2. `frontend/data/aemo-market-insights/index.json` points at all expected
   region files
3. `npm run test:market-insights:contracts` passes
4. public `/market-insights/` and authenticated `/market-insights.html` still
   render the updated bundle
5. `refreshAemoLiveSnapshots` logs show healthy current-snapshot refreshes
