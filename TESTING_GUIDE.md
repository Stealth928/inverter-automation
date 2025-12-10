# Comprehensive Testing Guide

## Overview

This repository includes extensive automated tests covering all critical functionality:

- **Unit Tests (Jest)**: 90 tests for automation logic, edge cases, and auth flows
- **Frontend Tests (Playwright)**: 145 UI tests across all pages
- **Integration Tests**: API endpoint availability checks
- **E2E Tests**: Comprehensive tests covering all API endpoints

**Total: 235+ automated tests**

---

## Test Types

### 1. Unit Tests (Jest)
**Location**: `functions/test/automation.test.js`  
**Coverage**: Automation engine logic, state management, rule evaluation

```bash
# Run unit tests
npm --prefix functions test

# With coverage
npm --prefix functions test -- --coverage

# Run specific test file
npm --prefix functions test -- automation.test.js
```

**What's Covered**:
- Master switch toggle and segment clearing
- Individual rule enable/disable
- Rule deletion and cleanup
- Cooldown behavior
- Rule priority ordering
- State persistence
- Flag-based segment clearing

---

### 2. Edge Case Tests (Jest)
**Location**: `functions/test/automation-edge-cases.test.js`  
**Coverage**: Complex scenarios and failure modes

```bash
# Run edge case tests
npm --prefix functions test -- automation-edge-cases.test.js
```

**What's Covered**:
- Multiple simultaneous rule triggers
- API failures during cycle execution (FoxESS, Amber, Weather)
- Concurrent cycle executions and locking
- Network timeouts and retry logic
- Invalid rule configurations
- State corruption and recovery
- Race conditions and timing issues
- DST transitions and midnight edge cases
- Complete integration scenarios

---

### 3. Auth Flow Tests (Jest)
**Location**: `functions/test/auth-flows.test.js`  
**Coverage**: User authentication and session management

```bash
# Run auth flow tests (requires emulator)
npm --prefix functions test -- auth-flows.test.js

# Or use test runner
.\run-tests.ps1 -Type auth
```

**What's Covered**:
- User registration with email/password
- Login flow and token generation
- Token validation and expiration
- Password reset flow
- Session management
- Protected endpoint access
- Multi-device sessions
- Security edge cases (SQL injection, XSS)
- Account management flows

**Requirements**:
- Firebase emulator must be running
- Start with: `firebase emulators:start --only auth,firestore,functions`

---

### 4. Integration Tests (Custom)
**Location**: `functions/integration-test.js`  
**Coverage**: API endpoint availability and envelope format

```bash
# Run against emulator
node functions/integration-test.js

# Run against production (minimal calls)
TEST_PROD=true node functions/integration-test.js

# Or use test runner
.\run-tests.ps1 -Type integration
.\run-tests.ps1 -Type integration -Prod
```

**What's Covered**:
- All API endpoints respond
- Correct HTTP status codes
- Proper envelope format (`{errno, result|error}`)
- Authentication requirements
- Error handling

---

### 5. End-to-End Tests (Custom)
**Location**: `functions/e2e-tests.js`  
**Coverage**: Complete API functionality with real calls

```bash
# Run against emulator (no auth)
node functions/e2e-tests.js

# Run with authentication
TEST_AUTH_TOKEN="your-token" node functions/e2e-tests.js

# Run against production
TEST_ENV=prod TEST_AUTH_TOKEN="your-token" node functions/e2e-tests.js

# Or use test runner
.\run-tests.ps1 -Type e2e
.\run-tests.ps1 -Type e2e -AuthToken "your-token"
.\run-tests.ps1 -Type e2e -Prod -AuthToken "your-token"
```

**What's Covered**:
- Health & status endpoints
- Configuration management
- Automation state and control
- Rule CRUD operations
- Inverter data retrieval
- Amber electricity prices
- Weather data
- Metrics and analytics
- Authenticated workflows
- Concurrent request handling

**How to Get AUTH TOKEN**:
1. Open app in browser and login
2. Open DevTools Console (F12)
3. Run: `firebase.auth().currentUser.getIdToken().then(t => console.log(t))`
4. Copy the printed token
5. Use with: `TEST_AUTH_TOKEN="<token>" node functions/e2e-tests.js`

