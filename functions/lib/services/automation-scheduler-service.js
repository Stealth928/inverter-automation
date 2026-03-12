'use strict';

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`runAutomationSchedulerCycle requires ${name}()`);
  }
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePositiveInteger(values, fallback) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function resolveNonNegativeInteger(values, fallback) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeSchedulerOptions(serverConfig, overrideOptions = {}) {
  const schedulerConfig = serverConfig?.automation?.scheduler || {};
  return {
    maxConcurrentUsers: resolvePositiveInteger(
      [
        overrideOptions.maxConcurrentUsers,
        schedulerConfig.maxConcurrentUsers,
        process.env.AUTOMATION_SCHEDULER_MAX_CONCURRENCY
      ],
      10
    ),
    retryAttempts: resolvePositiveInteger(
      [
        overrideOptions.retryAttempts,
        schedulerConfig.retryAttempts,
        process.env.AUTOMATION_SCHEDULER_RETRY_ATTEMPTS
      ],
      2
    ),
    retryBaseDelayMs: resolveNonNegativeInteger(
      [
        overrideOptions.retryBaseDelayMs,
        schedulerConfig.retryBaseDelayMs,
        process.env.AUTOMATION_SCHEDULER_RETRY_BASE_DELAY_MS
      ],
      500
    ),
    retryJitterMs: resolveNonNegativeInteger(
      [
        overrideOptions.retryJitterMs,
        schedulerConfig.retryJitterMs,
        process.env.AUTOMATION_SCHEDULER_RETRY_JITTER_MS
      ],
      250
    ),
    lockLeaseMs: resolvePositiveInteger(
      [
        overrideOptions.lockLeaseMs,
        schedulerConfig.lockLeaseMs,
        process.env.AUTOMATION_SCHEDULER_LOCK_LEASE_MS
      ],
      120000
    ),
    idempotencyTtlMs: resolvePositiveInteger(
      [
        overrideOptions.idempotencyTtlMs,
        schedulerConfig.idempotencyTtlMs,
        process.env.AUTOMATION_SCHEDULER_IDEMPOTENCY_TTL_MS
      ],
      300000
    ),
    deadLetterTtlMs: resolvePositiveInteger(
      [
        overrideOptions.deadLetterTtlMs,
        schedulerConfig.deadLetterTtlMs,
        process.env.AUTOMATION_SCHEDULER_DEAD_LETTER_TTL_MS
      ],
      604800000
    )
  };
}

function createMockResponseCollector() {
  let payload = null;
  const response = {
    json: (data) => {
      payload = data;
      return response;
    },
    status: () => response,
    send: (data) => {
      payload = data;
      return response;
    }
  };

  return {
    response,
    getPayload: () => payload
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, maxConcurrency, iterator) {
  const safeItems = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(maxConcurrency || 1, safeItems.length || 1));
  const results = new Array(safeItems.length);
  let nextIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < safeItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await iterator(safeItems[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function warnLog(logger, message) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message);
    return;
  }
  if (logger && typeof logger.log === 'function') {
    logger.log(message);
  }
}

function resolveSchedulerWorkerId() {
  const service = String(process.env.K_SERVICE || process.env.FUNCTION_TARGET || '').trim();
  const revision = String(process.env.K_REVISION || '').trim();
  const host = String(process.env.HOSTNAME || '').trim();
  const parts = [service || 'scheduler', revision, host].filter(Boolean);
  return parts.length > 0 ? parts.join(':') : 'scheduler-worker';
}

const PHASE_TIMING_KEYS = Object.freeze([
  'dataFetchMs',
  'ruleEvalMs',
  'actionApplyMs',
  'curtailmentMs'
]);

function createEmptyPhaseTimings() {
  return {
    dataFetchMs: 0,
    ruleEvalMs: 0,
    actionApplyMs: 0,
    curtailmentMs: 0
  };
}

function sanitizePhaseTimingSample(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = createEmptyPhaseTimings();
  for (const key of PHASE_TIMING_KEYS) {
    out[key] = Math.max(0, toFiniteNumber(source[key], 0));
  }
  return out;
}

function readPhaseTimingsFromCycleResult(cycleResult) {
  return sanitizePhaseTimingSample(cycleResult?.result?.phaseTimingsMs);
}

function readTelemetryFromCycleResult(cycleResult) {
  const telemetry = cycleResult?.result?.telemetry;
  const pauseReason = telemetry && telemetry.pauseReason
    ? String(telemetry.pauseReason)
    : null;
  const status = telemetry && telemetry.status
    ? String(telemetry.status)
    : 'unknown';
  const ageMs = toFiniteNumber(telemetry?.ageMs, NaN);
  return {
    ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : NaN,
    status,
    pauseReason
  };
}

function createLockRef(db, userId) {
  return db.collection('users').doc(userId).collection('automation').doc('lock');
}

