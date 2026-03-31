'use strict';

const { getCurrentAmberPrices } = require('../pricing-normalization');
const { normalizeAmberIntervals } = require('./amber-adapter');
const {
  TariffProviderAdapter,
  normalizeTariffSnapshot
} = require('./tariff-provider');

class GermanyMarketDataTariffAdapter extends TariffProviderAdapter {
  constructor(options = {}) {
    super();

    const germanyMarketAPI = options.germanyMarketAPI;
    const requiredMethods = [
      'getCurrentPriceData',
      'getHistoricalPriceData',
      'listSupportedGermanyMarkets',
      'normalizeGermanyMarketId'
    ];
    const missing = requiredMethods.filter((methodName) => !germanyMarketAPI || typeof germanyMarketAPI[methodName] !== 'function');
    if (missing.length > 0) {
      throw new Error(`GermanyMarketDataTariffAdapter requires germanyMarketAPI methods: ${missing.join(', ')}`);
    }

    this.germanyMarketAPI = germanyMarketAPI;
  }

  getMarkets() {
    return this.germanyMarketAPI.listSupportedGermanyMarkets();
  }

  resolveMarketId(context = {}) {
    return this.germanyMarketAPI.normalizeGermanyMarketId(
      context.marketId
      || context.regionId
      || context.siteId
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
    const marketId = this.resolveMarketId(context);
    const { forceRefresh: _forceRefresh, ...safeContext } = context || {};
    return this.germanyMarketAPI.getCurrentPriceData({ ...safeContext, marketId });
  }

  async getCurrentPrices(context = {}) {
    const marketId = this.resolveMarketId(context);
    const { data } = await this.getCurrentPriceData({ ...context, marketId });
    return {
      ...this.buildSnapshot(data),
      siteId: marketId,
      marketId
    };
  }

  async getHistoricalPriceData(context = {}, startIso, endIso, _resolutionMinutes = 60) {
    const marketId = this.resolveMarketId(context);
    return this.germanyMarketAPI.getHistoricalPriceData({ ...context, marketId }, startIso, endIso);
  }

  async getHistoricalPrices(context = {}, startIso, endIso, resolutionMinutes = 60) {
    const marketId = this.resolveMarketId(context);
    const { data } = await this.getHistoricalPriceData({ ...context, marketId }, startIso, endIso, resolutionMinutes);
    return {
      ...this.buildSnapshot(data),
      siteId: marketId,
      marketId
    };
  }

  normalizeProviderError(error) {
    if (!error || typeof error !== 'object') {
      return { errno: 3400, error: 'Germany market data provider error' };
    }

    const providerErrno = Number(error.errno || error.status || 0);
    if (providerErrno === 408) {
      return { errno: 3403, error: error.error || 'Germany market data provider timeout' };
    }
    if (providerErrno >= 500) {
      return { errno: 3404, error: error.error || 'Germany market data upstream failure' };
    }

    return {
      errno: 3400,
      error: error.error || error.message || 'Germany market data provider error'
    };
  }
}

function createGermanyMarketDataTariffAdapter(options = {}) {
  return new GermanyMarketDataTariffAdapter(options);
}

module.exports = {
  GermanyMarketDataTariffAdapter,
  createGermanyMarketDataTariffAdapter
};