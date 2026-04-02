// seed-emulator-state.js
// Seeds Auth/Firestore emulators with deterministic local test admins across inverter providers.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node seed-emulator-state.js

const admin = require('firebase-admin');
const {
  TEST_USERS,
  TEST_CONFIG,
  getProjectId,
  assertEmulatorEnvironment
} = require('./emulator-test-user');
const { resolveProviderDeviceId } = require('../lib/provider-device-id');

const METRICS_TIMEZONE = 'Australia/Sydney';
const INVERTER_CACHE_TTL_MS = 5 * 60 * 1000;
const AEMO_SNAPSHOT_FORECAST_INTERVAL_COUNT = 12;
const AEMO_SNAPSHOT_FORECAST_BLOCK_MINUTES = 30;

const AEMO_SNAPSHOT_PRESETS = Object.freeze({
  NSW1: Object.freeze({
    regionId: 'NSW1',
    basePrice: 86.4,
    feedInBase: -18.7,
    demand: 8420,
    demandStep: 95,
    generation: 5989,
    generationStep: 66
  }),
  QLD1: Object.freeze({
    regionId: 'QLD1',
    basePrice: 74.2,
    feedInBase: -15.9,
    demand: 6980,
    demandStep: 88,
    generation: 5210,
    generationStep: 58
  }),
  VIC1: Object.freeze({
    regionId: 'VIC1',
    basePrice: 68.9,
    feedInBase: -14.1,
    demand: 6210,
    demandStep: 72,
    generation: 4890,
    generationStep: 52
  }),
  SA1: Object.freeze({
    regionId: 'SA1',
    basePrice: 92.1,
    feedInBase: -22.4,
    demand: 1840,
    demandStep: 36,
    generation: 542,
    generationStep: 18
  }),
  TAS1: Object.freeze({
    regionId: 'TAS1',
    basePrice: 58.7,
    feedInBase: -10.8,
    demand: 1280,
    demandStep: 24,
    generation: 940,
    generationStep: 12
  })
});

const AMBER_CACHE_PRESETS = Object.freeze({
  foxess: Object.freeze({
    siteNmi: '2100165175',
    siteNetwork: 'NEM_NSW',
    network: 'N2',
    generalBase: 35.2,
    generalStep: 2.1,
    feedInBase: -12.5,
    feedInStep: -0.8,
    renewablesBase: 42,
    renewablesStep: 5
  }),
  sungrow: Object.freeze({
    siteNmi: '2200345689',
    siteNetwork: 'NEM_QLD',
    network: 'QLD',
    generalBase: 32.8,
    generalStep: 1.8,
    feedInBase: -11.2,
    feedInStep: -0.7,
    renewablesBase: 38,
    renewablesStep: 4
  }),
  sigenergy: Object.freeze({
    siteNmi: '2300567123',
    siteNetwork: 'NEM_VIC',
    network: 'VIC',
    generalBase: 38.5,
    generalStep: 2.3,
    feedInBase: -13.8,
    feedInStep: -0.9,
    renewablesBase: 35,
    renewablesStep: 6
  }),
  alphaess: Object.freeze({
    siteNmi: '2400789234',
    siteNetwork: 'NEM_SA',
    network: 'SA',
    generalBase: 41.2,
    generalStep: 2.5,
    feedInBase: -15.1,
    feedInStep: -1.0,
    renewablesBase: 48,
    renewablesStep: 7
  })
});

