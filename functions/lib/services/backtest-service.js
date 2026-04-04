'use strict';

const crypto = require('crypto');
const {
  compareNumeric,
  evaluateTimeCondition,
  isForecastTemperatureType,
  normalizeWeekdays,
  parseTimeToMinutes
} = require('../automation-conditions');
const { evaluateBlackoutWindow } = require('./automation-cycle-rule-service');
const { getUserTime, isValidTimezone } = require('../time-utils');
const { resolveProviderDeviceId } = require('../provider-device-id');
const { getEffectiveInverterCapacityW } = require('./automation-rule-action-service');
const { normalizeTariffIntervals } = require('../adapters/tariff-provider');
const {
  appendHistoryTelemetryMappings,
  getConfiguredAcSolarPowerVariable
} = require('../telemetry-mappings');

const RUN_STATUSES = Object.freeze({
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed'
});

const DEFAULT_LIMITS = Object.freeze({
  replayIntervalMinutes: 5,
  maxLookbackDays: 90,
  maxScenarios: 3,
  maxActiveRuns: 2,
  maxSavedRuns: 5,
  maxRunsPerDay: 5,
  runTtlMs: 30 * 24 * 60 * 60 * 1000
});

const MAX_REPORT_CHART_POINTS = 96;

const HISTORY_SERIES_VARIABLES = Object.freeze([
  'generationPower',
  'pvPower',
  'loadsPower',
  'loadPower',
  'gridConsumptionPower',
  'feedinPower',
  'feedInPower',
  'batteryPower',
  'batChargePower',
  'batDischargePower',
  'SoC',
  'SoC1',
  'SoC_1'
]);

const FOXESS_HISTORY_FALLBACK_VARIABLES = Object.freeze([
  'generationPower',
  'pvPower',
  'meterPower',
  'meterPower2',
  'feedinPower',
  'gridConsumptionPower',
  'loadsPower'
]);

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function clampDateOnlyMax(dateOnly, maxDateOnly) {
  const normalized = normalizeDateOnly(dateOnly);
  const normalizedMax = normalizeDateOnly(maxDateOnly);
  if (!normalized) return null;
  if (!normalizedMax) return normalized;
  return normalized > normalizedMax ? normalizedMax : normalized;
}

function addDaysToDateOnly(dateOnly, days = 0) {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getUtcDateOnly(timestampMs = Date.now()) {
  const date = new Date(timestampMs);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function buildRequestHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  });
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function zonedDateTimeToUtcMs(timezone, options = {}) {
  const desired = Date.UTC(
    Number(options.year),
    Number(options.month) - 1,
    Number(options.day),
    Number(options.hour || 0),
    Number(options.minute || 0),
    Number(options.second || 0)
  );
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const parts = getZonedParts(new Date(guess), timezone);
    const observed = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0
    );
    const diff = desired - observed;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function parseLocalTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0)
  };
}

function parseTimestampInTimezone(value, timezone) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (value && typeof value === 'object') {
    const sec = toFiniteNumber(value._seconds ?? value.seconds, NaN);
    const nanos = toFiniteNumber(value._nanoseconds ?? value.nanoseconds ?? value.nanos, 0);
    if (Number.isFinite(sec)) return Math.round((sec * 1000) + (nanos / 1e6));
  }
  const text = String(value || '').trim();
  if (!text) return NaN;
  if (/[zZ]|[+-]\d{2}:\d{2}|[+-]\d{4}$/.test(text)) return Date.parse(text);
  const local = parseLocalTimestamp(text);
  return local ? zonedDateTimeToUtcMs(timezone, local) : Date.parse(text);
}

