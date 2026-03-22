const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright Configuration for Frontend Tests
 * 
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests/frontend',
  
  // Maximum time one test can run
  timeout: 30 * 1000,
  
  expect: {
    timeout: 5000
  },
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter to use
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report' }],
        ['list']
      ]
    : [
        ['list']
      ],
  
  use: {
    // Base URL for page.goto() calls
    baseURL: 'http://localhost:8000',
    
    // Collect trace when retrying the failed test
    trace: process.env.CI ? 'on-first-retry' : 'off',
    
    // Screenshot on failure
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    
    // Video on failure
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment to test on other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Run local dev server before starting the tests
  webServer: {
    command: 'node scripts/playwright-static-server.js',
    url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
