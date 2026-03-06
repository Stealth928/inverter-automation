'use strict';

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const serverTimestamp = typeof deps.serverTimestamp === 'function' ? deps.serverTimestamp : () => new Date();
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

    await runRef.set({
      ...normalizedMetrics,
      dayKey,
      runId,
      recordedAtMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    const updateDailyAggregate = async (readSnapshot, writeSet) => {
      const existingData = readSnapshot.exists ? readSnapshot.data() || {} : {};
      const existingFailureByType = buildFailureTally(existingData.failureByType);
      const failureByType = mergeFailureTally(existingFailureByType, normalizedFailureByType);
      const previousRuns = toFiniteNumber(existingData.runs, 0);
      const previousMaxQueueLag = toFiniteNumber(existingData.maxQueueLagMs, 0);
      const previousMaxCycleDuration = toFiniteNumber(existingData.maxCycleDurationMs, 0);

      writeSet({
        dayKey,
        runs: previousRuns + 1,
        totalEnabledUsers: toFiniteNumber(existingData.totalEnabledUsers, 0) + normalizedMetrics.totalEnabledUsers,
        cycleCandidates: toFiniteNumber(existingData.cycleCandidates, 0) + normalizedMetrics.cycleCandidates,
        cyclesRun: toFiniteNumber(existingData.cyclesRun, 0) + normalizedMetrics.cyclesRun,
        deadLetters: toFiniteNumber(existingData.deadLetters, 0) + normalizedMetrics.deadLetters,
        errors: toFiniteNumber(existingData.errors, 0) + normalizedMetrics.errors,
        retries: toFiniteNumber(existingData.retries, 0) + normalizedMetrics.retries,
        skipped: {
          disabledOrBlackout:
            toFiniteNumber(existingData.skipped?.disabledOrBlackout, 0) + normalizedSkipped.disabledOrBlackout,
          idempotent: toFiniteNumber(existingData.skipped?.idempotent, 0) + normalizedSkipped.idempotent,
          locked: toFiniteNumber(existingData.skipped?.locked, 0) + normalizedSkipped.locked,
          tooSoon: toFiniteNumber(existingData.skipped?.tooSoon, 0) + normalizedSkipped.tooSoon
        },
        maxQueueLagMs: Math.max(previousMaxQueueLag, normalizedMetrics.queueLagMs.maxMs),
        maxCycleDurationMs: Math.max(previousMaxCycleDuration, normalizedMetrics.cycleDurationMs.maxMs),
        failureByType,
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
      return;
    }

    const snapshot = await dailyRef.get();
    await updateDailyAggregate(snapshot, (data) => dailyRef.set(data, { merge: true }));
  }

  return {
    emitSchedulerMetrics,
    getDateKey
  };
}

module.exports = {
  createAutomationSchedulerMetricsSink
};
