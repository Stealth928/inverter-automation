'use strict';

const DEFAULT_SLO_THRESHOLDS = Object.freeze({
  errorRatePct: 1.0,
  deadLetterRatePct: 0.2,
  maxQueueLagMs: 120000,
  maxCycleDurationMs: 60000
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSloThresholds(overrides = {}) {
  return {
    errorRatePct: toFiniteNumber(overrides.errorRatePct, DEFAULT_SLO_THRESHOLDS.errorRatePct),
    deadLetterRatePct: toFiniteNumber(overrides.deadLetterRatePct, DEFAULT_SLO_THRESHOLDS.deadLetterRatePct),
    maxQueueLagMs: toFiniteNumber(overrides.maxQueueLagMs, DEFAULT_SLO_THRESHOLDS.maxQueueLagMs),
    maxCycleDurationMs: toFiniteNumber(overrides.maxCycleDurationMs, DEFAULT_SLO_THRESHOLDS.maxCycleDurationMs)
  };
}

function classifySloLevel(measured, threshold) {
  const value = toFiniteNumber(measured, 0);
  const target = toFiniteNumber(threshold, 0);
  if (!Number.isFinite(target) || target <= 0) {
    return 'watch';
  }
  if (value <= target) {
    return 'healthy';
  }
  if (value <= target * 2) {
    return 'watch';
  }
  return 'breach';
}

function buildSchedulerSloSnapshot(metrics = {}, thresholds = {}, monitoredAtMs = Date.now()) {
  const cyclesRun = toFiniteNumber(metrics.cyclesRun, 0);
  const errors = toFiniteNumber(metrics.errors, 0);
  const deadLetters = toFiniteNumber(metrics.deadLetters, 0);
  const maxQueueLagMs = toFiniteNumber(metrics.maxQueueLagMs, 0);
  const maxCycleDurationMs = toFiniteNumber(metrics.maxCycleDurationMs, 0);
  const errorRatePct = cyclesRun > 0 ? Number(((errors / cyclesRun) * 100).toFixed(2)) : 0;
  const deadLetterRatePct = cyclesRun > 0 ? Number(((deadLetters / cyclesRun) * 100).toFixed(2)) : 0;

  const metricStates = {
    errorRatePct: {
      metric: 'errorRatePct',
      measured: errorRatePct,
      threshold: toFiniteNumber(thresholds.errorRatePct, DEFAULT_SLO_THRESHOLDS.errorRatePct),
      level: classifySloLevel(errorRatePct, thresholds.errorRatePct)
    },
    deadLetterRatePct: {
      metric: 'deadLetterRatePct',
      measured: deadLetterRatePct,
      threshold: toFiniteNumber(thresholds.deadLetterRatePct, DEFAULT_SLO_THRESHOLDS.deadLetterRatePct),
      level: classifySloLevel(deadLetterRatePct, thresholds.deadLetterRatePct)
    },
    maxQueueLagMs: {
      metric: 'maxQueueLagMs',
      measured: maxQueueLagMs,
      threshold: toFiniteNumber(thresholds.maxQueueLagMs, DEFAULT_SLO_THRESHOLDS.maxQueueLagMs),
      level: classifySloLevel(maxQueueLagMs, thresholds.maxQueueLagMs)
    },
    maxCycleDurationMs: {
      metric: 'maxCycleDurationMs',
      measured: maxCycleDurationMs,
      threshold: toFiniteNumber(thresholds.maxCycleDurationMs, DEFAULT_SLO_THRESHOLDS.maxCycleDurationMs),
      level: classifySloLevel(maxCycleDurationMs, thresholds.maxCycleDurationMs)
    }
  };

  const breachedMetrics = Object.values(metricStates)
    .filter((entry) => entry.level === 'breach')
    .map((entry) => entry.metric);
  const watchMetrics = Object.values(metricStates)
    .filter((entry) => entry.level === 'watch')
    .map((entry) => entry.metric);

  let status = 'healthy';
  if (breachedMetrics.length > 0) {
    status = 'breach';
  } else if (watchMetrics.length > 0) {
    status = 'watch';
  }

  return {
    status,
    monitoredAtMs: toFiniteNumber(monitoredAtMs, Date.now()),
    thresholds: {
      errorRatePct: metricStates.errorRatePct.threshold,
      deadLetterRatePct: metricStates.deadLetterRatePct.threshold,
      maxQueueLagMs: metricStates.maxQueueLagMs.threshold,
      maxCycleDurationMs: metricStates.maxCycleDurationMs.threshold
    },
    measurements: {
      cyclesRun,
      errors,
      deadLetters,
      errorRatePct,
      deadLetterRatePct,
      maxQueueLagMs,
      maxCycleDurationMs
    },
    metrics: metricStates,
    breachedMetrics,
    watchMetrics
  };
}

function sanitizeSchedulerId(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'scheduler';
  }
  const sanitized = text.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized.slice(0, 80) || 'scheduler';
}

function buildFailureTally(value) {
  const tally = {};
  const source = value && typeof value === 'object' ? value : {};
  for (const [key, count] of Object.entries(source)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    const normalizedCount = toFiniteNumber(count, 0);
    if (normalizedCount > 0) {
      tally[normalizedKey] = normalizedCount;
    }
  }
  return tally;
}

function mergeFailureTally(existing, incoming) {
  const merged = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [key, count] of Object.entries(incoming || {})) {
    merged[key] = toFiniteNumber(merged[key], 0) + toFiniteNumber(count, 0);
  }
  return merged;
}

