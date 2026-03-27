'use strict';

const express = require('express');
const request = require('supertest');

const { registerNotificationRoutes } = require('../api/routes/notifications');

function createDeps(overrides = {}) {
  return {
    authenticateUser: (req, _res, next) => {
      req.user = { uid: 'user-1' };
      next();
    },
    notificationsService: {
      getBootstrap: jest.fn(async () => ({
        preferences: {
          inboxEnabled: true,
          broadcastsEnabled: true,
          highSignalAutomationEnabled: true,
          curtailmentEnabled: true
        },
        unreadCount: 2,
        push: { configured: true, vapidPublicKey: 'pub' },
        subscriptions: []
      })),
      listNotifications: jest.fn(async () => ({
        notifications: [],
        unreadCount: 0,
        nextCursor: null,
        limit: 20
      })),
      saveUserPreferences: jest.fn(async (_uid, payload) => payload),
      upsertSubscription: jest.fn(async () => ({ subscriptionId: 'sub-1', active: true })),
      deactivateSubscription: jest.fn(async () => ({ subscriptionId: 'sub-1', active: false })),
      markRead: jest.fn(async () => ({ updatedCount: 1 }))
    },
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerNotificationRoutes(app, deps);
  return app;
}

describe('notifications routes module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerNotificationRoutes(app, {}))
      .toThrow('registerNotificationRoutes requires authenticateUser middleware');
  });

  test('bootstrap endpoint returns service payload', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/notifications/bootstrap');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      result: expect.objectContaining({
        unreadCount: 2
      })
    }));
    expect(deps.notificationsService.getBootstrap).toHaveBeenCalledWith('user-1');
  });

  test('list endpoint forwards query options', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/notifications')
      .query({ limit: '15', cursor: 'abc', unreadOnly: 'true' });

    expect(response.statusCode).toBe(200);
    expect(deps.notificationsService.listNotifications).toHaveBeenCalledWith('user-1', {
      limit: '15',
      cursor: 'abc',
      unreadOnly: 'true'
    });
  });

  test('preferences endpoint persists user preferences', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const payload = {
      preferences: {
        inboxEnabled: true,
        broadcastsEnabled: false,
        highSignalAutomationEnabled: true,
        curtailmentEnabled: false
      }
    };
    const response = await request(app)
      .post('/api/notifications/preferences')
      .send(payload);

    expect(response.statusCode).toBe(200);
    expect(deps.notificationsService.saveUserPreferences).toHaveBeenCalledWith('user-1', payload.preferences);
    expect(response.body.result.preferences).toEqual(payload.preferences);
  });

  test('subscription upsert surfaces validation status code', async () => {
    const deps = createDeps({
      notificationsService: {
        ...createDeps().notificationsService,
        upsertSubscription: jest.fn(async () => {
          const error = new Error('Bad subscription');
          error.statusCode = 400;
          throw error;
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/notifications/subscriptions')
      .send({ endpoint: '' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Bad subscription' });
  });

  test('read endpoint updates read state', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/notifications/read')
      .send({ ids: ['n-1', 'n-2'] });

    expect(response.statusCode).toBe(200);
    expect(deps.notificationsService.markRead).toHaveBeenCalledWith('user-1', { ids: ['n-1', 'n-2'] });
    expect(response.body.result).toEqual({ updatedCount: 1 });
  });
});
