'use strict';

const { createAutomationSchedulerMetricsSink } = require('../lib/services/automation-scheduler-metrics-sink');

function mergeNestedObject(target, source) {
  const output = { ...(target && typeof target === 'object' ? target : {}) };
  for (const [key, value] of Object.entries(source || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeNestedObject(output[key], value);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function createInMemoryDb() {
  const store = new Map();

  function createCollectionRef(path) {
    return {
      doc: (docId) => createDocRef(`${path}/${docId}`)
    };
  }

  function createDocRef(path) {
    return {
      path,
      collection: (name) => createCollectionRef(`${path}/${name}`),
      get: async () => {
        const value = store.get(path);
        return {
          exists: value !== undefined,
          data: () => value
        };
      },
      set: async (value, options = {}) => {
        if (options && options.merge) {
          const existing = store.get(path) || {};
          store.set(path, mergeNestedObject(existing, value));
          return;
        }
        store.set(path, value);
      }
    };
  }

  const db = {
    collection: (name) => createCollectionRef(name),
    runTransaction: async (handler) => {
      const tx = {
        get: async (docRef) => docRef.get(),
        set: (docRef, value, options) => docRef.set(value, options)
      };
      return handler(tx);
    }
  };

  return {
    db,
    getDoc: (path) => store.get(path),
    listDocPaths: () => Array.from(store.keys()).sort()
  };
}

describe('automation scheduler metrics sink', () => {
  test('throws when firestore db is missing', () => {
    expect(() => createAutomationSchedulerMetricsSink({})).toThrow(
      'createAutomationSchedulerMetricsSink requires Firestore db'
    );
  });

  test('persists run metrics and maintains daily aggregate counters', async () => {
    const { db, getDoc, listDocPaths } = createInMemoryDb();
    const sink = createAutomationSchedulerMetricsSink({
      db,
      now: () => 1710000000999,
      serverTimestamp: () => 'server-ts',
      timezone: 'UTC'
    });

    await sink.emitSchedulerMetrics({
      schedulerId: 'sched-a',
      startedAtMs: 1710000000000,
      completedAtMs: 1710000000100,
      durationMs: 100,
      totalEnabledUsers: 5,
      cycleCandidates: 4,
      cyclesRun: 3,
      deadLetters: 1,
      errors: 1,
      retries: 2,
      queueLagMs: { avgMs: 20, count: 4, maxMs: 80, minMs: 1, p95Ms: 70, p99Ms: 79 },
      cycleDurationMs: { avgMs: 30, count: 4, maxMs: 90, minMs: 3, p95Ms: 80, p99Ms: 89 },
      telemetryAgeMs: { avgMs: 60000, count: 4, maxMs: 120000, minMs: 10000, p95Ms: 100000, p99Ms: 110000 },
      phaseTimingsMs: {
        dataFetchMs: { avgMs: 8, count: 4, maxMs: 20, minMs: 1, p95Ms: 18, p99Ms: 19 },
        ruleEvalMs: { avgMs: 6, count: 4, maxMs: 14, minMs: 1, p95Ms: 12, p99Ms: 13 },
        actionApplyMs: { avgMs: 4, count: 4, maxMs: 11, minMs: 1, p95Ms: 10, p99Ms: 10 },
        curtailmentMs: { avgMs: 2, count: 4, maxMs: 6, minMs: 0, p95Ms: 5, p99Ms: 5 }
      },
      skipped: { disabledOrBlackout: 1, idempotent: 0, locked: 1, tooSoon: 2 },
      failureByType: { api_rate_limit: 1 },
      telemetryPauseReasons: { stale_telemetry: 1 },
      workerId: 'worker-a',
      slowCycleSamples: [
        { userId: 'u-1', cycleKey: 'u-1_1', queueLagMs: 40, cycleDurationMs: 90, retriesUsed: 1, startedAtMs: 1710000000000, completedAtMs: 1710000000090, success: false, failureType: 'api_rate_limit' }
      ]
    });

    await sink.emitSchedulerMetrics({
      schedulerId: 'sched-b',
      startedAtMs: 1710000000500,
      completedAtMs: 1710000000700,
      durationMs: 200,
      totalEnabledUsers: 6,
      cycleCandidates: 5,
      cyclesRun: 2,
      deadLetters: 0,
      errors: 0,
      retries: 1,
      queueLagMs: { avgMs: 10, count: 5, maxMs: 40, minMs: 2, p95Ms: 35, p99Ms: 39 },
      cycleDurationMs: { avgMs: 60, count: 5, maxMs: 140, minMs: 5, p95Ms: 120, p99Ms: 135 },
      telemetryAgeMs: { avgMs: 30000, count: 5, maxMs: 60000, minMs: 1000, p95Ms: 55000, p99Ms: 59000 },
      phaseTimingsMs: {
        dataFetchMs: { avgMs: 12, count: 5, maxMs: 30, minMs: 1, p95Ms: 26, p99Ms: 28 },
        ruleEvalMs: { avgMs: 9, count: 5, maxMs: 18, minMs: 1, p95Ms: 16, p99Ms: 17 },
        actionApplyMs: { avgMs: 7, count: 5, maxMs: 24, minMs: 1, p95Ms: 21, p99Ms: 23 },
        curtailmentMs: { avgMs: 3, count: 5, maxMs: 8, minMs: 0, p95Ms: 7, p99Ms: 7 }
      },
      skipped: { disabledOrBlackout: 1, idempotent: 1, locked: 0, tooSoon: 3 },
      failureByType: { api_timeout: 2, api_rate_limit: 1 },
      telemetryPauseReasons: { frozen_telemetry: 1 },
      workerId: 'worker-b',
      slowCycleSamples: [
        { userId: 'u-2', cycleKey: 'u-2_1', queueLagMs: 20, cycleDurationMs: 140, retriesUsed: 0, startedAtMs: 1710000000500, completedAtMs: 1710000000640, success: true }
      ]
    });

    const dayKey = sink.getDateKey(1710000000000);
    const runPathA = 'metrics/automationScheduler/runs/1710000000000_sched-a';
    const runPathB = 'metrics/automationScheduler/runs/1710000000500_sched-b';
    const dailyPath = `metrics/automationScheduler/daily/${dayKey}`;
    const currentAlertPath = 'metrics/automationScheduler/alerts/current';
    const dayAlertPath = `metrics/automationScheduler/alerts/${dayKey}`;

    expect(listDocPaths()).toEqual(expect.arrayContaining([
      runPathA,
      runPathB,
      dailyPath,
      currentAlertPath,
      dayAlertPath
    ]));
    expect(getDoc(runPathA)).toEqual(expect.objectContaining({
      schedulerId: 'sched-a',
      workerId: 'worker-a',
      cyclesRun: 3,
      runId: '1710000000000_sched-a',
      cycleDurationMs: expect.objectContaining({
        p95Ms: 80,
        p99Ms: 89
      }),
      phaseTimingsMs: expect.objectContaining({
        dataFetchMs: expect.objectContaining({
          maxMs: 20
        }),
        actionApplyMs: expect.objectContaining({
          maxMs: 11
        })
      }),
      expireAt: new Date(1710000000000 + 30 * 24 * 60 * 60 * 1000),
      slo: expect.objectContaining({
        status: 'breach',
        breachedMetrics: expect.arrayContaining(['errorRatePct', 'deadLetterRatePct'])
      })
    }));
    expect(getDoc(runPathB)).toEqual(expect.objectContaining({
      schedulerId: 'sched-b',
      cyclesRun: 2
    }));

    expect(getDoc(dailyPath)).toEqual(expect.objectContaining({
      runs: 2,
      totalEnabledUsers: 11,
      cycleCandidates: 9,
      cyclesRun: 5,
      deadLetters: 1,
      errors: 1,
      retries: 3,
      maxQueueLagMs: 80,
      maxCycleDurationMs: 140,
      maxTelemetryAgeMs: 120000,
      p95CycleDurationMs: 120,
      p99CycleDurationMs: 135,
      phaseTimingsMaxMs: {
        dataFetchMs: 30,
        ruleEvalMs: 18,
        actionApplyMs: 24,
        curtailmentMs: 8
      },
      avgCycleDurationTotalMs: 420,
      avgCycleDurationSamples: 9,
      skipped: {
        disabledOrBlackout: 2,
        idempotent: 1,
        locked: 1,
        tooSoon: 5
      },
      failureByType: {
        api_rate_limit: 2,
        api_timeout: 2
      },
      telemetryPauseReasons: {
        stale_telemetry: 1,
        frozen_telemetry: 1
      },
      slo: expect.objectContaining({
        status: 'breach',
        breachedMetrics: expect.arrayContaining(['errorRatePct', 'deadLetterRatePct'])
      })
    }));
    expect(getDoc(currentAlertPath)).toEqual(expect.objectContaining({
      dayKey,
      runId: '1710000000500_sched-b',
      schedulerId: 'sched-b',
      status: 'breach',
      breachedMetrics: expect.arrayContaining(['errorRatePct', 'deadLetterRatePct']),
      tailLatency: expect.objectContaining({
        metric: 'sustainedP99CycleDurationMs',
        status: 'healthy'
      }),
      thresholds: expect.objectContaining({
        p99CycleDurationMs: 10000,
        maxTelemetryAgeMs: 30 * 60 * 1000
      })
    }));
    expect(getDoc(dayAlertPath)).toEqual(expect.objectContaining({
      dayKey,
      status: 'breach',
      alertStatus: 'breach'
    }));
  });

  test('emits optional SLO alert callback when daily status is non-healthy', async () => {
    const { db } = createInMemoryDb();
    const onSloAlert = jest.fn(async () => undefined);
    const sink = createAutomationSchedulerMetricsSink({
      db,
      now: () => 1710000010000,
      serverTimestamp: () => 'server-ts',
      timezone: 'UTC',
      sloThresholds: {
        errorRatePct: 0.5,
        deadLetterRatePct: 0.1,
        maxQueueLagMs: 10,
        maxCycleDurationMs: 10,
        p99CycleDurationMs: 10
      },
      onSloAlert
    });

    await sink.emitSchedulerMetrics({
      schedulerId: 'sched-breach',
      startedAtMs: 1710000010000,
      completedAtMs: 1710000011000,
      durationMs: 1000,
      totalEnabledUsers: 3,
      cycleCandidates: 3,
      cyclesRun: 2,
      deadLetters: 1,
      errors: 1,
      retries: 0,
      queueLagMs: { avgMs: 5, count: 3, maxMs: 20, minMs: 1, p95Ms: 18, p99Ms: 19 },
      cycleDurationMs: { avgMs: 20, count: 3, maxMs: 30, minMs: 5, p95Ms: 22, p99Ms: 25 },
      telemetryAgeMs: { avgMs: 10000, count: 3, maxMs: 20000, minMs: 5000, p95Ms: 18000, p99Ms: 19000 },
      skipped: { disabledOrBlackout: 0, idempotent: 0, locked: 0, tooSoon: 1 },
      failureByType: { api_timeout: 1 }
    });

    expect(onSloAlert).toHaveBeenCalledTimes(1);
    expect(onSloAlert).toHaveBeenCalledWith(expect.objectContaining({
      dayKey: sink.getDateKey(1710000010000),
      status: 'breach',
      alertStatus: 'breach',
      breachedMetrics: expect.arrayContaining([
        'errorRatePct',
        'deadLetterRatePct',
        'maxCycleDurationMs',
        'p99CycleDurationMs'
      ]),
      watchMetrics: expect.arrayContaining(['maxQueueLagMs'])
    }));
  });

  test('flags telemetry age SLO breach when max telemetry age exceeds threshold', async () => {
    const { db, getDoc } = createInMemoryDb();
    const sink = createAutomationSchedulerMetricsSink({
      db,
      now: () => 1710000020000,
      serverTimestamp: () => 'server-ts',
      timezone: 'UTC',
      sloThresholds: {
        maxTelemetryAgeMs: 1000
      }
    });

    await sink.emitSchedulerMetrics({
      schedulerId: 'sched-telemetry',
      startedAtMs: 1710000020000,
      completedAtMs: 1710000020200,
      durationMs: 200,
      totalEnabledUsers: 2,
      cycleCandidates: 2,
      cyclesRun: 2,
      deadLetters: 0,
      errors: 0,
      retries: 0,
      queueLagMs: { avgMs: 1, count: 2, maxMs: 2, minMs: 1, p95Ms: 2, p99Ms: 2 },
      cycleDurationMs: { avgMs: 3, count: 2, maxMs: 4, minMs: 2, p95Ms: 4, p99Ms: 4 },
      telemetryAgeMs: { avgMs: 5000, count: 2, maxMs: 5000, minMs: 5000, p95Ms: 5000, p99Ms: 5000 },
      skipped: { disabledOrBlackout: 0, idempotent: 0, locked: 0, tooSoon: 0 }
    });

    const currentAlert = getDoc('metrics/automationScheduler/alerts/current');
    expect(currentAlert).toEqual(expect.objectContaining({
      status: 'breach',
      breachedMetrics: expect.arrayContaining(['maxTelemetryAgeMs']),
      measurements: expect.objectContaining({
        maxTelemetryAgeMs: 5000
      }),
      thresholds: expect.objectContaining({
        maxTelemetryAgeMs: 1000
      })
    }));
  });
});
