# Inverter Automation

A production-ready, multi-user solar inverter automation system that optimizes energy usage based on electricity prices, weather conditions, and battery state.

## Features

- **🔋 Smart Battery Management**: Automatically charge when prices are low, discharge when prices are high
- **💰 Amber Price Integration**: Real-time and forecast electricity prices
- **🌤️ Weather-Aware**: Adjust behavior based on current weather conditions
- **📊 Rule-Based Automation**: Create custom rules with multiple conditions
- **🔒 Multi-User**: Per-user authentication and data isolation
- **☁️ Serverless**: Firebase-powered, no servers to manage

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
| [docs/AUTOMATION.md](docs/AUTOMATION.md) | **Automation rules engine** - conditions, actions, examples |
| [docs/API.md](docs/API.md) | **API reference** - all endpoints and parameters |
| [docs/SETUP.md](docs/SETUP.md) | **Setup guide** - deployment and configuration |
| [docs/FOXESS_SCHEDULER_REORDERING.md](docs/FOXESS_SCHEDULER_REORDERING.md) | FoxESS API quirks and workarounds |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Firebase                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Hosting    │  │  Cloud       │  │    Firestore         │  │
│  │  (Frontend)  │  │  Functions   │  │   (Database)         │  │
│  │              │  │  (API)       │  │                      │  │
│  │  index.html  │──│  /api/*      │──│  /users/{uid}/...    │  │
│  │  settings    │  │              │  │  /cache/shared       │  │
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

## Project Structure

```
inverter-automation/
├── firebase.json           # Firebase configuration
├── .firebaserc             # Project ID
├── firestore.rules         # Security rules
├── firestore.indexes.json  # Database indexes
│
├── frontend/               # Static web files
│   ├── index.html          # Main dashboard
│   ├── login.html          # Authentication
│   ├── settings.html       # User settings
│   ├── history.html        # History & reports
│   ├── css/
│   └── js/
│
├── functions/              # Cloud Functions (API)
│   ├── index.js            # All endpoints
│   └── package.json
│
├── docs/                   # Documentation
│   ├── AUTOMATION.md       # Automation rules & logic
│   ├── API.md              # API reference
│   ├── SETUP.md            # Deployment guide
│   └── FOXESS_SCHEDULER_REORDERING.md
│
└── archive/                # Deprecated files (not deployed)
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

### Deployment

```bash
firebase deploy                    # Deploy everything
firebase deploy --only functions   # Deploy functions only
firebase deploy --only hosting     # Deploy frontend only
```

## License

MIT