const INVERTER_CACHE_PRESETS = Object.freeze({
  foxess: Object.freeze({
    socPct: 68,
    pvPowerW: 4200,
    loadsPowerW: 1850,
    gridConsumptionPowerW: 450,
    batChargePowerW: 280,
    batDischargePowerW: 0,
    feedinPowerW: 1620, // Net feed-in after loads covered
    batTemperatureC: 26.4,
    ambientTemperationC: 22.8,
    invTemperationC: 34.9,
    boostTemperationC: 41.2,
    generationPowerW: 4350
  }),
  sungrow: Object.freeze({
    socPct: 72,
    pvPowerW: 3650,
    loadsPowerW: 1620,
    gridConsumptionPowerW: 380,
    batChargePowerW: 320,
    batDischargePowerW: 0,
    feedinPowerW: 1650,
    batTemperatureC: 28.1,
    ambientTemperationC: 24.5,
    invTemperationC: 36.2,
    boostTemperationC: 42.1,
    generationPowerW: 3720
  }),
  sigenergy: Object.freeze({
    socPct: 55,
    pvPowerW: 2950,
    loadsPowerW: 1410,
    gridConsumptionPowerW: 520,
    batChargePowerW: 0,
    batDischargePowerW: 380,
    feedinPowerW: 40,
    batTemperatureC: 31.2,
    ambientTemperationC: 23.1,
    invTemperationC: 35.8,
    boostTemperationC: 39.5,
    generationPowerW: 2890
  }),
  alphaess: Object.freeze({
    socPct: 82,
    pvPowerW: 4600,
    loadsPowerW: 1720,
    gridConsumptionPowerW: 290,
    batChargePowerW: 520,
    batDischargePowerW: 0,
    feedinPowerW: 2590,
    batTemperatureC: 25.3,
    ambientTemperationC: 21.9,
    invTemperationC: 33.7,
    boostTemperationC: 39.1,
    generationPowerW: 4750
  })
});

function roundTo(value, decimals = 2) {
  return Number(Number(value).toFixed(decimals));
}

function toSeedProvider(seedUser) {
  return String(seedUser?.provider || 'foxess').toLowerCase().trim();
}

function getInverterCachePreset(seedUser) {
  return INVERTER_CACHE_PRESETS[toSeedProvider(seedUser)] || INVERTER_CACHE_PRESETS.foxess;
}

function getAmberCachePreset(seedUser) {
  return AMBER_CACHE_PRESETS[toSeedProvider(seedUser)] || AMBER_CACHE_PRESETS.foxess;
}

function resolveSeedGridFlow(preset) {
  const presetGridConsumptionPowerW = Number.isFinite(Number(preset.gridConsumptionPowerW))
    ? Math.max(0, Number(preset.gridConsumptionPowerW))
    : 0;
  const presetFeedinPowerW = Number.isFinite(Number(preset.feedinPowerW))
    ? Math.max(0, Number(preset.feedinPowerW))
    : 0;

  // Production inverter frames show either import or export, never both at once.
  // Keep the emulator seed aligned with that shape so the dashboard renders the same way.
  if (presetFeedinPowerW >= presetGridConsumptionPowerW) {
    return {
      gridConsumptionPowerW: 0,
      feedinPowerW: presetFeedinPowerW
    };
  }

  return {
    gridConsumptionPowerW: presetGridConsumptionPowerW,
    feedinPowerW: 0
  };
}

