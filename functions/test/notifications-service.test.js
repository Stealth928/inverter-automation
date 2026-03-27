'use strict';

jest.mock('web-push', () => ({
  generateVAPIDKeys: jest.fn(),
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn()
}));

const webPush = require('web-push');
const { createNotificationsService } = require('../lib/services/notifications-service');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createTimestamp(value = 'ts') {
  return { __serverTimestamp: String(value) };
}

function createMockDb(seed = {}) {
  let autoId = 0;
  const users = deepClone(seed.users || {});

  function ensureUser(uid) {
    if (!users[uid]) {
      users[uid] = {
        configMain: {},
        notificationRuntimeState: {},
        notifications: {},
        pushSubscriptions: {}
      };
    }
    users[uid].configMain = users[uid].configMain || {};
    users[uid].notificationRuntimeState = users[uid].notificationRuntimeState || {};
    users[uid].notifications = users[uid].notifications || {};
    users[uid].pushSubscriptions = users[uid].pushSubscriptions || {};
    return users[uid];
  }

  function buildDocSnapshot(id, data, ref) {
    return {
      id,
      exists: data != null,
      data: () => (data == null ? undefined : deepClone(data)),
      ref
    };
  }

  function resolveCollectionDocs(path, queryState = {}) {
    if (path.length === 3 && path[0] === 'users' && path[2] === 'notifications') {
      const user = ensureUser(path[1]);
      let docs = Object.entries(user.notifications)
        .map(([id, data]) => ({ id, data: deepClone(data) }));
      if (Array.isArray(queryState.filters)) {
        queryState.filters.forEach((filter) => {
          if (filter.field === 'read' && filter.op === '==') {
            docs = docs.filter((doc) => Boolean(doc.data.read) === Boolean(filter.value));
          }
        });
      }
      if (Array.isArray(queryState.orderBy)) {
        queryState.orderBy.forEach((order) => {
          if (order.field === 'createdAtMs') {
            docs.sort((left, right) => Number(right.data.createdAtMs || 0) - Number(left.data.createdAtMs || 0));
          }
        });
      }
      if (queryState.startAfterCreatedAtMs != null) {
        docs = docs.filter((doc) => Number(doc.data.createdAtMs || 0) < Number(queryState.startAfterCreatedAtMs));
      }
      if (Number.isInteger(queryState.limit) && queryState.limit > 0) {
        docs = docs.slice(0, queryState.limit);
      }
      return docs;
    }

    if (path.length === 3 && path[0] === 'users' && path[2] === 'pushSubscriptions') {
      const user = ensureUser(path[1]);
      let docs = Object.entries(user.pushSubscriptions)
        .map(([id, data]) => ({ id, data: deepClone(data) }));
      if (Array.isArray(queryState.filters)) {
        queryState.filters.forEach((filter) => {
          if (filter.field === 'active' && filter.op === '==') {
            docs = docs.filter((doc) => Boolean(doc.data.active) === Boolean(filter.value));
          }
        });
      }
      if (Number.isInteger(queryState.limit) && queryState.limit > 0) {
        docs = docs.slice(0, queryState.limit);
      }
      return docs;
    }

    return [];
  }

  function createQuery(path, queryState = {}) {
    return {
      where(field, op, value) {
        const next = {
          ...queryState,
          filters: [...(queryState.filters || []), { field, op, value }]
        };
        return createQuery(path, next);
      },
      orderBy(field, direction) {
        const next = {
          ...queryState,
          orderBy: [...(queryState.orderBy || []), { field, direction }]
        };
        return createQuery(path, next);
      },
      limit(value) {
        return createQuery(path, { ...queryState, limit: Number(value) });
      },
      startAfter(createdAtMs) {
        return createQuery(path, { ...queryState, startAfterCreatedAtMs: Number(createdAtMs) });
      },
      async get() {
        const docs = resolveCollectionDocs(path, queryState).map((entry) => {
          const ref = createDocRef([...path, entry.id]);
          return buildDocSnapshot(entry.id, entry.data, ref);
        });
        return {
          size: docs.length,
          empty: docs.length === 0,
          docs,
          forEach: (fn) => docs.forEach(fn)
        };
      },
      count() {
        return {
          async get() {
            const docs = resolveCollectionDocs(path, queryState);
            return {
              data: () => ({ count: docs.length })
            };
          }
        };
      }
    };
  }

  function createDocRef(path) {
    const id = path[path.length - 1];
    return {
      id,
      collection(name) {
        return createCollectionRef([...path, name]);
      },
      async get() {
        if (path.length === 4 && path[0] === 'users' && path[2] === 'config' && path[3] === 'main') {
          const user = ensureUser(path[1]);
          const data = user.configMain && Object.keys(user.configMain).length ? user.configMain : null;
          return buildDocSnapshot(id, data, this);
        }
        if (path.length === 4 && path[0] === 'users' && path[2] === 'notificationRuntime' && path[3] === 'state') {
          const user = ensureUser(path[1]);
          const data = user.notificationRuntimeState && Object.keys(user.notificationRuntimeState).length
            ? user.notificationRuntimeState
            : null;
          return buildDocSnapshot(id, data, this);
        }
        if (path.length === 4 && path[0] === 'users' && path[2] === 'notifications') {
          const user = ensureUser(path[1]);
          const data = user.notifications[id] || null;
          return buildDocSnapshot(id, data, this);
        }
        if (path.length === 4 && path[0] === 'users' && path[2] === 'pushSubscriptions') {
          const user = ensureUser(path[1]);
          const data = user.pushSubscriptions[id] || null;
          return buildDocSnapshot(id, data, this);
        }
        return buildDocSnapshot(id, null, this);
      },
      async set(payload, options = {}) {
        if (path.length === 4 && path[0] === 'users' && path[2] === 'config' && path[3] === 'main') {
          const user = ensureUser(path[1]);
          user.configMain = options.merge
            ? { ...(user.configMain || {}), ...deepClone(payload) }
            : deepClone(payload);
          return;
        }
        if (path.length === 4 && path[0] === 'users' && path[2] === 'notificationRuntime' && path[3] === 'state') {
          const user = ensureUser(path[1]);
          user.notificationRuntimeState = options.merge
            ? { ...(user.notificationRuntimeState || {}), ...deepClone(payload) }
            : deepClone(payload);
          return;
        }
        if (path.length === 4 && path[0] === 'users' && path[2] === 'notifications') {
          const user = ensureUser(path[1]);
          const previous = user.notifications[id] || {};
          user.notifications[id] = options.merge
            ? { ...previous, ...deepClone(payload) }
            : deepClone(payload);
          return;
        }
        if (path.length === 4 && path[0] === 'users' && path[2] === 'pushSubscriptions') {
          const user = ensureUser(path[1]);
          const previous = user.pushSubscriptions[id] || {};
          user.pushSubscriptions[id] = options.merge
            ? { ...previous, ...deepClone(payload) }
            : deepClone(payload);
          return;
        }
      },
      async delete() {
        if (path.length === 4 && path[0] === 'users' && path[2] === 'notifications') {
          const user = ensureUser(path[1]);
          delete user.notifications[id];
        }
      }
    };
  }

  function createCollectionRef(path) {
    return {
      doc(docId) {
        const resolvedId = docId || `n-${++autoId}`;
        return createDocRef([...path, resolvedId]);
      },
      where(field, op, value) {
        return createQuery(path, { filters: [{ field, op, value }] });
      },
      orderBy(field, direction) {
        return createQuery(path, { orderBy: [{ field, direction }] });
      },
      limit(value) {
        return createQuery(path, { limit: Number(value) });
      },
      async get() {
        return createQuery(path, {}).get();
      },
      count() {
        return createQuery(path, {}).count();
      }
    };
  }

  const db = {
    collection(name) {
      return createCollectionRef([name]);
    },
    batch() {
      const ops = [];
      return {
        delete(ref) {
          ops.push(() => ref.delete());
        },
        set(ref, payload, options) {
          ops.push(() => ref.set(payload, options));
        },
        async commit() {
          for (const op of ops) {
            await op();
          }
        }
      };
    },
    async runTransaction(handler) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, payload, options) => ref.set(payload, options)
      };
      return handler(tx);
    }
  };

  return { db, users };
}

