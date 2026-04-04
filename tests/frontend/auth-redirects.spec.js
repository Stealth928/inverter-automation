const { test, expect, devices } = require('@playwright/test');

function buildFakeFirebaseSdk(options = {}) {
  const initialAuthDelayMs = Math.max(0, Number(options.initialAuthDelayMs) || 0);

  return `
(() => {
  if (window.__playwrightFakeFirebaseLoaded) return;
  window.__playwrightFakeFirebaseLoaded = true;

  const USER_KEY = 'mockAuthUser';
  const TOKEN_KEY = 'mockAuthToken';
  const INITIAL_AUTH_DELAY_MS = ${initialAuthDelayMs};
  const state = { callbacks: [], currentUser: null, lastRedirectResult: null, popupCalls: 0, redirectCalls: 0 };

  function attachGetIdToken(user) {
    if (!user) return null;
    if (typeof user.getIdToken !== 'function') {
      user.getIdToken = async () => {
        try {
          return localStorage.getItem(TOKEN_KEY) || 'mock-token';
        } catch (e) {
          return 'mock-token';
        }
      };
    }
    if (!user.uid) user.uid = 'mock-user';
    return user;
  }

  function readUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      return attachGetIdToken(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function writeUser(user) {
    try {
      if (!user) {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TOKEN_KEY);
        return;
      }
      localStorage.setItem(USER_KEY, JSON.stringify({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || ''
      }));
      localStorage.setItem(TOKEN_KEY, 'mock-token');
    } catch (e) {
      // ignore storage failures in tests
    }
  }

  function notifyAuthState() {
    const snapshot = state.callbacks.slice();
    snapshot.forEach((cb) => {
      try {
        cb(state.currentUser);
      } catch (e) {
        // ignore callback failures in tests
      }
    });
  }

  function setUser(user) {
    state.currentUser = attachGetIdToken(user);
    writeUser(state.currentUser);
    setTimeout(notifyAuthState, 0);
  }

  state.currentUser = readUser();

  const authInstance = {
    emulatorConfig: null,
    useEmulator(url) { this.emulatorConfig = { url }; },
    async setPersistence() {},
    onAuthStateChanged(callback) {
      state.callbacks.push(callback);
      setTimeout(() => callback(state.currentUser), INITIAL_AUTH_DELAY_MS);
      return () => {
        const idx = state.callbacks.indexOf(callback);
        if (idx >= 0) state.callbacks.splice(idx, 1);
      };
    },
    async signInWithEmailAndPassword(email) {
      const user = {
        uid: 'mock-' + Date.now(),
        email,
        displayName: (email || 'user').split('@')[0]
      };
      setUser(user);
      return { user: state.currentUser };
    },
    async createUserWithEmailAndPassword(email) {
      const user = {
        uid: 'mock-' + Date.now(),
        email,
        displayName: (email || 'user').split('@')[0]
      };
      setUser(user);
      return { user: state.currentUser };
    },
    async signInWithPopup() {
      state.popupCalls += 1;
      if (!state.currentUser) {
        setUser({
          uid: 'mock-google-' + Date.now(),
          email: 'google@example.com',
          displayName: 'Google User'
        });
      } else {
        setTimeout(notifyAuthState, 0);
      }
      return { user: state.currentUser };
    },
    async signInWithRedirect() {
      state.redirectCalls += 1;
      if (!state.currentUser) {
        setUser({
          uid: 'mock-google-' + Date.now(),
          email: 'google@example.com',
          displayName: 'Google User'
        });
      } else {
        setTimeout(notifyAuthState, 0);
      }
      state.lastRedirectResult = { user: state.currentUser };
    },
    async getRedirectResult() {
      const result = state.lastRedirectResult;
      state.lastRedirectResult = null;
      return result;
    },
    async signOut() {
      setUser(null);
    },
    async sendPasswordResetEmail() {},
    async verifyPasswordResetCode() { return 'test@example.com'; },
    async confirmPasswordReset() {},
    get currentUser() {
      return state.currentUser;
    }
  };

  window.firebase = window.firebase || {};
  window.firebase.apps = window.firebase.apps || [];
  window.firebase.initializeApp = function (config) {
    const app = { options: config || {} };
    window.firebase.apps = [app];
    return app;
  };
  window.firebase.app = function () {
    if (!window.firebase.apps.length) throw new Error('No Firebase app');
    return window.firebase.apps[0];
  };
  window.firebase.auth = function () {
    return authInstance;
  };
  window.firebase.auth.Auth = { Persistence: { LOCAL: 'local' } };
  window.firebase.auth.GoogleAuthProvider = function () {
    this.addScope = function () {};
  };
  window.firebase.firestore = function () {
    return {};
  };
  window.__fakeFirebaseAuthState = state;
})();
`;
}

