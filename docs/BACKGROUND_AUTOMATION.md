# Background Automation and Scheduled Jobs

Last updated: 2026-03-26

Purpose: document the scheduled backend jobs that run without the browser being
open and explain how the current orchestration behaves in production.

## Overview

The repo currently ships two scheduled Cloud Functions:

1. `runAutomation`
2. `refreshAemoLiveSnapshots`

The authenticated app can also invoke `POST /api/automation/cycle` for an
immediate rule evaluation, but unattended automation does not depend on the
browser staying open.

## Cloud Function Exports

| Export | Schedule | Time zone | Purpose |
| --- | --- | --- | --- |
| `api` | HTTP | n/a | Express API behind Hosting rewrite |
| `runAutomation` | `every 1 minutes` | `UTC` | Per-user automation orchestration |
| `refreshAemoLiveSnapshots` | `1-59/5 * * * *` | `Australia/Brisbane` | Refresh Firestore-backed current AEMO regional snapshots |

## Runtime Topology

```text
Authenticated dashboard open?
  yes -> UI can call POST /api/automation/cycle for fast feedback
  no  -> runAutomation keeps unattended automation alive

runAutomation
  -> fetch eligible users
  -> apply due-check logic
  -> acquire per-user lock
  -> write idempotency marker
  -> invoke the same automation cycle handler used by POST /api/automation/cycle
  -> persist metrics, alert state, and dead-letter data

refreshAemoLiveSnapshots
  -> refresh current AEMO price snapshots for supported regions
  -> write aemoSnapshots/{region}
  -> feed admin/DataWorks health views and AEMO-backed pricing paths
```

## `runAutomation` Details

### Cadence model

The scheduler wakes every minute, but each user may run less frequently.

Per-user due checks currently consider:

- automation enabled state
- blackout-window eligibility
- elapsed time since the last check
- user-specific interval override in config

Current defaults:

- scheduler tick: 1 minute
- default automation interval: 60000 ms
- default Amber cache TTL: 60000 ms
- default inverter cache TTL: 300000 ms
- default weather cache TTL: 1800000 ms
- default Tesla status cache TTL: 600000 ms

### Shared cycle handler

Both manual and scheduled automation converge on the same cycle handler.

That shared path:

1. loads config, state, and enabled rules
2. resolves timezone and blackout-window status
3. cleans up expired quick control
4. fetches cached or live pricing, weather, inverter, and EV data
5. evaluates rules in priority order
6. applies the winning rule action when one triggers
7. evaluates curtailment
8. writes history, audit, and updated state

### Concurrency, retries, and idempotency

Current scheduler controls include:

- bounded concurrency
- per-user lock lease
- idempotency markers by cycle key
- retry attempts with jittered delay
- dead-letter retention for repeated failures

Relevant env vars:

- `AUTOMATION_SCHEDULER_MAX_CONCURRENCY`
- `AUTOMATION_SCHEDULER_RETRY_ATTEMPTS`
- `AUTOMATION_SCHEDULER_RETRY_BASE_DELAY_MS`
- `AUTOMATION_SCHEDULER_RETRY_JITTER_MS`
- `AUTOMATION_SCHEDULER_LOCK_LEASE_MS`
- `AUTOMATION_SCHEDULER_IDEMPOTENCY_TTL_MS`
- `AUTOMATION_SCHEDULER_DEAD_LETTER_TTL_MS`

Important Firestore paths:

- `users/{uid}/automation/lock`
- `users/{uid}/automation/idempotency_<cycleKey>`
- `users/{uid}/automation_dead_letters/{docId}`

### Metrics and alerts

Scheduler metrics are persisted under:

- `metrics/automationScheduler/runs/{runId}`
- `metrics/automationScheduler/daily/{YYYY-MM-DD}`
- `metrics/automationScheduler/alerts/current`
- `metrics/automationScheduler/alerts/{YYYY-MM-DD}`

Operator surfaces:

- `GET /api/admin/scheduler-metrics`
- admin dashboard scheduler views

Relevant SLO env vars include:

- `AUTOMATION_SCHEDULER_SLO_ERROR_RATE_PCT`
- `AUTOMATION_SCHEDULER_SLO_DEAD_LETTER_RATE_PCT`
- `AUTOMATION_SCHEDULER_SLO_MAX_QUEUE_LAG_MS`
- `AUTOMATION_SCHEDULER_SLO_MAX_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_P99_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_TAIL_P99_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_TAIL_WINDOW_MINUTES`
- `AUTOMATION_SCHEDULER_SLO_TAIL_MIN_RUNS`
- `AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL`
- `AUTOMATION_SCHEDULER_SLO_ALERT_COOLDOWN_MS`

## `refreshAemoLiveSnapshots` Details

This job refreshes current AEMO regional snapshots on a 5-minute cadence.

Current behavior:

- runs in `Australia/Brisbane`
- calls the AEMO adapter refresh path for all supported regions
- writes or updates `aemoSnapshots/{region}`
- logs updated, skipped, and failed regions
- throws when one or more regional refreshes fail

This job supports:

- AEMO-backed pricing flows
- admin API health and DataWorks status views
- current snapshot inspection in Firestore

Related admin routes:

- `GET /api/admin/api-health`
- `GET /api/admin/dataworks/ops`
- `POST /api/admin/dataworks/dispatch`

## Frontend Interaction

The browser still shows countdowns and current automation state, but that is a
UX layer, not the automation authority.

Important distinction:

- browser-triggered cycle calls are convenience and immediate feedback
- background automation authority is the server-side scheduler

If the browser is closed, `runAutomation` still evaluates due users.

## Troubleshooting Checklist

### Automation seems idle

Check:

1. automation is enabled for the user
2. `lastCheck` is advancing
3. blackout windows are not active
4. quick control is not still active
5. scheduler metrics show recent successful runs

### Scheduler is running but users are skipped

Common reasons:

- user interval has not elapsed
- lock is already held
- idempotency marker already exists for the cycle key
- automation is disabled
- blackout window is active

### AEMO snapshot health looks stale

Check:

1. `refreshAemoLiveSnapshots` logs
2. Firestore docs in `aemoSnapshots/{region}`
3. admin DataWorks/API health views
4. whether stale regions are isolated or all-region failures

## Validation Commands

```bash
npm --prefix functions run lint
npm --prefix functions test -- --runInBand
node scripts/pre-deploy-check.js
firebase functions:log --only runAutomation
firebase functions:log --only refreshAemoLiveSnapshots
```