function createIdempotencyRef(db, userId, cycleKey) {
  return db.collection('users').doc(userId).collection('automation').doc(`idempotency_${cycleKey}`);
}

async function defaultAcquireUserCycleLock(options = {}) {
  const db = options.db;
  const userId = options.userId;
  const schedulerId = options.schedulerId;
  const lockLeaseMs = options.lockLeaseMs;
  const lockRef = createLockRef(db, userId);
  const nowMs = Date.now();
  const lockId = `${schedulerId}_${Math.random().toString(36).slice(2, 9)}`;
  const expiresAt = nowMs + lockLeaseMs;
  let acquired = false;

  if (typeof db.runTransaction === 'function') {
    await db.runTransaction(async (tx) => {
      const lockSnapshot = await tx.get(lockRef);
      const lockData = lockSnapshot.exists ? lockSnapshot.data() || {} : {};
      const currentExpiresAt = toFiniteNumber(lockData.expiresAt, 0);
      const hasActiveLock = Boolean(lockData.lockId) && currentExpiresAt > nowMs;
      if (hasActiveLock) {
        acquired = false;
        return;
      }
      acquired = true;
      tx.set(lockRef, {
        lockId,
        schedulerId,
        acquiredAt: nowMs,
        expiresAt,
        updatedAt: nowMs
      }, { merge: true });
    });
  } else {
    const lockSnapshot = await lockRef.get();
    const lockData = lockSnapshot.exists ? lockSnapshot.data() || {} : {};
    const currentExpiresAt = toFiniteNumber(lockData.expiresAt, 0);
    const hasActiveLock = Boolean(lockData.lockId) && currentExpiresAt > nowMs;
    if (!hasActiveLock) {
      await lockRef.set({
        lockId,
        schedulerId,
        acquiredAt: nowMs,
        expiresAt,
        updatedAt: nowMs
      }, { merge: true });
      acquired = true;
    }
  }

  return {
    acquired,
    lockId,
    lockRef
  };
}

async function defaultReleaseUserCycleLock(options = {}) {
  const db = options.db;
  const userId = options.userId;
  const lockHandle = options.lockHandle;
  if (!lockHandle || lockHandle.acquired !== true || !lockHandle.lockId) {
    return;
  }

  const lockRef = lockHandle.lockRef || createLockRef(db, userId);
  const nowMs = Date.now();

  if (typeof db.runTransaction === 'function') {
    await db.runTransaction(async (tx) => {
      const lockSnapshot = await tx.get(lockRef);
      const lockData = lockSnapshot.exists ? lockSnapshot.data() || {} : {};
      if (lockData.lockId !== lockHandle.lockId) {
        return;
      }
      tx.set(lockRef, {
        lockId: null,
        schedulerId: null,
        expiresAt: 0,
        releasedAt: nowMs,
        updatedAt: nowMs
      }, { merge: true });
    });
    return;
  }

  await lockRef.set({
    lockId: null,
    schedulerId: null,
    expiresAt: 0,
    releasedAt: nowMs,
    updatedAt: nowMs
  }, { merge: true });
}

async function defaultShouldRunCycleKey(options = {}) {
  const db = options.db;
  const userId = options.userId;
  const cycleKey = options.cycleKey;
  const schedulerId = options.schedulerId;
  const idempotencyTtlMs = options.idempotencyTtlMs;
  const idempotencyRef = createIdempotencyRef(db, userId, cycleKey);
  const nowMs = Date.now();
  let shouldRun = false;

  if (typeof db.runTransaction === 'function') {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(idempotencyRef);
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const expiresAt = toFiniteNumber(data.expiresAt, 0);
      const status = data.status;
      const hasActiveMarker =
        snapshot.exists &&
        expiresAt > nowMs &&
        (status === 'started' || status === 'completed');
      if (hasActiveMarker) {
        shouldRun = false;
        return;
      }

      shouldRun = true;
      tx.set(idempotencyRef, {
        cycleKey,
        schedulerId,
        status: 'started',
        startedAt: nowMs,
        expiresAt: nowMs + idempotencyTtlMs,
        updatedAt: nowMs
      }, { merge: true });
    });
    return shouldRun;
  }

  const snapshot = await idempotencyRef.get();
  if (snapshot.exists) {
    const data = snapshot.data() || {};
    const expiresAt = toFiniteNumber(data.expiresAt, 0);
    const status = data.status;
    if (expiresAt > nowMs && (status === 'started' || status === 'completed')) {
      return false;
    }
  }

  await idempotencyRef.set({
    cycleKey,
    schedulerId,
    status: 'started',
    startedAt: nowMs,
    expiresAt: nowMs + idempotencyTtlMs,
    updatedAt: nowMs
  }, { merge: true });
  return true;
}

