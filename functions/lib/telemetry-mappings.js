'use strict';

const MAX_VARIABLE_NAME_LENGTH = 64;
const TELEMETRY_SOURCE_MAPPING_PROVIDERS = Object.freeze(new Set(['foxess']));

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTelemetryProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'foxess';
}

function supportsTelemetrySourceMapping(provider) {
  return TELEMETRY_SOURCE_MAPPING_PROVIDERS.has(normalizeTelemetryProvider(provider));
}

function shouldApplyTelemetryMappings(userConfig) {
  return supportsTelemetrySourceMapping(userConfig && userConfig.deviceProvider);
}

function normalizeTelemetryVariableName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const sanitized = raw.replace(/[^A-Za-z0-9_.-]/g, '');
  if (!sanitized) return '';

  return sanitized.slice(0, MAX_VARIABLE_NAME_LENGTH);
}

function normalizeTelemetryMappings(input = {}) {
  return {
    acSolarPowerVariable: normalizeTelemetryVariableName(input.acSolarPowerVariable)
  };
}

function getTelemetryMappings(userConfig) {
  return normalizeTelemetryMappings(userConfig && userConfig.telemetryMappings);
}

function getConfiguredAcSolarPowerVariable(userConfig) {
  return getTelemetryMappings(userConfig).acSolarPowerVariable;
}

function findRealtimeEntry(datas, variableName) {
  if (!Array.isArray(datas) || !variableName) return null;
  const target = String(variableName).toLowerCase();
  return datas.find((entry) => {
    const variable = String(entry?.variable || entry?.key || '').toLowerCase();
    return variable === target;
  }) || null;
}

function extractRealtimeDatas(payload) {
  if (Array.isArray(payload?.result?.[0]?.datas)) return payload.result[0].datas;
  if (Array.isArray(payload?.result?.datas)) return payload.result.datas;
  return [];
}

function normalizePowerToKw(rawValue) {
  const numeric = toFiniteNumber(rawValue, null);
  if (numeric === null) return null;
  const kw = Math.abs(numeric) > 100 ? (numeric / 1000) : numeric;
  return Number(kw.toFixed(4));
}

function normalizeSolarProductionToKw(rawValue) {
  const kw = normalizePowerToKw(rawValue);
  if (kw === null) return null;
  return Number(Math.abs(kw).toFixed(4));
}

function setRealtimeEntry(datas, variable, value, unit = 'kW') {
  if (!Array.isArray(datas) || !variable || value === null || value === undefined) return;

  const match = findRealtimeEntry(datas, variable);
  if (match) {
    match.value = value;
    if (unit) match.unit = unit;
    return;
  }

  datas.push({
    variable,
    value,
    ...(unit ? { unit } : {})
  });
}

function resolveRealtimeSolarTelemetry(datas, userConfig) {
  const acSolarPowerVariable = getConfiguredAcSolarPowerVariable(userConfig);
  const dcSolarPowerKw = normalizeSolarProductionToKw(findRealtimeEntry(datas, 'pvPower')?.value);
  const acSourceEntry = acSolarPowerVariable ? findRealtimeEntry(datas, acSolarPowerVariable) : null;
  const acSolarPowerKw = acSourceEntry ? normalizeSolarProductionToKw(acSourceEntry.value) : null;

  let solarPowerTotalKw = null;
  if (dcSolarPowerKw !== null && acSolarPowerKw !== null) {
    const sameSource = String(acSolarPowerVariable).toLowerCase() === 'pvpower';
    solarPowerTotalKw = sameSource
      ? dcSolarPowerKw
      : Number((dcSolarPowerKw + acSolarPowerKw).toFixed(4));
  } else if (dcSolarPowerKw !== null) {
    solarPowerTotalKw = dcSolarPowerKw;
  } else if (acSolarPowerKw !== null) {
    solarPowerTotalKw = acSolarPowerKw;
  }

  return {
    acSolarPowerVariable,
    acSolarPowerKw,
    dcSolarPowerKw,
    solarPowerTotalKw
  };
}

