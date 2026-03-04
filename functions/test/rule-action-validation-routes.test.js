const request = require('supertest');

const mockCallFoxESSAPI = jest.fn().mockResolvedValue({ errno: 0, result: {} });
const TEST_UID = 'test_user_rules';
const mockVerifyIdToken = jest.fn().mockResolvedValue({ uid: TEST_UID });

const mockStore = new Map();
const mockWrites = [];

function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function pathKey(pathParts) {
  return pathParts.join('/');
}

function collectionSnapshot() {
  return {
    empty: true,
    docs: [],
    forEach: () => {}
  };
}

function createRef(pathParts = []) {
  const currentKey = pathKey(pathParts);
  const ref = {
    collection: jest.fn((name) => createRef([...pathParts, name])),
    doc: jest.fn((id) => createRef([...pathParts, id])),
    where: jest.fn(() => ref),
    orderBy: jest.fn(() => ref),
    limit: jest.fn(() => ref),
    add: jest.fn(async (data) => {
      mockWrites.push({ op: 'add', path: currentKey, data: deepClone(data) });
      return { id: 'mock_add_id' };
    }),
    delete: jest.fn(async () => {
      mockStore.delete(currentKey);
      mockWrites.push({ op: 'delete', path: currentKey });
    }),
    get: jest.fn(async () => {
      // Document refs have even path length: collection/doc/... pairs
      if (pathParts.length > 0 && pathParts.length % 2 === 0) {
        if (mockStore.has(currentKey)) {
          const data = deepClone(mockStore.get(currentKey));
          return {
            exists: true,
            data: () => data
          };
        }
        return {
          exists: false,
          data: () => undefined
        };
      }
      return collectionSnapshot();
    }),
    set: jest.fn(async (data, options = {}) => {
      const existing = mockStore.get(currentKey) || {};
      const payload = deepClone(data);
      if (options && options.merge) {
        mockStore.set(currentKey, { ...existing, ...payload });
      } else {
        mockStore.set(currentKey, payload);
      }
      mockWrites.push({ op: 'set', path: currentKey, data: payload, options: deepClone(options) });
    }),
    update: jest.fn(async (data) => {
      const existing = mockStore.get(currentKey) || {};
      const payload = deepClone(data);
      mockStore.set(currentKey, { ...existing, ...payload });
      mockWrites.push({ op: 'update', path: currentKey, data: payload });
    })
  };
  return ref;
}

const mockDb = createRef([]);

