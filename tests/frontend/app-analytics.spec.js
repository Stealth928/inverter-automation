const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const appAnalyticsSource = fs.readFileSync(
  path.join(__dirname, '../../frontend/js/app-analytics.js'),
  'utf8'
);

test.describe('App analytics bootstrap', () => {
  test('waits for a default Firebase app before initializing analytics', async ({ page }) => {
    const consoleErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.route('**/js/app-analytics.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: appAnalyticsSource.replace(
          'if (!analyticsSkipped && isLocalOrEmulatorHost()) {',
          'if (false && !analyticsSkipped && isLocalOrEmulatorHost()) {'
        )
      });
    });

    await page.route('**/analytics-regression.html', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics Regression</title>
  <script>
    window.__analyticsEvents = [];
    window.__analyticsReady = false;
    window.firebase = {
      apps: [],
      initializeApp(config) {
        const app = { options: config || {} };
        this.apps = [app];
        return app;
      },
      app() {
        if (!this.apps.length) {
          throw new Error("No Firebase App '[DEFAULT]' has been created - call Firebase App.initializeApp()");
        }
        return this.apps[0];
      },
      analytics() {
        if (!this.apps.length) {
          throw new Error("No Firebase App '[DEFAULT]' has been created - call Firebase App.initializeApp()");
        }
        window.__analyticsReady = true;
        return {
          logEvent(name, payload) {
            window.__analyticsEvents.push({ name, payload });
          }
        };
      }
    };
  </script>
  <script defer src="/js/app-analytics.js?v=1"></script>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.firebase.initializeApp({ apiKey: 'test-key' });
      }, 150);
    });
  </script>
</head>
<body>
  <button
    id="trackedButton"
    data-analytics-event="regression_click"
    data-analytics-location="test"
    data-analytics-label="delayed-app">
    Track event
  </button>
</body>
</html>`
      });
    });

    await page.goto('/analytics-regression.html');

    await expect.poll(async () => {
      return page.evaluate(() => window.__analyticsEvents.length);
    }, { timeout: 3000 }).toBe(0);

    await expect.poll(async () => {
      return page.evaluate(() => window.__analyticsReady);
    }, { timeout: 3000 }).toBe(true);

    await page.click('#trackedButton');

    await expect.poll(async () => {
      return page.evaluate(() => window.__analyticsEvents.length);
    }, { timeout: 3000 }).toBe(1);

    const event = await page.evaluate(() => window.__analyticsEvents[0]);
    expect(event).toEqual({
      name: 'regression_click',
      payload: {
        location: 'test',
        label: 'delayed-app'
      }
    });

    expect(consoleErrors).not.toContainEqual(expect.stringContaining("No Firebase App '[DEFAULT]' has been created"));
  });
});
