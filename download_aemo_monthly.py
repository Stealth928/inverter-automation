#!/usr/bin/env python3
"""
Download AEMO aggregated price-and-demand monthly CSV files.

Source page:
https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem/aggregated-data

Files are hosted at:
https://www.aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_YYYYMM_REGION1.csv
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = "https://www.aemo.com.au/aemo/data/nem/priceanddemand/PRICE_AND_DEMAND_{period}_{region}1.csv"


def parse_month(value: str) -> tuple[int, int]:
    try:
        dt = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "Month must be in YYYY-MM format (for example 2026-01)"
        ) from exc
    return dt.year, dt.month


def month_to_period(year: int, month: int) -> str:
    return f"{year}{month:02d}"


def iter_months(start: tuple[int, int], end: tuple[int, int]):
    sy, sm = start
    ey, em = end

    cur = sy * 12 + sm
    end_key = ey * 12 + em

    while cur <= end_key:
        y, m = divmod(cur - 1, 12)
        m += 1
        yield y, m
        cur += 1


def previous_month() -> tuple[int, int]:
    now = datetime.utcnow()
    year, month = now.year, now.month
    if month == 1:
        return year - 1, 12
    return year, month - 1


def download_file(url: str, dest: Path) -> bool:
    headers = {"User-Agent": "Mozilla/5.0"}
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=60) as response:
            if response.status != 200:
                return False
            with dest.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
        return True
    except HTTPError as err:
        if err.code == 404:
            return False
        print(f"HTTP {err.code} for {url}: {err}", file=sys.stderr)
        return False
    except URLError as err:
        print(f"Network error for {url}: {err}", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Download AEMO monthly aggregated data CSV files.")
    parser.add_argument(
        "--start",
        type=parse_month,
        default=parse_month("1998-12"),
        help="Start month in YYYY-MM format.",
    )
    parser.add_argument(
        "--end",
        type=parse_month,
        default=None,
        help="End month in YYYY-MM format. Defaults to previous month.",
    )
    parser.add_argument(
        "--regions",
        nargs="+",
        default=["NSW", "QLD", "VIC", "SA", "TAS", "SNOWY"],
        help="Region codes to download (e.g. NSW QLD VIC SA TAS SNOWY).",
    )
    parser.add_argument("--out", default="aemo-aggregated-data", help="Output directory.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite files that already exist.")
    args = parser.parse_args()

    end = args.end if args.end else previous_month()
    start = args.start
    output_dir = Path(args.out)
    output_dir.mkdir(parents=True, exist_ok=True)

    for year, month in iter_months(start, end):
        period = month_to_period(year, month)
        for region in args.regions:
            region = region.upper()
            file_name = f"{region}{period}.csv"
            destination = output_dir / file_name
            if destination.exists() and not args.overwrite:
                print(f"SKIP (exists): {destination}")
                continue

            url = BASE_URL.format(period=period, region=region)
            ok = download_file(url, destination)
            if ok:
                print(f"OK: {file_name}")
            else:
                print(f"MISSING/FAILED: {url}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
