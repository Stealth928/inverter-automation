# Comprehensive Test Suite

This directory contains automated tests for the inverter automation system.

## Test Types

### 1. Unit Tests (Jest)
**Files**: `automation.test.js`, `amber-*.test.js`, `timezone.test.js`, etc.

Tests individual automation behaviors and logic:
- Master switch toggling and segment clearing
- Individual rule enable/disable with flag handling
- Rule deletion with segment clearing
- Cooldown logic, rule priority, state management
- Amber API caching, gap detection, channel balancing
- Weather API geocoding and timezone detection
- API counter tracking and rate limiting
- Edge cases and error handling

**Run with:**
```bash
cd functions
npm test
```

**Coverage:**
- **323 unit tests** across 19 test suites
- Tests all critical bug fixes
- Validates flag-based clearing approach
- Tests race conditions and edge cases

### 2. Integration Tests (supertest)
**File**: `routes-integration.test.js`

Tests HTTP endpoints using supertest for real request/response validation:
- Public endpoints (health, metrics, Amber sites/prices)
- Protected endpoints (config, automation, inverter)
- Authentication middleware behavior
- Request validation and error handling
- Response envelope format ({ errno, result/error })

**Run with:**
```bash
npm test routes-integration
```

**Coverage:**
- **13 integration tests**
- Tests auth middleware (authenticateUser, tryAttachUser)
- Validates public vs protected endpoint access
- Tests JSON parsing errors and 401/404 responses

### 3. End-to-End Tests
**File**: `e2e-tests.js`

Comprehensive tests covering all API endpoints with production verification:
- 48 total endpoints tested
- Health, config, automation, rules, inverter, Amber, weather, metrics
- Validates API envelope format consistency
- Tests authentication and authorization
- Verifies error handling
- Controlled production API calls (only 1 Amber call without auth)

**Run with:**
```bash
# Against emulator (zero external calls)
npm run test:e2e

# Against production (controlled external calls)
npm run test:e2e:prod

# With authentication (full test coverage)
TEST_ENV=prod TEST_AUTH_TOKEN=<your-token> node functions/e2e-tests.js

# Skip auth tests (18 tests run, 11 skipped)
TEST_ENV=prod SKIP_AUTH_TESTS=true node functions/e2e-tests.js
```

**Coverage:**
- 29 test cases (18 without auth, 29 with auth)
- Tests all critical endpoints
- Validates regression fixes
- Monitors external API call count

## Quick Start

### Run All Tests
```bash
# Unit tests (fast, zero external calls)
npm --prefix functions test

# Integration tests
npm --prefix functions run test:integration

# E2E tests (comprehensive)
npm --prefix functions run test:e2e

# All tests at once
.\run-tests.ps1
```

### Run Tests with Coverage
```bash
npm --prefix functions test -- --coverage
```

### Watch Mode (for development)
```bash
npm --prefix functions test -- --watch
```

## What's Tested

### ✅ Master Switch Toggle
- [x] Sets clearSegmentsOnNextCycle flag when disabled
- [x] Clears all 8 segments on inverter
- [x] Preserves automation timer (no reset)
- [x] Clears activeRule state

### ✅ Individual Rule Toggle
- [x] Sets flag when active rule is disabled
- [x] Does NOT set flag when non-active rule disabled
- [x] Clears lastTriggered on disable (reset cooldown)
- [x] Preserves automation timer
- [x] Clears segments via flag on next cycle

### ✅ Rule Deletion
- [x] Sets flag when deleting active rule
- [x] Does NOT set flag when deleting non-active rule
- [x] Clears automation state completely
- [x] Segments cleared on next cycle

### ✅ Cycle Behavior
- [x] Detects clearSegmentsOnNextCycle flag
- [x] Flag check happens BEFORE activeRule check
- [x] Flag is cleared after processing
- [x] Skips when automation disabled
- [x] Skips when no rules configured

