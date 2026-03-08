'use strict';

const express = require('express');
const request = require('supertest');

const { registerProviderAccountsRoutes } = require('../api/routes/provider-accounts');

function buildRepo(overrides = {}) {
  return {
    getProviderAccountsWithLegacyFallback: jest.fn(async () => []),
    saveProviderAccount: jest.fn(async (userId, data) => ({
      id: data.id || 'new-id',
      providerType: data.providerType,
      defaultSiteId: data.defaultSiteId,
      defaultDeviceSn: data.defaultDeviceSn,
      updatedAt: '2024-01-01T00:00:00Z'
    })),
    deleteProviderAccount: jest.fn(async () => true),
    migrateUserToProviderAccounts: jest.fn(async () => ({ migrated: true, accounts: [] })),
    getSites: jest.fn(async () => []),
    ...overrides
  };
}

function createDeps(overrides = {}) {
  return {
    authenticateUser: (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).json({ errno: 401, error: 'Unauthorized' });
      }
      req.user = { uid: 'u-test' };
      return next();
    },
    getUserConfig: jest.fn(async () => ({ amberApiKey: 'abc', amberSiteId: 'site-1' })),
    providerAccountsRepo: buildRepo(),
    ...overrides
  };
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  registerProviderAccountsRoutes(app, deps);
  return app;
}

