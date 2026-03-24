'use strict';

const DEFAULT_SLO_THRESHOLDS = Object.freeze({
  errorRatePct: 1.0,
  deadLetterRatePct: 0.2,
  maxQueueLagMs: 120000,
  maxCycleDurationMs: 20000,
  maxTelemetryAgeMs: 30 * 60 * 1000,
  p99CycleDurationMs: 10000,
  tailP99CycleDurationMs: 10000,
  tailWindowMinutes: 15,
  tailMinRuns: 10
});

const PHASE_TIMING_KEYS = Object.freeze([
  'dataFetchMs',
  'ruleEvalMs',
  'actionApplyMs',
  'curtailmentMs'
]);

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeDurationStats(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    avgMs: Math.max(0, toFiniteNumber(source.avgMs, 0)),
    count: Math.max(0, toFiniteNumber(source.count, 0)),
    maxMs: Math.max(0, toFiniteNumber(source.maxMs, 0)),
    minMs: Math.max(0, toFiniteNumber(source.minMs, 0)),
    p95Ms: Math.max(0, toFiniteNumber(source.p95Ms, 0)),
    p99Ms: Math.max(0, toFiniteNumber(source.p99Ms, 0))
  };
}

function sanitizePhaseTimingStats(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const phaseKey of PHASE_TIMING_KEYS) {
    out[phaseKey] = sanitizeDurationStats(source[phaseKey]);
  }
  return out;
}

function sanitizePhaseTimingMaxMs(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const phaseKey of PHASE_TIMING_KEYS) {
    out[phaseKey] = Math.max(0, toFiniteNumber(source[phaseKey], 0));
  }
  return out;
}

function buildPhaseTimingMaxMs(phaseTimingsMs) {
  const source = phaseTimingsMs && typeof phaseTimingsMs === 'object' ? phaseTimingsMs : {};
  const out = {};
  for (const phaseKey of PHASE_TIMING_KEYS) {
    out[phaseKey] = Math.max(0, toFiniteNumber(source[phaseKey]?.maxMs, 0));
  }
  return out;
}

