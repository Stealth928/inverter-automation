'use strict';

const TARIFF_INTERVAL_SOURCES = Object.freeze(['actual', 'forecast']);
const TARIFF_ADAPTER_REQUIRED_METHODS = Object.freeze([
  'getCurrentPrices',
  'getHistoricalPrices',
  'normalizeProviderError'
]);

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTariffSource(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (TARIFF_INTERVAL_SOURCES.includes(raw)) {
    return raw;
  }
  return 'forecast';
}

function normalizeTariffInterval(interval = {}) {
  return {
    startIso: String(interval.startIso || interval.startTime || ''),
    endIso: String(interval.endIso || interval.endTime || ''),
    buyCentsPerKwh: toFiniteNumber(interval.buyCentsPerKwh, null),
    feedInCentsPerKwh: toFiniteNumber(interval.feedInCentsPerKwh, null),
    renewablePct: toFiniteNumber(interval.renewablePct, null),
    source: normalizeTariffSource(interval.source)
  };
}

function normalizeTariffIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    return [];
  }

  return intervals
    .map((entry) => normalizeTariffInterval(entry))
    .filter((entry) => entry.startIso && entry.endIso);
}

function normalizeTariffSnapshot(snapshot = {}) {
  const nowIso = new Date().toISOString();
  return {
    buyCentsPerKwh: toFiniteNumber(snapshot.buyCentsPerKwh, null),
    feedInCentsPerKwh: toFiniteNumber(snapshot.feedInCentsPerKwh, null),
    asOfIso: String(snapshot.asOfIso || nowIso),
    intervals: normalizeTariffIntervals(snapshot.intervals)
  };
}

function validateTariffProviderAdapter(adapter) {
  const missing = TARIFF_ADAPTER_REQUIRED_METHODS.filter(
    (methodName) => !adapter || typeof adapter[methodName] !== 'function'
  );
  if (missing.length > 0) {
    throw new Error(`Tariff provider adapter is missing required methods: ${missing.join(', ')}`);
  }
  return true;
}

class TariffProviderAdapter {
  async getCurrentPrices(_context) {
    throw new Error('TariffProviderAdapter.getCurrentPrices not implemented');
  }

  async getHistoricalPrices(_context, _startIso, _endIso, _resolutionMinutes) {
    throw new Error('TariffProviderAdapter.getHistoricalPrices not implemented');
  }

  normalizeProviderError(error) {
    return {
      errno: 3200,
      error: error && error.message ? error.message : 'Tariff provider error'
    };
  }
}

module.exports = {
  TARIFF_ADAPTER_REQUIRED_METHODS,
  TARIFF_INTERVAL_SOURCES,
  TariffProviderAdapter,
  normalizeTariffInterval,
  normalizeTariffIntervals,
  normalizeTariffSnapshot,
  validateTariffProviderAdapter
};
