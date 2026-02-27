/**
 * Test Suite for Quick Manual Controls
 * 
 * Tests the immediate charge/discharge feature including:
 * - Start quick control with validation
 * - Stop quick control manually
 * - Auto-cleanup on expiry
 * - Mutual exclusion with automation
 * - Status endpoint
 */

const request = require('supertest');
const admin = require('firebase-admin');

// Mock firebase-admin
jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn(() => mockFirestore),
    doc: jest.fn(() => mockFirestore),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    where: jest.fn(() => mockFirestore),
    orderBy: jest.fn(() => mockFirestore),
    limit: jest.fn(() => mockFirestore)
  };

  const mockAuth = {
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test_user_123' })
  };

  return {
    initializeApp: jest.fn(),
    firestore: jest.fn(() => mockFirestore),
    auth: jest.fn(() => mockAuth),
    FieldValue: {
      serverTimestamp: jest.fn(() => new Date())
    }
  };
});

// Mock FoxESS API module
const mockCallFoxESSAPI = jest.fn();
jest.mock('../api/foxess', () => ({
  init: jest.fn(() => ({
    callFoxESSAPI: mockCallFoxESSAPI
  }))
}));

describe('Quick Manual Controls', () => {
  let app;
  let mockDb;
  let mockUserConfig;
  let mockQuickState;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock Firestore
    mockDb = admin.firestore();
    
    // Default successful FoxESS API responses (can be overridden per test)
    mockCallFoxESSAPI.mockImplementation(async (endpoint) => {
      // Default: all calls succeed quickly
      return { errno: 0, msg: 'Success', result: { groups: [] } };
    });
    
    // Default mock user config
    mockUserConfig = {
      deviceSn: 'TEST123',
      foxessToken: 'test_token'
    };
    
    // Default mock quick control state (none active)
    mockQuickState = null;
    
    // Mock Firestore responses
    mockDb.get.mockImplementation(async () => {
      // Return different data based on the collection path
      const collectionCalls = mockDb.collection.mock.calls;
      const docCalls = mockDb.doc.mock.calls;
      
      if (collectionCalls.length > 0) {
        const lastCollection = collectionCalls[collectionCalls.length - 1][0];
        
        // User config
        if (lastCollection === 'config' || docCalls.some(c => c[0] === 'main')) {
          return { exists: true, data: () => mockUserConfig };
        }
        
        // Quick control state
        if (lastCollection === 'quickControl' || docCalls.some(c => c[0] === 'state')) {
          if (mockQuickState) {
            return { exists: true, data: () => mockQuickState };
          }
          return { exists: false };
        }
      }
      
      return { exists: false };
    });
    
    // Load the app
    delete require.cache[require.resolve('../index.js')];
    const indexModule = require('../index.js');
    app = indexModule.app;
  });

  describe('POST /api/quickcontrol/start', () => {
    const validToken = 'valid_test_token';

    test('should start quick charge with valid parameters', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 5000,
          durationMinutes: 60
        });

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.state.active).toBe(true);
      expect(response.body.state.type).toBe('charge');
      expect(response.body.state.power).toBe(5000);
      expect(response.body.state.durationMinutes).toBe(60);
      
      // Verify FoxESS API calls
      expect(mockCallFoxESSAPI).toHaveBeenCalledWith(
        '/op/v1/device/scheduler/enable',
        'POST',
        expect.objectContaining({
          deviceSN: 'TEST123',
          groups: expect.arrayContaining([
            expect.objectContaining({
              enable: 1,
              workMode: 'ForceCharge',
              fdPwr: 5000,
              minSocOnGrid: 20,
              fdSoc: 90,  // Charge: stop at 90%
              maxSoc: 100
            })
          ])
        }),
        expect.objectContaining({
          deviceSn: 'TEST123',  // lowercase 'n' in userConfig
          foxessToken: 'test_token'
        }),
        'test_user_123'
      );
      
      // Verify scheduler flag enabled
      expect(mockCallFoxESSAPI).toHaveBeenCalledWith(
        '/op/v1/device/scheduler/set/flag',
        'POST',
        expect.objectContaining({ deviceSN: 'TEST123', enable: 1 }),
        expect.objectContaining({
          deviceSn: 'TEST123',
          foxessToken: 'test_token'
        }),
        'test_user_123'
      );
      
      // Verify state saved to Firestore
      expect(mockDb.set).toHaveBeenCalled();
    });

    test('should start quick discharge with valid parameters', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'discharge',
          power: 3000,
          durationMinutes: 30
        });

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.state.type).toBe('discharge');
      
      // Verify discharge uses workMode string (ForceDischarge)
      const schedulerCall = mockCallFoxESSAPI.mock.calls.find(
        call => call[0].includes('scheduler/enable')
      );
      expect(schedulerCall[2].groups[0].workMode).toBe('ForceDischarge');
      expect(schedulerCall[2].groups[0].fdPwr).toBe(3000);
      expect(schedulerCall[2].groups[0].minSocOnGrid).toBe(20);
      expect(schedulerCall[2].groups[0].fdSoc).toBe(30); // Discharge: stop at 30%
      expect(schedulerCall[2].groups[0].maxSoc).toBe(100);
    });

    test('should reject invalid type', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'invalid',
          power: 5000,
          durationMinutes: 60
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('type must be');
    });

    test('should reject power above 30kW (absolute maximum)', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 31000, // Over 30kW absolute limit
          durationMinutes: 60
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('power must be between');
    });

    test('should reject negative power', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: -100,
          durationMinutes: 60
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('power must be between');
    });

    test('should reject duration outside valid range', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 5000,
          durationMinutes: 0 // Invalid
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('durationMinutes must be between');
    });

    test('should reject duration over 360 minutes', async () => {
      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 5000,
          durationMinutes: 400 // Over 6 hours
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('durationMinutes must be between');
    });

    test('should retry on FoxESS API failure', async () => {
      // First two attempts fail, third succeeds
      let attemptCount = 0;
      mockCallFoxESSAPI.mockImplementation(async (endpoint) => {
        if (endpoint.includes('scheduler/enable')) {
          attemptCount++;
          if (attemptCount < 3) {
            return { errno: 41000, msg: 'Temporary failure' };
          }
          return { errno: 0, msg: 'Success' };
        }
        return { errno: 0 };
      });

      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 5000,
          durationMinutes: 60
        });

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(attemptCount).toBe(3); // Should have retried
    });

    test('should fail after max retries', async () => {
      // All attempts fail
      mockCallFoxESSAPI.mockImplementation(async (endpoint) => {
        if (endpoint.includes('scheduler/enable')) {
          return { errno: 41000, msg: 'Persistent failure' };
        }
        return { errno: 0 };
      });

      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 5000,
          durationMinutes: 60
        });

      expect(response.status).toBe(500);
      expect(response.body.errno).toBe(41000);
    });

    test('should handle missing deviceSN', async () => {
      mockUserConfig = {}; // No deviceSN

      const response = await request(app)
        .post('/api/quickcontrol/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          type: 'charge',
          power: 5000,
          durationMinutes: 60
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Device serial number');
    });
  });

  describe('POST /api/quickcontrol/end', () => {
    const validToken = 'valid_test_token';

    test('should stop active quick control', async () => {
      // Set up active quick control state
      mockQuickState = {
        active: true,
        type: 'charge',
        power: 5000,
        durationMinutes: 60,
        startedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000
      };

      const response = await request(app)
        .post('/api/quickcontrol/end')
        .set('Authorization', `Bearer ${validToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      
      // Verify all scheduler segments cleared
      const clearCall = mockCallFoxESSAPI.mock.calls.find(
        call => call[0].includes('scheduler/enable')
      );
      expect(clearCall).toBeDefined();
      expect(clearCall[2].groups).toHaveLength(8);
      expect(clearCall[2].groups.every(g => g.enable === 0)).toBe(true);
      
      // Verify scheduler flag disabled
      const flagCall = mockCallFoxESSAPI.mock.calls.find(
        call => call[0].includes('scheduler/set/flag')
      );
      expect(flagCall[2].enable).toBe(0);
      
      // Verify state deleted
      expect(mockDb.delete).toHaveBeenCalled();
    });

    test('should return success when no active quick control', async () => {
      mockQuickState = null; // No active control

      const response = await request(app)
        .post('/api/quickcontrol/end')
        .set('Authorization', `Bearer ${validToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.msg).toContain('No active');
      
      // Should not call FoxESS API
      expect(mockCallFoxESSAPI).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/quickcontrol/status', () => {
    const validToken = 'valid_test_token';

    test('should return active state with remaining time', async () => {
      const now = Date.now();
      const expiresAt = now + 45 * 60 * 1000; // 45 minutes from now
      
      mockQuickState = {
        active: true,
        type: 'charge',
        power: 5000,
        durationMinutes: 60,
        startedAt: now - 15 * 60 * 1000, // Started 15 minutes ago
        expiresAt: expiresAt
      };

      const response = await request(app)
        .get('/api/quickcontrol/status')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.active).toBe(true);
      expect(response.body.result.type).toBe('charge');
      expect(response.body.result.power).toBe(5000);
      expect(response.body.result.remainingMinutes).toBeGreaterThan(0);
      expect(response.body.result.remainingMinutes).toBeLessThanOrEqual(45);
      expect(response.body.result.expired).toBe(false);
    });

    test('should return inactive when no quick control', async () => {
      mockQuickState = null;

      const response = await request(app)
        .get('/api/quickcontrol/status')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.active).toBe(false);
    });

    test('should auto-cleanup expired quick control and return justExpired', async () => {
      const now = Date.now();
      
      mockQuickState = {
        active: true,
        type: 'charge',
        power: 5000,
        durationMinutes: 60,
        startedAt: now - 90 * 60 * 1000, // Started 90 minutes ago
        expiresAt: now - 30 * 60 * 1000  // Expired 30 minutes ago
      };

      const response = await request(app)
        .get('/api/quickcontrol/status')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.result.active).toBe(false); // Server auto-cleaned
      expect(response.body.result.justExpired).toBe(true); // Indicates it just expired
      expect(response.body.result.completedControl.type).toBe('charge');
      expect(response.body.result.completedControl.power).toBe(5000);
      expect(response.body.result.completedControl.durationMinutes).toBe(60);
    });
  });

  describe('Automation Cycle Integration', () => {
    const validToken = 'valid_test_token';
    let mockAutomationState;
    
    beforeEach(() => {
      mockAutomationState = {
        enabled: true,
        activeRule: null,
        lastCheck: Date.now()
      };
      
      // Mock automation state retrieval
      mockDb.get.mockImplementation(async () => {
        const collectionCalls = mockDb.collection.mock.calls;
        const docCalls = mockDb.doc.mock.calls;
        
        if (collectionCalls.length > 0) {
          const lastCollection = collectionCalls[collectionCalls.length - 1][0];
          
          if (lastCollection === 'automation') {
            return { exists: true, data: () => mockAutomationState };
          }
          if (lastCollection === 'quickControl') {
            if (mockQuickState) {
              return { exists: true, data: () => mockQuickState };
            }
            return { exists: false };
          }
          if (lastCollection === 'config' || docCalls.some(c => c[0] === 'main')) {
            return { exists: true, data: () => mockUserConfig };
          }
        }
        
        return { exists: false };
      });
    });

    test('should skip automation when quick control is active', async () => {
      const now = Date.now();
      mockQuickState = {
        active: true,
        type: 'charge',
        power: 5000,
        durationMinutes: 60,
        startedAt: now,
        expiresAt: now + 60 * 60 * 1000 // 60 minutes from now
      };

      const response = await request(app)
        .post('/api/automation/cycle')
        .set('Authorization', `Bearer ${validToken}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.result.skipped).toBe(true);
      expect(response.body.result.reason).toBe('Quick control active');
      expect(response.body.result.quickControl).toBeDefined();
      expect(response.body.result.quickControl.type).toBe('charge');
    });

    test('should auto-cleanup expired quick control and continue automation', async () => {
      const now = Date.now();
      mockQuickState = {
        active: true,
        type: 'discharge',
        power: 3000,
        durationMinutes: 30,
        startedAt: now - 60 * 60 * 1000, // Started 60 minutes ago
        expiresAt: now - 30 * 60 * 1000  // Expired 30 minutes ago
      };

      const response = await request(app)
        .post('/api/automation/cycle')
        .set('Authorization', `Bearer ${validToken}`)
        .send();

      // Should not skip - will continue with automation
      // (might still skip due to other reasons like no matching rules, but not due to quick control)
      expect(response.status).toBe(200);
      
      // Verify segments were cleared
      const clearCall = mockCallFoxESSAPI.mock.calls.find(
        call => call[0].includes('scheduler/enable')
      );
      expect(clearCall).toBeDefined();
      
      // Verify state was deleted
      expect(mockDb.delete).toHaveBeenCalled();
    });

    test('should run normally when no quick control is active', async () => {
      mockQuickState = null;

      const response = await request(app)
        .post('/api/automation/cycle')
        .set('Authorization', `Bearer ${validToken}`)
        .send();

      expect(response.status).toBe(200);
      // Should not skip due to quick control
      if (response.body.result?.skipped) {
        expect(response.body.result.reason).not.toBe('Quick control active');
      }
    });
  });
});
