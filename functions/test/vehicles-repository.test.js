'use strict';

const { createVehiclesRepository } = require('../lib/repositories/vehicles-repository');

// ---------------------------------------------------------------------------
// Minimal Firestore mock
// ---------------------------------------------------------------------------
// Supports nested path: db.collection(c).doc(d).collection(c2).doc(d2).{get,set,update,delete}
// Also supports .orderBy().limit().get() for command list tests.
// ---------------------------------------------------------------------------

function makeFirestoreMock() {
  // In-memory store keyed by full path string
  const store = new Map();
  const timestamps = [];

  function pathKey(...segments) {
    return segments.join('/');
  }

  function makeDocRef(path) {
    return {
      _path: path,
      collection(subcollName) {
        return makeCollectionRef(`${path}/${subcollName}`);
      },
      async get() {
        const data = store.get(path);
        if (data === undefined) return { exists: false, data: () => undefined };
        return { exists: true, id: path.split('/').at(-1), data: () => ({ ...data }) };
      },
      async set(obj) {
        store.set(path, { ...obj });
      },
      async update(obj) {
        const existing = store.get(path) || {};
        store.set(path, { ...existing, ...obj });
      },
      async delete() {
        store.delete(path);
      }
    };
  }

  function makeCollectionRef(collPath) {
    return {
      _path: collPath,
      doc(docId) {
        return makeDocRef(`${collPath}/${docId}`);
      },
      async get() {
        // Return all docs under this collection path prefix
        const prefix = collPath + '/';
        const docs = [];
        for (const [key, val] of store.entries()) {
          // Match direct children (one level deep)
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            docs.push({
              exists: true,
              id: key.slice(prefix.length),
              data: () => ({ ...val })
            });
          }
        }
        return {
          size: docs.length,
          forEach(cb) { docs.forEach(cb); },
          docs
        };
      },
      orderBy() { return this; },
      limit() { return this; }
    };
  }

  function serverTimestamp() {
    const ts = new Date().toISOString();
    timestamps.push(ts);
    return ts;
  }

  const db = {
    collection(name) {
      return makeCollectionRef(name);
    }
  };

  return { db, store, serverTimestamp, timestamps };
}

// ---------------------------------------------------------------------------
// 1 — Guard
// ---------------------------------------------------------------------------

describe('createVehiclesRepository — guard', () => {
  test('throws when db is not provided', () => {
    expect(() => createVehiclesRepository({})).toThrow(/requires a Firestore db/);
  });

  test('throws when db.collection is not a function', () => {
    expect(() => createVehiclesRepository({ db: {} })).toThrow(/requires a Firestore db/);
  });
});

// ---------------------------------------------------------------------------
// 2 — Vehicle CRUD
// ---------------------------------------------------------------------------

