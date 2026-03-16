'use strict';

const express = require('express');
const request = require('supertest');

const { registerQuickControlRoutes } = require('../api/routes/quick-control');

function createDeps(overrides = {}) {
  return {
    addHistoryEntry: jest.fn(async () => undefined),
    addMinutes: jest.fn((hour, minute, durationMinutes) => {
      const total = (hour * 60) + minute + durationMinutes;
      return {
        hour: Math.floor((total % 1440) / 60),
        minute: total % 60
      };
    }),
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-quick' };
      return next();
    },
    cleanupExpiredQuickControl: jest.fn(async () => true),
    foxessAPI: { callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: {} })) },
    getAutomationTimezone: jest.fn(() => 'Australia/Sydney'),
    getQuickControlState: jest.fn(async () => null),
    getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-Q' })),
    getUserTime: jest.fn(() => ({ hour: 10, minute: 0 })),
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    saveQuickControlState: jest.fn(async () => true),
    serverTimestamp: jest.fn(() => 'server-ts'),
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerQuickControlRoutes(app, deps);
  return app;
}

describe('quick-control route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerQuickControlRoutes(app, {}))
      .toThrow('registerQuickControlRoutes requires addHistoryEntry()');
  });

  test('start returns 400 for invalid type', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/quickcontrol/start')
      .set('Authorization', 'Bearer token')
      .send({ type: 'bad', power: 1000, durationMinutes: 15 });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'type must be "charge" or "discharge"' });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('end returns no-op success when no active state exists', async () => {
    const deps = createDeps({
      getQuickControlState: jest.fn(async () => null)
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/quickcontrol/end')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, msg: 'No active quick control to stop' });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('status returns inactive envelope when no quick control is active', async () => {
    const deps = createDeps({
      getQuickControlState: jest.fn(async () => null)
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/quickcontrol/status')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: { active: false }
    });
  });

  test('status auto-cleans expired state and marks justExpired', async () => {
    const quickState = {
      active: true,
      type: 'charge',
      power: 2500,
      durationMinutes: 30,
      startedAt: Date.now() - (60 * 60 * 1000),
      expiresAt: Date.now() - 1000
    };
    const cleanupExpiredQuickControl = jest.fn(async () => true);
    const deps = createDeps({
      cleanupExpiredQuickControl,
      getQuickControlState: jest.fn(async () => quickState)
    });
    const app = buildApp(deps);

    const response = await request(app)
      .get('/api/quickcontrol/status')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      result: {
        active: false,
        justExpired: true,
        completedControl: {
          type: 'charge',
          power: 2500,
          durationMinutes: 30
        }
      }
    });
    expect(cleanupExpiredQuickControl).toHaveBeenCalledWith('u-quick', quickState);
  });

  test('start returns provider error details for non-foxess adapters', async () => {
    const adapter = {
      setSchedule: jest.fn(async () => ({ errno: 3500, error: 'Parameter Error' }))
    };
    const deps = createDeps({
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'alphaess',
        alphaessSystemSn: 'ALPHA-SN-001'
      })),
      adapterRegistry: {
        getDeviceProvider: jest.fn(() => adapter)
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/quickcontrol/start')
      .set('Authorization', 'Bearer token')
      .send({ type: 'discharge', power: 5000, durationMinutes: 5 });

    expect(response.statusCode).toBe(500);
    expect(response.body.errno).toBe(3500);
    expect(response.body.error).toBe('Parameter Error');
    expect(adapter.setSchedule).toHaveBeenCalled();
  });

  test('start skips verify by default and still persists active state', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/quickcontrol/start')
      .set('Authorization', 'Bearer token')
      .send({ type: 'charge', power: 2500, durationMinutes: 5 });

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.verify).toBeNull();
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenCalledTimes(2);
    expect(deps.saveQuickControlState).toHaveBeenCalledWith('u-quick', expect.objectContaining({
      active: true,
      type: 'charge',
      power: 2500,
      durationMinutes: 5,
      provider: 'foxess'
    }));
  });

  test('start verifies schedule when verify query is requested', async () => {
    const deps = createDeps({
      foxessAPI: {
        callFoxESSAPI: jest.fn(async (path, _method, payload) => {
          if (path === '/op/v1/device/scheduler/enable') {
            return { errno: 0, result: { groups: payload.groups } };
          }
          if (path === '/op/v1/device/scheduler/set/flag') {
            return { errno: 0, result: { enable: payload.enable } };
          }
          if (path === '/op/v1/device/scheduler/get') {
            return { errno: 0, result: { groups: [{ enable: 1 }], enable: true } };
          }
          return { errno: 0, result: {} };
        })
      }
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/quickcontrol/start?verify=1')
      .set('Authorization', 'Bearer token')
      .send({ type: 'discharge', power: 5000, durationMinutes: 5 });

    expect(response.statusCode).toBe(200);
    expect(response.body.verify).toEqual({ groups: [{ enable: 1 }], enable: true });
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/get',
      'POST',
      { deviceSN: 'SN-Q' },
      { deviceSn: 'SN-Q' },
      'u-quick'
    );
  });

  test('end skips verify by default and clears state', async () => {
    const deps = createDeps({
      getQuickControlState: jest.fn(async () => ({
        active: true,
        type: 'charge',
        power: 2500,
        durationMinutes: 15,
        expiresAt: Date.now() + 1000
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/quickcontrol/end')
      .set('Authorization', 'Bearer token');

    expect(response.statusCode).toBe(200);
    expect(response.body.verify).toBeNull();
    expect(deps.saveQuickControlState).toHaveBeenCalledWith('u-quick', null);
  });
});
