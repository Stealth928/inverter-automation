'use strict';

const { runAutomationSchedulerCycle } = require('../lib/services/automation-scheduler-service');

function buildUsersSnapshot(ids) {
  return {
    size: ids.length,
    docs: ids.map((id) => ({ id }))
  };
}

function buildDbMock(ids) {
  const usersSnapshot = buildUsersSnapshot(ids);
  const usersCollection = {
    where: jest.fn(() => ({
      get: jest.fn(async () => usersSnapshot)
    })),
    get: jest.fn(async () => usersSnapshot)
  };

  return {
    collection: jest.fn((name) => {
      if (name === 'users') {
        return usersCollection;
      }
      throw new Error(`Unexpected collection access in test: ${name}`);
    })
  };
}

function buildSchedulerDeps(overrides = {}) {
  const userIds = overrides.userIds || ['u-1'];
  const logger = overrides.logger || {
    error: jest.fn(),
    log: jest.fn(),
    warn: jest.fn()
  };
  const db = overrides.db || buildDbMock(userIds);
  const sleep = overrides.sleep || jest.fn(async () => undefined);

  const deps = {
    automationCycleHandler: overrides.automationCycleHandler || jest.fn(async (_req, res) => {
      res.json({
        errno: 0,
        result: { skipped: true, reason: 'No rules configured' }
      });
    }),
    acquireUserCycleLock: overrides.acquireUserCycleLock || jest.fn(async () => ({ acquired: true, lockId: 'lock-1' })),
    db,
    emitSchedulerMetrics: overrides.emitSchedulerMetrics,
    getConfig: overrides.getConfig || jest.fn(() => ({ automation: { intervalMs: 60000 } })),
    getTimeInTimezone: overrides.getTimeInTimezone || jest.fn(() => new Date('2026-03-06T12:00:00Z')),
    getUserAutomationState:
      overrides.getUserAutomationState || jest.fn(async () => ({ enabled: true, lastCheck: 0 })),
    getUserConfig:
      overrides.getUserConfig ||
      jest.fn(async (userId) => ({ deviceSn: `SN-${userId}`, timezone: 'UTC', automation: { intervalMs: 1000 } })),
    getUserRules: overrides.getUserRules || jest.fn(async () => ({})),
    isTimeInRange: overrides.isTimeInRange || jest.fn(() => false),
    logger,
    markCycleOutcome: overrides.markCycleOutcome || jest.fn(async () => undefined),
    recordDeadLetter: overrides.recordDeadLetter || jest.fn(async () => undefined),
    releaseUserCycleLock: overrides.releaseUserCycleLock || jest.fn(async () => undefined),
    schedulerOptions: overrides.schedulerOptions || {
      maxConcurrentUsers: 10,
      retryAttempts: 2,
      retryBaseDelayMs: 1,
      retryJitterMs: 0
    },
    shouldRunCycleKey: overrides.shouldRunCycleKey || jest.fn(async () => true),
    sleep
  };

  return {
    db,
    deps,
    logger,
    sleep
  };
}

