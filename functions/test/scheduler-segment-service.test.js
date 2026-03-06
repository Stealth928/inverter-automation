'use strict';

const { clearSchedulerSegments } = require('../lib/services/scheduler-segment-service');

describe('scheduler segment service', () => {
  test('throws when foxessAPI is missing', async () => {
    await expect(clearSchedulerSegments({
      deviceSN: 'SN-1',
      userConfig: { deviceSn: 'SN-1' },
      userId: 'u-1'
    })).rejects.toThrow('clearSchedulerSegments requires foxessAPI.callFoxESSAPI()');
  });

  test('throws when deviceSN is missing', async () => {
    await expect(clearSchedulerSegments({
      foxessAPI: { callFoxESSAPI: jest.fn() },
      userConfig: {},
      userId: 'u-2'
    })).rejects.toThrow('clearSchedulerSegments requires deviceSN');
  });

  test('calls scheduler enable endpoint with default cleared groups', async () => {
    const callFoxESSAPI = jest.fn(async () => ({ errno: 0, result: {} }));

    await clearSchedulerSegments({
      foxessAPI: { callFoxESSAPI },
      userConfig: { deviceSn: 'SN-DEFAULT' },
      userId: 'u-3'
    });

    expect(callFoxESSAPI).toHaveBeenCalledWith(
      '/op/v1/device/scheduler/enable',
      'POST',
      expect.objectContaining({
        deviceSN: 'SN-DEFAULT',
        groups: expect.any(Array)
      }),
      { deviceSn: 'SN-DEFAULT' },
      'u-3'
    );

    const payload = callFoxESSAPI.mock.calls[0][2];
    expect(payload.groups).toHaveLength(8);
    expect(payload.groups.every((group) => group.enable === 0)).toBe(true);
  });

  test('uses explicit deviceSN and custom group count when provided', async () => {
    const callFoxESSAPI = jest.fn(async () => ({ errno: 0, result: {} }));

    await clearSchedulerSegments({
      deviceSN: 'SN-OVERRIDE',
      foxessAPI: { callFoxESSAPI },
      groupCount: 3,
      userConfig: { deviceSn: 'SN-BASE' },
      userId: 'u-4'
    });

    const payload = callFoxESSAPI.mock.calls[0][2];
    expect(payload.deviceSN).toBe('SN-OVERRIDE');
    expect(payload.groups).toHaveLength(3);
  });
});
