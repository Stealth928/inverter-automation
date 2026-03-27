'use strict';

const { createUserAutomationRepository } = require('../lib/repositories/user-automation-repository');

function buildRepositoryFixture(options = {}) {
  const {
    configMainData = null,
    secretsData = null,
    userDocData = null,
    rules = [],
    historyEntries = [],
    historyAddThrows = false
  } = options;

  let configMainState = configMainData ? { ...configMainData } : null;
  const ruleState = new Map(rules.map((rule) => [rule.id, { ...rule.data }]));
  const historyState = historyEntries.map((entry, index) => ({
    id: entry.id || `history-seed-${index + 1}`,
    data: { ...(entry.data || entry) }
  }));

  const historyWrites = [];
  let historyCounter = historyState.length;
  let lastRulesQuery = null;
  let secretsGetCalls = 0;

  function getRuleDocRef(ruleId) {
    return {
      id: ruleId,
      delete: async () => {
        ruleState.delete(ruleId);
      },
      get: async () => {
        const exists = ruleState.has(ruleId);
        return {
          data: () => (exists ? { ...ruleState.get(ruleId) } : undefined),
          exists,
          id: ruleId,
          ref: getRuleDocRef(ruleId)
        };
      },
      set: async (data, writeOptions) => {
        const existing = ruleState.get(ruleId) || {};
        if (writeOptions && writeOptions.merge) {
          ruleState.set(ruleId, { ...existing, ...data });
        } else {
          ruleState.set(ruleId, { ...data });
        }
      }
    };
  }

  function buildRuleDocs() {
    return Array.from(ruleState.entries()).map(([id, data]) => ({
      data: () => ({ ...data }),
      id,
      ref: getRuleDocRef(id)
    }));
  }

  const historyCollection = {
    add: async (entry) => {
      if (historyAddThrows) {
        throw new Error('history write failed');
      }
      historyCounter += 1;
      const id = `history-doc-${historyCounter}`;
      historyWrites.push({ ...entry });
      historyState.push({ id, data: { ...entry } });
      return { id };
    },
    orderBy: (field, direction = 'asc') => ({
      limit: (limitCount) => ({
        get: async () => {
          const sorted = [...historyState].sort((a, b) => {
            const left = Number(a.data[field] ?? 0);
            const right = Number(b.data[field] ?? 0);
            return direction === 'desc' ? right - left : left - right;
          });
          const docs = sorted.slice(0, limitCount).map((entry) => ({
            data: () => ({ ...entry.data }),
            id: entry.id
          }));
          return {
            docs,
            empty: docs.length === 0,
            forEach: (callback) => docs.forEach(callback),
            size: docs.length
          };
        }
      })
    })
  };

  const configMainDoc = {
    get: async () => ({
      data: () => (configMainState ? { ...configMainState } : undefined),
      exists: !!configMainState
    }),
    set: async (data, writeOptions) => {
      if (writeOptions && writeOptions.merge && configMainState) {
        configMainState = { ...configMainState, ...data };
      } else {
        configMainState = { ...data };
      }
    },
    update: async (updates) => {
      if (!configMainState) {
        throw new Error('config document missing');
      }
      configMainState = { ...configMainState, ...updates };
    }
  };

  const configCollection = {
    doc: () => configMainDoc
  };

  const rulesCollection = {
    doc: (ruleId) => getRuleDocRef(ruleId),
    get: async () => {
      lastRulesQuery = { type: 'all' };
      const docs = buildRuleDocs();
      return {
        docs,
        empty: docs.length === 0,
        forEach: (callback) => docs.forEach(callback),
        size: docs.length
      };
    },
    where: (field, operator, value) => ({
      get: async () => {
        lastRulesQuery = { type: 'where', field, operator, value };
        const docs = buildRuleDocs().filter((doc) => doc.data()[field] === value);
        return {
          docs,
          empty: docs.length === 0,
          forEach: (callback) => docs.forEach(callback),
          size: docs.length
        };
      }
    })
  };

  const userDocRef = {
    collection: (subCollectionName) => {
      if (subCollectionName === 'config') return configCollection;
      if (subCollectionName === 'rules') return rulesCollection;
      if (subCollectionName === 'history') return historyCollection;
      if (subCollectionName === 'secrets') {
        return {
          doc: () => ({
            get: async () => {
              secretsGetCalls += 1;
              return {
                exists: !!secretsData,
                data: () => (secretsData ? { ...secretsData } : {})
              };
            }
          })
        };
      }
      throw new Error(`Unexpected subcollection: ${subCollectionName}`);
    },
    get: async () => ({
      exists: !!userDocData,
      data: () => userDocData
    })
  };

  const db = {
    batch: () => {
      const operations = [];
      return {
        commit: async () => {
          for (const operation of operations) {
            await operation();
          }
        },
        update: (docRef, data) => {
          operations.push(() => docRef.set(data, { merge: true }));
        }
      };
    },
    collection: (name) => {
      if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
      return {
        doc: () => userDocRef
      };
    }
  };

  const repository = createUserAutomationRepository({
    db,
    logger: { debug: () => {} },
    serverTimestamp: () => 'ts-marker'
  });

  return {
    getConfigMainData: () => (configMainState ? { ...configMainState } : null),
    getHistoryState: () => historyState.map((entry) => ({ id: entry.id, data: { ...entry.data } })),
    getRuleData: (ruleId) => (ruleState.has(ruleId) ? { ...ruleState.get(ruleId) } : null),
    historyWrites,
    getLastRulesQuery: () => lastRulesQuery,
    getSecretsGetCalls: () => secretsGetCalls,
    repository
  };
}