async function defaultMarkCycleOutcome(options = {}) {
  const db = options.db;
  const userId = options.userId;
  const cycleKey = options.cycleKey;
  const result = options.result || {};
  const idempotencyRef = createIdempotencyRef(db, userId, cycleKey);
  const nowMs = Date.now();
  await idempotencyRef.set({
    status: result.success ? 'completed' : 'failed',
    attempts: toFiniteNumber(result.attempts, 1),
    completedAt: nowMs,
    updatedAt: nowMs,
    error: result.success ? null : String(result.errorMessage || result.error || 'Unknown scheduler error').slice(0, 500)
  }, { merge: true });
}

async function defaultRecordDeadLetter(options = {}) {
  const db = options.db;
  const userId = options.userId;
  const cycleKey = options.cycleKey;
  const result = options.result || {};
  const deadLetterTtlMs = options.deadLetterTtlMs;
  const nowMs = Date.now();
  const deadLetterId = `${nowMs}_${Math.random().toString(36).slice(2, 9)}`;
  await db.collection('users').doc(userId).collection('automation_dead_letters').doc(deadLetterId).set({
    cycleKey,
    createdAt: nowMs,
    expiresAt: nowMs + deadLetterTtlMs,
    ttl: Math.floor((nowMs + deadLetterTtlMs) / 1000),
    attempts: toFiniteNumber(result.attempts, 1),
    error: String(result.errorMessage || result.error || 'Unknown scheduler error').slice(0, 1000)
  });
}

function computeRetryDelayMs(baseDelayMs, jitterMs, attempt) {
  const exponent = Math.max(0, attempt - 1);
  const exponentialDelay = baseDelayMs * Math.pow(2, exponent);
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
  return exponentialDelay + jitter;
}

function isRetriableFailure(error, cycleResult) {
  const errno = toFiniteNumber(cycleResult?.errno, NaN);
  if (Number.isFinite(errno)) {
    return errno >= 500 || errno === 408 || errno === 429 || errno === 503 || errno === 504;
  }

  const message = String(error?.message || '').toLowerCase();
  if (!message) {
    return true;
  }

  return [
    'timeout',
    'timed out',
    'rate limit',
    'too many requests',
    'resource exhausted',
    'deadline exceeded',
    'contention',
    'econnreset',
    'socket hang up',
    'etimedout',
    'aborted'
  ].some((token) => message.includes(token));
}

function buildCycleKey(userId, nowMs, intervalMs) {
  const safeIntervalMs = Math.max(1000, toFiniteNumber(intervalMs, 60000));
  const cycleWindow = Math.floor(nowMs / safeIntervalMs);
  return `${userId}_${cycleWindow}`;
}

function classifyFailureType(error, cycleResult) {
  const errno = toFiniteNumber(cycleResult?.errno, NaN);
  if (Number.isFinite(errno)) {
    if (errno === 429) return 'api_rate_limit';
    if (errno === 408 || errno === 504) return 'api_timeout';
    if (errno === 503) return 'service_unavailable';
    if (errno === 409) return 'conflict';
    if (errno >= 500) return 'server_error';
    return `errno_${errno}`;
  }

  const message = String(error?.message || '').toLowerCase();
  if (!message) {
    return 'unknown_error';
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout') ||
    message.includes('deadline exceeded')
  ) {
    return 'api_timeout';
  }
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('resource exhausted')
  ) {
    return 'api_rate_limit';
  }
  if (message.includes('contention') || message.includes('aborted')) {
    return 'firestore_contention';
  }
  if (
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('network')
  ) {
    return 'network_error';
  }

  return 'unknown_error';
}

function computePercentile(sortedValues, percentile) {
  const safeSortedValues = Array.isArray(sortedValues) ? sortedValues : [];
  if (!safeSortedValues.length) {
    return 0;
  }
  if (safeSortedValues.length === 1) {
    return safeSortedValues[0];
  }
  const boundedPercentile = Math.max(0, Math.min(1, toFiniteNumber(percentile, 0)));
  const rank = boundedPercentile * (safeSortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) {
    return safeSortedValues[lowerIndex];
  }
  const lowerValue = safeSortedValues[lowerIndex];
  const upperValue = safeSortedValues[upperIndex];
  const interpolation = rank - lowerIndex;
  return lowerValue + ((upperValue - lowerValue) * interpolation);
}