function buildInverterDataFrame(seedUser, deviceSN, timestampIso, includeRealtimeExtras = false) {
  const preset = getInverterCachePreset(seedUser);
  const soc = Number.isFinite(Number(preset.socPct)) ? Number(preset.socPct) : 75;
  const pvPowerW = Number.isFinite(Number(preset.pvPowerW)) ? Number(preset.pvPowerW) : 3200;
  const loadsPowerW = Number.isFinite(Number(preset.loadsPowerW)) ? Number(preset.loadsPowerW) : 1600;
  const seededGridFlow = resolveSeedGridFlow(preset);
  const gridConsumptionPowerW = seededGridFlow.gridConsumptionPowerW;
  const feedinPowerW = seededGridFlow.feedinPowerW;
  const batChargePowerW = Number.isFinite(Number(preset.batChargePowerW)) ? Number(preset.batChargePowerW) : 0;
  const batDischargePowerW = Number.isFinite(Number(preset.batDischargePowerW)) ? Number(preset.batDischargePowerW) : 0;
  const meterPower2 = gridConsumptionPowerW > 0
    ? gridConsumptionPowerW
    : (feedinPowerW > 0 ? -feedinPowerW : 0);

  const pvSplit = [0.34, 0.27, 0.23, 0.16];
  const pvVolt = [392, 378, 364, 348];
  const pvPowers = pvSplit.map((ratio) => roundTo(pvPowerW * ratio, 2));
  const pvCurrents = pvPowers.map((power, index) => roundTo(power / Math.max(pvVolt[index], 1), 2));

  const datas = [
    { variable: 'SoC', value: soc },
    { variable: 'SoC1', value: soc },
    { variable: 'pvPower', value: pvPowerW },
    { variable: 'loadsPower', value: loadsPowerW },
    { variable: 'gridConsumptionPower', value: gridConsumptionPowerW },
    { variable: 'feedinPower', value: feedinPowerW },
    { variable: 'meterPower2', value: meterPower2 },
    { variable: 'batTemperature', value: preset.batTemperatureC },
    { variable: 'ambientTemperation', value: preset.ambientTemperationC }
  ];

  if (includeRealtimeExtras) {
    datas.push(
      { variable: 'generationPower', value: preset.generationPowerW },
      { variable: 'batChargePower', value: batChargePowerW },
      { variable: 'batDischargePower', value: batDischargePowerW },
      { variable: 'invTemperation', value: preset.invTemperationC },
      { variable: 'boostTemperation', value: preset.boostTemperationC },
      { variable: 'pv1Power', value: pvPowers[0], unit: 'W' },
      { variable: 'pv2Power', value: pvPowers[1], unit: 'W' },
      { variable: 'pv3Power', value: pvPowers[2], unit: 'W' },
      { variable: 'pv4Power', value: pvPowers[3], unit: 'W' },
      { variable: 'pv1Volt', value: pvVolt[0], unit: 'V' },
      { variable: 'pv2Volt', value: pvVolt[1], unit: 'V' },
      { variable: 'pv3Volt', value: pvVolt[2], unit: 'V' },
      { variable: 'pv4Volt', value: pvVolt[3], unit: 'V' },
      { variable: 'pv1Current', value: pvCurrents[0], unit: 'A' },
      { variable: 'pv2Current', value: pvCurrents[1], unit: 'A' },
      { variable: 'pv3Current', value: pvCurrents[2], unit: 'A' },
      { variable: 'pv4Current', value: pvCurrents[3], unit: 'A' },
      { variable: 'meterPower', value: meterPower2 },
      { variable: 'gridPower', value: gridConsumptionPowerW },
      { variable: 'meterPowerW', value: meterPower2 },
      { variable: 'loadPower', value: loadsPowerW }
    );
  }

  return {
    errno: 0,
    result: [{
      deviceSN: String(deviceSN || ''),
      time: timestampIso,
      datas
    }]
  };
}

function buildAmberSites(seedUser) {
  const preset = getAmberCachePreset(seedUser);
  const siteId = String(seedUser?.config?.amberSiteId || `seed-site-${toSeedProvider(seedUser)}`);
  return [{
    id: siteId,
    nmi: preset.siteNmi,
    network: preset.siteNetwork,
    networkName: preset.network,
    nmiVerified: false
  }];
}

function buildAmberCurrentRows(seedUser) {
  const preset = getAmberCachePreset(seedUser);
  const now = new Date();
  const aligned = new Date(now);
  aligned.setSeconds(0, 0);
  aligned.setMinutes(aligned.getMinutes() < 30 ? 0 : 30);

  // Generate 24 intervals (12 hours of 30-min intervals) for comprehensive pricing data
  return Array.from({ length: 24 }, (_, idx) => {
    const intervalStart = new Date(aligned.getTime() + idx * 30 * 60 * 1000);
    const intervalEnd = new Date(aligned.getTime() + (idx + 1) * 30 * 60 * 1000);
    const base = intervalStart.toISOString();
    const end = intervalEnd.toISOString();
    
    // Create realistic price curves with peak/off-peak variations
    const hourOfDay = intervalStart.getHours();
    const isPeakHour = hourOfDay >= 17 && hourOfDay <= 21;
    const isPeakMultiplier = isPeakHour ? 1.4 : (hourOfDay >= 9 && hourOfDay <= 17 ? 1.1 : 0.8);
    
    const renewables = roundTo(preset.renewablesBase + (idx % 6) * preset.renewablesStep * isPeakMultiplier, 1);
    const isCurrent = idx === 0;

    const baseBuy = preset.generalBase * isPeakMultiplier;
    const buy = roundTo(baseBuy + (idx % 4) * preset.generalStep, 2);
    const feedIn = roundTo((preset.feedInBase * (1 / isPeakMultiplier)) - (idx % 3) * Math.abs(preset.feedInStep), 2);

    const common = {
      startTime: base,
      endTime: end,
      date: base.slice(0, 10),
      nemTime: base,
      type: isCurrent ? 'CurrentInterval' : 'ForecastInterval',
      period: '30m'
    };

    return [{
      ...common,
      channelType: 'general',
      perKwh: buy,
      spotPerKwh: buy,
      renewables,
      descriptor: 'current',
      spikeStatus: buy > preset.generalBase * 1.5 ? 'spike' : 'none'
    }, {
      ...common,
      channelType: 'feedIn',
      perKwh: feedIn,
      spotPerKwh: feedIn,
      renewables,
      descriptor: 'current',
      spikeStatus: 'none'
    }];
  }).flat();
}