describe('notifications service', () => {
  const originalFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
  const originalFirebaseEmulatorHub = process.env.FIREBASE_EMULATOR_HUB;
  const originalFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIREBASE_EMULATOR_HUB;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'public-key';
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'private-key';
    process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:test@example.com';
    webPush.generateVAPIDKeys.mockReturnValue({
      publicKey: 'generated-public',
      privateKey: 'generated-private'
    });
  });

  afterAll(() => {
    if (originalFunctionsEmulator == null) {
      delete process.env.FUNCTIONS_EMULATOR;
    } else {
      process.env.FUNCTIONS_EMULATOR = originalFunctionsEmulator;
    }
    if (originalFirebaseEmulatorHub == null) {
      delete process.env.FIREBASE_EMULATOR_HUB;
    } else {
      process.env.FIREBASE_EMULATOR_HUB = originalFirebaseEmulatorHub;
    }
    if (originalFirestoreEmulatorHost == null) {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    } else {
      process.env.FIRESTORE_EMULATOR_HOST = originalFirestoreEmulatorHost;
    }
  });

  test('emitEventNotification enforces cooldown dedupe by event key', async () => {
    const { db, users } = createMockDb({
      users: {
        'user-1': {
          configMain: {
            notificationPreferences: {
              inboxEnabled: true,
              broadcastsEnabled: true,
              highSignalAutomationEnabled: true,
              curtailmentEnabled: true
            }
          },
          notificationRuntimeState: {},
          notifications: {},
          pushSubscriptions: {}
        }
      }
    });

    let nowMs = 1700000000000;
    const service = createNotificationsService({
      db,
      serverTimestamp: () => createTimestamp('ts'),
      now: () => nowMs,
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    });

    const first = await service.emitEventNotification('user-1', {
      eventType: 'telemetry_pause',
      stateSignature: 'stale_telemetry',
      title: 'Paused',
      body: 'Telemetry stale',
      channels: ['inbox'],
      cooldownMs: 10 * 60 * 1000
    });

    nowMs += 30 * 1000;
    const second = await service.emitEventNotification('user-1', {
      eventType: 'telemetry_pause',
      stateSignature: 'stale_telemetry',
      title: 'Paused',
      body: 'Telemetry stale',
      channels: ['inbox'],
      cooldownMs: 10 * 60 * 1000
    });

    expect(first.sent).toBe(true);
    expect(second).toEqual({ sent: false, reason: 'cooldown' });
    expect(Object.keys(users['user-1'].notifications)).toHaveLength(1);
  });

  test('sendPushToUser prunes invalid subscriptions on 410 responses', async () => {
    webPush.sendNotification.mockRejectedValue({ statusCode: 410 });

    const { db, users } = createMockDb({
      users: {
        'user-1': {
          configMain: {},
          notificationRuntimeState: {},
          notifications: {},
          pushSubscriptions: {
            'sub-1': {
              endpoint: 'https://example.com/push/1',
              keys: { p256dh: 'p256dh', auth: 'auth' },
              active: true,
              lastSeenAtMs: 1000
            }
          }
        }
      }
    });

    const service = createNotificationsService({
      db,
      serverTimestamp: () => createTimestamp('ts'),
      now: () => 1700000000000,
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    });

    const result = await service.sendPushToUser('user-1', {
      title: 'Admin alert',
      body: 'Body text',
      severity: 'warning'
    });

    expect(result).toEqual(expect.objectContaining({
      attempted: 1,
      success: 0,
      failure: 1,
      pruned: 1
    }));
    expect(users['user-1'].pushSubscriptions['sub-1']).toEqual(expect.objectContaining({
      active: false,
      lastErrorStatusCode: 410
    }));
  });

  test('getBootstrap defaults notification preferences to disabled when no config exists', async () => {
    const { db } = createMockDb({ users: { 'user-1': {} } });
    const service = createNotificationsService({
      db,
      serverTimestamp: () => createTimestamp('ts'),
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    });

    const bootstrap = await service.getBootstrap('user-1');

    expect(bootstrap.preferences).toEqual({
      inboxEnabled: false,
      broadcastsEnabled: false,
      highSignalAutomationEnabled: false,
      curtailmentEnabled: false
    });
  });

  test('getBootstrap uses generated VAPID keys in emulator when env vars are missing', async () => {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_VAPID_SUBJECT;
    process.env.FUNCTIONS_EMULATOR = 'true';
    webPush.generateVAPIDKeys.mockReturnValue({
      publicKey: 'emulator-public-key',
      privateKey: 'emulator-private-key'
    });

    const { db } = createMockDb({ users: { 'user-1': {} } });
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
    const service = createNotificationsService({
      db,
      serverTimestamp: () => createTimestamp('ts'),
      logger
    });

    const bootstrap = await service.getBootstrap('user-1');

    expect(bootstrap.push).toEqual({
      configured: true,
      vapidPublicKey: 'emulator-public-key'
    });
    expect(webPush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:emulator-notifications@local.invalid',
      'emulator-public-key',
      'emulator-private-key'
    );
    expect(logger.info).toHaveBeenCalledWith('[Notifications] Using generated VAPID keys for emulator runtime');
  });

  test('getBootstrap keeps push unconfigured outside emulators when env vars are missing', async () => {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_VAPID_SUBJECT;

    const { db } = createMockDb({ users: { 'user-1': {} } });
    const service = createNotificationsService({
      db,
      serverTimestamp: () => createTimestamp('ts'),
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    });

    const bootstrap = await service.getBootstrap('user-1');

    expect(bootstrap.push).toEqual({
      configured: false,
      vapidPublicKey: null
    });
    expect(webPush.generateVAPIDKeys).not.toHaveBeenCalled();
    expect(webPush.setVapidDetails).not.toHaveBeenCalled();
  });
});
