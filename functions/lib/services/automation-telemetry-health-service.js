'use strict';

const DEFAULT_FRESHNESS_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_FROZEN_MAX_AGE_MS = 60 * 60 * 1000;

const SOC_VARIABLE_ALIASES = Object.freeze(['SoC', 'SoC1', 'SoC_1']);
const PV_POWER_VARIABLE_ALIASES = Object.freeze(['pvPower', 'pv_power', 'generationPower']);
const LOAD_POWER_VARIABLE_ALIASES = Object.freeze(['loadsPower', 'loadPower', 'load_power']);
const GRID_POWER_VARIABLE_ALIASES = Object.freeze([
  'gridConsumptionPower',
  'gridPower',
  'meterPower',
  'meterPower2'
]);
const FEED_IN_POWER_VARIABLE_ALIASES = Object.freeze(['feedinPower', 'feedInPower']);

function toFiniteNumber(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFoxessCloudTimeToMs(value) {
  if (typeof value !== 'string') {
    return NaN;
  }
  const text = value.trim();
  if (!text) {
    return NaN;
  }
  const match = text.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:.*?([+-]\d{4}))?$/);
  if (!match) {
    return NaN;
  }
  const base = String(match[1]).replace(' ', 'T');
  const offsetRaw = match[2];
  const normalized = offsetRaw
    ? `${base}${String(offsetRaw).replace(/([+-]\d{2})(\d{2})/, '$1:$2')}`
    : base;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseTimestampMs(value) {
  if (value === null || value === undefined) {
    return NaN;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NaN;
    // Assume epoch seconds when too small for ms.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }

  if (typeof value === 'object') {
    const sec = value._seconds ?? value.seconds;
    const nsec = value._nanoseconds ?? value.nanoseconds ?? value.nanos ?? 0;
    if (Number.isFinite(Number(sec))) {
      return Math.round((Number(sec) * 1000) + (Number(nsec) / 1e6));
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return NaN;

    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return parseTimestampMs(Number(trimmed));
    }

    const parsedIso = Date.parse(trimmed);
    if (Number.isFinite(parsedIso)) {
      return parsedIso;
    }

    const parsedFoxess = parseFoxessCloudTimeToMs(trimmed);
    if (Number.isFinite(parsedFoxess)) {
      return parsedFoxess;
    }
  }

  return NaN;
}

function getTelemetryDatas(inverterData) {
  const result = inverterData && inverterData.result;
  if (Array.isArray(result) && result.length > 0) {
    const firstFrame = result[0] || {};
    if (Array.isArray(firstFrame.datas)) return firstFrame.datas;
    if (Array.isArray(firstFrame.data)) return firstFrame.data;
    if (firstFrame && typeof firstFrame === 'object' && (firstFrame.variable || firstFrame.key)) {
      return result;
    }
  }
  if (result && typeof result === 'object') {
    if (Array.isArray(result.datas)) return result.datas;
    if (Array.isArray(result.data)) return result.data;
  }
  return [];
}

function findTelemetryValue(datas, aliases) {
  if (!Array.isArray(datas)) return null;
  for (const alias of aliases) {
    const row = datas.find((entry) => entry && (entry.variable === alias || entry.key === alias));
    if (row && row.value !== undefined && row.value !== null) {
      return row.value;
    }
  }
  return null;
}

function normalizeFingerprintValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 10) / 10;
}

function buildTelemetryFingerprint(inverterData) {
  const datas = getTelemetryDatas(inverterData);
  if (!datas.length) {
    return null;
  }

  const payload = {
    socPct: normalizeFingerprintValue(findTelemetryValue(datas, SOC_VARIABLE_ALIASES)),
    pvPowerW: normalizeFingerprintValue(findTelemetryValue(datas, PV_POWER_VARIABLE_ALIASES)),
    loadPowerW: normalizeFingerprintValue(findTelemetryValue(datas, LOAD_POWER_VARIABLE_ALIASES)),
    gridPowerW: normalizeFingerprintValue(findTelemetryValue(datas, GRID_POWER_VARIABLE_ALIASES)),
    feedInPowerW: normalizeFingerprintValue(findTelemetryValue(datas, FEED_IN_POWER_VARIABLE_ALIASES))
  };

  const hasSignal = Object.values(payload).some((entry) => entry !== null);
  return hasSignal ? JSON.stringify(payload) : null;
}

