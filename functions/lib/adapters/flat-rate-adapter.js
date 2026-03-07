'use strict';

const { TariffProviderAdapter, normalizeTariffSnapshot } = require('./tariff-provider');

/**
 * Builds a pair of synthetic Amber-style price intervals from flat-rate config.
 *
 * The automation cycle's `fetchAutomationAmberData` expects the legacy Amber price
 * format (array of `{ type, channelType, perKwh, startTime, endTime }` objects).
 * The returned intervals use `type: 'CurrentInterval'` so `getCurrentAmberPrices`
 * in pricing-normalization can pick them up without special casing.
 */
function buildAmberStyleIntervals(nowIso, buyCentsPerKwh, feedInCentsPerKwh) {
  const now = new Date(nowIso);
  // Snap to current 30-minute window
  const startMs = Math.floor(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000);
  const endMs = startMs + 30 * 60 * 1000;
  const startTime = new Date(startMs).toISOString();
  const endTime = new Date(endMs).toISOString();

  const intervals = [];

  if (buyCentsPerKwh !== null) {
    intervals.push({
      type: 'CurrentInterval',
      channelType: 'general',
      perKwh: buyCentsPerKwh,
      startTime,
      endTime
    });
  }

  if (feedInCentsPerKwh !== null) {
    // Amber convention: feedIn perKwh is stored as a negative value
    intervals.push({
      type: 'CurrentInterval',
      channelType: 'feedIn',
      perKwh: -Math.abs(feedInCentsPerKwh),
      startTime,
      endTime
    });
  }

  return intervals;
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * GenericFlatRateTariffAdapter
 *
 * A second tariff-provider implementation that fulfils the TariffProviderAdapter
 * contract using user-supplied static buy/feed-in rates instead of a live API.
 *
 * Satisfies G4 exit criterion: "Two electricity providers work through the same
 * contract (TariffProviderAdapter) and are selectable at run-time via the adapter
 * registry."
 *
 * Usage:
 *   const adapter = createFlatRateTariffAdapter({ buyCentsPerKwh: 25, feedInCentsPerKwh: 5 });
 *   adapterRegistry.registerTariffProvider('flat-rate', adapter);
 *
 * Both rates are optional but at least one must be supplied.
 */
class GenericFlatRateTariffAdapter extends TariffProviderAdapter {
  constructor(config = {}) {
    super();

    this.buyCentsPerKwh = toFiniteNumber(config.buyCentsPerKwh, null);
    this.feedInCentsPerKwh = toFiniteNumber(config.feedInCentsPerKwh, null);
    this.providerType = String(config.providerType || 'flat-rate');

    if (this.buyCentsPerKwh === null && this.feedInCentsPerKwh === null) {
      throw new Error(
        'GenericFlatRateTariffAdapter: buyCentsPerKwh or feedInCentsPerKwh must be supplied'
      );
    }
  }

  // ──── TariffProviderAdapter formal contract ────────────────────────────────

  async getCurrentPrices(_context) {
    return normalizeTariffSnapshot({
      buyCentsPerKwh: this.buyCentsPerKwh,
      feedInCentsPerKwh: this.feedInCentsPerKwh,
      asOfIso: new Date().toISOString(),
      intervals: []
    });
  }

  async getHistoricalPrices(_context, _startIso, _endIso, _resolutionMinutes) {
    // Flat-rate tariffs have no historical variation — return an empty snapshot.
    return normalizeTariffSnapshot({
      buyCentsPerKwh: this.buyCentsPerKwh,
      feedInCentsPerKwh: this.feedInCentsPerKwh,
      asOfIso: new Date().toISOString(),
      intervals: []
    });
  }

  normalizeProviderError(error) {
    return {
      errno: 3210,
      error: error && error.message ? error.message : 'Flat-rate tariff provider error'
    };
  }

  // ──── Automation-cycle-compatible interface ────────────────────────────────

  /**
   * Returns synthetic Amber-shaped price data for the current 30-minute window.
   * Called by `fetchAutomationAmberData` when this adapter is set as the active
   * tariff provider for a user's automation cycle.
   *
   * @returns {{ siteId: string, data: Array }}
   */
  async getCurrentPriceData(_context = {}) {
    const nowIso = new Date().toISOString();
    const data = buildAmberStyleIntervals(nowIso, this.buyCentsPerKwh, this.feedInCentsPerKwh);
    return { siteId: 'flat-rate', data };
  }
}

function createFlatRateTariffAdapter(config = {}) {
  return new GenericFlatRateTariffAdapter(config);
}

module.exports = {
  GenericFlatRateTariffAdapter,
  buildAmberStyleIntervals,
  createFlatRateTariffAdapter
};
