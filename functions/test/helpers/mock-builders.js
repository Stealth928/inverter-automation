'use strict';

/**
 * Shared mock builders for route/service tests.
 *
 * Centralises the repeated mock-setup boilerplate that was copy-pasted across
 * 50+ test files. Import what you need; override individual fields with spread.
 *
 * @example
 * const { buildFoxessAPI, buildLogger, buildGetUserConfig } = require('./helpers/mock-builders');
 *
 * const foxessAPI = buildFoxessAPI({ callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: {} })) });
 * const logger    = buildLogger();
 */

/**
 * Returns a mock FoxESS API object.
 * @param {Partial<object>} overrides
 */
function buildFoxessAPI(overrides = {}) {
  return {
    callFoxESSAPI: jest.fn(async () => ({ errno: 0, result: {} })),
    ...overrides
  };
}

/**
 * Returns a mock Amber API object (all methods are no-ops by default).
 * @param {Partial<object>} overrides
 */
function buildAmberAPI(overrides = {}) {
  return {
    callAmberAPI: jest.fn(),
    cacheAmberPricesCurrent: jest.fn(),
    cacheAmberSites: jest.fn(),
    getCachedAmberPricesCurrent: jest.fn(async () => null),
    getCachedAmberSites: jest.fn(async () => null),
    ...overrides
  };
}

/**
 * Returns a mock logger that swallows all output.
 * @param {Partial<object>} overrides
 */
function buildLogger(overrides = {}) {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    ...overrides
  };
}

/**
 * Returns a mock getUserConfig function returning the given config shape.
 * @param {object} config - The config object to resolve with (default: empty FoxESS config)
 */
function buildGetUserConfig(config = { deviceSn: 'SN-MOCK', deviceProvider: 'foxess' }) {
  return jest.fn(async () => config);
}

/**
 * Returns a pass-through authenticateUser middleware mock.
 * Pass { uid } to attach a specific user to req.
 * @param {{ uid?: string }} options
 */
function buildAuthenticateUser({ uid = 'test-uid' } = {}) {
  return jest.fn((req, _res, next) => {
    req.user = { uid };
    return next();
  });
}

/**
 * Returns a tryAttachUser mock that attaches a user to req.
 * Pass null as uid to simulate unauthenticated requests.
 * @param {string|null} uid
 */
function buildTryAttachUser(uid = 'test-uid') {
  return jest.fn(async (req) => {
    if (uid) {
      req.user = { uid };
      return req.user;
    }
    req.user = null;
    return null;
  });
}

/**
 * Returns a mock Firestore db that stubs collection/doc chains.
 * @param {object} data - Document data to return from .get() calls
 */
function buildFirestoreDb(data = {}) {
  const docRef = {
    get: jest.fn(async () => ({ exists: Object.keys(data).length > 0, data: () => data })),
    set: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    collection: jest.fn(function() { return this; })
  };
  const colRef = {
    doc: jest.fn(() => docRef),
    get: jest.fn(async () => ({ empty: true, forEach: jest.fn() })),
    add: jest.fn(async () => docRef),
    where: jest.fn(function() { return this; }),
    orderBy: jest.fn(function() { return this; }),
    limit: jest.fn(function() { return this; })
  };
  return {
    collection: jest.fn(() => colRef),
    runTransaction: jest.fn(async (fn) => fn({ get: jest.fn(async () => ({ exists: false, data: () => ({}) })), set: jest.fn() }))
  };
}

/**
 * Returns a serverTimestamp mock returning a predictable value.
 */
function buildServerTimestamp() {
  return jest.fn(() => ({ _isServerTimestamp: true }));
}

module.exports = {
  buildAmberAPI,
  buildAuthenticateUser,
  buildFirestoreDb,
  buildFoxessAPI,
  buildGetUserConfig,
  buildLogger,
  buildServerTimestamp,
  buildTryAttachUser
};
