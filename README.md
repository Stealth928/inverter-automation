# Inverter Project - Production Ready

## Overview
This project is a production-ready, multi-user solar inverter automation and monitoring system. It features:
- **Firebase Authentication** for user management
- **Firestore Database** for per-user data persistence
- **Cloud Functions** for serverless API and automation
- **Firebase Hosting** for the frontend
- **Scalable architecture** for 10s-100s+ users

---

## Tech Stack

### Backend (Cloud Functions)
- **Node.js 20**: Cloud Functions runtime
- **Firebase Admin SDK**: Firestore, Auth verification
- **Express.js**: API routing
- **External APIs**:
  - **FoxESS**: Solar inverter data and control
    - Important: FoxESS uses a non-standard signature format. The signature must be computed using literal "\\r\\n" sequences (backslash-r-backslash-n), not actual CRLF bytes. See `CONFIGURATION.md` → "FoxESS API authentication / signature" for exact details and examples.
  - **Amber**: Energy price and market data
  - **Open-Meteo**: Weather data

### Frontend (Firebase Hosting)
- **HTML/CSS/JavaScript**: Static UI
- **Firebase Auth SDK**: User authentication
- **Firestore SDK**: Real-time data sync
- **Responsive Design**: Desktop and mobile

### Database (Firestore)
- **Per-user collections**: Config, rules, history, automation state
- **Shared cache**: External API data (Amber, Weather)
- **Security rules**: Row-level access control

## DevOps

- **Firebase CLI**: Deploy hosting, functions, rules
- **Cloud Scheduler**: Automated tasks (every minute)
- **Secret Manager**: API keys and credentials

> Note: This repository originally included Docker-based configs. The project has been decoupled from Docker — Dockerfiles and compose files were removed to simplify local development. You can run everything locally without containers.
---

## Architecture

### High-Level Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                         Firebase                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Hosting    │  │  Cloud       │  │    Firestore         │  │
│  │  (Frontend)  │  │  Functions   │  │   (Database)         │  │
│  │              │  │  (API)       │  │                      │  │
│  │  login.html  │  │              │  │  /users/{uid}/...    │  │
│  │  index.html  │──│  /api/*      │──│  /cache/shared       │  │
│  │  settings    │  │              │  │  /settings           │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                           │                                      │
│                    ┌──────┴──────┐                              │
│                    │   Cloud     │                              │
│                    │  Scheduler  │                              │
│                    │ (every 1m)  │                              │
│                    └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌─────────┐
        │ FoxESS  │  │  Amber  │  │ Weather │
        │   API   │  │   API   │  │   API   │
        └─────────┘  └─────────┘  └─────────┘
```

### Data Flow
1. **User signs in** via Firebase Auth (email/password or Google)
2. **Frontend loads** user config from Firestore
3. **API calls** go through Cloud Functions with auth verification
4. **Automation runs** every minute via Cloud Scheduler
5. **Shared cache** reduces external API calls across all users
6. **Per-user rules** evaluated against cached data
7. **Actions logged** to user's history collection

---

## Key Files & Structure

```
├── firebase.json              # Firebase project config
├── .firebaserc                # Project ID mapping
├── firestore.rules            # Security rules
├── firestore.indexes.json     # Database indexes
├── FIREBASE_SETUP.md          # Deployment guide
│
├── frontend/                  # Firebase Hosting
│   ├── index.html             # Main dashboard
│   ├── login.html             # Authentication page
│   ├── settings.html          # User settings
│   └── js/
│       ├── firebase-config.js # Firebase client config
│       ├── firebase-auth.js   # Auth module
│       └── api-client.js      # Authenticated API client
│
├── functions/                 # Cloud Functions
│   ├── package.json           # Dependencies
│   ├── index.js               # All functions
│   └── .eslintrc.js           # Linting config
│
└── backend/                   # Legacy local server (for dev)
    ├── server.js              # Express server
    ├── config.json            # Local config
    └── ...
```

---

## Firestore Schema

```
users/{userId}
  ├── email, displayName, createdAt
  ├── config/main           # API keys, device SN, preferences
  ├── automation/state      # Enabled, lastCheck, activeRule
  ├── rules/{ruleId}        # Priority, conditions, actions
  ├── history/{id}          # Immutable action log
  └── notifications/{id}    # User notifications

cache/shared                # Written by Cloud Functions only
  ├── amber, amberUpdatedAt
  └── weather, weatherUpdatedAt

settings/{id}               # Admin-only global config
metrics/{id}                # API call tracking
```

---

## Quick Start

### Local Development (no Docker required)
```bash
# 1. Start the local backend (for testing without Firebase)
cd backend
npm install
npm start

Backend notes
- The backend server binds to port 3000 by default. If port 3000 is already in use you will see an EADDRINUSE error — stop the conflicting process or change the port in `backend/server.js`.
- The backend requires some environment variables for certain integrations (for example `FOXESS_TOKEN`) — you can place these in a `.env` file in `backend/` or configure secrets when deploying functions.

# 2. Frontend (local preview)
The frontend is static and served from `frontend/`. You can open `frontend/index.html` directly in a browser for a quick preview, or use a simple local server such as `http-server` or VS Code Live Server.

Quick local server (recommended):
```powershell
# install a local static server once
npm install -g http-server

# from the project root, serve the frontend
cd frontend
http-server -p 5000

# open http://localhost:5000
```
```

### Firebase Deployment
```bash
# 1. Install Firebase CLI
npm install -g firebase-tools

# 2. Login and set project
firebase login
firebase use your-project-id

# 3. Configure secrets
firebase functions:config:set foxess.token="YOUR_TOKEN" amber.api_key="YOUR_KEY"

# 4. Update frontend/js/firebase-config.js with your project config

## 5. Deploy everything
firebase deploy

Important: Cloud Functions require a Blaze (pay-as-you-go) billing plan in order to enable certain Google Cloud APIs (for example `cloudbuild.googleapis.com`) when deploying. If your project is on the free Spark plan you'll see an error asking you to upgrade — upgrade in the Firebase Console before attempting to deploy functions.

If you only want to deploy static hosting and Firestore rules (no functions) you can deploy without Blaze:
```powershell
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

Local emulator (recommended for development — no Blaze upgrade required):
```powershell
# Start hosting, functions, firestore and auth emulators
firebase emulators:start
```
```

See `FIREBASE_SETUP.md` for detailed deployment instructions.

---

## Security

- **Authentication required** for all API endpoints
- **Per-user data isolation** via Firestore security rules
- **Admin-only** global settings and metrics
- **API keys stored** in Firebase Functions config (not client)
- **HTTPS enforced** on all Firebase services
- **Token refresh** every 50 minutes

---

## Cost Optimization

| Service | Free Tier | Your Usage (100 users) |
|---------|-----------|------------------------|
| Hosting | 10GB/month | ~1GB/month |
| Functions | 2M invocations | ~4M/month (~$1) |
| Firestore | 50K reads/day | ~10K reads/day |
| Auth | Unlimited | 100 users |

**Estimated monthly cost for 100 users: ~$1-5**

---

## Extensibility & Roadmap

- [x] Firebase Auth integration
- [x] Firestore per-user data
- [x] Cloud Functions API
- [x] Scheduled automation
- [x] Shared API caching
- [ ] Push notifications
- [ ] Admin dashboard
- [ ] Usage analytics
- [ ] Rate limiting per user
- [ ] Custom alert rules

---

## Contact & Support
See the FAQ section in the dashboard or create an issue on GitHub.
