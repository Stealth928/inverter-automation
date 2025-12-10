# Frontend Testing Strategy

## Current Status

**Backend**: ✅ Fully tested (167+ tests)  
**Frontend**: ❌ No automated tests

## Frontend Pages to Test

1. **index.html** - Main dashboard
   - Real-time inverter data display
   - Current automation status
   - Quick controls

2. **control.html** - Manual control interface
   - Inverter mode selection
   - Power settings
   - Manual scheduler control

3. **history.html** - Automation history
   - History table with filtering
   - Event timeline
   - Export functionality

4. **settings.html** - Configuration
   - User profile
   - API key management
   - Notification preferences

5. **test.html** - Test automation lab
   - Rule testing
   - Condition evaluation
   - Debug tools

6. **setup.html** - Initial setup wizard
   - Step-by-step configuration
   - API validation
   - Device pairing

7. **login.html** - Authentication
   - Email/password login
   - Social login (if enabled)
   - Remember me

8. **reset-password.html** - Password recovery
   - Email input
   - Reset link handling
   - Password strength validation

---

## Recommended Testing Tools

### Option 1: Playwright (Recommended)

**Pros**:
- Multi-browser support (Chrome, Firefox, Safari)
- Built-in test runner
- Automatic waiting
- Screenshot and video recording
- Network mocking
- Mobile device emulation

**Installation**:
```bash
npm install -D @playwright/test
npx playwright install
```

**Example Test**:
```javascript
// tests/login.spec.js
const { test, expect } = require('@playwright/test');

test('user can login', async ({ page }) => {
  await page.goto('http://localhost:8000/login.html');
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/index\.html/);
});
```

### Option 2: Cypress

**Pros**:
- Excellent developer experience
- Time-travel debugging
- Automatic screenshots on failure
- Great documentation

**Installation**:
```bash
npm install -D cypress
npx cypress open
```

**Example Test**:
```javascript
// cypress/e2e/login.cy.js
describe('Login Flow', () => {
  it('should login successfully', () => {
    cy.visit('http://localhost:8000/login.html');
    cy.get('input[type="email"]').type('test@example.com');
    cy.get('input[type="password"]').type('TestPassword123!');
    cy.get('button[type="submit"]').click();
    cy.url().should('include', 'index.html');
  });
});
```

### Option 3: Selenium

**Pros**:
- Industry standard
- Wide language support
- WebDriver protocol

**Cons**:
- More verbose
- Requires more setup

---

## Recommended Approach: Playwright

### Why Playwright?

1. **Modern**: Built specifically for modern web apps
2. **Fast**: Parallel test execution
3. **Reliable**: Auto-waiting eliminates flakiness
4. **Complete**: Screenshots, videos, traces
5. **Firebase friendly**: Easy to mock auth

### Implementation Plan

#### 1. Setup Playwright

```bash
# In root directory
npm install -D @playwright/test
npx playwright install

# Create test directory
mkdir -p tests/frontend
```

#### 2. Create Playwright Config

```javascript
// playwright.config.js
module.exports = {
  testDir: './tests/frontend',
  use: {
    baseURL: 'http://localhost:8000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'cd frontend && python -m http.server 8000',
    port: 8000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
};
```

#### 3. Critical User Flows to Test

**Priority 1 (Must Have)**:
- ✅ User can login
- ✅ User can view dashboard
- ✅ User can toggle automation
- ✅ User can create a rule
- ✅ User can edit a rule
- ✅ User can delete a rule
- ✅ User can view history

**Priority 2 (Should Have)**:
- User can reset password
- User can update settings
- User can validate API keys
- User can test rules
- User can export history

**Priority 3 (Nice to Have)**:
- Mobile responsiveness
- Dark mode toggle (if exists)
- Keyboard navigation
- Error message display

#### 4. Example Test Suite Structure

```
tests/frontend/
├── auth/
│   ├── login.spec.js
│   ├── logout.spec.js
│   └── password-reset.spec.js
├── dashboard/
│   ├── realtime-data.spec.js
│   └── quick-controls.spec.js
├── automation/
│   ├── toggle.spec.js
│   ├── create-rule.spec.js
│   ├── edit-rule.spec.js
│   └── delete-rule.spec.js
├── history/
│   ├── view-history.spec.js
│   └── filter-history.spec.js
└── settings/
    ├── update-profile.spec.js
    └── manage-keys.spec.js
```

#### 5. Sample Test Implementation

