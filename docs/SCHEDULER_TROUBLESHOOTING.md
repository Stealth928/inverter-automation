# Scheduler Troubleshooting Guide

## Issue: API Counters Not Increasing When Browser is Closed

### Symptoms
- Automation works fine when browser/tab is open
- API counters increase during manual interactions
- When browser is closed, API counters stop increasing
- Automation appears to stop working

### Root Cause
The Cloud Functions scheduler (`runAutomation`) IS running every minute, but it's skipping your user because **automation is disabled** in Firestore.

### How the Scheduler Works

1. **Cloud Scheduler** triggers `runAutomation` function every 1 minute (server-side, independent of browser)
2. For each user, the function checks:
   - Is automation enabled? (`users/{uid}/automation/state` → `enabled: true`)
   - Has enough time elapsed since last check? (based on `intervalMs` config)
   - Does user have a device configured?
3. If all checks pass, it triggers an automation cycle
4. The cycle makes API calls (FoxESS, Amber, Weather) which increment counters

### Checking Scheduler Status

#### View Recent Scheduler Logs
```powershell
firebase functions:log --only runAutomation | Select-Object -First 30
```

Look for lines like:
```
[Scheduler] 1 users: 0 cycles, 0 too soon, 1 disabled, 0 errors
```

- `0 cycles` = no automation cycles ran
- `1 disabled` = 1 user has automation disabled ⚠️ THIS IS THE PROBLEM
- `0 too soon` = users who were checked too recently (throttled)
- `0 errors` = no errors occurred

#### Check Which Functions Are Deployed
```powershell
firebase functions:list
```

You should see:
- `api` (v2, https trigger) - API endpoints
- `runAutomation` (v2, **scheduled trigger**) - Background automation

### Solution: Enable Automation

#### Method 1: Via Frontend UI (Recommended)
1. Login to your app (control.html or settings.html)
2. Find the "Enable Automation" toggle/button
3. Turn it ON
4. Wait 1-2 minutes and check logs again

#### Method 2: Via Firebase Console
1. Open Firebase Console → Firestore Database
2. Navigate to: `users/{your-uid}/automation/state`
3. Edit the document
4. Set `enabled: true` (currently it's likely `false`)
5. Save

#### Method 3: Via Script (Advanced)
Use the provided `check-automation-state.js` script:

```powershell
cd d:\inverter-automation
node check-automation-state.js YOUR_USER_ID
```

### Verification

After enabling automation, check logs again:
```powershell
firebase functions:log --only runAutomation | Select-Object -First 30
```

You should now see:
```
[Scheduler] 1 users: 1 cycles, 0 too soon, 0 disabled, 0 errors
```

- `1 cycles` = automation cycle ran! ✅
- `0 disabled` = no users disabled ✅

### Understanding Firestore Structure

```
users/{uid}/
  ├── automation/
  │   └── state (document)
  │       ├── enabled: true/false        ← Master automation switch
  │       ├── lastCheck: timestamp       ← Last time scheduler checked this user
  │       ├── lastTriggered: timestamp   ← Last time a rule was triggered
  │       └── activeRule: object         ← Currently active rule (if any)
  │
  ├── rules/ (collection)
  │   ├── rule_1 (document)
  │   ├── rule_2 (document)
  │   └── ...
  │
  ├── metrics/ (collection)
  │   └── YYYY-MM-DD (document)
  │       ├── foxess: count
  │       ├── amber: count
  │       └── weather: count
  │
  └── config/
      └── main (document)
          ├── deviceSn: "..."
          ├── foxessApiKey: "..."
          └── amberApiKey: "..."
```

### Common Issues

#### 1. Automation Disabled
**Symptom:** Logs show `X disabled`
**Solution:** Enable automation via UI or Firestore

#### 2. Too Soon
**Symptom:** Logs show `X too soon`
**Explanation:** Normal behavior. Scheduler runs every 1 minute, but each user has their own interval (default 60s). If less than 60s has passed since last check, user is skipped.

#### 3. No Device Configured
**Symptom:** Automation enabled but no cycles run
**Check:** Ensure `users/{uid}/config/main` has `deviceSn` set

#### 4. No Rules
**Symptom:** Cycles run but nothing happens
**Check:** Ensure `users/{uid}/rules/` collection has at least one rule

#### 5. Blackout Window
**Symptom:** During certain hours, no rules trigger
**Check:** Rules have `blackoutWindows` configuration that prevents execution during specified times

### Monitoring Commands

```powershell
# Check scheduler status
firebase functions:log --only runAutomation | Select-Object -First 30

# Check API function logs
firebase functions:log --only api | Select-Object -First 50

# List deployed functions
firebase functions:list

# Check local emulator (for testing)
npm --prefix functions run serve
```

### API Counters Explained

API counters are stored per-user per-day:
```
users/{uid}/metrics/YYYY-MM-DD
  ├── foxess: 123
  ├── amber: 45
  └── weather: 12
```

They increment when:
- Scheduler makes API calls during automation cycles
- User makes manual API calls via UI
- Any authenticated API endpoint calls FoxESS/Amber/Weather APIs

If counters aren't increasing:
1. ✅ Check scheduler is running: `firebase functions:log --only runAutomation`
2. ✅ Check automation is enabled: Firestore `users/{uid}/automation/state`
3. ✅ Check rules exist: Firestore `users/{uid}/rules/`
4. ✅ Check device is configured: Firestore `users/{uid}/config/main`

### Need More Help?

Enable verbose logging by setting log level to DEBUG in Firebase Console:
1. Go to Cloud Functions → runAutomation → Logs
2. Set minimum log level to DEBUG
3. Watch real-time logs

Or run locally with emulator:
```powershell
cd d:\inverter-automation\functions
npm run serve
```

Then check emulator logs at: http://localhost:4000
