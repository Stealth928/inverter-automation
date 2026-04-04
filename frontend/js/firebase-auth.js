/**
 * Firebase Authentication Module for Inverter App
 * 
 * This module provides:
 * - Firebase initialization
 * - User authentication (email/password, Google)
 * - Session management
 * - Auth state persistence
 */

// Firebase SDK imports (using compat for easier migration)
// In production, use modular imports for tree-shaking

class FirebaseAuth {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.user = null;
    this.idToken = null;
    this.onAuthStateChangedCallbacks = [];
    this.initialized = false;
    this.initialAuthStateResolved = false;
  }

  markInitialAuthStateResolved() {
    if (this.initialAuthStateResolved) {
      return;
    }
    this.initialAuthStateResolved = true;
  }

  notifyAuthStateChanged(user = this.user) {
    this.onAuthStateChangedCallbacks.forEach(cb => {
      try {
        cb(user);
      } catch (callbackError) {
        console.error('[FirebaseAuth] Auth state callback error:', callbackError);
      }
    });
  }

  /**
   * Initialize Firebase with config
   * Call this once on page load
   */
  async init(config, options = {}) {
      const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname === '' || hostname === '::1';

      const readLocalMockUser = () => {
        try {
          const raw = localStorage.getItem('mockAuthUser');
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return null;
        }
      };

      const mockWindowUser = window.mockFirebaseAuth && window.mockFirebaseAuth.currentUser
        ? window.mockFirebaseAuth.currentUser
        : null;
      const storedMockUser = readLocalMockUser();
      const forceLocalMock = isLocalhost && !!(mockWindowUser || storedMockUser);

      if (forceLocalMock) {
        this.mock = true;
        try {
          const parsed = mockWindowUser || storedMockUser;
          if (parsed) {
            const tokenFromWindow = typeof parsed.getIdToken === 'function'
              ? await parsed.getIdToken()
              : null;
            const token = tokenFromWindow || localStorage.getItem('mockAuthToken') || ('mock-token-' + Date.now());
            parsed.getIdToken = async () => token;
            this.user = parsed;
            this.idToken = token;
          } else {
            this.user = null;
            this.idToken = null;
          }
        } catch (e) {
          this.user = null;
          this.idToken = null;
        }
        this.initialized = true;
        this.markInitialAuthStateResolved();
        console.warn('[FirebaseAuth] Running in forced MOCK auth mode for localhost/test session');
        setTimeout(() => this.notifyAuthStateChanged(this.user), 0);
        return;
      }

      // Check if Firebase SDK is loaded
      if (typeof firebase === 'undefined') {
        console.error('[FirebaseAuth] Firebase SDK not loaded. Check that firebase-app-compat.js is included in the page.');
        // Enable mock mode as fallback
        this.mock = true;
        this.initialized = true;
        this.markInitialAuthStateResolved();
        setTimeout(() => this.notifyAuthStateChanged(this.user), 0);
        return;
      }

      // If config is missing or clearly placeholder, enable mock mode only for localhost
      // or when explicitly allowed via options.allowMock.
      const isPlaceholderConfig = !config || !config.apiKey || String(config.apiKey).trim() === '' || String(config.apiKey).startsWith('YOUR_');
      const allowMock = !!options.allowMock;

      if (isPlaceholderConfig) {
        if (allowMock || isLocalhost) {
          // Lightweight mock auth for local development (simulates Firebase behavior)
          this.mock = true;
          try {
            const raw = localStorage.getItem('mockAuthUser');
            if (raw) {
              const parsed = JSON.parse(raw);
              // ensure getIdToken exists for compatibility
              parsed.getIdToken = async () => localStorage.getItem('mockAuthToken') || ('mock-token-' + Date.now());
              this.user = parsed;
              this.idToken = await parsed.getIdToken();
            } else {
              this.user = null;
              this.idToken = null;
            }
          } catch (e) {
            this.user = null;
            this.idToken = null;
          }
          this.initialized = true;
          this.markInitialAuthStateResolved();
          console.warn('[FirebaseAuth] Running in MOCK auth mode (no Firebase config provided)');
          setTimeout(() => this.notifyAuthStateChanged(this.user), 0);
          return;
        }

        // In production, do not silently enable mock mode. Log a clear error so the
        // deployer can populate `js/firebase-config.js` with real project config.
        console.error('[FirebaseAuth] Firebase config missing or placeholder. Populate `js/firebase-config.js` with your project config for production.');
        // Still mark initialized so callers aren't blocked, but user remains signed out.
        this.initialized = true;
        this.markInitialAuthStateResolved();
        setTimeout(() => this.notifyAuthStateChanged(this.user), 0);
        return;
      }

    if (this.initialized) {
      return;
    }

    try {
      // Initialize Firebase
      // Check if Firebase app already exists (prevent "already initialized" errors)
      let appRef;
      try {
        appRef = firebase.app();
      } catch (e) {
        // App doesn't exist, initialize it
        try {
          appRef = firebase.initializeApp(config);
        } catch (initError) {
          console.error('[FirebaseAuth] Failed to initialize Firebase app:', initError);
          throw initError;
        }
      }
      this.app = appRef;
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      
      // Use Auth emulator for localhost development
      const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      if (isLocalhost && !this.auth.emulatorConfig) {
        const authEmulatorUrl = 'http://127.0.0.1:9099';
        try {
          this.auth.useEmulator(authEmulatorUrl, { disableWarnings: true });
        } catch {
          this.auth.useEmulator(authEmulatorUrl);
        }
        // console.log('[FirebaseAuth] Using Auth emulator at http://127.0.0.1:9099');
      }
      
      try {
        if (firebase.analytics && typeof firebase.analytics === 'function') {
          const analytics = firebase.analytics();
          if (analytics && typeof analytics.setAnalyticsCollectionEnabled === 'function') {
            analytics.setAnalyticsCollectionEnabled(!isLocalhost);
          }
        }
      } catch (analyticsError) {
        console.error('[FirebaseAuth] Analytics initialization failed (not critical):', analyticsError.message);
      }

      // Set persistence to local (survives browser close)
      try {
        await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (persistenceError) {
        console.warn('[FirebaseAuth] Failed to set persistence:', persistenceError);
      }

      // Listen for auth state changes
      this.auth.onAuthStateChanged(async (user) => {
        this.user = user;
        if (user) {
          // Get ID token for API calls
          try {
            this.idToken = await user.getIdToken();
          } catch (tokenError) {
            console.warn('[FirebaseAuth] Failed to get ID token:', tokenError);
            this.idToken = null;
          }
        } else {
          this.idToken = null;
        }

        this.markInitialAuthStateResolved();
        this.notifyAuthStateChanged(user);
      });

      // Refresh token periodically (every 50 minutes)
      setInterval(async () => {
        if (this.user) {
          try {
            this.idToken = await this.user.getIdToken(true);
          } catch (refreshError) {
            console.warn('[FirebaseAuth] Token refresh failed:', refreshError);
          }
        }
      }, 50 * 60 * 1000);

      this.initialized = true;
    } catch (error) {
      console.error('[FirebaseAuth] Initialization error:', error);
      // Mark as initialized anyway to prevent blocking the app
      this.initialized = true;
      // Fallback to mock auth
      this.mock = true;
      this.markInitialAuthStateResolved();
      setTimeout(() => this.notifyAuthStateChanged(null), 0);
    }
  }

  /**
   * Register a callback for auth state changes
   */
  onAuthStateChanged(callback) {
    this.onAuthStateChangedCallbacks.push(callback);
    // Call immediately with current state
    if (this.initialized && this.initialAuthStateResolved) {
      try {
        callback(this.user);
      } catch (callbackError) {
        console.error('[FirebaseAuth] Auth state callback error:', callbackError);
      }
    }
  }

  /**
   * Sign up with email and password
   */
  async signUp(email, password, displayName = '') {
    if (this.mock) {
      // create a fake user
      this.user = { email, displayName: displayName || email.split('@')[0], uid: 'mock-' + Date.now() };
      // persist mock user for cross-page persistence
      try { localStorage.setItem('mockAuthUser', JSON.stringify(this.user)); } catch (e) {}
      const token = 'mock-token-' + Date.now();
      try { localStorage.setItem('mockAuthToken', token); } catch (e) {}
      this.user.getIdToken = async () => token;
      this.idToken = await this.user.getIdToken();
      this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user));
      return { success: true, user: this.user };
    }
    try {
      const result = await this.auth.createUserWithEmailAndPassword(email, password);
      
      // Update display name if provided
      if (displayName && result.user) {
        await result.user.updateProfile({ displayName });
      }
      
      // console.log('[FirebaseAuth] Sign up successful:', email);
      return { success: true, user: result.user };
    } catch (error) {
      console.error('[FirebaseAuth] Sign up error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Sign in with email and password
   */
  async signIn(email, password) {
    if (this.mock) {
      // Accept any credentials in mock mode
      this.user = { email, displayName: email.split('@')[0], uid: 'mock-' + Date.now() };
      try { localStorage.setItem('mockAuthUser', JSON.stringify(this.user)); } catch (e) {}
      const token = 'mock-token-' + Date.now();
      try { localStorage.setItem('mockAuthToken', token); } catch (e) {}
      this.user.getIdToken = async () => token;
      this.idToken = await this.user.getIdToken();
      this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user));
      return { success: true, user: this.user };
    }
    try {
      const result = await this.auth.signInWithEmailAndPassword(email, password);
      return { success: true, user: result.user };
    } catch (error) {
      console.error('[FirebaseAuth] Sign in error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Sign in with Google
   */
  async signInWithGoogle() {
    if (this.mock) {
      // Simulate Google sign-in
      const email = 'google.mock@local';
      this.user = { email, displayName: 'Google Mock', uid: 'mock-google-' + Date.now() };
      try { localStorage.setItem('mockAuthUser', JSON.stringify(this.user)); } catch (e) {}
      const token = 'mock-google-token-' + Date.now();
      try { localStorage.setItem('mockAuthToken', token); } catch (e) {}
      this.user.getIdToken = async () => token;
      this.idToken = await this.user.getIdToken();
      this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user));
      return { success: true, user: this.user };
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    try {
      const result = await this.auth.signInWithPopup(provider);
      return { success: true, user: result.user };
    } catch (error) {
      const code = (error && error.code) ? String(error.code) : '';
      const message = (error && error.message) ? String(error.message) : '';
      const lowerMessage = message.toLowerCase();
      const shouldFallbackToRedirect =
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        lowerMessage.includes('cross-origin-opener-policy') ||
        lowerMessage.includes('window.closed');

      if (shouldFallbackToRedirect && this.auth && typeof this.auth.signInWithRedirect === 'function') {
        try {
          await this.auth.signInWithRedirect(provider);
          return { success: true, redirect: true };
        } catch (redirectError) {
          console.error('[FirebaseAuth] Google redirect sign in error:', redirectError);
          return {
            success: false,
            error: redirectError && redirectError.message ? redirectError.message : 'Google redirect sign in failed',
            code: redirectError && redirectError.code ? redirectError.code : ''
          };
        }
      }

      console.error('[FirebaseAuth] Google sign in error:', error);
      return { success: false, error: message, code };
    }
  }

  /**
   * Sign out
   */
  async signOut() {
    // Clear sensitive data from localStorage
    try {
      localStorage.removeItem('automationRules');
      localStorage.removeItem('automationEnabled');
      localStorage.removeItem('lastSelectedRule');
      localStorage.removeItem('mockAuthUser');
      localStorage.removeItem('mockAuthToken');
    } catch (e) {
      console.warn('[FirebaseAuth] Failed to clear localStorage:', e);
    }

    if (this.mock) {
      this.user = null;
      this.idToken = null;
      this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user));
      return { success: true };
    }
    try {
      await this.auth.signOut();
      // Explicitly set user to null to ensure idle check stops
      this.user = null;
      this.idToken = null;
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Sign out error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send password reset email
   */
  // Send password reset email. Optional `continueUrl` will be used as the
  // action URL where users land to complete the reset (e.g. '/reset-password.html').
  // Calls return an object { success: true } or { success: false, error, code }.
  async sendPasswordResetEmail(email, continueUrl = null) {
    if (this.mock) {
      // pretend email sent
      return { success: true };
    }
    try {
      if (continueUrl) {
        const actionCodeSettings = {
          url: continueUrl,
          // Force the redirect to be handled in the web app
          handleCodeInApp: true
        };
        await this.auth.sendPasswordResetEmail(email, actionCodeSettings);
      } else {
        await this.auth.sendPasswordResetEmail(email);
      }
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Password reset error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  // Verify a password reset code and return the email associated with it.
  async verifyPasswordResetCode(oobCode) {
    if (this.mock) {
      return { success: true, email: 'mock@local' };
    }
    try {
      const email = await this.auth.verifyPasswordResetCode(oobCode);
      return { success: true, email };
    } catch (error) {
      console.error('[FirebaseAuth] verifyPasswordResetCode error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  // Confirm the password reset using the code from the email and the new password
  async confirmPasswordReset(oobCode, newPassword) {
    if (this.mock) {
      return { success: true };
    }
    try {
      await this.auth.confirmPasswordReset(oobCode, newPassword);
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] confirmPasswordReset error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(updates) {
    try {
      if (!this.user) {
        throw new Error('No user signed in');
      }
      await this.user.updateProfile(updates);
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Profile update error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user email
   */
  async updateEmail(newEmail) {
    try {
      if (!this.user) {
        throw new Error('No user signed in');
      }
      await this.user.updateEmail(newEmail);
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Email update error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Update user password
   */
  async updatePassword(newPassword) {
    try {
      if (!this.user) {
        throw new Error('No user signed in');
      }
      await this.user.updatePassword(newPassword);
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Password update error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Delete user account
   */
  async deleteAccount() {
    try {
      if (!this.user) {
        throw new Error('No user signed in');
      }
      await this.user.delete();
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Account deletion error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    return this.user;
  }

  /**
   * Get ID token for API calls
   */
  async getIdToken(forceRefresh = false) {
    // If we have a user object (either from init listener or external source), use it
    if (this.user) {
      if (forceRefresh) {
        this.idToken = await this.user.getIdToken(true);
      }
      return this.idToken;
    }
    
    // Fallback: try to get current Firebase user directly
    if (this.auth && typeof firebase !== 'undefined' && firebase.auth) {
      const currentUser = firebase.auth().currentUser;
      if (currentUser) {
        this.user = currentUser; // sync the internal user object
        if (forceRefresh) {
          this.idToken = await currentUser.getIdToken(true);
        } else {
          this.idToken = await currentUser.getIdToken();
        }
        return this.idToken;
      }
    }
    
    return null;
  }

  /**
   * Check if user is signed in
   */
  isSignedIn() {
    return !!this.user;
  }

  /**
   * Make authenticated API call
   */
  async fetchWithAuth(url, options = {}) {
    const token = await this.getIdToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    return fetch(url, { ...options, headers });
  }
}

// Export singleton instance
const firebaseAuth = new FirebaseAuth();

// Helper function for authenticated API calls (for module imports)
// Prefers AppShell.authFetch (handles 401 redirect) → apiClient.fetch → firebaseAuth fallback
async function authenticatedFetch(url, options = {}) {
  if (typeof window !== 'undefined' && window.AppShell && typeof window.AppShell.authFetch === 'function') {
    return window.AppShell.authFetch(url, options);
  }
  if (typeof window !== 'undefined' && window.apiClient) {
    return window.apiClient.fetch(url, options);
  }
  return firebaseAuth.fetchWithAuth(url, options);
}

// Helper to initialize auth (for module imports)
async function initializeAuth(config = null, opts = {}) {
  if (!config && typeof window !== 'undefined' && window.firebaseConfig) {
    config = window.firebaseConfig;
  }
  return firebaseAuth.init(config, opts);
}

// Expose to browser global for scripts that expect `window.firebaseAuth`
if (typeof window !== 'undefined') {
  window.firebaseAuth = firebaseAuth;
  // Expose functions to window for global access
  window.initializeAuth = initializeAuth;
  window.authenticatedFetch = authenticatedFetch;
  // Backwards-compatibility: some pages reference `window.auth`
  // Provide a compatible alias so older pages don't need edits.
  if (typeof window.auth === 'undefined') {
    window.auth = firebaseAuth;
  }
}

// Exports for different module systems
// CommonJS (Node.js/testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FirebaseAuth, firebaseAuth, authenticatedFetch, initializeAuth };
}

// ES6 module exports (for browser import statements)
// Make functions available as named exports
if (typeof globalThis !== 'undefined') {
  globalThis.authenticatedFetch = authenticatedFetch;
  globalThis.initializeAuth = initializeAuth;
  globalThis.FirebaseAuth = FirebaseAuth;
  globalThis.firebaseAuth = firebaseAuth;
}