function buildDurationStats(values) {
  const safeValues = (Array.isArray(values) ? values : [])
    .map((value) => toFiniteNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (safeValues.length === 0) {
    return {
      avgMs: 0,
      count: 0,
      maxMs: 0,
      minMs: 0,
      p95Ms: 0,
      p99Ms: 0
    };
  }

  let sum = 0;
  let min = safeValues[0];
  let max = safeValues[0];
  for (const value of safeValues) {
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const sortedValues = safeValues.slice().sort((a, b) => a - b);

  return {
    avgMs: Math.round(sum / safeValues.length),
    count: safeValues.length,
    maxMs: Math.round(max),
    minMs: Math.round(min),
    p95Ms: Math.round(computePercentile(sortedValues, 0.95)),
    p99Ms: Math.round(computePercentile(sortedValues, 0.99))
  };
}

function buildPhaseTimingStats(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const executedEntries = safeEntries.filter((entry) => entry && entry.executed === true);
  const stats = {};
  for (const phaseKey of PHASE_TIMING_KEYS) {
    const phaseValues = executedEntries.map((entry) => toFiniteNumber(entry.phaseTimingsMs?.[phaseKey], NaN));
    stats[phaseKey] = buildDurationStats(phaseValues);
  }
  return stats;
}

function buildSlowCycleSamples(entries, limit = 3) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  return safeEntries
    .filter((entry) => entry && entry.executed === true)
    .map((entry) => ({
      userId: entry.userId || null,
      cycleKey: entry.cycleKey || null,
      success: entry.success === true,
      failureType: entry.failureType || null,
      queueLagMs: Math.max(0, toFiniteNumber(entry.queueLagMs, 0)),
      cycleDurationMs: Math.max(0, toFiniteNumber(entry.cycleDurationMs, 0)),
      retriesUsed: Math.max(0, toFiniteNumber(entry.retriesUsed, 0)),
      startedAtMs: toFiniteNumber(entry.startedAtMs, 0),
      completedAtMs: toFiniteNumber(entry.completedAtMs, 0)
    }))
    .filter((entry) => entry.cycleDurationMs > 0)
    .sort((a, b) => b.cycleDurationMs - a.cycleDurationMs)
    .slice(0, Math.max(1, Math.floor(toFiniteNumber(limit, 3))))
    .map((entry, index) => ({
      rank: index + 1,
      ...entry
    }));
}

function tallyFailureTypes(entries) {
  const failureByType = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && entry.success === false) {
      const type = entry.failureType || 'unknown_error';
      failureByType[type] = (failureByType[type] || 0) + 1;
    }
  }
  return failureByType;
}

function tallyTelemetryPauseReasons(entries) {
  const pauseReasons = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.executed !== true) continue;
    const reason = entry.telemetryPauseReason ? String(entry.telemetryPauseReason).trim() : '';
    if (!reason) continue;
    pauseReasons[reason] = (pauseReasons[reason] || 0) + 1;
  }
  return pauseReasons;
}

async function invokeAutomationCycleHandler(options = {}) {
  const automationCycleHandler = options.automationCycleHandler;
  const userId = options.userId;
  const cycleKey = options.cycleKey;
  const collector = createMockResponseCollector();
  const headers = { 'x-automation-cycle-key': cycleKey };
  const mockReq = {
    user: { uid: userId },
    body: { cycleKey },
    headers,
    get: (name) => headers[String(name || '').toLowerCase()] || null
  };

  await automationCycleHandler(mockReq, collector.response);
  const cycleResult = collector.getPayload();
  if (!cycleResult || cycleResult.errno === 0) {
    return { success: true, cycleResult };
  }

  return {
    success: false,
    cycleResult,
    error: new Error(cycleResult.error || cycleResult.msg || `Scheduler cycle failed with errno=${cycleResult.errno}`)
  };
}

