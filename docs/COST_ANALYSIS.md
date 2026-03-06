# Cost Analysis

Last Updated: 2026-03-06
Purpose: Canonical cost model and monitoring guidance for Firebase + external API usage.

## Scope
This document replaces older overlapping cost analyses and keeps only the assumptions that still match the current architecture.

## Primary Cost Drivers
- Firestore read/write volume from automation cycles and dashboard/API usage.
- Cloud Functions invocation + compute time (automation scheduler + API endpoints).
- Cloud Logging ingestion from verbose runtime logs.
- External API calls (Amber/FoxESS/Weather) amplified by cache misses.

## Current Architecture Notes
- Automation runs via scheduled background cycle.
- Caching and in-flight de-duplication are the first-order cost controls.
- Per-user state/rule/config accesses should use shared repository/service boundaries to avoid duplicate reads.
- API call counters and metrics endpoints provide operational visibility.

## How To Measure Real Cost (Preferred Over Static Estimates)
1. Use billing export/console for actual monthly spend by service.
2. Use backend metrics endpoints and logs to correlate spend with:
   - automation cycle volume
   - cache hit/miss rates
   - endpoint call distribution
3. Review Cloud Logging ingestion volume monthly.

## Guardrails
- Do not rely on stale point-in-time user-scale projections as source of truth.
- Treat fixed dollar estimates as planning hints only.
- Recalculate after major cache/scheduler/route changes.

## Practical Optimization Priorities
1. Keep cache TTLs tuned by endpoint volatility.
2. Prefer shared dedup/in-flight request wrappers for high-frequency resources.
3. Remove or gate verbose logs behind DEBUG/VERBOSE flags.
4. Monitor route-level hotspots before changing infra.

## Update Cadence
- Refresh this doc after major architecture/caching/scheduler changes.
- Include concrete month + environment when adding numeric estimates.
