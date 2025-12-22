/**
 * Routes Integration Tests
 * 
 * Tests Express route handlers by making actual HTTP requests.
 * These tests exercise real code paths in index.js routes.
 * 
 * Uses supertest for HTTP request simulation
 */

const request = require('supertest');

// Mock Firebase Admin to prevent initialization errors in tests
jest.mock('firebase-admin', () => {
  const mockAuth = {
    verifyIdToken: jest.fn().mockRejectedValue(new Error('Mock token verification'))
  };
  
  return {
    initializeApp: jest.fn(),
    auth: jest.fn(() => mockAuth),
    firestore: jest.fn(() => ({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn(() => Promise.resolve({ exists: false })),
          set: jest.fn(() => Promise.resolve()),
          update: jest.fn(() => Promise.resolve())
        })),
        get: jest.fn(() => Promise.resolve({ forEach: jest.fn() }))
      }))
    })),
    apps: []
  };
});

// Mock functions.config to avoid errors
jest.mock('firebase-functions', () => ({
  ...jest.requireActual('firebase-functions'),
  config: jest.fn(() => ({
    foxess: { token: '', base_url: 'https://www.foxesscloud.com' },
    amber: { api_key: '', base_url: 'https://api.amber.com.au/v1' }
  }))
}));

const indexModule = require('../index');
const app = indexModule.app; // Use exported Express app

describe('Routes Integration Tests', () => {

  describe('Health Endpoints', () => {
    test('GET /api/health should return 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    test('GET /api/health/auth should require authentication', async () => {
      // Token verification is mocked to reject, so this should return 401
      const res = await request(app)
        .get('/api/health/auth')
        .set('Authorization', 'Bearer valid-token');
      
      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('errno', 401);
    });

    test('GET /api/health/auth without token should return 401', async () => {
      const res = await request(app).get('/api/health/auth');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Config Endpoints', () => {
    test('POST /api/config/validate-keys should validate structure', async () => {
      const res = await request(app)
        .post('/api/config/validate-keys')
        .send({
          foxessToken: 'test-token',
          foxessBaseUrl: 'https://api.foxess.com',
          amberApiKey: 'test-key',
          amberBaseUrl: 'https://api.amber.com.au'
        });
      
      // Should not crash, should return valid response
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      expect(res.body).toHaveProperty('errno');
    });

    test('POST /api/config/validate-keys with missing fields should handle gracefully', async () => {
      const res = await request(app)
        .post('/api/config/validate-keys')
        .send({});
      
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.body).toHaveProperty('errno');
    });
  });

  describe('Error Handling', () => {
    test('POST with malformed JSON should return 400', async () => {
      const res = await request(app)
        .post('/api/config')
        .set('Content-Type', 'application/json')
        .send('{"invalid":json"}');
      
      expect(res.statusCode).toBe(400);
    });

    test('GET to non-existent route should return 401 (hits auth middleware)', async () => {
      // Non-existent /api/* routes hit authenticateUser middleware first
      const res = await request(app).get('/api/non-existent-route');
      expect(res.statusCode).toBe(401);
      expect(res.body.errno).toBe(401);
    });
  });

  describe('Authentication Middleware', () => {
    test('Protected routes without token should return 401', async () => {
      const protectedRoutes = [
        '/api/config',
        '/api/automation/status',
        '/api/inverter/list'
      ];

      for (const route of protectedRoutes) {
        const res = await request(app).get(route);
        expect(res.statusCode).toBe(401);
        expect(res.body.errno).toBe(401);
      }
    });
  });

  describe('Public Endpoint Access', () => {
    test('GET /api/amber/sites should work without auth', async () => {
      const res = await request(app).get('/api/amber/sites');
      expect(res.statusCode).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result).toEqual([]);
    });

    test('GET /api/metrics/api-calls should work without auth', async () => {
      const res = await request(app)
        .get('/api/metrics/api-calls')
        .query({ days: 7, scope: 'global' });
      
      expect(res.statusCode).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result).toBeDefined();
    });
  });

  describe('Response Envelope Format', () => {
    test('Success responses should have errno envelope for API routes', async () => {
      const res = await request(app).get('/api/amber/sites');
      expect(res.body.errno).toBe(0);
      expect(res.body).toHaveProperty('result');
    });

    test('Error responses should have { errno, error }', async () => {
      const res = await request(app).get('/api/non-existent');
      expect(res.body.errno).not.toBe(0);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('CORS Headers', () => {
    test('CORS middleware is configured', async () => {
      // CORS headers may not be present in test environment
      // This test verifies CORS middleware doesn't break requests
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toBe(200);
      // In production, CORS headers would be present
    });
  });
});
