'use strict';

const express = require('express');
const request = require('supertest');

const { registerOptimizationRoutes } = require('../api/routes/optimizations');

function buildApp(registerFn) {
  const app = express();
  app.use(express.json());
  registerFn(app);
  return app;
}

describe('optimization route module', () => {
  test('requires auth for optimization runs list', async () => {
    const app = buildApp((instance) => {
      registerOptimizationRoutes(instance, {
        optimizationService: {
          createRun: jest.fn(),
          listRuns: jest.fn(),
          getRun: jest.fn(),
          applyVariant: jest.fn()
        }
      });
    });

    const response = await request(app).get('/api/optimizations/runs');
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('creates an optimization run through the service', async () => {
    const createRun = jest.fn(async () => ({ id: 'opt-1', status: 'queued' }));

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-opt' };
        next();
      });
      registerOptimizationRoutes(instance, {
        optimizationService: {
          createRun,
          listRuns: jest.fn(),
          getRun: jest.fn(),
          applyVariant: jest.fn()
        }
      });
    });

    const response = await request(app)
      .post('/api/optimizations/runs')
      .send({ backtestRunId: 'run-1', goal: 'maximize_roi' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ errno: 0, result: { id: 'opt-1', status: 'queued' } });
    expect(createRun).toHaveBeenCalledWith('u-opt', { backtestRunId: 'run-1', goal: 'maximize_roi' });
  });

  test('maps not found apply errors to 404', async () => {
    const applyVariant = jest.fn(async () => {
      throw new Error('Optimization variant not found');
    });

    const app = buildApp((instance) => {
      instance.use('/api', (req, _res, next) => {
        req.user = { uid: 'u-opt' };
        next();
      });
      registerOptimizationRoutes(instance, {
        optimizationService: {
          createRun: jest.fn(),
          listRuns: jest.fn(),
          getRun: jest.fn(),
          applyVariant
        }
      });
    });

    const response = await request(app)
      .post('/api/optimizations/runs/opt-1/apply')
      .send({ variantId: 'variant-1', confirm: true });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ errno: 404, error: 'Optimization variant not found' });
    expect(applyVariant).toHaveBeenCalledWith('u-opt', 'opt-1', 'variant-1', true);
  });
});
