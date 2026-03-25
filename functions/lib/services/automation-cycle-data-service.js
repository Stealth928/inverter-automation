'use strict';

const { parseTimestampMs } = require('./automation-telemetry-health-service');

function getLogger(logger = console) {
  return {
    info: logger && typeof logger.log === 'function' ? logger.log.bind(logger) : console.log,
    warn: logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn
  };
}

function hasNestedDatasFrame(payload) {
  return !!payload?.result?.[0]?.datas;
}

function pushNumericTelemetry(datas, variable, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return;
  }
  datas.push({ variable, value });
}

function toAutomationTelemetryFrame(status = {}) {
  const datas = [];

  pushNumericTelemetry(datas, 'SoC', status.socPct);
  pushNumericTelemetry(datas, 'batTemperature', status.batteryTempC);
  pushNumericTelemetry(datas, 'ambientTemperation', status.ambientTempC);
  pushNumericTelemetry(datas, 'pvPower', status.pvPowerW);
  pushNumericTelemetry(datas, 'loadsPower', status.loadPowerW);
  pushNumericTelemetry(datas, 'gridConsumptionPower', status.gridPowerW);
  pushNumericTelemetry(datas, 'feedinPower', status.feedInPowerW);

  const gridPower = Number(status.gridPowerW);
  const feedInPower = Number(status.feedInPowerW);
  const meterPower = Number.isFinite(gridPower) && gridPower > 0
    ? gridPower
    : Number.isFinite(feedInPower) && feedInPower > 0
      ? -feedInPower
      : NaN;
  pushNumericTelemetry(datas, 'meterPower2', meterPower);

  return {
    errno: 0,
    result: [{
      // Keep provider status observation time in frame for freshness checks.
      time: status.observedAtIso || new Date().toISOString(),
      datas
    }],
    __cacheHit: false,
    __providerAdapter: true
  };
}

function ensureAutomationTelemetryTimestamp(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const firstFrame = Array.isArray(payload.result) && payload.result.length > 0 &&
    payload.result[0] && typeof payload.result[0] === 'object'
    ? payload.result[0]
    : null;

  const candidates = [
    payload.observedAtIso,
    payload.observedAt,
    payload.time,
    payload.timestamp,
    firstFrame?.observedAtIso,
    firstFrame?.observedAt,
    firstFrame?.time,
    firstFrame?.timestamp
  ];

  let observedAtMs = NaN;
  for (const candidate of candidates) {
    observedAtMs = parseTimestampMs(candidate);
    if (Number.isFinite(observedAtMs)) {
      break;
    }
  }

  if (!Number.isFinite(observedAtMs)) {
    const cacheAgeMs = Number(payload.__cacheAgeMs);
    observedAtMs = Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0
      ? Math.max(0, nowMs - cacheAgeMs)
      : nowMs;
  }

  const observedAtIso = new Date(observedAtMs).toISOString();
  if (!payload.observedAtIso) {
    payload.observedAtIso = observedAtIso;
  }
  if (firstFrame && !firstFrame.time && !firstFrame.timestamp) {
    firstFrame.time = observedAtIso;
  }

  return payload;
}

async function fetchAutomationInverterData(options = {}) {
  const deviceAdapter = options.deviceAdapter || null;
  const deviceSN = options.deviceSN;
  const getCachedInverterData = options.getCachedInverterData;
  const getCachedInverterRealtimeData = options.getCachedInverterRealtimeData;
  const logger = getLogger(options.logger);
  const provider = String(options.provider || 'foxess').toLowerCase().trim();
  const userConfig = options.userConfig;
  const userId = options.userId;

  if (!deviceSN) {
    return { errno: 400, error: 'Device identifier not configured' };
  }

  let inverterData = null;

  const isNonFoxessWithAdapter = provider !== 'foxess' && deviceAdapter && typeof deviceAdapter.getStatus === 'function';

  if (!isNonFoxessWithAdapter && typeof getCachedInverterData === 'function') {
    try {
      inverterData = await getCachedInverterData(userId, deviceSN, userConfig, false);

      // If automation cache misses expected datas payload, try realtime cache fallback.
      if (!hasNestedDatasFrame(inverterData) && typeof getCachedInverterRealtimeData === 'function') {
        logger.warn(
          '[Automation] Automation inverter cache missing datas structure (errno=%s), falling back to realtime cache',
          inverterData?.errno
        );
        try {
          const realtimeData = await getCachedInverterRealtimeData(userId, deviceSN, userConfig, false);
          if (hasNestedDatasFrame(realtimeData)) {
            inverterData = realtimeData;
            logger.info('[Automation] Realtime cache fallback succeeded - SoC data now available');
          }
        } catch (fallbackError) {
          logger.warn('[Automation] Realtime cache fallback also failed:', fallbackError.message);
        }
      }
    } catch (error) {
      logger.warn('[Automation] Failed to get inverter data:', error.message);
    }
  }

  // Non-FoxESS providers should use the shared realtime cache first so per-user TTLs
  // apply consistently across dashboard and automation reads.
  if (!hasNestedDatasFrame(inverterData) && isNonFoxessWithAdapter && typeof getCachedInverterRealtimeData === 'function') {
    try {
      const realtimeData = await getCachedInverterRealtimeData(userId, deviceSN, userConfig, false, {
        route: 'automation-cycle',
        logger: options.logger,
        alphaessLogMode: 'never'
      });
      if (hasNestedDatasFrame(realtimeData)) {
        inverterData = realtimeData;
        logger.info('[Automation] Shared realtime cache fetch succeeded for non-FoxESS provider');
      }
    } catch (error) {
      logger.warn('[Automation] Failed to get non-FoxESS realtime cache:', error.message);
    }
  }

  // Non-FoxESS providers with an adapter: fall back to a live adapter call only when
  // shared realtime cache data is unavailable or invalid.
  if (!hasNestedDatasFrame(inverterData) && isNonFoxessWithAdapter) {
    try {
      const status = await deviceAdapter.getStatus({ deviceSN, userConfig, userId });
      inverterData = toAutomationTelemetryFrame(status);
    } catch (error) {
      logger.warn(`[Automation] Failed to fetch ${provider} status: ${error?.message || error}`);
      return { errno: 500, error: error?.message || String(error) };
    }
  }

  return ensureAutomationTelemetryTimestamp(inverterData);
}

