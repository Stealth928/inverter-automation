'use strict';

const {
  createFeatureFlagService,
  isUserInRollout,
  hashString
} = require('../lib/services/feature-flag-service');

// ---------------------------------------------------------------------------
// Minimal Firestore mock (flags collection)
// ---------------------------------------------------------------------------

function makeFirestoreMock() {
  const store = new Map();

  function makeDocRef(path) {
    return {
      _path: path,
      async get() {
        const data = store.get(path);
        if (data === undefined) return { exists: false, data: () => undefined };
        return { exists: true, id: path.split('/').at(-1), data: () => ({ ...data }) };
      },
      async set(obj) { store.set(path, { ...obj }); },
      async update(obj) {
        const existing = store.get(path) || {};
        store.set(path, { ...existing, ...obj });
      },
      async delete() { store.delete(path); }
    };
  }

  function makeCollectionRef(collPath) {
    return {
      doc(id) { return makeDocRef(`${collPath}/${id}`); },
      async get() {
        const prefix = collPath + '/';
        const docs = [];
        for (const [key, val] of store.entries()) {
          if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
            docs.push({ exists: true, id: key.slice(prefix.length), data: () => ({ ...val }) });
          }
        }
        return { forEach(cb) { docs.forEach(cb); } };
      }
    };
  }

  const db = { collection(name) { return makeCollectionRef(name); } };
  return { db, store };
}

// ---------------------------------------------------------------------------
// 1 — Guard
// ---------------------------------------------------------------------------

describe('createFeatureFlagService — guard', () => {
  test('throws when db is not provided', () => {
    expect(() => createFeatureFlagService({})).toThrow(/requires a Firestore db/);
  });
});

// ---------------------------------------------------------------------------
// 2 — hashString and isUserInRollout helpers
// ---------------------------------------------------------------------------

describe('hashString', () => {
  test('returns a non-negative integer', () => {
    const h = hashString('hello');
    expect(typeof h).toBe('number');
    expect(h).toBeGreaterThanOrEqual(0);
  });

  test('is deterministic', () => {
    expect(hashString('user123:ev_charging')).toBe(hashString('user123:ev_charging'));
  });

  test('different inputs produce different hashes (no trivial collision)', () => {
    expect(hashString('user1:flag')).not.toBe(hashString('user2:flag'));
  });
});