async function runCycleWithRetry(options = {}) {
  const automationCycleHandler = options.automationCycleHandler;
  const cycleKey = options.cycleKey;
  const logger = options.logger || console;
  const retryAttempts = options.retryAttempts;
  const retryBaseDelayMs = options.retryBaseDelayMs;
  const retryJitterMs = options.retryJitterMs;
  const sleepFn = options.sleepFn;
  const userId = options.userId;
  const runStartMs = Date.now();

  let attempts = 0;
  let lastError = null;
  let lastCycleResult = null;
  while (attempts < retryAttempts) {
    attempts += 1;
    const invokeResult = await invokeAutomationCycleHandler({
      automationCycleHandler,
      cycleKey,
      userId
    });
    if (invokeResult.success) {
      const phaseTimingsMs = readPhaseTimingsFromCycleResult(invokeResult.cycleResult);
      const telemetry = readTelemetryFromCycleResult(invokeResult.cycleResult);
      if (invokeResult.cycleResult?.result?.triggered) {
        logger.log(`[Scheduler] User ${userId}: Rule '${invokeResult.cycleResult.result.rule?.name}' triggered`);
      } else if (invokeResult.cycleResult?.result?.skipped) {
        logger.log(`[Scheduler] User ${userId}: Skipped: ${invokeResult.cycleResult.result.reason}`);
      }
      return {
        success: true,
        attempts,
        cycleResult: invokeResult.cycleResult,
        durationMs: Date.now() - runStartMs,
        failureType: null,
        phaseTimingsMs,
        telemetryAgeMs: telemetry.ageMs,
        telemetryStatus: telemetry.status,
        telemetryPauseReason: telemetry.pauseReason
      };
    }

    lastError = invokeResult.error;
    lastCycleResult = invokeResult.cycleResult;
    const retriable = isRetriableFailure(lastError, lastCycleResult);
    if (!retriable || attempts >= retryAttempts) {
      logger.error(`[Scheduler] User ${userId}: Error after ${attempts} attempt(s): ${lastError.message}`);
      return {
        success: false,
        attempts,
        cycleResult: lastCycleResult,
        error: lastError,
        durationMs: Date.now() - runStartMs,
        failureType: classifyFailureType(lastError, lastCycleResult),
        phaseTimingsMs: readPhaseTimingsFromCycleResult(lastCycleResult),
        telemetryAgeMs: readTelemetryFromCycleResult(lastCycleResult).ageMs,
        telemetryStatus: readTelemetryFromCycleResult(lastCycleResult).status,
        telemetryPauseReason: readTelemetryFromCycleResult(lastCycleResult).pauseReason
      };
    }

    const delayMs = computeRetryDelayMs(retryBaseDelayMs, retryJitterMs, attempts);
    warnLog(
      logger,
      `[Scheduler] User ${userId}: transient failure on attempt ${attempts}; retrying in ${delayMs}ms (${lastError.message})`
    );
    if (delayMs > 0) {
      await sleepFn(delayMs);
    }
  }

  return {
    success: false,
    attempts,
    cycleResult: lastCycleResult,
    error: lastError || new Error('Unknown scheduler retry failure'),
    durationMs: Date.now() - runStartMs,
    failureType: classifyFailureType(lastError, lastCycleResult),
    phaseTimingsMs: readPhaseTimingsFromCycleResult(lastCycleResult),
    telemetryAgeMs: readTelemetryFromCycleResult(lastCycleResult).ageMs,
    telemetryStatus: readTelemetryFromCycleResult(lastCycleResult).status,
    telemetryPauseReason: readTelemetryFromCycleResult(lastCycleResult).pauseReason
  };
}

