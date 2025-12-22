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
    
    // Idle session timeout (120 minutes / 2 hours - relaxed for better user experience)
    this.IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
    this.lastActivityTime = Date.now();
    this.idleTimeoutCheckInterval = null;
  }

  /**
   * Initialize Firebase with config
   * Call this once on page load
   */
  async init(config, options = {}) {
      // Check if Firebase SDK is loaded
      if (typeof firebase === 'undefined') {
        console.error('[FirebaseAuth] Firebase SDK not loaded. Check that firebase-app-compat.js is included in the page.');
        // Enable mock mode as fallback
        this.mock = true;
        this.initialized = true;
        setTimeout(() => this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user)), 0);
        return;
      }

      // If config is missing or clearly placeholder, enable mock mode only for localhost
      // or when explicitly allowed via options.allowMock.
      const isPlaceholderConfig = !config || !config.apiKey || String(config.apiKey).trim() === '' || String(config.apiKey).startsWith('YOUR_');
      const allowMock = !!options.allowMock;
      const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname === '';

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
          console.warn('[FirebaseAuth] Running in MOCK auth mode (no Firebase config provided)');
          setTimeout(() => this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user)), 0);
          return;
        }

        // In production, do not silently enable mock mode. Log a clear error so the
        // deployer can populate `js/firebase-config.js` with real project config.
        console.error('[FirebaseAuth] Firebase config missing or placeholder. Populate `js/firebase-config.js` with your project config for production.');
        // Still mark initialized so callers aren't blocked, but user remains signed out.
        this.initialized = true;
        setTimeout(() => this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user)), 0);
        return;
      }

    if (this.initialized) {
      console.log('[FirebaseAuth] Already initialized');
      return;
    }

    try {
      // Initialize Firebase
      // Check if Firebase app already exists (prevent "already initialized" errors)
      let appRef;
      try {
        appRef = firebase.app();
        console.log('[FirebaseAuth] Firebase app already initialized');
      } catch (e) {
        // App doesn't exist, initialize it
        try {
          appRef = firebase.initializeApp(config);
          console.log('[FirebaseAuth] Firebase app initialized');
        } catch (initError) {
          console.error('[FirebaseAuth] Failed to initialize Firebase app:', initError);
          throw initError;
        }
      }
      this.app = appRef;
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      try {
        if (firebase.analytics && typeof firebase.analytics === 'function') {
          firebase.analytics();
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
          console.log('[FirebaseAuth] User signed in:', user.email);
        } else {
          this.idToken = null;
          console.log('[FirebaseAuth] User signed out');
        }

        // Notify all callbacks
        this.onAuthStateChangedCallbacks.forEach(cb => {
          try {
            cb(user);
          } catch (callbackError) {
            console.error('[FirebaseAuth] Auth state callback error:', callbackError);
          }
        });
      });

      // Refresh token periodically (every 50 minutes)
      setInterval(async () => {
        if (this.user) {
          try {
            this.idToken = await this.user.getIdToken(true);
            console.log('[FirebaseAuth] Token refreshed');
          } catch (refreshError) {
            console.warn('[FirebaseAuth] Token refresh failed:', refreshError);
          }
        }
      }, 50 * 60 * 1000);

      // Track user activity for idle timeout
      this.setupIdleTracking();

      this.initialized = true;
      console.log('[FirebaseAuth] Initialized successfully');
    } catch (error) {
      console.error('[FirebaseAuth] Initialization error:', error);
      // Mark as initialized anyway to prevent blocking the app
      this.initialized = true;
      // Fallback to mock auth
      this.mock = true;
      setTimeout(() => this.onAuthStateChangedCallbacks.forEach(cb => {
        try {
          cb(null);
        } catch (e) {
          console.error('[FirebaseAuth] Callback error in fallback:', e);
        }
      }), 0);
    }
  }

  /**
   * Register a callback for auth state changes
   */
  onAuthStateChanged(callback) {
    this.onAuthStateChangedCallbacks.push(callback);
    // Call immediately with current state
    if (this.initialized) {
      callback(this.user);
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
      
      console.log('[FirebaseAuth] Sign up successful:', email);
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
      console.log('[FirebaseAuth] Sign in successful:', email);
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
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      
      const result = await this.auth.signInWithPopup(provider);
      console.log('[FirebaseAuth] Google sign in successful:', result.user.email);
      return { success: true, user: result.user };
    } catch (error) {
      console.error('[FirebaseAuth] Google sign in error:', error);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Sign out
   */
  async signOut() {
    // Clear idle timeout interval to prevent duplicate checks after logout
    if (this.idleTimeoutCheckInterval) {
      clearInterval(this.idleTimeoutCheckInterval);
      this.idleTimeoutCheckInterval = null;
      console.log('[FirebaseAuth] Cleared idle timeout interval');
    }

    // Clear sensitive data from localStorage
    try {
      localStorage.removeItem('automationRules');
      localStorage.removeItem('automationEnabled');
      localStorage.removeItem('lastSelectedRule');
      localStorage.removeItem('mockAuthUser');
      localStorage.removeItem('mockAuthToken');
      console.log('[FirebaseAuth] Cleared sensitive data from localStorage');
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
      console.log('[FirebaseAuth] Sign out successful');
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Sign out error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Setup activity tracking for idle session timeout
   * Tracks user interactions and logs them out after 180 minutes of inactivity
   */
  setupIdleTracking() {
    // Track user activity
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    const updateActivity = () => {
      this.lastActivityTime = Date.now();
    };

    activityEvents.forEach(event => {
      document.addEventListener(event, updateActivity, { passive: true });
    });

    console.log('[FirebaseAuth] Idle tracking enabled (30 min timeout)');

    // Check for idle timeout every 60 seconds
    this.idleTimeoutCheckInterval = setInterval(async () => {
      try {
        if (this.user) {
          const idleTime = Date.now() - this.lastActivityTime;
          
          if (idleTime > this.IDLE_TIMEOUT_MS) {
            console.warn(`[FirebaseAuth] Session idle for ${Math.round(idleTime / 1000 / 60)} minutes - logging out`);
            // Clear interval before signing out to prevent duplicate execution
            if (this.idleTimeoutCheckInterval) {
              clearInterval(this.idleTimeoutCheckInterval);
              this.idleTimeoutCheckInterval = null;
            }
            await this.signOut();
            
            // Redirect to login
            if (typeof window !== 'undefined' && window.location) {
              console.log('[FirebaseAuth] Redirecting to login page');
              window.location.href = '/login.html';
            }
          }
        } else {
          // User is null, stop checking
          if (this.idleTimeoutCheckInterval) {
            clearInterval(this.idleTimeoutCheckInterval);
            this.idleTimeoutCheckInterval = null;
          }
        }
      } catch (error) {
        console.error('[FirebaseAuth] Error in idle timeout check:', error);
      }
    }, 60 * 1000); // Check every 60 seconds
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
      console.log('[FirebaseAuth] Password reset email sent to:', email);
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
      console.log('[FirebaseAuth] Profile updated');
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
      console.log('[FirebaseAuth] Email updated to:', newEmail);
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
      console.log('[FirebaseAuth] Password updated');
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
      console.log('[FirebaseAuth] Account deleted');
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
// Expose to browser global for scripts that expect `window.firebaseAuth`
if (typeof window !== 'undefined') {
  window.firebaseAuth = firebaseAuth;
}

// Also export class for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FirebaseAuth, firebaseAuth };
}
