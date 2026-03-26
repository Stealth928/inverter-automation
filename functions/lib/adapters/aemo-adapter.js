'use strict';

const { getCurrentAmberPrices } = require('../pricing-normalization');
const { normalizeAmberIntervals } = require('./amber-adapter');
const {
  TariffProviderAdapter,
  normalizeTariffSnapshot
} = require('./tariff-provider');

class AemoTariffAdapter extends TariffProviderAdapter {
  constructor(options = {}) {
    super();

    const aemoAPI = options.aemoAPI;
    const requiredMethods = [
      'getCurrentPriceData',
      'getHistoricalPriceData',
      'listSupportedAemoRegions',
      'normalizeAemoRegion'
    ];
    const missing = requiredMethods.filter((methodName) => !aemoAPI || typeof aemoAPI[methodName] !== 'function');
    if (missing.length > 0) {
      throw new Error(`AemoTariffAdapter requires aemoAPI methods: ${missing.join(', ')}`);
    }

    this.aemoAPI = aemoAPI;
  }

  getRegions() {
    return this.aemoAPI.listSupportedAemoRegions();
  }

  resolveRegionId(context = {}) {
    return this.aemoAPI.normalizeAemoRegion(
      context.regionId
      || context.siteId
      || context.userConfig?.aemoRegion
      || context.userConfig?.siteIdOrRegion
    );
  }

  buildSnapshot(priceRows = []) {
    const { buyPrice, feedInPrice } = getCurrentAmberPrices(priceRows);
    const intervals = normalizeAmberIntervals(priceRows);
    return normalizeTariffSnapshot({
      buyCentsPerKwh: buyPrice,
      feedInCentsPerKwh: feedInPrice,
      asOfIso: intervals[0]?.startIso || new Date().toISOString(),
      intervals
    });
  }

  async getCurrentPriceData(context = {}) {
    const regionId = this.resolveRegionId(context);
    const { forceRefresh: _forceRefresh, ...safeContext } = context || {};
    return this.aemoAPI.getCurrentPriceData({ ...safeContext, regionId });
  }

  async getCurrentPrices(context = {}) {
    const regionId = this.resolveRegionId(context);
    const { data } = await this.getCurrentPriceData({ ...context, regionId });
    return {
      ...this.buildSnapshot(data),
      siteId: regionId,
      regionId
    };
  }

  async getHistoricalPriceData(context = {}, startIso, endIso, _resolutionMinutes = 5) {
    const regionId = this.resolveRegionId(context);
    return this.aemoAPI.getHistoricalPriceData({ ...context, regionId }, startIso, endIso);
  }

  async getHistoricalPrices(context = {}, startIso, endIso, resolutionMinutes = 5) {
    const regionId = this.resolveRegionId(context);
    const { data } = await this.getHistoricalPriceData({ ...context, regionId }, startIso, endIso, resolutionMinutes);
    return {
      ...this.buildSnapshot(data),
      siteId: regionId,
      regionId
    };
  }

  normalizeProviderError(error) {
    if (!error || typeof error !== 'object') {
      return { errno: 3300, error: 'AEMO provider error' };
    }

    const providerErrno = Number(error.errno || error.status || 0);
    if (providerErrno === 408) {
      return { errno: 3303, error: error.error || 'AEMO provider timeout' };
    }
    if (providerErrno >= 500) {
      return { errno: 3304, error: error.error || 'AEMO provider upstream failure' };
    }

    return {
      errno: 3300,
      error: error.error || error.message || 'AEMO provider error'
    };
  }
}

function createAemoTariffAdapter(options = {}) {
  return new AemoTariffAdapter(options);
}

module.exports = {
  AemoTariffAdapter,
  createAemoTariffAdapter
};
