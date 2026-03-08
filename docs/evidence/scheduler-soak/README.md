# Scheduler Soak Evidence Artifacts

This folder stores date-stamped evidence snapshots used to finalize `P3/G3` closeout.

## Capture Commands

URL mode (recommended for production evidence):

```bash
SCHEDULER_METRICS_URL="https://<host>/api/admin/scheduler-metrics" \
SCHEDULER_METRICS_BEARER_TOKEN="<admin-token>" \
npm run scheduler:soak:capture -- --days 14 --run-limit 20 --label prod
```

File mode (for offline replay or debug):

```bash
npm run scheduler:soak:capture -- --input ./path/to/scheduler-metrics.json --label offline
```

Fail command if readiness criteria are not met:

```bash
npm run scheduler:soak:capture -- --url "https://<host>/api/admin/scheduler-metrics" --token "<admin-token>" --require-ready
```

## Outputs

Each run writes:

- `scheduler-soak-<timestamp>.json`: normalized snapshot payload
- `scheduler-soak-<timestamp>.md`: human-readable evidence digest
- `INDEX.md`: append-only index of all captures in this folder

## Status Check Commands

Check latest evidence readiness summary:

```bash
npm run scheduler:soak:status
```

Fail when latest artifact is missing or not ready:

```bash
npm run scheduler:soak:ready
```

## Readiness Rule

Capture is considered closeout-ready when `soak.readiness.readyForCloseout=true`, which requires:

- minimum data-window requirement met
- no breach days in window
- latest day status is healthy
- healthy ratio threshold satisfied