async function stubFirebaseSdk(page, options = {}) {
  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: buildFakeFirebaseSdk(options)
    });
  });
}

async function stubSetupApi(page) {
  await page.route('**/api/config/setup-status*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ errno: 0, result: { setupComplete: true } })
    });
  });

  await page.route('**/api/user/init-profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ errno: 0, result: { ok: true } })
    });
  });

  await page.route('**/api/admin/check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ errno: 0, result: { isAdmin: false } })
    });
  });

  await page.route('**/api/config/announcement*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ errno: 0, result: { announcement: null } })
    });
  });
}

async function seedAuthUser(page, user) {
  await page.addInitScript((seedUser) => {
    try {
      localStorage.removeItem('mockAuthUser');
      localStorage.removeItem('mockAuthToken');
      sessionStorage.removeItem('lastRedirect');
    } catch (e) {
      // ignore in test setup
    }

    if (!seedUser) return;

    try {
      localStorage.setItem('mockAuthUser', JSON.stringify(seedUser));
      localStorage.setItem('mockAuthToken', 'mock-token');
    } catch (e) {
      // ignore in test setup
    }
  }, user || null);
}

const AUTH_STARTUP_HARNESS_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '  <title>Auth Startup Harness</title>',
  '  <script>window.__DISABLE_SERVICE_WORKER__ = true; window.firebaseConfig = { apiKey: "test-api-key", projectId: "test-project" };</script>',
  '  <script defer src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>',
  '  <script defer src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>',
  '  <script defer src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>',
  '  <script defer src="/js/firebase-auth.js"></script>',
  '  <script defer src="/js/api-client.js?v=5"></script>',
  '  <script defer src="/js/shared-utils.js?v=13"></script>',
  '  <script defer src="/js/app-shell.js?v=25"></script>',
  '</head>',
  '<body>',
  '  <div id="status" data-ready="0">booting</div>',
  '  <script>',
  '    document.addEventListener("DOMContentLoaded", () => {',
  '      AppShell.init({',
  '        pageName: "auth-harness",',
  '        requireAuth: true,',
  '        checkSetup: true,',
  '        autoMetrics: false,',
  '        onReady: () => {',
  '          const status = document.getElementById("status");',
  '          status.dataset.ready = "1";',
  '          status.textContent = "ready";',
  '        }',
  '      });',
  '    });',
  '  </script>',
  '</body>',
  '</html>'
].join('\n');

async function stubAuthStartupHarness(page) {
  await page.route('**/__auth-startup-harness.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: AUTH_STARTUP_HARNESS_HTML
    });
  });
}

async function emulateStandaloneLaunch(page, platform) {
  if (platform !== 'android-pwa' && platform !== 'iphone-pwa') {
    return;
  }

  await page.addInitScript((mode) => {
    const originalMatchMedia = typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : null;

    const createMediaQueryList = (query, matches) => ({
      matches,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; }
    });

    window.matchMedia = (query) => {
      const normalized = String(query || '').trim();
      if (normalized === '(display-mode: standalone)') {
        return createMediaQueryList(normalized, true);
      }
      if (originalMatchMedia) {
        return originalMatchMedia(query);
      }
      return createMediaQueryList(normalized, false);
    };

    if (mode === 'iphone-pwa') {
      Object.defineProperty(window.navigator, 'standalone', {
        configurable: true,
        get: () => true
      });
    }
  }, platform);
}

