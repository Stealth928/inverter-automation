'use strict';

const { extractDatasFrame } = require('../adapters/device-adapter');
const { toFiniteNumber } = require('./number-utils');

const ENERGY_CAP_MIN_KWH = 0.1;
const ENERGY_CAP_MAX_KWH = 1000;
const ENERGY_CAP_EPSILON_KWH = 0.001;
const ENERGY_CAP_DIRECTIONS = Object.freeze({
  ForceCharge: 'import',
  ForceDischarge: 'export',
  Feedin: 'export'
});

function getEnergyCapDirectionForWorkMode(workMode) {
  return ENERGY_CAP_DIRECTIONS[String(workMode || '').trim()] || null;
}

function normalizeStopOnEnergyKwh(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Number(parsed.toFixed(3));
}

function validateActionEnergyCap(action = {}) {
  const targetKwh = normalizeStopOnEnergyKwh(action.stopOnEnergyKwh);
  if (targetKwh === null) {
    return null;
  }

  const direction = getEnergyCapDirectionForWorkMode(action.workMode);
  if (!direction) {
    return 'action.stopOnEnergyKwh is only supported for workMode ForceCharge, ForceDischarge, or Feedin';
  }

  if (targetKwh < ENERGY_CAP_MIN_KWH || targetKwh > ENERGY_CAP_MAX_KWH) {
    return `action.stopOnEnergyKwh must be between ${ENERGY_CAP_MIN_KWH} and ${ENERGY_CAP_MAX_KWH} kWh`;
  }

  return null;
}

function formatDayParts(nowMs, timeZone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(nowMs));
  const lookup = Object.create(null);
  parts.forEach((part) => {
    if (part && part.type) {
      lookup[part.type] = part.value;
    }
  });
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    dayKey: `${lookup.year || '0000'}-${lookup.month || '00'}-${lookup.day || '00'}`
  };
}

function findDataEntry(datas, variableNames = []) {
  if (!Array.isArray(datas) || datas.length === 0) {
    return null;
  }
  for (const variableName of variableNames) {
    const entry = datas.find((item) => item && item.variable === variableName);
    if (entry) {
      return entry;
    }
  }
  return null;
}

function toWattsFromTelemetryEntry(entry) {
  if (!entry || entry.value === undefined || entry.value === null || entry.value === '') {
    return null;
  }
  const numeric = Number(entry.value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const unit = String(entry.unit || '').trim().toLowerCase();
  if (unit === 'kw') {
    return numeric * 1000;
  }
  return numeric;
}

function getRelevantTelemetryPowerW(inverterData, direction) {
  const datas = extractDatasFrame(inverterData);
  const aliases = direction === 'import'
    ? ['gridConsumptionPower', 'gridPower']
    : ['feedinPower', 'feedInPower'];
  const entry = findDataEntry(datas, aliases);
  const powerW = toWattsFromTelemetryEntry(entry);
  if (!Number.isFinite(powerW)) {
    return null;
  }
  return Math.max(0, powerW);
}

function parseTelemetryTimestampMs(inverterData, nowMs = Date.now()) {
  const frame = Array.isArray(inverterData?.result) && inverterData.result.length > 0
    ? inverterData.result[0]
    : null;
  const candidates = [
    inverterData?.observedAtIso,
    inverterData?.observedAt,
    inverterData?.time,
    inverterData?.timestamp,
    frame?.time,
    frame?.timestamp
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsedMs = Date.parse(candidate);
    if (Number.isFinite(parsedMs)) {
      return parsedMs;
    }
  }
  const cacheAgeMs = Number(inverterData?.__cacheAgeMs);
  if (Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0) {
    return Math.max(0, nowMs - cacheAgeMs);
  }
  return null;
}

function getReportVariableName(direction) {
  return direction === 'import' ? 'gridConsumption' : 'feedin';
}

function extractReportSeries(reportPayload, variableName) {
  const items = Array.isArray(reportPayload?.result) ? reportPayload.result : [];
  return items.find((item) => String(item?.variable || '').trim().toLowerCase() === String(variableName || '').trim().toLowerCase()) || null;
}

function extractDailyReportValue(reportPayload, direction, dayIndex) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0) {
    return null;
  }
  const series = extractReportSeries(reportPayload, getReportVariableName(direction));
  const values = Array.isArray(series?.values) ? series.values : [];
  const rawValue = values[dayIndex];
  return toFiniteNumber(rawValue, null);
}

