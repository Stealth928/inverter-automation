# Inverter Automation

A production-ready, multi-user solar inverter automation system that optimizes energy usage based on electricity prices, weather conditions, and battery state.

## Features

- **Smart Battery Management**: Automatically charge when prices are low, discharge when prices are high
- **Amber Price Integration**: Real-time and forecast electricity prices
- **Weather-Aware**: Adjust behavior based on current weather conditions
- **Rule-Based Automation**: Create custom rules with multiple conditions
- **Multi-User**: Per-user authentication and data isolation
- **Serverless**: Firebase-powered, no servers to manage

## Quick Start

```bash
# Install dependencies
cd functions && npm install && cd ..

# Login to Firebase
firebase login

# Deploy
firebase deploy
```

See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | **⚡ CRITICAL: Pre-deployment checklist & quality control** |
| [docs/AUTOMATION.md](docs/AUTOMATION.md) | **Automation rules engine** - conditions, actions, examples |
| [docs/API.md](docs/API.md) | **API reference** - all endpoints and parameters |
| [docs/SETUP.md](docs/SETUP.md) | **Setup guide** - deployment and configuration |
| [docs/FOXESS_SCHEDULER_REORDERING.md](docs/FOXESS_SCHEDULER_REORDERING.md) | FoxESS API quirks and workarounds |
| [TESTING_GUIDE.md](TESTING_GUIDE.md) | **Testing guide** - how to run tests, current coverage, known gaps |

## Architecture

```
                      +----------------------+
                      |      Firebase        |
          +-----------+-----------+----------+
          | Hosting (UI) | Cloud Functions   |
          | (frontend)   | (API + scheduler) |
          +--------------+-------------------+
                         |
                    +----+----+
                    | Firestore|
                    | Database |
                    +----+----+
                         |
    +--------------------+--------------------+
    |                    |                    |
 FoxESS API        Amber API            Weather API
 (device data)     (price data)        (forecast data)
```

## Project Structure

```
inverter-automation/
|-- firebase.json            # Firebase configuration
|-- .firebaserc              # Firebase project metadata
|-- firestore.rules          # Security rules
|-- firestore.indexes.json   # Firestore indexes
|-- frontend/                # Static web app
|   |-- index.html           # Dashboard
|   |-- login.html           # Authentication UI
|   |-- settings.html        # User settings UI
|   |-- history.html         # History & reports
|   |-- css/
|   |-- js/
|-- functions/               # Cloud Functions (API)
|   |-- index.js             # HTTP handlers and schedulers
|   |-- package.json
|-- docs/                    # Documentation
|   |-- AUTOMATION.md
|   |-- API.md
|   |-- SETUP.md
|   |-- FOXESS_SCHEDULER_REORDERING.md
|-- archive/                 # Deprecated files (not deployed)
```

## Tech Stack

- **Backend**: Node.js 20, Firebase Cloud Functions, Express.js
- **Frontend**: HTML/CSS/JavaScript, Firebase Auth SDK
- **Database**: Cloud Firestore
- **Hosting**: Firebase Hosting
- **External APIs**: FoxESS Cloud, Amber Electric, Open-Meteo

## How It Works

1. **User signs up** via Firebase Auth
2. **Configures API keys** in Settings (FoxESS, Amber)
3. **Creates automation rules** with conditions:
   - Price thresholds (current and forecast)
   - Battery state of charge
   - Weather conditions
   - Time windows
4. **Cloud Scheduler** runs every minute:
   - Fetches live data from all APIs
   - Evaluates rules in priority order
   - First matching rule triggers
   - Configures inverter scheduler segment
5. **Dashboard** shows real-time status and debug info

## Automation Conditions

| Condition | Description |
|-----------|-------------|
| **Feed-in Price** | Current Amber feed-in (export) price |
| **Buy Price** | Current Amber buy (import) price |
| **Forecast Price** | Future Amber prices (15/30/60 min) |
| **Battery SoC** | Current state of charge (%) |
| **Temperature** | Battery, ambient, or inverter temp |
| **Weather** | Sunny, cloudy, rainy conditions |
| **Time Window** | Specific hours of the day |

## Work Modes

| Mode | Description |
|------|-------------|
| **SelfUse** | Prioritize self-consumption |
| **ForceDischarge** | Export battery to grid |
| **ForceCharge** | Charge from grid |
| **Backup** | Preserve battery for backup |

## Example Rules

### Export when feed-in price is high
```javascript
{
  name: "High Feed-in Export",
  conditions: {
    feedInPrice: { enabled: true, operator: '>', value: 30 },
    soc: { enabled: true, operator: '>', value: 80 }
  },
  action: {
    workMode: "ForceDischarge",
    durationMinutes: 30,
    fdPwr: 5000
  }
}
```

### Charge when electricity is cheap
```javascript
{
  name: "Cheap Night Charge",
  conditions: {
    buyPrice: { enabled: true, operator: '<', value: 10 },
    time: { enabled: true, startTime: '00:00', endTime: '06:00' }
  },
  action: {
    workMode: "ForceCharge",
    durationMinutes: 60
  }
}
```

See [docs/AUTOMATION.md](docs/AUTOMATION.md) for complete rule documentation.

## Development

### Local Testing

```bash
# Start Firebase emulators
firebase emulators:start --only functions

# Serve frontend (separate terminal)
cd frontend && python -m http.server 8000
```

### Running Tests

```powershell
# Run all tests (backend + frontend)
.\run-tests.ps1

# Run specific test suites
.\run-tests.ps1 -Type unit          # Unit tests (Jest)
.\run-tests.ps1 -Type e2e           # End-to-end tests (requires e2e script)
.\run-tests.ps1 -Type auth          # Auth flow tests

# Run with authentication
.\run-tests.ps1 -Type e2e -AuthToken "your-firebase-id-token"

# Run against production
.\run-tests.ps1 -Type e2e -Prod -AuthToken "your-token"
```

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for complete testing documentation.

## ⚡ Quality Control & Deployment

**This is a production app with live users. Strict quality control is enforced.**

### Pre-Deployment Checklist

**ALWAYS run these before deploying:**

```bash
# 1. Run pre-deployment quality checks
npm --prefix functions run pre-deploy

# 2. Run full test suite  
npm --prefix functions test

# 3. Check logs for errors
firebase functions:log | tail -30

# 4. Deploy
firebase deploy --only functions
```

**The pre-deploy script verifies:**
- ✓ All Jest tests pass (current count in TESTING_GUIDE.md)
- ✓ No linting errors
- ✓ All critical modules properly imported/exported
- ✓ All critical routes defined and functional
- ✓ No common refactoring mistakes
- ✓ Firebase configuration correct

**If any check fails, deployment is blocked. Fix the issue first.**

### Automated Quality Control (GitHub Actions)

Every push to `main` automatically runs:
- Unit tests (Jest)
- Linting (ESLint)
- Module verification
- Security audit

See [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) for the complete deployment and quality control guide.

### Deployment

```bash
# Single-step safe deployment (runs all checks first)
npm --prefix functions run pre-deploy && firebase deploy --only functions

# Or manually check then deploy
firebase deploy                    # Deploy everything
firebase deploy --only functions   # Deploy functions only
firebase deploy --only hosting     # Deploy frontend only
```

## License

MIT
