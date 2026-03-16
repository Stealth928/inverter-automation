'use strict';

const express = require('express');
const request = require('supertest');

const {
  buildClearedSchedulerGroups,
  registerSchedulerMutationRoutes
} = require('../api/routes/scheduler-mutations');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

describe('scheduler mutation route module', () => {
  test('set route returns 400 when device SN is missing', async () => {
    const foxessAPI = { callFoxESSAPI: jest.fn() };
    const getUserConfig = jest.fn(async () => ({}));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-scheduler-set' };
        next();
      });

      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: jest.fn(async () => undefined),
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig,
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .post('/api/scheduler/v1/set')
      .send({ groups: [] });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ errno: 400, error: 'Device SN not configured' });
    expect(getUserConfig).toHaveBeenCalledWith('u-scheduler-set');
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('set route applies schedule, enables flag, skips verify by default and writes history', async () => {
    const historyWrite = jest.fn(async () => undefined);
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path, _method, payload) => {
        if (path === '/op/v1/device/scheduler/enable') {
          return { errno: 0, msg: 'ok', result: { groups: payload.groups } };
        }
        if (path === '/op/v1/device/scheduler/set/flag') {
          return { errno: 0, result: { enable: payload.enable } };
        }
        return { errno: 0, result: {} };
      })
    };
    const getUserConfig = jest.fn(async () => ({ deviceSn: 'SN-SET' }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-scheduler-set' };
        next();
      });

      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: historyWrite,
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig,
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const groups = [{ enable: 1, startHour: 1, startMinute: 0, endHour: 2, endMinute: 0, workMode: 'SelfUse' }];
    const response = await request(app)
      .post('/api/scheduler/v1/set')
      .send({ groups });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      errno: 0,
      msg: 'ok',
      result: { groups },
      flagResult: { errno: 0, result: { enable: 1 } },
      verify: null
    });
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/enable',
      'POST',
      { deviceSN: 'SN-SET', groups },
      { deviceSn: 'SN-SET' },
      'u-scheduler-set'
    );
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/set/flag',
      'POST',
      { deviceSN: 'SN-SET', enable: 1 },
      { deviceSn: 'SN-SET' },
      'u-scheduler-set'
    );
    expect(historyWrite).toHaveBeenCalledWith('u-scheduler-set', {
      type: 'scheduler_update',
      action: 'manual',
      groups,
      result: 'success'
    });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalledWith(
      '/op/v1/device/scheduler/get',
      'POST',
      { deviceSN: 'SN-SET' },
      { deviceSn: 'SN-SET' },
      'u-scheduler-set'
    );
  });

  test('set route verifies state when verify query is requested', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path) => {
        if (path === '/op/v1/device/scheduler/enable') {
          return { errno: 0, result: { accepted: true } };
        }
        if (path === '/op/v1/device/scheduler/set/flag') {
          return { errno: 0, result: { enable: 0 } };
        }
        if (path === '/op/v1/device/scheduler/get') {
          return { errno: 0, result: { groups: [], enable: false } };
        }
        return { errno: 0, result: {} };
      })
    };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-scheduler-set' };
        next();
      });

      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: jest.fn(async () => undefined),
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-SET' })),
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .post('/api/scheduler/v1/set?verify=1')
      .send({ groups: [{ enable: 0 }] });

    expect(response.statusCode).toBe(200);
    expect(response.body.flagResult).toEqual({ errno: 0, result: { enable: 0 } });
    expect(response.body.verify).toEqual({ groups: [], enable: false });
    expect(foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/get',
      'POST',
      { deviceSN: 'SN-SET' },
      { deviceSn: 'SN-SET' },
      'u-scheduler-set'
    );
  });

  test('set route tolerates scheduler flag errors and keeps success response', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path) => {
        if (path === '/op/v1/device/scheduler/enable') {
          return { errno: 0, result: { accepted: true } };
        }
        if (path === '/op/v1/device/scheduler/set/flag') {
          throw new Error('flag failed');
        }
        return { errno: 0, result: {} };
      })
    };

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-scheduler-set' };
        next();
      });

      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: jest.fn(async () => undefined),
        authenticateUser: (_req, _res, next) => next(),
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-SET' })),
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .post('/api/scheduler/v1/set')
      .send({ groups: [{ enable: 0 }] });

    expect(response.statusCode).toBe(200);
    expect(response.body.flagResult).toBeNull();
    expect(response.body.verify).toBeNull();
  });

  test('clear-all route enforces authenticate middleware', async () => {
    const authenticateUser = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-scheduler-clear' };
      return next();
    };
    const foxessAPI = { callFoxESSAPI: jest.fn() };

    const app = buildApp((instance) => {
      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: jest.fn(async () => undefined),
        authenticateUser,
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-CLEAR' })),
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app).post('/api/scheduler/v1/clear-all').send({});

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
    expect(foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
  });

  test('clear-all route clears all groups, disables flag, skips verify by default and writes history', async () => {
    const historyWrite = jest.fn(async () => undefined);
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path, _method, payload) => {
        if (path === '/op/v1/device/scheduler/enable') {
          return { errno: 0, msg: 'ok', result: { groups: payload.groups } };
        }
        if (path === '/op/v1/device/scheduler/set/flag') {
          return { errno: 0, result: { enable: payload.enable } };
        }
        return { errno: 0, result: {} };
      })
    };

    const app = buildApp((instance) => {
      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: historyWrite,
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-scheduler-clear' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-CLEAR' })),
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .post('/api/scheduler/v1/clear-all')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.flagResult).toEqual({ errno: 0, result: { enable: 0 } });
    expect(response.body.verify).toBeNull();

    const clearGroupsPayload = foxessAPI.callFoxESSAPI.mock.calls.find(
      (call) => call[0] === '/op/v1/device/scheduler/enable'
    )[2];
    expect(clearGroupsPayload.deviceSN).toBe('SN-CLEAR');
    expect(clearGroupsPayload.groups).toHaveLength(8);
    expect(clearGroupsPayload.groups.every((group) => group.enable === 0)).toBe(true);
    expect(historyWrite).toHaveBeenCalledWith('u-scheduler-clear', {
      type: 'scheduler_clear',
      by: 'u-scheduler-clear'
    });
  });

  test('clear-all route verifies state when verify query is requested', async () => {
    const foxessAPI = {
      callFoxESSAPI: jest.fn(async (path, _method, payload) => {
        if (path === '/op/v1/device/scheduler/enable') {
          return { errno: 0, msg: 'ok', result: { groups: payload.groups } };
        }
        if (path === '/op/v1/device/scheduler/set/flag') {
          return { errno: 0, result: { enable: payload.enable } };
        }
        if (path === '/op/v1/device/scheduler/get') {
          return { errno: 0, result: { groups: [{ enable: 0 }], enable: false } };
        }
        return { errno: 0, result: {} };
      })
    };

    const app = buildApp((instance) => {
      registerSchedulerMutationRoutes(instance, {
        addHistoryEntry: jest.fn(async () => undefined),
        authenticateUser: (req, _res, next) => {
          req.user = { uid: 'u-scheduler-clear' };
          next();
        },
        foxessAPI,
        getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-CLEAR' })),
        logger: { debug: jest.fn(), warn: jest.fn() }
      });
    });

    const response = await request(app)
      .post('/api/scheduler/v1/clear-all?verify=true')
      .send({});

    expect(response.statusCode).toBe(200);
    expect(response.body.verify).toEqual({ groups: [{ enable: 0 }], enable: false });
  });

  test('buildClearedSchedulerGroups returns 8 disabled default groups', () => {
    const groups = buildClearedSchedulerGroups();
    expect(groups).toHaveLength(8);
    expect(groups.every((group) => group.enable === 0)).toBe(true);
    expect(groups[0]).toEqual(expect.objectContaining({
      workMode: 'SelfUse',
      startHour: 0,
      endHour: 0,
      maxSoc: 100
    }));
  });
});
