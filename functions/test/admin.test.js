/**
 * Admin API endpoint tests
 * Tests for admin role system, user management, impersonation, and stats endpoints
 */

// Mock firebase-admin before requiring anything
const mockFirestore = {
  collection: jest.fn(),
  runTransaction: jest.fn()
};

const mockAuth = {
  verifyIdToken: jest.fn(),
  getUser: jest.fn(),
  listUsers: jest.fn(),
  createCustomToken: jest.fn()
};

jest.mock('firebase-admin', () => {
  const actualAdmin = jest.requireActual('firebase-admin');
  return {
    ...actualAdmin,
    initializeApp: jest.fn(),
    apps: [{ name: 'test' }],
    firestore: Object.assign(jest.fn(() => mockFirestore), {
      FieldValue: {
        serverTimestamp: jest.fn(() => new Date()),
        increment: jest.fn((n) => n),
        delete: jest.fn()
      }
    }),
    auth: jest.fn(() => mockAuth)
  };
});

jest.mock('firebase-functions', () => ({
  config: jest.fn(() => ({})),
  https: { onRequest: jest.fn((handler) => handler) },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: jest.fn(() => jest.fn())
}));

const request = require('supertest');

// Helper: build a valid-looking auth header
function authHeaders(token = 'mock-admin-token') {
  return { Authorization: `Bearer ${token}` };
}

// ==================== Setup ====================
let app;

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JEST_WORKER_ID = '1';

  // Admin user token
  mockAuth.verifyIdToken.mockImplementation(async (token) => {
    if (token === 'mock-admin-token') {
      return { uid: 'admin-uid-1', email: 'sardanapalos928@hotmail.com' };
    }
    if (token === 'mock-user-token') {
      return { uid: 'user-uid-2', email: 'regular@example.com' };
    }
    throw new Error('Invalid token');
  });

  // Default Firestore mocks
  mockAuth.listUsers.mockResolvedValue({
    users: [
      {
        uid: 'admin-uid-1',
        email: 'sardanapalos928@hotmail.com',
        metadata: { creationTime: '2026-01-01T00:00:00.000Z', lastSignInTime: '2026-02-24T09:00:00.000Z' }
      },
      {
        uid: 'user-uid-2',
        email: 'regular@example.com',
        metadata: { creationTime: '2026-01-05T00:00:00.000Z', lastSignInTime: '2026-02-23T12:00:00.000Z' }
      },
      {
        uid: 'onboarding-uid-3',
        email: 'onboarding-only@example.com',
        metadata: { creationTime: '2026-02-20T00:00:00.000Z', lastSignInTime: '2026-02-20T00:10:00.000Z' }
      }
    ],
    pageToken: undefined
  });

  const mockDoc = (data = {}) => ({
    exists: !!data,
    data: () => data,
    id: data?.id || 'doc-id'
  });

  const mockCollection = {
    doc: jest.fn(() => ({
      get: jest.fn(async () => mockDoc({ role: 'user' })),
      set: jest.fn(async () => {}),
      collection: jest.fn(() => mockCollection)
    })),
    get: jest.fn(async () => ({
      docs: [
        { id: 'admin-uid-1', data: () => ({ email: 'sardanapalos928@hotmail.com', role: 'admin', automationEnabled: true }) },
        { id: 'user-uid-2', data: () => ({ email: 'regular@example.com', role: 'user', automationEnabled: false }) }
      ],
      size: 2
    })),
    add: jest.fn(async () => ({ id: 'audit-log-id' })),
    orderBy: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: jest.fn(async () => ({
          forEach: (fn) => {
            fn({ id: '2026-02-25', data: () => ({ foxess: 10, amber: 5, weather: 3 }) });
          }
        }))
      }))
    }))
  };

  mockFirestore.collection.mockReturnValue(mockCollection);

  // Require app after mocks
  app = require('../index').app;
});

// ==================== Tests ====================

