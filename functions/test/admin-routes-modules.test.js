'use strict';

const express = require('express');
const request = require('supertest');

const { registerAdminRoutes } = require('../api/routes/admin');

function createDeps(overrides = {}) {
  const deleteUser = jest.fn(async () => undefined);

  const deps = {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'admin-uid', email: 'admin@example.com' };
      return next();
    },
    requireAdmin: (_req, _res, next) => next(),
    googleApis: null,
    getRuntimeProjectId: jest.fn(() => 'test-project'),
    listMonitoringTimeSeries: jest.fn(async () => []),
    normalizeMetricErrorMessage: jest.fn(() => 'metric error'),
    fetchCloudBillingCost: jest.fn(async () => ({
      services: [],
      totalUsd: 0,
      accountId: null,
      raw: null
    })),
    sumSeriesValues: jest.fn(() => 0),
    estimateFirestoreCostFromUsage: jest.fn(() => ({
      services: [],
      totalUsd: 0
    })),
    db: {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          set: jest.fn(async () => undefined)
        })),
        where: jest.fn(() => ({})),
        add: jest.fn(async () => undefined)
      }))
    },
    admin: {
      auth: jest.fn(() => ({
        getUser: jest.fn(async () => ({ uid: 'target-uid', email: 'target@example.com', customClaims: {} })),
        setCustomUserClaims: jest.fn(async () => undefined),
        deleteUser
      }))
    },
    serverTimestamp: jest.fn(() => '__TS__'),
    deleteUserDataTree: jest.fn(async () => undefined),
    deleteCollectionDocs: jest.fn(async () => undefined),
    normalizeCouplingValue: jest.fn((value) => value || 'unknown'),
    isAdmin: jest.fn(async () => true),
    SEED_ADMIN_EMAIL: 'admin@example.com',
    __deleteUser: deleteUser
  };

  return { ...deps, ...overrides };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerAdminRoutes(app, deps);
  return app;
}

describe('admin route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerAdminRoutes(app, {}))
      .toThrow('registerAdminRoutes requires authenticateUser middleware');
  });

  test('admin check enforces authentication middleware', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/admin/check');

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('admin check returns isAdmin result', async () => {
    const deps = createDeps({
      isAdmin: jest.fn(async () => true)
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/check')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { isAdmin: true } });
  });

  test('firestore-metrics returns 503 when googleapis is unavailable', async () => {
    const deps = createDeps({
      googleApis: null
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/admin/firestore-metrics')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      errno: 503,
      error: 'googleapis dependency not available on server'
    });
  });

  test('role update validates allowed roles', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/admin/users/user-2/role')
      .set('Authorization', 'Bearer token')
      .send({ role: 'super-admin' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'Role must be "admin" or "user"'
    });
  });

  test('user delete validates confirmation text', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/admin/users/user-2/delete')
      .set('Authorization', 'Bearer token')
      .send({ confirmText: 'NOPE' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      errno: 400,
      error: 'Confirmation text must be DELETE'
    });
    expect(deps.deleteUserDataTree).not.toHaveBeenCalled();
    expect(deps.__deleteUser).not.toHaveBeenCalled();
  });
});
