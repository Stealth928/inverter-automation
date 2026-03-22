# Repo Hygiene Guide

Last updated: 2026-03-22

## Purpose

This guide defines what local/generated artifacts should stay out of the repo,
what can be deleted safely, and what to check before committing.

## Keep the Repo Focused on Source

The repository should primarily contain:

- product source code
- required static assets
- maintained documentation
- scripts used repeatedly by the team
- test sources and intentional fixtures

It should not accumulate one-off debugging traces, emulator snapshots, local
runtime logs, or copied secrets.

## Generated Artifacts That Should Not Stay in Git

### Temporary investigation files

Examples:

- `tmp-*`
- one-off extraction scripts created only for a single investigation
- ad hoc provider HTML/JS/PDF downloads used for reverse engineering or note-taking

Policy:

- keep them local only while the investigation is active
- delete them before merging unrelated work
- if the investigation produced durable knowledge, move that knowledge into docs
  instead of keeping the raw temp files

### Emulator and local runtime artifacts

Examples:

- `emulator-state/`
- `firebase-export-*/`
- `*.pid`
- `emulator.log`
- `firebase-debug.log`
- `firestore-debug.log`
- `pubsub-debug.log`
- `predeploy-last.log`
- `logs/`

Policy:

- treat these as disposable local artifacts
- regenerate them when needed
- do not keep them in the repo as historical records unless a doc explicitly
  calls for preserved evidence in a dedicated evidence folder

### Pipeline and report outputs

Examples:

- `aemo-run-*/`
- `aemo-run-*.zip`
- `playwright-report/`
- `test-results/`
- coverage outputs

Policy:

- keep them out of commits
- if evidence must be retained, store curated outputs under `docs/evidence/`
  with context, not as raw local dumps in the repo root

### Secrets and key material

Examples:

- copied PEM files
- provider tokens or exported auth payloads
- one-off proxy keys

Policy:

- never commit private key material
- delete copied temp variants after use
- store durable secrets only through approved secret-management paths, not in the repo

## Safe Cleanup Categories

These are generally safe to remove when they are not part of an intentional
fixture or evidence workflow:

- temp files matching `tmp*`
- local log files
- local emulator snapshots and exports
- pipeline output folders created for local inspection
- local HTML/JSON dumps created during debugging

## Before You Commit

Run a quick hygiene pass:

1. Check `git status` for temp files, logs, exports, or snapshots.
2. Delete investigation artifacts that are no longer needed.
3. Confirm no copied secrets or private keys are present.
4. Move any durable findings into maintained docs instead of leaving raw dumps.
5. Keep evidence only when it supports an intentional audit trail.

## When to Keep Generated Files Intentionally

Keep generated outputs only when at least one of these is true:

- the file is a committed test fixture
- the file is required by the app at runtime
- the file is curated evidence under a maintained doc/evidence workflow
- the file is an intentionally versioned exported dataset used by the product

If none of those apply, prefer deletion.

## Current Public Data Exception

Do not delete the intentionally retained AEMO data assets used by the market
and pricing features unless there is a separate data-retention decision.

Examples:

- `aemo-aggregated-data/`

Those are product data assets, not temporary debugging residue.