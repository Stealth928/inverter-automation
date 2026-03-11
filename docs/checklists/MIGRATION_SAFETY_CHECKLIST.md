# Migration Safety Checklist

- Status: Active template
- Owner: Platform engineering
- Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Sprint 1 item 18)

## 1. Pre-Migration Readiness

- [ ] Scope and user cohort are documented.
- [ ] Source and target schema paths are documented.
- [ ] Rollback plan exists and is reviewed.
- [ ] Feature flags exist for new read/write paths.
- [ ] Dry-run completed in local/staging with representative data.
- [ ] Monitoring and alert queries are ready (errors, fallback rate, latency).
- [ ] Approval recorded from architecture + operations owners.

## 2. Data Safety Controls

- [ ] Snapshot/export completed for impacted data.
- [ ] Idempotency key strategy is defined for migration jobs.
- [ ] Batch size and concurrency limits are defined.
- [ ] Retry policy is defined (bounded retries only).
- [ ] Stop criteria are defined (for example: error rate threshold).

## 3. Execution Controls

- [ ] Migration started with canary cohort.
- [ ] Per-batch metrics captured:
  - [ ] attempted
  - [ ] migrated
  - [ ] failed
  - [ ] skipped
- [ ] Fallback read rate measured during dual-read window.
- [ ] No high-severity production alerts triggered.

## 4. Verification

- [ ] Contract checks pass (`api-contract-baseline`).
- [ ] Critical backend tests pass.
- [ ] Smoke tests pass for dashboard/config/automation flows.
- [ ] Data parity spot-check completed between legacy and v2 records.

## 5. Post-Migration

- [ ] Migration report written and attached to tracking issue.
- [ ] Residual failures triaged with owner and ETA.
- [ ] Decommission decision documented (keep dual-read or remove legacy path).
- [ ] If decommissioning: rollback window and freeze period are confirmed.
