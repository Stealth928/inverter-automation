'use strict';

const DEFAULT_USER = {
  uid: 'test-user-123',
  email: 'test@example.com',
  displayName: 'Test User'
};

function jsonResponse(payload, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload)
  };
}

async function installInternalPageHarness(page, options = {}) {
  const user = {
    ...DEFAULT_USER,
    ...(options.user || {})
  };
  const signedIn = options.signedIn !== false;
  const token = options.token || 'mock-token';
  const trackRedirects = !!options.trackRedirects;
  const stubFirebaseConfig = options.stubFirebaseConfig !== false;
  const blockExternalScripts = options.blockExternalScripts !== false;

  if (blockExternalScripts) {
    const emptyScript = {
      status: 200,
      contentType: 'application/javascript',
      body: ''
    };

    await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
      await route.fulfill(emptyScript);
    });
    await page.route('https://www.googletagmanager.com/**', async (route) => {
      await route.fulfill(emptyScript);
    });
    await page.route('https://www.google-analytics.com/**', async (route) => {
      await route.fulfill(emptyScript);
    });
  }

  if (stubFirebaseConfig) {
    await page.route('**/js/firebase-config.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.firebaseConfig = { apiKey: "YOUR_TEST_KEY" };'
      });
    });
  }

  await page.addInitScript((state) => {
    window.__DISABLE_AUTH_REDIRECTS__ = true;
    window.__DISABLE_SERVICE_WORKER__ = true;

    try {
      if (state.signedIn) {
        localStorage.setItem('mockAuthUser', JSON.stringify({
          uid: state.user.uid,
          email: state.user.email,
          displayName: state.user.displayName
        }));
        localStorage.setItem('mockAuthToken', state.token);
      } else {
        localStorage.removeItem('mockAuthUser');
        localStorage.removeItem('mockAuthToken');
      }
    } catch (error) {
      // ignore storage errors in tests
    }

    const currentUser = state.signedIn
      ? {
          uid: state.user.uid,
          email: state.user.email,
          displayName: state.user.displayName,
          getIdToken: () => Promise.resolve(state.token)
        }
      : null;

    window.mockFirebaseAuth = { currentUser };

    const safeRedirectImpl = state.trackRedirects
      ? function (target) {
          window.__redirectTargets = window.__redirectTargets || [];
          window.__redirectTargets.push(target);
        }
      : function () {};

    try {
      Object.defineProperty(window, 'safeRedirect', {
        configurable: true,
        writable: true,
        value: safeRedirectImpl
      });
    } catch (error) {
      window.safeRedirect = safeRedirectImpl;
    }

    if (state.trackRedirects) {
      window.__redirectTargets = [];
    }

    try {
      window.location.assign = function () {};
    } catch (error) {
      // ignore if location.assign cannot be overwritten
    }
  }, {
    user,
    token,
    signedIn,
    trackRedirects
  });
}

module.exports = {
  DEFAULT_USER,
  installInternalPageHarness,
  jsonResponse
};