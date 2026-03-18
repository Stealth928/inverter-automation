#!/usr/bin/env python3
"""Download AEMO Price and Demand CSVs for a given year.

Run this script on a machine with internet access.

Usage:
    python download_aemo_price_and_demand.py

Files are downloaded to ~/Downloads/aemo_price_and_demand_<year>/YYYYMM/PRICE_AND_DEMAND_<YYYYMM>_<REGION>.csv
"""

from pathlib import Path
from urllib.request import urlretrieve
from urllib.error import HTTPError, URLError


def main():
    year = 2026
    regions = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"]
    base_url = "https://www.aemo.com.au/aemo/data/nem/priceanddemand"

    download_root = Path.home() / "Downloads" / f"aemo_price_and_demand_{year}"
    download_root.mkdir(parents=True, exist_ok=True)

    for month in range(1, 13):
        yyyymm = f"{year}{month:02d}"
        month_dir = download_root / yyyymm
        month_dir.mkdir(parents=True, exist_ok=True)

        for region in regions:
            filename = f"PRICE_AND_DEMAND_{yyyymm}_{region}.csv"
            url = f"{base_url}/{filename}"
            destination = month_dir / filename

            try:
                print(f"Downloading {filename} ...")
                urlretrieve(url, destination)
            except HTTPError as e:
                print(f"HTTP error for {filename}: {e.code}")
            except URLError as e:
                print(f"URL error for {filename}: {e.reason}")
            except Exception as e:
                print(f"Failed for {filename}: {e}")

    print(f"Done. Files are in: {download_root}")


if __name__ == "__main__":
    main()
