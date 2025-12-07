# Setup & Deployment Guide

## Quick Start

### Prerequisites
- Node.js 18+ installed
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

Users configure their own API keys in the Settings page after login.

### FoxESS Cloud API
1. Go to [FoxESS Cloud](https://www.foxesscloud.com)
2. Login with your FoxESS account
3. Go to **User Center > API Management**
4. Generate API key
5. Note your inverter Serial Number

### Amber Electric API
1. Go to [Amber Developer Portal](https://app.amber.com.au/developers)
2. Login with your Amber account
3. Generate API token
4. Copy the token (shown once)

---

## Local Development

### Option 1: Firebase Emulators (Recommended)

```bash
# Start functions emulator
firebase emulators:start --only functions

# In another terminal, serve frontend
cd frontend
python -m http.server 8000
```

- Frontend: http://localhost:8000
- Functions: http://localhost:5001
- Emulator UI: http://localhost:4000

### Option 2: Full Emulator Suite (Requires Java)

```bash
# Install Java 11+, then:
firebase emulators:start
```

This runs Auth, Firestore, and Functions emulators.

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
│   └── index.js            # All API endpoints
│
└── docs/                   # Documentation
    ├── AUTOMATION.md       # Automation rules documentation
    ├── API.md              # API reference
    └── SETUP.md            # This file
```

---

## Firestore Schema

```
users/{userId}/
  ├── profile               # User profile
  │   ├── email
  │   ├── displayName
  │   └── createdAt
  │
  ├── config/main           # User configuration
  │   ├── deviceSn
  │   ├── foxessToken
  │   ├── amberApiKey
  │   ├── amberSiteId
  │   └── location
  │
  ├── automation/state      # Automation state
  │   ├── enabled
  │   ├── lastCheck
  │   ├── activeRule
  │   └── activeUntil
  │
  ├── rules/{ruleId}        # Automation rules
  │   ├── name
  │   ├── enabled
  │   ├── priority
  │   ├── conditions
  │   └── action
  │
  └── history/{docId}       # Automation history
      ├── timestamp
      ├── type
      ├── rule
      └── result

Per-user caches at `users/{uid}/cache/`:
  ├── inverter               # Real-time inverter telemetry (5-min TTL)
  ├── weather                # Weather forecast data (30-min TTL)
  └── history_*              # Historical power data chunks (30-min TTL)

Global caches:
  └── amber_prices/{siteId}  # Electricity pricing by site (24-hr TTL)
```

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
