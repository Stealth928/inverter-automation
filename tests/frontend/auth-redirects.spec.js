const { test, expect } = require('@playwright/test');

const FAKE_FIREBASE_SDK = `
(() => {
  if (window.__playwrightFakeFirebaseLoaded) return;
  window.__playwrightFakeFirebaseLoaded = true;

  const USER_KEY = 'mockAuthUser';
  const TOKEN_KEY = 'mockAuthToken';
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
      setTimeout(() => callback(state.currentUser), 0);
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

async function stubFirebaseSdk(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: FAKE_FIREBASE_SDK
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
});