function localDateOnly(timezone, timestampMs) {
  const parts = getZonedParts(new Date(timestampMs), timezone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function buildReplayGrid(period = {}, timezone, intervalMinutes = 5) {
  const startDate = normalizeDateOnly(period.startDate);
  const endDate = normalizeDateOnly(period.endDate);
  if (!startDate || !endDate) throw new Error('Backtest period requires startDate and endDate');
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startMs = zonedDateTimeToUtcMs(timezone, { year: sy, month: sm, day: sd });
  const endExclusiveMs = zonedDateTimeToUtcMs(timezone, { year: ey, month: em, day: ed }) + (24 * 60 * 60 * 1000);
  const stepMs = Math.max(1, Math.round(intervalMinutes || 5)) * 60 * 1000;
  const gridMs = [];
  for (let cursor = startMs; cursor < endExclusiveMs; cursor += stepMs) gridMs.push(cursor);
  return { startMs, endExclusiveMs, stepMs, gridMs };
}

function validateBacktestPeriod(period = {}, options = {}) {
  const startDate = normalizeDateOnly(period.startDate);
  const endDate = normalizeDateOnly(period.endDate);
  if (!startDate || !endDate) throw new Error('Backtest period requires startDate and endDate');
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error('Backtest period is invalid');
  }

  const maxLookbackDays = Math.max(1, Math.round(toFiniteNumber(options.maxLookbackDays, DEFAULT_LIMITS.maxLookbackDays) || DEFAULT_LIMITS.maxLookbackDays));
  const maxRangeDays = Math.max(1, Math.round(toFiniteNumber(options.maxRangeDays, maxLookbackDays) || maxLookbackDays));
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const lookbackDays = Math.ceil((nowMs - startMs) / (24 * 60 * 60 * 1000));
  if (lookbackDays > maxLookbackDays) {
    throw new Error(`Backtests are limited to the last ${maxLookbackDays} days`);
  }

  const rangeDays = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  if (rangeDays > maxRangeDays) {
    throw new Error(`Backtest periods cannot exceed ${maxRangeDays} days`);
  }

  return { startDate, endDate, startMs, endMs, rangeDays };
}

function normalizeRuleSetSnapshot(snapshot = {}) {
  const sourceRules = snapshot.rules && typeof snapshot.rules === 'object' ? snapshot.rules : snapshot;
  const rules = {};
  Object.entries(sourceRules || {}).forEach(([ruleId, rule]) => {
    if (!rule || typeof rule !== 'object') return;
    rules[String(ruleId)] = JSON.parse(JSON.stringify({ ...rule, id: rule.id || ruleId }));
  });
  return {
    source: String(snapshot.source || 'custom'),
    name: String(snapshot.name || ''),
    rules
  };
}

function normalizeScenarioInput(scenario = {}, fallbackName = 'Scenario') {
  return {
    id: String(scenario.id || crypto.randomUUID()),
    name: String(scenario.name || fallbackName),
    ruleSetSnapshot: normalizeRuleSetSnapshot(scenario.ruleSetSnapshot || {}),
    tariff: scenario.tariff && typeof scenario.tariff === 'object'
      ? JSON.parse(JSON.stringify(scenario.tariff))
      : null
  };
}

function getUnsupportedRuleReasons(rule = {}) {
  const conditions = rule.conditions || {};
  const reasons = [];
  if (conditions.evVehicleSoC?.enabled || conditions.evVehicleLocation?.enabled || conditions.evChargingState?.enabled) {
    reasons.push('EV conditions are not supported in Stage 1 backtesting');
  }
  const temp = conditions.temp || conditions.temperature;
  const tempType = String(temp?.type || 'battery').trim().toLowerCase();
  if (temp?.enabled && !isForecastTemperatureType(tempType) && tempType === 'battery') {
    reasons.push('Battery temperature history is not supported in Stage 1 backtesting');
  }
  if (conditions.weather?.enabled) {
    reasons.push('Legacy weather conditions are not supported in Stage 1 backtesting');
  }
  return reasons;
}

function collectUnsupportedConditions(ruleSetSnapshot = {}) {
  const issues = [];
  Object.entries(ruleSetSnapshot.rules || {}).forEach(([ruleId, rule]) => {
    getUnsupportedRuleReasons(rule).forEach((reason) => {
      issues.push({
        ruleId,
        ruleName: String(rule?.name || ruleId),
        reason
      });
    });
  });
  return issues;
}

function normalizeTariffWindow(entry = {}) {
  const startTime = String(entry.startTime || entry.start || '').trim();
  const endTime = String(entry.endTime || entry.end || '').trim();
  const centsPerKwh = toFiniteNumber(entry.centsPerKwh ?? entry.rate ?? entry.value, null);
  const days = normalizeWeekdays(entry.days);
  if (!startTime || !endTime || !Number.isFinite(centsPerKwh)) return null;
  if (parseTimeToMinutes(startTime, null) === null || parseTimeToMinutes(endTime, null) === null) return null;
  return { startTime, endTime, centsPerKwh, days };
}

function normalizeTariffPlanModel(plan = {}, fallbackTimezone = 'Australia/Sydney') {
  const timezone = String(plan.timezone || fallbackTimezone).trim() || fallbackTimezone;
  return {
    id: String(plan.id || ''),
    name: String(plan.name || '').trim(),
    timezone: isValidTimezone(timezone) ? timezone : fallbackTimezone,
    dailySupplyCharge: Math.max(0, toFiniteNumber(plan.dailySupplyCharge, 0) || 0),
    importWindows: (Array.isArray(plan.importWindows) ? plan.importWindows : []).map(normalizeTariffWindow).filter(Boolean),
    exportWindows: (Array.isArray(plan.exportWindows) ? plan.exportWindows : []).map(normalizeTariffWindow).filter(Boolean)
  };
}

function sortedEnabledRules(ruleSetSnapshot = {}) {
  return Object.entries(ruleSetSnapshot.rules || {})
    .filter(([, rule]) => rule && rule.enabled !== false)
    .sort((left, right) => {
      const lp = toFiniteNumber(left[1]?.priority, 999) || 999;
      const rp = toFiniteNumber(right[1]?.priority, 999) || 999;
      if (lp !== rp) return lp - rp;
      return String(left[0]).localeCompare(String(right[0]));
    })
    .map(([ruleId, rule]) => ({ ruleId, rule }));
}

function getMaxForecastLookAheadMinutes(ruleSetSnapshot = {}) {
  let maxMinutes = 0;
  Object.values(ruleSetSnapshot.rules || {}).forEach((rule) => {
    if (!rule || rule.enabled === false) return;
    const forecast = rule?.conditions?.forecastPrice;
    if (!forecast?.enabled) return;
    const lookAhead = toFiniteNumber(forecast.lookAhead, 30) || 30;
    const unit = String(forecast.lookAheadUnit || 'minutes').trim().toLowerCase();
    const minutes = unit === 'days' ? lookAhead * 24 * 60 : unit === 'hours' ? lookAhead * 60 : lookAhead;
    maxMinutes = Math.max(maxMinutes, minutes);
  });
  return Math.max(0, Math.round(maxMinutes));
}

function getMaxWeatherLookAheadDays(ruleSetSnapshot = {}) {
  let maxDays = 1;
  Object.values(ruleSetSnapshot.rules || {}).forEach((rule) => {
    if (!rule || rule.enabled === false) return;
    const conditions = rule?.conditions || {};
    ['solarRadiation', 'cloudCover'].forEach((key) => {
      if (!conditions[key]?.enabled) return;
      const raw = toFiniteNumber(conditions[key].lookAhead, 6) || 6;
      const unit = String(conditions[key].lookAheadUnit || 'hours').trim().toLowerCase();
      maxDays = Math.max(maxDays, unit === 'days' ? raw : Math.ceil(raw / 24));
    });
    const temp = conditions.temp || conditions.temperature;
    if (temp?.enabled && isForecastTemperatureType(temp.type)) {
      maxDays = Math.max(maxDays, Math.max(0, Math.round(toFiniteNumber(temp.dayOffset, 0) || 0)) + 1);
    }
  });
  return Math.max(1, Math.round(maxDays));
}

function resampleSeriesToGrid(points = [], gridMs = [], options = {}) {
  const sorted = Array.isArray(points) ? points.slice().sort((left, right) => left.ms - right.ms) : [];
  const defaultValue = Object.prototype.hasOwnProperty.call(options, 'defaultValue') ? options.defaultValue : null;
  const maxGapMs = Number.isFinite(Number(options.maxGapMs)) ? Number(options.maxGapMs) : (30 * 60 * 1000);
  const values = [];
  let index = 0;
  let last = null;
  gridMs.forEach((timestampMs) => {
    while (index < sorted.length && sorted[index].ms <= timestampMs) {
      last = sorted[index];
      index += 1;
    }
    if (!last) {
      values.push(defaultValue);
      return;
    }
    if (maxGapMs >= 0 && (timestampMs - last.ms) > maxGapMs) {
      values.push(defaultValue);
      return;
    }
    values.push(last.value);
  });
  return values;
}

function buildHistoryQueryVariables(userConfig, baseVariables = []) {
  const variables = Array.isArray(baseVariables) ? baseVariables.slice() : [];
  const acSolarPowerVariable = getConfiguredAcSolarPowerVariable(userConfig);
  if (acSolarPowerVariable) variables.push(acSolarPowerVariable);
  return Array.from(new Set(variables.filter(Boolean)));
}

function getFirstAvailableSeries(series = {}, candidates = []) {
  for (const candidate of candidates) {
    if (Array.isArray(series[candidate]) && series[candidate].length > 0) return series[candidate];
  }
  return [];
}

function buildBatteryPowerSeries(series = {}, gridMs = []) {
  if (Array.isArray(series.batteryPower) && series.batteryPower.length > 0) {
    return resampleSeriesToGrid(series.batteryPower, gridMs, { defaultValue: 0 });
  }
  const chargeKw = resampleSeriesToGrid(series.batChargePower || [], gridMs, { defaultValue: 0 });
  const dischargeKw = resampleSeriesToGrid(series.batDischargePower || [], gridMs, { defaultValue: 0 });
  return gridMs.map((_, index) => (toFiniteNumber(dischargeKw[index], 0) || 0) - (toFiniteNumber(chargeKw[index], 0) || 0));
}

function summarizeHistorySeries(datas = [], gridMs, timezone) {
  const series = {};
  (Array.isArray(datas) ? datas : []).forEach((entry) => {
    const variable = String(entry?.variable || entry?.name || '').trim();
    if (!variable || !Array.isArray(entry?.data)) return;
    const unit = String(entry?.unit || '').trim().toLowerCase();
    const scale = unit === 'w' ? 0.001 : 1;
    const points = entry.data
      .map((row) => {
        const ms = parseTimestampInTimezone(row?.time || row?.timestamp, timezone);
        const value = toFiniteNumber(row?.value, null);
        if (!Number.isFinite(ms) || !Number.isFinite(value)) return null;
        return { ms: Math.round(ms), value: value * scale };
      })
      .filter(Boolean)
      .sort((left, right) => left.ms - right.ms);
    if (points.length > 0) series[variable] = points;
  });

  return {
    solarKw: resampleSeriesToGrid(getFirstAvailableSeries(series, ['solarPowerTotal', 'acSolarPower', 'pvPower', 'generationPower']), gridMs, { defaultValue: 0 }),
    loadsKw: resampleSeriesToGrid(getFirstAvailableSeries(series, ['loadsPower', 'loadPower']), gridMs, { defaultValue: null }),
    gridImportKw: resampleSeriesToGrid(getFirstAvailableSeries(series, ['gridConsumptionPower', 'meterPower', 'meterPower2']), gridMs, { defaultValue: 0 }),
    exportKw: resampleSeriesToGrid(getFirstAvailableSeries(series, ['feedinPower', 'feedInPower']), gridMs, { defaultValue: 0 }),
    batteryPowerKw: buildBatteryPowerSeries(series, gridMs),
    socPct: resampleSeriesToGrid(getFirstAvailableSeries(series, ['SoC', 'SoC1', 'SoC_1']), gridMs, { defaultValue: null, maxGapMs: 60 * 60 * 1000 })
  };
}

function deriveLoadSeries(inputSeries = {}) {
  return (inputSeries.solarKw || []).map((_, index) => {
    const explicit = toFiniteNumber(inputSeries.loadsKw?.[index], null);
    if (Number.isFinite(explicit)) return Math.max(0, explicit);
    const solar = toFiniteNumber(inputSeries.solarKw?.[index], 0) || 0;
    const gridImport = toFiniteNumber(inputSeries.gridImportKw?.[index], 0) || 0;
    const exportKw = toFiniteNumber(inputSeries.exportKw?.[index], 0) || 0;
    const batteryPower = toFiniteNumber(inputSeries.batteryPowerKw?.[index], 0) || 0;
    const discharge = Math.max(0, batteryPower);
    const charge = Math.max(0, -batteryPower);
    return Math.max(0, solar + gridImport + discharge - exportKw - charge);
  });
}

function reconstructSocSeries(options = {}) {
  const actualSoc = Array.isArray(options.actualSoc) ? options.actualSoc : [];
  const batteryPowerKw = Array.isArray(options.batteryPowerKw) ? options.batteryPowerKw : [];
  const batteryCapacityKWh = Math.max(1, toFiniteNumber(options.batteryCapacityKWh, 10) || 10);
  const stepHours = Math.max(0.001, toFiniteNumber(options.stepHours, 5 / 60) || (5 / 60));
  const soc = new Array(Math.max(actualSoc.length, batteryPowerKw.length)).fill(null);
  let anchor = actualSoc.findIndex((value) => Number.isFinite(toFiniteNumber(value, NaN)));
  let confidence = 'high';
  const limitations = [];

  if (anchor === -1) {
    anchor = 0;
    soc[0] = 50;
    confidence = 'low';
    limitations.push('Battery SoC history was unavailable; replay started from a reconstructed 50% baseline');
  } else {
    soc[anchor] = clamp(toFiniteNumber(actualSoc[anchor], 50) || 50, 0, 100);
    if (anchor > 0) {
      confidence = 'medium';
      limitations.push('Battery SoC before the first historical sample was reconstructed from battery power');
    }
  }

  for (let index = anchor - 1; index >= 0; index -= 1) {
    const nextSoc = toFiniteNumber(soc[index + 1], 50) || 50;
    const batteryPower = toFiniteNumber(batteryPowerKw[index], 0) || 0;
    soc[index] = clamp(nextSoc + ((batteryPower * stepHours / batteryCapacityKWh) * 100), 0, 100);
  }
  for (let index = anchor + 1; index < soc.length; index += 1) {
    if (Number.isFinite(toFiniteNumber(actualSoc[index], NaN))) {
      soc[index] = clamp(toFiniteNumber(actualSoc[index], 50) || 50, 0, 100);
      continue;
    }
    const previousSoc = toFiniteNumber(soc[index - 1], 50) || 50;
    const previousBatteryPower = toFiniteNumber(batteryPowerKw[index - 1], 0) || 0;
    soc[index] = clamp(previousSoc - ((previousBatteryPower * stepHours / batteryCapacityKWh) * 100), 0, 100);
  }
  return { soc, confidence, limitations };
}

function buildManualTariffLookup(plan = {}) {
  const normalizedPlan = normalizeTariffPlanModel(plan);
  function matchRate(windows = [], userTime) {
    const currentMinutes = (userTime.hour * 60) + userTime.minute;
    for (const window of windows) {
      const startMinutes = parseTimeToMinutes(window.startTime, null);
      const endMinutes = parseTimeToMinutes(window.endTime, null);
      if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) continue;
      if (window.days.length > 0 && !window.days.includes(userTime.dayOfWeek)) continue;
      const inWindow = startMinutes <= endMinutes
        ? (currentMinutes >= startMinutes && currentMinutes < endMinutes)
        : (currentMinutes >= startMinutes || currentMinutes < endMinutes);
      if (inWindow) return window.centsPerKwh;
    }
    return null;
  }
  return {
    type: 'manual',
    dailySupplyCharge: normalizedPlan.dailySupplyCharge,
    lookup(timestampMs) {
      const userTime = getUserTime(normalizedPlan.timezone, { now: new Date(timestampMs) });
      return {
        buyCentsPerKwh: matchRate(normalizedPlan.importWindows, userTime),
        feedInCentsPerKwh: matchRate(normalizedPlan.exportWindows, userTime)
      };
    },
    window() {
      return [];
    }
  };
}

