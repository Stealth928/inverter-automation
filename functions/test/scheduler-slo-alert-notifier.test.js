'use strict';

const { createSchedulerSloAlertNotifier } = require('../lib/services/scheduler-slo-alert-notifier');

describe('scheduler slo alert notifier', () => {
  test('skips healthy alerts', async () => {
    const notifier = createSchedulerSloAlertNotifier({
      webhookUrl: 'https://example.test/hook',
      fetchImpl: jest.fn()
    });

    const result = await notifier.notifySchedulerSloAlert({
      status: 'healthy',
      schedulerId: 'sched-1'
    });

    expect(result).toEqual(expect.objectContaining({
      delivered: false,
      reason: 'healthy_status'
    }));
  });

  test('returns non-delivered when webhook URL is not configured', async () => {
    const logger = { warn: jest.fn(), log: jest.fn() };
    const notifier = createSchedulerSloAlertNotifier({
      logger,
      webhookUrl: '',
      fetchImpl: jest.fn()
    });

    const result = await notifier.notifySchedulerSloAlert({
      status: 'breach',
      schedulerId: 'sched-1',
      breachedMetrics: ['errorRatePct']
    });

    expect(result).toEqual(expect.objectContaining({
      delivered: false,
      reason: 'no_webhook_url'
    }));
    expect(logger.warn).toHaveBeenCalled();
  });

  test('posts webhook payload for watch or breach status', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
    const notifier = createSchedulerSloAlertNotifier({
      webhookUrl: 'https://example.test/hook',
      fetchImpl
    });

    const result = await notifier.notifySchedulerSloAlert({
      status: 'breach',
      schedulerId: 'sched-2',
      breachedMetrics: ['errorRatePct', 'deadLetterRatePct'],
      measurements: {
        errorRatePct: 2.3,
        deadLetterRatePct: 0.4,
        maxQueueLagMs: 5000,
        maxCycleDurationMs: 2500
      }
    });

    expect(result).toEqual({ delivered: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.test/hook');
    expect(options).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }));
    const body = JSON.parse(options.body);
    expect(body).toEqual(expect.objectContaining({
      text: expect.stringContaining('[SchedulerSLO] BREACH'),
      schedulerSloAlert: expect.objectContaining({
        status: 'breach',
        schedulerId: 'sched-2'
      })
    }));
  });

  test('suppresses duplicate notifications during cooldown window', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }));
    const notifier = createSchedulerSloAlertNotifier({
      cooldownMs: 300000,
      webhookUrl: 'https://example.test/hook',
      fetchImpl
    });
    const alert = {
      status: 'watch',
      schedulerId: 'sched-3',
      watchMetrics: ['maxQueueLagMs'],
      measurements: {
        maxQueueLagMs: 150000
      }
    };

    const firstResult = await notifier.notifySchedulerSloAlert(alert);
    const secondResult = await notifier.notifySchedulerSloAlert(alert);

    expect(firstResult).toEqual({ delivered: true });
    expect(secondResult).toEqual(expect.objectContaining({
      delivered: false,
      reason: 'cooldown_active'
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
