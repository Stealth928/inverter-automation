# ADR-002: v2 Data Model and Migration Strategy

- Status: Accepted
- Date: 2026-03-04
- Owners: RefactoringMar26 workstream
- Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Sprint 1 item 17)

## Context

Current Firestore data is functional but concentrated around legacy structures and mixed responsibilities.
Planned multi-provider, multi-device, and EV support needs clear schema ownership and safe migration controls.

## Decision

Adopt a phased v2 migration strategy with dual-read and controlled rollout:

1. Dual-read first
- Services read v2 documents when present.
- If v2 is absent, services fall back to legacy paths.

2. Dual-write where practical
- During transition, writes update both legacy and v2 documents for selected domains.
- Dual-write is scoped and tracked to avoid permanent duplication.

3. Backfill in batches
- Existing users are migrated in controlled batches.
- Each batch tracks success/failure and fallback-read rate.

4. Feature-flag high-risk paths
- New orchestration/model usage is gated by flags.
- Flags allow immediate disable without code rollback.

5. Decommission only after stability window
- Remove legacy reads only after fallback usage trends to zero and gate criteria are met.

## Target v2 Principles

1. Provider and device data must be isolated from orchestration state.
2. Runtime state must be idempotent-friendly (scheduler-safe updates).
3. Cache and metrics paths must remain explicit and documented.
4. Per-user data ownership must remain strict (`users/{uid}/...`), with admin-only global collections.

## Migration Safety Requirements

1. Every migration step must be reversible.
2. Each run must emit counts for:
- attempted users
- migrated users
- failed users
- fallback reads
3. Stop criteria must exist for each migration batch.
4. Rollback procedure must be pre-written before first production batch.

## Consequences

Positive:
- Reduced schema ambiguity and migration risk.
- Clear guardrails for phased rollout.

Tradeoffs:
- Temporary extra complexity from dual-read/dual-write logic.
- Additional monitoring overhead during migration window.

## Rollout Notes

1. Pilot on internal users first.
2. Expand to small cohorts after error/fallback checks pass.
3. Promote to broad rollout only after phase gate approval.
