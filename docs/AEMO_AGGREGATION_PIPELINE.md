# AEMO Aggregate Data Processing Methodology

This document explains how the AEMO price-and-demand aggregates are produced and
what each generated table contains.

## 1) Pipeline overview

The dataset is produced in two stages:

1. Download raw monthly AEMO CSV files (optional if files are already present locally).
2. Aggregate raw files into:
   - `monthly_summary.csv`
   - `daily_summary.csv`
   - `hourly_summary.csv`
   - `quality_report.csv`
   - `manifest.json`

All outputs are written to `aemo-aggregated-data/aggregates` by default.

## 2) Scripts in use

### `download_aemo_monthly.py`

- Purpose: Pull monthly AEMO `PRICE_AND_DEMAND` CSVs directly into a local folder.
- Default output folder: `aemo-aggregated-data`
- URL pattern used:
  `https://www.aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_{YYYYMM}_{REGION}1.csv`
- Expected region codes:
  `NSW`, `QLD`, `VIC`, `SA`, `TAS`, `SNOWY` (unless overridden)
- Output files are named like:
  `NSW202601.csv`

CLI arguments:
- `--start YYYY-MM` (default: `1998-12`)
- `--end YYYY-MM` (default: previous month)
- `--regions` (space-separated list)
- `--out` (default: `aemo-aggregated-data`)
- `--overwrite` (force re-download existing files)

### `aggregate_aemo_monthly.py`

- Purpose: Read raw monthly files and generate all aggregate output files listed above.
- Default source folder: `aemo-aggregated-data`
- Default output folder: `aemo-aggregated-data/aggregates`

CLI arguments:
- `--source` (folder with monthly raw files)
- `--out` (aggregate output folder)
- `--start YYYY-MM` (optional lower bound)
- `--end YYYY-MM` (optional upper bound)
- `--regions` (optional region filter)

This is the script that:
- parses each raw monthly CSV,
- validates numeric fields,
- computes interval statistics,
- builds day/hour buckets,
- writes aggregate tables,
- writes `manifest.json` with run metadata.

### `download_aemo_price_and_demand.py`

- Purpose: A legacy/manual year-based downloader.
- Uses fixed `year = 2026` and hardcoded output under `~/Downloads/aemo_price_and_demand_<year>/YYYYMM/`.
- Not used by the current aggregate pipeline flow above unless manually selected.

## 3) Processing methodology (aggregate script)

For each raw input file matching:

- filename pattern `REGIONYYYYMM.csv` (e.g. `NSW202601.csv`)
- required raw columns:
  - `SETTLEMENTDATE` (parsed with `%Y/%m/%d %H:%M:%S`)
  - `RRP` (float)
  - `TOTALDEMAND` (float)

Rows with missing/invalid `SETTLEMENTDATE`, `RRP`, or `TOTALDEMAND` are skipped and counted as `malformedRows`.

### Interval and quality logic

For each file, the script computes:

- consecutive timestamp deltas in minutes,
- `intervalModeMinutes` = mode of positive intervals,
- `intervalAnomalies` for non-positive/irregular intervals,
- `estimatedMissingIntervals` from gaps larger than one interval,
- `duplicateIntervals`,
- expected rows from time span and interval mode,
- `issues` flags:
  - `nonstandard-interval` (if mode is not 5 or 30 min),
  - `interval-anomalies`,
  - `malformed-rows`,
  - `partial-month`,
  - `incomplete-month`,
  - `empty` (if no valid rows).

For each numeric vector it computes:
- count/min/max/mean
- quantiles: p05, p25, p50, p75, p90, p95, p99.

Daily/Hourly event metrics:
- `negativeRRPCount`: number of values `< 0`.
- `highRRPIntervalCount`: intervals with `RRP >= p95`.
- `highRRPEventCount`: number of contiguous high-RRP runs above `p95`.
- `longestHighRRPEventIntervals` and `longestHighRRPEventMinutes`.

## 4) Output tables and columns

### `monthly_summary.csv`

Generated columns:

- `region` — file region token (`NSW`, `QLD`, etc)
- `period` — month key `YYYYMM`
- `file` — source filename
- `firstTimestamp` — earliest valid settlement timestamp
- `lastTimestamp` — latest valid settlement timestamp
- `rows` — number of valid rows used
- `malformedRows` — skipped row count
- `intervalModeMinutes` — dominant interval in minutes
- `firstIntervalMinutes` — first non-zero interval value
- `expectedFullRows` — theoretical full-month row count from calendar interval
- `expectedSpanRows` — theoretical rows for observed month span
- `coverageFullPct` — `rows / expectedFullRows * 100`
- `coverageSpanPct` — `rows / expectedSpanRows * 100`
- `estimatedMissingIntervals` — inferred missing intervals due to gaps
- `intervalAnomalies` — anomaly count
- `duplicateIntervals` — duplicate timestamp interval count
- `isPartialMonth` — `True` when file does not cover full month end
- `status` — `"ok"` or `;`-delimited issue flags
- `meanRRP`, `minRRP`, `maxRRP`
- `p05RRP`, `p25RRP`, `p50RRP`, `p75RRP`, `p90RRP`, `p95RRP`, `p99RRP`
- `meanDemand`, `minDemand`, `maxDemand`, `demandP95`
- `negativeRRPCount` — count of `RRP <= 0`
- `highRRPIntervalCount`
- `highRRPEventCount`
- `longestHighRRPEventIntervals`
- `longestHighRRPEventMinutes`

