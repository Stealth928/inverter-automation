'use strict';

const { getCurrentAmberPrices } = require('../pricing-normalization');
const {
  TariffProviderAdapter,
  normalizeTariffSnapshot
} = require('./tariff-provider');

const AMBER_CURRENT_NEXT_DEFAULT = 288;

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0];
}

function extractSitesFromResult(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.data)) {
    return result.data;
  }
  if (Array.isArray(result?.sites)) {
    return result.sites;
  }
  if (Array.isArray(result?.result)) {
    return result.result;
  }
  return [];
}

function extractPriceRows(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.result)) {
    return result.result;
  }
  if (Array.isArray(result?.data)) {
    return result.data;
  }
  return [];
}

function normalizeAmberSource(type) {
  const raw = String(type || '').toLowerCase();
  if (raw === 'actualinterval' || raw === 'currentinterval') {
    return 'actual';
  }
  return 'forecast';
}

function normalizeAmberIntervals(priceRows) {
  if (!Array.isArray(priceRows)) {
    return [];
  }

  const intervalMap = new Map();

  for (const row of priceRows) {
    if (!row || typeof row !== 'object') {
      continue;
    }

    const startIso = String(row.startIso || row.startTime || '');
    const endIso = String(row.endIso || row.endTime || '');
    if (!startIso || !endIso) {
      continue;
    }

    const source = normalizeAmberSource(row.type || row.intervalType);
    const key = `${startIso}|${endIso}|${source}`;
    const existing = intervalMap.get(key) || {
      startIso,
      endIso,
      buyCentsPerKwh: null,
      feedInCentsPerKwh: null,
      renewablePct: null,
      source
    };

    const perKwh = toFiniteNumber(row.perKwh, null);
    const channelType = String(row.channelType || '').toLowerCase();
    if (channelType === 'general') {
      existing.buyCentsPerKwh = perKwh;
    } else if (channelType === 'feedin') {
      existing.feedInCentsPerKwh = perKwh === null ? null : -perKwh;
    } else if (existing.buyCentsPerKwh === null) {
      existing.buyCentsPerKwh = perKwh;
    }

    const renewablePct = toFiniteNumber(
      row.renewablePct ?? row.renewables ?? row.renewablePercentage,
      null
    );
    if (existing.renewablePct === null && renewablePct !== null) {
      existing.renewablePct = renewablePct;
    }

    intervalMap.set(key, existing);
  }

  return Array.from(intervalMap.values()).sort((a, b) => {
    const aMs = new Date(a.startIso).getTime();
    const bMs = new Date(b.startIso).getTime();
    return aMs - bMs;
  });
}

function normalizeSiteId(siteRecord) {
  if (!siteRecord || typeof siteRecord !== 'object') {
    return null;
  }
  if (siteRecord.id) {
    return String(siteRecord.id);
  }
  if (siteRecord.siteId) {
    return String(siteRecord.siteId);
  }
  return null;
}

class AmberTariffAdapter extends TariffProviderAdapter {
  constructor(options = {}) {
    super();

    const amberAPI = options.amberAPI;
    const requiredAmberMethods = [
      'callAmberAPI',
      'getCachedAmberSites',
      'getCachedAmberPricesCurrent',
      'cacheAmberSites',
      'cacheAmberPricesCurrent'
    ];
    const missingMethods = requiredAmberMethods.filter(
      (methodName) => !amberAPI || typeof amberAPI[methodName] !== 'function'
    );
    if (missingMethods.length > 0) {
      throw new Error(`AmberTariffAdapter requires amberAPI methods: ${missingMethods.join(', ')}`);
    }

    this.amberAPI = amberAPI;
    this.amberPricesInFlight = options.amberPricesInFlight instanceof Map
      ? options.amberPricesInFlight
      : new Map();
    this.logger = options.logger || console;
    this.currentPriceNextDefault = Number.isFinite(Number(options.currentPriceNextDefault))
      ? Math.floor(Number(options.currentPriceNextDefault))
      : AMBER_CURRENT_NEXT_DEFAULT;
  }

  async getSites(context = {}) {
    const userId = context.userId || null;
    const userConfig = context.userConfig || {};
    const forceRefresh = context.forceRefresh === true;

    if (!forceRefresh && userId) {
      const cachedSites = await this.amberAPI.getCachedAmberSites(userId);
      if (Array.isArray(cachedSites) && cachedSites.length > 0) {
        return cachedSites;
      }
    }

    const siteResult = await this.amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
    const sites = extractSitesFromResult(siteResult);
    if (userId && sites.length > 0) {
      await this.amberAPI.cacheAmberSites(userId, sites);
    }
    return sites;
  }

  async resolveSiteId(context = {}) {
    if (context.siteId) {
      return String(context.siteId);
    }

    if (context.userConfig?.amberSiteId) {
      return String(context.userConfig.amberSiteId);
    }

    const sites = await this.getSites(context);
    if (!Array.isArray(sites) || sites.length === 0) {
      return null;
    }

    return normalizeSiteId(sites[0]);
  }

