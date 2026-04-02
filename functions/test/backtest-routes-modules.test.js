'use strict';

const express = require('express');
const request = require('supertest');

const { registerBacktestRoutes } = require('../api/routes/backtests');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

describe('backtest route module', () => {
  test('requires auth for backtest runs list', async () => {
    const app = buildApp((instance) => {
      registerBacktestRoutes(instance, {
        backtestService: {
          createRun: jest.fn(),
          deleteRun: jest.fn(),
          listRuns: jest.fn(),
          getRun: jest.fn(),
          listTariffPlans: jest.fn(),
          createTariffPlan: jest.fn(),
          updateTariffPlan: jest.fn(),
          deleteTariffPlan: jest.fn()
        }
      });
    });

    const response = await request(app).get('/api/backtests/runs');
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('creates a backtest run through the service', async () => {
    const createRun = jest.fn(async () => ({ id: 'run-1', status: 'queued' }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-backtest' };
        next();
      });
      registerBacktestRoutes(instance, {
        backtestService: {
          createRun,
          deleteRun: jest.fn(),
          listRuns: jest.fn(),
          getRun: jest.fn(),
          listTariffPlans: jest.fn(),
          createTariffPlan: jest.fn(),
          updateTariffPlan: jest.fn(),
          deleteTariffPlan: jest.fn()
        }
      });
    });

    const response = await request(app)
      .post('/api/backtests/runs')
      .send({ period: { startDate: '2026-01-01', endDate: '2026-01-31' } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { id: 'run-1', status: 'queued' } });
    expect(createRun).toHaveBeenCalledWith('u-backtest', {
      period: { startDate: '2026-01-01', endDate: '2026-01-31' }
    });
  });

  test('rejects non-admin backtest access when admin gate is configured', async () => {
    const listRuns = jest.fn();

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-backtest' };
        next();
      });
      registerBacktestRoutes(instance, {
        backtestService: {
          createRun: jest.fn(),
          deleteRun: jest.fn(),
          listRuns,
          getRun: jest.fn(),
          listTariffPlans: jest.fn(),
          createTariffPlan: jest.fn(),
          updateTariffPlan: jest.fn(),
          deleteTariffPlan: jest.fn()
        },
        requireAdmin: (_req, res) => res.status(403).json({ errno: 403, error: 'Admin access required' })
      });
    });

    const response = await request(app).get('/api/backtests/runs');
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ errno: 403, error: 'Admin access required' });
    expect(listRuns).not.toHaveBeenCalled();
  });

  test('returns 404 when a run is missing', async () => {
    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-backtest' };
        next();
      });
      registerBacktestRoutes(instance, {
        backtestService: {
          createRun: jest.fn(),
          deleteRun: jest.fn(),
          listRuns: jest.fn(),
          getRun: jest.fn(async () => null),
          listTariffPlans: jest.fn(),
          createTariffPlan: jest.fn(),
          updateTariffPlan: jest.fn(),
          deleteTariffPlan: jest.fn()
        }
      });
    });

    const response = await request(app).get('/api/backtests/runs/missing');
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ errno: 404, error: 'Backtest run not found' });
  });

  test('deletes a manual tariff plan', async () => {
    const deleteTariffPlan = jest.fn(async () => true);

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-backtest' };
        next();
      });
      registerBacktestRoutes(instance, {
        backtestService: {
          createRun: jest.fn(),
          deleteRun: jest.fn(),
          listRuns: jest.fn(),
          getRun: jest.fn(),
          listTariffPlans: jest.fn(),
          createTariffPlan: jest.fn(),
          updateTariffPlan: jest.fn(),
          deleteTariffPlan
        }
      });
    });

    const response = await request(app).delete('/api/backtests/tariff-plans/plan-1');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { deleted: true } });
    expect(deleteTariffPlan).toHaveBeenCalledWith('u-backtest', 'plan-1');
  });

  test('deletes a completed backtest run', async () => {
    const deleteRun = jest.fn(async () => true);

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-backtest' };
        next();
      });
      registerBacktestRoutes(instance, {
        backtestService: {
          createRun: jest.fn(),
          deleteRun,
          listRuns: jest.fn(),
          getRun: jest.fn(),
          listTariffPlans: jest.fn(),
          createTariffPlan: jest.fn(),
          updateTariffPlan: jest.fn(),
          deleteTariffPlan: jest.fn()
        }
      });
    });

    const response = await request(app).delete('/api/backtests/runs/run-1');
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { deleted: true } });
    expect(deleteRun).toHaveBeenCalledWith('u-backtest', 'run-1');
  });
});