describe('isUserInRollout', () => {
  test('100% rollout always returns true', () => {
    expect(isUserInRollout('user1', 'flag', 100)).toBe(true);
    expect(isUserInRollout('user99', 'flag', 100)).toBe(true);
  });

  test('0% rollout always returns false', () => {
    expect(isUserInRollout('user1', 'flag', 0)).toBe(false);
    expect(isUserInRollout('user99', 'flag', 0)).toBe(false);
  });

  test('50% rollout: deterministic per user+flag combo', () => {
    // same inputs always produce same result
    const r1 = isUserInRollout('userA', 'featureX', 50);
    const r2 = isUserInRollout('userA', 'featureX', 50);
    expect(r1).toBe(r2);
  });

  test('different users produce different bucket assignments for same flag', () => {
    // With 50% rollout, sampling 100 distinct users should produce both outcomes
    const results = new Set();
    for (let i = 0; i < 100; i++) {
      results.add(isUserInRollout(`testuser${i}`, 'evCharging', 50));
    }
    // Across 100 users at 50% we must see both true and false
    expect(results.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 3 — setFlag / getFlag / deleteFlag
// ---------------------------------------------------------------------------

describe('createFeatureFlagService — flag management', () => {
  function makeService() {
    const { db } = makeFirestoreMock();
    return createFeatureFlagService({ db, serverTimestamp: () => 'ts' });
  }

  test('setFlag then getFlag round-trips', async () => {
    const svc = makeService();
    await svc.setFlag('ev_charging', { enabled: true, rolloutPct: 25, description: 'EV charging feature' });
    const flag = await svc.getFlag('ev_charging');
    expect(flag.flagName).toBe('ev_charging');
    expect(flag.enabled).toBe(true);
    expect(flag.rolloutPct).toBe(25);
    expect(flag.description).toBe('EV charging feature');
  });

  test('getFlag returns null for unknown flag', async () => {
    const svc = makeService();
    expect(await svc.getFlag('missing')).toBeNull();
  });

  test('setFlag defaults: enabled=false, rolloutPct=0, empty lists', async () => {
    const svc = makeService();
    await svc.setFlag('bare', {});
    const flag = await svc.getFlag('bare');
    expect(flag.enabled).toBe(false);
    expect(flag.rolloutPct).toBe(0);
    expect(flag.allowlist).toEqual([]);
    expect(flag.denylist).toEqual([]);
  });

  test('setFlag clamps rolloutPct to [0, 100]', async () => {
    const svc = makeService();
    await svc.setFlag('clamp_high', { rolloutPct: 9999 });
    expect((await svc.getFlag('clamp_high')).rolloutPct).toBe(100);
    await svc.setFlag('clamp_low', { rolloutPct: -5 });
    expect((await svc.getFlag('clamp_low')).rolloutPct).toBe(0);
  });

  test('deleteFlag removes the flag', async () => {
    const svc = makeService();
    await svc.setFlag('deleteme', { enabled: true });
    await svc.deleteFlag('deleteme');
    expect(await svc.getFlag('deleteme')).toBeNull();
  });

  test('listFlags returns all defined flags', async () => {
    const svc = makeService();
    await svc.setFlag('f1', { enabled: true });
    await svc.setFlag('f2', { enabled: false });
    const flags = await svc.listFlags();
    expect(flags.map((f) => f.flagName).sort()).toEqual(['f1', 'f2']);
  });
});

// ---------------------------------------------------------------------------
// 4 — isEnabled evaluation order
// ---------------------------------------------------------------------------

describe('createFeatureFlagService — isEnabled', () => {
  function makeService() {
    const { db } = makeFirestoreMock();
    return createFeatureFlagService({ db, serverTimestamp: () => 'ts' });
  }

  test('unknown flag → false (safe default)', async () => {
    const svc = makeService();
    expect(await svc.isEnabled('user1', 'nonexistent_flag')).toBe(false);
  });

  test('disabled flag → false regardless of rolloutPct', async () => {
    const svc = makeService();
    await svc.setFlag('disabled_flag', { enabled: false, rolloutPct: 100 });
    expect(await svc.isEnabled('user1', 'disabled_flag')).toBe(false);
  });

  test('enabled flag at 100% → always true', async () => {
    const svc = makeService();
    await svc.setFlag('full_rollout', { enabled: true, rolloutPct: 100 });
    expect(await svc.isEnabled('user1', 'full_rollout')).toBe(true);
    expect(await svc.isEnabled('user99', 'full_rollout')).toBe(true);
  });

  test('enabled flag at 0% → always false', async () => {
    const svc = makeService();
    await svc.setFlag('zero_rollout', { enabled: true, rolloutPct: 0 });
    expect(await svc.isEnabled('user1', 'zero_rollout')).toBe(false);
  });

  test('denylist overrides allowlist and enabled+100%', async () => {
    const svc = makeService();
    await svc.setFlag('deny_test', {
      enabled: true,
      rolloutPct: 100,
      allowlist: ['user1'],
      denylist: ['user1']
    });
    expect(await svc.isEnabled('user1', 'deny_test')).toBe(false);
  });

  test('allowlist user is included even when rolloutPct=0', async () => {
    const svc = makeService();
    await svc.setFlag('allowlist_test', {
      enabled: true,
      rolloutPct: 0,
      allowlist: ['privileged_user']
    });
    expect(await svc.isEnabled('privileged_user', 'allowlist_test')).toBe(true);
    expect(await svc.isEnabled('regular_user', 'allowlist_test')).toBe(false);
  });

  test('allowlist ignores disabled flag constraint', async () => {
    const svc = makeService();
    await svc.setFlag('disabled_with_allowlist', {
      enabled: false,
      rolloutPct: 0,
      allowlist: ['beta_user']
    });
    // disabled flag, but user is in allowlist → true
    expect(await svc.isEnabled('beta_user', 'disabled_with_allowlist')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5 — isEnabledSync
// ---------------------------------------------------------------------------

describe('createFeatureFlagService — isEnabledSync', () => {
  function makeService() {
    const { db } = makeFirestoreMock();
    return createFeatureFlagService({ db, serverTimestamp: () => 'ts' });
  }

  test('returns false when definition is null', () => {
    const svc = makeService();
    expect(svc.isEnabledSync('user1', 'someflag', null)).toBe(false);
  });

  test('evaluates denylist synchronously', () => {
    const svc = makeService();
    const def = { enabled: true, rolloutPct: 100, allowlist: [], denylist: ['u1'] };
    expect(svc.isEnabledSync('u1', 'f', def)).toBe(false);
    expect(svc.isEnabledSync('u2', 'f', def)).toBe(true);
  });

  test('evaluates allowlist synchronously', () => {
    const svc = makeService();
    const def = { enabled: true, rolloutPct: 0, allowlist: ['beta'], denylist: [] };
    expect(svc.isEnabledSync('beta', 'f', def)).toBe(true);
    expect(svc.isEnabledSync('other', 'f', def)).toBe(false);
  });

  test('disabled definition returns false', () => {
    const svc = makeService();
    const def = { enabled: false, rolloutPct: 100, allowlist: [], denylist: [] };
    expect(svc.isEnabledSync('user1', 'f', def)).toBe(false);
  });
});
