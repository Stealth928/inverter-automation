const request = require('supertest');

const DEFAULT_TOPOLOGY_REFRESH_MS = 4 * 60 * 60 * 1000;

let mockStore = new Map();

function mockMergeDeep(target, source) {
  if (!target || typeof target !== 'object') return source;
  if (!source || typeof source !== 'object') return target;
  const out = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = out[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) && tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
      out[key] = mockMergeDeep(tgtVal, srcVal);
    } else {
      out[key] = srcVal;
    }
  }
  return out;
}

function mockCreateRef(path = []) {
  const key = path.join('/');
  return {
    collection: (name) => mockCreateRef([...path, name]),
    doc: (id) => mockCreateRef([...path, id]),
    where: () => mockCreateRef(path),
    orderBy: () => mockCreateRef(path),
    limit: () => mockCreateRef(path),
    add: async (data) => {
      const autoKey = `${key}/auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      mockStore.set(autoKey, data);
      return { id: autoKey.split('/').pop() };
    },
    get: async () => {
      if (mockStore.has(key)) {
        return {
          exists: true,
          data: () => mockStore.get(key)
        };
      }
      return { exists: false, data: () => undefined, docs: [], size: 0 };
    },
    set: async (data, options) => {
      if (options && options.merge && mockStore.has(key)) {
        const existing = mockStore.get(key) || {};
        mockStore.set(key, mockMergeDeep(existing, data));
      } else {
        mockStore.set(key, data);
      }
    },
    update: async (data) => {
      const existing = mockStore.get(key) || {};
      mockStore.set(key, mockMergeDeep(existing, data));
    },
    delete: async () => {
      mockStore.delete(key);
    }
  };
}

jest.mock('firebase-admin', () => {
  const authMock = {
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test_user_123' })
  };

  const firestoreFn = jest.fn(() => mockCreateRef([]));
  firestoreFn.FieldValue = {
    serverTimestamp: jest.fn(() => ({ __serverTimestamp: true })),
    delete: jest.fn(() => ({ __delete: true })),
    increment: jest.fn((value) => ({ __increment: value }))
  };

  return {
    initializeApp: jest.fn(),
    firestore: firestoreFn,
    auth: jest.fn(() => authMock),
    apps: []
  };
});

jest.mock('firebase-functions', () => ({
  ...jest.requireActual('firebase-functions'),
  config: jest.fn(() => ({
    foxess: { token: '', base_url: 'https://www.foxesscloud.com' },
    amber: { api_key: '', base_url: 'https://api.amber.com.au/v1' }
  }))
}));

describe('System Topology Config Endpoints', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = new Map();
    delete require.cache[require.resolve('../index.js')];
    const indexModule = require('../index.js');
    app = indexModule.app;
  });

  test('GET /api/config/system-topology returns default 4h refresh when stored value missing', async () => {
    const userConfigPath = 'users/test_user_123/config/main';
    mockStore.set(userConfigPath, {
      deviceSn: 'TEST123',
      systemTopology: {
        coupling: 'ac',
        source: 'auto',
        lastDetectedAt: Date.now()
      }
    });

    const res = await request(app)
      .get('/api/config/system-topology')
      .set('Authorization', 'Bearer test-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(res.body.result.coupling).toBe('ac');
    expect(res.body.result.isLikelyAcCoupled).toBe(true);
    expect(res.body.result.refreshAfterMs).toBe(DEFAULT_TOPOLOGY_REFRESH_MS);
  });

  test('POST /api/config/system-topology stores default 4h refresh when omitted', async () => {
    const res = await request(app)
      .post('/api/config/system-topology')
      .set('Authorization', 'Bearer test-token')
      .send({ coupling: 'dc', source: 'auto', confidence: 0.8 });

    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
    expect(res.body.result.coupling).toBe('dc');
    expect(res.body.result.refreshAfterMs).toBe(DEFAULT_TOPOLOGY_REFRESH_MS);

    const saved = mockStore.get('users/test_user_123/config/main');
    expect(saved.systemTopology.coupling).toBe('dc');
    expect(saved.systemTopology.refreshAfterMs).toBe(DEFAULT_TOPOLOGY_REFRESH_MS);
  });

  test('POST + GET keeps custom refreshAfterMs if provided', async () => {
    const customRefreshMs = 6 * 60 * 60 * 1000;

    const postRes = await request(app)
      .post('/api/config/system-topology')
      .set('Authorization', 'Bearer test-token')
      .send({ coupling: 'ac', source: 'manual', refreshAfterMs: customRefreshMs });

    expect(postRes.statusCode).toBe(200);
    expect(postRes.body.errno).toBe(0);
    expect(postRes.body.result.refreshAfterMs).toBe(customRefreshMs);

    const getRes = await request(app)
      .get('/api/config/system-topology')
      .set('Authorization', 'Bearer test-token');

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.errno).toBe(0);
    expect(getRes.body.result.coupling).toBe('ac');
    expect(getRes.body.result.isLikelyAcCoupled).toBe(true);
    expect(getRes.body.result.source).toBe('manual');
    expect(getRes.body.result.refreshAfterMs).toBe(customRefreshMs);
  });
});