function appendRealtimeTelemetryMappings(payload, userConfig) {
  if (!payload || payload.errno !== 0) return payload;
  if (!shouldApplyTelemetryMappings(userConfig)) return payload;

  const datas = extractRealtimeDatas(payload);
  if (!datas.length) return payload;

  const resolved = resolveRealtimeSolarTelemetry(datas, userConfig);
  if (!resolved.acSolarPowerVariable) {
    return payload;
  }
  if (resolved.acSolarPowerKw === null && resolved.solarPowerTotalKw === null) {
    return payload;
  }

  if (resolved.acSolarPowerKw !== null) {
    setRealtimeEntry(datas, 'acSolarPower', resolved.acSolarPowerKw, 'kW');
  }
  if (resolved.solarPowerTotalKw !== null) {
    setRealtimeEntry(datas, 'solarPowerTotal', resolved.solarPowerTotalKw, 'kW');
  }

  return payload;
}

function findSeriesEntry(datas, variableName) {
  if (!Array.isArray(datas) || !variableName) return null;
  const target = String(variableName).toLowerCase();
  return datas.find((entry) => String(entry?.variable || '').toLowerCase() === target) || null;
}

function normalizeSeriesPoints(points = []) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const value = normalizeSolarProductionToKw(point?.value);
      if (!point || value === null || !point.time) return null;
      return { ...point, value };
    })
    .filter(Boolean);
}

function upsertSeries(datas, variable, data, unit = 'kW') {
  if (!Array.isArray(datas) || !variable || !Array.isArray(data) || data.length === 0) return;

  const existing = findSeriesEntry(datas, variable);
  if (existing) {
    existing.data = data;
    existing.unit = unit;
    if (!existing.name) existing.name = variable;
    return;
  }

  datas.push({
    variable,
    name: variable,
    unit,
    data
  });
}

function mergeSolarSeries(dcSeries = [], acSeries = [], sameSource = false) {
  if (sameSource) return dcSeries;

  const merged = new Map();

  dcSeries.forEach((point) => {
    merged.set(String(point.time), {
      time: point.time,
      value: point.value
    });
  });

  acSeries.forEach((point) => {
    const key = String(point.time);
    const existing = merged.get(key);
    if (existing) {
      existing.value = Number((existing.value + point.value).toFixed(4));
    } else {
      merged.set(key, {
        time: point.time,
        value: point.value
      });
    }
  });

  return Array.from(merged.values()).sort((left, right) => {
    const a = String(left.time);
    const b = String(right.time);
    return a.localeCompare(b);
  });
}

function appendHistoryTelemetryMappings(payload, userConfig) {
  if (!payload || payload.errno !== 0) return payload;
  if (!shouldApplyTelemetryMappings(userConfig)) return payload;
  const datas = payload?.result?.[0]?.datas;
  if (!Array.isArray(datas) || !datas.length) return payload;

  const acSolarPowerVariable = getConfiguredAcSolarPowerVariable(userConfig);
  if (!acSolarPowerVariable) return payload;

  const dcSeriesEntry = findSeriesEntry(datas, 'pvPower');
  const acSourceEntry = findSeriesEntry(datas, acSolarPowerVariable);
  if (!acSourceEntry || !Array.isArray(acSourceEntry.data) || acSourceEntry.data.length === 0) {
    return payload;
  }

  const dcSeries = normalizeSeriesPoints(dcSeriesEntry?.data || []);
  const acSeries = normalizeSeriesPoints(acSourceEntry.data || []);

  if (acSeries.length === 0 && dcSeries.length === 0) {
    return payload;
  }

  if (acSeries.length > 0) {
    upsertSeries(datas, 'acSolarPower', acSeries, 'kW');
  }

  const sameSource = String(acSolarPowerVariable).toLowerCase() === 'pvpower';
  const totalSeries = mergeSolarSeries(dcSeries, acSeries, sameSource);
  if (totalSeries.length > 0) {
    upsertSeries(datas, 'solarPowerTotal', totalSeries, 'kW');
  }

  return payload;
}

module.exports = {
  appendHistoryTelemetryMappings,
  appendRealtimeTelemetryMappings,
  extractRealtimeDatas,
  findRealtimeEntry,
  getConfiguredAcSolarPowerVariable,
  getTelemetryMappings,
  normalizePowerToKw,
  normalizeSolarProductionToKw,
  normalizeTelemetryMappings,
  normalizeTelemetryVariableName,
  normalizeTelemetryProvider,
  resolveRealtimeSolarTelemetry,
  shouldApplyTelemetryMappings,
  supportsTelemetrySourceMapping
};
