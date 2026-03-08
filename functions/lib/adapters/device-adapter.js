'use strict';

const DEVICE_ADAPTER_REQUIRED_METHODS = Object.freeze([
  'getStatus',
  'getCapabilities',
  'getSchedule',
  'setSchedule',
  'clearSchedule',
  'getWorkMode',
  'setWorkMode',
  'normalizeProviderError'
]);

const DEVICE_VARIABLE_ALIASES = Object.freeze({
  socPct: Object.freeze(['SoC', 'SoC1', 'SoC_1']),
  batteryTempC: Object.freeze(['batTemperature', 'batTemperature_1']),
  ambientTempC: Object.freeze(['ambientTemperature', 'ambientTemperation']),
  pvPowerW: Object.freeze(['pvPower', 'pv_power']),
  loadPowerW: Object.freeze(['loadsPower', 'loadPower', 'load_power']),
  gridPowerW: Object.freeze(['gridConsumptionPower', 'gridPower']),
  feedInPowerW: Object.freeze(['feedinPower', 'feedInPower'])
});

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toAliasArray(aliases) {
  if (Array.isArray(aliases)) return aliases;
  if (aliases === null || aliases === undefined) return [];
  return [aliases];
}

function extractDatasFrame(payload) {
  if (Array.isArray(payload?.result?.[0]?.datas)) {
    return payload.result[0].datas;
  }
  if (Array.isArray(payload?.result?.datas)) {
    return payload.result.datas;
  }
  if (Array.isArray(payload?.datas)) {
    return payload.datas;
  }
  return [];
}

function findVariableData(datas, aliases) {
  if (!Array.isArray(datas) || datas.length === 0) {
    return null;
  }

  const aliasList = toAliasArray(aliases);
  for (const alias of aliasList) {
    if (!alias) continue;
    const match = datas.find((entry) => entry && entry.variable === alias);
    if (match) return match;
  }
  return null;
}

function getNumericVariableValue(datas, aliases, fallback = null) {
  const entry = findVariableData(datas, aliases);
  if (!entry || entry.value === undefined) {
    return fallback;
  }
  return toFiniteNumber(entry.value, fallback);
}

function normalizeDeviceStatusPayload(payload, observedAtIso = null) {
  const datas = extractDatasFrame(payload);
  const asOfIso = observedAtIso || new Date().toISOString();
  return {
    socPct: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.socPct, null),
    batteryTempC: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.batteryTempC, null),
    ambientTempC: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.ambientTempC, null),
    pvPowerW: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.pvPowerW, null),
    loadPowerW: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.loadPowerW, null),
    gridPowerW: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.gridPowerW, null),
    feedInPowerW: getNumericVariableValue(datas, DEVICE_VARIABLE_ALIASES.feedInPowerW, null),
    observedAtIso: String(asOfIso)
  };
}

function validateDeviceAdapter(adapter) {
  const missing = DEVICE_ADAPTER_REQUIRED_METHODS.filter(
    (methodName) => !adapter || typeof adapter[methodName] !== 'function'
  );
  if (missing.length > 0) {
    throw new Error(`Device adapter is missing required methods: ${missing.join(', ')}`);
  }
  return true;
}

class DeviceAdapter {
  async getStatus(_context) {
    throw new Error('DeviceAdapter.getStatus not implemented');
  }

  async getCapabilities(_context) {
    throw new Error('DeviceAdapter.getCapabilities not implemented');
  }

  async getSchedule(_context) {
    throw new Error('DeviceAdapter.getSchedule not implemented');
  }

  async setSchedule(_context, _groups) {
    throw new Error('DeviceAdapter.setSchedule not implemented');
  }

  async clearSchedule(_context) {
    throw new Error('DeviceAdapter.clearSchedule not implemented');
  }

  async getWorkMode(_context) {
    throw new Error('DeviceAdapter.getWorkMode not implemented');
  }

  async setWorkMode(_context, _mode) {
    throw new Error('DeviceAdapter.setWorkMode not implemented');
  }

  normalizeProviderError(error) {
    return {
      errno: 3400,
      error: error && error.message ? error.message : 'Device provider error'
    };
  }

  // ── Optional reporting/history methods ──────────────────────────────────
  // These return null by default to signal "not supported by this provider".
  // Routes check for null and fall back to the FoxESS path unchanged.

  /**
   * Get time-series power history for a date range.
   * @returns {Promise<Object|null>} FoxESS-shaped response or null (not supported)
   */
  async getHistory(_context, _begin, _end, _variables) {
    return null;
  }

  /**
   * Get energy report (daily or monthly totals) for a period.
   * @param {string} _dimension - 'month' (day-by-day) or 'year' (month-by-month)
   * @returns {Promise<Object|null>} FoxESS-shaped response or null (not supported)
   */
  async getReport(_context, _dimension, _year, _month) {
    return null;
  }

  /**
   * Get lifetime/period generation summary (today, month, year, cumulative).
   * @returns {Promise<Object|null>} FoxESS-shaped response or null (not supported)
   */
  async getGeneration(_context) {
    return null;
  }
}

module.exports = {
  DEVICE_ADAPTER_REQUIRED_METHODS,
  DEVICE_VARIABLE_ALIASES,
  DeviceAdapter,
  extractDatasFrame,
  findVariableData,
  getNumericVariableValue,
  normalizeDeviceStatusPayload,
  validateDeviceAdapter
};