describe('automation scheduler service', () => {
  test('throws when required deps are missing', async () => {
    await expect(runAutomationSchedulerCycle({}, {})).rejects.toThrow('db.collection');
  });

  test('runs cycle handler for eligible users and records successful outcome', async () => {
    const automationCycleHandler = jest.fn(async (req, res) => {
      res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    });
    const markCycleOutcome = jest.fn(async () => undefined);
    const { deps } = buildSchedulerDeps({
      automationCycleHandler,
      markCycleOutcome,
      userIds: ['u-1']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(automationCycleHandler).toHaveBeenCalledTimes(1);
    expect(automationCycleHandler.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        user: { uid: 'u-1' }
      })
    );
    expect(markCycleOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          attempts: 1,
          success: true
        }),
        userId: 'u-1'
      })
    );
  });

  test('emits scheduler metrics with failure type and timing summary', async () => {
    const emitSchedulerMetrics = jest.fn(async () => undefined);
    const automationCycleHandler = jest.fn(async (req, res) => {
      if (req.user.uid === 'u-1') {
        res.json({ errno: 429, error: 'Too many requests' });
        return;
      }
      res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    });
    const { deps } = buildSchedulerDeps({
      automationCycleHandler,
      emitSchedulerMetrics,
      schedulerOptions: {
        maxConcurrentUsers: 1,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        retryJitterMs: 0
      },
      userIds: ['u-1', 'u-2']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(emitSchedulerMetrics).toHaveBeenCalledTimes(1);
    const metrics = emitSchedulerMetrics.mock.calls[0][0];
    expect(metrics).toEqual(expect.objectContaining({
      totalEnabledUsers: 2,
      cycleCandidates: 2,
      cyclesRun: 2,
      deadLetters: 1,
      errors: 1
    }));
    expect(metrics.failureByType).toEqual(expect.objectContaining({
      api_rate_limit: 1
    }));
    expect(metrics.queueLagMs).toEqual(expect.objectContaining({
      count: 2
    }));
    expect(metrics.cycleDurationMs).toEqual(expect.objectContaining({
      count: 2
    }));
  });

  test('limits user cycle execution with bounded concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const automationCycleHandler = jest.fn(async (_req, res) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    });

    const { deps } = buildSchedulerDeps({
      automationCycleHandler,
      schedulerOptions: {
        maxConcurrentUsers: 2,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        retryJitterMs: 0
      },
      userIds: ['u-1', 'u-2', 'u-3', 'u-4']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(automationCycleHandler).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test('retries transient failures and succeeds before dead-letter', async () => {
    let attempt = 0;
    const automationCycleHandler = jest.fn(async (_req, res) => {
      attempt += 1;
      if (attempt === 1) {
        res.json({ errno: 503, error: 'temporary upstream timeout' });
        return;
      }
      res.json({ errno: 0, result: { skipped: true, reason: 'Recovered' } });
    });
    const sleep = jest.fn(async () => undefined);
    const markCycleOutcome = jest.fn(async () => undefined);
    const recordDeadLetter = jest.fn(async () => undefined);
    const { deps } = buildSchedulerDeps({
      automationCycleHandler,
      markCycleOutcome,
      recordDeadLetter,
      schedulerOptions: {
        maxConcurrentUsers: 1,
        retryAttempts: 2,
        retryBaseDelayMs: 25,
        retryJitterMs: 0
      },
      sleep,
      userIds: ['u-1']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(automationCycleHandler).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(markCycleOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          attempts: 2,
          success: true
        }),
        userId: 'u-1'
      })
    );
    expect(recordDeadLetter).not.toHaveBeenCalled();
  });

  test('records dead-letter after retry exhaustion', async () => {
    const automationCycleHandler = jest.fn(async (_req, res) => {
      res.json({ errno: 503, error: 'temporary upstream timeout' });
    });
    const markCycleOutcome = jest.fn(async () => undefined);
    const recordDeadLetter = jest.fn(async () => undefined);
    const { deps, logger } = buildSchedulerDeps({
      automationCycleHandler,
      markCycleOutcome,
      recordDeadLetter,
      schedulerOptions: {
        maxConcurrentUsers: 1,
        retryAttempts: 2,
        retryBaseDelayMs: 0,
        retryJitterMs: 0
      },
      userIds: ['u-1']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(automationCycleHandler).toHaveBeenCalledTimes(2);
    expect(markCycleOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          attempts: 2,
          success: false
        }),
        userId: 'u-1'
      })
    );
    expect(recordDeadLetter).toHaveBeenCalledTimes(1);
    expect(
      logger.log.mock.calls.some((call) => String(call[0]).includes('1 dead-letter'))
    ).toBe(true);
  });

  test('skips users when lock is active or idempotency marker exists', async () => {
    const automationCycleHandler = jest.fn(async (_req, res) => {
      res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    });

    const acquireUserCycleLock = jest.fn(async ({ userId }) => {
      if (userId === 'u-2') {
        return { acquired: false, lockId: null };
      }
      return { acquired: true, lockId: `lock-${userId}` };
    });

    const shouldRunCycleKey = jest.fn(async ({ userId }) => userId !== 'u-3');
    const { deps, logger } = buildSchedulerDeps({
      acquireUserCycleLock,
      automationCycleHandler,
      shouldRunCycleKey,
      userIds: ['u-1', 'u-2', 'u-3']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(automationCycleHandler).toHaveBeenCalledTimes(1);
    expect(
      logger.log.mock.calls.some((call) => String(call[0]).includes('1 locked'))
    ).toBe(true);
    expect(
      logger.log.mock.calls.some((call) => String(call[0]).includes('1 idempotent'))
    ).toBe(true);
  });

  test('warns and continues when metric emission fails', async () => {
    const emitSchedulerMetrics = jest.fn(async () => {
      throw new Error('metrics sink unavailable');
    });
    const { deps, logger } = buildSchedulerDeps({
      emitSchedulerMetrics,
      userIds: ['u-1']
    });

    await runAutomationSchedulerCycle({}, deps);

    expect(emitSchedulerMetrics).toHaveBeenCalledTimes(1);
    expect(
      logger.warn.mock.calls.some((call) => String(call[0]).includes('Failed to emit scheduler metrics'))
    ).toBe(true);
  });

  test('overlapping scheduler invocations serialize by lock and avoid duplicate cycle execution', async () => {
    const lockAttempts = new Map();
    const schedulerMetrics = [];
    const emitSchedulerMetrics = jest.fn(async (metrics) => {
      schedulerMetrics.push(metrics);
    });
    const automationCycleHandler = jest.fn(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    });
    const acquireUserCycleLock = jest.fn(async ({ userId }) => {
      const attemptCount = lockAttempts.get(userId) || 0;
      lockAttempts.set(userId, attemptCount + 1);
      if (attemptCount === 0) {
        return { acquired: true, lockId: `lock-${userId}` };
      }
      return { acquired: false, lockId: null };
    });
    const releaseUserCycleLock = jest.fn(async () => undefined);
    const shouldRunCycleKey = jest.fn(async () => true);

    const sharedOverrides = {
      acquireUserCycleLock,
      automationCycleHandler,
      emitSchedulerMetrics,
      releaseUserCycleLock,
      schedulerOptions: {
        maxConcurrentUsers: 1,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
        retryJitterMs: 0
      },
      shouldRunCycleKey,
      userIds: ['u-1']
    };
    const { deps: depsA } = buildSchedulerDeps(sharedOverrides);
    const { deps: depsB } = buildSchedulerDeps(sharedOverrides);

    await Promise.all([
      runAutomationSchedulerCycle({}, depsA),
      runAutomationSchedulerCycle({}, depsB)
    ]);

    expect(automationCycleHandler).toHaveBeenCalledTimes(1);
    expect(acquireUserCycleLock).toHaveBeenCalledTimes(2);
    expect(shouldRunCycleKey).toHaveBeenCalledTimes(1);
    expect(emitSchedulerMetrics).toHaveBeenCalledTimes(2);

    const totalCyclesRun = schedulerMetrics.reduce(
      (sum, entry) => sum + Number(entry && entry.cyclesRun ? entry.cyclesRun : 0),
      0
    );
    const totalLockedSkips = schedulerMetrics.reduce(
      (sum, entry) => sum + Number(entry && entry.skipped && entry.skipped.locked ? entry.skipped.locked : 0),
      0
    );
    expect(totalCyclesRun).toBe(1);
    expect(totalLockedSkips).toBe(1);
  });

  test('overlapping scheduler invocations suppress duplicate cycle via idempotency key', async () => {
    const seenCycleKeys = new Set();
    const schedulerMetrics = [];
    const emitSchedulerMetrics = jest.fn(async (metrics) => {
      schedulerMetrics.push(metrics);
    });
    const automationCycleHandler = jest.fn(async (_req, res) => {
      res.json({ errno: 0, result: { skipped: true, reason: 'No rules configured' } });
    });
    const acquireUserCycleLock = jest.fn(async ({ userId }) => ({
      acquired: true,
      lockId: `lock-${userId}-${Math.random().toString(36).slice(2, 7)}`
    }));
    const shouldRunCycleKey = jest.fn(async ({ userId, cycleKey }) => {
      const key = `${userId}:${cycleKey}`;
      if (seenCycleKeys.has(key)) {
        return false;
      }
      seenCycleKeys.add(key);
      return true;
    });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1710000000000);

    try {
      const sharedOverrides = {
        acquireUserCycleLock,
        automationCycleHandler,
        emitSchedulerMetrics,
        schedulerOptions: {
          maxConcurrentUsers: 1,
          retryAttempts: 1,
          retryBaseDelayMs: 0,
          retryJitterMs: 0
        },
        shouldRunCycleKey,
        userIds: ['u-1']
      };
      const { deps: depsA } = buildSchedulerDeps(sharedOverrides);
      const { deps: depsB } = buildSchedulerDeps(sharedOverrides);

      await Promise.all([
        runAutomationSchedulerCycle({}, depsA),
        runAutomationSchedulerCycle({}, depsB)
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    expect(automationCycleHandler).toHaveBeenCalledTimes(1);
    expect(shouldRunCycleKey).toHaveBeenCalledTimes(2);
    expect(emitSchedulerMetrics).toHaveBeenCalledTimes(2);

    const totalCyclesRun = schedulerMetrics.reduce(
      (sum, entry) => sum + Number(entry && entry.cyclesRun ? entry.cyclesRun : 0),
      0
    );
    const totalIdempotentSkips = schedulerMetrics.reduce(
      (sum, entry) => sum + Number(entry && entry.skipped && entry.skipped.idempotent ? entry.skipped.idempotent : 0),
      0
    );
    expect(totalCyclesRun).toBe(1);
    expect(totalIdempotentSkips).toBe(1);
  });
});
