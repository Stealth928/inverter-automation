'use strict';

const { createApiMetricsService } = require('../lib/services/api-metrics-service');

function createMetricsHarness() {
  const userSet = jest.fn(async () => undefined);
  const userMetricsDocRef = { path: 'users/user-1/metrics/doc', set: userSet };
  const globalSet = jest.fn(async () => undefined);

  const globalMetricsDocRef = {
    path: 'metrics/day',
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

  const batch = {
    set: jest.fn(),
    commit: jest.fn(async () => undefined)
  };
  db.batch = jest.fn(() => batch);

  return {
    db,
    globalSet,
    userSet,
    metricsCollectionRef,
    globalMetricsDocRef,
    userMetricsDocRef,
    batch,
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

    expect(key).toBe('2026-03-06');
    expect(ausKey).toBe('2026-03-06');
  });

  test('incrementApiCount updates user and global metrics', async () => {
    const { db, globalSet, userSet, batch, userMetricsDocRef, globalMetricsDocRef } = createMetricsHarness();
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

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(userSet).toHaveBeenCalledTimes(0);
    expect(globalSet).toHaveBeenCalledTimes(0);
    expect(logger.debug).toHaveBeenCalled();

    expect(batch.set).toHaveBeenCalledTimes(2);
    expect(batch.commit).toHaveBeenCalledTimes(1);

    const [userRef, userData, setOptions] = batch.set.mock.calls[0];
    expect(userRef).toBe(userMetricsDocRef);
    expect(userData.weather).toEqual({ op: 'increment', value: 1 });
    expect(userData.updatedAt).toBe('__TS__');
    expect(setOptions).toEqual({ merge: true });

    const [globalRef, globalPayload, globalOptions] = batch.set.mock.calls[1];
    expect(globalRef).toBe(globalMetricsDocRef);
    expect(globalPayload.weather).toEqual({ op: 'increment', value: 1 });
    expect(globalPayload.updatedAt).toBe('__TS__');
    expect(globalOptions).toEqual({ merge: true });
  });

  test('incrementApiCount without userId still updates global metrics', async () => {
    const { db, globalSet, batch } = createMetricsHarness();
    const service = createApiMetricsService({
      admin: { firestore: { FieldValue: { increment: jest.fn((value) => value) } } },
      db,
      defaultTimezone: 'Australia/Sydney',
      serverTimestamp: () => '__TS__'
    });

    await service.incrementApiCount(null, 'foxess');

    expect(db.batch).not.toHaveBeenCalled();
    expect(batch.commit).not.toHaveBeenCalled();
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