---

## Test Runner (PowerShell)

**Location**: `run-tests.ps1`  
**Usage**: Unified interface for running all tests

```powershell
# Run all tests
.\run-tests.ps1

# Run specific test type
.\run-tests.ps1 -Type unit
.\run-tests.ps1 -Type integration
.\run-tests.ps1 -Type e2e
.\run-tests.ps1 -Type auth

# With authentication
.\run-tests.ps1 -Type e2e -AuthToken "your-token-here"

# Against production
.\run-tests.ps1 -Type e2e -Prod -AuthToken "your-token-here"

# With coverage
.\run-tests.ps1 -Type unit -Coverage

# Skip auth tests
.\run-tests.ps1 -Type e2e -SkipAuth
```

---

## Coverage Summary

### ✅ Fully Covered

**Backend APIs (48 endpoints)**:
- `/api/health` - Health checks
- `/api/config/**` - Configuration management
- `/api/automation/**` - Automation control
- `/api/rules/**` - Rule management
- `/api/inverter/**` - Inverter data
- `/api/amber/**` - Electricity prices
- `/api/weather/**` - Weather forecasts
- `/api/metrics/**` - Analytics

**Automation Logic**:
- Rule evaluation and triggering
- Cooldown behavior
- Priority ordering
- State management
- Segment clearing
- Flag-based operations

**Edge Cases**:
- API failures (FoxESS, Amber, Weather)
- Network timeouts
- Concurrent operations
- Invalid configurations
- State corruption
- Race conditions

**Authentication**:
- Registration and login
- Token management
- Password reset
- Session handling
- Protected endpoints

### ✅ Frontend (UI Tests)

**Framework**: Playwright  
**Location**: `tests/frontend/*.spec.js`  
**Coverage**: All HTML pages and user interactions

```bash
# Run all frontend tests
npx playwright test

# Run specific page tests
npx playwright test tests/frontend/control.spec.js

# Show test report
npx playwright show-report
```

**What's Covered**:
- Page navigation and routing
- Form validation and submission
- Button states and interactions
- Responsive layout across viewports
- Error handling and messages
- Authentication flows
- Data display and updates

**145 tests** across 8 pages:
- Dashboard (index.html)
- Control panel (control.html)
- History viewer (history.html)
- Settings page (settings.html)
- Setup wizard (setup.html)
- Test lab (test.html)
- Login page (login.html)
- Password reset (reset-password.html)

---

## Testing Environments

### Emulator (Local)
**URL**: `http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api`

**Advantages**:
- Fast execution
- No API costs
- Safe for destructive operations
- Full Firebase feature support

**Start Emulator**:
```bash
npm --prefix functions run serve
# Or: firebase emulators:start --only functions
```

### Production
**URL**: `https://api-etjmk6bmtq-uc.a.run.app`

**Advantages**:
- Tests actual deployment
- Validates production configuration
- Real API integrations

**⚠️ Caution**:
- Makes real API calls (counts toward quotas)
- Use sparingly to avoid rate limits
- May modify production data
- Always provide `TEST_AUTH_TOKEN` for full coverage

---

## API Call Impact

### External API Calls Made During Tests

| Test Type | FoxESS | Amber | Weather | Total |
|-----------|--------|-------|---------|-------|
| Unit | 0 | 0 | 0 | 0 |
| Edge Cases | 0 | 0 | 0 | 0 |
| Auth Flows | 0 | 0 | 0 | 0 |
| Integration | 0-3 | 0-2 | 0-1 | 0-6 |
| E2E (no auth) | 0-2 | 0-3 | 0-2 | 0-7 |
| E2E (with auth) | 3-5 | 4-6 | 2-4 | 9-15 |

**Notes**:
- Unit tests are fully mocked (0 external calls)
- Integration tests make minimal calls to verify connectivity
- E2E tests respect caching (5-minute TTL)
- Set `API_CALL_LIMIT=10` to control max external calls