function logAmberForecastSummary(amberData, logger = console) {
  const info = logger && typeof logger.log === 'function' ? logger.log.bind(logger) : console.log;

  if (!Array.isArray(amberData) || amberData.length === 0) {
    return;
  }

  const generalForecasts = amberData.filter(
    (price) => price.type === 'ForecastInterval' && price.channelType === 'general'
  );
  const feedInForecasts = amberData.filter(
    (price) => price.type === 'ForecastInterval' && price.channelType === 'feedIn'
  );

  if (generalForecasts.length > 0) {
    const generalPrices = generalForecasts.map((forecast) => forecast.perKwh);
    info(
      `[Automation] General forecast: ${generalForecasts.length} intervals, max ${Math.max(...generalPrices).toFixed(2)}¢/kWh`
    );
  }

  if (feedInForecasts.length > 0) {
    const feedInPrices = feedInForecasts.map((forecast) => -forecast.perKwh);
    info(
      `[Automation] Feed-in forecast: ${feedInForecasts.length} intervals, max ${Math.max(...feedInPrices).toFixed(2)}¢/kWh`
    );
  }
}

async function fetchAutomationAmberData(options = {}) {
  const amberAPI = options.amberAPI;
  const amberPricesInFlight = options.amberPricesInFlight;
  const logger = getLogger(options.logger);
  const userConfig = options.userConfig;
  const userId = options.userId;
  const amberTariffAdapter = options.amberTariffAdapter || null;

  if (!userConfig?.amberApiKey) {
    return null;
  }

  // Prefer the adapter path when available — it owns its own caching strategy
  if (amberTariffAdapter && typeof amberTariffAdapter.getCurrentPriceData === 'function') {
    try {
      const adapterResult = await amberTariffAdapter.getCurrentPriceData({ userConfig, userId });
      // Result may be { data: [...] } or a plain array
      return (adapterResult && adapterResult.data !== undefined) ? adapterResult.data : adapterResult;
    } catch (adapterErr) {
      logger.warn(
        `[Automation] Amber adapter fetch failed, falling back to legacy path: ${adapterErr.message}`,
        adapterErr.message
      );
    }
  }

  if (
    !amberAPI ||
    typeof amberAPI.callAmberAPI !== 'function' ||
    typeof amberAPI.getCachedAmberSites !== 'function' ||
    typeof amberAPI.getCachedAmberPricesCurrent !== 'function' ||
    typeof amberAPI.cacheAmberSites !== 'function' ||
    typeof amberAPI.cacheAmberPricesCurrent !== 'function'
  ) {
    return null;
  }

  let amberData = null;

  try {
    let sites = await amberAPI.getCachedAmberSites(userId);
    if (!sites) {
      sites = await amberAPI.callAmberAPI('/sites', {}, userConfig, userId);
      if (Array.isArray(sites) && sites.length > 0) {
        await amberAPI.cacheAmberSites(userId, sites);
      }
    }

    if (!Array.isArray(sites) || sites.length === 0) {
      return null;
    }

    const siteId = userConfig.amberSiteId || sites[0].id;
    amberData = await amberAPI.getCachedAmberPricesCurrent(siteId, userId, userConfig);

    if (!amberData) {
      const inflightKey = `${userId}:${siteId}`;

      if (amberPricesInFlight instanceof Map && amberPricesInFlight.has(inflightKey)) {
        try {
          amberData = await amberPricesInFlight.get(inflightKey);
        } catch (inflightError) {
          logger.warn(
            `[Automation] In-flight request failed for ${userId}, will retry:`,
            inflightError.message
          );
        }
      }

      if (!amberData) {
        const fetchPromise = amberAPI
          .callAmberAPI(
            `/sites/${encodeURIComponent(siteId)}/prices/current`,
            { next: 288 },
            userConfig,
            userId
          )
          .then(async (data) => {
            if (Array.isArray(data) && data.length > 0) {
              await amberAPI.cacheAmberPricesCurrent(siteId, data, userId, userConfig);
            }
            return data;
          })
          .finally(() => {
            if (amberPricesInFlight instanceof Map) {
              amberPricesInFlight.delete(inflightKey);
            }
          });

        if (amberPricesInFlight instanceof Map) {
          amberPricesInFlight.set(inflightKey, fetchPromise);
        }
        amberData = await fetchPromise;
      }
    }

    logAmberForecastSummary(amberData, options.logger);
  } catch (error) {
    logger.warn('[Automation] Failed to get Amber data:', error.message);
  }

  return amberData;
}

module.exports = {
  ensureAutomationTelemetryTimestamp,
  fetchAutomationAmberData,
  fetchAutomationInverterData,
  hasNestedDatasFrame,
  logAmberForecastSummary,
  toAutomationTelemetryFrame
};
