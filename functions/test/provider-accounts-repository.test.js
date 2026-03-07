'use strict';

const {
  PROVIDER_TYPES,
  buildLegacyAmberAccount,
  buildLegacyFoxessAccount,
  createProviderAccountsRepository
} = require('../lib/repositories/provider-accounts-repository');

// ---------------------------------------------------------------------------
// Minimal Firestore stub helpers
// ---------------------------------------------------------------------------
function makeDocStub(exists, data) {
  return { exists, id: data?.id || 'docId', data: () => (exists ? { ...data } : undefined) };
}

function makeSnapshotStub(docsArray) {
  return { docs: docsArray };
}

function makeCollectionStub(docsMap = {}) {
  // docsMap: { [docId]: { exists, data } }
  const stub = {
    _docs: docsMap,
    _addedDocs: [],
    doc: (id) => {
      const docId = id || `auto_${Date.now()}`;
      const existing = docsMap[docId];
      return {
        id: docId,
        exists: !!(existing?.exists),
        data: () => (existing?.exists ? { ...existing.data } : undefined),
        get: async () => makeDocStub(!!(existing?.exists), existing?.exists ? existing.data : undefined),
        set: async (_payload) => {
          stub._docs[docId] = { exists: true, data: _payload };
        },
        delete: async () => {
          stub._docs[docId] = { exists: false, data: undefined };
        }
      };
    },
    add: async (payload) => {
      const newId = `auto_${Date.now()}`;
      stub._docs[newId] = { exists: true, data: payload };
      stub._addedDocs.push({ id: newId, ...payload });
      return { id: newId };
    },
    get: async () => {
      const docs = Object.entries(docsMap)
        .filter(([, v]) => v.exists)
        .map(([id, v]) => makeDocStub(true, { id, ...v.data }));
      return makeSnapshotStub(docs);
    },
    where: (_field, _op, _val) => ({
      limit: (_n) => ({
        get: async () => {
          const matching = Object.entries(docsMap)
            .filter(([, v]) => v.exists && v.data?.providerType === _val)
            .map(([id, v]) => makeDocStub(true, { id, ...v.data }));
          return makeSnapshotStub(matching.slice(0, _n));
        }
      })
    })
  };
  return stub;
}

function makeDbStub(providerAccountsData = {}, sitesData = {}) {
  const providerAccountsCol = makeCollectionStub(providerAccountsData);
  const sitesCol = makeCollectionStub(sitesData);

  return {
    collection: () => ({
      doc: (userId) => ({
        collection: (name) => {
          if (name === 'providerAccounts') return providerAccountsCol;
          if (name === 'sites') return sitesCol;
          return makeCollectionStub();
        }
      })
    }),
    _providerAccountsCol: providerAccountsCol,
    _sitesCol: sitesCol
  };
}

// ---------------------------------------------------------------------------
// Tests: legacy builder helpers
// ---------------------------------------------------------------------------
describe('buildLegacyAmberAccount', () => {
  it('returns null when amberApiKey is absent', () => {
    expect(buildLegacyAmberAccount({})).toBeNull();
    expect(buildLegacyAmberAccount({ amberApiKey: '' })).toBeNull();
    expect(buildLegacyAmberAccount(null)).toBeNull();
  });

  it('returns a virtual amber account with credentials and defaultSiteId', () => {
    const account = buildLegacyAmberAccount({ amberApiKey: 'ak123', amberSiteId: 'site1' });
    expect(account).not.toBeNull();
    expect(account.providerType).toBe(PROVIDER_TYPES.AMBER);
    expect(account.credentials.apiKey).toBe('ak123');
    expect(account.defaultSiteId).toBe('site1');
    expect(account._source).toBe('legacy-config');
  });

  it('sets defaultSiteId to null when amberSiteId is absent', () => {
    const account = buildLegacyAmberAccount({ amberApiKey: 'ak123' });
    expect(account.defaultSiteId).toBeNull();
  });
});

describe('buildLegacyFoxessAccount', () => {
  it('returns null when foxessToken is absent', () => {
    expect(buildLegacyFoxessAccount({})).toBeNull();
    expect(buildLegacyFoxessAccount({ foxessToken: '' })).toBeNull();
    expect(buildLegacyFoxessAccount(null)).toBeNull();
  });

  it('returns a virtual foxess account with credentials and defaultDeviceSn', () => {
    const account = buildLegacyFoxessAccount({ foxessToken: 'tok1', deviceSn: 'SN123' });
    expect(account).not.toBeNull();
    expect(account.providerType).toBe(PROVIDER_TYPES.FOXESS);
    expect(account.credentials.token).toBe('tok1');
    expect(account.defaultDeviceSn).toBe('SN123');
  });

  it('handles deviceSN (capital SN) variant', () => {
    const account = buildLegacyFoxessAccount({ foxessToken: 'tok1', deviceSN: 'SN456' });
    expect(account.defaultDeviceSn).toBe('SN456');
  });
});

