'use strict';

const { buildSchedulerSoakSummary } = require('../lib/services/scheduler-soak-summary');

describe('scheduler soak summary', () => {
  test('returns insufficient-data status when no daily metrics are available', () => {
    const summary = buildSchedulerSoakSummary({
      dailyDesc: [],
      daysRequested: 14
    });

    expect(summary).toEqual(expect.objectContaining({
      daysRequested: 14,
      daysWithData: 0,
      status: 'insufficient_data',
      healthyDays: 0,
      watchDays: 0,
      breachDays: 0,
      healthyDayRatioPct: 0,
      nonHealthyDayRatioPct: 0,
      latestDayKey: null,
      latestStatus: 'unknown',
      consecutiveHealthyDays: 0,
      consecutiveNonHealthyDays: 0
    }));
    expect(summary.readiness.readyForCloseout).toBe(false);
  });

  test('captures mixed-status window math and closeout readiness blockers', () => {
    const summary = buildSchedulerSoakSummary({
      daysRequested: 5,
      minDaysRequired: 5,
      minHealthyRatioPct: 80,
      dailyDesc: [
        { dayKey: '2026-03-07', slo: { status: 'healthy' } },
        { dayKey: '2026-03-06', slo: { status: 'healthy' } },
        { dayKey: '2026-03-05', slo: { status: 'watch' } },
        { dayKey: '2026-03-04', slo: { status: 'healthy' } },
        { dayKey: '2026-03-03', slo: { status: 'breach' } }
      ]
    });

    expect(summary).toEqual(expect.objectContaining({
      daysRequested: 5,
      daysWithData: 5,
      healthyDays: 3,
      watchDays: 1,
      breachDays: 1,
      status: 'breach',
      latestDayKey: '2026-03-07',
      latestStatus: 'healthy',
      consecutiveHealthyDays: 2,
      consecutiveNonHealthyDays: 0,
      healthyDayRatioPct: 60,
      nonHealthyDayRatioPct: 40
    }));
    expect(summary.readiness).toEqual(expect.objectContaining({
      hasMinimumDays: true,
      hasNoBreachDays: false,
      latestStatusIsHealthy: true,
      healthyRatioSatisfactory: false,
      readyForCloseout: false
    }));
  });

  test('marks healthy sustained windows as closeout-ready', () => {
    const dailyDesc = Array.from({ length: 7 }, (_unused, index) => ({
      dayKey: `2026-03-0${index + 1}`,
      slo: { status: 'healthy' }
    })).reverse();

    const summary = buildSchedulerSoakSummary({
      dailyDesc,
      daysRequested: 7
    });

    expect(summary.status).toBe('healthy');
    expect(summary.healthyDays).toBe(7);
    expect(summary.watchDays).toBe(0);
    expect(summary.breachDays).toBe(0);
    expect(summary.healthyDayRatioPct).toBe(100);
    expect(summary.consecutiveHealthyDays).toBe(7);
    expect(summary.readiness.readyForCloseout).toBe(true);
  });
});
