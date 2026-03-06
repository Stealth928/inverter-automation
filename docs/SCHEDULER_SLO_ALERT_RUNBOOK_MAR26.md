# Scheduler SLO Alert Runbook (March 2026)

Purpose: operational response guide for non-healthy scheduler SLO alerts (`watch` / `breach`).

## Alert Sources

- Firestore current snapshot:
  - `metrics/automationScheduler/alerts/current`
- Firestore day-level snapshots:
  - `metrics/automationScheduler/alerts/{YYYY-MM-DD}`
- Admin dashboard read model:
  - `GET /api/admin/scheduler-metrics` (`result.currentAlert`)
- Optional outbound webhook notification:
  - configured by `AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL`

## Severity Mapping

- `watch`
  - one or more metrics exceeded target but <= 2x target.
  - action: investigate within same business day.
- `breach`
  - one or more metrics exceeded > 2x target.
  - action: immediate triage.

## Monitored Metrics

- `errorRatePct`
- `deadLetterRatePct`
- `maxQueueLagMs`
- `maxCycleDurationMs`

Default thresholds:

- `errorRatePct <= 1.0`
- `deadLetterRatePct <= 0.2`
- `maxQueueLagMs <= 120000`
- `maxCycleDurationMs <= 60000`

## Runtime Configuration

Environment variable overrides:

- `AUTOMATION_SCHEDULER_SLO_ERROR_RATE_PCT`
- `AUTOMATION_SCHEDULER_SLO_DEAD_LETTER_RATE_PCT`
- `AUTOMATION_SCHEDULER_SLO_MAX_QUEUE_LAG_MS`
- `AUTOMATION_SCHEDULER_SLO_MAX_CYCLE_DURATION_MS`
- `AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL`
- `AUTOMATION_SCHEDULER_SLO_ALERT_COOLDOWN_MS` (default `300000`)

## Responder Checklist

1. Confirm alert payload
- Inspect `currentAlert` fields:
  - `status`
  - `breachedMetrics` / `watchMetrics`
  - `measurements`
  - `thresholds`
  - `schedulerId`, `runId`, `dayKey`

2. Determine blast radius
- Query latest run docs:
  - `metrics/automationScheduler/runs` (order by `startedAtMs desc`)
- Check whether failures are concentrated in:
  - one user cohort
  - one provider failure type
  - lock/idempotency contention pattern

3. Triage by metric type
- `errorRatePct` / `deadLetterRatePct` high:
  - inspect failure types (`api_timeout`, `api_rate_limit`, `firestore_contention`, etc.)
  - verify provider API health and rate-limit conditions.
- `maxQueueLagMs` high:
  - inspect scheduler overlap and invocation backlog.
  - check bounded concurrency settings.
- `maxCycleDurationMs` high:
  - inspect slow provider calls, retry loops, and per-user hot paths.

4. Mitigation options
- temporarily reduce scheduler concurrency.
- increase retry backoff for transient provider issues.
- pause non-essential automation cohorts if sustained breach persists.

5. Verification and close
- validate two consecutive healthy scheduler windows.
- confirm `alerts/current.status` returns to `healthy`.
- record incident summary in `admin_audit` or operations notes.

## Escalation

- If `breach` persists across 3 consecutive scheduler runs:
  - escalate to backend orchestration owner.
- If provider-specific outage confirmed:
  - declare external dependency incident and apply provider mitigation policy.
