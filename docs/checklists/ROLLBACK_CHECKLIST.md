# Rollback Checklist

- Status: Active template
- Owner: On-call engineer
- Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Sprint 1 item 18)

## 1. Trigger Confirmation

- [ ] Rollback trigger condition is met (error rate, contract break, scheduler conflicts, etc.).
- [ ] Incident owner is assigned.
- [ ] Time of decision is logged.
- [ ] Scope of impact is documented (users, endpoints, jobs).

## 2. Immediate Stabilization

- [ ] Disable high-risk feature flags.
- [ ] Stop/suspend active migration jobs.
- [ ] Pause automated retries if they increase load or damage.
- [ ] Notify stakeholders (engineering, operations, product).

## 3. Technical Rollback Steps

- [ ] Route traffic back to stable code path.
- [ ] Re-enable legacy read/write path where required.
- [ ] Restore configuration values/secrets if changed during rollout.
- [ ] Verify auth/role behavior for admin-sensitive endpoints.

## 4. Data Integrity Checks

- [ ] Validate user data readability after rollback.
- [ ] Validate automation scheduler behavior.
- [ ] Validate cache and metrics writes.
- [ ] Spot-check affected users for data loss/corruption.

## 5. Recovery Validation

- [ ] Run critical backend test subset.
- [ ] Run API contract check.
- [ ] Run smoke checks for dashboard, settings, and automation cycle.
- [ ] Confirm production error rates return to baseline.

## 6. Closure

- [ ] Publish rollback summary (what failed, what was rolled back, current status).
- [ ] Create follow-up issues with owners and due dates.
- [ ] Update refactor plan and risk register with new findings.