function alignToFiveMinuteBoundary(date = new Date()) {
  const aligned = new Date(date);
  aligned.setSeconds(0, 0);
  aligned.setMinutes(Math.floor(aligned.getMinutes() / 5) * 5);
  return aligned;
}

function alignToThirtyMinuteBoundary(date = new Date()) {
  const aligned = new Date(date);
  aligned.setSeconds(0, 0);
  const remainder = aligned.getMinutes() % 30;
  if (remainder !== 0) {
    aligned.setMinutes(aligned.getMinutes() + (30 - remainder));
  }
  return aligned;
}

function buildAemoMarketFields(generation) {
  const generationMw = Math.max(0, Math.round(generation));
  const availableGeneration = Math.max(generationMw, Math.round(generationMw * 1.22));
  const dispatchableGeneration = Math.max(generationMw, Math.round(generationMw * 1.08));
  const initialSupply = Math.max(generationMw, Math.round(generationMw * 1.03));

  return {
    generation: generationMw,
    supply: generationMw,
    generationMw,
    supplyMw: generationMw,
    availableGeneration,
    dispatchableGeneration,
    clearedSupply: generationMw,
    initialSupply
  };
}

function buildAemoLegacyRow({ type, channelType, perKwh, startIso, endIso, regionId, demand, demandForecast, marketFields = {}, intervalType }) {
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
    asOf: endIso,
    demand,
    demandForecast,
    ...marketFields,
    aemoIntervalType: intervalType
  };
}

function buildAemoSnapshotRows(regionId, preset, anchorDate = new Date()) {
  const aligned = alignToFiveMinuteBoundary(anchorDate);
  const rows = [];
  const currentStart = new Date(aligned);
  const currentEnd = new Date(currentStart.getTime() + 5 * 60 * 1000);
  const currentGeneralPrice = roundTo(preset.basePrice, 2);
  const currentFeedInPrice = roundTo(preset.feedInBase, 2);
  const currentDemand = Math.round(preset.demand);
  const currentDemandForecast = Math.round(currentDemand + preset.demandStep * 0.8);
  const currentGeneration = Math.round(preset.generation);
  const currentMarketFields = buildAemoMarketFields(currentGeneration);

  rows.push(buildAemoLegacyRow({
    type: 'CurrentInterval',
    channelType: 'general',
    perKwh: currentGeneralPrice,
    startIso: currentStart.toISOString(),
    endIso: currentEnd.toISOString(),
    regionId,
    demand: currentDemand,
    demandForecast: currentDemandForecast,
    marketFields: currentMarketFields,
    intervalType: 'dispatch'
  }));
  rows.push(buildAemoLegacyRow({
    type: 'CurrentInterval',
    channelType: 'feedIn',
    perKwh: currentFeedInPrice,
    startIso: currentStart.toISOString(),
    endIso: currentEnd.toISOString(),
    regionId,
    demand: currentDemand,
    demandForecast: currentDemandForecast,
    marketFields: currentMarketFields,
    intervalType: 'dispatch'
  }));

  let forecastEnd = alignToThirtyMinuteBoundary(currentEnd);
  let forecastStart = new Date(forecastEnd.getTime() - AEMO_SNAPSHOT_FORECAST_BLOCK_MINUTES * 60 * 1000);

  for (let index = 1; index <= AEMO_SNAPSHOT_FORECAST_INTERVAL_COUNT; index += 1) {
    const startIso = forecastStart.toISOString();
    const endIso = forecastEnd.toISOString();
    const priceDrift = (index % 4) * 3.2;
    const wave = Math.sin(index / 2.2) * 4.5;
    const generalPrice = roundTo(preset.basePrice + priceDrift + wave, 2);
    const feedInPrice = roundTo(preset.feedInBase - (index % 3) * 1.4 - (wave / 3), 2);
    const demand = Math.round(preset.demand + index * preset.demandStep);
    const demandForecast = Math.round(demand + preset.demandStep * 0.8);
    const generation = Math.max(0, Math.round(preset.generation + index * preset.generationStep + Math.cos(index / 2.6) * 42));
    const marketFields = buildAemoMarketFields(generation);

    rows.push(buildAemoLegacyRow({
      type: 'ForecastInterval',
      channelType: 'general',
      perKwh: generalPrice,
      startIso,
      endIso,
      regionId,
      demand,
      demandForecast,
      marketFields,
      intervalType: 'predispatch'
    }));
    rows.push(buildAemoLegacyRow({
      type: 'ForecastInterval',
      channelType: 'feedIn',
      perKwh: feedInPrice,
      startIso,
      endIso,
      regionId,
      demand,
      demandForecast,
      marketFields,
      intervalType: 'predispatch'
    }));

    forecastStart = forecastEnd;
    forecastEnd = new Date(forecastEnd.getTime() + AEMO_SNAPSHOT_FORECAST_BLOCK_MINUTES * 60 * 1000);
  }

  return rows;
}

