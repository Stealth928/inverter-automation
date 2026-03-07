# Documentation Index

Last Updated: March 7, 2026
Purpose: Canonical index of actively maintained project documentation.

## Core Docs
- [README.md](../README.md): Project overview and quick start.
- [SETUP.md](SETUP.md): Local and production setup.
- [API.md](API.md): API reference and route behavior.
- [AUTOMATION.md](AUTOMATION.md): Rule engine behavior, conditions, and actions.

## Operations
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md): Pre-deploy and deployment guardrails.
- [LOCAL_DEV_KNOWN_ISSUES.md](LOCAL_DEV_KNOWN_ISSUES.md): Emulator and local-dev runbook.
- [PROD_BACKUP_ROLLBACK_RUNBOOK.md](PROD_BACKUP_ROLLBACK_RUNBOOK.md): Backup and rollback flow.
- [BACKGROUND_AUTOMATION.md](BACKGROUND_AUTOMATION.md): Scheduler/runtime behavior.
- [SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md](SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md): Scheduler SLO alert response and escalation flow.
- [LOGGING_GUIDE.md](LOGGING_GUIDE.md): Canonical runtime logging policy and cost hygiene.

## Product and Testing Guides
- [guides/PRODUCT_GUIDE.md](guides/PRODUCT_GUIDE.md): Product-facing feature guide.
- [guides/TESTING_GUIDE.md](guides/TESTING_GUIDE.md): Backend/frontend test execution guide.

## Refactor and Governance Track
- [REFACTORING_IMPLEMENTATION_PLAN_MAR26.md](REFACTORING_IMPLEMENTATION_PLAN_MAR26.md): Main execution tracker.
- [P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md](P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md): P1 architecture/contracts.
- [P1_G1_CLOSEOUT_EVIDENCE_MAR26.md](P1_G1_CLOSEOUT_EVIDENCE_MAR26.md): P1/G1 closeout evidence package.
- [P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md](P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md): P2 extraction sequencing.
- [P2_G2_CLOSEOUT_EVIDENCE_MAR26.md](P2_G2_CLOSEOUT_EVIDENCE_MAR26.md): G2 evidence package.
- [P3_G3_CLOSEOUT_EVIDENCE_MAR26.md](P3_G3_CLOSEOUT_EVIDENCE_MAR26.md): P3/G3 closeout evidence package.
- [evidence/scheduler-soak/README.md](evidence/scheduler-soak/README.md): Scheduler soak evidence capture and artifact conventions.
- [PHASE_GATE_DASHBOARD.md](PHASE_GATE_DASHBOARD.md): Phase gate board conventions.
- [API_CONTRACT_BASELINE_MAR26.md](API_CONTRACT_BASELINE_MAR26.md): API drift baseline.
- [openapi/openapi.v1.yaml](openapi/openapi.v1.yaml): OpenAPI source of truth.
- [adr/ADR-001-target-architecture-boundaries.md](adr/ADR-001-target-architecture-boundaries.md)
- [adr/ADR-002-v2-data-model-and-migration-strategy.md](adr/ADR-002-v2-data-model-and-migration-strategy.md)
- [checklists/MIGRATION_SAFETY_CHECKLIST.md](checklists/MIGRATION_SAFETY_CHECKLIST.md)
- [checklists/ROLLBACK_CHECKLIST.md](checklists/ROLLBACK_CHECKLIST.md)

## Analysis Docs (Keep As Reference)
- [COST_ANALYSIS.md](COST_ANALYSIS.md)
- [CURTAILMENT_MONITORING_GUIDE.md](CURTAILMENT_MONITORING_GUIDE.md)
- [CURTAILMENT_QUICK_START.md](CURTAILMENT_QUICK_START.md)
- [README_CURTAILMENT.md](README_CURTAILMENT.md)

## Hygiene Rules
- Keep root-level docs minimal (`README.md` only unless there is a clear reason).
- Put all new docs under `docs/`.
- Update this index when adding/removing docs.
- Remove generated logs/reports from the repo root and keep them ignored.
- If a doc is superseded, either delete it or explicitly mark it as legacy in its header.

