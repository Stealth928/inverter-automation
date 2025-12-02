# Local Testing Guide

## Prerequisites
- Node.js v20+ installed
- Firebase CLI installed (`npm install -g firebase-tools`)
- Google Chrome or similar browser
- (Optional) Java 11+ if you want full emulator suite (auth, firestore, hosting)

## Quick Start - Functions Emulator Only (No Java Required)

### 1. Start the Functions Emulator
```bash
cd d:\inverter-automation
firebase emulators:start --only functions --project inverter-automation-firebase
```

The emulator will output:
```
✔ All emulators ready! It is now safe to connect your app.

Emulator Hub host: 127.0.0.1 port: 4400

Emulator  | Host:Port           | View in Emulator UI
Functions | 127.0.0.1:5001      | http://127.0.0.1:4000/functions
```

**Functions API endpoint**: `http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api`

### 2. Serve Frontend Locally (in separate terminal)
```bash
cd D:\inverter-automation
python -m http.server 8000 --directory D:\inverter-automation\frontend
```

Then open **http://127.0.0.1:8000** in your browser. Frontend will be served at:
- Login page: http://127.0.0.1:8000/login.html
- Dashboard: http://127.0.0.1:8000/index.html
- Setup: http://127.0.0.1:8000/setup.html

### 3. Test the Functions Endpoint Directly (Postman / curl)

#### Test unauthenticated health endpoint
```bash
curl http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api/api/health
```

Expected response:
```json
{"ok":true}
```

#### Test protected health endpoint (requires auth token)

Since we're using the functions emulator without auth emulator, you can:
1. **Option A**: Use Firebase client SDK in the browser to get a real idToken from production Firebase, then call the emulator function.
2. **Option B**: Create a simple test token locally for manual testing.

For now, **the browser-based signup/login flow will use production Firebase** (not the emulator), but the functions calls will hit the local emulator.

If you have Java installed and want the full emulator suite:
```bash
# Install Java 11 or later, then:
firebase emulators:start --project inverter-automation-firebase
```

This will start auth, firestore, hosting, functions all locally.

## 4. Test Browser Signup Flow (Using Production Auth)
1. Open http://127.0.0.1:8000/login.html
2. Click "Sign Up"
3. Create test account (e.g., test@example.com / password123)
4. The frontend will hit **production Firebase** to create the user
5. Once signed in, the frontend will call the **local functions emulator** at `http://127.0.0.1:5001/...`
6. You should see the dashboard load

### 5. Inspect Network Calls
Open DevTools (F12) → Network tab and you'll see:
- `POST` to production Firebase Auth (signUp endpoint)
- `GET` to local functions emulator `/api/config` (uses idToken from production)
- Other API calls to local functions emulator

## Full Emulator Suite (if Java is installed)

#### Get Auth Token
1. Sign up/in with emulator Firebase Auth
2. In browser console: `console.log(await firebaseAuth.getIdToken())`
3. Copy the token

#### Test API Call
```bash
curl -X GET http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api/api/health/auth \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
# {"ok":true,"user":"YOUR_UID"}
```

#### Test Password Reset
```bash
curl -X POST http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Expected response:
# {"errno":0,"msg":"If this email exists, a password reset link has been sent..."}
```

## Troubleshooting

### Functions not loading
```bash
# Check for syntax errors
cd functions
node -c index.js

# If still failing, check dependencies
npm install
npm audit fix
```

### Auth token not working
- Ensure token is from emulator Firebase (not production)
- Token expires after ~1 hour, get a fresh one
- Check Authorization header format: `Bearer TOKEN`

### Emulator UI not accessible
- Check if emulator is running: `ps aux | grep firebase`
- Try different port: `firebase emulators:start --only functions --functions-port 5002`

### Image loading issues in local testing
- Ensure image URLs in user profile are valid
- Avatar will fallback to initials if image fails (this is by design)

## Testing Checklist

- [ ] Functions load without errors
- [ ] Can create account
- [ ] Can sign in
- [ ] User document created in Firestore
- [ ] Can view setup page
- [ ] API endpoints respond to authenticated requests
- [ ] Forgot password form appears
- [ ] Avatar displays or falls back to initials

### Install Java
1. Download Java 11+ from [adoptopenjdk.net](https://adoptopenjdk.net/) or use `choco install openjdk` (if Chocolatey installed)
2. Verify installation:
```powershell
java -version
```

### Start Full Emulator Suite
```bash
cd D:\inverter-automation
firebase emulators:start --project inverter-automation-firebase
```

Then you can:
- Test auth emulator UI at http://127.0.0.1:4000/auth
- Test firestore emulator UI at http://127.0.0.1:4000/firestore
- Browser at http://127.0.0.1:5000 (hosting emulator with rewrites)

## Automated Testing (E2E Test Script)

A test script is provided (`test-emulator.js`) that validates all endpoints:

### Using PowerShell (Recommended)
```powershell
cd D:\inverter-automation
.\run-emulator-tests.ps1
```

This will:
1. Start the functions emulator in a minimized window
2. Wait 8 seconds for it to boot  
3. Run 5 automated tests against the endpoints
4. Report pass/fail results
5. Keep emulator running for manual testing

### Using Batch (Windows)
```cmd
cd D:\inverter-automation
run-emulator-tests.bat
```

### Manual Testing
You can also manually test endpoints while emulator is running:

```powershell
# Terminal 1: Start emulator
cd D:\inverter-automation
firebase emulators:start --only functions --project inverter-automation-firebase

# Terminal 2: Run tests (after ~8 seconds when "All emulators ready" appears)
cd D:\inverter-automation
node test-emulator.js
```

## Manual API Testing (with Functions Emulator)
