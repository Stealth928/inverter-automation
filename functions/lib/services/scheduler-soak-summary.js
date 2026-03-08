'use strict';

const DEFAULT_MIN_DAYS_REQUIRED = 7;
const DEFAULT_MIN_HEALTHY_RATIO_PCT = 80;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSloStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'watch' || normalized === 'breach') {
    return normalized;
  }
  return 'unknown';
}

function toPercent(numerator, denominator) {
  const top = toFiniteNumber(numerator, 0);
  const bottom = toFiniteNumber(denominator, 0);
  if (bottom <= 0) {
    return 0;
  }
  return Number(((top / bottom) * 100).toFixed(2));
}

function countConsecutiveStatuses(dailyDesc, matchFn) {
  let count = 0;
  for (const day of dailyDesc) {
    const status = normalizeSloStatus(day && day.slo ? day.slo.status : null);
    if (!matchFn(status)) {
      break;
    }
    count += 1;
  }
  return count;
}

function buildSchedulerSoakSummary(options = {}) {
  const dailyDesc = Array.isArray(options.dailyDesc) ? options.dailyDesc : [];
  const daysRequested = Math.max(1, Math.floor(toFiniteNumber(options.daysRequested, dailyDesc.length || 1)));
  const minDaysRequired = Math.max(1, Math.floor(toFiniteNumber(
    options.minDaysRequired,
    DEFAULT_MIN_DAYS_REQUIRED
  )));
  const minHealthyRatioPct = Math.max(0, Math.min(100, toFiniteNumber(
    options.minHealthyRatioPct,
    DEFAULT_MIN_HEALTHY_RATIO_PCT
  )));

  const counts = {
    healthy: 0,
    watch: 0,
    breach: 0,
    unknown: 0
  };

  for (const day of dailyDesc) {
    const status = normalizeSloStatus(day && day.slo ? day.slo.status : null);
    counts[status] += 1;
  }

  const daysWithData = dailyDesc.length;
  const nonHealthyDays = counts.watch + counts.breach;
  const healthyDayRatioPct = toPercent(counts.healthy, daysWithData);
  const nonHealthyDayRatioPct = toPercent(nonHealthyDays, daysWithData);

  const latestDay = dailyDesc.length > 0 ? dailyDesc[0] : null;
  const latestStatus = latestDay ? normalizeSloStatus(latestDay && latestDay.slo ? latestDay.slo.status : null) : 'unknown';
  const latestDayKey = latestDay && latestDay.dayKey ? String(latestDay.dayKey) : null;

  const consecutiveHealthyDays = countConsecutiveStatuses(dailyDesc, (status) => status === 'healthy');
  const consecutiveNonHealthyDays = countConsecutiveStatuses(
    dailyDesc,
    (status) => status === 'watch' || status === 'breach'
  );

  let status = 'insufficient_data';
  if (daysWithData > 0) {
    if (counts.breach > 0 || latestStatus === 'breach') {
      status = 'breach';
    } else if (counts.watch > 0 || latestStatus === 'watch') {
      status = 'watch';
    } else if (counts.healthy > 0 && counts.unknown === 0) {
      status = 'healthy';
    } else if (counts.healthy > 0) {
      status = 'watch';
    } else {
      status = 'unknown';
    }
  }

  const readiness = {
    minDaysRequired,
    minHealthyRatioPct,
    hasMinimumDays: daysWithData >= minDaysRequired,
    hasNoBreachDays: counts.breach === 0,
    latestStatusIsHealthy: latestStatus === 'healthy',
    healthyRatioSatisfactory: healthyDayRatioPct >= minHealthyRatioPct
  };
  readiness.readyForCloseout = (
    readiness.hasMinimumDays &&
    readiness.hasNoBreachDays &&
    readiness.latestStatusIsHealthy &&
    readiness.healthyRatioSatisfactory
  );

  return {
    daysRequested,
    daysWithData,
    healthyDays: counts.healthy,
    watchDays: counts.watch,
    breachDays: counts.breach,
    unknownDays: counts.unknown,
    healthyDayRatioPct,
    nonHealthyDayRatioPct,
    latestDayKey,
    latestStatus,
    consecutiveHealthyDays,
    consecutiveNonHealthyDays,
    status,
    readiness
  };
}

module.exports = {
  buildSchedulerSoakSummary,
  normalizeSloStatus
};
