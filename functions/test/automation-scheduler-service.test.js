'use strict';

const { runAutomationSchedulerCycle } = require('../lib/services/automation-scheduler-service');

function buildUsersSnapshot(ids) {
  return {
    size: ids.length,
    docs: ids.map((id) => ({ id }))
  };
}

describe('automation scheduler service', () => {
  test('throws when required deps are missing', async () => {
    await expect(runAutomationSchedulerCycle({}, {})).rejects.toThrow('db.collection');
  });

  test('runs cycle handler for eligible users', async () => {
    const usersSnapshot = buildUsersSnapshot(['u-1']);
    const usersCollection = {
      where: jest.fn(() => ({
        get: jest.fn(async () => usersSnapshot)
      })),
      get: jest.fn(async () => usersSnapshot)
    };

    const db = {
      collection: jest.fn(() => usersCollection)
    };

    const automationCycleHandler = jest.fn(async (req, res) => {
      res.json({
        errno: 0,
        result: { skipped: true, reason: 'No rules configured' }
      });
    });

    await runAutomationSchedulerCycle({}, {
      automationCycleHandler,
      db,
      getConfig: jest.fn(() => ({ automation: { intervalMs: 60000 } })),
      getTimeInTimezone: jest.fn(() => new Date('2026-03-06T12:00:00Z')),
      getUserAutomationState: jest.fn(async () => ({ enabled: true, lastCheck: 0 })),
      getUserConfig: jest.fn(async () => ({ deviceSn: 'SN-1', timezone: 'UTC', automation: { intervalMs: 1000 } })),
      getUserRules: jest.fn(async () => ({})),
      isTimeInRange: jest.fn(() => false),
      logger: { log: jest.fn(), error: jest.fn() }
    });

    expect(automationCycleHandler).toHaveBeenCalledTimes(1);
    expect(automationCycleHandler.mock.calls[0][0]).toEqual(expect.objectContaining({
      user: { uid: 'u-1' }
    }));
  });
});