### ✅ Cooldown Logic
- [x] Respects cooldown period
- [x] Allows trigger after cooldown expires
- [x] Handles missing lastTriggered

### ✅ Rule Priority
- [x] Sorts rules by priority correctly
- [x] Evaluates in priority order
- [x] Lower number = higher priority

### ✅ State Management
- [x] Preserves fields during partial updates
- [x] Handles missing state gracefully
- [x] Handles missing config gracefully
- [x] Handles empty rules object

### ✅ Segment Clearing
- [x] Builds correct 8-segment clear command
- [x] All segments have enable: 0
- [x] Correct format for FoxESS API

### ✅ Edge Cases
- [x] Concurrent flag operations
- [x] Rules with no conditions
- [x] Null/undefined values
- [x] Empty objects

### ✅ Integration Flows
- [x] Complete enable → activate → disable → clear flow
- [x] Complete automation toggle flow
- [x] Complete rule create → activate → delete → clear flow

## Test Structure

```
functions/
├── test/
│   ├── automation.test.js      # Unit tests (33 tests)
│   └── integration.test.js     # Integration tests (17 tests)
├── jest.config.js              # Jest configuration
└── package.json                # Test scripts
```

## Writing New Tests

### Unit Test Template
```javascript
describe('Feature Name', () => {
  test('should do something specific', async () => {
    // Arrange
    const mockState = { /* ... */ };
    
    // Act
    const result = someFunction(mockState);
    
    // Assert
    expect(result).toBe(expected);
  });
});
```

### Integration Test Template
```javascript
await test('Endpoint should behave correctly', async () => {
  const res = await httpRequest('/api/endpoint', 'GET');
  expect(res.statusCode).toBe(200);
  expect(res.body.errno).toBe(0);
});
```

## CI/CD Integration

These tests can be run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run unit tests
  run: npm --prefix functions test

- name: Start emulator
  run: npm --prefix functions run serve &
  
- name: Wait for emulator
  run: sleep 10

- name: Run integration tests
  run: node functions/test/integration.test.js
