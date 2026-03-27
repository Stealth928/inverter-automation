'use strict';

const express = require('express');
const request = require('supertest');

const { registerUserSelfRoutes } = require('../api/routes/user-self');

function createDbMock({ userDocExists = false, userData = {}, stateDocExists = false } = {}) {
  const userDocGet = jest.fn(async () => ({
    exists: userDocExists,
    data: () => userData
  }));
  const userDocSet = jest.fn(async () => undefined);

  const stateDocGet = jest.fn(async () => ({
    exists: stateDocExists,
    data: () => ({})
  }));
  const stateDocSet = jest.fn(async () => undefined);

  const adminAuditWhere = jest.fn((_field, _op, _value) => ({ query: true }));

  const db = {
    collection: jest.fn((name) => {
      if (name === 'users') {
        return {
          doc: jest.fn(() => ({
            get: userDocGet,
            set: userDocSet,
            collection: jest.fn((subName) => {
              if (subName !== 'automation') {
                throw new Error(`Unexpected subcollection: ${subName}`);
              }
              return {
                doc: jest.fn(() => ({
                  get: stateDocGet,
                  set: stateDocSet
                }))
              };
            })
          }))
        };
      }

      if (name === 'admin_audit') {
        return {
          where: adminAuditWhere
        };
      }

      throw new Error(`Unexpected collection: ${name}`);
    })
  };

  return {
    db,
    userDocGet,
    userDocSet,
    stateDocGet,
    stateDocSet,
    adminAuditWhere
  };
}

function createDeps(overrides = {}) {
  const dbMock = createDbMock();
  const deleteUser = jest.fn(async () => undefined);
  const admin = {
    auth: jest.fn(() => ({
      deleteUser
    }))
  };

  return {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-self', email: 'self@example.com' };
      if (req.headers['x-actor-user'] === '1') {
        req.actorUser = { uid: 'admin-actor' };
      }
      return next();
    },
    admin,
    db: dbMock.db,
    deleteCollectionDocs: jest.fn(async () => undefined),
    deleteUserDataTree: jest.fn(async () => undefined),
    sendSignupAlert: jest.fn(async () => ({ sent: true })),
    serverTimestamp: jest.fn(() => '__TS__'),
    __dbMock: dbMock,
    __deleteUser: deleteUser,
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api', deps.authenticateUser);
  registerUserSelfRoutes(app, deps);
  return app;
}

describe('user self route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerUserSelfRoutes(app, {}))
      .toThrow('registerUserSelfRoutes requires authenticateUser middleware');
  });

  test('init-profile creates profile and default automation state when missing', async () => {
    const dbMock = createDbMock({ userDocExists: false, stateDocExists: false });
    const deps = createDeps({ db: dbMock.db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/user/init-profile')
      .set('Authorization', 'Bearer token')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(dbMock.userDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u-self',
        email: 'self@example.com',
        automationEnabled: false,
        createdAt: '__TS__',
        lastUpdated: '__TS__'
      }),
      { merge: true }
    );
    expect(deps.sendSignupAlert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u-self',
      email: 'self@example.com'
    }));
    expect(dbMock.stateDocSet).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      updatedAt: '__TS__'
    }));
  });

  test('init-profile avoids writes for fully initialized users', async () => {
    const dbMock = createDbMock({
      userDocExists: true,
      userData: {
        uid: 'u-self',
        email: 'self@example.com',
        automationEnabled: true,
        createdAt: 'existing-ts'
      },
      stateDocExists: true
    });
    const deps = createDeps({ db: dbMock.db });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/user/init-profile')
      .set('Authorization', 'Bearer token')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.profileUpdated).toBe(false);
    expect(response.body.result.automationStateCreated).toBe(false);
    expect(response.body.result.automationEnabled).toBe(true);
    expect(dbMock.userDocSet).not.toHaveBeenCalled();
    expect(dbMock.stateDocSet).not.toHaveBeenCalled();
    expect(deps.sendSignupAlert).not.toHaveBeenCalled();
  });

  test('delete-account rejects invalid confirmation text', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer token')
      .send({ confirmText: 'NOPE' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Confirmation text must be DELETE' });
    expect(deps.deleteUserDataTree).not.toHaveBeenCalled();
  });

  test('delete-account blocks requests made during impersonation context', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer token')
      .set('x-actor-user', '1')
      .send({ confirmText: 'DELETE', confirmEmail: 'self@example.com' });

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ errno: 403, error: 'Stop impersonation before deleting an account.' });
  });

  test('delete-account removes user data, audit references, and auth identity', async () => {
    const dbMock = createDbMock({ userDocExists: true, stateDocExists: true });
    const deleteCollectionDocs = jest.fn(async () => undefined);
    const deleteUser = jest.fn(async () => undefined);
    const deps = createDeps({
      db: dbMock.db,
      deleteCollectionDocs,
      admin: {
        auth: jest.fn(() => ({ deleteUser }))
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/user/delete-account')
      .set('Authorization', 'Bearer token')
      .send({ confirmText: 'DELETE', confirmEmail: 'self@example.com' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { deleted: true } });
    expect(deps.deleteUserDataTree).toHaveBeenCalledWith('u-self');
    expect(deleteCollectionDocs).toHaveBeenCalledTimes(2);
    expect(dbMock.adminAuditWhere).toHaveBeenCalledTimes(2);
    expect(deleteUser).toHaveBeenCalledWith('u-self');
  });
});
