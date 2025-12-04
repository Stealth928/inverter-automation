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
  }

  /**
   * Initialize Firebase with config
   * Call this once on page load
   */
  async init(config, options = {}) {
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
      this.app = firebase.initializeApp(config);
      this.auth = firebase.auth();
      this.db = firebase.firestore();

      // Set persistence to local (survives browser close)
      await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      // Listen for auth state changes
      this.auth.onAuthStateChanged(async (user) => {
        this.user = user;
        if (user) {
          // Get ID token for API calls
          this.idToken = await user.getIdToken();
          console.log('[FirebaseAuth] User signed in:', user.email);
        } else {
          this.idToken = null;
          console.log('[FirebaseAuth] User signed out');
        }

        // Notify all callbacks
        this.onAuthStateChangedCallbacks.forEach(cb => cb(user));
      });

      // Refresh token periodically (every 50 minutes)
      setInterval(async () => {
        if (this.user) {
          this.idToken = await this.user.getIdToken(true);
          console.log('[FirebaseAuth] Token refreshed');
        }
      }, 50 * 60 * 1000);

      this.initialized = true;
      console.log('[FirebaseAuth] Initialized successfully');
    } catch (error) {
      console.error('[FirebaseAuth] Initialization error:', error);
      throw error;
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
    if (this.mock) {
      this.user = null;
      this.idToken = null;
      try { localStorage.removeItem('mockAuthUser'); localStorage.removeItem('mockAuthToken'); } catch (e) {}
      this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user));
      return { success: true };
    }
    try {
      await this.auth.signOut();
      console.log('[FirebaseAuth] Sign out successful');
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Sign out error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email) {
    if (this.mock) {
      // pretend email sent
      return { success: true };
    }
    try {
      await this.auth.sendPasswordResetEmail(email);
      console.log('[FirebaseAuth] Password reset email sent to:', email);
      return { success: true };
    } catch (error) {
      console.error('[FirebaseAuth] Password reset error:', error);
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
