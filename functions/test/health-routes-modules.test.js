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
      errno: 0,
      result: {
        status: 'OK'
      },
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
      errno: 0,
      result: {
        status: 'OK'
      },
      ok: true,
      FOXESS_TOKEN: true,
      AMBER_API_KEY: true
    });
    expect(deps.getUserConfig).toHaveBeenCalledWith('u-health');
  });

  test('returns degraded upstream snapshot with 503 when a critical service is unavailable', async () => {
    const deps = createDeps({
      getUpstreamHealthSnapshot: jest.fn(async () => ({
        status: 'DEGRADED',
        checkedAtMs: 1710000000000,
        services: {
          foxess: {
            status: 'DEGRADED',
            ok: false,
            mode: 'passive',
            circuit: { name: 'foxess', state: 'open', retryAfterMs: 45000 }
          },
          weather: {
            status: 'OK',
            ok: true,
            circuit: { name: 'weather', state: 'closed', retryAfterMs: 0 }
          }
        },
        cache: { hit: false, ttlMs: 300000 }
      }))
    });
    const app = buildApp(deps);

    const response = await request(app).get('/api/health?probe=1');

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual(expect.objectContaining({
      errno: 0,
      ok: true,
      FOXESS_TOKEN: false,
      AMBER_API_KEY: false,
      result: expect.objectContaining({
        status: 'DEGRADED',
        upstream: expect.objectContaining({
          status: 'DEGRADED',
          services: expect.objectContaining({
            foxess: expect.objectContaining({ ok: false })
          })
        })
      })
    }));
    expect(deps.getUpstreamHealthSnapshot).toHaveBeenCalledWith({
      forceRefresh: true,
      user: null
    });
  });
});