async function fetchDailyReportTotalKwh(options = {}) {
  const direction = options.direction;
  const deviceAdapter = options.deviceAdapter || null;
  const deviceSN = options.deviceSN;
  const foxessAPI = options.foxessAPI;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const provider = String(options.provider || 'foxess').toLowerCase().trim();
  const timeZone = options.timeZone || 'UTC';
  const userConfig = options.userConfig;
  const userId = options.userId;

  if (!direction || !deviceSN) {
    return null;
  }

  const { year, month, day } = formatDayParts(nowMs, timeZone);
  const dayIndex = day - 1;
  let reportPayload = null;

  if (provider !== 'foxess' && deviceAdapter && typeof deviceAdapter.getReport === 'function') {
    reportPayload = await deviceAdapter.getReport(
      { deviceSN, userConfig, userId },
      'month',
      year,
      month
    );
  } else if (provider === 'foxess' && foxessAPI && typeof foxessAPI.callFoxESSAPI === 'function') {
    reportPayload = await foxessAPI.callFoxESSAPI(
      '/op/v0/device/report/query',
      'POST',
      {
        sn: deviceSN,
        dimension: 'month',
        year,
        month,
        variables: [getReportVariableName(direction)]
      },
      userConfig,
      userId
    );
  }

  if (!reportPayload || Number(reportPayload.errno) !== 0) {
    return null;
  }

  const totalKwh = extractDailyReportValue(reportPayload, direction, dayIndex);
  if (!Number.isFinite(totalKwh)) {
    return null;
  }

  return {
    dayKey: formatDayParts(nowMs, timeZone).dayKey,
    source: 'report',
    totalKwh: Number(totalKwh.toFixed(4))
  };
}

function shouldResetTracking(existingTracking, ruleId, direction, targetKwh) {
  if (!existingTracking || typeof existingTracking !== 'object') {
    return true;
  }
  return existingTracking.ruleId !== ruleId ||
    existingTracking.direction !== direction ||
    Number(existingTracking.targetKwh) !== Number(targetKwh);
}

function buildBaseTracking(ruleId, direction, targetKwh, nowMs) {
  return {
    ruleId,
    direction,
    targetKwh,
    progressKwh: 0,
    baselineTotalKwh: null,
    lastReportTotalKwh: null,
    lastTelemetryPowerW: null,
    lastTelemetryTimestampMs: null,
    measurementSource: null,
    dayKey: null,
    updatedAtMs: nowMs
  };
}

function updateTrackingFromReport(existingTracking, reportSample, nowMs) {
  const nextTracking = {
    ...existingTracking,
    baselineTotalKwh: existingTracking.baselineTotalKwh,
    dayKey: reportSample.dayKey,
    lastReportTotalKwh: reportSample.totalKwh,
    measurementSource: 'report',
    updatedAtMs: nowMs
  };

  if (!Number.isFinite(nextTracking.baselineTotalKwh)) {
    nextTracking.baselineTotalKwh = reportSample.totalKwh;
    nextTracking.progressKwh = 0;
    return nextTracking;
  }

  if (existingTracking.dayKey && existingTracking.dayKey !== reportSample.dayKey) {
    return nextTracking;
  }

  if (reportSample.totalKwh + ENERGY_CAP_EPSILON_KWH < nextTracking.baselineTotalKwh) {
    return nextTracking;
  }

  nextTracking.progressKwh = Number(Math.max(0, reportSample.totalKwh - nextTracking.baselineTotalKwh).toFixed(4));
  return nextTracking;
}