describe('createVehiclesRepository — vehicle CRUD', () => {
  function makeRepo() {
    const { db, serverTimestamp } = makeFirestoreMock();
    return createVehiclesRepository({ db, serverTimestamp });
  }

  test('listVehicles returns empty array when no vehicles exist', async () => {
    const repo = makeRepo();
    const result = await repo.listVehicles('user1');
    expect(result).toEqual([]);
  });

  test('setVehicle then getVehicle round-trips', async () => {
    const repo = makeRepo();
    await repo.setVehicle('user1', 'v1', { provider: 'stub', displayName: 'My EV' });
    const vehicle = await repo.getVehicle('user1', 'v1');
    expect(vehicle.vehicleId).toBe('v1');
    expect(vehicle.provider).toBe('stub');
    expect(vehicle.displayName).toBe('My EV');
  });

  test('getVehicle returns null when not found', async () => {
    const repo = makeRepo();
    const result = await repo.getVehicle('user1', 'missing');
    expect(result).toBeNull();
  });

  test('listVehicles finds seeded vehicle', async () => {
    const repo = makeRepo();
    await repo.setVehicle('user1', 'v1', { provider: 'stub', displayName: 'EV1' });
    const list = await repo.listVehicles('user1');
    expect(list).toHaveLength(1);
    expect(list[0].vehicleId).toBe('v1');
    expect(list[0].provider).toBe('stub');
  });

  test('updateVehicle merges patch into existing document', async () => {
    const repo = makeRepo();
    await repo.setVehicle('user1', 'v2', { provider: 'stub', displayName: 'Old Name' });
    await repo.updateVehicle('user1', 'v2', { displayName: 'New Name' });
    const vehicle = await repo.getVehicle('user1', 'v2');
    expect(vehicle.displayName).toBe('New Name');
    expect(vehicle.provider).toBe('stub');
  });

  test('deleteVehicle removes document', async () => {
    const repo = makeRepo();
    await repo.setVehicle('user1', 'v3', { provider: 'stub' });
    await repo.deleteVehicle('user1', 'v3');
    const result = await repo.getVehicle('user1', 'v3');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3 — Credentials
// ---------------------------------------------------------------------------

describe('createVehiclesRepository — credentials', () => {
  function makeRepo() {
    const { db, serverTimestamp } = makeFirestoreMock();
    return createVehiclesRepository({ db, serverTimestamp });
  }

  test('setVehicleCredentials then getVehicleCredentials round-trips', async () => {
    const repo = makeRepo();
    await repo.setVehicle('user1', 'v1', { provider: 'tesla' });
    await repo.setVehicleCredentials('user1', 'v1', {
      accessToken: 'tok123',
      refreshToken: 'ref456',
      expiresAtMs: 9999999999000
    });
    const creds = await repo.getVehicleCredentials('user1', 'v1');
    expect(creds.accessToken).toBe('tok123');
    expect(creds.refreshToken).toBe('ref456');
  });

  test('getVehicleCredentials returns null for unknown vehicle', async () => {
    const repo = makeRepo();
    const result = await repo.getVehicleCredentials('user1', 'nope');
    expect(result).toBeNull();
  });

  test('getVehicleCredentials returns null when credentials field absent', async () => {
    const repo = makeRepo();
    await repo.setVehicle('user1', 'v1', { provider: 'stub' });
    const result = await repo.getVehicleCredentials('user1', 'v1');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4 — Vehicle state cache
// ---------------------------------------------------------------------------

describe('createVehiclesRepository — vehicle state', () => {
  function makeRepo() {
    const { db, serverTimestamp } = makeFirestoreMock();
    return createVehiclesRepository({ db, serverTimestamp });
  }

  test('saveVehicleState then getVehicleState round-trips', async () => {
    const repo = makeRepo();
    const status = { socPct: 72, chargingState: 'stopped', asOfIso: '2026-01-01T00:00:00.000Z' };
    await repo.saveVehicleState('user1', 'v1', status);
    const saved = await repo.getVehicleState('user1', 'v1');
    expect(saved.socPct).toBe(72);
    expect(saved.chargingState).toBe('stopped');
  });

  test('getVehicleState returns null when not saved', async () => {
    const repo = makeRepo();
    const result = await repo.getVehicleState('user1', 'v1');
    expect(result).toBeNull();
  });

  test('saveVehicleState overwrites prior state', async () => {
    const repo = makeRepo();
    await repo.saveVehicleState('user1', 'v1', { socPct: 50, chargingState: 'charging', asOfIso: 'T1' });
    await repo.saveVehicleState('user1', 'v1', { socPct: 85, chargingState: 'complete', asOfIso: 'T2' });
    const saved = await repo.getVehicleState('user1', 'v1');
    expect(saved.socPct).toBe(85);
    expect(saved.chargingState).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// 5 — Command audit log
// ---------------------------------------------------------------------------

describe('createVehiclesRepository — command audit log', () => {
  function makeRepo() {
    const { db, serverTimestamp } = makeFirestoreMock();
    return createVehiclesRepository({ db, serverTimestamp });
  }

  test('appendCommand then getCommand round-trips', async () => {
    const repo = makeRepo();
    const entry = {
      commandId: 'cmd-1',
      commandType: 'startCharging',
      status: 'sent',
      requestedAtIso: '2026-01-01T00:00:00.000Z'
    };
    const id = await repo.appendCommand('user1', 'v1', entry);
    expect(id).toBe('cmd-1');
    const fetched = await repo.getCommand('user1', 'v1', 'cmd-1');
    expect(fetched.commandType).toBe('startCharging');
    expect(fetched.status).toBe('sent');
  });

  test('appendCommand throws when commandId is missing', async () => {
    const repo = makeRepo();
    await expect(repo.appendCommand('user1', 'v1', { commandType: 'stop' }))
      .rejects.toThrow(/commandId is required/);
  });

  test('updateCommand merges status patch', async () => {
    const repo = makeRepo();
    await repo.appendCommand('user1', 'v1', { commandId: 'cmd-2', status: 'queued', commandType: 'stopCharging' });
    await repo.updateCommand('user1', 'v1', 'cmd-2', { status: 'confirmed', completedAtIso: '2026-01-01T01:00:00.000Z' });
    const fetched = await repo.getCommand('user1', 'v1', 'cmd-2');
    expect(fetched.status).toBe('confirmed');
    expect(fetched.completedAtIso).toBe('2026-01-01T01:00:00.000Z');
    expect(fetched.commandType).toBe('stopCharging');
  });

  test('getCommand returns null for unknown commandId', async () => {
    const repo = makeRepo();
    const result = await repo.getCommand('user1', 'v1', 'nope');
    expect(result).toBeNull();
  });

  test('listCommands returns commands in insertion order (mock does not sort)', async () => {
    const repo = makeRepo();
    await repo.appendCommand('user1', 'v1', { commandId: 'c1', commandType: 'startCharging', status: 'sent' });
    await repo.appendCommand('user1', 'v1', { commandId: 'c2', commandType: 'stopCharging', status: 'sent' });
    const list = await repo.listCommands('user1', 'v1');
    expect(list).toHaveLength(2);
    const ids = list.map((c) => c.commandId);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });
});
