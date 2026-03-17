# Background Automation System

Purpose: document how automation runs when users are online and when they are
not, and explain the current scheduler orchestration that ships in code.

Last updated: 2026-03-17

## Overview

The product has two ways to trigger the same automation evaluation path:

1. Dashboard-triggered cycle execution via `POST /api/automation/cycle`
2. Background scheduler execution via the `runAutomation` Cloud Function

Both paths converge on the same core automation cycle logic. The frontend timer
exists for a responsive UX while the authenticated app is open, but background
execution is handled by the server-side scheduler and does not depend on the
browser staying open.

## Runtime Topology

```text
Authenticated dashboard open?
  yes -> client countdown can call POST /api/automation/cycle
  no  -> runAutomation scheduler handles background cadence

runAutomation (Cloud Functions v2 scheduler, every 1 minute, UTC)
  -> runAutomationSchedulerCycle(...)
  -> fetch eligible users
  -> apply concurrency, lock, and idempotency controls
  -> invoke shared automation cycle handler for each user that is due
  -> persist scheduler metrics, alert state, and dead-letter records
```

## Cloud Function Exports

- `exports.api = functions.https.onRequest(app)`
- `exports.runAutomation = onSchedule({ schedule: 'every 1 minutes', timeZone: 'UTC', ... })`

The scheduler export lives in [functions/index.js](../functions/index.js) and is
wired to `runAutomationSchedulerCycle(...)` in
[functions/lib/services/automation-scheduler-service.js](../functions/lib/services/automation-scheduler-service.js).

## Scheduler Cadence Model

The scheduler itself runs every minute, but user automation does not necessarily
run every minute.

Per user, the backend checks:

- automation enabled state
- blackout-window eligibility
- elapsed time since `automation/state.lastCheck`
- configured interval override in `users/{uid}/config/main`

Current defaults:

- scheduler tick: 1 minute
- default automation interval: 60000 ms
- default cache TTLs:
  - Amber: 60000 ms
  - inverter telemetry: 300000 ms
  - weather: 1800000 ms
  - Tesla status cache: 600000 ms

User-configurable automation interval is still respected even though the
scheduler wakes every minute.

## What Happens in a Background Run

For each scheduler tick:

1. Fetch eligible users and current automation/config state.
2. Determine whether each user is due for a cycle.
3. Acquire a short-lived per-user lock.
4. Create or verify an idempotency marker for the cycle key.
5. Invoke the same automation cycle handler used by
   `POST /api/automation/cycle`.
6. Persist scheduler metrics, phase timings, status, and alert snapshots.
7. Release the lock and record dead-letter data on repeated failure.

The cycle handler then performs the usual work:

1. read current config and rules
2. honor blackout windows and quick-control pauses
3. fetch cached or live pricing, weather, and provider telemetry
4. evaluate rules by priority
5. apply provider-aware actions through the adapter registry
6. run curtailment evaluation where enabled
7. write automation history, audit, and state updates

## Concurrency, Retries, and Idempotency

The background scheduler now includes orchestration controls that were not part
of the earlier single-loop implementation.

### Concurrency

Users are processed with bounded concurrency. Current server-side defaults are:

- `maxConcurrentUsers`: 10
- `retryAttempts`: 2
- `retryBaseDelayMs`: 500
- `retryJitterMs`: 250
- `lockLeaseMs`: 120000
- `idempotencyTtlMs`: 300000
- `deadLetterTtlMs`: 604800000

These can be overridden via server config or environment variables:

- `AUTOMATION_SCHEDULER_MAX_CONCURRENCY`
- `AUTOMATION_SCHEDULER_RETRY_ATTEMPTS`
- `AUTOMATION_SCHEDULER_RETRY_BASE_DELAY_MS`
- `AUTOMATION_SCHEDULER_RETRY_JITTER_MS`
- `AUTOMATION_SCHEDULER_LOCK_LEASE_MS`
- `AUTOMATION_SCHEDULER_IDEMPOTENCY_TTL_MS`
- `AUTOMATION_SCHEDULER_DEAD_LETTER_TTL_MS`

### Per-user Locking

Each user gets a scheduler lock document under:

- `users/{uid}/automation/lock`

This prevents overlapping scheduler workers from trying to apply actions for the
same user at the same time.

### Idempotency

Each attempted cycle writes an idempotency marker under:

- `users/{uid}/automation/idempotency_<cycleKey>`

This prevents duplicate execution when the same cycle key is retried or two
workers race on the same user.

### Dead Letters

Repeated scheduler failures are retained long enough for operational follow-up.
Dead-letter metrics are included in the scheduler admin view and SLO alerting.

## Metrics and Alerting

Scheduler metrics are persisted for operational visibility.

Firestore paths:

- `metrics/automationScheduler/runs/{runId}`
- `metrics/automationScheduler/daily/{YYYY-MM-DD}`
- `metrics/automationScheduler/alerts/current`
- `metrics/automationScheduler/alerts/{YYYY-MM-DD}`

The admin dashboard and `/api/admin/scheduler-metrics` read from these docs.

SLO thresholds are configurable with environment variables such as:

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

Operational response guidance is documented in
[SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md](SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md).

## Frontend Interaction

The dashboard still reads config and automation status so it can show:

- countdown to the next expected cycle
- active automation state
- quick-control pause effects
- recent history and telemetry

Important distinction:

- frontend countdown is a UX convenience
- background automation authority is the server-side scheduler

If the browser is closed, automation continues through `runAutomation`.

## Cache Behavior

Automation reuses cached provider data wherever allowed to control cost and API
pressure.

Current defaults from server config:

| Data source | Default TTL |
| --- | --- |
| Amber pricing | 60 seconds |
| Inverter/device telemetry | 5 minutes |
| Weather | 30 minutes |
| Tesla status | 10 minutes |

Provider-specific UI paths may still request fresh data when the user explicitly
asks for a live refresh.

## Manual and Background Triggers Compared

| Trigger | Who starts it | Main use |
| --- | --- | --- |
| `POST /api/automation/cycle` | user/frontend/backend tools | immediate evaluation, testing, UX responsiveness |
| `runAutomation` | Cloud Scheduler | unattended background execution for all users |

The rule engine, provider adapters, and automation state model are shared.

## Troubleshooting Checklist

### Automation seems idle

Check:

1. user automation is enabled
2. `lastCheck` is advancing
3. blackout windows are not active
4. quick control is not still overriding the cycle
5. scheduler metrics show successful recent runs

### Scheduler is running but users are skipped

Common reasons:

- user interval has not elapsed yet
- lock already held by another worker
- idempotency marker already exists for the cycle
- automation disabled
- blackout window active

### Elevated scheduler errors or lag

Use:

- admin dashboard scheduler metrics
- `/api/admin/scheduler-metrics`
- [SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md](SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md)

### Validation commands

```bash
npm --prefix functions run lint
npm --prefix functions test -- --runInBand
node scripts/pre-deploy-check.js
firebase functions:log --only runAutomation
```