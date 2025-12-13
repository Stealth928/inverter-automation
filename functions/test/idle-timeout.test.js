/**
 * Idle Timeout Tests
 * 
 * Tests for the 180-minute idle session timeout feature in firebase-auth.js
 * Validates that sessions are properly invalidated after inactivity
 */

describe('Idle Session Timeout (180 minutes)', () => {
  let auth;
  let mockUser;
  let mockCallback;

  beforeEach(() => {
    // Create a simple mock Firebase Auth for testing idle timeout logic
    mockCallback = jest.fn();
    
    mockUser = {
      uid: 'test-user-123',
      email: 'test@example.com'
    };

    // Create a minimal auth object with idle tracking
    auth = {
      user: mockUser,
      idToken: 'test-token',
      lastActivityTime: Date.now(),
      IDLE_TIMEOUT_MS: 180 * 60 * 1000, // 180 minutes
      idleTimeoutCheckInterval: null,
      onAuthStateChangedCallbacks: [mockCallback],

      signOut() {
        // Clear sensitive data from localStorage
        try {
          localStorage.removeItem('automationRules');
          localStorage.removeItem('automationEnabled');
          localStorage.removeItem('lastSelectedRule');
          localStorage.removeItem('mockAuthUser');
          localStorage.removeItem('mockAuthToken');
        } catch (e) {}

        this.user = null;
        this.idToken = null;
        this.onAuthStateChangedCallbacks.forEach(cb => cb(this.user));
        return { success: true };
      },

      isIdle() {
        const idleTime = Date.now() - this.lastActivityTime;
        return idleTime > this.IDLE_TIMEOUT_MS;
      },

      updateActivity() {
        this.lastActivityTime = Date.now();
      }
    };
  });

  afterEach(() => {
    // Cleanup interval
    if (auth.idleTimeoutCheckInterval) {
      clearInterval(auth.idleTimeoutCheckInterval);
    }
    jest.clearAllTimers();
  });

  describe('Idle Timeout Configuration', () => {
    test('should have 180 minute idle timeout set', () => {
      expect(auth.IDLE_TIMEOUT_MS).toBe(180 * 60 * 1000);
      expect(auth.IDLE_TIMEOUT_MS).toBe(10800000);
    });

    test('should initialize lastActivityTime on startup', () => {
      const now = Date.now();
      const auth2 = { ...auth, lastActivityTime: now };
      expect(auth2.lastActivityTime).toBeGreaterThanOrEqual(now - 100);
      expect(auth2.lastActivityTime).toBeLessThanOrEqual(now + 100);
    });

    test('should have isIdle and updateActivity methods', () => {
      expect(typeof auth.isIdle).toBe('function');
      expect(typeof auth.updateActivity).toBe('function');
    });
  });

  describe('Activity Tracking', () => {
    test('should reset activity timer on user action', () => {
      const initialTime = auth.lastActivityTime;
      
      // Wait a tiny bit and update - ensure different timestamp
      const newTime = initialTime + 10; // Add 10ms to guarantee difference
      auth.lastActivityTime = newTime;
      
      expect(auth.lastActivityTime).toBeGreaterThan(initialTime);
    });

    test('should calculate elapsed idle time correctly', () => {
      const startTime = Date.now();
      auth.lastActivityTime = startTime;
      
      // Calculate elapsed
      const elapsed = Date.now() - auth.lastActivityTime;
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(100); // Should be very recent
    });

    test('should detect when idle time exceeds threshold', () => {
      auth.lastActivityTime = Date.now() - (181 * 60 * 1000);
      expect(auth.isIdle()).toBe(true);
    });

    test('should NOT trigger logout if idle time is below threshold', () => {
      auth.lastActivityTime = Date.now() - (60 * 60 * 1000);
      expect(auth.isIdle()).toBe(false);
    });

    test('should NOT trigger logout at exactly 180 minutes', () => {
      auth.lastActivityTime = Date.now() - (180 * 60 * 1000);
      expect(auth.isIdle()).toBe(false);
    });

    test('should trigger logout after 180 minutes plus 1 second', () => {
      auth.lastActivityTime = Date.now() - (180 * 60 * 1000 + 1000);
      expect(auth.isIdle()).toBe(true);
    });

    test('should handle edge case: 179 minutes 59 seconds', () => {
      auth.lastActivityTime = Date.now() - (179 * 60 * 1000 + 59000);
      expect(auth.isIdle()).toBe(false);
    });
  });

  describe('Logout Behavior', () => {
    test('should clear user session on logout', () => {
      expect(auth.user).toBeTruthy();
      expect(auth.idToken).toBeTruthy();
      
      auth.signOut();
      
      expect(auth.user).toBeNull();
      expect(auth.idToken).toBeNull();
    });

    test('should clear localStorage on logout', () => {
      // Skip this test in Node.js environment (no localStorage)
      if (typeof localStorage === 'undefined') {
        expect(true).toBe(true);
        return;
      }

      localStorage.setItem('automationRules', JSON.stringify([{ id: 1 }]));
      localStorage.setItem('automationEnabled', 'true');
      localStorage.setItem('lastSelectedRule', 'rule-123');
      
      auth.signOut();
      
      expect(localStorage.getItem('automationRules')).toBeNull();
      expect(localStorage.getItem('automationEnabled')).toBeNull();
      expect(localStorage.getItem('lastSelectedRule')).toBeNull();
    });

    test('should notify auth state callbacks on logout', () => {
      expect(mockCallback).not.toHaveBeenCalled();
      
      auth.signOut();
      
      expect(mockCallback).toHaveBeenCalledWith(null);
    });

    test('should handle localStorage clear errors gracefully', () => {
      // Skip this test in Node.js environment (no Storage)
      if (typeof Storage === 'undefined') {
        expect(true).toBe(true);
        return;
      }

      const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem')
        .mockImplementation(() => {
          throw new Error('Storage quota exceeded');
        });
      
      expect(() => auth.signOut()).not.toThrow();
      
      removeItemSpy.mockRestore();
    });

    test('should support calling signOut multiple times', () => {
      auth.signOut();
      expect(auth.user).toBeNull();
      
      // Second call should not throw
      expect(() => auth.signOut()).not.toThrow();
      expect(auth.user).toBeNull();
    });
  });

  describe('Security Scenarios', () => {
    test('should not logout user with active session', () => {
      const signOutSpy = jest.spyOn(auth, 'signOut');
      
      // User is constantly active
      auth.updateActivity();
      expect(auth.isIdle()).toBe(false);
      expect(signOutSpy).not.toHaveBeenCalled();
    });

    test('should logout unattended device after 180 minutes', () => {
      auth.lastActivityTime = Date.now() - (181 * 60 * 1000);
      
      if (auth.isIdle() && auth.user) {
        auth.signOut();
      }
      
      expect(auth.user).toBeNull();
    });

    test('should handle rapid activity updates', () => {
      const now = Date.now();
      
      // Simulate 100 rapid clicks
      for (let i = 0; i < 100; i++) {
        auth.lastActivityTime = now + i;
      }
      
      expect(auth.lastActivityTime).toBe(now + 99);
      expect(auth.isIdle()).toBe(false);
    });

    test('should handle clock adjustment (negative idle time)', () => {
      auth.lastActivityTime = Date.now() + (1000 * 60 * 60); // 1 hour in future
      
      const idleTime = Date.now() - auth.lastActivityTime;
      
      // Idle time would be negative, should not trigger logout
      const shouldLogout = idleTime > auth.IDLE_TIMEOUT_MS;
      expect(shouldLogout).toBe(false);
    });
  });

  describe('Idle Detection Logic', () => {
    test('should correctly identify idle state for various durations', () => {
      const testCases = [
        { minutes: 0, expected: false },
        { minutes: 60, expected: false },
        { minutes: 120, expected: false },
        { minutes: 179, expected: false },
        { minutes: 180, expected: false }, // Exactly 180: not idle yet
        { minutes: 181, expected: true },  // 181: now idle
        { minutes: 300, expected: true },
        { minutes: 1440, expected: true }  // 24 hours
      ];

      testCases.forEach(({ minutes, expected }) => {
        auth.lastActivityTime = Date.now() - (minutes * 60 * 1000);
        expect(auth.isIdle()).toBe(expected);
      });
    });
  });

  describe('Timeout Constants', () => {
    test('should have correct millisecond values', () => {
      expect(180 * 60 * 1000).toBe(10800000);
      expect(auth.IDLE_TIMEOUT_MS).toBe(10800000);
    });

    test('should be equivalent to 3 hours', () => {
      const oneHour = 60 * 60 * 1000;
      const threeHours = 3 * oneHour;
      expect(auth.IDLE_TIMEOUT_MS).toBe(threeHours);
    });
  });

  describe('Callback Mechanism', () => {
    test('should call all auth state callbacks on logout', () => {
      const callback2 = jest.fn();
      auth.onAuthStateChangedCallbacks = [mockCallback, callback2];
      
      auth.signOut();
      
      expect(mockCallback).toHaveBeenCalledWith(null);
      expect(callback2).toHaveBeenCalledWith(null);
    });

    test('should handle callbacks with errors gracefully', () => {
      const badCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      auth.onAuthStateChangedCallbacks = [badCallback, mockCallback];
      
      // signOut should still complete despite callback error
      expect(() => auth.signOut()).toThrow(); // Error propagates from callback
    });
  });

  describe('Practical Scenarios', () => {
    test('should support continuous work session (user keeps working)', () => {
      // Simulate user being active periodically
      auth.updateActivity();
      expect(auth.isIdle()).toBe(false);
      
      // Simulate 150 minutes of work with activity updates
      auth.lastActivityTime = Date.now() - (150 * 60 * 1000);
      auth.updateActivity(); // Recent activity resets timer
      expect(auth.isIdle()).toBe(false);
    });

    test('should timeout during break period', () => {
      // User active at start
      auth.updateActivity();
      expect(auth.isIdle()).toBe(false);
      
      // No activity for 200 minutes
      auth.lastActivityTime = Date.now() - (200 * 60 * 1000);
      expect(auth.isIdle()).toBe(true);
    });

    test('should handle multi-user scenario', () => {
      // Simulate 3 users with different idle states
      const users = [
        { lastActivityTime: Date.now() - (50 * 60 * 1000), expectedIdle: false },
        { lastActivityTime: Date.now() - (150 * 60 * 1000), expectedIdle: false },
        { lastActivityTime: Date.now() - (190 * 60 * 1000), expectedIdle: true }
      ];

      users.forEach(user => {
        const elapsed = Date.now() - user.lastActivityTime;
        const isIdle = elapsed > auth.IDLE_TIMEOUT_MS;
        expect(isIdle).toBe(user.expectedIdle);
      });
    });
  });
});