describe('Admin API', () => {

  describe('GET /api/admin/check', () => {
    it('should return isAdmin: true for admin user', async () => {
      const res = await request(app)
        .get('/api/admin/check')
        .set(authHeaders('mock-admin-token'));

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result.isAdmin).toBe(true);
    });

    it('should return isAdmin: false for regular user', async () => {
      const res = await request(app)
        .get('/api/admin/check')
        .set(authHeaders('mock-user-token'));

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result.isAdmin).toBe(false);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .get('/api/admin/check');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/users', () => {
    it('should return list of users for admin', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set(authHeaders('mock-admin-token'));

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(Array.isArray(res.body.result.users)).toBe(true);
      expect(res.body.result.users.length).toBe(3);
      expect(res.body.result.users[0]).toHaveProperty('uid');
      expect(res.body.result.users[0]).toHaveProperty('email');
      expect(res.body.result.users[0]).toHaveProperty('role');

      const onboardingOnly = res.body.result.users.find(u => u.uid === 'onboarding-uid-3');
      expect(onboardingOnly).toBeTruthy();
      expect(onboardingOnly.profileInitialized).toBe(false);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set(authHeaders('mock-user-token'));

      expect(res.status).toBe(403);
      expect(res.body.errno).toBe(403);
    });
  });

  describe('GET /api/admin/platform-stats', () => {
    it('should return compact summary and trend data for admin', async () => {
      const res = await request(app)
        .get('/api/admin/platform-stats?days=90')
        .set(authHeaders('mock-admin-token'));

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result).toHaveProperty('summary');
      expect(res.body.result).toHaveProperty('trend');
      expect(Array.isArray(res.body.result.trend)).toBe(true);
      expect(res.body.result.days).toBe(90);
      expect(res.body.result.summary).toHaveProperty('totalUsers');
      expect(res.body.result.summary).toHaveProperty('configuredUsers');
      expect(res.body.result.summary).toHaveProperty('admins');
      expect(res.body.result.summary).toHaveProperty('automationActive');
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/api/admin/platform-stats?days=90')
        .set(authHeaders('mock-user-token'));

      expect(res.status).toBe(403);
      expect(res.body.errno).toBe(403);
    });
  });

  describe('POST /api/admin/users/:uid/role', () => {
    it('should update user role for admin', async () => {
      const res = await request(app)
        .post('/api/admin/users/user-uid-2/role')
        .set(authHeaders('mock-admin-token'))
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result.role).toBe('admin');
    });

    it('should reject invalid role', async () => {
      const res = await request(app)
        .post('/api/admin/users/user-uid-2/role')
        .set(authHeaders('mock-admin-token'))
        .send({ role: 'superuser' });

      expect(res.status).toBe(400);
    });

    it('should prevent admin from demoting themselves', async () => {
      const res = await request(app)
        .post('/api/admin/users/admin-uid-1/role')
        .set(authHeaders('mock-admin-token'))
        .send({ role: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('own admin role');
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/api/admin/users/user-uid-2/role')
        .set(authHeaders('mock-user-token'))
        .send({ role: 'admin' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/users/:uid/stats', () => {
    it('should return stats for admin', async () => {
      const res = await request(app)
        .get('/api/admin/users/user-uid-2/stats')
        .set(authHeaders('mock-admin-token'));

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result).toHaveProperty('uid');
      expect(res.body.result).toHaveProperty('metrics');
      expect(res.body.result).toHaveProperty('ruleCount');
      expect(res.body.result).toHaveProperty('configSummary');
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .get('/api/admin/users/user-uid-2/stats')
        .set(authHeaders('mock-user-token'));

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/impersonate', () => {
    it('should return custom token for admin', async () => {
      mockAuth.getUser.mockResolvedValue({ uid: 'user-uid-2', email: 'regular@example.com' });
      mockAuth.createCustomToken.mockResolvedValue('custom-token-for-user-2');

      const res = await request(app)
        .post('/api/admin/impersonate')
        .set(authHeaders('mock-admin-token'))
        .send({ uid: 'user-uid-2' });

      expect(res.status).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result.customToken).toBe('custom-token-for-user-2');
      expect(res.body.result.targetEmail).toBe('regular@example.com');
    });

    it('should return 400 when uid is missing', async () => {
      const res = await request(app)
        .post('/api/admin/impersonate')
        .set(authHeaders('mock-admin-token'))
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 404 when target user not found', async () => {
      mockAuth.getUser.mockRejectedValue(new Error('User not found'));

      const res = await request(app)
        .post('/api/admin/impersonate')
        .set(authHeaders('mock-admin-token'))
        .send({ uid: 'nonexistent-uid' });

      expect(res.status).toBe(404);
    });

    it('should return 403 for non-admin', async () => {
      const res = await request(app)
        .post('/api/admin/impersonate')
        .set(authHeaders('mock-user-token'))
        .send({ uid: 'admin-uid-1' });

      expect(res.status).toBe(403);
    });
  });
});