describe('provider accounts route module', () => {
  describe('dependency guardrails', () => {
    test('throws when app is missing', () => {
      expect(() => registerProviderAccountsRoutes(null, createDeps())).toThrow(
        'registerProviderAccountsRoutes requires an Express app'
      );
    });

    test('throws when authenticateUser is missing', () => {
      const app = express();
      expect(() => registerProviderAccountsRoutes(app, { providerAccountsRepo: buildRepo() })).toThrow(
        'registerProviderAccountsRoutes requires authenticateUser()'
      );
    });

    test('throws when providerAccountsRepo is invalid', () => {
      const app = express();
      const deps = createDeps({ providerAccountsRepo: {} });
      expect(() => registerProviderAccountsRoutes(app, deps)).toThrow(
        'registerProviderAccountsRoutes requires a valid providerAccountsRepo'
      );
    });
  });

  describe('GET /api/config/provider-accounts', () => {
    test('returns 401 when unauthenticated', async () => {
      const app = buildApp(createDeps());
      const res = await request(app).get('/api/config/provider-accounts');
      expect(res.statusCode).toBe(401);
    });

    test('returns empty accounts list when no accounts exist', async () => {
      const app = buildApp(createDeps());
      const res = await request(app)
        .get('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ errno: 0, result: [] });
    });

    test('returns accounts with credentials stripped', async () => {
      const providerAccountsRepo = buildRepo({
        getProviderAccountsWithLegacyFallback: jest.fn(async () => [
          {
            id: 'acc-1',
            providerType: 'amber',
            defaultSiteId: 'site-1',
            defaultDeviceSn: undefined,
            _source: 'v2',
            updatedAt: '2024-01-01',
            credentials: { apiKey: 'secret-key' }
          }
        ])
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));

      const res = await request(app)
        .get('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result).toHaveLength(1);
      expect(res.body.result[0]).not.toHaveProperty('credentials');
      expect(res.body.result[0]).toEqual({
        id: 'acc-1',
        providerType: 'amber',
        defaultSiteId: 'site-1',
        defaultDeviceSn: undefined,
        _source: 'v2',
        updatedAt: '2024-01-01'
      });
    });

    test('returns 500 on repo error', async () => {
      const providerAccountsRepo = buildRepo({
        getProviderAccountsWithLegacyFallback: jest.fn(async () => {
          throw new Error('db down');
        })
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));

      const res = await request(app)
        .get('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(500);
      expect(res.body.errno).toBe(500);
    });
  });

  describe('POST /api/config/provider-accounts', () => {
    test('returns 401 when unauthenticated', async () => {
      const app = buildApp(createDeps());
      const res = await request(app)
        .post('/api/config/provider-accounts')
        .send({ providerType: 'amber' });
      expect(res.statusCode).toBe(401);
    });

    test('returns 400 when providerType is missing', async () => {
      const app = buildApp(createDeps());
      const res = await request(app)
        .post('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token')
        .send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.errno).toBe(400);
    });

    test('saves provider account and returns safe result', async () => {
      const app = buildApp(createDeps());
      const res = await request(app)
        .post('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token')
        .send({ providerType: 'amber', defaultSiteId: 'site-1', credentials: { apiKey: 'secret' } });

      expect(res.statusCode).toBe(200);
      expect(res.body.errno).toBe(0);
      expect(res.body.result).not.toHaveProperty('credentials');
      expect(res.body.result).toMatchObject({ providerType: 'amber', defaultSiteId: 'site-1' });
    });

    test('normalizes providerType to lowercase', async () => {
      const deps = createDeps();
      const app = buildApp(deps);
      await request(app)
        .post('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token')
        .send({ providerType: 'AMBER' });

      expect(deps.providerAccountsRepo.saveProviderAccount).toHaveBeenCalledWith(
        'u-test',
        expect.objectContaining({ providerType: 'amber' })
      );
    });

    test('returns 500 on repo error', async () => {
      const providerAccountsRepo = buildRepo({
        saveProviderAccount: jest.fn(async () => {
          throw new Error('write failed');
        })
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));
      const res = await request(app)
        .post('/api/config/provider-accounts')
        .set('Authorization', 'Bearer token')
        .send({ providerType: 'amber' });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('DELETE /api/config/provider-accounts/:id', () => {
    test('returns 401 when unauthenticated', async () => {
      const app = buildApp(createDeps());
      const res = await request(app).delete('/api/config/provider-accounts/acc-1');
      expect(res.statusCode).toBe(401);
    });

    test('deletes account and returns result', async () => {
      const app = buildApp(createDeps());
      const res = await request(app)
        .delete('/api/config/provider-accounts/acc-1')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ errno: 0, result: { deleted: true } });
    });

    test('returns 500 on repo error', async () => {
      const providerAccountsRepo = buildRepo({
        deleteProviderAccount: jest.fn(async () => {
          throw new Error('delete failed');
        })
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));
      const res = await request(app)
        .delete('/api/config/provider-accounts/acc-1')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(500);
    });
  });

  describe('POST /api/config/provider-accounts/migrate', () => {
    test('returns 401 when unauthenticated', async () => {
      const app = buildApp(createDeps());
      const res = await request(app).post('/api/config/provider-accounts/migrate');
      expect(res.statusCode).toBe(401);
    });

    test('migrates user and returns result summary', async () => {
      const providerAccountsRepo = buildRepo({
        migrateUserToProviderAccounts: jest.fn(async () => ({
          migrated: true,
          accounts: [{ providerType: 'amber' }, { providerType: 'foxess' }]
        }))
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));
      const res = await request(app)
        .post('/api/config/provider-accounts/migrate')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ errno: 0, result: { migrated: true, accountCount: 2 } });
    });

    test('returns 500 on repo error', async () => {
      const providerAccountsRepo = buildRepo({
        migrateUserToProviderAccounts: jest.fn(async () => {
          throw new Error('migration failed');
        })
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));
      const res = await request(app)
        .post('/api/config/provider-accounts/migrate')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /api/config/sites', () => {
    test('returns 401 when unauthenticated', async () => {
      const app = buildApp(createDeps());
      const res = await request(app).get('/api/config/sites');
      expect(res.statusCode).toBe(401);
    });

    test('returns empty sites list', async () => {
      const app = buildApp(createDeps());
      const res = await request(app)
        .get('/api/config/sites')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ errno: 0, result: [] });
    });

    test('returns sites from repo', async () => {
      const providerAccountsRepo = buildRepo({
        getSites: jest.fn(async () => [{ siteId: 'site-1', name: 'Home' }])
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));
      const res = await request(app)
        .get('/api/config/sites')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(200);
      expect(res.body.result).toEqual([{ siteId: 'site-1', name: 'Home' }]);
    });

    test('returns 500 on repo error', async () => {
      const providerAccountsRepo = buildRepo({
        getSites: jest.fn(async () => {
          throw new Error('sites error');
        })
      });
      const app = buildApp(createDeps({ providerAccountsRepo }));
      const res = await request(app)
        .get('/api/config/sites')
        .set('Authorization', 'Bearer token');

      expect(res.statusCode).toBe(500);
    });
  });
});
