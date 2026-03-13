'use strict';

const { createApiMetricsService } = require('../lib/services/api-metrics-service');

function createMetricsHarness() {
  const userSet = jest.fn(async () => undefined);
  const userMetricsDocRef = { path: 'users/user-1/metrics/doc', set: userSet };
  const globalSet = jest.fn(async () => undefined);

  const globalMetricsDocRef = {
    set: globalSet
  };

  const metricsCollectionRef = {
    doc: jest.fn(() => globalMetricsDocRef)
  };

  const userMetricsCollectionRef = {
    doc: jest.fn(() => userMetricsDocRef)
  };

  const userDocRef = {
    collection: jest.fn((name) => {
      if (name !== 'metrics') throw new Error(`Unexpected user subcollection: ${name}`);
      return userMetricsCollectionRef;
    })
  };

  const usersCollectionRef = {
    doc: jest.fn(() => userDocRef)
  };

  const transaction = {
    get: jest.fn(async () => ({
      exists: false,
      data: () => ({})
    })),
    set: jest.fn()
  };

  const db = {
    collection: jest.fn((name) => {
      if (name === 'users') return usersCollectionRef;
      if (name === 'metrics') return metricsCollectionRef;
      throw new Error(`Unexpected collection: ${name}`);
    }),
    runTransaction: jest.fn(async (handler) => handler(transaction))
  };

  return {
    db,
    globalSet,
    userSet,
    metricsCollectionRef,
    transaction,
    userMetricsCollectionRef
  };
}

describe('api metrics service', () => {
  test('throws when required dependencies are missing', () => {
    expect(() => createApiMetricsService({})).toThrow('createApiMetricsService requires Firebase admin');
    expect(() => createApiMetricsService({ admin: {} })).toThrow('createApiMetricsService requires Firestore db');
  });

  test('getDateKey and getAusDateKey return stable date keys', () => {
    const { db } = createMetricsHarness();
    const service = createApiMetricsService({
      admin: { firestore: { FieldValue: { increment: jest.fn((value) => value) } } },
      db,
      defaultTimezone: 'Australia/Sydney',
      serverTimestamp: () => '__TS__'
    });

    const key = service.getDateKey(new Date('2026-03-06T00:00:00.000Z'), 'Australia/Sydney');
    const ausKey = service.getAusDateKey(new Date('2026-03-06T00:00:00.000Z'));

    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ausKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('incrementApiCount updates user and global metrics', async () => {
    const { db, globalSet, userSet } = createMetricsHarness();
    const increment = jest.fn((value) => ({ op: 'increment', value }));
    const logger = { debug: jest.fn() };

    const service = createApiMetricsService({
      admin: { firestore: { FieldValue: { increment } } },
      db,
      defaultTimezone: 'Australia/Sydney',
      serverTimestamp: () => '__TS__',
      logger
    });

    await service.incrementApiCount('user-1', 'weather');

    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(userSet).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalled();

    const [userData, setOptions] = userSet.mock.calls[0];
    expect(userData.weather).toEqual({ op: 'increment', value: 1 });
    expect(userData.updatedAt).toBe('__TS__');
    expect(setOptions).toEqual({ merge: true });

    expect(globalSet).toHaveBeenCalledTimes(1);
    const [globalPayload, globalOptions] = globalSet.mock.calls[0];
    expect(globalPayload.weather).toEqual({ op: 'increment', value: 1 });
    expect(globalPayload.updatedAt).toBe('__TS__');
    expect(globalOptions).toEqual({ merge: true });
  });

  test('incrementApiCount without userId still updates global metrics', async () => {
    const { db, globalSet } = createMetricsHarness();
    const service = createApiMetricsService({
      admin: { firestore: { FieldValue: { increment: jest.fn((value) => value) } } },
      db,
      defaultTimezone: 'Australia/Sydney',
      serverTimestamp: () => '__TS__'
    });

    await service.incrementApiCount(null, 'foxess');

    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(globalSet).toHaveBeenCalledTimes(1);
  });

  test('incrementGlobalApiCount falls back when FieldValue.increment is unavailable', async () => {
    const { db, globalSet } = createMetricsHarness();
    const service = createApiMetricsService({
      admin: { firestore: { FieldValue: {} } },
      db,
      defaultTimezone: 'Australia/Sydney',
      serverTimestamp: () => '__TS__'
    });

    await service.incrementGlobalApiCount('amber');

    expect(globalSet).toHaveBeenCalledTimes(1);
    expect(globalSet.mock.calls[0][0].amber).toBe(1);
  });
});
