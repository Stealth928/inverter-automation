'use strict';

const {
  GERMANY_MARKET_SNAPSHOT_COLLECTION,
  createGermanyMarketSnapshotRepository
} = require('../lib/repositories/germany-market-snapshot-repository');

describe('germany market snapshot repository', () => {
  test('getCurrentSnapshot returns empty payload when snapshot is missing', async () => {
    const docRef = {
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn((name) => {
        expect(name).toBe(GERMANY_MARKET_SNAPSHOT_COLLECTION);
        return {
          doc: jest.fn(() => docRef)
        };
      })
    };
    const repository = createGermanyMarketSnapshotRepository({ db });

    const snapshot = await repository.getCurrentSnapshot('de');

    expect(snapshot).toEqual({
      marketId: 'DE',
      data: [],
      metadata: {
        asOf: null,
        forecastHorizonMinutes: 0,
        isForecastComplete: false,
        source: 'entsoe'
      }
    });
  });

  test('saveCurrentSnapshot persists normalized market snapshot payload', async () => {
    const docRef = {
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      set: jest.fn(async () => undefined)
    };
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => docRef)
      }))
    };
    const repository = createGermanyMarketSnapshotRepository({
      db,
      serverTimestamp: jest.fn(() => 'server-ts')
    });

    const result = await repository.saveCurrentSnapshot({
      marketId: 'de',
      data: [{ type: 'CurrentInterval', channelType: 'general', perKwh: 13.4 }],
      metadata: {
        asOf: '2026-04-01T10:00:00.000Z',
        forecastHorizonMinutes: 180,
        isForecastComplete: true,
        source: 'entsoe'
      }
    }, {
      cadenceMinutes: 15,
      lagMinutes: 5,
      storedAtIso: '2026-04-01T10:02:00.000Z'
    });

    expect(docRef.set).toHaveBeenCalledWith({
      marketId: 'DE',
      data: [{ type: 'CurrentInterval', channelType: 'general', perKwh: 13.4 }],
      metadata: {
        asOf: '2026-04-01T10:00:00.000Z',
        forecastHorizonMinutes: 180,
        isForecastComplete: true,
        source: 'entsoe'
      },
      storedAt: 'server-ts',
      storedAtIso: '2026-04-01T10:02:00.000Z',
      schedule: {
        cadenceMinutes: 15,
        lagMinutes: 5,
        source: 'scheduler'
      }
    }, { merge: true });

    expect(result).toEqual({
      marketId: 'DE',
      data: [{ type: 'CurrentInterval', channelType: 'general', perKwh: 13.4 }],
      metadata: {
        asOf: '2026-04-01T10:00:00.000Z',
        forecastHorizonMinutes: 180,
        isForecastComplete: true,
        source: 'entsoe'
      }
    });
  });
});