async function createPlatformPage(browser, platform) {
  const contextOptions = { serviceWorkers: 'block' };
  if (platform === 'android-pwa') {
    Object.assign(contextOptions, devices['Pixel 7']);
  } else if (platform === 'iphone-pwa') {
    Object.assign(contextOptions, devices['iPhone SE']);
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await emulateStandaloneLaunch(page, platform);
  return { context, page };
}

async function installIntervalHarness(page) {
  await page.addInitScript(() => {
    const captured = [];
    let nextId = 1;

    window.setInterval = (fn, ms, ...args) => {
      const id = nextId++;
      captured.push({
        id,
        fn,
        args,
        ms: Number(ms) || 0,
        active: true
      });
      return id;
    };

    window.clearInterval = (id) => {
      const match = captured.find((entry) => entry.id === id);
      if (match) {
        match.active = false;
      }
    };

    window.__runCapturedIntervals = async (elapsedMs = 0) => {
      const originalNow = Date.now;
      const baseNow = originalNow();
      Date.now = () => baseNow + Number(elapsedMs || 0);
      try {
        for (const entry of captured.slice()) {
          if (!entry.active || typeof entry.fn !== 'function') continue;
          await entry.fn(...entry.args);
        }
      } finally {
        Date.now = originalNow;
      }
    };
  });
}

test.describe('Auth Redirect Rules', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await stubFirebaseSdk(page);
    await stubSetupApi(page);
  });

  test('unauthenticated user on marketing page stays on marketing page', async ({ page }) => {
    await seedAuthUser(page, null);
    await page.goto('/index.html');
    await page.waitForTimeout(700);
    expect(new URL(page.url()).pathname).toBe('/index.html');
  });

  test('unauthenticated user on login page stays on login page', async ({ page }) => {
    await seedAuthUser(page, null);
    await page.goto('/login.html');
    await page.waitForTimeout(700);
    expect(new URL(page.url()).pathname).toBe('/login.html');
  });

  test('authenticated user on login page redirects to app page', async ({ page }) => {
    await seedAuthUser(page, {
      uid: 'auth-user-1',
      email: 'auth1@example.com',
      displayName: 'Auth One'
    });
    await page.goto('/login.html');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 7000 }).toBe('/app.html');
    expect(new URL(page.url()).pathname).toBe('/app.html');
  });

  test('authenticated user on marketing page stays on marketing page', async ({ page }) => {
    await seedAuthUser(page, {
      uid: 'auth-user-2',
      email: 'auth2@example.com',
      displayName: 'Auth Two'
    });
    await page.goto('/index.html');
    await page.waitForTimeout(700);
    expect(new URL(page.url()).pathname).toBe('/index.html');
  });

  test('login submission redirects directly to app without index hop', async ({ page }) => {
    await seedAuthUser(page, null);
    const visitedPaths = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        visitedPaths.push(new URL(frame.url()).pathname);
      }
    });

    await page.goto('/login.html');
    await page.fill('#signinEmail', 'newlogin@example.com');
    await page.fill('#signinPassword', 'password123');
    await page.click('#signinBtn');

    await page.waitForURL('**/app.html', { timeout: 7000 });

    expect(new URL(page.url()).pathname).toBe('/app.html');
    expect(visitedPaths).not.toContain('/index.html');
    expect(visitedPaths).not.toContain('/');
  });

  test('google sign-in on localhost emulator reaches app page', async ({ page }) => {
    await seedAuthUser(page, null);
    await page.goto('/login.html');
    await page.click('#googleSigninBtn');

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 7000 }).toBe('/app.html');
  });

  [
    { name: 'desktop browser', platform: 'desktop-browser' },
    { name: 'Android PWA launch', platform: 'android-pwa' },
    { name: 'iPhone PWA launch', platform: 'iphone-pwa' }
  ].forEach(({ name, platform }) => {
    test(`protected startup waits for delayed auth restore on ${name}`, async ({ browser }) => {
      const { context, page } = await createPlatformPage(browser, platform);
      try {
        await stubAuthStartupHarness(page);
        await stubFirebaseSdk(page, { initialAuthDelayMs: 900 });
        await stubSetupApi(page);
        await seedAuthUser(page, {
          uid: `persisted-${platform}`,
          email: `${platform}@example.com`,
          displayName: 'Persisted User'
        });

        await page.goto('/__auth-startup-harness.html');

        await page.waitForTimeout(650);
        expect(new URL(page.url()).pathname).toBe('/__auth-startup-harness.html');

        await expect(page.locator('#status')).toHaveAttribute('data-ready', '1', { timeout: 5000 });
        expect(new URL(page.url()).pathname).toBe('/__auth-startup-harness.html');
      } finally {
        await context.close();
      }
    });
  });

  test('authenticated Android PWA session survives a long inactivity gap', async ({ browser }) => {
    const { context, page } = await createPlatformPage(browser, 'android-pwa');
    try {
      await installIntervalHarness(page);
      await stubAuthStartupHarness(page);
      await stubFirebaseSdk(page);
      await stubSetupApi(page);
      await seedAuthUser(page, {
        uid: 'persisted-android-idle',
        email: 'android-idle@example.com',
        displayName: 'Android Idle User'
      });

      await page.goto('/__auth-startup-harness.html');
      await expect(page.locator('#status')).toHaveAttribute('data-ready', '1', { timeout: 5000 });

      await page.evaluate(() => window.__runCapturedIntervals(3 * 60 * 60 * 1000)).catch(() => null);
      await page.waitForTimeout(150);

      expect(new URL(page.url()).pathname).toBe('/__auth-startup-harness.html');
      await expect.poll(() => page.evaluate(() => !!localStorage.getItem('mockAuthUser'))).toBe(true);
    } finally {
      await context.close();
    }
  });
});
