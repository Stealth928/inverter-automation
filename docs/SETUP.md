# Setup & Deployment Guide

## Quick Start

### Prerequisites
- Node.js 22+ installed
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project at [console.firebase.google.com](https://console.firebase.google.com)

### Deploy to Firebase

```bash
# 1. Clone and install
git clone <repo>
cd inverter-automation
cd functions && npm install && cd ..

# 2. Login to Firebase
firebase login

# 3. Configure project
# Edit .firebaserc - set your project ID
# Edit frontend/js/firebase-config.js - add your Firebase config

# 4. Deploy
firebase deploy
```

Your app will be live at: `https://<project-id>.web.app`

---

## Firebase Project Setup

### 1. Create Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add Project"
3. Name it (e.g., "inverter-automation")
4. Enable/disable Google Analytics as desired

### 2. Enable Services

#### Authentication
1. Go to **Authentication > Sign-in method**
2. Enable **Email/Password**
3. Optionally enable **Google** sign-in

#### Firestore Database
1. Go to **Firestore Database**
2. Click "Create database"
3. Select **Production mode**
4. Choose region: `australia-southeast1` (or nearest)

#### Hosting
Automatically configured on first deploy.

### 3. Get Firebase Config

1. Go to **Project Settings > General**
2. Scroll to "Your apps" section
3. Click web icon (</>) to add a web app
4. Copy the config object

Update `frontend/js/firebase-config.js`:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 4. Update Project ID

Edit `.firebaserc`:
```json
{
  "projects": {
    "default": "your-project-id"
  }
}
```

---

## External API Keys

Users configure their own API keys in the Settings page after login. The system supports four battery inverter providers (FoxESS, Sungrow, SigenEnergy, AlphaESS) — configure credentials for whichever provider you use.

### FoxESS Cloud API
1. Go to [FoxESS Cloud](https://www.foxesscloud.com)
2. Login with your FoxESS account
3. Go to **User Center > API Management**
4. Generate API key
5. Note your inverter Serial Number

### Sungrow iSolarCloud API
1. Go to [iSolarCloud](https://au.isolarcloud.com) (or your regional portal)
2. Login with your Sungrow/iSolarCloud account
3. Note your account email, account password, and inverter Serial Number (found in the Device menu)
4. Enter these in the Setup page — the system will verify credentials via a live login

> **Note:** Sungrow credentials (password) are stored write-only in a Firestore secrets subcollection and cannot be read back via the API.

### SigenEnergy Cloud API
1. Download the SigenEnergy mobile app and create an account
2. Note your account email and password
3. Select your region: `apac` (Asia-Pacific), `eu` (Europe), `cn` (China), or `us` (North America)
4. Enter these in the Setup page — the system will verify credentials via a live OAuth2 login

> **Note:** SigenEnergy scheduler and history features are in limited beta — work mode control and real-time status are fully supported.

### AlphaESS OpenAPI
1. Sign in to the AlphaESS OpenAPI portal and create/get your app credentials
2. Collect your `appId`, `appSecret`, and target `system SN (sysSn)`
3. Enter these credentials in the Settings page to validate and save them

> **Note:** AlphaESS is currently disabled in the first-run Setup selector (coming soon), but credential onboarding is available from Settings.

### Amber Electric API
1. Go to [Amber Developer Portal](https://app.amber.com.au/developers)
2. Login with your Amber account
3. Generate API token
4. Copy the token (shown once)

### Scheduler SLO Alert Channel (Optional but Recommended)

Configure environment variables for operational alerting and threshold overrides:

```bash
AUTOMATION_SCHEDULER_SLO_ERROR_RATE_PCT=1.0
AUTOMATION_SCHEDULER_SLO_DEAD_LETTER_RATE_PCT=0.2
AUTOMATION_SCHEDULER_SLO_MAX_QUEUE_LAG_MS=120000
AUTOMATION_SCHEDULER_SLO_MAX_CYCLE_DURATION_MS=20000
AUTOMATION_SCHEDULER_SLO_P99_CYCLE_DURATION_MS=10000
AUTOMATION_SCHEDULER_SLO_TAIL_P99_CYCLE_DURATION_MS=10000
AUTOMATION_SCHEDULER_SLO_TAIL_WINDOW_MINUTES=15
AUTOMATION_SCHEDULER_SLO_TAIL_MIN_RUNS=10
AUTOMATION_SCHEDULER_SLO_ALERT_WEBHOOK_URL=https://your-alert-endpoint.example.com
AUTOMATION_SCHEDULER_SLO_ALERT_COOLDOWN_MS=300000
```

Operational response playbook:
- `docs/SCHEDULER_SLO_ALERT_RUNBOOK_MAR26.md`

---

## Local Development

### Option 1: One-command Emulator Reset + Reseed (Recommended)

```bash
# Deterministic stop -> start -> seed -> health-check
npm run emu:reset
```

`emu:reset` launcher hardening:
- On Windows, the CLI now auto-falls back from `npx.cmd` to `npm.cmd exec -- ...` when needed.
- On macOS/Linux, it falls back from `npx` to `npm exec -- ...`.

- Hosting + frontend pages: http://127.0.0.1:5000
- Emulator UI: http://127.0.0.1:4000
- Functions: http://127.0.0.1:5001
- Auth Emulator: http://127.0.0.1:9099

Helpful commands:

```bash
# Start only (no reseed)
npm run emu:start

# Reseed only (when emulators are already up)
npm run emu:seed

# Stop all emulators and cleanup listeners
npm run emu:stop

# Show quick port status
npm run emu:status
```

Notes:
- The warning `You are using the Auth Emulator, which is intended for local testing only` is expected in local development.
- If `localhost:5000` or `127.0.0.1:9099` shows `ERR_CONNECTION_REFUSED`, emulators are down; run `npm run emu:reset`.
- If your local clone is older and reset/start fails with `spawn npx ENOENT`, use:
```bash
npm run emu:stop
npm exec -- firebase emulators:start --only functions,firestore,hosting,auth,pubsub --import=./emulator-state --export-on-exit
```

### Option 2: Manual Emulator Start (advanced/troubleshooting)

```bash
firebase emulators:start --only functions,firestore,hosting,auth,pubsub
```

Use this mode when you want interactive logs in the same terminal.

Requires Java (OpenJDK) for Firestore and Pub/Sub emulators.

---

## Deployment Commands

```bash
# Deploy everything
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only hosting (frontend)
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# View deployment status
firebase hosting:channel:list
```

---

## Project Structure

```
inverter-automation/
├── firebase.json           # Firebase configuration
├── .firebaserc             # Project ID mapping
├── firestore.rules         # Firestore security rules
├── firestore.indexes.json  # Database indexes
│
├── frontend/               # Static files (Firebase Hosting)
│   ├── index.html          # Main dashboard
│   ├── login.html          # Authentication
│   ├── settings.html       # User settings
│   ├── history.html        # History & reports
│   ├── setup.html          # Initial setup wizard
│   ├── css/
│   │   └── shared-styles.css
│   └── js/
│       ├── firebase-config.js
│       ├── firebase-auth.js
│       ├── api-client.js
│       ├── app-shell.js
│       └── shared-utils.js
│
├── functions/              # Cloud Functions
│   ├── package.json
│   └── index.js            # Composition root + function exports
│
└── docs/                   # Documentation
    ├── AUTOMATION.md       # Automation rules documentation
    ├── API.md              # API reference
    ├── SETUP.md            # This file
    └── evidence/           # Historical execution logs/evidence
```

---

## Firestore Schema

This section documents the current Firestore model used by backend code.

### Top-level collections

| Path | Purpose |
|---|---|
| `users/{uid}` | User profile and top-level flags (`email`, `displayName`, `role`, `automationEnabled`, timestamps). |
| `shared/serverConfig` | Legacy shared setup config used by selected pre-auth setup flows. |
| `metrics/{YYYY-MM-DD}` | Platform-wide daily API usage counters. |
| `metrics/automationScheduler/runs/{runId}` | Per-run scheduler orchestration metrics snapshots. |
| `metrics/automationScheduler/daily/{YYYY-MM-DD}` | Daily scheduler orchestration aggregate metrics for admin dashboards. |
| `metrics/automationScheduler/alerts/current` | Latest scheduler SLO alert snapshot (healthy/watch/breach status + measured/threshold metrics). |
| `metrics/automationScheduler/alerts/{YYYY-MM-DD}` | Daily scheduler SLO watch/breach alert snapshots for operational follow-up. |
| `admin_audit/{docId}` | Admin action audit trail (role changes, impersonation, deletion events). |

### User-scoped collections (`users/{uid}/...`)

| Path | Purpose |
|---|---|
| `config/main` | User config (FoxESS token/SN, Amber key/site, timezone/location, system topology, automation preferences). |
| `automation/state` | Runtime automation status (`enabled`, `lastCheck`, `activeRule`, transition metadata). |
| `rules/{ruleId}` | User automation rules (conditions, action, schedule/priority). |
| `history/{docId}` | Immutable rule/action history log. |
| `notifications/{notificationId}` | User notifications (read/unread state). |
| `automationAudit/{auditId}` | Per-cycle audit data including evaluation snapshots and ROI context. |
| `metrics/{YYYY-MM-DD}` | Per-user daily API usage counters (`foxess`, `amber`, `weather`, timestamps). |
| `quickControl/state` | Active quick-control override (`type`, `power`, `expiresAt`, metadata). |
| `curtailment/state` | Curtailment feature state (`active`, threshold/price snapshot, transition metadata). |
| `cache/inverter` | Cached inverter summary telemetry (TTL-based). |
| `cache/inverter-realtime` | Cached full inverter real-time payload (TTL-based). |
| `cache/weather` | Cached weather forecast payload (TTL-based). |
| `cache/amber_sites` | Cached Amber site list. |
| `cache/amber_current_{siteId}` | Cached Amber current price payload per site. |
| `cache/amber_{siteId}` | Cached Amber historical/materialized price payload per site. |
| `cache/history_{sn}_{begin}_{end}` | Cached FoxESS history query chunks by serial and time window. |

### Notes

- Cache and audit documents store `ttl` where configured for Firestore TTL cleanup policies.
- User deletion endpoints now remove the full user document tree recursively, covering all subcollections above.

---

## Cloud Scheduler

Automation runs automatically via Cloud Scheduler (configured in `functions/index.js`):

```javascript
exports.runAutomation = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    // Evaluate rules for all users
  });
```

No additional setup needed - Firebase handles scheduling automatically.

---

## Troubleshooting

### Deployment Fails

**"Functions failed to deploy"**
```bash
# Check function logs
firebase functions:log

# Verify syntax
cd functions && node -c index.js
```

**"Permission denied"**
```bash
# Ensure you're logged in to the correct account
firebase logout
firebase login
```

### Functions Not Working

**"401 Unauthorized"**
- Check that Firebase Auth is initialized in frontend
- Verify ID token is being sent in Authorization header

**"Rate limit exceeded" (errno 41808)**
- FoxESS API has rate limits (~60 req/hour)
- Wait 5 minutes before retrying
- Check cache TTLs are working

### Frontend Issues

**"Firebase not defined"**
- Check firebase-config.js is loaded before other scripts
- Verify Firebase SDK URLs in HTML

**"API calls failing"**
- Check Network tab for errors
- Verify `/api/*` rewrites in firebase.json

---

## Updating

```bash
# Pull latest changes
git pull

# Update dependencies
cd functions && npm install && cd ..

# Deploy
firebase deploy
```

---

## Security Notes

1. **Never commit API keys** - Users enter their own keys in Settings
2. **Firestore rules** protect per-user data isolation
3. **All API calls** require Firebase authentication
4. **HTTPS only** - Firebase Hosting enforces SSL
