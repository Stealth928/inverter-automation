'use strict';

const fetch = global.fetch;
const unzipper = require('unzipper');
const { parse } = require('csv-parse/sync');
const {
  createAemoSnapshotRepository,
  createEmptySnapshot
} = require('../lib/repositories/aemo-snapshot-repository');

if (typeof fetch !== 'function') {
  throw new Error('Global fetch is not available in this runtime.');
}

const AEMO_SUPPORTED_REGIONS = Object.freeze({
  NSW1: { id: 'NSW1', code: 'NSW', label: 'New South Wales' },
  QLD1: { id: 'QLD1', code: 'QLD', label: 'Queensland' },
  VIC1: { id: 'VIC1', code: 'VIC', label: 'Victoria' },
  SA1: { id: 'SA1', code: 'SA', label: 'South Australia' },
  TAS1: { id: 'TAS1', code: 'TAS', label: 'Tasmania' }
});

const DEFAULT_AEMO_REGION = 'NSW1';
const MARKET_TIME_OFFSET = '+10:00';
const DISPATCH_LISTING_URL = 'https://www.nemweb.com.au/REPORTS/CURRENT/DispatchIS_Reports/';
const PREDISPATCH_LISTING_URL = 'https://www.nemweb.com.au/REPORTS/CURRENT/PredispatchIS_Reports/';
const PRICE_AND_DEMAND_URL = 'https://www.aemo.com.au/aemo/data/nem/priceanddemand';
const CURRENT_ARCHIVE_CACHE_MS = 60 * 1000;
const LISTING_CACHE_MS = 30 * 1000;
const MONTHLY_CACHE_MS = 30 * 60 * 1000;
const ACTUAL_INTERVAL_MINUTES = 5;
const FORECAST_BLOCK_MINUTES = 30;

const latestArchiveCache = new Map();
const latestArchiveInFlight = new Map();
const monthlyCsvCache = new Map();
const monthlyCsvInFlight = new Map();
const currentRegionCache = new Map();
const currentRegionInFlight = new Map();

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

function convertAemoRrpToCentsPerKwh(value) {
  const rrpPerMwh = toFiniteNumber(value, null);
  if (rrpPerMwh === null) {
    return null;
  }

  // AEMO RRP values are published in $/MWh; divide by 10 to get c/kWh.
  return rrpPerMwh / 10;
}

function normalizeAemoRegion(regionId) {
  const normalized = String(regionId || DEFAULT_AEMO_REGION).trim().toUpperCase();
  return AEMO_SUPPORTED_REGIONS[normalized] ? normalized : null;
}

function listSupportedAemoRegions() {
  return Object.values(AEMO_SUPPORTED_REGIONS).map((entry) => ({
    id: entry.id,
    region: entry.id,
    nmi: entry.id,
    network: 'AEMO',
    name: entry.label,
    displayName: `${entry.label} (${entry.id})`,
    siteIdOrRegion: entry.id,
    provider: 'aemo'
  }));
}

