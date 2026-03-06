'use strict';

const {
  clearSchedulerSegments,
  clearSchedulerSegmentsOneShot,
  clearSchedulerSegmentsWithRetry
} = require('../lib/services/scheduler-segment-service');

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

  test('clearSchedulerSegmentsOneShot returns success with clear result', async () => {
    const callFoxESSAPI = jest.fn(async () => ({ errno: 0, result: { ok: true } }));

    const result = await clearSchedulerSegmentsOneShot({
      deviceSN: 'SN-ONESHOT',
      foxessAPI: { callFoxESSAPI },
      settleDelayMs: 0,
      userConfig: { deviceSn: 'SN-ONESHOT' },
      userId: 'u-oneshot-success'
    });

    expect(result).toEqual({
      clearResult: { errno: 0, result: { ok: true } },
      success: true
    });
    expect(callFoxESSAPI).toHaveBeenCalledTimes(1);
  });

  test('clearSchedulerSegmentsOneShot returns failure when errno is non-zero', async () => {
    const callFoxESSAPI = jest.fn(async () => ({ errno: 503, msg: 'temporary' }));

    const result = await clearSchedulerSegmentsOneShot({
      deviceSN: 'SN-ONESHOT-FAIL',
      foxessAPI: { callFoxESSAPI },
      settleDelayMs: 0,
      userConfig: { deviceSn: 'SN-ONESHOT-FAIL' },
      userId: 'u-oneshot-fail'
    });

    expect(result).toEqual({
      clearResult: { errno: 503, msg: 'temporary' },
      success: false
    });
    expect(callFoxESSAPI).toHaveBeenCalledTimes(1);
  });

  test('clearSchedulerSegmentsWithRetry retries on errno failures until success', async () => {
    const callFoxESSAPI = jest
      .fn()
      .mockResolvedValueOnce({ errno: 500, msg: 'temporary fail' })
      .mockResolvedValueOnce({ errno: 0, result: {} });
    const warn = jest.fn();

    const result = await clearSchedulerSegmentsWithRetry({
      deviceSN: 'SN-RETRY',
      foxessAPI: { callFoxESSAPI },
      logger: { warn },
      maxAttempts: 3,
      retryDelayMs: 0,
      settleDelayMs: 0,
      userConfig: { deviceSn: 'SN-RETRY' },
      userId: 'u-5'
    });

    expect(result).toEqual({
      attempts: 2,
      clearResult: { errno: 0, result: {} },
      success: true
    });
    expect(callFoxESSAPI).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('clearSchedulerSegmentsWithRetry returns failure after max attempts', async () => {
    const callFoxESSAPI = jest.fn(async () => ({ errno: 400, msg: 'nope' }));
    const warn = jest.fn();

    const result = await clearSchedulerSegmentsWithRetry({
      deviceSN: 'SN-FAIL',
      foxessAPI: { callFoxESSAPI },
      logger: { warn },
      maxAttempts: 3,
      retryDelayMs: 0,
      settleDelayMs: 0,
      userConfig: { deviceSn: 'SN-FAIL' },
      userId: 'u-6'
    });

    expect(result).toEqual({
      attempts: 3,
      clearResult: { errno: 400, msg: 'nope' },
      success: false
    });
    expect(callFoxESSAPI).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test('clearSchedulerSegmentsWithRetry propagates call errors', async () => {
    const callFoxESSAPI = jest.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      clearSchedulerSegmentsWithRetry({
        deviceSN: 'SN-THROW',
        foxessAPI: { callFoxESSAPI },
        retryDelayMs: 0,
        settleDelayMs: 0,
        userConfig: { deviceSn: 'SN-THROW' },
        userId: 'u-7'
      })
    ).rejects.toThrow('network down');
  });
});
