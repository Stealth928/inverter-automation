'use strict';

const fetch = global.fetch;

const { DEFAULT_GERMANY_MARKET_ID } = require('../lib/pricing-market');
const {
  createGermanyMarketSnapshotRepository,
  createEmptySnapshot
} = require('../lib/repositories/germany-market-snapshot-repository');

if (typeof fetch !== 'function') {
  throw new Error('Global fetch is not available in this runtime.');
}

const GERMANY_BIDDING_ZONE_ID = '10Y1001A1001A82H';
const GERMANY_SUPPORTED_MARKETS = Object.freeze({
  DE: {
    id: DEFAULT_GERMANY_MARKET_ID,
    code: 'DE',
    label: 'Germany',
    displayName: 'Germany Market Data',
    biddingZoneId: GERMANY_BIDDING_ZONE_ID
  }
});

const ENTSOE_DOCUMENT_TYPE_DAY_AHEAD_PRICES = 'A44';
const ENTSOE_API_URL = 'https://web-api.tp.entsoe.eu/api';
const CURRENT_ARCHIVE_CACHE_MS = 5 * 60 * 1000;
const CURRENT_WINDOW_HOURS = 48;
const SNAPSHOT_CADENCE_MINUTES = 15;
const SNAPSHOT_LAG_MINUTES = 5;

const currentMarketCache = new Map();
const currentMarketInFlight = new Map();

function trimString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCdata(value) {
  const text = String(value || '').trim();
  const match = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  return match ? match[1].trim() : text;
}

function getTagBlocks(text, tagName) {
  const regex = new RegExp(`<(?:\\w+:)?${escapeRegex(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegex(tagName)}>`, 'gi');
  const blocks = [];
  let match = regex.exec(String(text || ''));
  while (match) {
    blocks.push(match[1]);
    match = regex.exec(String(text || ''));
  }
  return blocks;
}

function getTagValue(text, tagName) {
  const regex = new RegExp(`<(?:\\w+:)?${escapeRegex(tagName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${escapeRegex(tagName)}>`, 'i');
  const match = regex.exec(String(text || ''));
  return trimString(match ? stripCdata(match[1]) : null);
}

function parseDurationMinutes(rawDuration) {
  const raw = String(rawDuration || '').trim().toUpperCase();
  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match) {
    return 60;
  }
  const hours = Number.parseInt(match[1] || '0', 10);
  const minutes = Number.parseInt(match[2] || '0', 10);
  return Math.max(1, (hours * 60) + minutes);
}

function addMinutesToIso(isoString, minutes) {
  const baseMs = Date.parse(isoString);
  if (!Number.isFinite(baseMs)) {
    return null;
  }
  return new Date(baseMs + (minutes * 60 * 1000)).toISOString();
}

function convertEntsoeEurPerMwhToCentsPerKwh(value) {
  const eurPerMwh = toFiniteNumber(value, null);
  if (eurPerMwh === null) {
    return null;
  }

  return eurPerMwh / 10;
}

function normalizeGermanyMarketId(marketId) {
  const normalized = String(marketId || DEFAULT_GERMANY_MARKET_ID).trim().toUpperCase();
  if (!normalized || normalized === 'GERMANY') {
    return DEFAULT_GERMANY_MARKET_ID;
  }
  return normalized === DEFAULT_GERMANY_MARKET_ID ? DEFAULT_GERMANY_MARKET_ID : DEFAULT_GERMANY_MARKET_ID;
}

function listSupportedGermanyMarkets() {
  return Object.values(GERMANY_SUPPORTED_MARKETS).map((entry) => ({
    id: entry.id,
    market: entry.id,
    siteIdOrRegion: entry.id,
    nmi: entry.displayName,
    network: 'ENTSO-E Day-Ahead',
    name: entry.label,
    displayName: entry.displayName,
    provider: 'germany-market-data'
  }));
}

function floorToUtcHour(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0
  ));
}

function ceilToUtcHour(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const floored = floorToUtcHour(date);
  if (date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0) {
    return floored;
  }
  return new Date(floored.getTime() + (60 * 60 * 1000));
}

