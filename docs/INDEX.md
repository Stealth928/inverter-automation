# Documentation Index

Last updated: 2026-03-21
Purpose: canonical map of the actively maintained documentation set.

## Start Here

- [../README.md](../README.md): repository overview and fast path into the project.
- [SETUP.md](SETUP.md): local development, deployment setup, provider onboarding,
  runtime configuration, and Firestore model summary.
- [guides/PRODUCT_GUIDE.md](guides/PRODUCT_GUIDE.md): shipped product surface,
  current provider status, and user-facing capability framing.

## Product and API

- [API.md](API.md): narrative API reference grouped by domain.
- [openapi/openapi.v1.yaml](openapi/openapi.v1.yaml): API contract source of
  truth used by `npm run openapi:check`.
- [AUTOMATION.md](AUTOMATION.md): rule engine, conditions, actions, and provider
  behavior.
- [BACKGROUND_AUTOMATION.md](BACKGROUND_AUTOMATION.md): scheduler cadence,
  orchestration, locks, retries, idempotency, and metrics.
- [guides/TESLA_ONBOARDING.md](guides/TESLA_ONBOARDING.md): operator and user
  onboarding guide for Tesla OAuth, readiness, and charging controls.
- [guides/TESLA_EV_INTEGRATION.md](guides/TESLA_EV_INTEGRATION.md): product and
  marketing framing for live Tesla EV functionality.
- [CURTAILMENT_QUICK_START.md](CURTAILMENT_QUICK_START.md): operational quick
  start for solar curtailment settings and discovery workflows.
- [CURTAILMENT_MONITORING_GUIDE.md](CURTAILMENT_MONITORING_GUIDE.md): runtime
  monitoring and interpretation of curtailment transitions.
- [PROVIDER_API_FIELD_AUDIT_MAR17.md](PROVIDER_API_FIELD_AUDIT_MAR17.md):
  provider data audit and capability gap analysis.

## Operations

- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md): practical deployment runbook.
- [RELEASE_READINESS_CHECKLIST.md](RELEASE_READINESS_CHECKLIST.md): pre-release
  go/no-go checklist.
- [LOCAL_DEV_KNOWN_ISSUES.md](LOCAL_DEV_KNOWN_ISSUES.md): emulator and local-dev
  troubleshooting.
- [LOGGING_GUIDE.md](LOGGING_GUIDE.md): runtime logging policy and cost hygiene.
- [USER_DEBUGGING_RUNBOOK.md](USER_DEBUGGING_RUNBOOK.md): end-to-end user
  investigation workflow.
- [PROD_BACKUP_ROLLBACK_RUNBOOK.md](PROD_BACKUP_ROLLBACK_RUNBOOK.md): backup and
  rollback procedure.
- [REPO_OPPORTUNITY_AUDIT_MAR21_2026.md](REPO_OPPORTUNITY_AUDIT_MAR21_2026.md): repo-wide
  performance, Firebase cost, scheduler, docs, and debt audit with prioritized
  opportunities.
- [SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md](SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md):
  scheduler SLO alert response and escalation.
- [guides/TESTING_GUIDE.md](guides/TESTING_GUIDE.md): backend/frontend test
  execution and CI alignment.

## Architecture and Governance

- [REFACTORING_IMPLEMENTATION_PLAN_MAR26.md](REFACTORING_IMPLEMENTATION_PLAN_MAR26.md):
  active refactor tracker and status log.
- [P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md](P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md):
  architecture and contract baseline.
- [API_CONTRACT_BASELINE_MAR26.md](API_CONTRACT_BASELINE_MAR26.md): API drift
  baseline used by contract checks.
- [PHASE_GATE_DASHBOARD.md](PHASE_GATE_DASHBOARD.md): phase-gate tracking.
- [adr/ADR-001-target-architecture-boundaries.md](adr/ADR-001-target-architecture-boundaries.md)
- [adr/ADR-002-v2-data-model-and-migration-strategy.md](adr/ADR-002-v2-data-model-and-migration-strategy.md)
- [checklists/MIGRATION_SAFETY_CHECKLIST.md](checklists/MIGRATION_SAFETY_CHECKLIST.md)
- [checklists/ROLLBACK_CHECKLIST.md](checklists/ROLLBACK_CHECKLIST.md)

## Historical Evidence

These documents are intentionally retained as project records, not as the
primary source of truth for day-to-day product or operations work.

- [P1_G1_CLOSEOUT_EVIDENCE_MAR26.md](P1_G1_CLOSEOUT_EVIDENCE_MAR26.md)
- [P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md](P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md)
- [P2_G2_CLOSEOUT_EVIDENCE_MAR26.md](P2_G2_CLOSEOUT_EVIDENCE_MAR26.md)
- [P3_G3_CLOSEOUT_EVIDENCE_MAR26.md](P3_G3_CLOSEOUT_EVIDENCE_MAR26.md)
- [P4_G4_CLOSEOUT_EVIDENCE_MAR26.md](P4_G4_CLOSEOUT_EVIDENCE_MAR26.md)
- [P5_G5_CLOSEOUT_EVIDENCE_MAR26.md](P5_G5_CLOSEOUT_EVIDENCE_MAR26.md)
- [P6_G6_CLOSEOUT_EVIDENCE_MAR26.md](P6_G6_CLOSEOUT_EVIDENCE_MAR26.md)
- [evidence/REFACTORING_EXECUTION_LOG_MAR26.md](evidence/REFACTORING_EXECUTION_LOG_MAR26.md)
- [evidence/scheduler-soak/README.md](evidence/scheduler-soak/README.md)
- [COST_ANALYSIS.md](COST_ANALYSIS.md)

## Hygiene Rules

- Prefer updating an existing canonical doc over adding a new overlapping one.
- Treat [openapi/openapi.v1.yaml](openapi/openapi.v1.yaml) as the API contract
  source of truth; keep [API.md](API.md) as the narrative companion.
- Keep root-level docs minimal.
- If a document becomes historical, either move it under a historical section or
  delete it when it no longer adds evidence value.
