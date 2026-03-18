#!/usr/bin/env python3
"""
Aggregate local AEMO monthly CSV files:
- monthly summaries
- daily summaries
- hourly summaries
- quality report
"""

from __future__ import annotations

import argparse
import csv
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean, pstdev

TIME_FORMAT = "%Y/%m/%d %H:%M:%S"
FILE_RE = re.compile(r"^(?P<region>[A-Z]+)(?P<period>\d{6})\.csv$")
OFF_PEAK_HOURS = set(range(0, 7)) | set(range(22, 24))
SPIKE_THRESHOLD = 300.0


def parse_month(value: str) -> tuple[int, int]:
    dt = datetime.strptime(value, "%Y-%m")
    return dt.year, dt.month


def month_key_to_period(year: int, month: int) -> str:
    return f"{year}{month:02d}"


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    if q <= 0.0:
        return values[0]
    if q >= 1.0:
        return values[-1]
    position = q * (len(values) - 1)
    left = int(position)
    right = left + 1
    if right >= len(values):
        return values[left]
    weight = position - left
    return values[left] * (1 - weight) + values[right] * weight


def series_stats(values: list[float], include_quantiles: bool = True) -> dict:
    if not values:
        return {
            "count": 0,
            "min": None,
            "max": None,
            "mean": None,
            "p05": None,
            "p25": None,
            "p50": None,
            "p75": None,
            "p90": None,
            "p95": None,
            "p99": None,
        }

    values = sorted(values)
    return {
        "count": len(values),
        "min": values[0],
        "max": values[-1],
        "mean": mean(values),
        "p05": percentile(values, 0.05) if include_quantiles else None,
        "p25": percentile(values, 0.25) if include_quantiles else None,
        "p50": percentile(values, 0.50) if include_quantiles else None,
        "p75": percentile(values, 0.75) if include_quantiles else None,
        "p90": percentile(values, 0.90) if include_quantiles else None,
        "p95": percentile(values, 0.95) if include_quantiles else None,
        "p99": percentile(values, 0.99) if include_quantiles else None,
    }


def interval_mode(intervals: list[float]) -> int | None:
    if not intervals:
        return None
    rounded = [round(v) for v in intervals if v > 0]
    if not rounded:
        return None
    counts = Counter(rounded)
    max_count = max(counts.values())
    candidates = [v for v, c in counts.items() if c == max_count]
    return min(candidates)


def streak_metrics(values: list[float], threshold: float | None) -> tuple[int, int]:
    if threshold is None or not values:
        return 0, 0

    max_run = 0
    run_count = 0
    in_run = 0

    for value in values:
        if value >= threshold:
            if in_run == 0:
                run_count += 1
            in_run += 1
            max_run = max(max_run, in_run)
        else:
            in_run = 0

    return run_count, max_run


def next_month_start(year: int, month: int) -> datetime:
    if month == 12:
        return datetime(year + 1, 1, 1)
    return datetime(year, month + 1, 1)


def month_range(row_period: str) -> tuple[datetime, datetime]:
    year = int(row_period[:4])
    month = int(row_period[4:])
    start = datetime(year, month, 1)
    return start, next_month_start(year, month)


def expected_full_rows(period: str, interval: int) -> int:
    if interval <= 0:
        return 0
    start, end = month_range(period)
    total_days = (end - start).days
    return total_days * (1440 // interval)


def parse_record_time(value: str) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value.strip(), TIME_FORMAT)


