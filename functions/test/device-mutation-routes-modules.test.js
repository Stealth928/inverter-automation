'use strict';

const express = require('express');
const request = require('supertest');

const { registerDeviceMutationRoutes } = require('../api/routes/device-mutations');

function createDeps(overrides = {}) {
  return {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-device' };
      return next();
    },
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { ok: true } }))
    },
    getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-DEV' })),
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  // Mirror index.js behavior where /api auth middleware is applied globally first.
  app.use('/api', deps.authenticateUser);
  registerDeviceMutationRoutes(app, deps);
  return app;
}

describe('device mutation route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerDeviceMutationRoutes(app, {}))
      .toThrow('registerDeviceMutationRoutes requires authenticateUser middleware');
  });

  test('battery soc set returns 400 when device SN is missing', async () => {
    const deps = createDeps({
      getUserConfig: jest.fn(async () => ({}))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/device/battery/soc/set')
      .set('Authorization', 'Bearer token')
      .send({ minSoc: 10, minSocOnGrid: 10, maxSoc: 95 });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Device SN not configured' });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('device setting set requires authentication', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/device/setting/set')
      .send({ key: 'ExportLimit', value: 1000 });

    expect(response.statusCode).toBe(401);
  });

  test('device setting set validates required key parameter', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/device/setting/set')
      .set('Authorization', 'Bearer token')
      .send({ value: 1000 });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Missing required parameter: key' });
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('workmode set rejects unknown work mode', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/device/workmode/set')
      .set('Authorization', 'Bearer token')
      .send({ workMode: 'UnknownMode' });

    expect(response.statusCode).toBe(400);
    expect(response.body.errno).toBe(400);
    expect(response.body.error).toContain('Invalid work mode');
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('workmode set maps FeedinFirst to WorkMode=1', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/device/workmode/set')
      .set('Authorization', 'Bearer token')
      .send({ workMode: 'FeedinFirst' });

    expect(response.statusCode).toBe(200);
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/set',
      'POST',
      { sn: 'SN-DEV', key: 'WorkMode', value: 1 },
      { deviceSn: 'SN-DEV' },
      'u-device'
    );
  });

  test('workmode set dispatches to non-FoxESS adapter without FoxESS remapping', async () => {
    const setWorkMode = jest.fn(async () => ({ errno: 0, result: { accepted: true } }));
    const deps = createDeps({
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: { shouldNotBeUsed: true } }))
      },
      adapterRegistry: {
        getDeviceProvider: jest.fn(() => ({ setWorkMode }))
      },
      getUserConfig: jest.fn(async () => ({
        deviceProvider: 'sungrow',
        sungrowDeviceSn: 'SG-SET-001'
      }))
    });
    const app = buildApp(deps);

    const response = await request(app)
      .post('/api/device/workmode/set')
      .set('Authorization', 'Bearer token')
      .send({ workMode: 'ForceDischarge' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { accepted: true } });
    expect(setWorkMode).toHaveBeenCalledWith({
      deviceSN: 'SG-SET-001',
      userConfig: {
        deviceProvider: 'sungrow',
        sungrowDeviceSn: 'SG-SET-001'
      },
      userId: 'u-device'
    }, 'ForceDischarge');
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });
});
