'use strict';

const {
  ASSET_TYPES,
  buildLegacyFoxessAsset,
  createAssetRegistryRepository
} = require('../lib/repositories/asset-registry-repository');

// ---------------------------------------------------------------------------
// Minimal Firestore stub helpers (mirrors provider-accounts-repository.test.js)
// ---------------------------------------------------------------------------
function makeDocStub(exists, data) {
  return { exists, id: data?.id || 'docId', data: () => (exists ? { ...data } : undefined) };
}

function makeSnapshotStub(docsArray) {
  return { docs: docsArray };
}

function makeCollectionStub(docsMap = {}) {
  const stub = {
    _docs: { ...docsMap },
    doc: (id) => {
      const docId = id || `auto_${Date.now()}`;
      return {
        id: docId,
        get: async () => {
          const existing = stub._docs[docId];
          return makeDocStub(!!(existing?.exists), existing?.exists ? existing.data : undefined);
        },
        set: async (payload) => {
          stub._docs[docId] = { exists: true, data: payload };
        },
        delete: async () => {
          stub._docs[docId] = { exists: false, data: undefined };
        }
      };
    },
    get: async () => {
      const docs = Object.entries(stub._docs)
        .filter(([, v]) => v.exists)
        .map(([id, v]) => makeDocStub(true, { id, ...v.data }));
      return makeSnapshotStub(docs);
    },
    where: (_field, _op, val) => ({
      get: async () => {
        const matching = Object.entries(stub._docs)
          .filter(([, v]) => v.exists && v.data?.assetType === val)
          .map(([id, v]) => makeDocStub(true, { id, ...v.data }));
        return makeSnapshotStub(matching);
      }
    })
  };
  return stub;
}

function makeDbStub(assetsData = {}) {
  const assetsCol = makeCollectionStub(assetsData);
  return {
    collection: () => ({
      doc: () => ({
        collection: () => assetsCol
      })
    }),
    _assetsCol: assetsCol
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildLegacyFoxessAsset', () => {
  test('returns null when both deviceSn and foxessToken are absent', () => {
    expect(buildLegacyFoxessAsset({})).toBeNull();
    expect(buildLegacyFoxessAsset(null)).toBeNull();
    expect(buildLegacyFoxessAsset(undefined)).toBeNull();
  });

  test('builds asset from deviceSn (lowercase key)', () => {
    const asset = buildLegacyFoxessAsset({ deviceSn: 'SN-001', foxessToken: 'tok' });
    expect(asset).not.toBeNull();
    expect(asset.id).toBe('foxess_device_default');
    expect(asset.assetType).toBe(ASSET_TYPES.FOXESS);
    expect(asset.serialNumber).toBe('SN-001');
    expect(asset.label).toContain('SN-001');
    expect(asset._source).toBe('legacy-config');
  });

  test('builds asset from deviceSN (uppercase key)', () => {
    const asset = buildLegacyFoxessAsset({ deviceSN: 'SN-002' });
    expect(asset.serialNumber).toBe('SN-002');
  });

  test('serialNumber is null when only foxessToken is present', () => {
    const asset = buildLegacyFoxessAsset({ foxessToken: 'only-token' });
    expect(asset).not.toBeNull();
    expect(asset.serialNumber).toBeNull();
    expect(asset.label).toBe('FoxESS Inverter');
  });

  test('trims whitespace from deviceSn', () => {
    const asset = buildLegacyFoxessAsset({ deviceSn: '  SN-003  ' });
    expect(asset.serialNumber).toBe('SN-003');
  });
});

describe('createAssetRegistryRepository — constructor guards', () => {
  test('throws if db is missing', () => {
    expect(() => createAssetRegistryRepository({})).toThrow('Firestore db dependency');
  });

  test('throws if db lacks collection()', () => {
    expect(() => createAssetRegistryRepository({ db: {} })).toThrow('Firestore db dependency');
  });

  test('creates repository successfully with valid db', () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    expect(typeof repo.getAssets).toBe('function');
  });
});