def aggregate_file(path: Path) -> tuple[dict | None, list[dict], list[dict], dict] | None:
    m = FILE_RE.match(path.name)
    if not m:
        return None

    region = m.group("region")
    period = m.group("period")
    rows = []
    malformed_rows = 0

    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts_raw = row.get("SETTLEMENTDATE", "").strip()
            rrp_raw = row.get("RRP", "").strip()
            demand_raw = row.get("TOTALDEMAND", "").strip()

            ts = parse_record_time(ts_raw)
            rrp = parse_float(rrp_raw)
            demand = parse_float(demand_raw)

            if ts is None or rrp is None or demand is None:
                malformed_rows += 1
                continue
            rows.append((ts, rrp, demand))

    if not rows:
        return {
            "region": region,
            "period": period,
            "file": path.name,
            "status": "empty-or-malformed",
            "rowCount": 0,
            "malformedRows": malformed_rows,
        }, [], [], {"file": path.name, "region": region, "period": period, "issue": "no-valid-rows"}

    rows.sort(key=lambda x: x[0])
    timestamps = [r[0] for r in rows]
    rrps = [r[1] for r in rows]
    demands = [r[2] for r in rows]

    intervals = [
        (timestamps[i + 1] - timestamps[i]).total_seconds() / 60.0
        for i in range(len(timestamps) - 1)
    ]
    mode_interval = interval_mode(intervals)
    if mode_interval is None:
        mode_interval = 0

    interval_anomalies = 0
    duplicate_intervals = 0
    estimated_missing = 0

    if mode_interval > 0:
        for d in intervals:
            if d <= 0:
                interval_anomalies += 1
                continue
            ratio = round(d / mode_interval)
            if ratio <= 0:
                interval_anomalies += 1
                continue
            if abs(d - ratio * mode_interval) > 1e-9:
                interval_anomalies += 1
                continue
            if ratio > 1:
                estimated_missing += ratio - 1
            if ratio == 0:
                duplicate_intervals += 1

    month_start, month_end = month_range(period)
    first_ts = timestamps[0]
    last_ts = timestamps[-1]
    observed_rows = len(rows)

    full_expected_rows = expected_full_rows(period, mode_interval) if mode_interval > 0 else 0
    span_minutes = max((last_ts - first_ts).total_seconds() / 60.0, 0.0)
    expected_span_rows = int(span_minutes // mode_interval + 1) if mode_interval > 0 else 0
    is_partial = last_ts < (month_end - timedelta(minutes=mode_interval)) if mode_interval > 0 else True
    full_coverage = observed_rows / full_expected_rows if full_expected_rows else 0.0

    first_step = intervals[0] if intervals else 0.0
    issues = []
    if mode_interval not in (5, 30) and mode_interval != 0:
        issues.append("nonstandard-interval")
    if interval_anomalies:
        issues.append("interval-anomalies")
    if malformed_rows:
        issues.append("malformed-rows")
    if observed_rows == 0:
        issues.append("empty")
    if is_partial:
        issues.append("partial-month")
    if full_expected_rows and observed_rows < full_expected_rows:
        issues.append("incomplete-month")

    rrp_stats = series_stats(rrps)
    demand_stats = series_stats(demands)
    high_events, longest_high_run = streak_metrics(rrps, SPIKE_THRESHOLD)

    daily_stats: list[dict] = []
    daily_buckets: dict[str, list[float]] = defaultdict(list)
    daily_demand: dict[str, list[float]] = defaultdict(list)
    daily_timestamps: dict[str, list[datetime]] = defaultdict(list)

    hourly_stats: list[dict] = []
    hourly_buckets: dict[str, list[float]] = defaultdict(list)
    hourly_demand: dict[str, list[float]] = defaultdict(list)
    daily_hourly_profiles: dict[str, list[tuple[int, float]]] = defaultdict(list)

    for ts, rrp, demand in rows:
        daily_key = ts.strftime("%Y-%m-%d")
        daily_buckets[daily_key].append(rrp)
        daily_demand[daily_key].append(demand)
        daily_timestamps[daily_key].append(ts)

        hour_key = ts.strftime("%Y-%m-%d %H")
        hourly_buckets[hour_key].append(rrp)
        hourly_demand[hour_key].append(demand)

    for hour, values in sorted(hourly_buckets.items()):
        h_stats = series_stats(values)
        hd_stats = series_stats(hourly_demand[hour])
        if h_stats["count"]:
            hour_day, hour_label = hour.split(" ")
            hour_idx = int(hour_label)
            hour_mean = h_stats["mean"]
            hourly_stats.append(
                {
                    "region": region,
                    "period": period,
                    "hour": hour,
                    "rowCount": h_stats["count"],
                    "meanRRP": h_stats["mean"],
                    "minRRP": h_stats["min"],
                    "maxRRP": h_stats["max"],
                    "p50RRP": h_stats["p50"],
                    "p90RRP": h_stats["p90"],
                    "p95RRP": h_stats["p95"],
                    "meanDemand": hd_stats["mean"],
                    "minDemand": hd_stats["min"],
                    "maxDemand": hd_stats["max"],
                }
            )
            if hour_mean is not None:
                daily_hourly_profiles[hour_day].append((hour_idx, hour_mean))

    for day, values in sorted(daily_buckets.items()):
        d_stats = series_stats(values)
        dd_stats = series_stats(daily_demand[day])
        if d_stats["count"]:
            hour_profiles = sorted(daily_hourly_profiles[day], key=lambda item: item[0])
            hour_count = len(hour_profiles)
            if hour_profiles:
                peak_hour_idx, peak_hour_rrp = max(hour_profiles, key=lambda item: item[1])
                peak_hour = f"{peak_hour_idx:02d}"
                off_peak_values = [value for hour_idx, value in hour_profiles if hour_idx in OFF_PEAK_HOURS]
                off_peak_rrp = mean(off_peak_values) if off_peak_values else None
                hours_above_p95 = sum(
                    1
                    for _, value in hour_profiles
                    if d_stats["p95"] is not None and value >= d_stats["p95"]
                )
            else:
                peak_hour = None
                peak_hour_rrp = None
                off_peak_rrp = None
                hours_above_p95 = 0

            expected_daily_rows = 24 * (1440 // mode_interval) if mode_interval > 0 else 0
            observed_daily_rows = d_stats["count"]
            missing_daily_rows = max(expected_daily_rows - observed_daily_rows, 0) if expected_daily_rows else 0
            coverage_pct = (observed_daily_rows / expected_daily_rows * 100.0) if expected_daily_rows else None
            std_rrp = pstdev(values) if len(values) > 1 else 0.0
            volatility_rrp = d_stats["max"] - d_stats["min"] if d_stats["count"] else None

            daily_stats.append(
                {
                    "region": region,
                    "period": period,
                    "date": day,
                    "rowCount": d_stats["count"],
                    "meanRRP": d_stats["mean"],
                    "minRRP": d_stats["min"],
                    "maxRRP": d_stats["max"],
                    "p05RRP": d_stats["p05"],
                    "p25RRP": d_stats["p25"],
                    "p50RRP": d_stats["p50"],
                    "p75RRP": d_stats["p75"],
                    "p90RRP": d_stats["p90"],
                    "p95RRP": d_stats["p95"],
                    "meanDemand": dd_stats["mean"],
                    "minDemand": dd_stats["min"],
                    "maxDemand": dd_stats["max"],
                    "negativeRRPCount": sum(1 for v in values if v < 0.0),
                    "stdRRP": std_rrp,
                    "volatilityRRP": volatility_rrp,
                    "expectedRowCount": expected_daily_rows,
                    "missingRowCount": missing_daily_rows,
                    "coveragePct": coverage_pct,
                    "qualityScore": coverage_pct,
                    "hourCount": hour_count,
                    "hourCoveragePct": (hour_count / 24.0) * 100.0 if hour_count else 0.0,
                    "peakHour": peak_hour,
                    "peakHourRRP": peak_hour_rrp,
                    "offPeakMeanRRP": off_peak_rrp,
                    "hoursAboveP95": hours_above_p95,
                }
            )

    monthly_summary = {
        "region": region,
        "period": period,
        "file": path.name,
        "firstTimestamp": first_ts.strftime(TIME_FORMAT),
        "lastTimestamp": last_ts.strftime(TIME_FORMAT),
        "rows": observed_rows,
        "malformedRows": malformed_rows,
        "intervalModeMinutes": mode_interval,
        "firstIntervalMinutes": first_step,
        "expectedFullRows": full_expected_rows,
        "expectedSpanRows": expected_span_rows,
        "coverageFullPct": (full_coverage * 100.0) if full_expected_rows else None,
        "coverageSpanPct": (observed_rows / expected_span_rows * 100.0) if expected_span_rows else None,
        "estimatedMissingIntervals": estimated_missing,
        "intervalAnomalies": interval_anomalies,
        "duplicateIntervals": duplicate_intervals,
        "isPartialMonth": is_partial,
        "status": "ok" if not issues else ";".join(sorted(set(issues))),
        "meanRRP": rrp_stats["mean"],
        "minRRP": rrp_stats["min"],
        "maxRRP": rrp_stats["max"],
        "p05RRP": rrp_stats["p05"],
        "p25RRP": rrp_stats["p25"],
        "p50RRP": rrp_stats["p50"],
        "p75RRP": rrp_stats["p75"],
        "p90RRP": rrp_stats["p90"],
        "p95RRP": rrp_stats["p95"],
        "p99RRP": rrp_stats["p99"],
        "meanDemand": demand_stats["mean"],
        "minDemand": demand_stats["min"],
        "maxDemand": demand_stats["max"],
        "demandP95": demand_stats["p95"],
        "negativeRRPCount": sum(1 for r in rrps if r <= 0.0),
        "highRRPThreshold": SPIKE_THRESHOLD,
        "highRRPIntervalCount": sum(1 for r in rrps if r >= SPIKE_THRESHOLD),
        "highRRPEventCount": high_events,
        "longestHighRRPEventIntervals": longest_high_run,
        "longestHighRRPEventMinutes": longest_high_run * mode_interval if mode_interval > 0 else 0,
    }

    quality = {
        "file": path.name,
        "region": region,
        "period": period,
        "rows": observed_rows,
        "issue": ";".join(sorted(set(issues))) if issues else "none",
        "estimatedMissingIntervals": estimated_missing,
        "intervalAnomalies": interval_anomalies,
        "malformedRows": malformed_rows,
    }

    return monthly_summary, daily_stats, hourly_stats, quality


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    if not rows:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            normalized = {}
            for key in fieldnames:
                value = row.get(key)
                if isinstance(value, float):
                    if math.isinf(value) or math.isnan(value):
                        value = None
                    else:
                        value = round(value, 6)
                normalized[key] = value
            writer.writerow(normalized)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Aggregate AEMO monthly price-and-demand data files.")
    parser.add_argument("--source", default="aemo-aggregated-data", help="Folder containing raw monthly CSV files.")
    parser.add_argument("--out", default="aemo-aggregated-data/aggregates", help="Output directory for aggregates.")
    parser.add_argument(
        "--start",
        type=parse_month,
        default=None,
        help="Optional earliest month in YYYY-MM format.",
    )
    parser.add_argument(
        "--end",
        type=parse_month,
        default=None,
        help="Optional latest month in YYYY-MM format.",
    )
    parser.add_argument(
        "--regions",
        nargs="*",
        default=None,
        help="Optional region filter (e.g. NSW QLD VIC SA TAS).",
    )
    return parser


def in_range(period: str, start: tuple[int, int] | None, end: tuple[int, int] | None) -> bool:
    year = int(period[:4])
    month = int(period[4:])
    key = year * 12 + month
    if start is not None:
        sy, sm = start
        if key < sy * 12 + sm:
            return False
    if end is not None:
        ey, em = end
        if key > ey * 12 + em:
            return False
    return True


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"source folder not found: {source}")
        return 1

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    files = sorted(source.glob("*.csv"), key=lambda p: p.name)
    if args.regions:
        regions = {r.upper() for r in args.regions}
    else:
        regions = None

    monthly_rows: list[dict] = []
    daily_rows: list[dict] = []
    hourly_rows: list[dict] = []
    quality_rows: list[dict] = []

    processed = 0
    for file in files:
        match = FILE_RE.match(file.name)
        if not match:
            continue
        region = match.group("region")
        period = match.group("period")

        if regions and region not in regions:
            continue
        if not in_range(period, args.start, args.end):
            continue

        result = aggregate_file(file)
        if result is None:
            continue
        monthly, daily, hourly, quality = result
        if monthly:
            monthly_rows.append(monthly)
        daily_rows.extend(daily)
        hourly_rows.extend(hourly)
        quality_rows.append(quality)
        processed += 1

    if not processed:
        print("No files were processed.")
        return 1

    write_csv(
        out / "monthly_summary.csv",
        monthly_rows,
        [
            "region",
            "period",
            "file",
            "firstTimestamp",
            "lastTimestamp",
            "rows",
            "malformedRows",
            "intervalModeMinutes",
            "firstIntervalMinutes",
            "expectedFullRows",
            "expectedSpanRows",
            "coverageFullPct",
            "coverageSpanPct",
            "estimatedMissingIntervals",
            "intervalAnomalies",
            "duplicateIntervals",
            "isPartialMonth",
            "status",
            "meanRRP",
            "minRRP",
            "maxRRP",
            "p05RRP",
            "p25RRP",
            "p50RRP",
            "p75RRP",
            "p90RRP",
            "p95RRP",
            "p99RRP",
            "meanDemand",
            "minDemand",
            "maxDemand",
            "demandP95",
            "negativeRRPCount",
            "highRRPIntervalCount",
            "highRRPEventCount",
            "longestHighRRPEventIntervals",
            "longestHighRRPEventMinutes",
        ],
    )
    write_csv(
        out / "daily_summary.csv",
        daily_rows,
        [
            "region",
            "period",
            "date",
            "rowCount",
            "meanRRP",
            "minRRP",
            "maxRRP",
            "p05RRP",
            "p25RRP",
            "p50RRP",
            "p75RRP",
            "p90RRP",
            "p95RRP",
            "meanDemand",
            "minDemand",
            "maxDemand",
            "negativeRRPCount",
            "stdRRP",
            "volatilityRRP",
            "expectedRowCount",
            "missingRowCount",
            "coveragePct",
            "qualityScore",
            "hourCount",
            "hourCoveragePct",
            "peakHour",
            "peakHourRRP",
            "offPeakMeanRRP",
            "hoursAboveP95",
        ],
    )
    write_csv(
        out / "hourly_summary.csv",
        hourly_rows,
        [
            "region",
            "period",
            "hour",
            "rowCount",
            "meanRRP",
            "minRRP",
            "maxRRP",
            "p50RRP",
            "p90RRP",
            "p95RRP",
            "meanDemand",
            "minDemand",
            "maxDemand",
        ],
    )
    write_csv(
        out / "quality_report.csv",
        quality_rows,
        [
            "file",
            "region",
            "period",
            "rows",
            "issue",
            "estimatedMissingIntervals",
            "intervalAnomalies",
            "malformedRows",
        ],
    )

    manifest = {
        "generatedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "sourceDir": str(source.resolve()),
        "filesProcessed": processed,
        "outDir": str(out.resolve()),
        "monthlyCount": len(monthly_rows),
        "dailyCount": len(daily_rows),
        "hourlyCount": len(hourly_rows),
        "start": f"{args.start[0]}-{args.start[1]:02d}" if args.start else None,
        "end": f"{args.end[0]}-{args.end[1]:02d}" if args.end else None,
        "regions": sorted(set(row["region"] for row in monthly_rows)),
    }
    with (out / "manifest.json").open("w", encoding="utf-8") as f:
        import json

        json.dump(manifest, f, indent=2)

    print(f"Aggregates written to: {out}")
    print(f"Monthly rows: {len(monthly_rows)}, daily rows: {len(daily_rows)}, hourly rows: {len(hourly_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
