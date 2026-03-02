# Production Backup and Rollback Runbook

Last updated: 2026-03-02 22:32:44 +11:00 (2026-03-02 11:32:44 UTC)
Project: `inverter-automation-firebase`

## Goal

Create a pre-deploy snapshot covering all user automation data and define an exact rollback path.

## What must be protected

The app stores automation/user state under `users/{uid}`:

- root user document fields (including `automationEnabled`)
- `config/*` (including `main`, `tesla`)
- `automation/state`
- `rules/*`
- `quickControl/state`
- `curtailment/state`
- `cache/*`
- `history/*`
- `automationAudit/*`
- `metrics/*`

A full Firestore database snapshot covers all of the above.

## Snapshot Actions Executed

## 1) Immediate full snapshot via database clone (started)

Command used:

```powershell
firebase firestore:databases:clone `
  "projects/inverter-automation-firebase/databases/(default)" `
  "projects/inverter-automation-firebase/databases/preprod202603022225"
```

Clone target database:

- `projects/inverter-automation-firebase/databases/preprod202603022225`

Clone operation:

- `projects/inverter-automation-firebase/databases/preprod202603022225/operations/QfJsv0wMPbYpRWu6x_KsrBAqNW1hbgQiDBAaGg`

Status check command:

```powershell
firebase firestore:operations:describe `
  --database="preprod202603022225" `
  "projects/inverter-automation-firebase/databases/preprod202603022225/operations/QfJsv0wMPbYpRWu6x_KsrBAqNW1hbgQiDBAaGg"
```

Note: clone operation was still `PROCESSING` during the last check and must be confirmed `Done? YES` before production deploy.

## 2) Managed backup schedule enabled (restore-capable path)

Command used:

```powershell
firebase firestore:backups:schedules:create `
  --database="(default)" `
  --recurrence=DAILY `
  --retention=14d
```

Schedule created:

- `projects/inverter-automation-firebase/databases/(default)/backupSchedules/06f0f0ad-40a7-4934-8d3d-1f7fc3f51599`

Verify schedules:

```powershell
firebase firestore:backups:schedules:list --database="(default)"
```

Check available backups:

```powershell
firebase firestore:backups:list --location=nam5
```

## Critical Rollback Reality

- The clone DB is a complete snapshot copy, but it is not a direct `restore --backup` artifact.
- A direct restore into `(default)` requires a managed Firestore backup resource.
- Therefore:
  - Before first managed backup exists, fastest safe rollback is code rollback.
  - Full data rewind to `(default)` becomes available once a managed backup appears in `firestore:backups:list`.

## Rollback Procedures

## A) Fast code rollback (no data rewind)

1. Roll back code to last known good commit.
2. Deploy:

```powershell
firebase deploy --only functions,hosting
```

Use when behavior regression is code-driven and user data should remain.

## B) Full data rollback (once managed backup exists)

1. List backups and select backup resource name:

```powershell
firebase firestore:backups:list --location=nam5
```

2. Restore selected backup into default DB:

```powershell
firebase firestore:databases:restore `
  --database="(default)" `
  --backup="projects/inverter-automation-firebase/locations/nam5/backups/<BACKUP_ID>"
```

3. Re-deploy known good code if needed:

```powershell
firebase deploy --only functions,hosting
```

## Pre-Deploy Go/No-Go Checklist

- [ ] Clone operation above is `Done? YES`
- [ ] `firestore:backups:schedules:list` shows active schedule
- [ ] (Preferred) At least one managed backup exists in `firestore:backups:list`
- [ ] Full test suite green
- [ ] Deploy window and monitoring owner confirmed

## Post-Deploy Monitoring Checklist

- [ ] `/api/automation/status` healthy for sample users
- [ ] No spike in function errors for automation endpoints
- [ ] Rule trigger frequency remains within expected range
- [ ] No unexpected rule state churn (`activeRule`, `lastTriggered`)