function resolveSloThresholds(overrides = {}) {
  return {
    errorRatePct: toFiniteNumber(overrides.errorRatePct, DEFAULT_SLO_THRESHOLDS.errorRatePct),
    deadLetterRatePct: toFiniteNumber(overrides.deadLetterRatePct, DEFAULT_SLO_THRESHOLDS.deadLetterRatePct),
    maxQueueLagMs: toFiniteNumber(overrides.maxQueueLagMs, DEFAULT_SLO_THRESHOLDS.maxQueueLagMs),
    maxCycleDurationMs: toFiniteNumber(overrides.maxCycleDurationMs, DEFAULT_SLO_THRESHOLDS.maxCycleDurationMs),
    maxTelemetryAgeMs: toFiniteNumber(overrides.maxTelemetryAgeMs, DEFAULT_SLO_THRESHOLDS.maxTelemetryAgeMs),
    p99CycleDurationMs: toFiniteNumber(overrides.p99CycleDurationMs, DEFAULT_SLO_THRESHOLDS.p99CycleDurationMs),
    tailP99CycleDurationMs: toFiniteNumber(
      overrides.tailP99CycleDurationMs,
      DEFAULT_SLO_THRESHOLDS.tailP99CycleDurationMs
    ),
    tailWindowMinutes: Math.max(
      1,
      Math.floor(toFiniteNumber(overrides.tailWindowMinutes, DEFAULT_SLO_THRESHOLDS.tailWindowMinutes))
    ),
    tailMinRuns: Math.max(
      1,
      Math.floor(toFiniteNumber(overrides.tailMinRuns, DEFAULT_SLO_THRESHOLDS.tailMinRuns))
    )
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
  const maxTelemetryAgeMs = toFiniteNumber(metrics.maxTelemetryAgeMs, 0);
  const p95CycleDurationMs = toFiniteNumber(metrics.p95CycleDurationMs, 0);
  const p99CycleDurationMs = toFiniteNumber(metrics.p99CycleDurationMs, 0);
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
    },
    maxTelemetryAgeMs: {
      metric: 'maxTelemetryAgeMs',
      measured: maxTelemetryAgeMs,
      threshold: toFiniteNumber(thresholds.maxTelemetryAgeMs, DEFAULT_SLO_THRESHOLDS.maxTelemetryAgeMs),
      level: classifySloLevel(maxTelemetryAgeMs, thresholds.maxTelemetryAgeMs)
    },
    p99CycleDurationMs: {
      metric: 'p99CycleDurationMs',
      measured: p99CycleDurationMs,
      threshold: toFiniteNumber(thresholds.p99CycleDurationMs, DEFAULT_SLO_THRESHOLDS.p99CycleDurationMs),
      level: classifySloLevel(p99CycleDurationMs, thresholds.p99CycleDurationMs)
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
      maxCycleDurationMs: metricStates.maxCycleDurationMs.threshold,
      maxTelemetryAgeMs: metricStates.maxTelemetryAgeMs.threshold,
      p99CycleDurationMs: metricStates.p99CycleDurationMs.threshold
    },
    measurements: {
      cyclesRun,
      errors,
      deadLetters,
      errorRatePct,
      deadLetterRatePct,
      maxQueueLagMs,
      maxCycleDurationMs,
      maxTelemetryAgeMs,
      p95CycleDurationMs,
      p99CycleDurationMs
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

function sanitizeSlowCycleSamples(value, maxItems = 3) {
  const safeList = Array.isArray(value) ? value : [];
  return safeList
    .map((entry, index) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      return {
        rank: Math.max(1, Math.floor(toFiniteNumber(source.rank, index + 1))),
        userId: source.userId != null ? String(source.userId) : null,
        cycleKey: source.cycleKey != null ? String(source.cycleKey) : null,
        success: source.success === true,
        failureType: source.failureType ? String(source.failureType) : null,
        queueLagMs: Math.max(0, toFiniteNumber(source.queueLagMs, 0)),
        cycleDurationMs: Math.max(0, toFiniteNumber(source.cycleDurationMs, 0)),
        retriesUsed: Math.max(0, toFiniteNumber(source.retriesUsed, 0)),
        startedAtMs: Math.max(0, toFiniteNumber(source.startedAtMs, 0)),
        completedAtMs: Math.max(0, toFiniteNumber(source.completedAtMs, 0))
      };
    })
    .filter((entry) => entry.cycleDurationMs > 0)
    .sort((a, b) => b.cycleDurationMs - a.cycleDurationMs)
    .slice(0, Math.max(1, Math.floor(toFiniteNumber(maxItems, 3))))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function sanitizeSlowestCycle(value) {
  const source = value && typeof value === 'object' ? value : {};
  const userId = source.userId != null ? String(source.userId) : null;
  const cycleKey = source.cycleKey != null ? String(source.cycleKey) : null;
  const durationMs = Math.max(0, toFiniteNumber(source.durationMs, source.cycleDurationMs));
  if (!userId && !cycleKey && durationMs <= 0) {
    return null;
  }
  return {
    userId,
    cycleKey,
    durationMs,
    queueLagMs: Math.max(0, toFiniteNumber(source.queueLagMs, 0)),
    retriesUsed: Math.max(0, toFiniteNumber(source.retriesUsed, 0)),
    failureType: source.failureType ? String(source.failureType) : null,
    startedAtMs: Math.max(0, toFiniteNumber(source.startedAtMs, 0)),
    completedAtMs: Math.max(0, toFiniteNumber(source.completedAtMs, 0))
  };
}

function sanitizeOutlierRunSnapshot(value) {
  const source = value && typeof value === 'object' ? value : {};
  const runId = source.runId != null ? String(source.runId) : null;
  const maxCycleDurationMs = Math.max(0, toFiniteNumber(source.maxCycleDurationMs, 0));
  if (!runId && maxCycleDurationMs <= 0) {
    return null;
  }
  return {
    dayKey: source.dayKey != null ? String(source.dayKey) : null,
    runId,
    schedulerId: source.schedulerId != null ? String(source.schedulerId) : null,
    workerId: source.workerId != null ? String(source.workerId) : null,
    startedAtMs: Math.max(0, toFiniteNumber(source.startedAtMs, 0)),
    completedAtMs: Math.max(0, toFiniteNumber(source.completedAtMs, 0)),
    maxCycleDurationMs,
    avgCycleDurationMs: Math.max(0, toFiniteNumber(source.avgCycleDurationMs, 0)),
    p95CycleDurationMs: Math.max(0, toFiniteNumber(source.p95CycleDurationMs, 0)),
    p99CycleDurationMs: Math.max(0, toFiniteNumber(source.p99CycleDurationMs, 0)),
    queueLagAvgMs: Math.max(0, toFiniteNumber(source.queueLagAvgMs, 0)),
    queueLagMaxMs: Math.max(0, toFiniteNumber(source.queueLagMaxMs, 0)),
    retries: Math.max(0, toFiniteNumber(source.retries, 0)),
    errors: Math.max(0, toFiniteNumber(source.errors, 0)),
    deadLetters: Math.max(0, toFiniteNumber(source.deadLetters, 0)),
    skipped: {
      disabledOrBlackout: Math.max(0, toFiniteNumber(source.skipped?.disabledOrBlackout, 0)),
      idempotent: Math.max(0, toFiniteNumber(source.skipped?.idempotent, 0)),
      locked: Math.max(0, toFiniteNumber(source.skipped?.locked, 0)),
      tooSoon: Math.max(0, toFiniteNumber(source.skipped?.tooSoon, 0))
    },
    failureByType: buildFailureTally(source.failureByType),
    telemetryPauseReasons: buildFailureTally(source.telemetryPauseReasons),
    phaseTimingsMaxMs: sanitizePhaseTimingMaxMs(source.phaseTimingsMaxMs),
    slowestCycle: sanitizeSlowestCycle(source.slowestCycle)
  };
}

function buildOutlierRunSnapshot(options = {}) {
  const normalizedMetrics = options.normalizedMetrics && typeof options.normalizedMetrics === 'object'
    ? options.normalizedMetrics
    : {};
  const slowCycleSamples = sanitizeSlowCycleSamples(normalizedMetrics.slowCycleSamples, 1);
  const slowestCycle = slowCycleSamples.length > 0 ? slowCycleSamples[0] : null;

  return sanitizeOutlierRunSnapshot({
    dayKey: options.dayKey || null,
    runId: options.runId || null,
    schedulerId: options.schedulerId || null,
    workerId: normalizedMetrics.workerId || null,
    startedAtMs: normalizedMetrics.startedAtMs,
    completedAtMs: normalizedMetrics.completedAtMs,
    maxCycleDurationMs: normalizedMetrics.cycleDurationMs?.maxMs,
    avgCycleDurationMs: normalizedMetrics.cycleDurationMs?.avgMs,
    p95CycleDurationMs: normalizedMetrics.cycleDurationMs?.p95Ms,
    p99CycleDurationMs: normalizedMetrics.cycleDurationMs?.p99Ms,
    queueLagAvgMs: normalizedMetrics.queueLagMs?.avgMs,
    queueLagMaxMs: normalizedMetrics.queueLagMs?.maxMs,
    retries: normalizedMetrics.retries,
    errors: normalizedMetrics.errors,
    deadLetters: normalizedMetrics.deadLetters,
    skipped: normalizedMetrics.skipped,
    failureByType: normalizedMetrics.failureByType,
    telemetryPauseReasons: normalizedMetrics.telemetryPauseReasons,
    phaseTimingsMaxMs: buildPhaseTimingMaxMs(normalizedMetrics.phaseTimingsMs),
    slowestCycle: slowestCycle
      ? {
          userId: slowestCycle.userId,
          cycleKey: slowestCycle.cycleKey,
          durationMs: slowestCycle.cycleDurationMs,
          queueLagMs: slowestCycle.queueLagMs,
          retriesUsed: slowestCycle.retriesUsed,
          failureType: slowestCycle.failureType,
          startedAtMs: slowestCycle.startedAtMs,
          completedAtMs: slowestCycle.completedAtMs
        }
      : null
  });
}

function shouldReplaceOutlierRun(existing, candidate) {
  const safeExisting = sanitizeOutlierRunSnapshot(existing);
  const safeCandidate = sanitizeOutlierRunSnapshot(candidate);
  if (!safeCandidate || safeCandidate.maxCycleDurationMs <= 0) {
    return false;
  }
  if (!safeExisting || safeExisting.maxCycleDurationMs <= 0) {
    return true;
  }
  if (safeCandidate.maxCycleDurationMs > safeExisting.maxCycleDurationMs) {
    return true;
  }
  if (safeCandidate.maxCycleDurationMs < safeExisting.maxCycleDurationMs) {
    return false;
  }
  return safeCandidate.startedAtMs >= safeExisting.startedAtMs;
}

function severityRank(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'breach') return 2;
  if (status === 'watch') return 1;
  return 0;
}

function maxSeverity(a, b) {
  return severityRank(a) >= severityRank(b) ? a : b;
}

function mergeMetricLists(primary = [], additional = []) {
  const merged = [];
  const seen = new Set();
  for (const metric of [...primary, ...additional]) {
    const normalized = String(metric || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function sanitizeTailSamples(value, maxItems = 60) {
  const safeList = Array.isArray(value) ? value : [];
  return safeList
    .map((entry) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      return {
        startedAtMs: Math.max(0, toFiniteNumber(source.startedAtMs, 0)),
        p99Ms: Math.max(0, toFiniteNumber(source.p99Ms, 0))
      };
    })
    .filter((entry) => entry.startedAtMs > 0)
    .sort((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, Math.max(1, Math.floor(toFiniteNumber(maxItems, 60))));
}

function createAutomationSchedulerMetricsSink(deps = {}) {
  const db = deps.db;
  const logger = deps.logger || console;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const onSloAlert = typeof deps.onSloAlert === 'function' ? deps.onSloAlert : null;
  const serverTimestamp = typeof deps.serverTimestamp === 'function' ? deps.serverTimestamp : () => new Date();
  const sloThresholds = resolveSloThresholds(deps.sloThresholds);
  const timezone = deps.timezone || 'UTC';
  let currentAlertStatusCache = null;

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
    const metricsRootRef = db.collection('metrics').doc('automationScheduler');
    const runRef = metricsRootRef.collection('runs').doc(runId);
    const dailyRef = metricsRootRef.collection('daily').doc(dayKey);
    const tailStateRef = metricsRootRef.collection('state').doc('tailLatency');
    const currentAlertRef = metricsRootRef.collection('alerts').doc('current');
    const dayAlertRef = metricsRootRef.collection('alerts').doc(dayKey);

    const normalizedFailureByType = buildFailureTally(metricsInput.failureByType);
    const normalizedTelemetryPauseReasons = buildFailureTally(metricsInput.telemetryPauseReasons);
    const slowCycleSamples = sanitizeSlowCycleSamples(metricsInput.slowCycleSamples);
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
      queueLagMs: sanitizeDurationStats(metricsInput.queueLagMs),
      cycleDurationMs: sanitizeDurationStats(metricsInput.cycleDurationMs),
      phaseTimingsMs: sanitizePhaseTimingStats(metricsInput.phaseTimingsMs),
      telemetryAgeMs: sanitizeDurationStats(metricsInput.telemetryAgeMs),
      skipped: normalizedSkipped,
      failureByType: normalizedFailureByType,
      telemetryPauseReasons: normalizedTelemetryPauseReasons,
      workerId: String(metricsInput.workerId || '').trim() || null,
      slowCycleSamples
    };
    const runOutlierSnapshot = buildOutlierRunSnapshot({
      dayKey,
      normalizedMetrics,
      runId,
      schedulerId
    });
    const runSlo = buildSchedulerSloSnapshot({
      cyclesRun: normalizedMetrics.cyclesRun,
      deadLetters: normalizedMetrics.deadLetters,
      errors: normalizedMetrics.errors,
      maxCycleDurationMs: normalizedMetrics.cycleDurationMs.maxMs,
      maxTelemetryAgeMs: normalizedMetrics.telemetryAgeMs.maxMs,
      maxQueueLagMs: normalizedMetrics.queueLagMs.maxMs,
      p95CycleDurationMs: normalizedMetrics.cycleDurationMs.p95Ms,
      p99CycleDurationMs: normalizedMetrics.cycleDurationMs.p99Ms
    }, sloThresholds, recordedAtMs);

    const RUN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    await runRef.set({
      ...normalizedMetrics,
      dayKey,
      runId,
      slo: runSlo,
      recordedAtMs,
      expireAt: new Date(startedAtMs + RUN_TTL_MS),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    let dailyAggregateForAlert = null;
    const updateDailyAggregate = async (readSnapshot, tailSnapshot, writeSet) => {
      const existingData = readSnapshot.exists ? readSnapshot.data() || {} : {};
      const existingTailData = tailSnapshot.exists ? tailSnapshot.data() || {} : {};
      const existingFailureByType = buildFailureTally(existingData.failureByType);
      const failureByType = mergeFailureTally(existingFailureByType, normalizedFailureByType);
      const existingTelemetryPauseReasons = buildFailureTally(existingData.telemetryPauseReasons);
      const telemetryPauseReasons = mergeFailureTally(
        existingTelemetryPauseReasons,
        normalizedTelemetryPauseReasons
      );
      const previousRuns = toFiniteNumber(existingData.runs, 0);
      const previousMaxQueueLag = toFiniteNumber(existingData.maxQueueLagMs, 0);
      const previousMaxCycleDuration = toFiniteNumber(existingData.maxCycleDurationMs, 0);
      const previousMaxTelemetryAge = toFiniteNumber(existingData.maxTelemetryAgeMs, 0);
      const previousP95CycleDuration = toFiniteNumber(existingData.p95CycleDurationMs, 0);
      const previousP99CycleDuration = toFiniteNumber(existingData.p99CycleDurationMs, 0);
      const nextMaxQueueLagMs = Math.max(previousMaxQueueLag, normalizedMetrics.queueLagMs.maxMs);
      const nextMaxCycleDurationMs = Math.max(previousMaxCycleDuration, normalizedMetrics.cycleDurationMs.maxMs);
      const nextMaxTelemetryAgeMs = Math.max(previousMaxTelemetryAge, normalizedMetrics.telemetryAgeMs.maxMs);
      const nextP95CycleDurationMs = Math.max(previousP95CycleDuration, normalizedMetrics.cycleDurationMs.p95Ms);
      const nextP99CycleDurationMs = Math.max(previousP99CycleDuration, normalizedMetrics.cycleDurationMs.p99Ms);
      const previousPhaseTimingsMaxMs = sanitizePhaseTimingMaxMs(existingData.phaseTimingsMaxMs);
      const runPhaseTimingsMaxMs = buildPhaseTimingMaxMs(normalizedMetrics.phaseTimingsMs);
      const nextPhaseTimingsMaxMs = {};
      for (const phaseKey of PHASE_TIMING_KEYS) {
        nextPhaseTimingsMaxMs[phaseKey] = Math.max(
          toFiniteNumber(previousPhaseTimingsMaxMs[phaseKey], 0),
          toFiniteNumber(runPhaseTimingsMaxMs[phaseKey], 0)
        );
      }
      // Weighted-average accumulation: store total weighted sum + sample count so the
      // daily average can be derived without re-reading every individual run.
      const nextAvgCycleDurationTotalMs =
        toFiniteNumber(existingData.avgCycleDurationTotalMs, 0) +
        normalizedMetrics.cycleDurationMs.avgMs * normalizedMetrics.cycleDurationMs.count;
      const nextAvgCycleDurationSamples =
        toFiniteNumber(existingData.avgCycleDurationSamples, 0) +
        normalizedMetrics.cycleDurationMs.count;
      const nextAvgQueueLagTotalMs =
        toFiniteNumber(existingData.avgQueueLagTotalMs, 0) +
        normalizedMetrics.queueLagMs.avgMs * normalizedMetrics.queueLagMs.count;
      const nextAvgQueueLagSamples =
        toFiniteNumber(existingData.avgQueueLagSamples, 0) +
        normalizedMetrics.queueLagMs.count;
      const nextCyclesRun = toFiniteNumber(existingData.cyclesRun, 0) + normalizedMetrics.cyclesRun;
      const nextDeadLetters = toFiniteNumber(existingData.deadLetters, 0) + normalizedMetrics.deadLetters;
      const nextErrors = toFiniteNumber(existingData.errors, 0) + normalizedMetrics.errors;
      const dailySlo = buildSchedulerSloSnapshot({
        cyclesRun: nextCyclesRun,
        deadLetters: nextDeadLetters,
        errors: nextErrors,
        maxQueueLagMs: nextMaxQueueLagMs,
        maxCycleDurationMs: nextMaxCycleDurationMs,
        maxTelemetryAgeMs: nextMaxTelemetryAgeMs,
        p95CycleDurationMs: nextP95CycleDurationMs,
        p99CycleDurationMs: nextP99CycleDurationMs
      }, sloThresholds, recordedAtMs);

      const tailThresholdMs = Math.max(0, toFiniteNumber(sloThresholds.tailP99CycleDurationMs, 0));
      const tailWindowMinutes = Math.max(1, Math.floor(toFiniteNumber(sloThresholds.tailWindowMinutes, 15)));
      const tailMinRuns = Math.max(1, Math.floor(toFiniteNumber(sloThresholds.tailMinRuns, 10)));
      const tailWindowMs = tailWindowMinutes * 60 * 1000;
      const tailWindowStartMs = recordedAtMs - tailWindowMs;
      const tailSampleLimit = Math.max(20, Math.min(120, tailMinRuns * 4));
      const priorTailSamples = sanitizeTailSamples(existingTailData.runs, tailSampleLimit);
      const nextTailSamples = sanitizeTailSamples([
        {
          startedAtMs,
          p99Ms: normalizedMetrics.cycleDurationMs.p99Ms
        },
        ...priorTailSamples
      ], tailSampleLimit).filter((sample) => sample.startedAtMs >= tailWindowStartMs);

      const tailP99Values = nextTailSamples
        .map((sample) => toFiniteNumber(sample.p99Ms, NaN))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const tailRunsAboveThreshold = tailThresholdMs > 0
        ? tailP99Values.filter((value) => value > tailThresholdMs).length
        : 0;
      const tailRatioAboveThreshold = tailP99Values.length > 0
        ? Number((tailRunsAboveThreshold / tailP99Values.length).toFixed(4))
        : 0;
      let tailStatus = 'healthy';
      if (tailP99Values.length >= tailMinRuns && tailThresholdMs > 0) {
        if (tailRunsAboveThreshold === tailP99Values.length) {
          tailStatus = 'breach';
        } else if (tailRatioAboveThreshold >= 0.8) {
          tailStatus = 'watch';
        }
      }
      const tailLatency = {
        metric: 'sustainedP99CycleDurationMs',
        status: tailStatus,
        thresholdMs: tailThresholdMs,
        windowMinutes: tailWindowMinutes,
        minRuns: tailMinRuns,
        observedRuns: tailP99Values.length,
        runsAboveThreshold: tailRunsAboveThreshold,
        ratioAboveThreshold: tailRatioAboveThreshold,
        latestP99Ms: normalizedMetrics.cycleDurationMs.p99Ms,
        minObservedP99Ms: tailP99Values.length ? Math.min(...tailP99Values) : 0,
        maxObservedP99Ms: tailP99Values.length ? Math.max(...tailP99Values) : 0,
        windowStartMs: tailWindowStartMs,
        windowEndMs: recordedAtMs
      };

      dailyAggregateForAlert = {
        slo: dailySlo,
        tailLatency
      };

      const existingOutlierRun = sanitizeOutlierRunSnapshot(existingData.outlierRun);
      const nextOutlierRun = shouldReplaceOutlierRun(existingOutlierRun, runOutlierSnapshot)
        ? runOutlierSnapshot
        : existingOutlierRun;

      await writeSet({
        daily: {
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
          maxTelemetryAgeMs: nextMaxTelemetryAgeMs,
          p95CycleDurationMs: nextP95CycleDurationMs,
          p99CycleDurationMs: nextP99CycleDurationMs,
          phaseTimingsMaxMs: nextPhaseTimingsMaxMs,
          avgCycleDurationTotalMs: nextAvgCycleDurationTotalMs,
          avgCycleDurationSamples: nextAvgCycleDurationSamples,
          avgQueueLagTotalMs: nextAvgQueueLagTotalMs,
          avgQueueLagSamples: nextAvgQueueLagSamples,
          failureByType,
          telemetryPauseReasons,
          slo: dailySlo,
          tailLatency,
          outlierRun: nextOutlierRun,
          lastSchedulerId: schedulerId,
          lastRunAtMs: recordedAtMs,
          updatedAt: serverTimestamp()
        },
        tailState: {
          runs: nextTailSamples,
          thresholdMs: tailThresholdMs,
          windowMinutes: tailWindowMinutes,
          minRuns: tailMinRuns,
          updatedAtMs: recordedAtMs,
          updatedAt: serverTimestamp()
        }
      });
    };

    if (typeof db.runTransaction === 'function') {
      await db.runTransaction(async (tx) => {
        const dailySnapshot = await tx.get(dailyRef);
        const tailSnapshot = await tx.get(tailStateRef);
        await updateDailyAggregate(dailySnapshot, tailSnapshot, (data) => {
          tx.set(dailyRef, data.daily, { merge: true });
          tx.set(tailStateRef, data.tailState, { merge: true });
        });
      });
    } else {
      const dailySnapshot = await dailyRef.get();
      const tailSnapshot = await tailStateRef.get();
      await updateDailyAggregate(dailySnapshot, tailSnapshot, async (data) => {
        await dailyRef.set(data.daily, { merge: true });
        await tailStateRef.set(data.tailState, { merge: true });
      });
    }

    if (!dailyAggregateForAlert) {
      return;
    }

    const tailLatency = dailyAggregateForAlert && dailyAggregateForAlert.tailLatency
      ? dailyAggregateForAlert.tailLatency
      : {
          metric: 'sustainedP99CycleDurationMs',
          status: 'healthy',
          thresholdMs: Math.max(0, toFiniteNumber(sloThresholds.tailP99CycleDurationMs, 0)),
          windowMinutes: Math.max(1, toFiniteNumber(sloThresholds.tailWindowMinutes, 15)),
          minRuns: Math.max(1, toFiniteNumber(sloThresholds.tailMinRuns, 10)),
          observedRuns: 0,
          runsAboveThreshold: 0,
          ratioAboveThreshold: 0,
          latestP99Ms: normalizedMetrics.cycleDurationMs.p99Ms,
          minObservedP99Ms: 0,
          maxObservedP99Ms: 0,
          windowStartMs: recordedAtMs,
          windowEndMs: recordedAtMs
        };

    const dailySlo = dailyAggregateForAlert.slo || buildSchedulerSloSnapshot({}, sloThresholds, recordedAtMs);
    const breachedMetrics = new Set(dailySlo.breachedMetrics || []);
    const watchMetrics = new Set(dailySlo.watchMetrics || []);
    if (tailLatency.status === 'breach') {
      breachedMetrics.add('sustainedP99CycleDurationMs');
      watchMetrics.delete('sustainedP99CycleDurationMs');
    } else if (tailLatency.status === 'watch' && !breachedMetrics.has('sustainedP99CycleDurationMs')) {
      watchMetrics.add('sustainedP99CycleDurationMs');
    }
    const status = maxSeverity(dailySlo.status, tailLatency.status);

    const currentAlert = {
      dayKey,
      runId,
      schedulerId,
      workerId: normalizedMetrics.workerId || null,
      status,
      breachedMetrics: mergeMetricLists(dailySlo.breachedMetrics, Array.from(breachedMetrics)),
      watchMetrics: mergeMetricLists(dailySlo.watchMetrics, Array.from(watchMetrics)),
      thresholds: {
        ...dailySlo.thresholds,
        maxTelemetryAgeMs: toFiniteNumber(dailySlo.thresholds?.maxTelemetryAgeMs, 0),
        tailP99CycleDurationMs: tailLatency.thresholdMs,
        tailWindowMinutes: tailLatency.windowMinutes,
        tailMinRuns: tailLatency.minRuns
      },
      measurements: {
        ...dailySlo.measurements,
        maxTelemetryAgeMs: toFiniteNumber(dailySlo.measurements?.maxTelemetryAgeMs, 0),
        latestRunP99CycleDurationMs: normalizedMetrics.cycleDurationMs.p99Ms
      },
      tailLatency,
      monitoredAtMs: dailySlo.monitoredAtMs,
      updatedAt: serverTimestamp()
    };

    if (status !== 'healthy') {
      await currentAlertRef.set(currentAlert, { merge: true });
      currentAlertStatusCache = status;
      await dayAlertRef.set({
        ...currentAlert,
        alertStatus: status,
        lastAlertAtMs: recordedAtMs
      }, { merge: true });
      if (logger && typeof logger.warn === 'function') {
        logger.warn(
          `[SchedulerSLO] ${status.toUpperCase()} metrics=${JSON.stringify({
            breached: currentAlert.breachedMetrics,
            watch: currentAlert.watchMetrics,
            tailLatency
          })}`
        );
      }
      if (onSloAlert) {
        try {
          await onSloAlert({
            ...currentAlert,
            alertStatus: status
          });
        } catch (alertErr) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn(`[SchedulerSLO] Failed to emit SLO alert callback: ${alertErr.message}`);
          }
        }
      }
    } else {
      let shouldClearCurrentAlert = currentAlertStatusCache != null && currentAlertStatusCache !== 'healthy';
      if (!shouldClearCurrentAlert) {
        const currentAlertSnapshot = await currentAlertRef.get();
        if (currentAlertSnapshot.exists) {
          const existingAlert = currentAlertSnapshot.data() || {};
          const existingStatus = String(existingAlert.status || '').trim().toLowerCase();
          shouldClearCurrentAlert = existingStatus === 'watch' || existingStatus === 'breach';
        }
      }

      if (shouldClearCurrentAlert && typeof currentAlertRef.delete === 'function') {
        await currentAlertRef.delete();
      }
      currentAlertStatusCache = 'healthy';
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
