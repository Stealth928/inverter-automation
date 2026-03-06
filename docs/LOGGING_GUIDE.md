# Logging Guide

Last Updated: 2026-03-06
Purpose: Canonical logging policy for runtime cost control, debugging effectiveness, and production hygiene.

## Logging Principles
- Keep error and warning logs for actionable failures.
- Avoid high-volume info/debug logs on hot paths unless gated by flags.
- Prefer structured, consistent messages with stable prefixes.
- Never log secrets, tokens, or full credential payloads.

## Allowed Levels
- `error`: unexpected failures or data corruption risk.
- `warn`: recoverable failures, retries, degraded behavior.
- `info`: important lifecycle events (startup, deploy-time checks), low frequency.
- `debug`: deep diagnostics gated behind environment flags.

## Hot-Path Rules
For scheduler loops, high-frequency routes, and cache checks:
- No unbounded per-cycle `console.log` traces in production paths.
- Use sampled or gated debug logs when detailed tracing is needed.
- Prefer metrics counters over verbose textual tracing.

## Operational Checklist
Before merge/deploy:
1. Validate no credential/token leakage in logs.
2. Check high-frequency endpoints for verbose logging noise.
3. Ensure debug logging can be disabled by default.
4. Confirm critical error paths remain visible.

## Cost Hygiene
- Cloud Logging cost grows linearly with verbosity and user activity.
- Logging reductions should be evaluated alongside observability impact.
- Keep enough detail to debug incidents, but not per-request noise in normal operation.

## Superseded Documents
This guide supersedes prior overlapping logging analysis/audit snapshot docs.
