'use strict';

const { createQuickControlService } = require('../lib/services/quick-control-service');

function buildDeps(overrides = {}) {
  return {
    addHistoryEntry: jest.fn(async () => undefined),
    foxessAPI: {
      callFoxESSAPI: jest.fn(async () => ({ errno: 0 }))
    },
    getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-1' })),
    logger: {
      debug: jest.fn(),
      info: jest.fn()
    },
    saveQuickControlState: jest.fn(async () => true),
    serverTimestamp: jest.fn(() => '__TS__'),
    ...overrides
  };
}

describe('quick-control service', () => {
  test('throws when required dependencies are missing', () => {
    expect(() => createQuickControlService({}))
      .toThrow('createQuickControlService requires addHistoryEntry()');

    expect(() => createQuickControlService({
      addHistoryEntry: async () => undefined
    })).toThrow('createQuickControlService requires foxessAPI.callFoxESSAPI()');
  });

  test('cleanupExpiredQuickControl returns false when state is not expired', async () => {
    const deps = buildDeps();
    const service = createQuickControlService(deps);

    const result = await service.cleanupExpiredQuickControl('u-quick', {
      active: true,
      expiresAt: Date.now() + 30000
    });

    expect(result).toBe(false);
    expect(deps.foxessAPI.callFoxESSAPI).not.toHaveBeenCalled();
    expect(deps.saveQuickControlState).not.toHaveBeenCalled();
    expect(deps.addHistoryEntry).not.toHaveBeenCalled();
  });

  test('cleanupExpiredQuickControl clears scheduler, disables flag, clears state, and logs history', async () => {
    const deps = buildDeps();
    const service = createQuickControlService(deps);
    const quickState = {
      active: true,
      type: 'charge',
      power: 4000,
      durationMinutes: 20,
      expiresAt: Date.now() - 1000
    };

    const result = await service.cleanupExpiredQuickControl('u-clean', quickState);

    expect(result).toBe(true);
    expect(deps.getUserConfig).toHaveBeenCalledWith('u-clean');
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenNthCalledWith(
      1,
      '/op/v1/device/scheduler/enable',
      'POST',
      expect.objectContaining({
        deviceSN: 'SN-1',
        groups: expect.any(Array)
      }),
      expect.objectContaining({ deviceSn: 'SN-1' }),
      'u-clean'
    );
    expect(deps.foxessAPI.callFoxESSAPI).toHaveBeenNthCalledWith(
      2,
      '/op/v1/device/scheduler/set/flag',
      'POST',
      { deviceSN: 'SN-1', enable: 0 },
      expect.objectContaining({ deviceSn: 'SN-1' }),
      'u-clean'
    );
    const groups = deps.foxessAPI.callFoxESSAPI.mock.calls[0][2].groups;
    expect(groups).toHaveLength(8);
    expect(groups[0]).toEqual(expect.objectContaining({
      enable: 0,
      workMode: 'SelfUse'
    }));

    expect(deps.saveQuickControlState).toHaveBeenCalledWith('u-clean', null);
    expect(deps.addHistoryEntry).toHaveBeenCalledWith('u-clean', expect.objectContaining({
      type: 'quickcontrol_auto_cleanup',
      controlType: 'charge',
      power: 4000,
      durationMinutes: 20,
      timestamp: '__TS__'
    }));
  });

  test('cleanupExpiredQuickControl still clears state and logs history when scheduler API throws', async () => {
    const deps = buildDeps({
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => {
          throw new Error('network failed');
        })
      }
    });
    const service = createQuickControlService(deps);

    const result = await service.cleanupExpiredQuickControl('u-err', {
      active: true,
      type: 'discharge',
      power: 2500,
      durationMinutes: 15,
      expiresAt: Date.now() - 5000
    });

    expect(result).toBe(true);
    expect(deps.saveQuickControlState).toHaveBeenCalledWith('u-err', null);
    expect(deps.addHistoryEntry).toHaveBeenCalledWith('u-err', expect.objectContaining({
      type: 'quickcontrol_auto_cleanup',
      controlType: 'discharge'
    }));
  });
});
