'use strict';

const express = require('express');
const request = require('supertest');

const { registerAuthLifecycleRoutes } = require('../api/routes/auth-lifecycle');

function createDeps(overrides = {}) {
  const userExists = overrides.userExists === true;
  const stateDocRef = {
    set: jest.fn(async () => undefined)
  };
  const automationCollectionRef = {
    doc: jest.fn(() => stateDocRef)
  };
  const userDocRef = {
    get: jest.fn(async () => ({ exists: userExists })),
    set: jest.fn(async () => undefined),
    collection: jest.fn(() => automationCollectionRef)
  };
  const usersCollectionRef = {
    doc: jest.fn(() => userDocRef)
  };

  const deps = {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = {
        uid: 'user-1',
        email: 'user@example.com',
        displayName: 'User One',
        photoURL: 'https://example.com/photo.png'
      };
      return next();
    },
    db: {
      collection: jest.fn(() => usersCollectionRef)
    },
    deleteUserDataTree: jest.fn(async () => undefined),
    logger: {
      info: jest.fn()
    },
    sendAdminSystemAlert: jest.fn(async () => ({ sent: true })),
    sendSignupAlert: jest.fn(async () => ({ sent: true })),
    serverTimestamp: jest.fn(() => 'server-ts'),
    setUserConfig: jest.fn(async () => undefined),
    __refs: { usersCollectionRef, userDocRef, automationCollectionRef, stateDocRef }
  };

  return { ...deps, ...overrides };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerAuthLifecycleRoutes(app, deps);
  return app;
}

describe('auth lifecycle route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerAuthLifecycleRoutes(app, {}))
      .toThrow('registerAuthLifecycleRoutes requires authenticateUser middleware');
  });

  test('health/auth enforces authentication middleware', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const unauthorized = await request(app).get('/api/health/auth');
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await request(app)
      .get('/api/health/auth')
      .set('Authorization', 'Bearer token');

    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).toEqual({ ok: true, user: 'user-1' });
  });

  test('init-user creates profile, default config, and automation state', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/auth/init-user')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, msg: 'User initialized' });

    expect(deps.db.collection).toHaveBeenCalledWith('users');
    expect(deps.__refs.usersCollectionRef.doc).toHaveBeenCalledWith('user-1');
    expect(deps.__refs.userDocRef.set).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.com',
      displayName: 'User One',
      photoURL: 'https://example.com/photo.png',
      createdAt: 'server-ts',
      updatedAt: 'server-ts'
    }), { merge: true });

    expect(deps.setUserConfig).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        deviceSn: '',
        foxessToken: '',
        amberApiKey: '',
        weatherPlace: 'Sydney',
        cache: {
          teslaStatus: 600000
        },
        createdAt: 'server-ts'
      }),
      { merge: true }
    );

    expect(deps.__refs.userDocRef.collection).toHaveBeenCalledWith('automation');
    expect(deps.__refs.automationCollectionRef.doc).toHaveBeenCalledWith('state');
    expect(deps.__refs.stateDocRef.set).toHaveBeenCalledWith({
      enabled: false,
      lastCheck: null,
      lastTriggered: null,
      activeRule: null
    }, { merge: true });
    expect(deps.sendSignupAlert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      email: 'user@example.com'
    }));
    expect(deps.sendAdminSystemAlert).not.toHaveBeenCalled();
  });

  test('init-user does not send signup alert when user already exists', async () => {
    const deps = createDeps({ userExists: true });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/auth/init-user')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(deps.sendSignupAlert).not.toHaveBeenCalled();
    expect(deps.sendAdminSystemAlert).not.toHaveBeenCalled();
  });

  test('cleanup-user deletes user data tree', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/auth/cleanup-user')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, msg: 'User data deleted' });
    expect(deps.deleteUserDataTree).toHaveBeenCalledWith('user-1');
  });
});
