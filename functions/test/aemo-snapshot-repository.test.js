'use strict';

const {
  AEMO_SNAPSHOT_COLLECTION,
  createAemoSnapshotRepository
} = require('../lib/repositories/aemo-snapshot-repository');

describe('aemo snapshot repository', () => {
  test('getCurrentSnapshot returns empty payload when snapshot is missing', async () => {
    const docRef = {
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn((name) => {
        expect(name).toBe(AEMO_SNAPSHOT_COLLECTION);
        return {
          doc: jest.fn(() => docRef)
        };
      })
    };
    const repository = createAemoSnapshotRepository({ db });

    const snapshot = await repository.getCurrentSnapshot('nsw1');

    expect(snapshot).toEqual({
      regionId: 'NSW1',
      data: [],
      metadata: {
        asOf: null,
        forecastHorizonMinutes: 0,
        isForecastComplete: false,
        source: 'aemo'
      }
    });
  });

  test('saveCurrentSnapshot persists normalized region snapshot payload', async () => {
    const docRef = {
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => docRef)
      }))
    };
    const repository = createAemoSnapshotRepository({
      db,
      serverTimestamp: jest.fn(() => 'server-ts')
    });

    const result = await repository.saveCurrentSnapshot({
      regionId: 'vic1',
      data: [{ type: 'CurrentInterval', channelType: 'general', perKwh: 71.2 }],
      metadata: {
        asOf: '2026-03-26T00:05:00.000Z',
        forecastHorizonMinutes: 60,
        isForecastComplete: true,
        source: 'aemo'
      }
    }, {
      cadenceMinutes: 5,
      lagMinutes: 1,
      storedAtIso: '2026-03-26T00:06:00.000Z'
    });

    expect(docRef.set).toHaveBeenCalledWith({
      regionId: 'VIC1',
      data: [{ type: 'CurrentInterval', channelType: 'general', perKwh: 71.2 }],
      metadata: {
        asOf: '2026-03-26T00:05:00.000Z',
        forecastHorizonMinutes: 60,
        isForecastComplete: true,
        source: 'aemo'
      },
      storedAt: 'server-ts',
      storedAtIso: '2026-03-26T00:06:00.000Z',
      schedule: {
        cadenceMinutes: 5,
        lagMinutes: 1,
        source: 'scheduler'
      }
    }, { merge: true });

    expect(result).toEqual({
      regionId: 'VIC1',
      data: [{ type: 'CurrentInterval', channelType: 'general', perKwh: 71.2 }],
      metadata: {
        asOf: '2026-03-26T00:05:00.000Z',
        forecastHorizonMinutes: 60,
        isForecastComplete: true,
        source: 'aemo'
      }
    });
  });
});