function createAutomationSchedulerMetricsSink(deps = {}) {
  const db = deps.db;
  const logger = deps.logger || console;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const onSloAlert = typeof deps.onSloAlert === 'function' ? deps.onSloAlert : null;
  const serverTimestamp = typeof deps.serverTimestamp === 'function' ? deps.serverTimestamp : () => new Date();
  const sloThresholds = resolveSloThresholds(deps.sloThresholds);
  const timezone = deps.timezone || 'UTC';

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createAutomationSchedulerMetricsSink requires Firestore db');
  }

  function getDateKey(timestampMs = now()) {
    return new Date(timestampMs).toLocaleDateString('en-CA', { timeZone: timezone });
  }

  async function emitSchedulerMetrics(metricsInput = {}) {
    const recordedAtMs = now();
    const startedAtMs = toFiniteNumber(metricsInput.startedAtMs, recordedAtMs);
    const schedulerId = sanitizeSchedulerId(metricsInput.schedulerId);
    const runId = `${startedAtMs}_${schedulerId}`;
    const dayKey = getDateKey(startedAtMs);

    const runRef = db.collection('metrics').doc('automationScheduler').collection('runs').doc(runId);
    const dailyRef = db.collection('metrics').doc('automationScheduler').collection('daily').doc(dayKey);
    const currentAlertRef = db.collection('metrics').doc('automationScheduler').collection('alerts').doc('current');
    const dayAlertRef = db.collection('metrics').doc('automationScheduler').collection('alerts').doc(dayKey);

    const normalizedFailureByType = buildFailureTally(metricsInput.failureByType);
    const normalizedSkipped = {
      disabledOrBlackout: toFiniteNumber(metricsInput.skipped?.disabledOrBlackout, 0),
      idempotent: toFiniteNumber(metricsInput.skipped?.idempotent, 0),
      locked: toFiniteNumber(metricsInput.skipped?.locked, 0),
      tooSoon: toFiniteNumber(metricsInput.skipped?.tooSoon, 0)
    };

    const normalizedMetrics = {
      schedulerId,
      startedAtMs,
      completedAtMs: toFiniteNumber(metricsInput.completedAtMs, recordedAtMs),
      durationMs: toFiniteNumber(metricsInput.durationMs, 0),
      totalEnabledUsers: toFiniteNumber(metricsInput.totalEnabledUsers, 0),
      cycleCandidates: toFiniteNumber(metricsInput.cycleCandidates, 0),
      cyclesRun: toFiniteNumber(metricsInput.cyclesRun, 0),
      deadLetters: toFiniteNumber(metricsInput.deadLetters, 0),
      errors: toFiniteNumber(metricsInput.errors, 0),
      retries: toFiniteNumber(metricsInput.retries, 0),
      queueLagMs: {
        avgMs: toFiniteNumber(metricsInput.queueLagMs?.avgMs, 0),
        count: toFiniteNumber(metricsInput.queueLagMs?.count, 0),
        maxMs: toFiniteNumber(metricsInput.queueLagMs?.maxMs, 0),
        minMs: toFiniteNumber(metricsInput.queueLagMs?.minMs, 0)
      },
      cycleDurationMs: {
        avgMs: toFiniteNumber(metricsInput.cycleDurationMs?.avgMs, 0),
        count: toFiniteNumber(metricsInput.cycleDurationMs?.count, 0),
        maxMs: toFiniteNumber(metricsInput.cycleDurationMs?.maxMs, 0),
        minMs: toFiniteNumber(metricsInput.cycleDurationMs?.minMs, 0)
      },
      skipped: normalizedSkipped,
      failureByType: normalizedFailureByType
    };
    const runSlo = buildSchedulerSloSnapshot({
      cyclesRun: normalizedMetrics.cyclesRun,
      deadLetters: normalizedMetrics.deadLetters,
      errors: normalizedMetrics.errors,
      maxCycleDurationMs: normalizedMetrics.cycleDurationMs.maxMs,
      maxQueueLagMs: normalizedMetrics.queueLagMs.maxMs
    }, sloThresholds, recordedAtMs);

    await runRef.set({
      ...normalizedMetrics,
      dayKey,
      runId,
      slo: runSlo,
      recordedAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    let dailyAggregateForAlert = null;
    const updateDailyAggregate = async (readSnapshot, writeSet) => {
      const existingData = readSnapshot.exists ? readSnapshot.data() || {} : {};
      const existingFailureByType = buildFailureTally(existingData.failureByType);
      const failureByType = mergeFailureTally(existingFailureByType, normalizedFailureByType);
      const previousRuns = toFiniteNumber(existingData.runs, 0);
      const previousMaxQueueLag = toFiniteNumber(existingData.maxQueueLagMs, 0);
      const previousMaxCycleDuration = toFiniteNumber(existingData.maxCycleDurationMs, 0);
      const nextMaxQueueLagMs = Math.max(previousMaxQueueLag, normalizedMetrics.queueLagMs.maxMs);
      const nextMaxCycleDurationMs = Math.max(previousMaxCycleDuration, normalizedMetrics.cycleDurationMs.maxMs);
      const nextCyclesRun = toFiniteNumber(existingData.cyclesRun, 0) + normalizedMetrics.cyclesRun;
      const nextDeadLetters = toFiniteNumber(existingData.deadLetters, 0) + normalizedMetrics.deadLetters;
      const nextErrors = toFiniteNumber(existingData.errors, 0) + normalizedMetrics.errors;
      const dailySlo = buildSchedulerSloSnapshot({
        cyclesRun: nextCyclesRun,
        deadLetters: nextDeadLetters,
        errors: nextErrors,
        maxQueueLagMs: nextMaxQueueLagMs,
        maxCycleDurationMs: nextMaxCycleDurationMs
      }, sloThresholds, recordedAtMs);

      dailyAggregateForAlert = dailySlo;

      writeSet({
        dayKey,
        runs: previousRuns + 1,
        totalEnabledUsers: toFiniteNumber(existingData.totalEnabledUsers, 0) + normalizedMetrics.totalEnabledUsers,
        cycleCandidates: toFiniteNumber(existingData.cycleCandidates, 0) + normalizedMetrics.cycleCandidates,
        cyclesRun: nextCyclesRun,
        deadLetters: nextDeadLetters,
        errors: nextErrors,
        retries: toFiniteNumber(existingData.retries, 0) + normalizedMetrics.retries,
        skipped: {
          disabledOrBlackout:
            toFiniteNumber(existingData.skipped?.disabledOrBlackout, 0) + normalizedSkipped.disabledOrBlackout,
          idempotent: toFiniteNumber(existingData.skipped?.idempotent, 0) + normalizedSkipped.idempotent,
          locked: toFiniteNumber(existingData.skipped?.locked, 0) + normalizedSkipped.locked,
          tooSoon: toFiniteNumber(existingData.skipped?.tooSoon, 0) + normalizedSkipped.tooSoon
        },
        maxQueueLagMs: nextMaxQueueLagMs,
        maxCycleDurationMs: nextMaxCycleDurationMs,
        failureByType,
        slo: dailySlo,
        lastSchedulerId: schedulerId,
        lastRunAtMs: recordedAtMs,
        updatedAt: serverTimestamp()
      });
    };

    if (typeof db.runTransaction === 'function') {
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(dailyRef);
        await updateDailyAggregate(snapshot, (data) => tx.set(dailyRef, data, { merge: true }));
      });
    } else {
      const snapshot = await dailyRef.get();
      await updateDailyAggregate(snapshot, (data) => dailyRef.set(data, { merge: true }));
    }

    if (!dailyAggregateForAlert) {
      return;
    }

    const currentAlert = {
      dayKey,
      runId,
      schedulerId,
      status: dailyAggregateForAlert.status,
      breachedMetrics: dailyAggregateForAlert.breachedMetrics,
      watchMetrics: dailyAggregateForAlert.watchMetrics,
      thresholds: dailyAggregateForAlert.thresholds,
      measurements: dailyAggregateForAlert.measurements,
      monitoredAtMs: dailyAggregateForAlert.monitoredAtMs,
      updatedAt: serverTimestamp()
    };

    await currentAlertRef.set(currentAlert, { merge: true });
    if (dailyAggregateForAlert.status !== 'healthy') {
      await dayAlertRef.set({
        ...currentAlert,
        alertStatus: dailyAggregateForAlert.status,
        lastAlertAtMs: recordedAtMs
      }, { merge: true });
      if (logger && typeof logger.warn === 'function') {
        logger.warn(
          `[SchedulerSLO] ${dailyAggregateForAlert.status.toUpperCase()} metrics=${JSON.stringify({
            breached: dailyAggregateForAlert.breachedMetrics,
            watch: dailyAggregateForAlert.watchMetrics
          })}`
        );
      }
      if (onSloAlert) {
        try {
          await onSloAlert({
            ...currentAlert,
            alertStatus: dailyAggregateForAlert.status
          });
        } catch (alertErr) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn(`[SchedulerSLO] Failed to emit SLO alert callback: ${alertErr.message}`);
          }
        }
      }
    }
  }

  return {
    emitSchedulerMetrics,
    getDateKey,
    getSloThresholds: () => ({ ...sloThresholds })
  };
}

module.exports = {
  createAutomationSchedulerMetricsSink
};