function buildIntervalTariffLookup(intervals = [], options = {}) {
  const normalized = normalizeTariffIntervals(intervals)
    .map((interval) => ({
      ...interval,
      startMs: Date.parse(interval.startIso),
      endMs: Date.parse(interval.endIso)
    }))
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  return {
    type: 'provider',
    dailySupplyCharge: Math.max(0, toFiniteNumber(options.dailySupplyCharge, 0) || 0),
    lookup(timestampMs) {
      const match = normalized.find((interval) => timestampMs >= interval.startMs && timestampMs < interval.endMs) || null;
      return {
        buyCentsPerKwh: match ? match.buyCentsPerKwh : null,
        feedInCentsPerKwh: match ? match.feedInCentsPerKwh : null
      };
    },
    window(startMs, endMs, type = 'general') {
      return normalized.filter((interval) => {
        if (interval.endMs <= startMs || interval.startMs >= endMs) return false;
        return type === 'feedIn' ? Number.isFinite(interval.feedInCentsPerKwh) : Number.isFinite(interval.buyCentsPerKwh);
      });
    }
  };
}

function buildWeatherIndices(weather = {}, timezone, gridMs = []) {
  const hourly = weather?.result?.hourly || weather?.hourly || {};
  const daily = weather?.result?.daily || weather?.daily || {};
  const hourlyIndex = (Array.isArray(hourly.time) ? hourly.time : []).map((time, index) => ({
    ms: parseTimestampInTimezone(time, timezone),
    solarRadiation: toFiniteNumber(hourly.shortwave_radiation?.[index], null),
    cloudCover: toFiniteNumber(hourly.cloudcover?.[index], null),
    ambientTemperatureC: toFiniteNumber(hourly.temperature_2m?.[index], null)
  })).filter((entry) => Number.isFinite(entry.ms));
  const dailyMap = new Map();
  (Array.isArray(daily.time) ? daily.time : []).forEach((dateOnly, index) => {
    if (!normalizeDateOnly(dateOnly)) return;
    dailyMap.set(dateOnly, {
      max: toFiniteNumber(daily.temperature_2m_max?.[index], null),
      min: toFiniteNumber(daily.temperature_2m_min?.[index], null)
    });
  });
  const ambientTemperatureSeries = Array.isArray(gridMs) && gridMs.length > 0
    ? resampleSeriesToGrid(
      hourlyIndex
        .filter((entry) => Number.isFinite(entry.ambientTemperatureC))
        .map((entry) => ({ ms: entry.ms, value: entry.ambientTemperatureC })),
      gridMs,
      { defaultValue: null, maxGapMs: 90 * 60 * 1000 }
    )
    : [];
  return { hourlyIndex, dailyMap, ambientTemperatureSeries };
}

function sliceHourlyWeather(hourlyIndex = [], startMs, lookAheadHours) {
  const endMs = startMs + (lookAheadHours * 60 * 60 * 1000);
  return hourlyIndex.filter((entry) => entry.ms >= startMs && entry.ms < endMs);
}

function evaluateBacktestRule(options = {}) {
  const rule = options.rule || {};
  const conditions = rule.conditions || {};
  const timezone = options.timezone || 'Australia/Sydney';
  const userTime = options.userTime || getUserTime(timezone, { now: new Date(options.timestampMs) });
  const currentMinutes = (userTime.hour * 60) + userTime.minute;
  const results = [];

  if (conditions.price?.enabled) {
    const priceType = String(conditions.price.type || 'feedIn').trim().toLowerCase();
    const actual = priceType === 'buy' || priceType === 'general' ? options.buyCentsPerKwh : options.feedInCentsPerKwh;
    results.push({
      condition: 'price',
      met: compareNumeric(actual, conditions.price.op || conditions.price.operator || '>=', toFiniteNumber(conditions.price.value, 0), toFiniteNumber(conditions.price.value2, null))
    });
  }
  if (conditions.feedInPrice?.enabled) {
    results.push({
      condition: 'feedInPrice',
      met: compareNumeric(options.feedInCentsPerKwh, conditions.feedInPrice.op || conditions.feedInPrice.operator || '>=', toFiniteNumber(conditions.feedInPrice.value, 0), toFiniteNumber(conditions.feedInPrice.value2, null))
    });
  }
  if (conditions.buyPrice?.enabled) {
    results.push({
      condition: 'buyPrice',
      met: compareNumeric(options.buyCentsPerKwh, conditions.buyPrice.op || conditions.buyPrice.operator || '>=', toFiniteNumber(conditions.buyPrice.value, 0), toFiniteNumber(conditions.buyPrice.value2, null))
    });
  }
  if (conditions.soc?.enabled) {
    results.push({
      condition: 'soc',
      met: compareNumeric(options.socPct, conditions.soc.op || conditions.soc.operator || '>=', toFiniteNumber(conditions.soc.value, 0), toFiniteNumber(conditions.soc.value2, null))
    });
  }
  const timeCondition = conditions.time || conditions.timeWindow;
  if (timeCondition?.enabled) {
    results.push({
      condition: 'time',
      met: evaluateTimeCondition(timeCondition, { timezone, userTime, currentMinutes, dayOfWeek: userTime.dayOfWeek }).met
    });
  }
  ['solarRadiation', 'cloudCover'].forEach((key) => {
    if (!conditions[key]?.enabled) return;
    const rawLookAhead = toFiniteNumber(conditions[key].lookAhead, 6) || 6;
    const lookAheadUnit = String(conditions[key].lookAheadUnit || 'hours').trim().toLowerCase();
    const lookAheadHours = lookAheadUnit === 'days' ? rawLookAhead * 24 : rawLookAhead;
    const values = sliceHourlyWeather(options.weatherIndices.hourlyIndex, options.timestampMs, lookAheadHours)
      .map((entry) => key === 'solarRadiation' ? entry.solarRadiation : entry.cloudCover)
      .filter((value) => Number.isFinite(value));
    const checkType = conditions[key].checkType || conditions[key].check || 'average';
    const actualValue = values.length === 0
      ? null
      : checkType === 'min'
        ? Math.min(...values)
        : checkType === 'max'
          ? Math.max(...values)
          : (values.reduce((sum, value) => sum + value, 0) / values.length);
    results.push({
      condition: key,
      met: compareNumeric(actualValue, conditions[key].operator || (key === 'cloudCover' ? '<=' : '>='), toFiniteNumber(conditions[key].value, 0), toFiniteNumber(conditions[key].value2, null))
    });
  });
  const temp = conditions.temp || conditions.temperature;
  if (temp?.enabled) {
    const tempType = String(temp.type || 'battery').trim().toLowerCase();
    if (isForecastTemperatureType(tempType)) {
      const metric = tempType.includes('min') ? 'min' : 'max';
      const forecastDateOnly = addDaysToDateOnly(localDateOnly(timezone, options.timestampMs), Math.max(0, Math.round(toFiniteNumber(temp.dayOffset, 0) || 0)));
      const weatherDay = forecastDateOnly ? options.weatherIndices.dailyMap.get(forecastDateOnly) : null;
      results.push({
        condition: 'temperature',
        met: compareNumeric(weatherDay ? weatherDay[metric] : null, temp.op || temp.operator || '>=', toFiniteNumber(temp.value, 0), toFiniteNumber(temp.value2, null))
      });
    } else if (tempType !== 'battery') {
      results.push({
        condition: 'temperature',
        met: compareNumeric(options.ambientTempC, temp.op || temp.operator || '>=', toFiniteNumber(temp.value, 0), toFiniteNumber(temp.value2, null))
      });
    }
  }
  if (conditions.forecastPrice?.enabled) {
    const unit = String(conditions.forecastPrice.lookAheadUnit || 'minutes').trim().toLowerCase();
    const rawLookAhead = toFiniteNumber(conditions.forecastPrice.lookAhead, 30) || 30;
    const lookAheadMinutes = unit === 'days' ? rawLookAhead * 24 * 60 : unit === 'hours' ? rawLookAhead * 60 : rawLookAhead;
    const endMs = options.timestampMs + (lookAheadMinutes * 60 * 1000);
    const type = String(conditions.forecastPrice.type || 'general').trim().toLowerCase();
    const values = options.tariffLookup.window(options.timestampMs, endMs, type === 'feedin' ? 'feedIn' : 'general')
      .map((interval) => type === 'feedin' ? interval.feedInCentsPerKwh : interval.buyCentsPerKwh)
      .filter((value) => Number.isFinite(value));
    const checkType = conditions.forecastPrice.checkType || conditions.forecastPrice.check || 'average';
    const actualValue = values.length === 0
      ? null
      : checkType === 'min'
        ? Math.min(...values)
        : checkType === 'max'
          ? Math.max(...values)
          : checkType === 'any'
            ? values.find((value) => compareNumeric(value, conditions.forecastPrice.operator || '>=', toFiniteNumber(conditions.forecastPrice.value, 0), toFiniteNumber(conditions.forecastPrice.value2, null)))
            : (values.reduce((sum, value) => sum + value, 0) / values.length);
    results.push({
      condition: 'forecastPrice',
      met: checkType === 'any'
        ? actualValue !== undefined
        : compareNumeric(actualValue, conditions.forecastPrice.operator || '>=', toFiniteNumber(conditions.forecastPrice.value, 0), toFiniteNumber(conditions.forecastPrice.value2, null))
    });
  }
  return {
    matched: results.length > 0 && results.every((entry) => entry.met),
    results
  };
}

