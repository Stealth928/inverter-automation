'use strict';

const { createAdminAccess } = require('../lib/admin-access');

function createDb(getImpl) {
  return {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: getImpl
      }))
    }))
  };
}

describe('admin-access module', () => {
  test('throws when db dependency is missing', () => {
    expect(() => createAdminAccess({})).toThrow('createAdminAccess requires Firestore db');
  });

  test('isAdmin returns true for seed admin email', async () => {
    const get = jest.fn(async () => ({ exists: true, data: () => ({ role: 'user' }) }));
    const db = createDb(get);
    const { isAdmin } = createAdminAccess({ db, seedAdminEmail: 'seed@example.com' });

    const req = { user: { uid: 'u1', email: 'seed@example.com' } };
    const result = await isAdmin(req);

    expect(result).toBe(true);
    expect(req._isAdmin).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  test('isAdmin reads Firestore role and caches result', async () => {
    const get = jest.fn(async () => ({ exists: true, data: () => ({ role: 'admin' }) }));
    const db = createDb(get);
    const { isAdmin } = createAdminAccess({ db, seedAdminEmail: 'seed@example.com' });

    const req = { user: { uid: 'u2', email: 'user@example.com' } };
    const first = await isAdmin(req);
    const second = await isAdmin(req);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('requireAdmin returns 403 when user is not admin', async () => {
    const get = jest.fn(async () => ({ exists: true, data: () => ({ role: 'user' }) }));
    const db = createDb(get);
    const { requireAdmin } = createAdminAccess({ db, seedAdminEmail: 'seed@example.com' });

    const req = { user: { uid: 'u3', email: 'user@example.com' } };
    const status = jest.fn(() => ({ json: jest.fn() }));
    const res = { status };
    const next = jest.fn();

    await requireAdmin(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
