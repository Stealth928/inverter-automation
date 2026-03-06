'use strict';

const express = require('express');
const request = require('supertest');

const { registerHealthRoutes } = require('../api/routes/health');

function createDeps(overrides = {}) {
  return {
    getUserConfig: jest.fn(async () => ({})),
    tryAttachUser: jest.fn(async () => undefined),
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerHealthRoutes(app, deps);
  return app;
}

describe('health route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerHealthRoutes(app, {}))
      .toThrow('registerHealthRoutes requires getUserConfig()');
  });

  test('returns healthy envelope with hidden credentials when unauthenticated', async () => {
    const deps = createDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      FOXESS_TOKEN: false,
      AMBER_API_KEY: false
    });
  });

  test('returns token presence flags when user is attached', async () => {
    const deps = createDeps({
      tryAttachUser: jest.fn(async (req) => {
        req.user = { uid: 'u-health' };
      }),
      getUserConfig: jest.fn(async () => ({
        foxessToken: 'token',
        amberApiKey: 'amber-key'
      }))
    });
    const app = buildApp(deps);

    const response = await request(app).get('/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      FOXESS_TOKEN: true,
      AMBER_API_KEY: true
    });
    expect(deps.getUserConfig).toHaveBeenCalledWith('u-health');
  });
});
