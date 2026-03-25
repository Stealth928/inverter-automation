'use strict';

const express = require('express');
const request = require('supertest');

const { createApiRateLimiter } = require('../lib/services/api-rate-limiter');

function buildApp(options = {}) {
  const app = express();
  app.use(createApiRateLimiter({
    windowMs: 60 * 1000,
    max: 2,
    keyGenerator: options.keyGenerator || ((req) => req.headers['x-test-key'] || req.ip),
    skip: options.skip || (() => false),
    now: options.now
  }));
  app.get('/api/test', (_req, res) => {
    res.json({ errno: 0, ok: true });
  });
  app.get('/api/health', (_req, res) => {
    res.json({ errno: 0, ok: true });
  });
  return app;
}

describe('api rate limiter', () => {
  test('returns 429 after exceeding the per-key request budget', async () => {
    const app = buildApp();

    await request(app).get('/api/test').set('x-test-key', 'user-a').expect(200);
    await request(app).get('/api/test').set('x-test-key', 'user-a').expect(200);
    const blocked = await request(app).get('/api/test').set('x-test-key', 'user-a');

    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual({ errno: 429, error: 'Too many requests' });
    expect(blocked.headers['x-ratelimit-limit']).toBe('2');
  });

  test('skips configured health endpoints', async () => {
    const app = buildApp({
      skip: (req) => req.path === '/api/health'
    });

    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/health').expect(200);
  });
});