function buildAemoSnapshot(regionId, anchorDate = new Date()) {
  const preset = AEMO_SNAPSHOT_PRESETS[regionId];
  if (!preset) {
    throw new Error(`Unsupported AEMO snapshot region "${regionId}"`);
  }

  const rows = buildAemoSnapshotRows(regionId, preset, anchorDate);
  const asOfIso = rows[0]?.asOf || rows[0]?.endTime || alignToFiveMinuteBoundary(anchorDate).toISOString();
  const latestEndMs = Math.max(...rows.map((row) => Date.parse(row.endTime)).filter((value) => Number.isFinite(value)));
  const asOfMs = Date.parse(asOfIso);

  return {
    regionId,
    data: rows,
    metadata: {
      asOf: asOfIso,
      forecastHorizonMinutes: Number.isFinite(latestEndMs) && Number.isFinite(asOfMs)
        ? Math.max(0, Math.round((latestEndMs - asOfMs) / 60000))
        : 0,
      isForecastComplete: true,
      source: 'aemo'
    }
  };
}

function resolveProviderAndDeviceId(seedUser) {
  const cfg = seedUser && seedUser.config ? seedUser.config : {};
  const provider = cfg.deviceProvider || String(seedUser?.provider || 'foxess');
  const resolved = resolveProviderDeviceId(cfg, cfg.deviceSN);
  return {
    provider: String(resolved.provider || provider).toLowerCase().trim(),
    deviceSN: String(resolved.deviceId || cfg.deviceSN || '').trim()
  };
}

async function getUserByUidOrNull(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
}

async function getUserByEmailOrNull(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
}

function getDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: METRICS_TIMEZONE });
}

function toComparableString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getSeedCredentialShape(seedUser) {
  const provider = String(seedUser?.provider || '').toLowerCase().trim();
  const config = seedUser?.config || {};
  const secrets = seedUser?.secrets || {};

  if (provider === 'foxess') {
    return {
      provider,
      config: {
        deviceSn: config.deviceSn,
        foxessToken: config.foxessToken
      },
      secrets: {}
    };
  }

  if (provider === 'sungrow') {
    return {
      provider,
      config: {
        sungrowDeviceSn: config.sungrowDeviceSn || config.deviceSn,
        sungrowUsername: config.sungrowUsername
      },
      secrets: {
        sungrowPassword: secrets.sungrowPassword
      }
    };
  }

  if (provider === 'sigenergy') {
    return {
      provider,
      config: {
        sigenUsername: config.sigenUsername,
        sigenRegion: config.sigenRegion,
        sigenStationId: config.sigenStationId,
        sigenDeviceSn: config.sigenDeviceSn || config.deviceSn
      },
      secrets: {
        sigenPassword: secrets.sigenPassword
      }
    };
  }

  if (provider === 'alphaess') {
    return {
      provider,
      config: {
        alphaessSystemSn: config.alphaessSystemSn || config.deviceSn,
        alphaessAppId: config.alphaessAppId
      },
      secrets: {
        alphaessAppSecret: secrets.alphaessAppSecret || config.alphaessAppSecret
      }
    };
  }

  return { provider, config: {}, secrets: {} };
}