function formatEntsoePeriodBoundary(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}`;
}

function readCacheEntry(cacheMap, key) {
  const cached = cacheMap.get(key);
  if (!cached || cached.expiresAtMs <= Date.now()) {
    cacheMap.delete(key);
    return null;
  }
  return cached.value;
}

function storeCacheEntry(cacheMap, key, ttlMs, value) {
  cacheMap.set(key, {
    expiresAtMs: Date.now() + ttlMs,
    value
  });
  return value;
}

async function withInFlight(inFlightMap, key, loader) {
  if (inFlightMap.has(key)) {
    return inFlightMap.get(key);
  }
  const promise = Promise.resolve()
    .then(loader)
    .finally(() => {
      inFlightMap.delete(key);
    });
  inFlightMap.set(key, promise);
  return promise;
}

function buildEntsoeUrl(baseUrl, params) {
  const url = new URL(baseUrl || ENTSOE_API_URL);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function buildCurrentWindowRange(now = new Date()) {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  ));
  const end = new Date(start.getTime() + (CURRENT_WINDOW_HOURS * 60 * 60 * 1000));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function buildQueryWindow(startIso, endIso) {
  const start = floorToUtcHour(startIso);
  const end = ceilToUtcHour(endIso);
  if (!start || !end) {
    return null;
  }
  return {
    start,
    end: end.getTime() <= start.getTime()
      ? new Date(start.getTime() + (60 * 60 * 1000))
      : end
  };
}

function extractEntsoeReasonText(xmlText) {
  const reasonBlock = getTagBlocks(xmlText, 'Reason')[0] || '';
  const reasonText = getTagValue(reasonBlock, 'text');
  const reasonCode = getTagValue(reasonBlock, 'code');
  if (!reasonText && !reasonCode) {
    return null;
  }
  return reasonCode ? `${reasonCode}: ${reasonText || 'Unknown ENTSO-E response reason'}` : reasonText;
}

function parseEntsoePriceDocument(xmlText) {
  const seriesBlocks = getTagBlocks(xmlText, 'TimeSeries');
  const intervalsByKey = new Map();

  for (const seriesBlock of seriesBlocks) {
    const periodBlocks = getTagBlocks(seriesBlock, 'Period');
    for (const periodBlock of periodBlocks) {
      const startIso = getTagValue(periodBlock, 'start');
      const resolutionMinutes = parseDurationMinutes(getTagValue(periodBlock, 'resolution'));
      const pointBlocks = getTagBlocks(periodBlock, 'Point');

      for (const pointBlock of pointBlocks) {
        const position = Number.parseInt(getTagValue(pointBlock, 'position') || '0', 10);
        const marketPrice = convertEntsoeEurPerMwhToCentsPerKwh(getTagValue(pointBlock, 'price.amount'));
        if (!startIso || !Number.isFinite(position) || position <= 0 || marketPrice === null) {
          continue;
        }

        const intervalStartIso = addMinutesToIso(startIso, (position - 1) * resolutionMinutes);
        const intervalEndIso = addMinutesToIso(intervalStartIso, resolutionMinutes);
        if (!intervalStartIso || !intervalEndIso) {
          continue;
        }

        intervalsByKey.set(`${intervalStartIso}|${intervalEndIso}`, {
          startIso: intervalStartIso,
          endIso: intervalEndIso,
          buyCentsPerKwh: marketPrice,
          feedInCentsPerKwh: -marketPrice
        });
      }
    }
  }

  return Array.from(intervalsByKey.values()).sort((left, right) => Date.parse(left.startIso) - Date.parse(right.startIso));
}

function buildLegacyPriceRow({ type, channelType, perKwh, startIso, endIso, marketId, metadata = {} }) {
  return {
    type,
    channelType,
    perKwh,
    spotPerKwh: perKwh,
    startTime: startIso,
    endTime: endIso,
    nemTime: startIso,
    descriptor: null,
    spikeStatus: null,
    advancedPrice: null,
    sourceProvider: 'germany-market-data',
    marketId,
    siteIdOrRegion: marketId,
    ...metadata
  };
}

function getForecastMetadata(forecastRows, asOfIso) {
  const asOfMs = Date.parse(asOfIso);
  const ends = forecastRows
    .map((row) => Date.parse(row.endTime))
    .filter((value) => Number.isFinite(value));
  const latestEndMs = ends.length > 0 ? Math.max(...ends) : NaN;
  return {
    asOf: asOfIso,
    forecastHorizonMinutes: Number.isFinite(asOfMs) && Number.isFinite(latestEndMs)
      ? Math.max(0, Math.round((latestEndMs - asOfMs) / 60000))
      : 0,
    isForecastComplete: forecastRows.length > 0,
    source: 'entsoe'
  };
}

function buildCurrentPayload(marketId, intervals, fetchedAtIso = new Date().toISOString()) {
  const normalizedMarketId = normalizeGermanyMarketId(marketId);
  const sortedIntervals = Array.isArray(intervals)
    ? intervals.slice().sort((left, right) => Date.parse(left.startIso) - Date.parse(right.startIso))
    : [];
  const nowMs = Date.now();
  let currentIndex = sortedIntervals.findIndex((interval) => {
    const startMs = Date.parse(interval.startIso);
    const endMs = Date.parse(interval.endIso);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= nowMs && nowMs < endMs;
  });

  if (currentIndex === -1) {
    currentIndex = sortedIntervals.findIndex((interval) => Date.parse(interval.endIso) > nowMs);
  }
  if (currentIndex === -1 && sortedIntervals.length > 0) {
    currentIndex = sortedIntervals.length - 1;
  }

  const rows = [];
  sortedIntervals.forEach((interval, index) => {
    if (currentIndex === -1 || index < currentIndex) {
      return;
    }

    const type = index === currentIndex ? 'CurrentInterval' : 'ForecastInterval';
    const metadata = {
      asOf: fetchedAtIso,
      currency: 'EUR',
      marketPriceSource: 'ENTSO-E day-ahead',
      marketId: normalizedMarketId
    };

    rows.push(buildLegacyPriceRow({
      type,
      channelType: 'general',
      perKwh: interval.buyCentsPerKwh,
      startIso: interval.startIso,
      endIso: interval.endIso,
      marketId: normalizedMarketId,
      metadata
    }));
    rows.push(buildLegacyPriceRow({
      type,
      channelType: 'feedIn',
      perKwh: interval.feedInCentsPerKwh,
      startIso: interval.startIso,
      endIso: interval.endIso,
      marketId: normalizedMarketId,
      metadata
    }));
  });

  const forecastRows = rows.filter((row) => row.type === 'ForecastInterval' && row.channelType === 'general');
  const asOfIso = rows[0]?.startTime || fetchedAtIso;
  return {
    marketId: normalizedMarketId,
    data: rows,
    metadata: getForecastMetadata(forecastRows, asOfIso)
  };
}

function buildHistoricalLegacyRows(marketId, intervals, startIso, endIso, nowMs = Date.now()) {
  const normalizedMarketId = normalizeGermanyMarketId(marketId);
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [];
  }

  const rows = [];
  const sortedIntervals = Array.isArray(intervals)
    ? intervals.slice().sort((left, right) => Date.parse(left.startIso) - Date.parse(right.startIso))
    : [];

  for (const interval of sortedIntervals) {
    const intervalStartMs = Date.parse(interval.startIso);
    const intervalEndMs = Date.parse(interval.endIso);
    if (!Number.isFinite(intervalStartMs) || !Number.isFinite(intervalEndMs)) {
      continue;
    }
    if (intervalEndMs < startMs || intervalStartMs > endMs) {
      continue;
    }

    const type = intervalEndMs <= nowMs ? 'CurrentInterval' : 'ForecastInterval';
    const metadata = {
      asOf: interval.endIso,
      currency: 'EUR',
      marketPriceSource: 'ENTSO-E day-ahead',
      marketId: normalizedMarketId
    };

    rows.push(buildLegacyPriceRow({
      type,
      channelType: 'general',
      perKwh: interval.buyCentsPerKwh,
      startIso: interval.startIso,
      endIso: interval.endIso,
      marketId: normalizedMarketId,
      metadata
    }));
    rows.push(buildLegacyPriceRow({
      type,
      channelType: 'feedIn',
      perKwh: interval.feedInCentsPerKwh,
      startIso: interval.startIso,
      endIso: interval.endIso,
      marketId: normalizedMarketId,
      metadata
    }));
  }

  return rows;
}

function init(dependencies = {}) {
  const _db = dependencies.db;
  const getConfig = dependencies.getConfig || (() => ({}));
  const serverTimestamp = dependencies.serverTimestamp || (() => new Date());
  const snapshotRepository = _db && typeof _db.collection === 'function'
    ? createGermanyMarketSnapshotRepository({ db: _db, serverTimestamp })
    : null;

  function getEntsoeConfig() {
    const config = getConfig() || {};
    return {
      baseUrl: trimString(config?.entsoe?.baseUrl) || ENTSOE_API_URL,
      securityToken: trimString(config?.entsoe?.securityToken || process.env.ENTSOE_SECURITY_TOKEN)
    };
  }

  function getGermanyCacheTtl(userConfig = {}) {
    const config = getConfig() || {};
    return userConfig?.cache?.germanyMarketData
      || config?.automation?.cacheTtl?.germanyMarketData
      || config?.automation?.cacheTtl?.aemo
      || CURRENT_ARCHIVE_CACHE_MS;
  }

  async function fetchText(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/xml,text/xml,*/*'
        }
      });
      if (!response.ok) {
        throw new Error(`ENTSO-E request failed with HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchEntsoeDayAheadPrices(startIso, endIso) {
    const entsoeConfig = getEntsoeConfig();
    if (!entsoeConfig.securityToken) {
      throw new Error('ENTSO-E security token is not configured');
    }

    const market = GERMANY_SUPPORTED_MARKETS[DEFAULT_GERMANY_MARKET_ID];
    const queryWindow = buildQueryWindow(startIso, endIso);
    if (!queryWindow) {
      return [];
    }

    const url = buildEntsoeUrl(entsoeConfig.baseUrl, {
      securityToken: entsoeConfig.securityToken,
      documentType: ENTSOE_DOCUMENT_TYPE_DAY_AHEAD_PRICES,
      in_Domain: market.biddingZoneId,
      out_Domain: market.biddingZoneId,
      periodStart: formatEntsoePeriodBoundary(queryWindow.start),
      periodEnd: formatEntsoePeriodBoundary(queryWindow.end)
    });
    const xmlText = await fetchText(url);
    const intervals = parseEntsoePriceDocument(xmlText);
    if (intervals.length === 0) {
      const reason = extractEntsoeReasonText(xmlText);
      if (reason) {
        throw new Error(`ENTSO-E returned no price intervals: ${reason}`);
      }
    }
    return intervals;
  }

  function buildEmptyCurrentPayload(marketId) {
    const empty = createEmptySnapshot(marketId);
    return {
      marketId: empty.marketId,
      data: empty.data,
      metadata: empty.metadata
    };
  }

  async function readStoredCurrentPriceData(context = {}) {
    const marketId = normalizeGermanyMarketId(context.marketId || context.siteId || context.siteIdOrRegion || context.userConfig?.siteIdOrRegion);
    const ttlMs = getGermanyCacheTtl(context.userConfig);
    const cached = readCacheEntry(currentMarketCache, marketId);
    if (cached) {
      return cached;
    }

    return withInFlight(currentMarketInFlight, marketId, async () => {
      const snapshot = snapshotRepository
        ? await snapshotRepository.getCurrentSnapshot(marketId)
        : buildEmptyCurrentPayload(marketId);
      const payload = {
        marketId,
        data: Array.isArray(snapshot?.data) ? snapshot.data : [],
        metadata: snapshot?.metadata && typeof snapshot.metadata === 'object'
          ? snapshot.metadata
          : buildEmptyCurrentPayload(marketId).metadata
      };
      return storeCacheEntry(currentMarketCache, marketId, ttlMs, payload);
    });
  }

  async function storeCurrentPricePayload(payload, context = {}) {
    const marketId = normalizeGermanyMarketId(payload?.marketId);
    const normalizedPayload = {
      marketId,
      data: Array.isArray(payload?.data) ? payload.data : [],
      metadata: payload?.metadata && typeof payload.metadata === 'object'
        ? payload.metadata
        : buildEmptyCurrentPayload(marketId).metadata
    };
    const nextAsOf = trimString(normalizedPayload.metadata?.asOf);
    let storedPayload = normalizedPayload;
    let previousAsOf = null;
    let updated = true;

    if (snapshotRepository) {
      const existing = await snapshotRepository.getCurrentSnapshot(marketId);
      previousAsOf = trimString(existing?.metadata?.asOf);
      const existingHasRows = Array.isArray(existing?.data) && existing.data.length > 0;
      const nextHasRows = normalizedPayload.data.length > 0;
      const previousMs = Date.parse(previousAsOf);
      const nextMs = Date.parse(nextAsOf);
      const shouldPersist = nextHasRows && (
        !previousAsOf
        || !nextAsOf
        || !Number.isFinite(previousMs)
        || !Number.isFinite(nextMs)
        || nextMs >= previousMs
      );

      if (shouldPersist) {
        storedPayload = await snapshotRepository.saveCurrentSnapshot(normalizedPayload, {
          cadenceMinutes: SNAPSHOT_CADENCE_MINUTES,
          lagMinutes: SNAPSHOT_LAG_MINUTES
        });
      } else if (existingHasRows) {
        storedPayload = existing;
        updated = false;
      } else {
        updated = false;
      }
    }

    storeCacheEntry(currentMarketCache, marketId, getGermanyCacheTtl(context.userConfig), storedPayload);

    return {
      marketId,
      updated,
      payload: storedPayload,
      previousAsOf,
      currentAsOf: trimString(storedPayload?.metadata?.asOf)
    };
  }

  async function refreshCurrentPriceData(context = {}) {
    const marketId = normalizeGermanyMarketId(context.marketId || context.siteId || context.siteIdOrRegion || context.userConfig?.siteIdOrRegion);
    const currentWindow = buildCurrentWindowRange();
    const intervals = await fetchEntsoeDayAheadPrices(currentWindow.startIso, currentWindow.endIso);
    const payload = buildCurrentPayload(marketId, intervals, new Date().toISOString());
    return storeCurrentPricePayload(payload, context);
  }

  async function refreshAllCurrentPriceData(context = {}) {
    try {
      return [await refreshCurrentPriceData({ ...context, marketId: DEFAULT_GERMANY_MARKET_ID })];
    } catch (error) {
      return [{
        marketId: DEFAULT_GERMANY_MARKET_ID,
        updated: false,
        payload: buildEmptyCurrentPayload(DEFAULT_GERMANY_MARKET_ID),
        previousAsOf: null,
        currentAsOf: null,
        error: error && error.message ? error.message : String(error || 'Unknown error')
      }];
    }
  }

  async function getCurrentPriceData(context = {}) {
    return readStoredCurrentPriceData(context);
  }

  async function getHistoricalPriceData(context = {}, startIso, endIso) {
    const marketId = normalizeGermanyMarketId(context.marketId || context.siteId || context.siteIdOrRegion || context.userConfig?.siteIdOrRegion);
    if (!trimString(startIso) || !trimString(endIso)) {
      return { marketId, data: [] };
    }

    const intervals = await fetchEntsoeDayAheadPrices(startIso, endIso);
    return {
      marketId,
      data: buildHistoricalLegacyRows(marketId, intervals, startIso, endIso)
    };
  }

  async function getActualPriceAtTimestamp(context = {}, timestampIso) {
    const marketId = normalizeGermanyMarketId(context.marketId || context.siteId || context.siteIdOrRegion || context.userConfig?.siteIdOrRegion);
    const targetIso = trimString(timestampIso);
    if (!targetIso) {
      return { marketId, result: null };
    }

    const targetDate = new Date(targetIso);
    if (Number.isNaN(targetDate.getTime())) {
      return { marketId, result: null };
    }

    const dayStartIso = new Date(Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate(),
      0,
      0,
      0,
      0
    )).toISOString();
    const dayEndIso = new Date(Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate(),
      23,
      59,
      59,
      999
    )).toISOString();
    const history = await getHistoricalPriceData({ ...context, marketId }, dayStartIso, dayEndIso);
    const targetMs = Date.parse(targetIso);
    const matching = (history.data || []).find((row) => {
      if (row.channelType !== 'general') return false;
      const startMs = Date.parse(row.startTime);
      const endMs = Date.parse(row.endTime);
      return Number.isFinite(startMs) && Number.isFinite(endMs) && targetMs >= startMs && targetMs <= endMs;
    }) || null;
    return {
      marketId,
      result: matching
    };
  }

  return {
    DEFAULT_GERMANY_MARKET_ID,
    GERMANY_SUPPORTED_MARKETS,
    convertEntsoeEurPerMwhToCentsPerKwh,
    getActualPriceAtTimestamp,
    getCurrentPriceData,
    getGermanyCacheTtl,
    getHistoricalPriceData,
    listSupportedGermanyMarkets,
    normalizeGermanyMarketId,
    refreshAllCurrentPriceData,
    refreshCurrentPriceData
  };
}

module.exports = {
  DEFAULT_GERMANY_MARKET_ID,
  ENTSOE_API_URL,
  GERMANY_SUPPORTED_MARKETS,
  buildCurrentPayload,
  buildHistoricalLegacyRows,
  convertEntsoeEurPerMwhToCentsPerKwh,
  formatEntsoePeriodBoundary,
  init,
  listSupportedGermanyMarkets,
  normalizeGermanyMarketId,
  parseEntsoePriceDocument
};