async function runAutomationSchedulerCycle(_context, deps = {}) {
  const automationCycleHandler = deps.automationCycleHandler;
  const db = deps.db;
  const emitSchedulerMetrics = deps.emitSchedulerMetrics;
  const getConfig = deps.getConfig;
  const getTimeInTimezone = deps.getTimeInTimezone;
  const getUserAutomationState = deps.getUserAutomationState;
  const getUserConfig = deps.getUserConfig;
  const getUserRules = deps.getUserRules;
  const isTimeInRange = deps.isTimeInRange;
  const logger = deps.logger || console;

  if (!db || typeof db.collection !== 'function') {
    throw new Error('runAutomationSchedulerCycle requires db.collection()');
  }
  assertFunction(automationCycleHandler, 'automationCycleHandler');
  assertFunction(getConfig, 'getConfig');
  assertFunction(getTimeInTimezone, 'getTimeInTimezone');
  assertFunction(getUserAutomationState, 'getUserAutomationState');
  assertFunction(getUserConfig, 'getUserConfig');
  assertFunction(getUserRules, 'getUserRules');
  assertFunction(isTimeInRange, 'isTimeInRange');
  if (emitSchedulerMetrics != null) {
    assertFunction(emitSchedulerMetrics, 'emitSchedulerMetrics');
  }

  const schedulerStartTime = Date.now();
  const schedId = `${schedulerStartTime}_${Math.random().toString(36).slice(2, 11)}`;
  const workerId = resolveSchedulerWorkerId();
  logger.log(`[Scheduler] ========== Background check ${schedId} START ==========`);

  try {
    const serverConfig = getConfig();
    const defaultIntervalMs = serverConfig.automation.intervalMs;
    const schedulerOptions = normalizeSchedulerOptions(serverConfig, deps.schedulerOptions);
    const sleepFn = typeof deps.sleep === 'function' ? deps.sleep : sleep;
    const acquireUserCycleLock =
      typeof deps.acquireUserCycleLock === 'function'
        ? deps.acquireUserCycleLock
        : defaultAcquireUserCycleLock;
    const releaseUserCycleLock =
      typeof deps.releaseUserCycleLock === 'function'
        ? deps.releaseUserCycleLock
        : defaultReleaseUserCycleLock;
    const shouldRunCycleKey =
      typeof deps.shouldRunCycleKey === 'function'
        ? deps.shouldRunCycleKey
        : defaultShouldRunCycleKey;
    const markCycleOutcome =
      typeof deps.markCycleOutcome === 'function'
        ? deps.markCycleOutcome
        : defaultMarkCycleOutcome;
    const recordDeadLetter =
      typeof deps.recordDeadLetter === 'function'
        ? deps.recordDeadLetter
        : defaultRecordDeadLetter;

    let usersSnapshot = await db.collection('users').where('automationEnabled', '==', true).get();

    if (usersSnapshot.size === 0) {
      logger.log('[Scheduler] No pre-filtered users found - running migration scan...');
      const allUsersSnapshot = await db.collection('users').get();
      let migratedCount = 0;

      await mapWithConcurrency(allUsersSnapshot.docs, schedulerOptions.maxConcurrentUsers, async (userDoc) => {
        try {
          const stateDoc = await db.collection('users').doc(userDoc.id)
            .collection('automation').doc('state').get();
          if (stateDoc.exists && stateDoc.data()?.enabled === true) {
            await db.collection('users').doc(userDoc.id).set(
              { automationEnabled: true },
              { merge: true }
            );
            logger.log(`[Scheduler] Migrated user ${userDoc.id}: set automationEnabled=true`);
            migratedCount++;
          }
        } catch (error) {
          logger.error(`[Scheduler] Migration check failed for ${userDoc.id}:`, error.message);
        }
      });

      if (migratedCount === 0) {
        logger.log('[Scheduler] Migration scan complete - no enabled users found, skipping');
        return null;
      }

      logger.log(`[Scheduler] Migration complete - ${migratedCount} user(s) migrated, re-querying...`);
      usersSnapshot = await db.collection('users').where('automationEnabled', '==', true).get();
    }

    const totalEnabled = usersSnapshot.size;
    const userDataAll = await mapWithConcurrency(
      usersSnapshot.docs,
      schedulerOptions.maxConcurrentUsers,
      async (userDoc) => {
      const userId = userDoc.id;
      try {
        const state = await getUserAutomationState(userId);
        const userConfig = await getUserConfig(userId);
        return {
          userId,
          state,
          userConfig,
          ready: state && state.enabled === true && userConfig?.deviceSn
        };
      } catch (error) {
        return { userId, error: error.message, ready: false };
      }
    });

    const cycleCandidates = [];
    let skippedDisabled = 0;
    let skippedTooSoon = 0;
    const now = Date.now();
    const cycleEligibility = await mapWithConcurrency(
      userDataAll,
      schedulerOptions.maxConcurrentUsers,
      async (userData) => {
        if (!userData.ready) {
          return { reason: 'disabled_or_invalid' };
        }

        const { userId, state, userConfig } = userData;
        const userIntervalMs = userConfig?.automation?.intervalMs || defaultIntervalMs;
        const lastCheck = state?.lastCheck || 0;
        if ((now - lastCheck) < userIntervalMs) {
          return { reason: 'too_soon' };
        }

        try {
          const userRules = await getUserRules(userId);
          const blackoutWindows = userRules?.blackoutWindows || [];
          let inBlackout = false;
          if (Array.isArray(blackoutWindows) && blackoutWindows.length > 0) {
            const userTz = userConfig?.timezone || 'UTC';
            const userNow = getTimeInTimezone(userTz);
            const dayOfWeek = userNow.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
            const currentTime = userNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

            for (const window of blackoutWindows) {
              if (window.enabled === false) continue;
              const applicableDays = window.days || [];
              if (applicableDays.length > 0 && !applicableDays.includes(dayOfWeek)) {
                continue;
              }
              if (isTimeInRange(currentTime, window.start, window.end)) {
                inBlackout = true;
                break;
              }
            }
          }

          if (inBlackout) {
            return { reason: 'disabled_or_invalid' };
          }
        } catch (rulesError) {
          warnLog(
            logger,
            `[Scheduler] User ${userId}: failed to load/evaluate blackout rules: ${rulesError.message}`
          );
          return { reason: 'disabled_or_invalid' };
        }

        return {
          reason: 'candidate',
          value: {
            userId,
            cycleKey: buildCycleKey(userId, now, userIntervalMs),
            state,
            userConfig
          }
        };
      }
    );

    for (const entry of cycleEligibility) {
      if (!entry || entry.reason === 'disabled_or_invalid') {
        skippedDisabled++;
        continue;
      }
      if (entry.reason === 'too_soon') {
        skippedTooSoon++;
        continue;
      }
      if (entry.reason === 'candidate' && entry.value) {
        cycleCandidates.push(entry.value);
      }
    }

    let cyclesRun = 0;
    let errors = 0;
    let skippedLocked = 0;
    let skippedIdempotent = 0;
    let deadLetters = 0;
    let totalRetries = 0;
    let queueLagStats = buildDurationStats([]);
    let cycleDurationStats = buildDurationStats([]);
    let phaseTimingStats = buildPhaseTimingStats([]);
    let telemetryAgeStats = buildDurationStats([]);
    let failureByType = {};
    let telemetryPauseReasons = {};
    let slowCycleSamples = [];
    if (cycleCandidates.length > 0) {
      const cycleResults = await mapWithConcurrency(
        cycleCandidates,
        schedulerOptions.maxConcurrentUsers,
        async ({ userId, cycleKey }) => {
        const cycleStartMs = Date.now();
        const queueLagMs = Math.max(0, cycleStartMs - schedulerStartTime);
        let lockHandle = null;
        try {
          lockHandle = await acquireUserCycleLock({
            db,
            lockLeaseMs: schedulerOptions.lockLeaseMs,
            schedulerId: schedId,
            userId
          });
          if (!lockHandle || lockHandle.acquired !== true) {
            logger.log(`[Scheduler] User ${userId}: skipped due to active lock`);
            const completedAtMs = Date.now();
            return {
              userId,
              cycleKey,
              startedAtMs: cycleStartMs,
              completedAtMs,
              executed: false,
              success: true,
              skippedLocked: 1,
              skippedIdempotent: 0,
              deadLetters: 0,
              retriesUsed: 0,
              failureType: null,
              queueLagMs,
              cycleDurationMs: completedAtMs - cycleStartMs,
              attempts: 0,
              phaseTimingsMs: createEmptyPhaseTimings(),
              telemetryAgeMs: NaN,
              telemetryStatus: 'unknown',
              telemetryPauseReason: null
            };
          }

          const shouldRun = await shouldRunCycleKey({
            cycleKey,
            db,
            idempotencyTtlMs: schedulerOptions.idempotencyTtlMs,
            schedulerId: schedId,
            userId
          });
          if (!shouldRun) {
            logger.log(`[Scheduler] User ${userId}: skipped due to idempotency key ${cycleKey}`);
            const completedAtMs = Date.now();
            return {
              userId,
              cycleKey,
              startedAtMs: cycleStartMs,
              completedAtMs,
              executed: false,
              success: true,
              skippedLocked: 0,
              skippedIdempotent: 1,
              deadLetters: 0,
              retriesUsed: 0,
              failureType: null,
              queueLagMs,
              cycleDurationMs: completedAtMs - cycleStartMs,
              attempts: 0,
              phaseTimingsMs: createEmptyPhaseTimings(),
              telemetryAgeMs: NaN,
              telemetryStatus: 'unknown',
              telemetryPauseReason: null
            };
          }

          const cycleExecution = await runCycleWithRetry({
            automationCycleHandler,
            cycleKey,
            logger,
            retryAttempts: schedulerOptions.retryAttempts,
            retryBaseDelayMs: schedulerOptions.retryBaseDelayMs,
            retryJitterMs: schedulerOptions.retryJitterMs,
            sleepFn,
            userId
          });

          await markCycleOutcome({
            cycleKey,
            db,
            result: {
              attempts: cycleExecution.attempts,
              error: cycleExecution.error ? cycleExecution.error.message : null,
              success: cycleExecution.success
            },
            userId
          });

          if (!cycleExecution.success) {
            await recordDeadLetter({
              cycleKey,
              db,
              deadLetterTtlMs: schedulerOptions.deadLetterTtlMs,
              result: {
                attempts: cycleExecution.attempts,
                error: cycleExecution.error ? cycleExecution.error.message : 'Scheduler cycle failed'
                },
                userId
            });
            const completedAtMs = Date.now();
            return {
              userId,
              cycleKey,
              startedAtMs: cycleStartMs,
              completedAtMs,
              executed: true,
              success: false,
              skippedLocked: 0,
              skippedIdempotent: 0,
              deadLetters: 1,
              retriesUsed: Math.max(0, cycleExecution.attempts - 1),
              failureType: cycleExecution.failureType || 'unknown_error',
              queueLagMs,
              cycleDurationMs: toFiniteNumber(cycleExecution.durationMs, completedAtMs - cycleStartMs),
              attempts: Math.max(1, toFiniteNumber(cycleExecution.attempts, 1)),
              phaseTimingsMs: sanitizePhaseTimingSample(cycleExecution.phaseTimingsMs),
              telemetryAgeMs: toFiniteNumber(cycleExecution.telemetryAgeMs, NaN),
              telemetryStatus: cycleExecution.telemetryStatus || 'unknown',
              telemetryPauseReason: cycleExecution.telemetryPauseReason || null
            };
          }

          const completedAtMs = Date.now();
          return {
            userId,
            cycleKey,
            startedAtMs: cycleStartMs,
            completedAtMs,
            executed: true,
            success: true,
            skippedLocked: 0,
            skippedIdempotent: 0,
            deadLetters: 0,
            retriesUsed: Math.max(0, cycleExecution.attempts - 1),
            failureType: null,
            queueLagMs,
            cycleDurationMs: toFiniteNumber(cycleExecution.durationMs, completedAtMs - cycleStartMs),
            attempts: Math.max(1, toFiniteNumber(cycleExecution.attempts, 1)),
            phaseTimingsMs: sanitizePhaseTimingSample(cycleExecution.phaseTimingsMs),
            telemetryAgeMs: toFiniteNumber(cycleExecution.telemetryAgeMs, NaN),
            telemetryStatus: cycleExecution.telemetryStatus || 'unknown',
            telemetryPauseReason: cycleExecution.telemetryPauseReason || null
          };
        } catch (error) {
          logger.error(`[Scheduler] User ${userId}: Exception: ${error.message}`);
          const completedAtMs = Date.now();
          return {
            userId,
            cycleKey,
            startedAtMs: cycleStartMs,
            completedAtMs,
            executed: false,
            success: false,
            skippedLocked: 0,
            skippedIdempotent: 0,
            deadLetters: 0,
            retriesUsed: 0,
            failureType: classifyFailureType(error, null),
            queueLagMs,
            cycleDurationMs: completedAtMs - cycleStartMs,
            attempts: 0,
            phaseTimingsMs: createEmptyPhaseTimings(),
            telemetryAgeMs: NaN,
            telemetryStatus: 'unknown',
            telemetryPauseReason: null
          };
        } finally {
          try {
            await releaseUserCycleLock({
              db,
              lockHandle,
              schedulerId: schedId,
              userId
            });
          } catch (releaseError) {
            warnLog(logger, `[Scheduler] User ${userId}: failed to release lock: ${releaseError.message}`);
          }
        }
      });

      cyclesRun = cycleResults.filter((entry) => entry.executed === true).length;
      errors = cycleResults.filter((entry) => !entry.success).length;
      skippedLocked = cycleResults.reduce((sum, entry) => sum + toFiniteNumber(entry.skippedLocked, 0), 0);
      skippedIdempotent = cycleResults.reduce((sum, entry) => sum + toFiniteNumber(entry.skippedIdempotent, 0), 0);
      deadLetters = cycleResults.reduce((sum, entry) => sum + toFiniteNumber(entry.deadLetters, 0), 0);
      totalRetries = cycleResults.reduce((sum, entry) => sum + toFiniteNumber(entry.retriesUsed, 0), 0);
      queueLagStats = buildDurationStats(cycleResults.map((entry) => entry.queueLagMs));
      cycleDurationStats = buildDurationStats(cycleResults.map((entry) => entry.cycleDurationMs));
      phaseTimingStats = buildPhaseTimingStats(cycleResults);
      telemetryAgeStats = buildDurationStats(cycleResults.map((entry) => entry.telemetryAgeMs));
      failureByType = tallyFailureTypes(cycleResults);
      telemetryPauseReasons = tallyTelemetryPauseReasons(cycleResults);
      slowCycleSamples = buildSlowCycleSamples(cycleResults);
    }

    const duration = Date.now() - schedulerStartTime;
    const schedulerMetrics = {
      schedulerId: schedId,
      workerId,
      startedAtMs: schedulerStartTime,
      completedAtMs: schedulerStartTime + duration,
      durationMs: duration,
      totalEnabledUsers: totalEnabled,
      cycleCandidates: cycleCandidates.length,
      cyclesRun,
      deadLetters,
      errors,
      retries: totalRetries,
      queueLagMs: queueLagStats,
      cycleDurationMs: cycleDurationStats,
      phaseTimingsMs: phaseTimingStats,
      telemetryAgeMs: telemetryAgeStats,
      skipped: {
        disabledOrBlackout: skippedDisabled,
        idempotent: skippedIdempotent,
        locked: skippedLocked,
        tooSoon: skippedTooSoon
      },
      failureByType,
      telemetryPauseReasons,
      slowCycleSamples
    };
    logger.log(`[Scheduler] ========== Background check ${schedId} COMPLETE ==========`);
    logger.log(
      `[Scheduler] ${totalEnabled} enabled users: ${cyclesRun} cycles, ${skippedTooSoon} too soon, ${skippedDisabled} skipped, ${skippedLocked} locked, ${skippedIdempotent} idempotent, ${errors} errors, ${deadLetters} dead-letter, ${totalRetries} retries (${duration}ms)`
    );
    logger.log(
      `[SchedulerMetrics] queueLag avg=${queueLagStats.avgMs}ms max=${queueLagStats.maxMs}ms; cycleDuration avg=${cycleDurationStats.avgMs}ms max=${cycleDurationStats.maxMs}ms; telemetryAge avg=${telemetryAgeStats.avgMs}ms max=${telemetryAgeStats.maxMs}ms; failureTypes=${JSON.stringify(failureByType)}`
    );
    if (typeof emitSchedulerMetrics === 'function') {
      try {
        await emitSchedulerMetrics(schedulerMetrics);
      } catch (emitError) {
        warnLog(logger, `[SchedulerMetrics] Failed to emit scheduler metrics: ${emitError.message}`);
      }
    }
    return null;
  } catch (error) {
    logger.error('[Scheduler] FATAL:', error);
    throw error;
  }
}

module.exports = {
  runAutomationSchedulerCycle
};
