'use strict';

const { createCurtailmentService } = require('../lib/services/curtailment-service');

function createDbMock(initialState) {
  let state = initialState === undefined ? null : initialState;

  const stateDocRef = {
    get: jest.fn(async () => ({
      exists: !!state,
      data: () => state
    })),
    set: jest.fn(async (payload) => {
      state = { ...payload };
    })
  };

  const curtailmentCollectionRef = {
    doc: jest.fn((docId) => {
      if (docId !== 'state') throw new Error(`Unexpected doc id: ${docId}`);
      return stateDocRef;
    })
  };

  const userDocRef = {
    collection: jest.fn((collectionName) => {
      if (collectionName !== 'curtailment') throw new Error(`Unexpected subcollection: ${collectionName}`);
      return curtailmentCollectionRef;
    })
  };

  const usersCollectionRef = {
    doc: jest.fn(() => userDocRef)
  };

  return {
    db: {
      collection: jest.fn((name) => {
        if (name !== 'users') throw new Error(`Unexpected collection: ${name}`);
        return usersCollectionRef;
      })
    },
    getState: () => state,
    stateDocRef
  };
}

function createServiceFixture(options = {}) {
  const { initialState, getCurrentAmberPrices = () => ({ feedInPrice: null }), now = () => 1700000000000 } = options;
  const { db, getState, stateDocRef } = createDbMock(initialState);
  const foxessAPI = {
    callFoxESSAPI: jest.fn(async () => ({ errno: 0 }))
  };

  const service = createCurtailmentService({
    db,
    foxessAPI,
    getCurrentAmberPrices,
    now
  });

  return {
    foxessAPI,
    getState,
    service,
    stateDocRef
  };
}

describe('curtailment service', () => {
  test('throws when required dependencies are missing', () => {
    expect(() => createCurtailmentService({}))
      .toThrow('createCurtailmentService requires Firestore db');

    expect(() => createCurtailmentService({
      db: { collection: () => ({}) },
      getCurrentAmberPrices: () => ({ feedInPrice: null })
    })).toThrow('createCurtailmentService requires foxessAPI.callFoxESSAPI()');
  });

  test('restores export limit when curtailment is disabled but prior state is active', async () => {
    const fixture = createServiceFixture({
      initialState: { active: true },
      now: () => 123456
    });

    const result = await fixture.service.checkAndApplyCurtailment('u-curtail', {
      deviceSn: 'SN-1',
      curtailment: { enabled: false, priceThreshold: 0 }
    }, []);

    expect(result).toEqual({
      enabled: false,
      triggered: false,
      priceThreshold: null,
      currentPrice: null,
      action: 'deactivated_by_disable',
      error: null,
      stateChanged: true
    });
    expect(fixture.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/set',
      'POST',
      {
        sn: 'SN-1',
        key: 'ExportLimit',
        value: 12000
      },
      expect.objectContaining({ deviceSn: 'SN-1' }),
      'u-curtail'
    );
    expect(fixture.getState()).toEqual({
      active: false,
      lastPrice: null,
      lastDeactivated: 123456,
      disabledByUser: true
    });
  });

  test('returns no-data error when curtailment is enabled without amber data', async () => {
    const fixture = createServiceFixture({
      initialState: { active: false }
    });

    const result = await fixture.service.checkAndApplyCurtailment('u-curtail', {
      deviceSn: 'SN-2',
      curtailment: { enabled: true, priceThreshold: 0 }
    }, []);

    expect(result.error).toBe('No Amber price data available');
    expect(fixture.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(fixture.stateDocRef.set).not.toHaveBeenCalled();
  });

  test('activates curtailment when price is below threshold and state is inactive', async () => {
    const fixture = createServiceFixture({
      initialState: { active: false, lastPrice: null },
      getCurrentAmberPrices: () => ({ feedInPrice: -12.5 }),
      now: () => 777
    });

    const result = await fixture.service.checkAndApplyCurtailment('u-curtail', {
      deviceSn: 'SN-3',
      curtailment: { enabled: true, priceThreshold: -10 }
    }, [{ channelType: 'feedIn' }]);

    expect(result).toEqual({
      enabled: true,
      triggered: true,
      priceThreshold: -10,
      currentPrice: -12.5,
      action: 'activated',
      error: null,
      stateChanged: true
    });
    expect(fixture.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/set',
      'POST',
      {
        sn: 'SN-3',
        key: 'ExportLimit',
        value: 0
      },
      expect.objectContaining({ deviceSn: 'SN-3' }),
      'u-curtail'
    );
    expect(fixture.getState()).toEqual({
      active: true,
      lastPrice: -12.5,
      lastActivated: 777,
      threshold: -10
    });
  });

  test('deactivates curtailment when price is above threshold and state is active', async () => {
    const fixture = createServiceFixture({
      initialState: { active: true, lastPrice: -20 },
      getCurrentAmberPrices: () => ({ feedInPrice: 5.2 }),
      now: () => 999
    });

    const result = await fixture.service.checkAndApplyCurtailment('u-curtail', {
      deviceSn: 'SN-4',
      curtailment: { enabled: true, priceThreshold: 0 }
    }, [{ channelType: 'feedIn' }]);

    expect(result).toEqual({
      enabled: true,
      triggered: false,
      priceThreshold: 0,
      currentPrice: 5.2,
      action: 'deactivated',
      error: null,
      stateChanged: true
    });
    expect(fixture.foxessAPI.callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v0/device/setting/set',
      'POST',
      {
        sn: 'SN-4',
        key: 'ExportLimit',
        value: 12000
      },
      expect.objectContaining({ deviceSn: 'SN-4' }),
      'u-curtail'
    );
    expect(fixture.getState()).toEqual({
      active: false,
      lastPrice: 5.2,
      lastDeactivated: 999,
      threshold: 0
    });
  });
});