function simulateRuleSet(options = {}) {
  const scenario = options.scenario || {};
  const rules = sortedEnabledRules(scenario.ruleSetSnapshot);
  const timezone = options.timezone || 'Australia/Sydney';
  const stepHours = options.stepMs / (60 * 60 * 1000);
  const batteryCapacityKWh = Math.max(1, toFiniteNumber(options.userConfig?.batteryCapacityKWh, 10) || 10);
  const inverterCapacityW = getEffectiveInverterCapacityW(options.userConfig || {});
  const baselineReservePct = clamp(toFiniteNumber(options.userConfig?.defaults?.minSocOnGrid ?? options.userConfig?.minSocOnGrid, 20) || 20, 0, 100);
  const blackoutWindows = Array.isArray(options.userConfig?.automation?.blackoutWindows) ? options.userConfig.automation.blackoutWindows : [];
  let socPct = clamp(toFiniteNumber(options.initialSocPct, 50) || 50, 0, 100);
  let activeRuleId = null;
  let activePriority = 999;
  let activeUntilMs = 0;
  const lastTriggered = new Map();
  const triggerCounts = new Map();
  const activeIntervals = new Map();
  const intervalOutcomes = [];
  let totalImportKWh = 0;
  let totalExportKWh = 0;
  let totalImportCostAud = 0;
  let totalExportRevenueAud = 0;
  let totalThroughputKWh = 0;
  let totalSupplyChargeAud = 0;
  let currentDateKey = null;

  for (let index = 0; index < options.gridMs.length; index += 1) {
    const timestampMs = options.gridMs[index];
    const userTime = getUserTime(timezone, { now: new Date(timestampMs) });
    const dateKey = localDateOnly(timezone, timestampMs);
    if (dateKey !== currentDateKey) {
      currentDateKey = dateKey;
      totalSupplyChargeAud += (toFiniteNumber(options.tariffLookup.dailySupplyCharge, 0) || 0) / 100;
    }
    const solarKw = Math.max(0, toFiniteNumber(options.inputSeries.solarKw[index], 0) || 0);
    const loadKw = Math.max(0, toFiniteNumber(options.inputSeries.loadKw[index], 0) || 0);
    const ambientTempC = toFiniteNumber(options.weatherIndices?.ambientTemperatureSeries?.[index], null);
    const tariffSnapshot = options.tariffLookup.lookup(timestampMs);
    const buyCentsPerKwh = toFiniteNumber(tariffSnapshot.buyCentsPerKwh, 0) || 0;
    const feedInCentsPerKwh = toFiniteNumber(tariffSnapshot.feedInCentsPerKwh, 0) || 0;
    const blackout = evaluateBlackoutWindow(blackoutWindows, (userTime.hour * 60) + userTime.minute);

    let chosenRuleId = null;
    let chosenRule = null;
    let chosenAction = null;
    const activeEntry = activeRuleId ? rules.find((entry) => entry.ruleId === activeRuleId) || null : null;
    const activeStillValid = activeEntry && timestampMs < activeUntilMs && !blackout.inBlackout && evaluateBacktestRule({
      rule: activeEntry.rule,
      timestampMs,
      timezone,
      userTime,
      buyCentsPerKwh,
      feedInCentsPerKwh,
      ambientTempC,
      socPct,
      weatherIndices: options.weatherIndices,
      tariffLookup: options.tariffLookup
    }).matched;

    for (const entry of rules) {
      const priority = toFiniteNumber(entry.rule.priority, 999) || 999;
      if (activeStillValid && priority > activePriority) continue;
      if (blackout.inBlackout) break;
      const matches = evaluateBacktestRule({
        rule: entry.rule,
        timestampMs,
        timezone,
        userTime,
        buyCentsPerKwh,
        feedInCentsPerKwh,
        ambientTempC,
        socPct,
        weatherIndices: options.weatherIndices,
        tariffLookup: options.tariffLookup
      }).matched;
      if (!matches) continue;
      if (entry.ruleId === activeRuleId && activeStillValid) {
        chosenRuleId = entry.ruleId;
        chosenRule = entry.rule;
        chosenAction = entry.rule.action || {};
        break;
      }
      const cooldownMs = Math.max(1, Math.round(toFiniteNumber(entry.rule.cooldownMinutes, 5) || 5)) * 60 * 1000;
      const lastTriggeredMs = lastTriggered.get(entry.ruleId) || 0;
      const canTrigger = !lastTriggeredMs || ((timestampMs - lastTriggeredMs) >= cooldownMs);
      if ((activeStillValid && priority < activePriority) || (!activeStillValid && canTrigger)) {
        chosenRuleId = entry.ruleId;
        chosenRule = entry.rule;
        chosenAction = entry.rule.action || {};
        lastTriggered.set(entry.ruleId, timestampMs);
        triggerCounts.set(entry.ruleId, (triggerCounts.get(entry.ruleId) || 0) + 1);
        activeRuleId = entry.ruleId;
        activePriority = priority;
        activeUntilMs = timestampMs + (Math.max(5, Math.round(toFiniteNumber(chosenAction.durationMinutes, 30) || 30)) * 60 * 1000);
        break;
      }
    }

    if (!chosenRuleId && !activeStillValid) {
      activeRuleId = null;
      activePriority = 999;
      activeUntilMs = 0;
    }
    if (chosenRuleId) activeIntervals.set(chosenRuleId, (activeIntervals.get(chosenRuleId) || 0) + 1);

    const reservePct = clamp(toFiniteNumber(chosenAction?.minSocOnGrid, baselineReservePct) || baselineReservePct, 0, 100);
    const dischargeFloorPct = clamp(toFiniteNumber(chosenAction?.fdSoc, reservePct) || reservePct, reservePct, 100);
    const chargeTargetPct = clamp(toFiniteNumber(chosenAction?.maxSoc ?? chosenAction?.fdSoc, 100) || 100, 0, 100);
    const commandKw = Math.max(0, toFiniteNumber(chosenAction?.fdPwr, inverterCapacityW) || inverterCapacityW) / 1000;
    const maxChargeKw = Math.min(inverterCapacityW / 1000, Math.max(0, ((chargeTargetPct - socPct) / 100) * batteryCapacityKWh / stepHours), commandKw || (inverterCapacityW / 1000));
    const maxDischargeKw = Math.min(inverterCapacityW / 1000, Math.max(0, ((socPct - dischargeFloorPct) / 100) * batteryCapacityKWh / stepHours), commandKw || (inverterCapacityW / 1000));

    let batteryChargeKw = 0;
    let batteryDischargeKw = 0;
    let gridImportKw = 0;
    let exportKw = 0;

    if (chosenAction?.workMode === 'ForceCharge') {
      const solarExcessKw = Math.max(0, solarKw - loadKw);
      const solarToBatteryKw = Math.min(maxChargeKw, solarExcessKw);
      const gridToBatteryKw = Math.max(0, maxChargeKw - solarToBatteryKw);
      batteryChargeKw = solarToBatteryKw + gridToBatteryKw;
      gridImportKw = Math.max(0, loadKw - solarKw) + gridToBatteryKw;
      exportKw = Math.max(0, solarKw - loadKw - solarToBatteryKw);
    } else if (chosenAction?.workMode === 'ForceDischarge' || chosenAction?.workMode === 'Feedin') {
      batteryDischargeKw = maxDischargeKw;
      const loadDeficitKw = Math.max(0, loadKw - solarKw);
      gridImportKw = Math.max(0, loadDeficitKw - batteryDischargeKw);
      exportKw = Math.max(0, solarKw - loadKw) + Math.max(0, batteryDischargeKw - loadDeficitKw);
    } else {
      const solarToLoadKw = Math.min(loadKw, solarKw);
      const solarExcessKw = Math.max(0, solarKw - solarToLoadKw);
      const loadDeficitKw = Math.max(0, loadKw - solarToLoadKw);
      batteryChargeKw = Math.min(maxChargeKw, solarExcessKw);
      batteryDischargeKw = Math.min(maxDischargeKw, loadDeficitKw);
      gridImportKw = Math.max(0, loadDeficitKw - batteryDischargeKw);
      exportKw = Math.max(0, solarExcessKw - batteryChargeKw);
    }

    const chargeKWh = batteryChargeKw * stepHours;
    const dischargeKWh = batteryDischargeKw * stepHours;
    socPct = clamp(socPct + (((chargeKWh - dischargeKWh) / batteryCapacityKWh) * 100), 0, 100);

    const importKWh = gridImportKw * stepHours;
    const exportKWh = exportKw * stepHours;
    const importCostAud = importKWh * (buyCentsPerKwh / 100);
    const exportRevenueAud = exportKWh * (feedInCentsPerKwh / 100);
    totalImportKWh += importKWh;
    totalExportKWh += exportKWh;
    totalImportCostAud += importCostAud;
    totalExportRevenueAud += exportRevenueAud;
    totalThroughputKWh += chargeKWh + dischargeKWh;
    intervalOutcomes.push({
      timestampMs,
      netAud: importCostAud - exportRevenueAud,
      importKWh,
      exportKWh,
      solarKw,
      loadKw,
      gridImportKw,
      exportKw,
      buyCentsPerKwh,
      feedInCentsPerKwh,
      chosenRuleId,
      chosenRuleName: chosenRule?.name || null
    });
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    totalBillAud: totalImportCostAud - totalExportRevenueAud + totalSupplyChargeAud,
    totalImportCostAud,
    totalExportRevenueAud,
    totalSupplyChargeAud,
    stepMinutes: Math.max(1, Math.round(stepHours * 60)),
    importKWh: totalImportKWh,
    exportKWh: totalExportKWh,
    throughputKWh: totalThroughputKWh,
    equivalentCycles: totalThroughputKWh / (batteryCapacityKWh * 2),
    triggerCount: Array.from(triggerCounts.values()).reduce((sum, value) => sum + value, 0),
    winningRuleMix: Array.from(triggerCounts.entries()).map(([ruleId, count]) => ({
      ruleId,
      ruleName: scenario.ruleSetSnapshot.rules?.[ruleId]?.name || ruleId,
      triggerCount: count,
      activeIntervals: activeIntervals.get(ruleId) || 0
    })).sort((left, right) => right.triggerCount - left.triggerCount),
    intervalOutcomes
  };
}