function getExistingCredentialShape(seedUser, existingConfig = {}, existingSecrets = {}) {
  const provider = String(seedUser?.provider || '').toLowerCase().trim();

  if (provider === 'foxess') {
    return {
      provider,
      config: {
        deviceSn: existingConfig.deviceSn || existingConfig.deviceSN,
        foxessToken: existingConfig.foxessToken
      },
      secrets: {}
    };
  }

  if (provider === 'sungrow') {
    return {
      provider,
      config: {
        sungrowDeviceSn: existingConfig.sungrowDeviceSn || existingConfig.deviceSn || existingConfig.deviceSN,
        sungrowUsername: existingConfig.sungrowUsername
      },
      secrets: {
        sungrowPassword: existingSecrets.sungrowPassword || existingConfig.sungrowPassword
      }
    };
  }

  if (provider === 'sigenergy') {
    return {
      provider,
      config: {
        sigenUsername: existingConfig.sigenUsername,
        sigenRegion: existingConfig.sigenRegion,
        sigenStationId: existingConfig.sigenStationId,
        sigenDeviceSn: existingConfig.sigenDeviceSn || existingConfig.deviceSn || existingConfig.deviceSN
      },
      secrets: {
        sigenPassword: existingSecrets.sigenPassword || existingConfig.sigenPassword
      }
    };
  }

  if (provider === 'alphaess') {
    return {
      provider,
      config: {
        alphaessSystemSn: existingConfig.alphaessSystemSn || existingConfig.deviceSn || existingConfig.deviceSN,
        alphaessAppId: existingConfig.alphaessAppId
      },
      secrets: {
        alphaessAppSecret: existingSecrets.alphaessAppSecret || existingConfig.alphaessAppSecret
      }
    };
  }

  return { provider, config: {}, secrets: {} };
}

function hasNonSeedCredentialOverride(seedUser, existingConfig = {}, existingSecrets = {}) {
  const seedProvider = String(seedUser?.provider || '').toLowerCase().trim();
  const existingProvider = String(existingConfig?.deviceProvider || '').toLowerCase().trim();

  if (existingProvider && seedProvider && existingProvider !== seedProvider && existingConfig?.setupComplete) {
    return true;
  }

  const expected = getSeedCredentialShape(seedUser);
  const actual = getExistingCredentialShape(seedUser, existingConfig, existingSecrets);

  const actualConfigEntries = Object.entries(actual.config || {});
  const actualSecretEntries = Object.entries(actual.secrets || {});
  const allEntries = actualConfigEntries.concat(actualSecretEntries);

  let hasAnyCredential = false;
  for (const [key, value] of allEntries) {
    const normalizedActual = toComparableString(value);
    if (!normalizedActual) continue;
    hasAnyCredential = true;
    const normalizedExpected = toComparableString(
      Object.prototype.hasOwnProperty.call(expected.config || {}, key)
        ? expected.config[key]
        : expected.secrets[key]
    );
    if (normalizedActual !== normalizedExpected) {
      return true;
    }
  }

  return false;
}

async function ensureSeedAuthUser(auth, seedUser, options = {}) {
  const preserveExisting = options.preserveExisting === true;
  const byUid = await getUserByUidOrNull(auth, seedUser.uid);
  const byEmail = await getUserByEmailOrNull(auth, seedUser.email);

  if (byEmail && byEmail.uid !== seedUser.uid) {
    await auth.deleteUser(byEmail.uid);
    console.log('Deleted legacy auth user with same email:', byEmail.uid);
  }

  let userRecord;
  if (!byUid) {
    userRecord = await auth.createUser({
      uid: seedUser.uid,
      email: seedUser.email,
      password: seedUser.password,
      displayName: seedUser.displayName,
      emailVerified: true
    });
    console.log('Created auth user:', userRecord.uid);
  } else {
    if (preserveExisting) {
      userRecord = byUid;
      console.log('Preserved auth user:', userRecord.uid);
    } else {
      userRecord = await auth.updateUser(seedUser.uid, {
        email: seedUser.email,
        password: seedUser.password,
        displayName: seedUser.displayName,
        emailVerified: true,
        disabled: false
      });
      console.log('Updated auth user:', userRecord.uid);
    }
  }

  await auth.setCustomUserClaims(seedUser.uid, {
    admin: seedUser.role === 'admin'
  });

  return userRecord;
}

