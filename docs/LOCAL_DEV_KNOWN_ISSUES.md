# Local Dev Known Issues (Avoid Repeat Incidents)

This runbook captures recurring local issues and the exact fixes.

## 1) Emulators Start Then Disappear / `ECONNREFUSED` (especially Auth `9099`)

### Symptoms
- Emulator table prints as ready, then local requests fail (`ERR_CONNECTION_REFUSED`).
- Seeding fails with `connect ECONNREFUSED 127.0.0.1:9099`.
- Only Firestore/PubSub Java processes remain.
- Browser console shows static asset failures from hosting emulator, e.g. `GET http://localhost:5000/js/*.js net::ERR_CONNECTION_REFUSED`.
- Firebase login call fails with `POST http://127.0.0.1:9099/... net::ERR_CONNECTION_REFUSED`.

### Confirmed Findings (March 5, 2026)
- Port `4000` (Emulator UI) can be reachable before Auth/Functions/Hosting are actually ready.
- Seeding immediately after UI readiness can fail with `ECONNREFUSED 127.0.0.1:9099`.
- Orphan Java processes on `8080`/`8085` are common after interrupted runs and block subsequent restarts.
- Multiple emulator instances for the same project produce hub warnings and non-deterministic behavior.
- Functions warning about `engines.node=22` vs host `node=25` is noisy but was not the direct cause of reseed failures.
- Auth SDK warning `You are using the Auth Emulator...` is expected in local dev and not a failure signal.
- On some Windows/Node setups, `npx` is not on PATH for detached child processes even when `npm` works in the shell.

### Root Causes
- Java runtime not on active shell `PATH` (macOS stub `java` used instead of Homebrew OpenJDK).
- Readiness check was too weak (UI only) and allowed seed to run before Auth was listening.
- Emulator suite launched from a short-lived shell/session that exits and kills parent `firebase` process.
- Emulator launcher using `spawn('npx', ...)` can fail with `spawn npx ENOENT` in detached mode on Windows.

### 2026-03-06 Hardening Update
- `scripts/emulator-cli.js` now tries multiple launch strategies:
  - Windows: `npx.cmd ...` then `npm.cmd exec -- ...`
  - macOS/Linux: `npx ...` then `npm exec -- ...`
- This removes the prior dependency on a single `npx` binary path and makes `npm run emu:reset` resilient across local shells.

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
- Verify listeners are up before clear/seed:
```bash
lsof -nP -iTCP:4000,5000,5001,8080,8085,9099 -sTCP:LISTEN
```

### Deterministic Restart + Reseed (macOS/zsh)
Run from repo root:

```bash
# 1) Clean leftover listeners from previous failed runs
for p in 4000 4400 4500 5000 5001 8080 8085 9099 9150 9299 9499; do
  lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | xargs -r kill -9
done

# 2) Ensure Java is available for Firestore/PubSub
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
export JAVA_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"

# 3) Start emulators in this terminal and keep it open
npx firebase emulators:start --only functions,firestore,hosting,auth,pubsub --import=./emulator-state --export-on-exit
```

In a second terminal, wait until all required services are listening, then clear + seed:

```bash
for p in 4000 5000 5001 8080 8085 9099; do
  until lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
  done
done

FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
node functions/scripts/clear-firestore.js

FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
node functions/scripts/seed-emulator-state.js

curl -sf http://127.0.0.1:5000/api/config/setup-status
```

### Anti-Pattern (Do Not Repeat)
- Do not treat `http://127.0.0.1:4000` responding as full emulator readiness.
- Do not run clear/seed until `9099` (Auth) and `5001` (Functions) are listening.
- Do not start a second emulator instance while one is already running for `inverter-automation-firebase`.

### 60-Second Triage
```bash
npm run emu:status
npm run emu:reset
```

If `emu:status` reports any required port as `FREE`, the app will fail with `ERR_CONNECTION_REFUSED` until reset/start succeeds.

If reset fails with a launcher error (legacy clones before hardening), run:
```bash
npm run emu:stop
npm exec -- firebase emulators:start --only functions,firestore,hosting,auth,pubsub --import=./emulator-state --export-on-exit
```
Then in a second terminal:
```bash
npm run emu:seed
npm run emu:status
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