function updateTrackingFromTelemetry(existingTracking, sampleTimestampMs, currentPowerW, nowMs) {
  const nextTracking = {
    ...existingTracking,
    measurementSource: existingTracking.measurementSource || 'telemetry',
    updatedAtMs: nowMs
  };

  if (Number.isFinite(sampleTimestampMs)) {
    const lastTimestampRaw = existingTracking.lastTelemetryTimestampMs;
    const lastPowerRaw = existingTracking.lastTelemetryPowerW;
    const lastTimestampMs = (lastTimestampRaw === null || lastTimestampRaw === undefined || lastTimestampRaw === '')
      ? NaN
      : Number(lastTimestampRaw);
    const lastPowerW = (lastPowerRaw === null || lastPowerRaw === undefined || lastPowerRaw === '')
      ? NaN
      : Number(lastPowerRaw);
    if (Number.isFinite(lastTimestampMs) && sampleTimestampMs > lastTimestampMs) {
      const deltaHours = (sampleTimestampMs - lastTimestampMs) / (60 * 60 * 1000);
      if (deltaHours > 0) {
        const prevPowerW = Number.isFinite(lastPowerW) ? Math.max(0, lastPowerW) : Math.max(0, currentPowerW || 0);
        const nextPowerW = Math.max(0, currentPowerW || 0);
        const averagePowerW = (prevPowerW + nextPowerW) / 2;
        nextTracking.progressKwh = Number((Number(existingTracking.progressKwh || 0) + ((averagePowerW / 1000) * deltaHours)).toFixed(4));
      }
    }
    nextTracking.lastTelemetryTimestampMs = sampleTimestampMs;
  }

  if (Number.isFinite(currentPowerW)) {
    nextTracking.lastTelemetryPowerW = currentPowerW;
  }

  if (!nextTracking.measurementSource) {
    nextTracking.measurementSource = 'telemetry';
  }

  return nextTracking;
}

async function evaluateActiveRuleEnergyCap(options = {}) {
  const action = options.action && typeof options.action === 'object' ? options.action : {};
  const targetKwh = normalizeStopOnEnergyKwh(action.stopOnEnergyKwh);
  const direction = getEnergyCapDirectionForWorkMode(action.workMode);
  if (targetKwh === null || !direction) {
    return {
      applicable: false,
      condition: null,
      reached: false,
      statePatch: { activeEnergyTracking: null }
    };
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const existingTrackingRaw = options.state?.activeEnergyTracking;
  const tracking = shouldResetTracking(existingTrackingRaw, options.ruleId, direction, targetKwh)
    ? buildBaseTracking(options.ruleId, direction, targetKwh, nowMs)
    : { ...existingTrackingRaw, updatedAtMs: nowMs };

  const currentPowerW = getRelevantTelemetryPowerW(options.inverterData, direction);
  const sampleTimestampMs = parseTelemetryTimestampMs(options.inverterData, nowMs);

  let nextTracking = updateTrackingFromTelemetry(tracking, sampleTimestampMs, currentPowerW, nowMs);

  try {
    const reportSample = await fetchDailyReportTotalKwh({
      deviceAdapter: options.deviceAdapter,
      deviceSN: options.deviceSN,
      direction,
      foxessAPI: options.foxessAPI,
      nowMs,
      provider: options.provider,
      timeZone: options.timeZone,
      userConfig: options.userConfig,
      userId: options.userId
    });
    if (reportSample) {
      nextTracking = updateTrackingFromReport(nextTracking, reportSample, nowMs);
    }
  } catch (_error) {
    // Fall back to timestamp-deduped live power integration when provider reports are unavailable.
  }

  const progressKwh = Number(Math.max(0, Number(nextTracking.progressKwh || 0)).toFixed(4));
  const reached = progressKwh + ENERGY_CAP_EPSILON_KWH >= targetKwh;
  const verb = direction === 'import' ? 'imported' : 'exported';

  return {
    applicable: true,
    condition: {
      condition: 'energyCap',
      met: !reached,
      actual: Number(progressKwh.toFixed(3)),
      operator: '<',
      target: targetKwh,
      direction,
      unit: 'kWh',
      source: nextTracking.measurementSource || null,
      reason: reached ? `Stop cap reached: ${verb} ${progressKwh.toFixed(3)} of ${targetKwh.toFixed(3)} kWh` : null
    },
    direction,
    progressKwh,
    reached,
    statePatch: {
      activeEnergyTracking: {
        ...nextTracking,
        progressKwh
      }
    },
    targetKwh
  };
}

module.exports = {
  ENERGY_CAP_MAX_KWH,
  ENERGY_CAP_MIN_KWH,
  evaluateActiveRuleEnergyCap,
  getEnergyCapDirectionForWorkMode,
  normalizeStopOnEnergyKwh,
  validateActionEnergyCap
};