function validateRequiredConfig(seedUser, config) {
  const provider = String(seedUser.provider || '').toLowerCase().trim();
  if (!provider) {
    throw new Error(`Seed user "${seedUser.uid}" is missing provider`);
  }

  const requiredByProvider = {
    foxess: ['deviceSn', 'foxessToken'],
    sungrow: ['sungrowDeviceSn', 'sungrowUsername'],
    sigenergy: ['sigenUsername'],
    alphaess: ['alphaessSystemSn', 'alphaessAppId', 'alphaessAppSecret']
  };

  const requiredFields = requiredByProvider[provider];
  if (!requiredFields) {
    throw new Error(`Unsupported provider "${provider}" for seed user "${seedUser.uid}"`);
  }

  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Seed user "${seedUser.uid}" missing required config field "${field}"`);
    }
  }
}

async function seedSingleUser({ db, auth, seedUser, ts }) {
  const uid = seedUser.uid;
  const userRef = db.collection('users').doc(uid);
  const [existingConfigSnap, existingSecretsSnap] = await Promise.all([
    userRef.collection('config').doc('main').get(),
    userRef.collection('secrets').doc('credentials').get()
  ]);
  const existingConfig = existingConfigSnap.exists ? (existingConfigSnap.data() || {}) : {};
  const existingSecrets = existingSecretsSnap.exists ? (existingSecretsSnap.data() || {}) : {};
  const preserveExisting = hasNonSeedCredentialOverride(seedUser, existingConfig, existingSecrets);

  const userRecord = await ensureSeedAuthUser(auth, seedUser, { preserveExisting });

  if (preserveExisting) {
    console.log('Preserved live/local credential override for users/%s; skipping seed writes until reset.', uid);
    return userRecord;
  }

  const cacheNowMs = Date.now();
  const cacheNow = new Date(cacheNowMs);
  const cacheNowIso = cacheNow.toISOString();
  const { provider, deviceSN } = resolveProviderAndDeviceId(seedUser);

  await userRef.set({
    uid,
    email: seedUser.email,
    displayName: seedUser.displayName,
    role: seedUser.role || 'user',
    automationEnabled: true,
    createdAt: ts,
    lastUpdated: ts,
    updatedAt: ts
  }, { merge: true });

  const configPayload = {
    ...(seedUser.config || {}),
    deviceProvider: seedUser.provider,
    setupComplete: true,
    setupCompletedAt: ts,
    createdAt: ts,
    updatedAt: ts
  };

  await userRef.collection('config').doc('main').set(configPayload, { merge: true });
  console.log('Wrote users/%s/config/main', uid);

  const secretsPayload = seedUser.secrets || {};
  if (Object.keys(secretsPayload).length > 0) {
    await userRef.collection('secrets').doc('credentials').set({
      ...secretsPayload,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote users/%s/secrets/credentials', uid);
  }

  await userRef.collection('automation').doc('state').set({
    enabled: true,
    lastCheck: ts,
    lastTriggered: ts,
    activeRule: seedUser.rule?.name || null,
    segmentsCleared: false,
    updatedAt: ts
  }, { merge: true });
  console.log('Wrote users/%s/automation/state', uid);

  const inverterCachePayload = buildInverterDataFrame(seedUser, deviceSN, cacheNowIso, false);
  await userRef.collection('cache').doc('inverter').set({
    data: inverterCachePayload,
    timestamp: cacheNowMs,
    ttlMs: INVERTER_CACHE_TTL_MS,
    provider,
    deviceSN,
    ttl: Math.floor(cacheNowMs / 1000) + Math.floor(INVERTER_CACHE_TTL_MS / 1000)
  }, { merge: true });
  console.log('Wrote users/%s/cache/inverter', uid);

  const inverterRealtimePayload = buildInverterDataFrame(seedUser, deviceSN, cacheNowIso, true);
  await userRef.collection('cache').doc('inverter-realtime').set({
    data: inverterRealtimePayload,
    timestamp: cacheNowMs,
    ttlMs: INVERTER_CACHE_TTL_MS,
    provider,
    deviceSN,
    ttl: Math.floor(cacheNowMs / 1000) + Math.floor(INVERTER_CACHE_TTL_MS / 1000)
  }, { merge: true });
  console.log('Wrote users/%s/cache/inverter-realtime', uid);

  const amberSites = buildAmberSites(seedUser);
  await userRef.collection('cache').doc('amber_sites').set({
    sites: amberSites,
    cachedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log('Wrote users/%s/cache/amber_sites', uid);

  const amberSiteId = String(seedUser?.config?.amberSiteId || `seed-site-${provider}`);
  const currentRows = buildAmberCurrentRows(seedUser);
  await userRef.collection('cache').doc(`amber_current_${amberSiteId}`).set({
    siteId: amberSiteId,
    prices: currentRows,
    cachedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`Wrote users/${uid}/cache/amber_current_${amberSiteId}`);

  const rule = seedUser.rule || {};
  const ruleId = rule.id || `seed_rule_${seedUser.provider}`;
  await userRef.collection('rules').doc(ruleId).set({
    ...rule,
    enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
    createdAt: ts,
    updatedAt: ts
  }, { merge: true });
  console.log('Wrote users/%s/rules/%s', uid, ruleId);

  await userRef.collection('history').doc(`seed_entry_${seedUser.provider}`).set({
    type: 'seed',
    provider: seedUser.provider,
    message: `Local emulator seed entry for ${seedUser.provider}`,
    ruleId,
    timestamp: ts
  }, { merge: true });
  console.log('Wrote users/%s/history/seed_entry_%s', uid, seedUser.provider);

  const todayKey = getDateKey(0);
  const yesterdayKey = getDateKey(1);
  const todayMetrics = seedUser.metrics?.today || {};
  const yesterdayMetrics = seedUser.metrics?.yesterday || {};
  await userRef.collection('metrics').doc(todayKey).set({
    ...todayMetrics,
    updatedAt: ts
  }, { merge: true });
  await userRef.collection('metrics').doc(yesterdayKey).set({
    ...yesterdayMetrics,
    updatedAt: ts
  }, { merge: true });
  console.log('Wrote users/%s/metrics/%s + %s', uid, todayKey, yesterdayKey);

  return userRecord;
}

async function seedAemoSnapshots({ db, ts, anchorDate = new Date() }) {
  for (const regionId of Object.keys(AEMO_SNAPSHOT_PRESETS)) {
    const snapshot = buildAemoSnapshot(regionId, anchorDate);
    await db.collection('aemoSnapshots').doc(regionId).set({
      ...snapshot,
      storedAt: ts,
      storedAtIso: anchorDate.toISOString(),
      schedule: {
        cadenceMinutes: 5,
        lagMinutes: 1,
        source: 'emulator-seed'
      }
    }, { merge: true });
    console.log('Wrote aemoSnapshots/%s', regionId);
  }
}

async function main() {
  try {
    assertEmulatorEnvironment();

    const projectId = getProjectId();
    console.log('Initializing admin for project', projectId);
    if (!admin.apps.length) {
      admin.initializeApp({ projectId });
    }

    const db = admin.firestore();
    const auth = admin.auth();
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const seededUsers = [];
    for (const seedUser of TEST_USERS) {
      const userRecord = await seedSingleUser({ db, auth, seedUser, ts });
      seededUsers.push({ seedUser, userRecord });
    }

    await seedAemoSnapshots({ db, ts });

    await db.collection('shared').doc('serverConfig').set({
      ...TEST_CONFIG,
      deviceProvider: 'foxess',
      setupComplete: true,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote shared/serverConfig');

    for (const item of seededUsers) {
      const { seedUser, userRecord } = item;
      const verifyAuth = await auth.getUser(seedUser.uid);
      const verifyConfigSnap = await db.collection('users').doc(userRecord.uid).collection('config').doc('main').get();
      if (!verifyConfigSnap.exists) {
        throw new Error(`Missing users/${userRecord.uid}/config/main after seed`);
      }

      const cfg = verifyConfigSnap.data() || {};
      validateRequiredConfig(seedUser, cfg);

      const expectedAdmin = seedUser.role === 'admin';
      if (!verifyAuth.customClaims || verifyAuth.customClaims.admin !== expectedAdmin) {
        throw new Error(`Unexpected admin custom claim for seeded user "${seedUser.uid}"`);
      }
    }

    console.log('Seed verification passed.');
    console.log('Seeded users:');
    for (const { seedUser } of seededUsers) {
      console.log(`  ${seedUser.provider}: ${seedUser.email} / ${seedUser.password} / role=${seedUser.role}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getExistingCredentialShape,
  getSeedCredentialShape,
  hasNonSeedCredentialOverride
};