function parseMarketDateTimeToIso(value) {
  const raw = trimString(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const isoWithOffset = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${MARKET_TIME_OFFSET}`;
  const timestampMs = Date.parse(isoWithOffset);
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

function addMinutesToIso(isoString, minutes) {
  const baseMs = Date.parse(isoString);
  if (!Number.isFinite(baseMs)) {
    return null;
  }
  return new Date(baseMs + minutes * 60 * 1000).toISOString();
}

function toDateOnlyIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildArchiveHrefPattern(prefix) {
  return new RegExp(`href="([^"]*${prefix}[^"]*\\.zip)"`, 'gi');
}

function extractLatestArchiveUrl(listingHtml, listingUrl, prefix) {
  const regex = buildArchiveHrefPattern(prefix);
  const matches = [];
  let match = regex.exec(listingHtml);
  while (match) {
    matches.push(match[1]);
    match = regex.exec(listingHtml);
  }
  if (matches.length === 0) {
    return null;
  }
  return new URL(matches[matches.length - 1], listingUrl).toString();
}

function parseCsvLine(line) {
  return parse(line, {
    bom: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: false
  })[0] || [];
}

function parseSectionedCsv(text, wantedSections = null) {
  const headerMap = new Map();
  const recordsBySection = new Map();
  const wanted = wantedSections instanceof Set ? wantedSections : null;
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line) continue;
    const row = parseCsvLine(line);
    if (!Array.isArray(row) || row.length < 4) continue;
    const rowType = String(row[0] || '').trim().toUpperCase();
    const sectionKey = `${String(row[1] || '').trim()}|${String(row[2] || '').trim()}|${String(row[3] || '').trim()}`;

    if (rowType === 'I') {
      headerMap.set(sectionKey, row.slice(4));
      continue;
    }

    if (rowType !== 'D') continue;
    if (wanted && !wanted.has(sectionKey)) continue;

    const headers = headerMap.get(sectionKey);
    if (!Array.isArray(headers) || headers.length === 0) continue;

    const values = row.slice(4);
    const record = {};
    for (let index = 0; index < headers.length; index += 1) {
      const header = String(headers[index] || '').trim();
      if (!header) continue;
      record[header] = values[index] !== undefined ? values[index] : '';
    }

    if (!recordsBySection.has(sectionKey)) {
      recordsBySection.set(sectionKey, []);
    }
    recordsBySection.get(sectionKey).push(record);
  }

  return recordsBySection;
}

function buildLegacyPriceRow({ type, channelType, perKwh, startIso, endIso, regionId, metadata = {} }) {
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
    sourceProvider: 'aemo',
    regionId,
    siteIdOrRegion: regionId,
    ...metadata
  };
}

function buildCurrentLegacyRows(regionId, priceRecord, demandRecord) {
  if (!priceRecord) {
    return [];
  }

  const endIso = parseMarketDateTimeToIso(priceRecord.SETTLEMENTDATE);
  const startIso = addMinutesToIso(endIso, -ACTUAL_INTERVAL_MINUTES);
  const rrp = convertAemoRrpToCentsPerKwh(priceRecord.RRP);
  if (!startIso || !endIso || rrp === null) {
    return [];
  }

  const metadata = {
    asOf: endIso,
    demand: toFiniteNumber(demandRecord?.TOTALDEMAND, null),
    demandForecast: toFiniteNumber(demandRecord?.DEMANDFORECAST, null),
    aemoIntervalType: 'dispatch',
    aemoLastChanged: trimString(priceRecord.LASTCHANGED)
  };

  return [
    buildLegacyPriceRow({
      type: 'CurrentInterval',
      channelType: 'general',
      perKwh: rrp,
      startIso,
      endIso,
      regionId,
      metadata
    }),
    buildLegacyPriceRow({
      type: 'CurrentInterval',
      channelType: 'feedIn',
      perKwh: -rrp,
      startIso,
      endIso,
      regionId,
      metadata
    })
  ];
}

function buildPredispatchLegacyRows(regionId, priceRows, demandRows) {
  if (!Array.isArray(priceRows) || priceRows.length === 0) {
    return [];
  }

  const demandByDateTime = new Map(
    (Array.isArray(demandRows) ? demandRows : []).map((row) => [String(row.DATETIME || ''), row])
  );
  const sortedPriceRows = priceRows
    .map((row) => ({
      ...row,
      __endIso: parseMarketDateTimeToIso(row.DATETIME)
    }))
    .filter((row) => row.__endIso)
    .sort((left, right) => Date.parse(left.__endIso) - Date.parse(right.__endIso));

  const legacyRows = [];
  let previousEndIso = null;

  for (const priceRow of sortedPriceRows) {
    const demandRow = demandByDateTime.get(String(priceRow.DATETIME || '')) || null;
    const endIso = priceRow.__endIso;
    const previousEndMs = Date.parse(previousEndIso);
    const endMs = Date.parse(endIso);
    const startIso = Number.isFinite(previousEndMs) && previousEndMs < endMs
      ? previousEndIso
      : addMinutesToIso(endIso, -FORECAST_BLOCK_MINUTES);
    const rrp = convertAemoRrpToCentsPerKwh(priceRow.RRP);

    if (!startIso || rrp === null) {
      previousEndIso = endIso;
      continue;
    }

    const metadata = {
      asOf: endIso,
      demand: toFiniteNumber(demandRow?.TOTALDEMAND, null),
      demandForecast: toFiniteNumber(demandRow?.DEMANDFORECAST, null),
      aemoIntervalType: 'predispatch',
      aemoLastChanged: trimString(priceRow.LASTCHANGED || demandRow?.LASTCHANGED),
      periodId: trimString(priceRow.PERIODID || demandRow?.PERIODID)
    };

    legacyRows.push(buildLegacyPriceRow({
      type: 'ForecastInterval',
      channelType: 'general',
      perKwh: rrp,
      startIso,
      endIso,
      regionId,
      metadata
    }));
    legacyRows.push(buildLegacyPriceRow({
      type: 'ForecastInterval',
      channelType: 'feedIn',
      perKwh: -rrp,
      startIso,
      endIso,
      regionId,
      metadata
    }));

    previousEndIso = endIso;
  }

  return legacyRows;
}

function buildHistoricalLegacyRows(regionId, rows, startIso, endIso) {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [];
  }

  const legacyRows = [];

  for (const row of rows) {
    const rowRegion = normalizeAemoRegion(row.REGION);
    if (rowRegion !== regionId) continue;

    const rowEndIso = parseMarketDateTimeToIso(row.SETTLEMENTDATE);
    const rowStartIso = addMinutesToIso(rowEndIso, -ACTUAL_INTERVAL_MINUTES);
    const rowStartMs = Date.parse(rowStartIso);
    const rowEndMs = Date.parse(rowEndIso);
    if (!Number.isFinite(rowStartMs) || rowEndMs < startMs || rowStartMs > endMs) {
      continue;
    }

    const rrp = convertAemoRrpToCentsPerKwh(row.RRP);
    if (rrp === null) continue;

    const metadata = {
      asOf: rowEndIso,
      demand: toFiniteNumber(row.TOTALDEMAND, null),
      aemoIntervalType: trimString(row.PERIODTYPE) || 'trade'
    };

    legacyRows.push(buildLegacyPriceRow({
      type: 'CurrentInterval',
      channelType: 'general',
      perKwh: rrp,
      startIso: rowStartIso,
      endIso: rowEndIso,
      regionId,
      metadata
    }));
    legacyRows.push(buildLegacyPriceRow({
      type: 'CurrentInterval',
      channelType: 'feedIn',
      perKwh: -rrp,
      startIso: rowStartIso,
      endIso: rowEndIso,
      regionId,
      metadata
    }));
  }

  return legacyRows.sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
}

function getForecastMetadata(forecastRows, asOfIso) {
  const starts = forecastRows
    .map((row) => Date.parse(row.startTime))
    .filter((value) => Number.isFinite(value));
  const ends = forecastRows
    .map((row) => Date.parse(row.endTime))
    .filter((value) => Number.isFinite(value));
  const asOfMs = Date.parse(asOfIso);
  const latestEndMs = ends.length > 0 ? Math.max(...ends) : NaN;
  return {
    asOf: asOfIso,
    forecastHorizonMinutes: Number.isFinite(asOfMs) && Number.isFinite(latestEndMs)
      ? Math.max(0, Math.round((latestEndMs - asOfMs) / 60000))
      : 0,
    isForecastComplete: starts.length > 0,
    source: 'aemo'
  };
}

function buildCurrentPayload(regionId, dispatchPriceRows, dispatchDemandRows, predispatchPriceRows, predispatchDemandRows) {
  const currentPriceRow = Array.isArray(dispatchPriceRows) ? dispatchPriceRows.find((row) => normalizeAemoRegion(row.REGIONID) === regionId) : null;
  const currentDemandRow = Array.isArray(dispatchDemandRows) ? dispatchDemandRows.find((row) => normalizeAemoRegion(row.REGIONID) === regionId) : null;
  const currentRows = buildCurrentLegacyRows(regionId, currentPriceRow, currentDemandRow);
  const forecastPriceRows = Array.isArray(predispatchPriceRows)
    ? predispatchPriceRows.filter((row) => normalizeAemoRegion(row.REGIONID) === regionId)
    : [];
  const forecastDemandRows = Array.isArray(predispatchDemandRows)
    ? predispatchDemandRows.filter((row) => normalizeAemoRegion(row.REGIONID) === regionId)
    : [];
  const forecastRows = buildPredispatchLegacyRows(regionId, forecastPriceRows, forecastDemandRows);
  const rows = [...currentRows, ...forecastRows];
  const asOfIso = currentRows[0]?.asOf || forecastRows[0]?.asOf || currentRows[0]?.endTime || forecastRows[0]?.endTime || new Date().toISOString();

  return {
    regionId,
    data: rows,
    metadata: getForecastMetadata(forecastRows, asOfIso)
  };
}

function buildMonthlyPriceAndDemandUrl(monthKey, regionId) {
  return `${PRICE_AND_DEMAND_URL}/PRICE_AND_DEMAND_${monthKey}_${regionId}.csv`;
}

function listMonthKeysBetween(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }

  const keys = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endCursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor <= endCursor) {
    keys.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return keys;
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

function init(dependencies = {}) {
  const _db = dependencies.db;
  const _logger = dependencies.logger || console;
  const getConfig = dependencies.getConfig || (() => ({}));
  const incrementApiCount = dependencies.incrementApiCount;
  const serverTimestamp = dependencies.serverTimestamp || (() => new Date());
  const snapshotRepository = _db && typeof _db.collection === 'function'
    ? createAemoSnapshotRepository({ db: _db, serverTimestamp })
    : null;

  async function fetchText(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html,text/plain,text/csv,application/zip,*/*'
        }
      });
      if (!response.ok) {
        throw new Error(`AEMO request failed with HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchBuffer(url, timeoutMs = 20000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/zip,*/*'
        }
      });
      if (!response.ok) {
        throw new Error(`AEMO archive request failed with HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchLatestArchiveUrl(listingUrl, prefix) {
    const cacheKey = `${listingUrl}|${prefix}`;
    const cached = readCacheEntry(latestArchiveCache, cacheKey);
    if (cached) {
      return cached;
    }

    return withInFlight(latestArchiveInFlight, cacheKey, async () => {
      const html = await fetchText(listingUrl);
      const latestUrl = extractLatestArchiveUrl(html, listingUrl, prefix);
      if (!latestUrl) {
        throw new Error(`Could not find AEMO archive for prefix ${prefix}`);
      }
      return storeCacheEntry(latestArchiveCache, cacheKey, LISTING_CACHE_MS, latestUrl);
    });
  }

  async function fetchArchiveCsvText(archiveUrl) {
    const archiveBuffer = await fetchBuffer(archiveUrl);
    const zip = await unzipper.Open.buffer(archiveBuffer);
    const csvEntry = zip.files.find((entry) => /\.csv$/i.test(entry.path));
    if (!csvEntry) {
      throw new Error(`AEMO archive ${archiveUrl} did not contain a CSV payload`);
    }
    const csvBuffer = await csvEntry.buffer();
    return csvBuffer.toString('utf8');
  }

  function getAemoCacheTtl(userConfig = {}) {
    const config = getConfig();
    return userConfig?.cache?.aemo
      || userConfig?.cache?.amber
      || config?.automation?.cacheTtl?.aemo
      || config?.automation?.cacheTtl?.amber
      || CURRENT_ARCHIVE_CACHE_MS;
  }

  function buildEmptyCurrentPayload(regionId) {
    const empty = createEmptySnapshot(regionId);
    return {
      regionId: empty.regionId,
      data: empty.data,
      metadata: empty.metadata
    };
  }

  async function fetchLatestDispatchSections(userId) {
    const archiveUrl = await fetchLatestArchiveUrl(DISPATCH_LISTING_URL, 'PUBLIC_DISPATCHIS_');
    if (userId && incrementApiCount) {
      incrementApiCount(userId, 'aemo').catch(() => {});
    }
    const csvText = await fetchArchiveCsvText(archiveUrl);
    const sections = parseSectionedCsv(csvText, new Set(['DISPATCH|PRICE|5', 'DISPATCH|REGIONSUM|9']));
    return {
      dispatchPrices: sections.get('DISPATCH|PRICE|5') || [],
      dispatchDemand: sections.get('DISPATCH|REGIONSUM|9') || []
    };
  }

  async function fetchLatestPredispatchSections(userId) {
    const archiveUrl = await fetchLatestArchiveUrl(PREDISPATCH_LISTING_URL, 'PUBLIC_PREDISPATCHIS_');
    if (userId && incrementApiCount) {
      incrementApiCount(userId, 'aemo').catch(() => {});
    }
    const csvText = await fetchArchiveCsvText(archiveUrl);
    const sections = parseSectionedCsv(csvText, new Set(['PREDISPATCH|REGION_PRICES|2', 'PREDISPATCH|REGION_SOLUTION|9']));
    return {
      predispatchPrices: sections.get('PREDISPATCH|REGION_PRICES|2') || [],
      predispatchDemand: sections.get('PREDISPATCH|REGION_SOLUTION|9') || []
    };
  }

  async function fetchCurrentPayloadsFromUpstream(userId = null) {
    // Process the two large archives sequentially so the scheduler does not
    // hold both expanded CSV payloads in memory at the same time.
    const { dispatchPrices, dispatchDemand } = await fetchLatestDispatchSections(userId);
    const { predispatchPrices, predispatchDemand } = await fetchLatestPredispatchSections(userId);

    const payloads = new Map();
    for (const regionId of Object.keys(AEMO_SUPPORTED_REGIONS)) {
      payloads.set(
        regionId,
        buildCurrentPayload(regionId, dispatchPrices, dispatchDemand, predispatchPrices, predispatchDemand)
      );
    }
    return payloads;
  }

  async function fetchMonthlyRows(monthKey, regionId, userId) {
    const cacheKey = `${monthKey}|${regionId}`;
    const cached = readCacheEntry(monthlyCsvCache, cacheKey);
    if (cached) {
      return cached;
    }

    return withInFlight(monthlyCsvInFlight, cacheKey, async () => {
      if (userId && incrementApiCount) {
        incrementApiCount(userId, 'aemo').catch(() => {});
      }
      const text = await fetchText(buildMonthlyPriceAndDemandUrl(monthKey, regionId), 20000);
      const rows = parse(text, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        relax_quotes: true,
        trim: true
      });
      return storeCacheEntry(monthlyCsvCache, cacheKey, MONTHLY_CACHE_MS, rows);
    });
  }

  async function readStoredCurrentPriceData(context = {}) {
    const regionId = normalizeAemoRegion(context.regionId || context.userConfig?.aemoRegion || context.userConfig?.siteIdOrRegion);
    if (!regionId) {
      return buildEmptyCurrentPayload(null);
    }

    const ttlMs = getAemoCacheTtl(context.userConfig);
    const cacheKey = `${regionId}`;
    const cached = readCacheEntry(currentRegionCache, cacheKey);
    if (cached) {
      return cached;
    }

    return withInFlight(currentRegionInFlight, cacheKey, async () => {
      const snapshot = snapshotRepository
        ? await snapshotRepository.getCurrentSnapshot(regionId)
        : buildEmptyCurrentPayload(regionId);
      const payload = {
        regionId,
        data: Array.isArray(snapshot?.data) ? snapshot.data : [],
        metadata: snapshot?.metadata && typeof snapshot.metadata === 'object'
          ? snapshot.metadata
          : buildEmptyCurrentPayload(regionId).metadata
      };
      return storeCacheEntry(currentRegionCache, cacheKey, ttlMs, payload);
    });
  }

  async function storeCurrentPricePayload(payload, context = {}) {
    const regionId = normalizeAemoRegion(payload?.regionId);
    if (!regionId) {
      return {
        regionId: null,
        updated: false,
        payload: buildEmptyCurrentPayload(null),
        previousAsOf: null,
        currentAsOf: null
      };
    }

    const normalizedPayload = {
      regionId,
      data: Array.isArray(payload?.data) ? payload.data : [],
      metadata: payload?.metadata && typeof payload.metadata === 'object'
        ? payload.metadata
        : buildEmptyCurrentPayload(regionId).metadata
    };
    const nextAsOf = trimString(normalizedPayload.metadata?.asOf);
    let storedPayload = normalizedPayload;
    let previousAsOf = null;
    let updated = true;

    if (snapshotRepository) {
      const existing = await snapshotRepository.getCurrentSnapshot(regionId);
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
          cadenceMinutes: 5,
          lagMinutes: 1
        });
      } else if (existingHasRows) {
        storedPayload = existing;
        updated = false;
      } else {
        storedPayload = normalizedPayload;
        updated = false;
      }
    }

    storeCacheEntry(currentRegionCache, `${regionId}`, getAemoCacheTtl(context.userConfig), storedPayload);

    return {
      regionId,
      updated,
      payload: storedPayload,
      previousAsOf,
      currentAsOf: trimString(storedPayload?.metadata?.asOf)
    };
  }

  async function refreshCurrentPriceData(context = {}) {
    const regionId = normalizeAemoRegion(context.regionId || context.userConfig?.aemoRegion || context.userConfig?.siteIdOrRegion);
    if (!regionId) {
      return {
        regionId: null,
        updated: false,
        payload: buildEmptyCurrentPayload(null),
        previousAsOf: null,
        currentAsOf: null
      };
    }

    const payloads = await fetchCurrentPayloadsFromUpstream(context.userId || null);
    const payload = payloads.get(regionId) || buildEmptyCurrentPayload(regionId);
    return storeCurrentPricePayload(payload, context);
  }

  async function refreshAllCurrentPriceData(context = {}) {
    const payloads = await fetchCurrentPayloadsFromUpstream(context.userId || null);
    const regions = Object.keys(AEMO_SUPPORTED_REGIONS);
    const results = [];

    for (const regionId of regions) {
      try {
        const payload = payloads.get(regionId) || buildEmptyCurrentPayload(regionId);
        results.push(await storeCurrentPricePayload(payload, context));
      } catch (error) {
        results.push({
          regionId,
          updated: false,
          payload: buildEmptyCurrentPayload(regionId),
          previousAsOf: null,
          currentAsOf: null,
          error: error && error.message ? error.message : String(error || 'Unknown error')
        });
      }
    }

    return results;
  }

  async function getCurrentPriceData(context = {}) {
    return readStoredCurrentPriceData(context);
  }

  async function getHistoricalPriceData(context = {}, startIso, endIso) {
    const regionId = normalizeAemoRegion(context.regionId || context.userConfig?.aemoRegion || context.userConfig?.siteIdOrRegion);
    if (!regionId) {
      return { regionId: null, data: [] };
    }

    const monthKeys = listMonthKeysBetween(startIso, endIso);
    const monthlyRows = await Promise.all(
      monthKeys.map((monthKey) => fetchMonthlyRows(monthKey, regionId, context.userId || null))
    );
    const rows = monthlyRows.flat();

    return {
      regionId,
      data: buildHistoricalLegacyRows(regionId, rows, startIso, endIso)
    };
  }

  async function getActualPriceAtTimestamp(context = {}, timestampIso) {
    const regionId = normalizeAemoRegion(context.regionId || context.userConfig?.aemoRegion || context.userConfig?.siteIdOrRegion);
    const targetIso = trimString(timestampIso);
    if (!regionId || !targetIso) {
      return { regionId, result: null };
    }

    const targetDate = toDateOnlyIso(targetIso);
    if (!targetDate) {
      return { regionId, result: null };
    }

    const dayStartIso = `${targetDate}T00:00:00.000Z`;
    const dayEndIso = `${targetDate}T23:59:59.999Z`;
    const history = await getHistoricalPriceData({ ...context, regionId }, dayStartIso, dayEndIso);
    const targetMs = Date.parse(targetIso);
    const matching = (history.data || []).find((row) => {
      if (row.channelType !== 'general') return false;
      const startMs = Date.parse(row.startTime);
      const endMs = Date.parse(row.endTime);
      return Number.isFinite(startMs) && Number.isFinite(endMs) && targetMs >= startMs && targetMs <= endMs;
    }) || null;

    return { regionId, result: matching };
  }

  return {
    DEFAULT_AEMO_REGION,
    AEMO_SUPPORTED_REGIONS,
    refreshAllCurrentPriceData,
    refreshCurrentPriceData,
    getActualPriceAtTimestamp,
    getCurrentPriceData,
    getHistoricalPriceData,
    getAemoCacheTtl,
    listSupportedAemoRegions,
    normalizeAemoRegion
  };
}

module.exports = {
  AEMO_SUPPORTED_REGIONS,
  DEFAULT_AEMO_REGION,
  buildPredispatchLegacyRows,
  buildCurrentPayload,
  buildHistoricalLegacyRows,
  convertAemoRrpToCentsPerKwh,
  init,
  listSupportedAemoRegions,
  normalizeAemoRegion,
  parseMarketDateTimeToIso,
  parseSectionedCsv
};