describe('createAssetRegistryRepository — getAssets', () => {
  test('returns empty array when no v2 assets exist', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const result = await repo.getAssets('user1');
    expect(result).toEqual([]);
  });

  test('returns documents from v2 assets collection', async () => {
    const db = makeDbStub({
      asset_1: { exists: true, data: { assetType: 'foxess', serialNumber: 'SN-A' } }
    });
    const repo = createAssetRegistryRepository({ db });
    const result = await repo.getAssets('user1');
    expect(result).toHaveLength(1);
    expect(result[0].assetType).toBe('foxess');
    expect(result[0].serialNumber).toBe('SN-A');
  });

  test('skips non-existent documents', async () => {
    const db = makeDbStub({
      ghost_doc: { exists: false, data: {} }
    });
    const repo = createAssetRegistryRepository({ db });
    const result = await repo.getAssets('user1');
    expect(result).toEqual([]);
  });
});

describe('createAssetRegistryRepository — saveAsset', () => {
  test('saves asset with explicit id', async () => {
    const db = makeDbStub();
    const repo = createAssetRegistryRepository({ db, serverTimestamp: () => 'ts' });
    const saved = await repo.saveAsset('user1', {
      id: 'my_asset',
      assetType: 'foxess',
      serialNumber: 'SN-9'
    });
    expect(saved.id).toBe('my_asset');
    expect(saved.assetType).toBe('foxess');
    expect(saved.serialNumber).toBe('SN-9');
    expect(saved.updatedAt).toBe('ts');
  });

  test('saves asset without explicit id (auto-generated)', async () => {
    const db = makeDbStub();
    const repo = createAssetRegistryRepository({ db, serverTimestamp: () => 'ts' });
    const saved = await repo.saveAsset('user1', { assetType: 'generic' });
    expect(saved.id).toBeDefined();
    expect(saved.assetType).toBe('generic');
  });
});

describe('createAssetRegistryRepository — deleteAsset', () => {
  test('returns false for missing assetId', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const result = await repo.deleteAsset('user1', '');
    expect(result).toBe(false);
  });

  test('deletes existing asset and returns true', async () => {
    const db = makeDbStub({
      to_delete: { exists: true, data: { assetType: 'foxess' } }
    });
    const repo = createAssetRegistryRepository({ db });
    const result = await repo.deleteAsset('user1', 'to_delete');
    expect(result).toBe(true);
  });
});

describe('createAssetRegistryRepository — getAssetsWithLegacyFallback', () => {
  test('returns v2 assets when they exist (no fallback)', async () => {
    const db = makeDbStub({
      v2_asset: { exists: true, data: { assetType: 'foxess', serialNumber: 'V2-SN' } }
    });
    const repo = createAssetRegistryRepository({ db });
    const result = await repo.getAssetsWithLegacyFallback('user1', { deviceSn: 'OLD-SN' });
    expect(result).toHaveLength(1);
    expect(result[0].serialNumber).toBe('V2-SN');
  });

  test('falls back to legacy config when no v2 assets exist', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const result = await repo.getAssetsWithLegacyFallback('user1', {
      foxessToken: 'tok',
      deviceSn: 'LEGACY-SN'
    });
    expect(result).toHaveLength(1);
    expect(result[0].serialNumber).toBe('LEGACY-SN');
    expect(result[0]._source).toBe('legacy-config');
  });

  test('returns empty array when no v2 assets and no legacy config', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const result = await repo.getAssetsWithLegacyFallback('user1', {});
    expect(result).toEqual([]);
  });
});

describe('createAssetRegistryRepository — getEffectiveFoxessAsset', () => {
  test('returns first foxess asset', async () => {
    const db = makeDbStub({
      fox_1: { exists: true, data: { assetType: 'foxess', serialNumber: 'SN-F1' } }
    });
    const repo = createAssetRegistryRepository({ db });
    const asset = await repo.getEffectiveFoxessAsset('user1', {});
    expect(asset).not.toBeNull();
    expect(asset.assetType).toBe('foxess');
  });

  test('returns null when no foxess assets and no legacy config', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const asset = await repo.getEffectiveFoxessAsset('user1', {});
    expect(asset).toBeNull();
  });

  test('falls back to legacy when no v2 assets', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const asset = await repo.getEffectiveFoxessAsset('user1', { foxessToken: 't', deviceSn: 'LS' });
    expect(asset).not.toBeNull();
    expect(asset.serialNumber).toBe('LS');
  });
});

