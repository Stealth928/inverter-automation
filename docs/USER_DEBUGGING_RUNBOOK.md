# User Debugging Runbook

Last Updated: March 12, 2026  
Owner: Engineering

## Purpose
Provide a repeatable, low-friction path to investigate a single user's onboarding/setup progress, automation activity, and integration behavior from Firebase Auth + Firestore.

## Fast Path (Recommended)
Run the scanner script from repo root:

```bash
node scripts/user-debug-report.js --email <user@email>
```

Example:

```bash
node scripts/user-debug-report.js --email hudakharrufa@gmail.com
```

Optional flags:

```bash
node scripts/user-debug-report.js \
  --email <user@email> \
  --project inverter-automation-firebase \
  --max-docs 2000 \
  --out tmp-user-debug-custom.json
```

To include non-redacted secrets (rare, sensitive):

```bash
node scripts/user-debug-report.js --email <user@email> --include-secrets
```

## Prerequisites
- `firebase` CLI installed and authenticated (`firebase login`).
- Access to the Firebase project being inspected.
- Run from repo root (`d:\inverter-automation` in current setup).

## What the Script Does
1. Resolves the user from Firebase Auth by email (via Identity Toolkit `downloadAccount` scan).
2. Captures Auth profile metadata:
   - `localId` (uid)
   - `createdAt`
   - `lastSignedInAt`
   - provider list (`google.com`, etc.)
3. Reads `users/{uid}` Firestore profile doc.
4. Enumerates and scans user subcollections:
   - `config`
   - `automation`
   - `rules`
   - `history`
   - `automationAudit`
   - `metrics`
   - `cache`
   - `secrets`
   - (any other present collections)
5. Queries top-level `admin_audit` references for:
   - `targetUid == uid`
   - `adminUid == uid`
6. Builds a normalized summary:
   - setup completeness
   - automation/rules status
   - history/audit counts
   - metrics totals
   - timeline of key events
   - stage classification

## Output Artifact
The script writes a JSON report to:
- default: `tmp-user-debug-<email>-<timestamp>.json`
- or custom path via `--out`

Output is redacted by default for keys matching:
- `token`
- `secret`
- `apiKey`
- `password`
- `credential`

## Stage Classification
`summary.stage` is derived as:
- `auth_only`: Auth account exists, no usable user profile yet
- `setup_incomplete`: profile exists, setup not complete
- `configured_no_rules`: setup complete, no automation rules yet
- `rules_created_automation_disabled`: rules exist but automation disabled
- `automation_enabled_no_cycles`: enabled but no audit cycles yet
- `automation_active_with_cycles`: enabled and cycle activity present

## How to Interpret Progress Quickly
Check these fields first:
1. `summary.auth.lastSignedInAt`: latest login activity.
2. `summary.config.setupComplete`: setup completed or not.
3. `summary.rules.count`: whether user created rules.
4. `summary.profile.automationEnabled`: automation toggle state.
5. `summary.automationAudit.count`: whether scheduler cycles are recorded.
6. `summary.metrics.totals`: API usage by provider (e.g., `alphaess`, `amber`, `weather`, `foxess`).
7. `summary.timeline`: event sequence to understand where the user stopped.

## Manual Fallback Path
If script execution is blocked, use:
1. `firebase auth:export tmp-auth-export-all.json --format=json --project <projectId>`
2. Find user by email and copy `localId` (uid).
3. Query Firestore manually (REST/admin tooling) under:
   - `users/{uid}`
   - `users/{uid}/config/main`
   - `users/{uid}/automation/state`
   - `users/{uid}/rules/*`
   - `users/{uid}/history/*`
   - `users/{uid}/automationAudit/*`
   - `users/{uid}/metrics/*`

## Operational Safety
- Do not commit generated `tmp-*` artifacts.
- Treat `--include-secrets` output as sensitive data.
- Share redacted summaries in tickets/channels unless secret values are explicitly required for incident response.