**Cost Estimate** (per full test run):
- FoxESS: 5-10 calls (no cost, token-based)
- Amber: 6-10 calls (no cost, generous free tier)
- Weather: 2-5 calls (no cost under free tier)

---

## CI/CD Integration

### GitHub Actions (Recommended)

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm --prefix functions install
      - name: Run unit tests
        run: npm --prefix functions test
      - name: Run edge case tests
        run: npm --prefix functions test -- automation-edge-cases.test.js
      - name: Start emulator
        run: npm --prefix functions run serve &
      - name: Wait for emulator
        run: sleep 10
      - name: Run E2E tests
        run: node functions/e2e-tests.js
      - name: Run integration tests
        run: node functions/integration-test.js
```

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
cd functions && npm test
if [ $? -ne 0 ]; then
  echo "Tests failed, commit aborted"
  exit 1
fi
```

---

## Test Development Guidelines

### Adding New Tests

1. **Unit tests** - Add to `functions/test/automation.test.js` or create new file
2. **Edge cases** - Add to `functions/test/automation-edge-cases.test.js`
3. **Auth flows** - Add to `functions/test/auth-flows.test.js`
4. **E2E tests** - Add to `functions/e2e-tests.js`

### Test Structure

```javascript
describe('Feature Name', () => {
  test('should do something specific', async () => {
    // Arrange
    const input = setupTestData();
    
    // Act
    const result = await functionUnderTest(input);
    
    // Assert
    expect(result).toBe(expectedValue);
  });
});
```

### Best Practices

1. **Descriptive names**: Test names should clearly state what they verify
2. **Isolated tests**: Each test should be independent
3. **Mock external APIs**: Use mocks for unit tests, real calls for E2E
4. **Test edge cases**: Include error conditions, boundary values
5. **Clean up**: Reset state after tests
6. **Fast execution**: Keep unit tests under 100ms each

---

## Troubleshooting

### Tests Fail Locally

```bash
# 1. Clean install
cd functions
rm -rf node_modules
npm install

# 2. Check Node version
node --version  # Should be 20.x

# 3. Run tests individually
npm test -- automation.test.js
npm test -- automation-edge-cases.test.js
```

### E2E Tests Fail

```bash
# 1. Verify emulator is running
curl http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api/health

# 2. Check auth token
echo $TEST_AUTH_TOKEN  # Should be set if running auth tests

# 3. Run with verbose output
node functions/e2e-tests.js 2>&1 | tee test-output.log
```

### Auth Tests Fail

```bash
# 1. Start emulator with auth
firebase emulators:start --only auth,firestore,functions

# 2. Verify emulator UI
# Open http://localhost:4000 in browser

# 3. Run auth tests
npm --prefix functions test -- auth-flows.test.js
```

---

## Future Enhancements

### Recommended Additions

1. **Frontend UI Tests**
   - Tool: Playwright or Cypress
   - Coverage: User interactions, form validation, navigation
   - Pages: index, control, history, settings, test lab

2. **Visual Regression Tests**
   - Tool: Percy or Chromatic
   - Coverage: UI consistency across changes

3. **Performance Tests**
   - Tool: k6 or Artillery
   - Coverage: API response times, concurrent users

4. **Load Tests**
   - Verify system handles multiple users
   - Test automation cycle under load

5. **Security Tests**
   - Tool: OWASP ZAP
   - Coverage: Vulnerability scanning

---

## Quick Reference

```bash
# Backend unit tests (Jest)
npm --prefix functions test

# Frontend UI tests (Playwright)
npx playwright test

# Backend E2E tests
node functions/e2e-tests.js

# Backend integration tests
node functions/integration-test.js

# All tests with PowerShell runner
.\run-tests.ps1

# With coverage
npm --prefix functions test -- --coverage

# Show Playwright report
npx playwright show-report
```

---

## Support

For issues or questions:
1. Check test output for specific error messages
2. Review repository documentation in `docs/` folder
3. Check Firebase emulator logs at `http://localhost:4000`
4. See `playwright-report/` for detailed frontend test results
