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
  async init(config) {
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
    if (!this.user) {
      return null;
    }
    if (forceRefresh) {
      this.idToken = await this.user.getIdToken(true);
    }
    return this.idToken;
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

// Also export class for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FirebaseAuth, firebaseAuth };
}
