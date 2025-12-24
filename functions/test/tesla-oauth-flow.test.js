/**
 * Tesla OAuth Flow Tests
 * Tests the complete OAuth flow with configuration checks, status endpoints, and error handling
 */

const request = require('supertest');
let admin;

// Mock Firebase Admin
jest.mock('firebase-admin', () => {
  const mockAuth = {
    verifyIdToken: jest.fn()
  };
  const mockFirestore = {
    collection: jest.fn()
  };
  return {
    initializeApp: jest.fn(),
    auth: jest.fn(() => mockAuth),
    firestore: jest.fn(() => mockFirestore),
    apps: []
  };
});

// Mock functions config
jest.mock('firebase-functions', () => ({
  https: {
    onRequest: jest.fn((handler) => handler)
  },
  config: jest.fn(() => ({
    tesla: {
      client_id: 'test-client-id',
      client_secret: 'test-client-secret'
    }
  })),
  pubsub: {
    schedule: jest.fn(() => ({
      onRun: jest.fn()
    }))
  }
}));

// Mock node-fetch
jest.mock('node-fetch');
let fetch;

describe('Tesla OAuth Flow', () => {
  let app;
  let mockDb;
  let mockAuth;
  const testUserId = 'test-user-123';
  const testEmail = 'sardanapalos928@hotmail.com';
  const testToken = 'test-id-token';
  const testClientId = 'test-client-id';
  const testClientSecret = 'test-client-secret';
  
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    admin = require('firebase-admin');
    fetch = require('node-fetch');
    
    // Setup mock auth FIRST
    mockAuth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: testUserId,
        email: testEmail
      })
    };
    admin.auth.mockReturnValue(mockAuth);
    
    // Setup mock Firestore
    mockDb = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({ exists: false }),
              set: jest.fn().mockResolvedValue({}),
              delete: jest.fn().mockResolvedValue({})
            }))
          }))
        }))
      }))
    };
    
    admin.firestore.mockReturnValue(mockDb);
    
    // Load app after mocks are set up
    const { app: expressApp } = require('../index');
    app = expressApp;
  });
  
  describe('GET /api/tesla/check-config', () => {
    it('should return configured status when credentials are set', async () => {
      mockDb.collection.mockReturnValue({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  clientId: testClientId,
                  clientSecret: testClientSecret
                })
              })
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/tesla/check-config')
        .set('Authorization', `Bearer ${testToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.configured).toBe(true);
      expect(response.body.result.hasClientId).toBe(true);
      expect(response.body.result.hasClientSecret).toBe(true);
    });
    
    it('should return not configured when credentials are missing', async () => {
      const response = await request(app)
        .get('/api/tesla/check-config')
        .set('Authorization', `Bearer ${testToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.configured).toBe(false);
    });
    
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/tesla/check-config');
      
      expect(response.status).toBe(401);
      expect(response.body.errno).toBe(401);
    });
  });
  
  describe('GET /api/tesla/status', () => {
    it('should return not connected when user has no tokens', async () => {
      const response = await request(app)
        .get('/api/tesla/status')
        .set('Authorization', `Bearer ${testToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.connected).toBe(false);
    });
    
    it('should return connected when user has tokens', async () => {
      // Mock Firestore to return tokens
      const mockGet = jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString()
        })
      });
      
      mockDb.collection.mockReturnValue({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              get: mockGet
            }))
          }))
        }))
      });
      
      const response = await request(app)
        .get('/api/tesla/status')
        .set('Authorization', `Bearer ${testToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.connected).toBe(true);
      expect(response.body.result.connectedAt).toBeDefined();
      expect(response.body.result.expiresAt).toBeDefined();
    });
    
    it('should require Tesla user authorization', async () => {
      // Mock different user email
      mockAuth.verifyIdToken.mockResolvedValue({
        uid: 'other-user',
        email: 'other@example.com'
      });
      
      const response = await request(app)
        .get('/api/tesla/status')
        .set('Authorization', `Bearer ${testToken}`);
      
      expect(response.status).toBe(403);
    });
  });
  
  describe('POST /api/tesla/disconnect', () => {
    it('should delete user tokens', async () => {
      const mockDelete = jest.fn().mockResolvedValue({});
      
      mockDb.collection.mockReturnValue({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              delete: mockDelete
            }))
          }))
        }))
      });
      
      const response = await request(app)
        .post('/api/tesla/disconnect')
        .set('Authorization', `Bearer ${testToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.errno).toBe(0);
      expect(response.body.result.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
    });
    
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/tesla/disconnect');
      
      expect(response.status).toBe(401);
    });
  });
  
  describe('GET /api/tesla/oauth-authorize', () => {
    it('should redirect to Tesla OAuth with valid state', async () => {
      const response = await request(app)
        .get('/api/tesla/oauth-authorize')
        .query({ idToken: testToken, clientId: testClientId })
        .redirects(0);
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('auth.tesla.com/oauth2/v3/authorize');
      expect(response.headers.location).toContain(`client_id=${testClientId}`);
      expect(response.headers.location).toContain('response_type=code');
      expect(response.headers.location).toContain('state=');
    });
    
    it('should reject unauthorized email', async () => {
      mockAuth.verifyIdToken.mockResolvedValue({
        uid: 'other-user',
        email: 'other@example.com'
      });
      
      const response = await request(app)
        .get('/api/tesla/oauth-authorize')
        .query({ idToken: testToken, clientId: testClientId });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Access denied');
    });
    
    it('should return error if clientId is missing', async () => {
      const response = await request(app)
        .get('/api/tesla/oauth-authorize')
        .query({ idToken: testToken });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('clientId is required');
    });
  });
  
  describe('GET /api/tesla/oauth-callback', () => {
    const validState = Buffer.from(JSON.stringify({
      userId: testUserId,
      clientId: testClientId,
      timestamp: Date.now(),
      nonce: 'test-nonce'
    })).toString('base64');
    
    it('should exchange code for tokens and save them', async () => {
      const mockTokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600
        })
      };
      
      fetch.mockResolvedValue(mockTokenResponse);
      
      const mockSet = jest.fn().mockResolvedValue({});
      const mockGet = jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ clientSecret: testClientSecret })
      });
      mockDb.collection.mockReturnValue({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              get: mockGet,
              set: mockSet
            }))
          }))
        }))
      });
      
      const response = await request(app)
        .get('/api/tesla/oauth-callback')
        .query({
          code: 'test-auth-code',
          state: validState
        })
        .redirects(0);
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/tesla-integration.html?oauth_success=true');
      expect(mockSet).toHaveBeenCalled();
    });
    
    it('should handle Tesla error response', async () => {
      const response = await request(app)
        .get('/api/tesla/oauth-callback')
        .query({
          error: 'access_denied',
          state: validState
        })
        .redirects(0);
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('oauth_error=access_denied');
    });
    
    it('should reject expired state token', async () => {
      const expiredState = Buffer.from(JSON.stringify({
        userId: testUserId,
        timestamp: Date.now() - (20 * 60 * 1000), // 20 minutes ago
        nonce: 'test-nonce'
      })).toString('base64');
      
      const response = await request(app)
        .get('/api/tesla/oauth-callback')
        .query({
          code: 'test-auth-code',
          state: expiredState
        })
        .redirects(0);
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('oauth_error=state_expired');
    });
    
    it('should reject invalid state format', async () => {
      const response = await request(app)
        .get('/api/tesla/oauth-callback')
        .query({
          code: 'test-auth-code',
          state: 'invalid-state'
        })
        .redirects(0);
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('oauth_error=invalid_state');
    });
    
    it('should handle token exchange failure', async () => {
      const mockTokenResponse = {
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({
          error: 'invalid_grant',
          error_description: 'Authorization code expired'
        })
      };
      
      fetch.mockResolvedValue(mockTokenResponse);
      mockDb.collection.mockReturnValue({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ clientSecret: testClientSecret })
              })
            }))
          }))
        }))
      });
      
      const response = await request(app)
        .get('/api/tesla/oauth-callback')
        .query({
          code: 'test-auth-code',
          state: validState
        })
        .redirects(0);
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(decodeURIComponent(response.headers.location)).toContain('Token exchange failed');
    });
  });
});