function buildIntervalImpact(baseline = {}, scenario = {}) {
  const baselineByTime = new Map((baseline.intervalOutcomes || []).map((entry) => [entry.timestampMs, entry]));
  const impact = { helped: 0, hurt: 0, neutral: 0, total: 0, highlights: [] };
  (scenario.intervalOutcomes || []).forEach((entry) => {
    const baselineEntry = baselineByTime.get(entry.timestampMs);
    if (!baselineEntry) return;
    impact.total += 1;
    const deltaAud = baselineEntry.netAud - entry.netAud;
    if (deltaAud > 0.001) impact.helped += 1;
    else if (deltaAud < -0.001) impact.hurt += 1;
    else impact.neutral += 1;
    impact.highlights.push({
      timestampMs: entry.timestampMs,
      deltaAud,
      ruleName: entry.chosenRuleName || null
    });
  });
  impact.highlights = impact.highlights
    .sort((left, right) => Math.abs(right.deltaAud) - Math.abs(left.deltaAud))
    .slice(0, 12);
  return impact;
}

function averageBucketMetric(entries = [], readValue) {
  if (!entries.length || typeof readValue !== 'function') return 0;
  let sum = 0;
  let count = 0;
  entries.forEach((entry) => {
    const value = toFiniteNumber(readValue(entry), null);
    if (!Number.isFinite(value)) return;
    sum += value;
    count += 1;
  });
  return count > 0 ? (sum / count) : 0;
}

function buildPowerPriceChart(result = {}) {
  const intervals = Array.isArray(result.intervalOutcomes) ? result.intervalOutcomes : [];
  if (!intervals.length) return null;
  const stepMinutes = Math.max(1, Math.round(toFiniteNumber(result.stepMinutes, 5) || 5));
  const bucketSize = Math.max(1, Math.ceil(intervals.length / MAX_REPORT_CHART_POINTS));
  const points = [];

  for (let index = 0; index < intervals.length; index += bucketSize) {
    const bucket = intervals.slice(index, Math.min(intervals.length, index + bucketSize));
    const middle = bucket[Math.floor((bucket.length - 1) / 2)] || bucket[0];
    points.push({
      timestampMs: Math.round(toFiniteNumber(middle?.timestampMs, 0) || 0),
      solarKw: Number(averageBucketMetric(bucket, (entry) => entry.solarKw).toFixed(3)),
      loadKw: Number(averageBucketMetric(bucket, (entry) => entry.loadKw).toFixed(3)),
      importKw: Number(averageBucketMetric(bucket, (entry) => entry.gridImportKw).toFixed(3)),
      exportKw: Number(averageBucketMetric(bucket, (entry) => entry.exportKw).toFixed(3)),
      buyCentsPerKwh: Number(averageBucketMetric(bucket, (entry) => entry.buyCentsPerKwh).toFixed(2)),
      feedInCentsPerKwh: Number(averageBucketMetric(bucket, (entry) => entry.feedInCentsPerKwh).toFixed(2))
    });
  }

  return {
    stepMinutes,
    bucketMinutes: bucketSize * stepMinutes,
    sourceIntervalCount: intervals.length,
    points
  };
}

function buildScenarioSummary(result = {}, baselineResult = null) {
  const summary = {
    scenarioId: result.scenarioId,
    scenarioName: result.scenarioName,
    totalBillAud: Number(result.totalBillAud.toFixed(2)),
    totalImportCostAud: Number(result.totalImportCostAud.toFixed(2)),
    totalExportRevenueAud: Number(result.totalExportRevenueAud.toFixed(2)),
    totalSupplyChargeAud: Number(result.totalSupplyChargeAud.toFixed(2)),
    importKWh: Number(result.importKWh.toFixed(3)),
    exportKWh: Number(result.exportKWh.toFixed(3)),
    throughputKWh: Number(result.throughputKWh.toFixed(3)),
    equivalentCycles: Number(result.equivalentCycles.toFixed(3)),
    triggerCount: result.triggerCount,
    winningRuleMix: result.winningRuleMix
  };
  if (result.scenarioId !== 'baseline') {
    summary.chart = buildPowerPriceChart(result);
  }
  if (baselineResult) {
    summary.deltaVsBaseline = {
      billAud: Number((baselineResult.totalBillAud - result.totalBillAud).toFixed(2)),
      importKWh: Number((baselineResult.importKWh - result.importKWh).toFixed(3)),
      exportKWh: Number((result.exportKWh - baselineResult.exportKWh).toFixed(3)),
      throughputKWh: Number((result.throughputKWh - baselineResult.throughputKWh).toFixed(3)),
      equivalentCycles: Number((result.equivalentCycles - baselineResult.equivalentCycles).toFixed(3))
    };
    summary.intervalImpact = buildIntervalImpact(baselineResult, result);
  }
  return summary;
}