function extractTelemetryTimestampMs(inverterData) {
  const firstResult = Array.isArray(inverterData?.result) ? inverterData.result[0] : null;
  const candidates = [
    inverterData?.observedAtIso,
    inverterData?.observedAt,
    inverterData?.time,
    inverterData?.timestamp,
    firstResult?.observedAtIso,
    firstResult?.observedAt,
    firstResult?.time,
    firstResult?.timestamp,
    inverterData?.raw?.result?.[0]?.time,
    inverterData?.raw?.result?.[0]?.timestamp
  ];

  for (const candidate of candidates) {
    const parsed = parseTimestampMs(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function evaluateTelemetryHealth(options = {}) {
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const freshnessMaxAgeMs = Math.max(
    0,
    toFiniteNumber(options.freshnessMaxAgeMs, DEFAULT_FRESHNESS_MAX_AGE_MS)
  );
  const frozenMaxAgeMs = Math.max(
    0,
    toFiniteNumber(options.frozenMaxAgeMs, DEFAULT_FROZEN_MAX_AGE_MS)
  );
  const previousState = options.previousState && typeof options.previousState === 'object'
    ? options.previousState
    : {};

  const telemetryTimestampMs = extractTelemetryTimestampMs(options.inverterData);
  const hasTimestamp = Number.isFinite(telemetryTimestampMs);
  const telemetryAgeMs = hasTimestamp ? Math.max(0, nowMs - telemetryTimestampMs) : null;
  const staleDueToMissingTimestamp = !hasTimestamp;
  const staleDueToAge = hasTimestamp && telemetryAgeMs > freshnessMaxAgeMs;

  const fingerprint = buildTelemetryFingerprint(options.inverterData);
  const previousFingerprint = typeof previousState.telemetryFingerprint === 'string'
    ? previousState.telemetryFingerprint
    : null;
  const sameFingerprint = Boolean(fingerprint && previousFingerprint && fingerprint === previousFingerprint);
  const previousFingerprintSinceMs = toFiniteNumber(previousState.telemetryFingerprintSinceMs, NaN);
  const fingerprintSinceMs = fingerprint
    ? (sameFingerprint && Number.isFinite(previousFingerprintSinceMs)
      ? Math.min(previousFingerprintSinceMs, nowMs)
      : nowMs)
    : null;
  const fingerprintAgeMs = fingerprintSinceMs !== null ? Math.max(0, nowMs - fingerprintSinceMs) : null;

  const frozen = Boolean(fingerprint) &&
    hasTimestamp &&
    !staleDueToAge &&
    sameFingerprint &&
    Number.isFinite(fingerprintAgeMs) &&
    fingerprintAgeMs > frozenMaxAgeMs;

  const pauseReason = staleDueToMissingTimestamp
    ? 'stale_telemetry_missing_timestamp'
    : staleDueToAge
      ? 'stale_telemetry'
      : frozen
        ? 'frozen_telemetry'
        : null;

  const telemetryStatus = pauseReason ? 'paused' : 'healthy';

  return {
    telemetryStatus,
    pauseReason,
    shouldPauseAutomation: Boolean(pauseReason),
    telemetryTimestampMs: hasTimestamp ? telemetryTimestampMs : null,
    telemetryAgeMs: hasTimestamp ? telemetryAgeMs : null,
    freshnessMaxAgeMs,
    frozenMaxAgeMs,
    staleDueToMissingTimestamp,
    staleDueToAge,
    frozen,
    fingerprint,
    fingerprintSinceMs,
    fingerprintAgeMs,
    statePatch: {
      telemetryTimestampMs: hasTimestamp ? telemetryTimestampMs : null,
      telemetryAgeMs: hasTimestamp ? telemetryAgeMs : null,
      telemetryFreshnessMaxAgeMs: freshnessMaxAgeMs,
      telemetryFrozenMaxAgeMs: frozenMaxAgeMs,
      telemetryFingerprint: fingerprint || null,
      telemetryFingerprintSinceMs: fingerprintSinceMs,
      telemetryFailsafePaused: Boolean(pauseReason),
      telemetryFailsafePauseReason: pauseReason || null,
      telemetryHealthStatus: telemetryStatus,
      telemetryUpdatedAtMs: nowMs
    }
  };
}

module.exports = {
  DEFAULT_FRESHNESS_MAX_AGE_MS,
  DEFAULT_FROZEN_MAX_AGE_MS,
  buildTelemetryFingerprint,
  evaluateTelemetryHealth,
  extractTelemetryTimestampMs,
  getTelemetryDatas,
  parseFoxessCloudTimeToMs,
  parseTimestampMs
};