```

## Coverage Reports

Generate coverage report:
```bash
npm --prefix functions test -- --coverage --coverageReporters=html
```

View report:
```bash
open functions/coverage/index.html
```

## Debugging Tests

Run single test file:
```bash
npm --prefix functions test -- automation.test.js
```

Run single test case:
```bash
npm --prefix functions test -- -t "should set clearSegmentsOnNextCycle"
```

Verbose output:
```bash
npm --prefix functions test -- --verbose
```

## Route Coverage Matrix

### Public Endpoints (No Auth Required) ✅
| Route | Method | Test Coverage | Notes |
|-------|--------|---------------|-------|
| `/api/health` | GET | ✅ Integration | Health check |
| `/api/auth/forgot-password` | POST | ✅ Integration | Password reset |
| `/api/config/validate-keys` | POST | ✅ Integration | Credential validation |
| `/api/config/setup-status` | GET | ✅ E2E | Setup completion check |
| `/api/amber/sites` | GET | ✅ Integration | Amber sites (empty when no auth) |
| `/api/amber/prices` | GET | ✅ Integration | Amber prices (empty when no auth) |
| `/api/amber/prices/current` | GET | ✅ E2E | Current prices alias |
| `/api/metrics/api-calls` | GET | ✅ Integration | Global metrics |

### Protected Endpoints (Auth Required) ✅
| Route | Method | Test Coverage | Notes |
|-------|--------|---------------|-------|
| `/api/health/auth` | GET | ✅ Integration | Auth health check |
| `/api/config` | GET | ✅ Integration (401) | User config |
| `/api/config` | POST | ✅ Unit | Save config |
| `/api/config/clear-credentials` | POST | ✅ Unit | Clear credentials |
| `/api/automation/status` | GET | ✅ Unit | Automation state |
| `/api/automation/toggle` | POST | ✅ Integration (401) | Enable/disable |
| `/api/automation/cycle` | POST | ✅ Unit | Run automation cycle |
| `/api/automation/cancel` | POST | ✅ Unit | Cancel active rule |
| `/api/automation/trigger` | POST | ✅ Unit | Manual trigger |
| `/api/automation/rule/create` | POST | ✅ Unit | Create rule |
| `/api/automation/rule/update` | POST | ✅ Unit | Update rule |
| `/api/automation/rule/delete` | POST | ✅ Unit | Delete rule |
| `/api/automation/rule/end` | POST | ✅ Unit | End orphan rule |
| `/api/automation/history` | GET | ✅ Unit | Automation history |
| `/api/automation/audit` | GET | ✅ Unit | Audit logs |
| `/api/inverter/list` | GET | ✅ Integration (401) | Device list |
| `/api/inverter/real-time` | GET | ✅ E2E | Real-time data |
| `/api/inverter/settings` | GET | ✅ E2E | Device settings |
| `/api/inverter/temps` | GET | ✅ E2E | Temperatures |
| `/api/inverter/report` | GET | ✅ E2E | Reports |
| `/api/inverter/generation` | GET | ✅ E2E | Generation data |
| `/api/inverter/history` | GET | ✅ Unit | Historical data |
| `/api/device/battery/soc/get` | GET | ✅ E2E | Battery SoC |
| `/api/device/battery/soc/set` | POST | ✅ E2E | Set battery SoC |
| `/api/device/setting/get` | POST | ✅ E2E | Read device setting |
| `/api/device/setting/set` | POST | ✅ E2E | Write device setting |
| `/api/device/workmode/get` | GET | ✅ E2E | Get work mode |
| `/api/device/workmode/set` | POST | ✅ E2E | Set work mode |
| `/api/scheduler/v1/get` | GET | ✅ E2E | Get scheduler |
| `/api/scheduler/v1/set` | POST | ✅ Unit | Set scheduler |
| `/api/scheduler/v1/clear-all` | POST | ✅ Unit | Clear scheduler |
| `/api/weather` | GET | ✅ Unit | Weather forecast |
| `/api/amber/prices/actual` | GET | ✅ Unit | Actual prices |

### Diagnostic Endpoints ⚠️
| Route | Method | Test Coverage | Notes |
|-------|--------|---------------|-------|
| `/api/inverter/discover-variables` | GET | ⚠️ Manual only | Topology detection |
| `/api/inverter/all-data` | POST | ⚠️ Manual only | All variables |
| `/api/ems/list` | GET | ⚠️ Manual only | EMS devices |
| `/api/module/list` | GET | ⚠️ Manual only | Module list |
| `/api/module/signal` | GET | ⚠️ Manual only | Module signal |
| `/api/meter/list` | GET | ⚠️ Manual only | Meter list |

**Note**: Diagnostic endpoints are used infrequently for troubleshooting and don't require automated tests.

### Test Coverage Summary
- **Total Routes**: 48
- **Integration Tests**: 13 routes (public & auth validation)
- **Unit Tests**: ~35 routes (automation, caching, API clients)
- **E2E Tests**: 29 routes (full workflows)
- **Coverage Rate**: **~90%** (43/48 routes)

## Test Maintenance

- Update tests when adding new features
- Keep test names descriptive and specific
- Test both success and failure paths
- Mock external dependencies (Firebase, FoxESS, Amber)
- Use beforeEach to reset state between tests
- Keep tests independent (no shared state)

## Known Limitations

- Integration tests use mocked Firebase Admin
- Diagnostic endpoints tested manually only
- Some E2E tests require valid API credentials
- Rate limits may affect repeated test runs

## Future Enhancements

- [ ] Add Playwright frontend snapshot tests
- [ ] Increase module test coverage to 70%+
- [ ] Add load testing for automation cycles
- [ ] Test scheduler reordering edge cases
- [ ] Add performance/load tests
- [ ] Add security tests (SQL injection, XSS, etc.)
- [ ] Add mutation testing
- [ ] Add visual regression tests for frontend
- [ ] Add contract tests for API consumers
