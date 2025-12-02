# Firebase Deployment Guide

This guide covers deploying the Inverter App to Firebase for production use with multi-user support.

## Prerequisites

1. **Node.js 18+** installed
2. **Firebase CLI** installed: `npm install -g firebase-tools`
3. **Firebase Project** created at [Firebase Console](https://console.firebase.google.com)

## Quick Start

```bash
# 1. Install dependencies
cd functions && npm install && cd ..

# 2. Login to Firebase
firebase login

# 3. Update .firebaserc with your project ID
# Edit .firebaserc and replace "your-firebase-project-id" with your actual project ID

# 4. Update frontend/js/firebase-config.js with your Firebase config
# Get config from Firebase Console > Project Settings > Your apps > Web app

# 5. Deploy everything
firebase deploy
```

## Detailed Setup

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Add Project"
3. Enter project name (e.g., "inverter-app")
4. Enable Google Analytics (optional)
5. Create project

### 2. Enable Firebase Services

In Firebase Console, enable these services:

#### Authentication
1. Go to **Authentication > Sign-in method**
2. Enable **Email/Password**
3. Enable **Google** (optional but recommended)

#### Firestore Database
1. Go to **Firestore Database**
2. Click "Create database"
3. Choose **Production mode** (our security rules will be deployed)
4. Select your preferred region (e.g., `australia-southeast1`)

#### Hosting
1. Go to **Hosting**
2. Click "Get started" (the CLI will handle the rest)

### 3. Configure the Project

#### Update `.firebaserc`
```json
{
  "projects": {
    "default": "YOUR_ACTUAL_PROJECT_ID"
  }
}
```

#### Update `frontend/js/firebase-config.js`
Get your config from Firebase Console > Project Settings > General > Your apps > Web app:

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

### 4. Set Environment Variables (Secrets)

Store API keys securely using Firebase Functions config:

```bash
# Set FoxESS credentials
firebase functions:config:set foxess.token="YOUR_FOXESS_TOKEN"
firebase functions:config:set foxess.base_url="https://www.foxesscloud.com"

# Set Amber credentials  
firebase functions:config:set amber.api_key="YOUR_AMBER_API_KEY"
firebase functions:config:set amber.base_url="https://api.amber.com.au/v1"

# Set notification config (optional)
firebase functions:config:set smtp.host="smtp.example.com"
firebase functions:config:set smtp.port="587"
firebase functions:config:set smtp.user="user@example.com"
firebase functions:config:set smtp.pass="password"
```

View current config:
```bash
firebase functions:config:get
```

### 5. Deploy

```bash
# Deploy everything (hosting, functions, firestore rules)
firebase deploy

# Or deploy individually
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

### 6. Set Up Cloud Scheduler

The automation runs every minute via Cloud Scheduler. It's configured in `functions/index.js` using `functions.pubsub.schedule()`. No additional setup needed—Firebase handles this automatically.

## Local Development

### Use Firebase Emulators

```bash
# Install emulators
firebase init emulators

# Start emulators
firebase emulators:start
```

Emulator UI available at: http://localhost:4000

### Local Functions Testing

```bash
cd functions
npm run serve
```

### Environment Variables for Local Dev

Create `functions/.env` for local testing:
```env
FOXESS_TOKEN=your_token
AMBER_API_KEY=your_key
```

Or use `.runtimeconfig.json`:
```bash
firebase functions:config:get > functions/.runtimeconfig.json
```

## Project Structure

```
/
├── firebase.json              # Firebase project config
├── .firebaserc                # Project aliases
├── firestore.rules            # Firestore security rules
├── firestore.indexes.json     # Firestore indexes
├── frontend/                  # Static hosting files
│   ├── index.html             # Main dashboard
│   ├── login.html             # Auth page
│   └── js/
│       ├── firebase-config.js # Firebase client config
│       ├── firebase-auth.js   # Auth module
│       └── api-client.js      # API client
└── functions/                 # Cloud Functions
    ├── package.json
    ├── index.js               # All functions
    └── .eslintrc.js
```

## Firestore Schema

```
users/{userId}
  ├── email: string
  ├── displayName: string
  ├── createdAt: timestamp
  ├── config/main              # User configuration
  │     ├── deviceSn: string
  │     ├── foxessToken: string
  │     ├── amberApiKey: string
  │     └── ...
  ├── automation/state         # Automation state
  │     ├── enabled: boolean
  │     ├── lastCheck: timestamp
  │     └── activeRule: string
  ├── rules/{ruleId}           # Automation rules
  │     ├── name: string
  │     ├── enabled: boolean
  │     ├── priority: number
  │     ├── conditions: object
  │     └── action: object
  ├── history/{historyId}      # Action history
  │     ├── type: string
  │     ├── timestamp: timestamp
  │     └── ...
  └── notifications/{notificationId}

cache/shared                   # Shared API cache
  ├── amber: array
  ├── amberUpdatedAt: number
  ├── weather: object
  └── weatherUpdatedAt: number

settings/{settingId}           # Global settings (admin only)
metrics/{metricId}             # API metrics (admin only)
```

## Security Rules Summary

- Users can only read/write their own data
- Admins (custom claim) can read all user profiles
- Shared cache is read-only for users (functions write)
- Global settings require admin
- History entries are immutable (no updates)

## Cost Optimization

### Free Tier Limits (Spark Plan)
- Hosting: 10GB/month bandwidth
- Functions: 2M invocations/month
- Firestore: 50K reads, 20K writes/day
- Auth: Unlimited

### Blaze Plan (Pay-as-you-go)
Upgrade for:
- Cloud Scheduler (required for automation)
- More function invocations
- Higher Firestore limits

### Cost Reduction Tips
1. **Batch Firestore writes** - The shared cache pattern reduces per-user reads
2. **Increase automation interval** - Default 60s, can increase to 120s+
3. **Cache aggressively** - Weather cached for 30 min, Amber for 60s
4. **Use Firestore indexes** - Defined in `firestore.indexes.json`

## Monitoring

### Firebase Console
- **Functions** - View logs, errors, invocation counts
- **Firestore** - Monitor reads/writes
- **Hosting** - Bandwidth, request stats
- **Authentication** - User counts, sign-in methods

### Set Up Alerts
1. Go to Cloud Monitoring (via Firebase Console)
2. Create alert policies for:
   - Function errors
   - High latency
   - Quota usage

## Troubleshooting

### "Permission Denied" Errors
- Check Firestore security rules
- Ensure user is authenticated
- Verify ID token is being sent in requests

### Functions Not Running
- Check Cloud Scheduler is enabled
- View function logs: `firebase functions:log`
- Ensure Blaze plan for scheduled functions

### Auth Issues
- Verify Firebase config in `firebase-config.js`
- Check authorized domains in Firebase Console > Authentication > Settings

### CORS Errors
- Functions use `cors({ origin: true })` to allow all origins
- For production, restrict to your domain

## Upgrading from Local Backend

1. Users migrate their API keys to their Firestore profile
2. Automation rules need to be recreated (or migrated via script)
3. History is per-user now, old global history won't migrate

## Support

For issues:
1. Check Firebase Console logs
2. Review `functions/index.js` for API endpoints
3. Test with emulators before deploying