jest.mock('firebase-admin', () => {
  const firestoreFn = jest.fn(() => mockDb);
  firestoreFn.FieldValue = {
    serverTimestamp: jest.fn(() => new Date()),
    increment: jest.fn((value) => ({ __increment: value }))
  };

  return {
    initializeApp: jest.fn(),
    firestore: firestoreFn,
    auth: jest.fn(() => ({
      verifyIdToken: mockVerifyIdToken
    })),
    FieldValue: firestoreFn.FieldValue,
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

jest.mock('../api/foxess', () => ({
  init: jest.fn(() => ({
    callFoxESSAPI: mockCallFoxESSAPI
  }))
}));

describe('Rule Action Validation Routes', () => {
  let app;

  function seedUserConfig(config = {}) {
    mockStore.set(`users/${TEST_UID}/config/main`, {
      deviceSn: 'TEST123',
      inverterCapacityW: 5000,
      ...deepClone(config)
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    mockWrites.length = 0;
    seedUserConfig();

    delete require.cache[require.resolve('../index.js')];
    app = require('../index.js').app;
  });

  test('rejects create when ForceCharge uses fdPwr <= 0', async () => {
    const response = await request(app)
      .post('/api/automation/rule/create')
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'Invalid ForceCharge Power',
        enabled: true,
        priority: 2,
        cooldownMinutes: 5,
        conditions: {},
        action: {
          workMode: 'ForceCharge',
          durationMinutes: 30,
          fdPwr: 0
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.errno).toBe(400);
    expect(response.body.error).toContain('action.fdPwr must be greater than 0');
  });

  test('rejects create when fdPwr exceeds configured inverter capacity', async () => {
    seedUserConfig({ inverterCapacityW: 4200 });

    const response = await request(app)
      .post('/api/automation/rule/create')
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'Too Much Power',
        enabled: true,
        priority: 2,
        cooldownMinutes: 5,
        conditions: {},
        action: {
          workMode: 'ForceDischarge',
          durationMinutes: 30,
          fdPwr: 5000
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.errno).toBe(400);
    expect(response.body.error).toContain('exceeds inverter capacity (4200W)');
  });

  test('accepts Feedin mode when fdPwr is valid', async () => {
    const response = await request(app)
      .post('/api/automation/rule/create')
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'Valid Feedin Rule',
        enabled: true,
        priority: 2,
        cooldownMinutes: 5,
        conditions: {},
        action: {
          workMode: 'Feedin',
          durationMinutes: 30,
          fdPwr: 3000
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.action.workMode).toBe('Feedin');
  });

  test('rejects update when merged action leaves ForceCharge with invalid fdPwr', async () => {
    mockStore.set(`users/${TEST_UID}/rules/merge_target_rule`, {
      name: 'Merge Target Rule',
      enabled: true,
      action: {
        workMode: 'ForceCharge',
        durationMinutes: 45,
        fdPwr: 2500
      }
    });

    const response = await request(app)
      .post('/api/automation/rule/update')
      .set('Authorization', 'Bearer valid-token')
      .send({
        ruleName: 'merge target rule',
        action: {
          fdPwr: 0
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.errno).toBe(400);
    expect(response.body.error).toContain('action.fdPwr must be greater than 0');
  });

  test('rejects update when non-power mode fdPwr exceeds inverter capacity', async () => {
    mockStore.set(`users/${TEST_UID}/rules/self_use_rule`, {
      name: 'Self Use Rule',
      enabled: true,
      action: {
        workMode: 'SelfUse',
        durationMinutes: 60,
        fdPwr: 0
      }
    });

    const response = await request(app)
      .post('/api/automation/rule/update')
      .set('Authorization', 'Bearer valid-token')
      .send({
        ruleName: 'self use rule',
        action: {
          fdPwr: 9000
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.errno).toBe(400);
    expect(response.body.error).toContain('exceeds inverter capacity');
  });

  test('deleting an active rule clears scheduler and active automation state', async () => {
    const activeRuleId = 'cheap_import_charging';
    mockStore.set(`users/${TEST_UID}/rules/${activeRuleId}`, {
      name: 'Cheap Import Charging',
      enabled: true,
      priority: 3,
      action: { workMode: 'ForceCharge', durationMinutes: 60, fdPwr: 2500 }
    });
    mockStore.set(`users/${TEST_UID}/automation/state`, {
      enabled: true,
      activeRule: activeRuleId,
      activeRuleName: 'Cheap Import Charging',
      activeSegment: 0,
      activeSegmentEnabled: true,
      lastTriggered: Date.now() - 5 * 60 * 1000
    });

    const response = await request(app)
      .post('/api/automation/rule/delete')
      .set('Authorization', 'Bearer valid-token')
      .send({
        ruleName: 'Cheap Import Charging'
      });

    expect(response.status).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(response.body.result.deleted).toBe('Cheap Import Charging');
    expect(mockStore.has(`users/${TEST_UID}/rules/${activeRuleId}`)).toBe(false);

    const schedulerClearCall = mockCallFoxESSAPI.mock.calls.find(
      (call) => call[0] === '/op/v1/device/scheduler/enable'
    );
    expect(schedulerClearCall).toBeDefined();
    expect(schedulerClearCall[1]).toBe('POST');
    expect(schedulerClearCall[2]).toEqual(expect.objectContaining({
      deviceSN: 'TEST123',
      groups: expect.any(Array)
    }));
    expect(schedulerClearCall[2].groups).toHaveLength(8);
    expect(schedulerClearCall[2].groups.every((group) => (
      group.enable === 0 && group.workMode === 'SelfUse' && group.fdPwr === 0
    ))).toBe(true);
    expect(schedulerClearCall[4]).toBe(TEST_UID);

    const updatedState = mockStore.get(`users/${TEST_UID}/automation/state`);
    expect(updatedState.activeRule).toBeNull();
    expect(updatedState.activeRuleName).toBeNull();
    expect(updatedState.activeSegment).toBeNull();
    expect(updatedState.activeSegmentEnabled).toBe(false);

    const auditWrite = mockWrites.find((write) => (
      write.op === 'set' && write.path.startsWith(`users/${TEST_UID}/automationAudit/`)
    ));
    expect(auditWrite).toBeDefined();
    expect(auditWrite.data.triggered).toBe(false);
    expect(auditWrite.data.ruleId).toBe(activeRuleId);
    expect(auditWrite.data.activeRuleBefore).toBe(activeRuleId);
    expect(auditWrite.data.activeRuleAfter).toBeNull();
  });

  test('deleting a non-active rule does not trigger scheduler clearing', async () => {
    mockStore.set(`users/${TEST_UID}/rules/cheap_import_charging`, {
      name: 'Cheap Import Charging',
      enabled: true
    });
    mockStore.set(`users/${TEST_UID}/automation/state`, {
      enabled: true,
      activeRule: 'another_rule',
      activeRuleName: 'Another Rule',
      activeSegment: 2,
      activeSegmentEnabled: true
    });

    const response = await request(app)
      .post('/api/automation/rule/delete')
      .set('Authorization', 'Bearer valid-token')
      .send({
        ruleName: 'Cheap Import Charging'
      });

    expect(response.status).toBe(200);
    expect(response.body.errno).toBe(0);
    expect(mockStore.has(`users/${TEST_UID}/rules/cheap_import_charging`)).toBe(false);
    expect(mockCallFoxESSAPI).not.toHaveBeenCalled();

    const stateAfterDelete = mockStore.get(`users/${TEST_UID}/automation/state`);
    expect(stateAfterDelete.activeRule).toBe('another_rule');
    expect(stateAfterDelete.activeSegmentEnabled).toBe(true);
  });
});