describe('createAssetRegistryRepository — migrateUserToAssets', () => {
  test('migrates legacy foxess config to v2 asset', async () => {
    const db = makeDbStub();
    const repo = createAssetRegistryRepository({ db, serverTimestamp: () => 'ts' });
    const outcome = await repo.migrateUserToAssets('user1', {
      foxessToken: 'my-token',
      deviceSn: 'MIG-SN'
    });
    expect(outcome.migrated).toBe(true);
    expect(outcome.assets).toHaveLength(1);
    expect(outcome.assets[0].assetType).toBe('foxess');
    expect(outcome.assets[0].serialNumber).toBe('MIG-SN');
  });

  test('is idempotent — no-op when v2 assets already exist', async () => {
    const db = makeDbStub({
      existing: { exists: true, data: { assetType: 'foxess', serialNumber: 'SN-EX' } }
    });
    const repo = createAssetRegistryRepository({ db });
    const outcome = await repo.migrateUserToAssets('user1', { foxessToken: 'tok', deviceSn: 'NEW' });
    expect(outcome.migrated).toBe(false);
    expect(outcome.assets).toHaveLength(1);
    expect(outcome.assets[0].serialNumber).toBe('SN-EX');
  });

  test('returns migrated:false when no legacy data to migrate', async () => {
    const repo = createAssetRegistryRepository({ db: makeDbStub() });
    const outcome = await repo.migrateUserToAssets('user1', {});
    expect(outcome.migrated).toBe(false);
    expect(outcome.assets).toHaveLength(0);
  });

  test('migration persists — getAssets reads back after migrate', async () => {
    const db = makeDbStub();
    const repo = createAssetRegistryRepository({ db, serverTimestamp: () => 'ts' });
    await repo.migrateUserToAssets('user1', { foxessToken: 'tok', deviceSn: 'PERSISTED' });
    const assets = await repo.getAssets('user1');
    expect(assets).toHaveLength(1);
    expect(assets[0].serialNumber).toBe('PERSISTED');
  });
});

describe('G4 criterion #3 — existing users continue without manual migration', () => {
  test('legacy user with only flat config gets their FoxESS asset via fallback', async () => {
    // Simulate a user who has never touched v2 — their Firestore assets subcollection is empty
    const repo = createAssetRegistryRepository({ db: makeDbStub() });

    // They still have legacy flat config (in users/{uid}/config/main)
    const legacyConfig = {
      foxessToken: 'legacy-foxess-token',
      deviceSn: 'LEGACY-INVERTER-001'
    };

    // getAssetsWithLegacyFallback must return a virtual asset — no migration needed
    const assets = await repo.getAssetsWithLegacyFallback('legacy-user', legacyConfig);
    expect(assets).toHaveLength(1);
    expect(assets[0].assetType).toBe(ASSET_TYPES.FOXESS);
    expect(assets[0].serialNumber).toBe('LEGACY-INVERTER-001');
    expect(assets[0]._source).toBe('legacy-config');
  });

  test('migrated user gets real v2 asset and legacy fallback is NOT used', async () => {
    const db = makeDbStub({
      foxess_device_default: {
        exists: true,
        data: { assetType: 'foxess', serialNumber: 'MIGRATED-SN', label: 'FoxESS Inverter (MIGRATED-SN)' }
      }
    });
    const repo = createAssetRegistryRepository({ db });

    // Even if old legacyConfig is still present, v2 takes precedence
    const assets = await repo.getAssetsWithLegacyFallback('migrated-user', {
      foxessToken: 'old-token',
      deviceSn: 'OLD-SN'
    });
    expect(assets).toHaveLength(1);
    expect(assets[0].serialNumber).toBe('MIGRATED-SN');
    expect(assets[0]._source).toBeUndefined(); // v2 docs don't carry _source
  });
});