describe('user-automation repository', () => {
  test('getUserConfig prefers users/{uid}/config/main', async () => {
    const fixture = buildRepositoryFixture({
      configMainData: {
        deviceSn: 'SN-123',
        foxessToken: 'TOKEN',
        amberApiKey: 'AMBER'
      },
      userDocData: {
        credentials: {
          device_sn: 'legacy-sn'
        }
      }
    });

    const config = await fixture.repository.getUserConfig('u1');

    expect(config).toEqual({
      deviceSn: 'SN-123',
      foxessToken: 'TOKEN',
      amberApiKey: 'AMBER',
      _source: 'config-main'
    });
  });

  test('getUserConfig falls back to legacy credentials mapping', async () => {
    const fixture = buildRepositoryFixture({
      userDocData: {
        credentials: {
          device_sn: 'legacy-sn',
          foxess_token: 'legacy-token',
          amber_api_key: 'legacy-amber'
        }
      }
    });

    const config = await fixture.repository.getUserConfig('u1');

    expect(config).toEqual({
      deviceSn: 'legacy-sn',
      foxessToken: 'legacy-token',
      amberApiKey: 'legacy-amber',
      setupComplete: true,
      _source: 'legacy-credentials'
    });
  });

  test('getUserConfigPublic reads config-main without loading secrets', async () => {
    const fixture = buildRepositoryFixture({
      configMainData: {
        deviceSn: 'SN-123',
        foxessToken: 'TOKEN',
        amberApiKey: 'AMBER'
      },
      secretsData: {
        alphaessAppSecret: 'SECRET'
      }
    });

    const config = await fixture.repository.getUserConfigPublic('u1');

    expect(config).toEqual({
      deviceSn: 'SN-123',
      foxessToken: 'TOKEN',
      amberApiKey: 'AMBER',
      _source: 'config-main'
    });
    expect(fixture.getSecretsGetCalls()).toBe(0);
  });

  test('getUserConfigWithSecrets merges secrets for config-main users', async () => {
    const fixture = buildRepositoryFixture({
      configMainData: {
        deviceSn: 'SN-123',
        foxessToken: 'TOKEN',
        amberApiKey: 'AMBER'
      },
      secretsData: {
        alphaessAppSecret: 'SECRET'
      }
    });

    const config = await fixture.repository.getUserConfigWithSecrets('u1');

    expect(config).toEqual({
      deviceSn: 'SN-123',
      foxessToken: 'TOKEN',
      amberApiKey: 'AMBER',
      alphaessAppSecret: 'SECRET',
      _source: 'config-main'
    });
    expect(fixture.getSecretsGetCalls()).toBe(1);
  });

  test('getUserRules maps collection docs to id-keyed object', async () => {
    const fixture = buildRepositoryFixture({
      rules: [
        { id: 'r1', data: { name: 'Rule 1', enabled: true } },
        { id: 'r2', data: { name: 'Rule 2', enabled: false } }
      ]
    });

    const rules = await fixture.repository.getUserRules('u1');

    expect(rules).toEqual({
      r1: { name: 'Rule 1', enabled: true },
      r2: { name: 'Rule 2', enabled: false }
    });
    expect(fixture.getLastRulesQuery()).toEqual({ type: 'all' });
  });

  test('getUserRules can query only enabled rules', async () => {
    const fixture = buildRepositoryFixture({
      rules: [
        { id: 'r1', data: { name: 'Rule 1', enabled: true } },
        { id: 'r2', data: { name: 'Rule 2', enabled: false } }
      ]
    });

    const rules = await fixture.repository.getUserRules('u1', { enabledOnly: true });

    expect(rules).toEqual({
      r1: { name: 'Rule 1', enabled: true }
    });
    expect(fixture.getLastRulesQuery()).toEqual({ type: 'where', field: 'enabled', operator: '==', value: true });
  });

  test('addHistoryEntry appends server timestamp and returns true', async () => {
    const fixture = buildRepositoryFixture();

    const ok = await fixture.repository.addHistoryEntry('u1', {
      type: 'automation_action',
      detail: 'test'
    });

    expect(ok).toBe(true);
    expect(fixture.historyWrites).toHaveLength(1);
    expect(fixture.historyWrites[0]).toEqual({
      type: 'automation_action',
      detail: 'test',
      timestamp: 'ts-marker'
    });
  });

  test('addHistoryEntry returns false on write failures', async () => {
    const fixture = buildRepositoryFixture({ historyAddThrows: true });
    const ok = await fixture.repository.addHistoryEntry('u1', { type: 'x' });
    expect(ok).toBe(false);
  });

  test('setUserConfig writes to users/{uid}/config/main with merge', async () => {
    const fixture = buildRepositoryFixture({
      configMainData: { timezone: 'Australia/Sydney' }
    });

    await fixture.repository.setUserConfig('u1', { location: 'Melbourne' }, { merge: true });

    expect(fixture.getConfigMainData()).toEqual({
      timezone: 'Australia/Sydney',
      location: 'Melbourne'
    });
  });

  test('updateUserConfig updates existing config document', async () => {
    const fixture = buildRepositoryFixture({
      configMainData: { setupComplete: true, timezone: 'Australia/Sydney' }
    });

    await fixture.repository.updateUserConfig('u1', { setupComplete: false });

    expect(fixture.getConfigMainData()).toEqual({
      setupComplete: false,
      timezone: 'Australia/Sydney'
    });
  });

  test('getUserRule returns null when rule does not exist', async () => {
    const fixture = buildRepositoryFixture();
    const rule = await fixture.repository.getUserRule('u1', 'missing');
    expect(rule).toBeNull();
  });

  test('setUserRule/getUserRule/deleteUserRule round trip works', async () => {
    const fixture = buildRepositoryFixture();

    await fixture.repository.setUserRule('u1', 'r1', { name: 'Rule 1', enabled: true });
    await fixture.repository.setUserRule('u1', 'r1', { priority: 2 }, { merge: true });

    const saved = await fixture.repository.getUserRule('u1', 'r1');
    expect(saved).toEqual({
      id: 'r1',
      data: { name: 'Rule 1', enabled: true, priority: 2 }
    });

    await fixture.repository.deleteUserRule('u1', 'r1');
    const deleted = await fixture.repository.getUserRule('u1', 'r1');
    expect(deleted).toBeNull();
  });

  test('clearRulesLastTriggered resets all rules and returns affected count', async () => {
    const fixture = buildRepositoryFixture({
      rules: [
        { id: 'r1', data: { lastTriggered: 123, name: 'A' } },
        { id: 'r2', data: { lastTriggered: 456, name: 'B' } }
      ]
    });

    const count = await fixture.repository.clearRulesLastTriggered('u1');

    expect(count).toBe(2);
    expect(fixture.getRuleData('r1').lastTriggered).toBeNull();
    expect(fixture.getRuleData('r2').lastTriggered).toBeNull();
  });

  test('getHistoryEntries returns timestamp-desc entries with limit', async () => {
    const fixture = buildRepositoryFixture({
      historyEntries: [
        { id: 'h1', data: { type: 'old', timestamp: 100 } },
        { id: 'h2', data: { type: 'new', timestamp: 300 } },
        { id: 'h3', data: { type: 'mid', timestamp: 200 } }
      ]
    });

    const history = await fixture.repository.getHistoryEntries('u1', 2);

    expect(history).toEqual([
      { id: 'h2', type: 'new', timestamp: 300 },
      { id: 'h3', type: 'mid', timestamp: 200 }
    ]);
  });
});