### `hourly_summary.csv`

- `region`
- `period`
- `hour` — `YYYY-MM-DD HH` bucket
- `rowCount`
- `meanRRP`, `minRRP`, `maxRRP`
- `p50RRP`, `p90RRP`, `p95RRP`
- `meanDemand`, `minDemand`, `maxDemand`

### `daily_summary.csv`

Current committed output file currently in this workspace has:

- `region`, `period`, `date`, `rowCount`,
  `meanRRP`, `minRRP`, `maxRRP`,
  `p05RRP`, `p25RRP`, `p50RRP`, `p75RRP`, `p90RRP`, `p95RRP`,
  `meanDemand`, `minDemand`, `maxDemand`, `negativeRRPCount`

The current `aggregate_aemo_monthly.py` now includes additional derived daily fields in
its write schema, so a rerun will append these columns:

- `stdRRP` — standard deviation of hourly RRP values in the day
- `volatilityRRP` — `maxRRP - minRRP`
- `expectedRowCount` — expected rows for full day (based on file interval mode)
- `missingRowCount` — `expectedRowCount - rowCount`
- `coveragePct` — day completeness percentage
- `qualityScore` — same as `coveragePct`
- `hourCount` — number of hour buckets present
- `hourCoveragePct` — `(hourCount / 24) * 100`
- `peakHour` — hour of max hourly mean RRP (string, `00`-`23`)
- `peakHourRRP` — hourly-mean RRP at `peakHour`
- `offPeakMeanRRP` — mean of hourly means during off-peak hours (`0-6`, `22-23`)
- `hoursAboveP95` — number of hours with hourly mean RRP >= daily `p95`

### `quality_report.csv`

- `file` — source filename
- `region` — source file region
- `period` — file month
- `rows` — valid row count
- `issue` — issue string (`none` or semicolon-separated flags)
- `estimatedMissingIntervals`
- `intervalAnomalies`
- `malformedRows`

### `manifest.json`

Run-level metadata written with each aggregate run:

- `generatedAt` (UTC timestamp)
- `sourceDir`
- `filesProcessed`
- `outDir`
- `monthlyCount`
- `dailyCount`
- `hourlyCount`
- `start` and `end` month filters (or `null`)
- `regions` array

## 5) Where the data lives now

- Source raw files: `aemo-aggregated-data/`
- Aggregates: `aemo-aggregated-data/aggregates/`
- In-memory/CSV processing is local to this repo; no Firestore writes happen in these scripts.

## 6) Recommended commands

```bash
python download_aemo_monthly.py --start 2025-01 --end 2026-03 --regions NSW QLD VIC SA TAS
python aggregate_aemo_monthly.py --source aemo-aggregated-data --out aemo-aggregated-data/aggregates --start 2025-01 --end 2026-03 --regions NSW QLD VIC SA TAS
```

Both scripts default to local file paths shown above, so reruns are deterministic for the same inputs and same flags.

## 7) Runbook (recommended operational flow)

Use this flow for scheduled or ad-hoc refreshes:

1. Create/prepare a clean run target
- Keep outputs in a staging folder first:
  - `python aggregate_aemo_monthly.py --source ... --out aemo-aggregated-data/aggregates-staging ...`
- Compare with previous run:
  - `Get-ChildItem aemo-aggregated-data/aggregates-staging` (or your equivalent `ls`) and check file counts.

2. Refresh raw data (optional)
- Use `download_aemo_monthly.py` when source coverage is missing or stale.
- Prefer `--overwrite` for backfilled months; otherwise the script skips existing files.

3. Run aggregation
- Use the same filters in both staging and production runs.
- If you add/remove regions, keep flags identical for fair comparisons.

4. Validate outputs before swap
- Open `manifest.json` and verify:
  - `filesProcessed` matches expected month-region combinations.
  - `monthlyCount`, `dailyCount`, `hourlyCount` are non-zero and plausible.
  - `regions` includes the expected set.
- Check quality health:
  - `quality_report.csv` should have no unexpected `issue` spikes for normal historical months.

5. Detect drift
- Compare `generatedAt`, row counts, and sample distributions between old and new aggregates.
- If only new data was added, expect:
  - same schema,
  - higher `dailyCount`/`hourlyCount`,
  - mostly stable historical summary deltas.

6. Promote staging to production
- Replace `aemo-aggregated-data/aggregates` only after validation.
- Keep staged outputs for one cycle for rollback.

## 8) Quick integrity checks

Recommended checks after each successful run:

- Confirm all expected output files exist:
  - `monthly_summary.csv`
  - `daily_summary.csv`
  - `hourly_summary.csv`
  - `quality_report.csv`
  - `manifest.json`
- Confirm file sizes are non-zero and not just headers.
- Confirm schema expected for all CSV files (`header line`).
- Review top quality issues:
  - high `malformedRows`,
  - high `estimatedMissingIntervals`,
  - `partial-month` on recent/current incomplete month files.
