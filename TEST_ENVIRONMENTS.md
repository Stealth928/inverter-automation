# Test Suite: Environment & API Count Impact

## Quick Answer

| Test Type | Runs On | Calls Real APIs | Counts Against Quota |
|-----------|---------|-----------------|---------------------|
| **Unit Tests** | Local (Jest) | ❌ No | ❌ No |
| **Integration Tests** | Local Emulator or Production | ❌ No | ❌ No (checks auth/responses) |
| **E2E Tests (Default)** | Local Emulator | ❌ No | ❌ No |
| **E2E Tests (with -Prod flag)** | Production | ⚠️ Limited | ⚠️ Only 1 Amber call |

## Test Environments

### Unit Tests (`npm test`)
- **Where**: Runs on your local machine with Jest
- **Real APIs**: ❌ No - all APIs are mocked
- **API Calls**: ❌ Zero - no external calls made
- **Speed**: ⚡ < 1 second
- **Auth Required**: ❌ No

### Integration Tests (Default)
```powershell
npm --prefix functions run test:integration
# or
node functions/integration-test.js
```

- **Where**: Local Firebase Emulator (127.0.0.1:5001)
- **Real APIs**: ❌ No - emulator is local
- **API Calls**: ❌ Zero - doesn't hit production
- **Speed**: ⚡ Fast (1-2 seconds)
- **Auth Required**: ❌ No
- **Requires**: Emulator running locally first:
  ```powershell
  npm --prefix functions run serve
  ```

### Integration Tests (Production)
```powershell
.\run-tests.ps1 -Type integration -Prod
# or
$env:TEST_PROD='true'; node functions/integration-test.js
```

- **Where**: Production API (`api-etjmk6bmtq-uc.a.run.app`)
- **Real APIs**: ⚠️ Limited
- **API Calls**: ⚠️ Minimal - see below
- **Speed**: 🌐 2-5 seconds (network dependent)
- **Auth Required**: ❌ No
- **Counts Against Quota**: ⚠️ YES, but minimal impact

## What APIs Are Actually Called

### Integration Tests Against Production

Only **2 endpoints call external services**:

1. **`/api/amber/prices`** 
   - ✅ CALLS REAL AMBER API
   - 📊 **Counts: YES** (increments your daily Amber quota)
   - Returns: Empty array (no config provided)
   - Why: Test validates endpoint works without auth

2. **All other endpoints**
   - ❌ Returns error immediately (authentication required)
   - 📊 **Counts: NO** (errors don't count)
   - Examples: `/api/config/status`, `/api/weather`, `/api/automation/*`

### Impact on API Counts

Running integration tests against production **adds**:
- 1 Amber API call per test run (minimal impact)
- FoxESS: 0 calls
- Weather: 0 calls
- Automation: 0 calls (all require auth)

**Total cost**: ~1-2 Amber calls per test run (vs. actual usage which is hundreds per day)

## Recommended Test Strategy

### Development (Most of the time)
```powershell
# Fast, free, doesn't touch production
npm --prefix functions test
```

### Before Deployment
```powershell
# Run all tests - emulator tests are free, integration tests are minimal impact
.\run-tests.ps1
```

### Full Production Validation (occasionally)
```powershell
# Only if you really need to validate production behavior
.\run-tests.ps1 -Type integration -Prod
```

## Test Isolation Details

### Unit Tests (Fully Mocked)
```javascript
jest.mock('firebase-admin', () => {
  // Mock Firestore completely
  const mockFirestore = {
    collection: jest.fn(() => mockFirestore),
    doc: jest.fn(() => mockFirestore),
    get: jest.fn(),
    // ... etc
  };
  return { initializeApp: jest.fn(), firestore: jest.fn(() => mockFirestore) };
});
```

- Zero external calls
- No Firebase access
- No API quotas used
- Perfect for CI/CD

### Integration Tests (Emulator)
```javascript
const EMULATOR_URL = 'http://127.0.0.1:5001/...';
// Tests hit local emulator, not production
```

- Zero production impact
- Local Firebase emulator instance
- Local Node.js runtime
- Perfect for local development

### Integration Tests (Production)
```javascript
const PROD_URL = 'https://api-etjmk6bmtq-uc.a.run.app';
// Only when TEST_PROD=true
```

- Hits real API
- Minimal external API calls (only Amber for one test)
- Good for pre-deployment validation
- Use sparingly

## API Call Tracking Code

When external APIs are called, they're tracked:

```javascript
// In functions/index.js:
async function incrementApiCount(userId, apiType) {
  // Per-user daily count (for your billing)
  // Plus global daily count (platform metrics)
  
  // Called by these endpoints:
  // - /api/amber/prices → incrementApiCount(userId, 'amber')
  // - /api/foxess/* → incrementApiCount(userId, 'foxess')
  // - /api/weather → incrementApiCount(userId, 'weather')
}
```

**Tests don't provide userId** (no auth), so:
- ❌ No per-user metrics recorded
- ⚠️ Only global metrics incremented (minimal impact)

## Safety Summary

✅ **Unit tests**: 100% safe - zero external impact
✅ **Integration (emulator)**: 100% safe - local only
⚠️ **Integration (prod)**: ~1 Amber API call impact per run (negligible)

**Safe to run on CI/CD**: YES
- Unit tests on every commit ✅
- Integration (emulator) on every commit ✅
- Integration (prod) on tagged releases only ⚠️

## Commands Cheat Sheet

```powershell
# Development (zero external impact)
npm --prefix functions test

# Pre-deployment (minimal impact, emulator)
.\run-tests.ps1

# Production validation (only 1-2 calls)
.\run-tests.ps1 -Type integration -Prod

# Just unit tests with coverage
npm --prefix functions test -- --coverage

# Watch mode for development
npm --prefix functions test -- --watch
```