// ---------------------------------------------------------------------------
// Tests: dependency guardrail
// ---------------------------------------------------------------------------
describe('createProviderAccountsRepository - dependency guard', () => {
  it('throws when db is missing', () => {
    expect(() => createProviderAccountsRepository({})).toThrow(/requires a Firestore db/);
    expect(() => createProviderAccountsRepository({ db: null })).toThrow(/requires a Firestore db/);
  });
});

// ---------------------------------------------------------------------------
// Tests: getProviderAccounts
// ---------------------------------------------------------------------------
describe('getProviderAccounts', () => {
  it('returns empty array when no documents exist', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccounts('user1');
    expect(result).toEqual([]);
  });

  it('returns all existing provider account documents', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'amber', credentials: { apiKey: 'k1' } } },
      acc2: { exists: true, data: { providerType: 'foxess', credentials: { token: 't1' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccounts('user1');
    expect(result).toHaveLength(2);
    const types = result.map((a) => a.providerType).sort();
    expect(types).toEqual(['amber', 'foxess']);
  });
});

// ---------------------------------------------------------------------------
// Tests: getProviderAccountByType
// ---------------------------------------------------------------------------
describe('getProviderAccountByType', () => {
  it('returns null when no matching type exists', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'foxess', credentials: { token: 't1' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccountByType('user1', 'amber');
    expect(result).toBeNull();
  });

  it('returns the first matching account for the given type', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'amber', credentials: { apiKey: 'k1' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccountByType('user1', 'amber');
    expect(result).not.toBeNull();
    expect(result.providerType).toBe('amber');
    expect(result.credentials.apiKey).toBe('k1');
  });

  it('returns null when providerType is empty', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    expect(await repo.getProviderAccountByType('user1', '')).toBeNull();
    expect(await repo.getProviderAccountByType('user1', null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: saveProviderAccount
// ---------------------------------------------------------------------------
describe('saveProviderAccount', () => {
  it('saves an account with a provided id', async () => {
    const db = makeDbStub();
    const repo = createProviderAccountsRepository({ db });
    const saved = await repo.saveProviderAccount('user1', {
      id: 'amber_default',
      providerType: 'amber',
      credentials: { apiKey: 'k999' }
    });
    expect(saved.id).toBe('amber_default');
    expect(saved.providerType).toBe('amber');
    expect(saved.credentials.apiKey).toBe('k999');
    expect(saved.updatedAt).toBeDefined();
  });

  it('auto-generates a document id when none is provided', async () => {
    const db = makeDbStub();
    const repo = createProviderAccountsRepository({ db });
    const saved = await repo.saveProviderAccount('user1', {
      providerType: 'amber',
      credentials: { apiKey: 'k999' }
    });
    expect(saved.id).toBeDefined();
    expect(saved.providerType).toBe('amber');
  });
});

// ---------------------------------------------------------------------------
// Tests: deleteProviderAccount
// ---------------------------------------------------------------------------
describe('deleteProviderAccount', () => {
  it('returns false when accountId is empty', async () => {
    const db = makeDbStub();
    const repo = createProviderAccountsRepository({ db });
    expect(await repo.deleteProviderAccount('user1', '')).toBe(false);
    expect(await repo.deleteProviderAccount('user1', null)).toBe(false);
  });

  it('deletes the specified account and returns true', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'amber' } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.deleteProviderAccount('user1', 'acc1');
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: getProviderAccountsWithLegacyFallback
// ---------------------------------------------------------------------------
describe('getProviderAccountsWithLegacyFallback', () => {
  it('returns v2 accounts when they exist (no fallback)', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'amber', credentials: { apiKey: 'v2key' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccountsWithLegacyFallback('user1', {
      amberApiKey: 'legacyKey'
    });
    expect(result).toHaveLength(1);
    expect(result[0].credentials.apiKey).toBe('v2key');
    expect(result[0]._source).toBeUndefined();
  });

  it('falls back to legacy config when no v2 documents exist', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccountsWithLegacyFallback('user1', {
      amberApiKey: 'legacyKey',
      amberSiteId: 'site1',
      foxessToken: 'tokLegacy',
      deviceSn: 'SN_OLD'
    });
    expect(result).toHaveLength(2);
    const amber = result.find((a) => a.providerType === 'amber');
    const foxess = result.find((a) => a.providerType === 'foxess');
    expect(amber.credentials.apiKey).toBe('legacyKey');
    expect(amber.defaultSiteId).toBe('site1');
    expect(amber._source).toBe('legacy-config');
    expect(foxess.credentials.token).toBe('tokLegacy');
    expect(foxess.defaultDeviceSn).toBe('SN_OLD');
  });

  it('returns empty array when no v2 and no legacy credentials', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getProviderAccountsWithLegacyFallback('user1', {});
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: getEffectiveAmberAccount / getEffectiveFoxessAccount
// ---------------------------------------------------------------------------
describe('getEffectiveAmberAccount', () => {
  it('returns null when no amber account is present', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'foxess', credentials: { token: 't1' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getEffectiveAmberAccount('user1', {});
    expect(result).toBeNull();
  });

  it('returns amber account from v2', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'amber', credentials: { apiKey: 'v2k' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getEffectiveAmberAccount('user1', { amberApiKey: 'legacy' });
    expect(result.credentials.apiKey).toBe('v2k');
  });

  it('falls back to legacy config for amber account', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getEffectiveAmberAccount('user1', { amberApiKey: 'legacyAK' });
    expect(result).not.toBeNull();
    expect(result.credentials.apiKey).toBe('legacyAK');
    expect(result._source).toBe('legacy-config');
  });
});

describe('getEffectiveFoxessAccount', () => {
  it('returns null when no foxess credentials exist', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getEffectiveFoxessAccount('user1', {});
    expect(result).toBeNull();
  });

  it('returns foxess account from legacy fallback', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getEffectiveFoxessAccount('user1', { foxessToken: 'tLeg', deviceSn: 'SNLEG' });
    expect(result).not.toBeNull();
    expect(result.credentials.token).toBe('tLeg');
    expect(result.defaultDeviceSn).toBe('SNLEG');
  });
});

// ---------------------------------------------------------------------------
// Tests: migrateUserToProviderAccounts
// ---------------------------------------------------------------------------
describe('migrateUserToProviderAccounts', () => {
  it('is a no-op when v2 documents already exist', async () => {
    const db = makeDbStub({
      acc1: { exists: true, data: { providerType: 'amber', credentials: { apiKey: 'v2k' } } }
    });
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.migrateUserToProviderAccounts('user1', { amberApiKey: 'leg' });
    expect(result.migrated).toBe(false);
    expect(result.accounts).toHaveLength(1);
  });

  it('migrates valid legacy amber + foxess config to v2 documents', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.migrateUserToProviderAccounts('user1', {
      amberApiKey: 'legAK',
      amberSiteId: 'site42',
      foxessToken: 'legTok',
      deviceSn: 'SN_LEG'
    });
    expect(result.migrated).toBe(true);
    expect(result.accounts).toHaveLength(2);
    const amberAccount = result.accounts.find((a) => a.providerType === 'amber');
    expect(amberAccount.credentials.apiKey).toBe('legAK');
    expect(amberAccount.defaultSiteId).toBe('site42');
  });

  it('migrates only amber when foxess config is absent', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.migrateUserToProviderAccounts('user1', { amberApiKey: 'legAK' });
    expect(result.migrated).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].providerType).toBe('amber');
  });

  it('returns migrated:false and empty array when no credentials to migrate', async () => {
    const db = makeDbStub({});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.migrateUserToProviderAccounts('user1', {});
    expect(result.migrated).toBe(false);
    expect(result.accounts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: sites operations
// ---------------------------------------------------------------------------
describe('getSites', () => {
  it('returns empty array when no site documents exist', async () => {
    const db = makeDbStub({}, {});
    const repo = createProviderAccountsRepository({ db });
    const result = await repo.getSites('user1');
    expect(result).toEqual([]);
  });
});

describe('saveSite', () => {
  it('saves a site with a provided id', async () => {
    const db = makeDbStub({}, {});
    const repo = createProviderAccountsRepository({ db });
    const saved = await repo.saveSite('user1', 'site42', {
      externalId: 'SITE_42',
      nmi: '3032572111',
      providerType: 'amber'
    });
    expect(saved.id).toBe('site42');
    expect(saved.externalId).toBe('SITE_42');
    expect(saved.updatedAt).toBeDefined();
  });

  it('auto-generates id when siteId is null', async () => {
    const db = makeDbStub({}, {});
    const repo = createProviderAccountsRepository({ db });
    const saved = await repo.saveSite('user1', null, { externalId: 'AUTO_SITE' });
    expect(saved.id).toBeDefined();
    expect(saved.externalId).toBe('AUTO_SITE');
  });
});
