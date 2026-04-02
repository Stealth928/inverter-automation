# Documentation Index

Last updated: 2026-04-02
Purpose: canonical map of the actively maintained documentation set.

## Start Here

- [../README.md](../README.md): repository overview and fast path into the
  project.
- [SETUP.md](SETUP.md): local development, provider onboarding, secrets,
  Firestore model, and deployment prerequisites.
- [DOCUMENTATION_GOVERNANCE.md](DOCUMENTATION_GOVERNANCE.md): canonical docs
  map, docs-impact matrix, and enforcement flow.
- [guides/PRODUCT_CAPABILITY_GUIDE.md](guides/PRODUCT_CAPABILITY_GUIDE.md):
  canonical product reference covering public pages, authenticated surfaces,
  integrations, admin tooling, and boundaries.
- [guides/FRONTEND_CONTENT_GUIDE.md](guides/FRONTEND_CONTENT_GUIDE.md):
  canonical guide for public pages, directory URLs, blog slugs, sitemap, robots
  policy, and answer-engine files.

## Runtime and API

- [API.md](API.md): narrative API guide grouped by auth model and workflow.
- [openapi/openapi.v1.yaml](openapi/openapi.v1.yaml): incremental OpenAPI
  contract baseline used by `npm run openapi:check`.
- [API_CONTRACT_BASELINE.md](API_CONTRACT_BASELINE.md): generated
  live route inventory from mounted backend routes. This is the most complete
  API surface map today.
- [AUTOMATION.md](AUTOMATION.md): rule engine, supported conditions/actions,
  provider restrictions, and automation lifecycle.
- [BACKGROUND_AUTOMATION.md](BACKGROUND_AUTOMATION.md): scheduled jobs,
  orchestration, locks, idempotency, metrics, and alerts.
- [AEMO_AGGREGATION_PIPELINE.md](AEMO_AGGREGATION_PIPELINE.md): raw AEMO
  ingestion, aggregate generation, published market-insights bundle flow, and
  live snapshot refresh job.
- [guides/TESLA_ONBOARDING.md](guides/TESLA_ONBOARDING.md): canonical Tesla
  OAuth, readiness, command transport, and operational setup guide.
- [CURTAILMENT_QUICK_START.md](CURTAILMENT_QUICK_START.md): curtailment setup
  and user/operator quick start.
- [CURTAILMENT_MONITORING_GUIDE.md](CURTAILMENT_MONITORING_GUIDE.md): runtime
  interpretation of curtailment state changes and diagnostics.

## Operations and Release

- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md): practical production-safe release
  workflow.
- [RELEASE_READINESS_CHECKLIST.md](RELEASE_READINESS_CHECKLIST.md): pre-release
  go/no-go checklist.
- [COST_ANALYSIS.md](COST_ANALYSIS.md): canonical Firebase cost,
  load-complexity, and performance review with ranked optimization priorities.
- [guides/TESTING_GUIDE.md](guides/TESTING_GUIDE.md): backend, frontend,
  contract, and release test tracks.
- [LOCAL_DEV_KNOWN_ISSUES.md](LOCAL_DEV_KNOWN_ISSUES.md): emulator and local-dev
  troubleshooting.
- [LOGGING_GUIDE.md](LOGGING_GUIDE.md): runtime logging policy and cost hygiene.
- [USER_DEBUGGING_RUNBOOK.md](USER_DEBUGGING_RUNBOOK.md): end-to-end user
  investigation workflow.
- [PROD_BACKUP_ROLLBACK_RUNBOOK.md](PROD_BACKUP_ROLLBACK_RUNBOOK.md): backup and
  rollback procedure.
- [SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md](SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md):
  scheduler SLO alert response guidance.
- [guides/REPO_HYGIENE.md](guides/REPO_HYGIENE.md): generated-artifact,
  temp-file, emulator-state, and cleanup policy.

## Architecture and Governance

- [P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md](P1_ARCHITECTURE_CONTRACT_SPEC_MAR26.md):
  architecture and contract baseline.
- [PHASE_GATE_DASHBOARD.md](PHASE_GATE_DASHBOARD.md): phase-gate tracking.
- [adr/ADR-001-target-architecture-boundaries.md](adr/ADR-001-target-architecture-boundaries.md)
- [adr/ADR-002-v2-data-model-and-migration-strategy.md](adr/ADR-002-v2-data-model-and-migration-strategy.md)
- [checklists/MIGRATION_SAFETY_CHECKLIST.md](checklists/MIGRATION_SAFETY_CHECKLIST.md)
- [checklists/ROLLBACK_CHECKLIST.md](checklists/ROLLBACK_CHECKLIST.md)

## Historical Evidence

These documents are retained for audit trail and project history. They are not
the day-to-day source of truth for shipped behavior.

- [P1_G1_CLOSEOUT_EVIDENCE_MAR26.md](P1_G1_CLOSEOUT_EVIDENCE_MAR26.md)
- [P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md](P2_BACKEND_DECOMPOSITION_KICKOFF_MAR26.md)
- [P2_G2_CLOSEOUT_EVIDENCE_MAR26.md](P2_G2_CLOSEOUT_EVIDENCE_MAR26.md)
- [P3_G3_CLOSEOUT_EVIDENCE_MAR26.md](P3_G3_CLOSEOUT_EVIDENCE_MAR26.md)
- [P4_G4_CLOSEOUT_EVIDENCE_MAR26.md](P4_G4_CLOSEOUT_EVIDENCE_MAR26.md)
- [P5_G5_CLOSEOUT_EVIDENCE_MAR26.md](P5_G5_CLOSEOUT_EVIDENCE_MAR26.md)
- [P6_G6_CLOSEOUT_EVIDENCE_MAR26.md](P6_G6_CLOSEOUT_EVIDENCE_MAR26.md)
- [REFACTORING_IMPLEMENTATION_PLAN_MAR26.md](REFACTORING_IMPLEMENTATION_PLAN_MAR26.md)
- [evidence/REFACTORING_EXECUTION_LOG_MAR26.md](evidence/REFACTORING_EXECUTION_LOG_MAR26.md)
- [evidence/scheduler-soak/README.md](evidence/scheduler-soak/README.md)

## Legacy Aliases

These files are kept to avoid breaking older links, but their canonical
content now lives elsewhere.

- [guides/PRODUCT_GUIDE.md](guides/PRODUCT_GUIDE.md): short alias for the
  canonical product reference.
- [guides/TESLA_EV_INTEGRATION.md](guides/TESLA_EV_INTEGRATION.md): short alias
  for the canonical Tesla onboarding guide.
- [API_CONTRACT_BASELINE_MAR26.md](API_CONTRACT_BASELINE_MAR26.md): legacy
  alias for the stable generated API baseline path.

## Hygiene Rules

- Prefer updating an existing canonical doc over adding a new overlapping one.
- Treat [API_CONTRACT_BASELINE.md](API_CONTRACT_BASELINE.md) as the
  live API inventory and [openapi/openapi.v1.yaml](openapi/openapi.v1.yaml) as
  the incremental machine-readable subset.
- Refresh the API baseline with `npm run api:contract:refresh` whenever mounted
  routes or frontend endpoint calls change.
- Keep public-content docs aligned with `frontend/sitemap.xml`, `frontend/llms.txt`,
  `frontend/llms-full.txt`, and `firebase.json` crawl headers.
- Run `npm run docs:impact:check` when product, API, automation, setup, or
  release flows change.
- Historical evidence docs may explain why a change happened, but canonical docs
  should explain what is true now.
