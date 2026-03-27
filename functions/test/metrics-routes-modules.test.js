'use strict';

const express = require('express');
const request = require('supertest');

const { registerMetricsRoutes } = require('../api/routes/metrics');

function createDbWithUserMetrics(userDocs = []) {
  const docsById = new Map(userDocs.map((doc) => [doc.id, doc]));
  const getDoc = jest.fn(async (docId) => {
    const doc = docsById.get(docId);
    if (doc) {
      return {
        exists: true,
        data: doc.data
      };
    }
    return {
      exists: false,
      data: () => ({})
    };
  });
  const doc = jest.fn((docId) => ({
    get: jest.fn(async () => getDoc(docId))
  }));

  return {
    __mocks: {
      doc,
      getDoc
    },
    collection: jest.fn((name) => {
      if (name !== 'users') {
        throw new Error(`Unexpected collection ${name}`);
      }
      return {
        doc: jest.fn((uid) => ({
          collection: jest.fn((sub) => {
            if (sub !== 'metrics') throw new Error(`Unexpected subcollection ${sub}`);
            return {
              doc
            };
          })
        }))
      };
    })
  };
}

function buildApp({ db, userId = 'u-1', isAdmin = () => true, attachUser = null } = {}) {
  const app = express();
  app.use(express.json());

  registerMetricsRoutes(app, {
    db,
    getAusDateKey: jest.fn(() => '2026-03-14'),
    isAdmin,
    tryAttachUser: jest.fn(async (req) => {
      if (typeof attachUser === 'function') {
        await attachUser(req);
        return;
      }
      req.user = { uid: userId };
    })
  });

  return app;
}

describe('metrics route module', () => {
  test('throws when required dependencies are missing', () => {
    const app = express();
    expect(() => registerMetricsRoutes(app, {}))
      .toThrow('registerMetricsRoutes requires getAusDateKey()');
  });

  test('does not inflate inverter totals with teslaFleet dotted counters', async () => {
    const todayDoc = {
      id: '2026-03-14',
      data: () => ({
        foxess: 164,
        amber: 379,
        weather: 38,
        ev: 272,
        'teslaFleet.calls.total': 284,
        'teslaFleet.calls.billable': 277,
        'teslaFleet.calls.byCategory.data_request': 269,
        'teslaFleet.calls.byStatus.s408': 215,
        'teslaFleet.calls.byStatus.s200': 51
      })
    };

    const db = createDbWithUserMetrics([todayDoc]);
    const app = buildApp({ db });

    const response = await request(app)
      .get('/api/metrics/api-calls?scope=user&days=1');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);

    const day = response.body.result['2026-03-14'];
    expect(day).toBeDefined();
    expect(day.foxess).toBe(164);
    expect(day.inverter).toBe(164);
    expect(day.ev).toBe(272);
    expect(day.amber).toBe(379);
    expect(day.weather).toBe(38);
    expect(day.inverterByProvider).toEqual({
      foxess: 164,
      sungrow: 0,
      sigenergy: 0,
      alphaess: 0
    });
    expect(db.__mocks.doc).toHaveBeenCalledWith('2026-03-14');
    expect(db.__mocks.getDoc).toHaveBeenCalledWith('2026-03-14');
  });

  test('respects explicit inverter field when present', async () => {
    const todayDoc = {
      id: '2026-03-14',
      data: () => ({
        inverter: 999,
        foxess: 164,
        amber: 10
      })
    };

    const db = createDbWithUserMetrics([todayDoc]);
    const app = buildApp({ db });

    const response = await request(app)
      .get('/api/metrics/api-calls?scope=user&days=1');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result['2026-03-14'].inverter).toBe(999);
    expect(response.body.result['2026-03-14'].foxess).toBe(164);
  });

  test('aggregates AEMO pricing without inflating inverter totals', async () => {
    const todayDoc = {
      id: '2026-03-14',
      data: () => ({
        foxess: 7,
        amber: 5,
        aemo: 4,
        weather: 2
      })
    };

    const db = createDbWithUserMetrics([todayDoc]);
    const app = buildApp({ db });

    const response = await request(app)
      .get('/api/metrics/api-calls?scope=user&days=1');

    expect(response.statusCode).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result['2026-03-14']).toEqual(expect.objectContaining({
      inverter: 7,
      foxess: 7,
      pricing: 9,
      amber: 9,
      aemo: 4,
      weather: 2
    }));
  });

  test('rejects unauthenticated global metrics access', async () => {
    const app = buildApp({
      db: null,
      attachUser: async (req) => {
        req.user = null;
      }
    });

    const response = await request(app)
      .get('/api/metrics/api-calls?scope=global&days=1');

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });

  test('rejects non-admin global metrics access', async () => {
    const app = buildApp({
      db: null,
      isAdmin: () => false
    });

    const response = await request(app)
      .get('/api/metrics/api-calls?scope=global&days=1');

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ errno: 401, error: 'Unauthorized' });
  });
});