```javascript
// tests/frontend/automation/create-rule.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Rule Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login.html');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/index.html');
    
    // Navigate to rules page
    await page.goto('/control.html');
  });

  test('should create new rule with valid data', async ({ page }) => {
    await page.click('button:has-text("Add Rule")');
    
    await page.fill('input[name="ruleName"]', 'Test Rule');
    await page.selectOption('select[name="priority"]', '1');
    await page.fill('input[name="cooldown"]', '30');
    
    // Configure conditions
    await page.check('input[name="feedInPrice.enabled"]');
    await page.selectOption('select[name="feedInPrice.operator"]', '>');
    await page.fill('input[name="feedInPrice.value"]', '25');
    
    // Configure action
    await page.selectOption('select[name="workMode"]', 'ForceDischarge');
    await page.fill('input[name="durationMinutes"]', '30');
    await page.fill('input[name="fdPwr"]', '5000');
    
    await page.click('button:has-text("Save Rule")');
    
    // Verify rule appears in list
    await expect(page.locator('text=Test Rule')).toBeVisible();
  });

  test('should show validation error for empty rule name', async ({ page }) => {
    await page.click('button:has-text("Add Rule")');
    await page.click('button:has-text("Save Rule")');
    
    await expect(page.locator('.error:has-text("required")')).toBeVisible();
  });

  test('should disable save button while saving', async ({ page }) => {
    await page.click('button:has-text("Add Rule")');
    await page.fill('input[name="ruleName"]', 'Test Rule');
    
    const saveButton = page.locator('button:has-text("Save Rule")');
    await saveButton.click();
    
    await expect(saveButton).toBeDisabled();
  });
});
```

#### 6. Firebase Auth Mocking

```javascript
// tests/fixtures/auth.js
const { test as base } = require('@playwright/test');

const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    // Mock Firebase auth
    await page.addInitScript(() => {
      window.firebase = {
        auth: () => ({
          currentUser: {
            uid: 'test-user-123',
            email: 'test@example.com',
            getIdToken: () => Promise.resolve('mock-token')
          },
          onAuthStateChanged: (callback) => {
            callback({
              uid: 'test-user-123',
              email: 'test@example.com'
            });
          }
        })
      };
    });
    
    await use(page);
  }
});

module.exports = { test };
```

#### 7. Run Tests

```bash
# Run all tests
npx playwright test

# Run specific test file
npx playwright test tests/frontend/auth/login.spec.js

# Run in headed mode (see browser)
npx playwright test --headed

# Run in debug mode
npx playwright test --debug

# Run specific browser
npx playwright test --project=chromium

# Generate HTML report
npx playwright test --reporter=html
```

---

## Visual Regression Testing

### Using Playwright Screenshots

```javascript
test('dashboard looks correct', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveScreenshot('dashboard.png');
});
```

First run creates baseline, subsequent runs compare.

### Using Percy (Cloud Service)

```bash
npm install -D @percy/cli @percy/playwright

# Set PERCY_TOKEN env var
npx percy exec -- playwright test
```

Percy provides visual diffs in web UI.

---

## Integration with Test Runner

Update `run-tests.ps1`:

```powershell
# Add frontend testing option
if ($Type -eq 'all' -or $Type -eq 'frontend') {
    Write-Host "Running Frontend Tests..." -ForegroundColor Yellow
    npx playwright test
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nFrontend tests FAILED" -ForegroundColor Red
        $testsFailed = $true
    } else {
        Write-Host "`nFrontend tests PASSED" -ForegroundColor Green
    }
}
```

---

## CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm install
      - name: Install Playwright
        run: npx playwright install --with-deps
      - name: Run frontend tests
        run: npx playwright test
      - uses: actions/upload-artifact@v2
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

---

## Estimated Effort

### Initial Setup: 4-8 hours
- Install and configure Playwright
- Setup test fixtures and helpers
- Create first test suite (auth flow)

### Complete Coverage: 20-40 hours
- 8 pages × 3-5 tests per page = 24-40 tests
- Mock Firebase auth properly
- Handle async operations
- Add visual regression tests

### Maintenance: 2-4 hours per feature
- Add tests for new features
- Update tests for changes
- Fix flaky tests

---

## Quick Start Guide

```bash
# 1. Install Playwright
npm install -D @playwright/test
npx playwright install

# 2. Create first test
cat > tests/frontend/login.spec.js << 'EOF'
const { test, expect } = require('@playwright/test');

test('login page loads', async ({ page }) => {
  await page.goto('http://localhost:8000/login.html');
  await expect(page.locator('h1')).toContainText('Login');
});
EOF

# 3. Run test
npx playwright test

# 4. View report
npx playwright show-report
```

---

## Next Steps

1. **Decide on tool**: Playwright recommended
2. **Setup project**: Install and configure
3. **Start small**: Implement auth flow tests first
4. **Expand coverage**: Add critical user flows
5. **Integrate CI**: Add to GitHub Actions
6. **Monitor**: Track test execution time and flakiness

---

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Testing Firebase Apps](https://firebase.google.com/docs/emulator-suite/connect_and_prototype)
- [Visual Regression Testing](https://playwright.dev/docs/test-snapshots)
