# ADR-001: Target Architecture Boundaries

- Status: Accepted
- Date: 2026-03-04
- Owners: RefactoringMar26 workstream
- Related Plan: `docs/REFACTORING_IMPLEMENTATION_PLAN_MAR26.md` (Sprint 1 item 16)

## Context

The backend currently concentrates routing, orchestration, persistence, and vendor integration in `functions/index.js`.
This makes onboarding new providers/devices and testing core automation behavior expensive and risky.

## Decision

Adopt explicit module boundaries and keep each boundary focused on one responsibility:

1. API Routes
- Responsibility: HTTP transport, request validation, response envelopes.
- Location: `functions/api/routes/*.js`.

2. Domain Services
- Responsibility: business logic and orchestration of use cases.
- Location: `functions/lib/*.js` (for example: `automation-engine.js`, `automation-actions.js`).

3. Adapters
- Responsibility: provider/device/EV integration contracts and implementations.
- Location: `functions/lib/adapters/*.js`.

4. Repositories
- Responsibility: Firestore read/write logic and persistence concerns.
- Location: `functions/lib/repositories/*.js`.

5. Infrastructure Helpers
- Responsibility: cross-cutting concerns such as logging, caching, and time helpers.
- Location: `functions/lib/logger.js`, `functions/lib/cache-manager.js`, `functions/lib/time-utils.js`.

6. Entry Point
- Responsibility: app bootstrapping, middleware registration, route mounting, Cloud Function exports only.
- Location: `functions/index.js` (target: routing/glue only).

## Boundary Rules

1. Routes must call services, not repositories or vendor APIs directly.
2. Services may call repositories and adapters, and may compose other services.
3. Repositories must not call adapters.
4. Adapters must not depend on route-layer code.
5. Shared helpers must not import route modules.
6. New endpoint work must include tests at service or adapter level (not route-only tests).

## Consequences

Positive:
- Better testability and lower blast radius for refactors.
- Clear ownership for provider/device/EV integrations.
- Reduced route/contract drift by centralizing endpoint behavior.

Tradeoffs:
- More files and module wiring.
- Temporary duplication during transition while legacy paths remain available.

## Rollout Notes

1. Extract by domain in small pull requests (no big-bang rewrite).
2. Maintain backward-compatible API responses during extraction.
3. Keep high-risk behavior behind feature flags until phase gate sign-off.