function buildRunListSummary(summary = {}) {
  if (!summary || typeof summary !== 'object') return null;
  const entry = {
    scenarioId: summary.scenarioId,
    scenarioName: summary.scenarioName,
    totalBillAud: toFiniteNumber(summary.totalBillAud, null),
    deltaVsBaseline: summary.deltaVsBaseline && typeof summary.deltaVsBaseline === 'object'
      ? { billAud: toFiniteNumber(summary.deltaVsBaseline.billAud, null) }
      : undefined
  };
  return entry;
}

function buildRunListEntry(run = {}, id = '') {
  const summaries = Array.isArray(run?.result?.summaries)
    ? run.result.summaries.map(buildRunListSummary).filter(Boolean)
    : [];
  const result = summaries.length > 0 ? { summaries } : undefined;
  return {
    id,
    type: run.type,
    status: run.status,
    requestedAtMs: run.requestedAtMs,
    startedAtMs: run.startedAtMs,
    completedAtMs: run.completedAtMs,
    expiresAtMs: run.expiresAtMs,
    request: run.request,
    error: run.error,
    result
  };
}

function buildPairwiseComparisons(results = []) {
  const safeResults = Array.isArray(results) ? results : [];
  const comparisons = [];
  for (let leftIndex = 0; leftIndex < safeResults.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < safeResults.length; rightIndex += 1) {
      const left = safeResults[leftIndex];
      const right = safeResults[rightIndex];
      comparisons.push({
        leftScenarioId: left.scenarioId,
        leftScenarioName: left.scenarioName,
        rightScenarioId: right.scenarioId,
        rightScenarioName: right.scenarioName,
        billDeltaAud: Number((right.totalBillAud - left.totalBillAud).toFixed(2)),
        importDeltaKWh: Number((right.importKWh - left.importKWh).toFixed(3)),
        exportDeltaKWh: Number((right.exportKWh - left.exportKWh).toFixed(3)),
        throughputDeltaKWh: Number((right.throughputKWh - left.throughputKWh).toFixed(3))
      });
    }
  }
  return comparisons;
}

function summarizeConfidence(levels = []) {
  const rank = { low: 0, medium: 1, high: 2 };
  let current = 'high';
  levels.forEach((level) => {
    if (rank[level] < rank[current]) current = level;
  });
  return current;
}

function resolveTimezoneOrFallback(timezone, fallbackTimezone = 'Australia/Sydney') {
  const candidate = String(timezone || '').trim();
  if (candidate && isValidTimezone(candidate)) return candidate;
  return fallbackTimezone;
}

