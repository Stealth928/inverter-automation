# Comprehensive Test Suite

This directory contains automated tests for the inverter automation system.

## Test Types

### 1. Unit Tests (`test/automation.test.js`)
Tests individual automation behaviors and logic (Jest):
- Master switch toggling and segment clearing
- Individual rule enable/disable with flag handling
- Rule deletion with segment clearing
- Cooldown logic
- Rule priority and sorting
- State management and persistence
- Segment clearing commands
- Edge cases and error handling
- Complete integration flows

**Run with:**
```bash
cd functions
npm test
```

**Coverage:**
- 33 comprehensive test cases
- Tests all critical bug fixes
- Validates flag-based clearing approach
- Tests race conditions and edge cases

### 2. Integration Tests (`integration-test.js`)
Tests API endpoint availability and responses:
- Health checks
- Authentication flow
- API envelope format (errno, result, error)
- Endpoint availability
- Error handling

**Run with:**
```bash
node functions/test/integration.test.js
```

**Run against production:**
```bash
TEST_PROD=true node functions/integration-test.js
```

### 3. End-to-End Tests (`e2e-tests.js`)
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

## Test Maintenance

- Update tests when adding new features
- Keep test names descriptive and specific
- Test both success and failure paths
- Mock external dependencies (Firebase, FoxESS, Amber)
- Use beforeEach to reset state between tests
- Keep tests independent (no shared state)

## Known Limitations

- Integration tests require emulator or live environment
- Some tests use mocks instead of real Firebase
- Authentication tests require valid tokens
- External API tests require API keys

## Future Enhancements

- [ ] Add E2E tests with real inverter (test environment)
- [ ] Add performance/load tests
- [ ] Add security tests (SQL injection, XSS, etc.)
- [ ] Add mutation testing
- [ ] Add visual regression tests for frontend
- [ ] Add contract tests for API consumers