  async getCurrentPriceData(context = {}) {
    const userId = context.userId || null;
    const userConfig = context.userConfig || {};
    const next = Number.isFinite(Number(context.next))
      ? Math.floor(Number(context.next))
      : this.currentPriceNextDefault;
    const forceRefresh = context.forceRefresh === true;

    const siteId = await this.resolveSiteId(context);
    if (!siteId) {
      return { siteId: null, data: null };
    }

    let result = null;
    if (!forceRefresh && userId) {
      result = await this.amberAPI.getCachedAmberPricesCurrent(siteId, userId, userConfig);
    }

    if (!result) {
      const inflightUserId = userId || 'anonymous';
      const inflightKey = `${inflightUserId}:${siteId}`;

      if (this.amberPricesInFlight.has(inflightKey)) {
        try {
          result = await this.amberPricesInFlight.get(inflightKey);
        } catch (error) {
          if (this.logger && typeof this.logger.warn === 'function') {
            this.logger.warn(
              '[AmberAdapter] In-flight current-price request failed for %s: %s',
              inflightKey,
              error.message
            );
          }
        }
      }

      if (!result) {
        const fetchPromise = this.amberAPI
          .callAmberAPI(
            `/sites/${encodeURIComponent(siteId)}/prices/current`,
            { next },
            userConfig,
            userId
          )
          .then(async (data) => {
            if (userId && Array.isArray(data) && data.length > 0) {
              await this.amberAPI.cacheAmberPricesCurrent(siteId, data, userId, userConfig);
            }
            return data;
          })
          .finally(() => {
            this.amberPricesInFlight.delete(inflightKey);
          });

        this.amberPricesInFlight.set(inflightKey, fetchPromise);
        result = await fetchPromise;
      }
    }

    return {
      siteId,
      data: result
    };
  }

  buildCurrentSnapshot(priceRows = []) {
    const { buyPrice, feedInPrice } = getCurrentAmberPrices(priceRows);
    const normalizedIntervals = normalizeAmberIntervals(priceRows);
    const asOfIso = normalizedIntervals[0]?.startIso || new Date().toISOString();

    return normalizeTariffSnapshot({
      buyCentsPerKwh: buyPrice,
      feedInCentsPerKwh: feedInPrice,
      asOfIso,
      intervals: normalizedIntervals
    });
  }

  async getCurrentPrices(context = {}) {
    const { siteId, data } = await this.getCurrentPriceData(context);
    const priceRows = extractPriceRows(data);
    const snapshot = this.buildCurrentSnapshot(priceRows);
    return {
      ...snapshot,
      siteId
    };
  }

  async getHistoricalPriceData(context = {}, startIso, endIso, resolutionMinutes = 30) {
    const userId = context.userId || null;
    const userConfig = context.userConfig || {};
    const siteId = await this.resolveSiteId(context);
    if (!siteId) {
      return { siteId: null, data: [] };
    }

    const startDate = toDateOnly(startIso);
    const endDate = toDateOnly(endIso);
    if (!startDate || !endDate) {
      return { siteId, data: [] };
    }

    const resolution = Number.isFinite(Number(resolutionMinutes))
      ? Math.floor(Number(resolutionMinutes))
      : 30;

    let historyResult = null;
    const useActualOnly = context.actualOnly === true;

    if (useActualOnly && typeof this.amberAPI.fetchAmberHistoricalPricesActualOnly === 'function') {
      historyResult = await this.amberAPI.fetchAmberHistoricalPricesActualOnly(
        siteId,
        startDate,
        endDate,
        resolution,
        userConfig,
        userId
      );
    } else if (typeof this.amberAPI.fetchAmberHistoricalPricesWithCache === 'function') {
      historyResult = await this.amberAPI.fetchAmberHistoricalPricesWithCache(
        siteId,
        startDate,
        endDate,
        resolution,
        userConfig,
        userId
      );
    } else {
      historyResult = await this.amberAPI.callAmberAPI(
        `/sites/${encodeURIComponent(siteId)}/prices`,
        { startDate, endDate, resolution },
        userConfig,
        userId
      );
    }

    return {
      siteId,
      data: extractPriceRows(historyResult)
    };
  }

  async getHistoricalPrices(context = {}, startIso, endIso, resolutionMinutes = 30) {
    const { siteId, data } = await this.getHistoricalPriceData(
      context,
      startIso,
      endIso,
      resolutionMinutes
    );
    const intervals = normalizeAmberIntervals(data);
    const latestInterval = intervals[intervals.length - 1] || null;

    const snapshot = normalizeTariffSnapshot({
      buyCentsPerKwh: latestInterval ? latestInterval.buyCentsPerKwh : null,
      feedInCentsPerKwh: latestInterval ? latestInterval.feedInCentsPerKwh : null,
      asOfIso: latestInterval ? latestInterval.endIso : new Date().toISOString(),
      intervals
    });

    return {
      ...snapshot,
      siteId
    };
  }

  normalizeProviderError(error) {
    if (!error || typeof error !== 'object') {
      return { errno: 3200, error: 'Amber provider error' };
    }

    const providerErrno = Number(error.errno || error.status || 0);
    if (providerErrno === 429) {
      return { errno: 3201, error: error.error || 'Amber provider rate limited' };
    }
    if (providerErrno === 401 || providerErrno === 403) {
      return { errno: 3202, error: error.error || 'Amber provider authentication failed' };
    }
    if (providerErrno === 408) {
      return { errno: 3203, error: error.error || 'Amber provider timeout' };
    }
    if (providerErrno >= 500) {
      return { errno: 3204, error: error.error || 'Amber provider upstream failure' };
    }

    return {
      errno: 3200,
      error: error.error || error.message || 'Amber provider error'
    };
  }
}

function createAmberTariffAdapter(options = {}) {
  return new AmberTariffAdapter(options);
}

module.exports = {
  AMBER_CURRENT_NEXT_DEFAULT,
  AmberTariffAdapter,
  createAmberTariffAdapter,
  extractPriceRows,
  extractSitesFromResult,
  normalizeAmberIntervals
};