function createBacktestService(deps = {}) {
  const adapterRegistry = deps.adapterRegistry;
  const db = deps.db;
  const foxessAPI = deps.foxessAPI;
  const getConfig = deps.getConfig;
  const getHistoricalWeather = deps.getHistoricalWeather;
  const getUserConfig = deps.getUserConfig;
  const getUserRules = deps.getUserRules;

  if (!db || typeof db.collection !== 'function') throw new Error('createBacktestService requires db');
  if (!adapterRegistry || typeof adapterRegistry.getTariffProvider !== 'function' || typeof adapterRegistry.getDeviceProvider !== 'function') throw new Error('createBacktestService requires adapterRegistry');
  if (!foxessAPI || typeof foxessAPI.callFoxESSAPI !== 'function') throw new Error('createBacktestService requires foxessAPI');
  if (typeof getConfig !== 'function') throw new Error('createBacktestService requires getConfig()');
  if (typeof getHistoricalWeather !== 'function') throw new Error('createBacktestService requires getHistoricalWeather()');
  if (typeof getUserConfig !== 'function') throw new Error('createBacktestService requires getUserConfig()');
  if (typeof getUserRules !== 'function') throw new Error('createBacktestService requires getUserRules()');

  function getLimits() {
    const runtime = getConfig()?.automation?.backtesting || {};
    return {
      replayIntervalMinutes: Math.max(1, Math.round(toFiniteNumber(runtime.replayIntervalMinutes, DEFAULT_LIMITS.replayIntervalMinutes) || DEFAULT_LIMITS.replayIntervalMinutes)),
      maxLookbackDays: Math.max(1, Math.round(toFiniteNumber(runtime.maxLookbackDays, DEFAULT_LIMITS.maxLookbackDays) || DEFAULT_LIMITS.maxLookbackDays)),
      maxScenarios: Math.max(1, Math.round(toFiniteNumber(runtime.maxScenarios, DEFAULT_LIMITS.maxScenarios) || DEFAULT_LIMITS.maxScenarios)),
      maxActiveRuns: Math.max(1, Math.round(toFiniteNumber(runtime.maxActiveRuns, DEFAULT_LIMITS.maxActiveRuns) || DEFAULT_LIMITS.maxActiveRuns)),
      maxSavedRuns: Math.max(1, Math.round(toFiniteNumber(runtime.maxSavedRuns, DEFAULT_LIMITS.maxSavedRuns) || DEFAULT_LIMITS.maxSavedRuns)),
      maxRunsPerDay: Math.max(1, Math.round(toFiniteNumber(runtime.maxRunsPerDay, DEFAULT_LIMITS.maxRunsPerDay) || DEFAULT_LIMITS.maxRunsPerDay)),
      runTtlMs: Math.max(60 * 60 * 1000, Math.round(toFiniteNumber(runtime.runTtlMs, DEFAULT_LIMITS.runTtlMs) || DEFAULT_LIMITS.runTtlMs))
    };
  }

  const runsCollection = (userId) => db.collection('users').doc(userId).collection('backtests').doc('runs').collection('items');
  const tariffPlansCollection = (userId) => db.collection('users').doc(userId).collection('backtests').doc('tariffPlans').collection('items');
  const dailyUsageCollection = (userId) => db.collection('users').doc(userId).collection('backtests').doc('usage').collection('daily');

  async function listRuns(userId, limit = 20) {
    const snapshot = await runsCollection(userId).orderBy('requestedAtMs', 'desc').limit(Math.max(1, Math.min(50, Math.round(toFiniteNumber(limit, 20) || 20)))).get();
    return snapshot.docs.map((doc) => buildRunListEntry(doc.data() || {}, doc.id));
  }

  async function getRun(userId, runId) {
    const snapshot = await runsCollection(userId).doc(runId).get();
    return snapshot.exists ? { id: snapshot.id, ...(snapshot.data() || {}) } : null;
  }

  function getLocalDayWindow(timezone, timestampMs) {
    const dateKey = localDateOnly(timezone, timestampMs);
    const nextDateKey = addDaysToDateOnly(dateKey, 1);
    const [year, month, day] = dateKey.split('-').map(Number);
    const [nextYear, nextMonth, nextDay] = nextDateKey.split('-').map(Number);
    return {
      dateKey,
      startMs: zonedDateTimeToUtcMs(timezone, { year, month, day }),
      endExclusiveMs: zonedDateTimeToUtcMs(timezone, { year: nextYear, month: nextMonth, day: nextDay })
    };
  }

  async function listTariffPlans(userId) {
    const snapshot = await tariffPlansCollection(userId).orderBy('name', 'asc').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  }

  async function createTariffPlan(userId, payload = {}) {
    const userConfig = await getUserConfig(userId);
    const normalized = normalizeTariffPlanModel(payload, userConfig?.timezone || 'Australia/Sydney');
    if (!normalized.name) throw new Error('Tariff plan name is required');
    if (normalized.importWindows.length === 0) throw new Error('Tariff plan requires at least one import window');
    const docRef = tariffPlansCollection(userId).doc();
    const nowMs = Date.now();
    const stored = { ...normalized, createdAtMs: nowMs, updatedAtMs: nowMs };
    await docRef.set(stored);
    return { id: docRef.id, ...stored };
  }

  async function updateTariffPlan(userId, planId, payload = {}) {
    const docRef = tariffPlansCollection(userId).doc(planId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) throw new Error('Tariff plan not found');
    const normalized = normalizeTariffPlanModel({ ...(snapshot.data() || {}), ...payload, id: planId }, snapshot.data()?.timezone || 'Australia/Sydney');
    if (!normalized.name) throw new Error('Tariff plan name is required');
    await docRef.set({ ...normalized, updatedAtMs: Date.now() }, { merge: true });
    return { id: planId, ...normalized };
  }

  async function deleteTariffPlan(userId, planId) {
    await tariffPlansCollection(userId).doc(planId).delete();
    return true;
  }

  async function countActiveRuns(userId) {
    const snapshot = await runsCollection(userId).where('status', 'in', [RUN_STATUSES.queued, RUN_STATUSES.running]).get();
    return snapshot.size;
  }

  async function countSavedRuns(userId, limit = DEFAULT_LIMITS.maxSavedRuns) {
    const snapshot = await runsCollection(userId)
      .orderBy('requestedAtMs', 'desc')
      .limit(Math.max(1, Math.round(toFiniteNumber(limit, DEFAULT_LIMITS.maxSavedRuns) || DEFAULT_LIMITS.maxSavedRuns)))
      .get();
    return snapshot.size;
  }

  async function getDailyRunUsage(userId, timezone, timestampMs, maxRunsPerDay) {
    const window = getLocalDayWindow(timezone, timestampMs);
    const usageRef = dailyUsageCollection(userId).doc(window.dateKey);
    const usageSnapshot = await usageRef.get();
    if (usageSnapshot.exists) {
      return {
        ...window,
        usageRef,
        count: Math.max(0, Math.round(toFiniteNumber(usageSnapshot.data()?.count, 0) || 0))
      };
    }
    const snapshot = await runsCollection(userId)
      .where('requestedAtMs', '>=', window.startMs)
      .where('requestedAtMs', '<', window.endExclusiveMs)
      .limit(Math.max(1, Math.round(toFiniteNumber(maxRunsPerDay, DEFAULT_LIMITS.maxRunsPerDay) || DEFAULT_LIMITS.maxRunsPerDay)))
      .get();
    return {
      ...window,
      usageRef,
      count: snapshot.size
    };
  }

  async function normalizeCreateRequest(userId, request = {}) {
    const limits = getLimits();
    const userConfig = await getUserConfig(userId);
    const timezone = resolveTimezoneOrFallback(userConfig?.timezone);
    const { startDate, endDate } = validateBacktestPeriod({
      startDate: request?.period?.startDate || request?.startDate,
      endDate: request?.period?.endDate || request?.endDate
    }, {
      maxLookbackDays: limits.maxLookbackDays,
      maxRangeDays: limits.maxLookbackDays
    });
    const scenarios = (Array.isArray(request.scenarios) ? request.scenarios : []).slice(0, limits.maxScenarios);
    if (scenarios.length === 0) {
      scenarios.push({
        id: 'current',
        name: 'Current rules',
        ruleSetSnapshot: { source: 'current', name: 'Current rules', rules: await getUserRules(userId) }
      });
    }
    const normalizedScenarios = scenarios.map((scenario, index) => normalizeScenarioInput(scenario, `Scenario ${index + 1}`));
    const unsupported = normalizedScenarios.flatMap((scenario) => collectUnsupportedConditions(scenario.ruleSetSnapshot).map((entry) => ({ ...entry, scenarioId: scenario.id, scenarioName: scenario.name })));
    if (unsupported.length > 0) throw new Error(`${unsupported[0].ruleName}: ${unsupported[0].reason}`);
    return {
      period: { startDate, endDate },
      includeBaseline: request.includeBaseline !== false,
      comparisonMode: String(request.comparisonMode || 'side_by_side'),
      scenarios: normalizedScenarios,
      timezone,
      requestHash: buildRequestHash(request)
    };
  }

  async function createRun(userId, request = {}) {
    const limits = getLimits();
    if ((await countSavedRuns(userId, limits.maxSavedRuns)) >= limits.maxSavedRuns) {
      throw new Error(`You already have ${limits.maxSavedRuns} saved backtests. Delete one from history before running another.`);
    }
    if ((await countActiveRuns(userId)) >= limits.maxActiveRuns) {
      throw new Error(`You can only have ${limits.maxActiveRuns} queued or running backtests at once`);
    }
    const normalized = await normalizeCreateRequest(userId, request);
    const nowMs = Date.now();
    const docRef = runsCollection(userId).doc();
    const dailyUsage = await getDailyRunUsage(userId, normalized.timezone, nowMs, limits.maxRunsPerDay);
    if (dailyUsage.count >= limits.maxRunsPerDay) {
      throw new Error(`You can generate up to ${limits.maxRunsPerDay} backtest reports per day. Try again tomorrow.`);
    }
    const stored = {
      type: 'backtestRun',
      status: RUN_STATUSES.queued,
      requestedAtMs: nowMs,
      startedAtMs: null,
      completedAtMs: null,
      expiresAtMs: nowMs + limits.runTtlMs,
      request: normalized,
      error: null
    };
    await db.runTransaction(async (transaction) => {
      const usageSnapshot = await transaction.get(dailyUsage.usageRef);
      const currentCount = usageSnapshot.exists
        ? Math.max(0, Math.round(toFiniteNumber(usageSnapshot.data()?.count, dailyUsage.count) || dailyUsage.count))
        : dailyUsage.count;
      if (currentCount >= limits.maxRunsPerDay) {
        throw new Error(`You can generate up to ${limits.maxRunsPerDay} backtest reports per day. Try again tomorrow.`);
      }
      transaction.set(docRef, stored);
      transaction.set(dailyUsage.usageRef, {
        dateKey: dailyUsage.dateKey,
        count: currentCount + 1,
        createdAtMs: usageSnapshot.exists
          ? Math.round(toFiniteNumber(usageSnapshot.data()?.createdAtMs, nowMs) || nowMs)
          : nowMs,
        updatedAtMs: nowMs
      }, { merge: true });
    });
    return { id: docRef.id, ...stored };
  }

  async function deleteRun(userId, runId) {
    const docRef = runsCollection(userId).doc(runId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) throw new Error('Backtest run not found');
    const data = snapshot.data() || {};
    if (data.status === RUN_STATUSES.queued || data.status === RUN_STATUSES.running) {
      throw new Error('Backtest run is still processing and cannot be deleted yet');
    }
    await docRef.delete();
    return true;
  }

  async function fetchFoxessHistory(userConfig, userId, deviceSN, beginMs, endMs) {
    const chunks = [];
    const chunkMs = 24 * 60 * 60 * 1000;
    for (let cursor = beginMs; cursor < endMs; cursor += chunkMs) {
      chunks.push({ begin: cursor, end: Math.min(endMs, cursor + chunkMs - 1) });
    }
    const merged = {};
    let usedFallbackBatterySeries = false;
    for (const chunk of chunks) {
      let payload = await foxessAPI.callFoxESSAPI('/op/v0/device/history/query', 'POST', {
        sn: deviceSN,
        begin: chunk.begin,
        end: chunk.end,
        variables: buildHistoryQueryVariables(userConfig, HISTORY_SERIES_VARIABLES)
      }, userConfig, userId).catch(() => null);
      if (!payload || payload.errno !== 0) {
        usedFallbackBatterySeries = true;
        payload = await foxessAPI.callFoxESSAPI('/op/v0/device/history/query', 'POST', {
          sn: deviceSN,
          begin: chunk.begin,
          end: chunk.end,
          variables: buildHistoryQueryVariables(userConfig, FOXESS_HISTORY_FALLBACK_VARIABLES)
        }, userConfig, userId);
      }
      if (!payload || payload.errno !== 0) {
        throw new Error(payload?.msg || payload?.error || 'FoxESS history query failed');
      }
      const datas = Array.isArray(payload?.result?.[0]?.datas) ? payload.result[0].datas : [];
      datas.forEach((entry) => {
        const variable = String(entry?.variable || entry?.name || '').trim();
        if (!variable) return;
        if (!merged[variable]) merged[variable] = { variable, name: variable, unit: entry?.unit || 'kW', data: [] };
        if (Array.isArray(entry?.data)) merged[variable].data.push(...entry.data);
      });
    }
    return { payload: { errno: 0, result: [{ datas: Object.values(merged), deviceSN }] }, usedFallbackBatterySeries };
  }

  async function buildScenarioTariffLookup(userId, userConfig, scenario, planIndex, startDate, pricingEndDate) {
    const tariff = scenario.tariff && typeof scenario.tariff === 'object' ? scenario.tariff : {};
    if (tariff.kind === 'manual' || tariff.planId || tariff.plan) {
      const plan = tariff.plan
        ? normalizeTariffPlanModel(tariff.plan, userConfig?.timezone || 'Australia/Sydney')
        : normalizeTariffPlanModel(planIndex.get(String(tariff.planId || '')) || {}, userConfig?.timezone || 'Australia/Sydney');
      if (!plan.name) throw new Error(`Scenario "${scenario.name}" references a missing tariff plan`);
      return buildManualTariffLookup(plan);
    }

    const providerType = String(tariff.provider || userConfig?.pricingProvider || 'amber').trim().toLowerCase() || 'amber';
    const tariffProvider = adapterRegistry.getTariffProvider(providerType);
    if (!tariffProvider || typeof tariffProvider.getHistoricalPrices !== 'function') {
      throw new Error(`Historical pricing is not available for provider: ${providerType}`);
    }
    const context = { userConfig, userId, actualOnly: true };
    if (providerType === 'aemo') {
      context.regionId = tariff.siteIdOrRegion || tariff.regionId || userConfig?.aemoRegion || userConfig?.siteIdOrRegion;
    } else {
      context.siteId = tariff.siteIdOrRegion || tariff.siteId || userConfig?.amberSiteId || userConfig?.siteIdOrRegion;
    }
    const resolutionMinutes = providerType === 'aemo' ? 5 : 30;
    const snapshot = await tariffProvider.getHistoricalPrices(
      context,
      `${startDate}T00:00:00.000Z`,
      `${pricingEndDate}T23:59:59.999Z`,
      resolutionMinutes
    );
    const intervals = Array.isArray(snapshot?.intervals) ? snapshot.intervals : [];
    if (intervals.length === 0) {
      throw new Error(`Historical pricing was unavailable for scenario "${scenario.name}" during ${startDate} to ${pricingEndDate}. Reconnect your tariff provider or use a manual tariff plan.`);
    }
    return buildIntervalTariffLookup(intervals);
  }

  async function fetchHistoricalInputs(userId, request) {
    const userConfig = await getUserConfig(userId);
    const timezone = resolveTimezoneOrFallback(userConfig?.timezone || request?.timezone);
    const limits = getLimits();
    const replayGrid = buildReplayGrid(request.period, timezone, limits.replayIntervalMinutes);
    const latestHistoricalDate = getUtcDateOnly(Date.now());
    const rawPricingEndDate = addDaysToDateOnly(request.period.endDate, Math.max(0, Math.ceil(Math.max(...request.scenarios.map((scenario) => getMaxForecastLookAheadMinutes(scenario.ruleSetSnapshot)), 0) / (24 * 60))));
    const rawWeatherEndDate = addDaysToDateOnly(request.period.endDate, Math.max(0, Math.max(...request.scenarios.map((scenario) => getMaxWeatherLookAheadDays(scenario.ruleSetSnapshot)), 1) - 1));
    const pricingEndDate = clampDateOnlyMax(rawPricingEndDate, latestHistoricalDate);
    const weatherEndDate = clampDateOnlyMax(rawWeatherEndDate, latestHistoricalDate);
    const weather = await getHistoricalWeather({
      place: userConfig?.location || userConfig?.preferences?.weatherPlace || 'Sydney, Australia',
      timezone,
      startDate: request.period.startDate,
      endDate: weatherEndDate
    });
    const provider = String(userConfig?.deviceProvider || 'foxess').trim().toLowerCase() || 'foxess';
    if (provider === 'sigenergy') throw new Error('SigenEnergy is not supported for Stage 1 backtesting');
    const deviceContext = resolveProviderDeviceId(userConfig);
    if (!deviceContext.deviceId) throw new Error('Backtesting requires a configured device serial number');
    let historyPayload = null;
    let confidence = 'high';
    const limitations = [];

    if (rawWeatherEndDate && weatherEndDate && rawWeatherEndDate > weatherEndDate) {
      confidence = summarizeConfidence([confidence, 'medium']);
      limitations.push(`Weather forecast look-ahead near the end of the period was truncated because historical weather is only available through ${weatherEndDate}.`);
    }
    if (rawPricingEndDate && pricingEndDate && rawPricingEndDate > pricingEndDate) {
      confidence = summarizeConfidence([confidence, 'medium']);
      limitations.push(`Price forecast look-ahead near the end of the period was truncated because historical pricing is only available through ${pricingEndDate}.`);
    }

    if (provider === 'foxess') {
      const result = await fetchFoxessHistory(userConfig, userId, deviceContext.deviceId, replayGrid.startMs, replayGrid.endExclusiveMs);
      historyPayload = result.payload;
      if (result.usedFallbackBatterySeries) {
        confidence = 'medium';
        limitations.push('FoxESS battery history fields were unavailable upstream; battery SoC was reconstructed from power flow');
      }
    } else {
      const adapter = adapterRegistry.getDeviceProvider(provider);
      if (!adapter || typeof adapter.getHistory !== 'function') throw new Error(`Backtesting history is not available for provider: ${provider}`);
      historyPayload = await adapter.getHistory({
        deviceSN: deviceContext.deviceId,
        systemSn: userConfig?.alphaessSystemSn || userConfig?.alphaessSysSn || deviceContext.deviceId,
        userConfig,
        userId
      }, replayGrid.startMs, replayGrid.endExclusiveMs, HISTORY_SERIES_VARIABLES);
      if (!historyPayload || historyPayload.errno !== 0) throw new Error(historyPayload?.error || historyPayload?.msg || `${provider} history query failed`);
    }

    appendHistoryTelemetryMappings(historyPayload, userConfig);

    const historySeries = summarizeHistorySeries(historyPayload?.result?.[0]?.datas || [], replayGrid.gridMs, timezone);
    const derivedLoads = deriveLoadSeries(historySeries);
    const socReconstruction = reconstructSocSeries({
      actualSoc: historySeries.socPct,
      batteryPowerKw: historySeries.batteryPowerKw,
      batteryCapacityKWh: toFiniteNumber(userConfig?.batteryCapacityKWh, 10) || 10,
      stepHours: replayGrid.stepMs / (60 * 60 * 1000)
    });
    return {
      replayGrid,
      timezone,
      userConfig,
      pricingEndDate,
      weatherIndices: buildWeatherIndices(weather, timezone, replayGrid.gridMs),
      inputSeries: {
        solarKw: historySeries.solarKw.map((value) => Math.max(0, toFiniteNumber(value, 0) || 0)),
        loadKw: derivedLoads,
        batteryPowerKw: historySeries.batteryPowerKw
      },
      initialSocPct: toFiniteNumber(socReconstruction.soc[0], 50) || 50,
      confidence: summarizeConfidence([confidence, socReconstruction.confidence]),
      limitations: limitations.concat(socReconstruction.limitations)
    };
  }

  async function runBacktestAnalysis(userId, request) {
    const inputs = await fetchHistoricalInputs(userId, request);
    const plans = await listTariffPlans(userId);
    const planIndex = new Map(plans.map((plan) => [String(plan.id), plan]));
    const scenarios = request.includeBaseline
      ? [{ id: 'baseline', name: 'No automation', ruleSetSnapshot: normalizeRuleSetSnapshot({ source: 'baseline', rules: {} }), tariff: request.scenarios[0]?.tariff || null }].concat(request.scenarios)
      : request.scenarios.slice();
    const results = [];
    for (const scenario of scenarios) {
      const tariffLookup = await buildScenarioTariffLookup(userId, inputs.userConfig, scenario, planIndex, request.period.startDate, inputs.pricingEndDate);
      results.push(simulateRuleSet({
        scenario,
        userConfig: inputs.userConfig,
        gridMs: inputs.replayGrid.gridMs,
        stepMs: inputs.replayGrid.stepMs,
        inputSeries: inputs.inputSeries,
        weatherIndices: inputs.weatherIndices,
        tariffLookup,
        initialSocPct: inputs.initialSocPct,
        timezone: inputs.timezone
      }));
    }
    const baseline = results.find((entry) => entry.scenarioId === 'baseline') || null;
    const summaries = results.map((result) => buildScenarioSummary(result, baseline && result.scenarioId !== 'baseline' ? baseline : null));
    const limitations = inputs.limitations.slice();
    if (summaries.some((entry) => entry.totalSupplyChargeAud === 0 && entry.scenarioId !== 'baseline')) {
      limitations.push('Provider-backed tariff comparisons exclude fixed daily supply charges unless you use a manual tariff plan');
    }
    return {
      request,
      confidence: summarizeConfidence([inputs.confidence, limitations.length > inputs.limitations.length ? 'medium' : 'high']),
      limitations: Array.from(new Set(limitations)),
      summaries,
      comparisons: buildPairwiseComparisons(results)
    };
  }

  async function processRun(userId, runId) {
    const runRef = runsCollection(userId).doc(runId);
    let claimed = null;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(runRef);
      if (!snapshot.exists) throw new Error('Backtest run not found');
      const data = snapshot.data() || {};
      if (data.status !== RUN_STATUSES.queued) return;
      claimed = { id: snapshot.id, ...data };
      transaction.update(runRef, { status: RUN_STATUSES.running, startedAtMs: Date.now(), error: null });
    });
    if (!claimed) return getRun(userId, runId);
    try {
      const result = await runBacktestAnalysis(userId, claimed.request);
      await runRef.set({
        status: RUN_STATUSES.completed,
        completedAtMs: Date.now(),
        result,
        confidence: result.confidence,
        limitations: result.limitations,
        error: null
      }, { merge: true });
    } catch (error) {
      await runRef.set({
        status: RUN_STATUSES.failed,
        completedAtMs: Date.now(),
        error: error?.message || String(error)
      }, { merge: true });
      throw error;
    }
    return getRun(userId, runId);
  }

  return {
    RUN_STATUSES,
    createRun,
    createTariffPlan,
    deleteRun,
    deleteTariffPlan,
    getRun,
    listRuns,
    listTariffPlans,
    normalizeRuleSetSnapshot,
    normalizeScenarioInput,
    normalizeTariffPlanModel,
    processRun,
    runBacktestAnalysis,
    simulateRuleSet,
    updateTariffPlan
  };
}

module.exports = {
  RUN_STATUSES,
  buildManualTariffLookup,
  buildReplayGrid,
  collectUnsupportedConditions,
  createBacktestService,
  normalizeRuleSetSnapshot,
  normalizeScenarioInput,
  normalizeTariffPlanModel,
  reconstructSocSeries,
  resampleSeriesToGrid,
  simulateRuleSet,
  validateBacktestPeriod
};
