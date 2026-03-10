'use strict';

const express = require('express');
const request = require('supertest');

const authAPI = require('../api/auth');
const { registerSetupPublicRoutes } = require('../api/routes/setup-public');

function buildAuthApp(options = {}) {
  const verifyIdToken = options.verifyIdToken || jest.fn(async (token) => ({ uid: `user-${token}` }));
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  const admin = {
    auth: jest.fn(() => ({ verifyIdToken }))
  };

  const { authenticateUser, tryAttachUser } = authAPI.init({ admin, logger });
  const app = express();

  app.get('/api/protected', authenticateUser, (req, res) => {
    res.json({ errno: 0, uid: req.user.uid });
  });

  app.get('/api/public', async (req, res) => {
    const user = await tryAttachUser(req);
    res.json({ errno: 0, uid: user ? user.uid : null });
  });

  return { app, verifyIdToken, logger };
}

function buildSetupPublicApp(overrides = {}) {
  const sharedServerConfigDoc = {
    get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
    set: jest.fn(async () => undefined)
  };

  const deps = {
    db: {
      collection: jest.fn(() => ({
        doc: jest.fn(() => sharedServerConfigDoc)
      }))
    },
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { data: [] } }))
    },
    getConfig: jest.fn(() => ({
      automation: {
        intervalMs: 60000,
        cacheTtl: { amber: 60000, inverter: 300000, weather: 1800000 }
      }
    })),
    getUserConfig: jest.fn(async () => ({})),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    serverTimestamp: jest.fn(() => 'server-ts'),
    setUserConfig: jest.fn(async () => undefined),
    tryAttachUser: jest.fn(async () => null),
    ...overrides
  };

  const app = express();
  app.use(express.json());
  registerSetupPublicRoutes(app, deps);

  return { app, deps };
}

describe('Authentication Flow Tests', () => {
  describe('Token Validation and Usage', () => {
    test('allow protected endpoint access with valid token', async () => {
      const { app, verifyIdToken } = buildAuthApp({
        verifyIdToken: jest.fn(async () => ({ uid: 'user-123' }))
      });

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer token-123');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ errno: 0, uid: 'user-123' });
      expect(verifyIdToken).toHaveBeenCalledWith('token-123');
    });

    test('allow protected endpoint access with idToken query param', async () => {
      const { app, verifyIdToken } = buildAuthApp({
        verifyIdToken: jest.fn(async () => ({ uid: 'query-user' }))
      });

      const response = await request(app)
        .get('/api/protected')
        .query({ idToken: 'query-token' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ errno: 0, uid: 'query-user' });
      expect(verifyIdToken).toHaveBeenCalledWith('query-token');
    });

    test('reject protected endpoint access without token', async () => {
      const { app, verifyIdToken } = buildAuthApp();

      const response = await request(app).get('/api/protected');

      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({
        errno: 401,
        error: 'Unauthorized: No token provided'
      });
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    test('reject protected endpoint access with invalid token', async () => {
      const { app, logger } = buildAuthApp({
        verifyIdToken: jest.fn(async () => {
          throw new Error('token invalid');
        })
      });

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer bad-token');

      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({
        errno: 401,
        error: 'Unauthorized: Invalid token'
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Session Management', () => {
    test('maintain session across multiple requests with the same token', async () => {
      const verifyIdToken = jest.fn(async () => ({ uid: 'stable-user' }));
      const { app } = buildAuthApp({ verifyIdToken });

      const first = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer stable-token');
      const second = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer stable-token');

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.body.uid).toBe('stable-user');
      expect(second.body.uid).toBe('stable-user');
      expect(verifyIdToken).toHaveBeenCalledTimes(2);
    });

    test('allow concurrent requests with the same token', async () => {
      const verifyIdToken = jest.fn(async () => ({ uid: 'parallel-user' }));
      const { app } = buildAuthApp({ verifyIdToken });

      const [one, two] = await Promise.all([
        request(app).get('/api/protected').set('Authorization', 'Bearer parallel-token'),
        request(app).get('/api/protected').set('Authorization', 'Bearer parallel-token')
      ]);

      expect(one.statusCode).toBe(200);
      expect(two.statusCode).toBe(200);
      expect(one.body.uid).toBe('parallel-user');
      expect(two.body.uid).toBe('parallel-user');
      expect(verifyIdToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('Protected Endpoint Access Patterns', () => {
    test('allow unauthenticated access to public endpoints', async () => {
      const { app, verifyIdToken } = buildAuthApp();

      const response = await request(app).get('/api/public');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ errno: 0, uid: null });
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    test('attach user to public endpoint when token is valid', async () => {
      const { app, verifyIdToken } = buildAuthApp({
        verifyIdToken: jest.fn(async () => ({ uid: 'public-auth-user' }))
      });

      const response = await request(app)
        .get('/api/public')
        .set('Authorization', 'Bearer pub-token');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ errno: 0, uid: 'public-auth-user' });
      expect(verifyIdToken).toHaveBeenCalledWith('pub-token');
    });
  });

  describe('Security Edge Cases', () => {
    test('reject malformed authorization header', async () => {
      const { app, verifyIdToken } = buildAuthApp();

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Token malformed');

      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({
        errno: 401,
        error: 'Unauthorized: No token provided'
      });
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    test('reject token with invalid signature on optional auth path without failing request', async () => {
      const { app, logger } = buildAuthApp({
        verifyIdToken: jest.fn(async () => {
          throw new Error('invalid signature');
        })
      });

      const response = await request(app)
        .get('/api/public')
        .set('Authorization', 'Bearer invalid-signature-token');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ errno: 0, uid: null });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('Password Reset Flow', () => {
    test('handle password reset with missing email field', async () => {
      const { app } = buildSetupPublicApp();

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({});

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ errno: 400, error: 'Email is required' });
    });

    test('accept password reset for valid email', async () => {
      const { app } = buildSetupPublicApp();

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'user@example.com' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        errno: 0,
        msg: 'If this email exists, a password reset link has been sent. Please check your email.'
      });
    });

    test('do not reveal whether email exists', async () => {
      const { app } = buildSetupPublicApp();

      const knownEmail = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'known@example.com' });
      const unknownEmail = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'not-found@example.com' });

      expect(knownEmail.statusCode).toBe(200);
      expect(unknownEmail.statusCode).toBe(200);
      expect(knownEmail.body.msg).toBe(unknownEmail.body.msg);
    });
  });
});
