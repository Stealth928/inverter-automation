# Local Dev Known Issues (Avoid Repeat Incidents)

This runbook captures recurring local issues and the exact fixes.

## 1) Emulators Start Then Disappear / `ECONNREFUSED` (especially Auth `9099`)

### Symptoms
- Emulator table prints as ready, then local requests fail (`ERR_CONNECTION_REFUSED`).
- Seeding fails with `connect ECONNREFUSED 127.0.0.1:9099`.
- Only Firestore/PubSub Java processes remain.

### Root Causes
- Java runtime not on active shell `PATH` (macOS stub `java` used instead of Homebrew OpenJDK).
- Emulator suite launched from a short-lived shell/session that exits and kills parent `firebase` process.

### Prevention
- Use explicit Java env before startup:
```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"
```
- Start emulators in a persistent terminal tab/window:
```bash
firebase emulators:start --only functions,firestore,hosting,auth,pubsub --project inverter-automation-firebase
```
- Verify listeners are up:
```bash
lsof -nP -iTCP:4000,5000,5001,8080,8085,9099 -sTCP:LISTEN
```

## 2) “No Test Data” In UI

### Symptoms
- Local app loads but expected seeded user/rules/config are missing.

### Common Causes
- Seeding not run successfully after emulator restart.
- Logged into a different account instead of emulator test user.

### Fix
- Seed explicitly:
```bash
cd functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=inverter-automation-firebase \
node scripts/seed-emulator-state.js
```
- Use local test login:
  - Email: `test@gmail.com`
  - Password: `123456`
- Verify setup endpoint:
```bash
curl http://127.0.0.1:5000/api/config/setup-status
```

## 3) Tour/UI Looks Old After Changes (stale assets)

### Symptoms
- Step numbers/content don’t match latest source.
- Highlight behavior reflects older selectors.

### Root Cause
- Browser service worker/static cache serving stale `tour.js` / shell assets.

### Prevention on every tour/UI change
- Bump `tour.js?v=...` in HTML files.
- Bump `CACHE_VERSION` in `frontend/sw.js`.
- Ensure SW cache cleanup deletes old caches (keep only active cache).

### Operator quick-fix (browser)
- Hard reload once.
- If still stale: DevTools → Application → Service Workers → Unregister, then reload.

## 4) Tour Highlight Targets Wrong Element

### Symptoms
- Spotlight appears on a single input/button instead of whole card.

### Prevention
- Use stable container selectors (`id`/`data-tour`) for tour steps.
- Avoid fragile selectors tied to dynamic inline markup or duplicated controls.
- Prefer section/card anchors:
  - `#credentialsSection`
  - `#blackoutSection`
  - `#curtailmentSection`
  - `#simConditionsCard`
  - `#simRunActions`
  - `[data-tour="automation-card"]`

