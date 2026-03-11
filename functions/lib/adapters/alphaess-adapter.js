'use strict';

const { DeviceAdapter } = require('./device-adapter');
const { buildClearedSchedulerGroups } = require('../automation-actions');

const DEFAULT_CAPABILITIES = Object.freeze({
  scheduler: true,
  workMode: false,
  minSoc: true,
  forceChargeWindow: true
});

const DEFAULT_GROUP_COUNT = 8;
const MAX_ALPHA_WINDOWS = 2;

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveSystemSn(context = {}) {
  const fromContext = context.systemSn || context.sysSn || context.deviceSN || context.deviceSn;
  if (fromContext) return String(fromContext).trim();
  const fromConfig =
    context.userConfig?.alphaessSystemSn ||
    context.userConfig?.alphaessSysSn ||
    context.userConfig?.deviceSn;
  if (fromConfig) return String(fromConfig).trim();
  return null;
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '00:00';
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
  return '00:00';
}

function timeToParts(value) {
  const normalized = normalizeTime(value);
  const [hourStr, minuteStr] = normalized.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0
  };
}

function hasConfiguredWindow(startTime, endTime) {
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  return !(start === '00:00' && end === '00:00');
}

function alphaTimeToDisplay(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  // ISO-like / already formatted
  if (value.includes('-') && value.includes(':')) {
    return value.replace('T', ' ').replace('Z', '');
  }

  // Compact yyyyMMddHHmmss
  if (/^\d{14}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
  }

  return value;
}

function normalizePowerKw(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) return null;
  return Number((numeric / 1000).toFixed(4));
}

function normalizeStatus(payload, observedAtIso, systemSn) {
  const pgrid = toFiniteNumber(payload?.pgrid, null);
  const gridPowerW = pgrid !== null ? Math.max(0, pgrid) : Math.max(0, toFiniteNumber(payload?.gridCharge, 0));
  const feedInPowerW = pgrid !== null ? Math.max(0, -pgrid) : Math.max(0, toFiniteNumber(payload?.feedIn, 0));

  return {
    socPct: toFiniteNumber(payload?.soc, null),
    batteryTempC: toFiniteNumber(payload?.batTemp, null),
    ambientTempC: toFiniteNumber(payload?.temp, null),
    pvPowerW: toFiniteNumber(payload?.ppv, null),
    loadPowerW: toFiniteNumber(payload?.pload ?? payload?.load, null),
    gridPowerW,
    feedInPowerW,
    batteryPowerW: toFiniteNumber(payload?.pbat ?? payload?.cobat, null),
    observedAtIso: observedAtIso || new Date().toISOString(),
    deviceSN: systemSn || null
  };
}

function normalizePowerRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.list)) return payload.list;
  if (payload.uploadTime || payload.ppv !== undefined || payload.pload !== undefined || payload.load !== undefined) {
    return [payload];
  }
  return [];
}

function extractEnergyObject(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] || null;
  if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') return payload.data;
  if (payload && typeof payload === 'object') return payload;
  return null;
}

function defaultGroup(index = 0) {
  return {
    enable: 0,
    workMode: 'SelfUse',
    startHour: 0,
    startMinute: 0,
    endHour: 0,
    endMinute: 0,
    minSocOnGrid: 10,
    fdSoc: 10,
    fdPwr: 0,
    maxSoc: 100,
    groupIndex: index
  };
}

function buildWindowGroup({
  enabled,
  workMode,
  startTime,
  endTime,
  minSocOnGrid,
  fdSoc,
  maxSoc,
  groupIndex
}) {
  const start = timeToParts(startTime);
  const end = timeToParts(endTime);
  return {
    enable: enabled ? 1 : 0,
    workMode,
    startHour: start.hour,
    startMinute: start.minute,
    endHour: end.hour,
    endMinute: end.minute,
    minSocOnGrid: toFiniteNumber(minSocOnGrid, 10),
    fdSoc: toFiniteNumber(fdSoc, 10),
    fdPwr: 0,
    maxSoc: toFiniteNumber(maxSoc, 100),
    groupIndex
  };
}

function groupToAlphaTime(group, keyPrefixStart, keyPrefixEnd) {
  const enabled = Number(group?.enable) === 1;
  if (!enabled) {
    return {
      [keyPrefixStart]: '00:00',
      [keyPrefixEnd]: '00:00'
    };
  }
  const pad = (n) => String(Math.max(0, Math.min(59, Number(n) || 0))).padStart(2, '0');
  const startHour = Math.max(0, Math.min(23, Number(group.startHour) || 0));
  const startMinute = Math.max(0, Math.min(59, Number(group.startMinute) || 0));
  const endHour = Math.max(0, Math.min(23, Number(group.endHour) || 0));
  const endMinute = Math.max(0, Math.min(59, Number(group.endMinute) || 0));

  return {
    [keyPrefixStart]: `${pad(startHour)}:${pad(startMinute)}`,
    [keyPrefixEnd]: `${pad(endHour)}:${pad(endMinute)}`
  };
}

class AlphaEssDeviceAdapter extends DeviceAdapter {
  constructor(options = {}) {
    super();

    if (!options.alphaEssAPI || typeof options.alphaEssAPI.callAlphaESSAPI !== 'function') {
      throw new Error('AlphaEssDeviceAdapter requires alphaEssAPI.callAlphaESSAPI()');
    }

    this.alphaEssAPI = options.alphaEssAPI;
    this.logger = options.logger || console;
    this.defaultCapabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(options.defaultCapabilities || {})
    };
  }

  async getStatus(context = {}) {
    const systemSn = resolveSystemSn(context);
    if (!systemSn) {
      throw new Error('AlphaEssDeviceAdapter.getStatus requires systemSn');
    }

    const result = await this.alphaEssAPI.callAlphaESSAPI(
      '/api/getLastPowerData',
      'GET',
      { sysSn: systemSn },
      context.userConfig,
      context.userId
    );
    if (result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    const observedAtIso = context.observedAtIso || new Date().toISOString();
    return normalizeStatus(result.result || {}, observedAtIso, systemSn);
  }

  async getCapabilities(_context = {}) {
    return { ...this.defaultCapabilities };
  }

  async getSchedule(context = {}) {
    const systemSn = resolveSystemSn(context);
    if (!systemSn) {
      throw new Error('AlphaEssDeviceAdapter.getSchedule requires systemSn');
    }

    const [chargeResult, dischargeResult] = await Promise.all([
      this.alphaEssAPI.callAlphaESSAPI('/api/getChargeConfigInfo', 'GET', { sysSn: systemSn }, context.userConfig, context.userId),
      this.alphaEssAPI.callAlphaESSAPI('/api/getDisChargeConfigInfo', 'GET', { sysSn: systemSn }, context.userConfig, context.userId)
    ]);

    if (chargeResult.errno !== 0) return this.normalizeProviderError(chargeResult);
    if (dischargeResult.errno !== 0) return this.normalizeProviderError(dischargeResult);

    const charge = chargeResult.result || {};
    const discharge = dischargeResult.result || {};
    const groups = [];

    const chargeEnabled = Number(charge.gridCharge) === 1;
    const dischargeEnabled = Number(discharge.ctrDis) === 1;

    const chargeSlots = [
      { start: charge.timeChaf1, end: charge.timeChae1 },
      { start: charge.timeChaf2, end: charge.timeChae2 }
    ];
    chargeSlots.forEach((slot, idx) => {
      groups.push(buildWindowGroup({
        enabled: chargeEnabled && hasConfiguredWindow(slot.start, slot.end),
        workMode: 'ForceCharge',
        startTime: slot.start,
        endTime: slot.end,
        minSocOnGrid: discharge.batUseCap,
        fdSoc: discharge.batUseCap,
        maxSoc: charge.batHighCap,
        groupIndex: idx
      }));
    });

    const dischargeSlots = [
      { start: discharge.timeDisf1, end: discharge.timeDise1 },
      { start: discharge.timeDisf2, end: discharge.timeDise2 }
    ];
    dischargeSlots.forEach((slot, idx) => {
      groups.push(buildWindowGroup({
        enabled: dischargeEnabled && hasConfiguredWindow(slot.start, slot.end),
        workMode: 'ForceDischarge',
        startTime: slot.start,
        endTime: slot.end,
        minSocOnGrid: discharge.batUseCap,
        fdSoc: discharge.batUseCap,
        maxSoc: charge.batHighCap,
        groupIndex: MAX_ALPHA_WINDOWS + idx
      }));
    });

    while (groups.length < DEFAULT_GROUP_COUNT) {
      groups.push(defaultGroup(groups.length));
    }

    return {
      errno: 0,
      result: {
        groups,
        enable: groups.some((group) => Number(group.enable) === 1)
      }
    };
  }

  async setSchedule(context = {}, groups = []) {
    const systemSn = resolveSystemSn(context);
    if (!systemSn) {
      throw new Error('AlphaEssDeviceAdapter.setSchedule requires systemSn');
    }
    if (!Array.isArray(groups)) {
      throw new Error('AlphaEssDeviceAdapter.setSchedule requires groups array');
    }

    // Fetch current values first so unchanged fields are preserved.
    const [existingCharge, existingDischarge] = await Promise.all([
      this.alphaEssAPI.callAlphaESSAPI('/api/getChargeConfigInfo', 'GET', { sysSn: systemSn }, context.userConfig, context.userId),
      this.alphaEssAPI.callAlphaESSAPI('/api/getDisChargeConfigInfo', 'GET', { sysSn: systemSn }, context.userConfig, context.userId)
    ]);

    const chargeCfg = existingCharge.errno === 0 ? (existingCharge.result || {}) : {};
    const dischargeCfg = existingDischarge.errno === 0 ? (existingDischarge.result || {}) : {};

    const enabledGroups = groups.filter((group) => Number(group.enable) === 1);
    const chargeGroups = enabledGroups.filter((group) => group.workMode === 'ForceCharge').slice(0, MAX_ALPHA_WINDOWS);
    const dischargeGroups = enabledGroups
      .filter((group) => group.workMode === 'ForceDischarge' || group.workMode === 'Feedin')
      .slice(0, MAX_ALPHA_WINDOWS);

    const chargePayload = {
      sysSn: systemSn,
      batHighCap: toFiniteNumber(chargeGroups[0]?.maxSoc, toFiniteNumber(chargeCfg.batHighCap, 100)),
      gridCharge: chargeGroups.length > 0 ? 1 : 0,
      ...groupToAlphaTime(chargeGroups[0], 'timeChaf1', 'timeChae1'),
      ...groupToAlphaTime(chargeGroups[1], 'timeChaf2', 'timeChae2')
    };

    const dischargePayload = {
      sysSn: systemSn,
      batUseCap: toFiniteNumber(
        dischargeGroups[0]?.fdSoc ?? dischargeGroups[0]?.minSocOnGrid,
        toFiniteNumber(dischargeCfg.batUseCap, 10)
      ),
      ctrDis: dischargeGroups.length > 0 ? 1 : 0,
      ...groupToAlphaTime(dischargeGroups[0], 'timeDisf1', 'timeDise1'),
      ...groupToAlphaTime(dischargeGroups[1], 'timeDisf2', 'timeDise2')
    };

    const chargeResult = await this.alphaEssAPI.callAlphaESSAPI(
      '/api/updateChargeConfigInfo',
      'POST',
      chargePayload,
      context.userConfig,
      context.userId
    );
    if (chargeResult.errno !== 0) return this.normalizeProviderError(chargeResult);

    const dischargeResult = await this.alphaEssAPI.callAlphaESSAPI(
      '/api/updateDisChargeConfigInfo',
      'POST',
      dischargePayload,
      context.userConfig,
      context.userId
    );
    if (dischargeResult.errno !== 0) return this.normalizeProviderError(dischargeResult);

    return {
      errno: 0,
      result: {
        charge: chargeResult.result,
        discharge: dischargeResult.result
      }
    };
  }

  async clearSchedule(context = {}) {
    return this.setSchedule(context, buildClearedSchedulerGroups(DEFAULT_GROUP_COUNT));
  }

  async getWorkMode(context = {}) {
    const schedule = await this.getSchedule(context);
    if (!schedule || schedule.errno !== 0) {
      return schedule;
    }
    const firstActive = (schedule.result?.groups || []).find((group) => Number(group.enable) === 1);
    return {
      errno: 0,
      result: {
        workMode: firstActive?.workMode || 'SelfUse',
        raw: null
      }
    };
  }

  async setWorkMode(_context = {}, _mode) {
    return {
      errno: 3500,
      error: 'AlphaESS work mode switching is not directly supported via OpenAPI; use scheduler windows instead.'
    };
  }

  async getHistory(context = {}, begin, end, _variables) {
    const systemSn = resolveSystemSn(context);
    if (!systemSn) {
      throw new Error('AlphaEssDeviceAdapter.getHistory requires systemSn');
    }

    const startMs = Number.isFinite(Number(begin)) ? Number(begin) : Date.now() - 24 * 60 * 60 * 1000;
    const endMs = Number.isFinite(Number(end)) ? Number(end) : Date.now();
    const start = new Date(startMs);
    const finish = new Date(endMs);
    const dayMs = 24 * 60 * 60 * 1000;
    const dayCount = Math.max(1, Math.ceil((finish.getTime() - start.getTime() + 1) / dayMs));

    if (dayCount > 7) {
      return {
        errno: 3500,
        error: 'AlphaESS history requests are limited to 7 days per query'
      };
    }

    const datasMap = {};
    const ensureVar = (variable, unit = 'kW') => {
      if (!datasMap[variable]) datasMap[variable] = { variable, name: variable, unit, data: [] };
    };
    const pushPoint = (variable, time, kwValue) => {
      if (kwValue === null || kwValue === undefined) return;
      ensureVar(variable);
      datasMap[variable].data.push({ time, value: kwValue });
    };

    for (let i = 0; i < dayCount; i++) {
      const dayDate = new Date(start.getTime() + i * dayMs);
      const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
      const historyResult = await this.alphaEssAPI.callAlphaESSAPI(
        '/api/getOneDayPowerBySn',
        'GET',
        { sysSn: systemSn, queryDate: dateStr },
        context.userConfig,
        context.userId
      );
      if (historyResult.errno !== 0) return this.normalizeProviderError(historyResult);

      const rows = normalizePowerRows(historyResult.result);
      rows.forEach((row) => {
        const time = alphaTimeToDisplay(row.uploadTime || row.time || row.ts || row.timestamp || '');
        const pvKw = normalizePowerKw(row.ppv);
        const loadKw = normalizePowerKw(row.pload ?? row.load);
        const pgrid = toFiniteNumber(row.pgrid, null);
        const gridKw = pgrid !== null ? normalizePowerKw(Math.max(0, pgrid)) : normalizePowerKw(row.gridCharge);
        const feedKw = pgrid !== null ? normalizePowerKw(Math.max(0, -pgrid)) : normalizePowerKw(row.feedIn);
        const battKw = normalizePowerKw(row.pbat ?? row.cobat);

        pushPoint('generationPower', time, pvKw);
        pushPoint('pvPower', time, pvKw);
        pushPoint('loadsPower', time, loadKw);
        pushPoint('gridConsumptionPower', time, gridKw);
        pushPoint('feedinPower', time, feedKw);
        pushPoint('batteryPower', time, battKw);
      });
    }

    // Keep points chronological for chart rendering
    Object.values(datasMap).forEach((item) => {
      item.data.sort((a, b) => {
        const ta = String(a.time || '');
        const tb = String(b.time || '');
        return ta.localeCompare(tb);
      });
    });

    return {
      errno: 0,
      result: [{ datas: Object.values(datasMap), deviceSN: systemSn }]
    };
  }

  async getReport(context = {}, dimension = 'month', year, month) {
    const systemSn = resolveSystemSn(context);
    if (!systemSn) {
      throw new Error('AlphaEssDeviceAdapter.getReport requires systemSn');
    }

    const now = new Date();
    const targetYear = Number(year) || now.getFullYear();
    const targetMonth = Number(month) || (now.getMonth() + 1);

    const buildItem = (variable, values) => ({ variable, unit: 'kWh', values });
    const variables = {
      generation: [],
      feedin: [],
      gridConsumption: [],
      chargeEnergyToTal: [],
      dischargeEnergyToTal: []
    };

    if (String(dimension) === 'year') {
      const summaryResult = await this.alphaEssAPI.callAlphaESSAPI(
        '/api/getSumDataForCustomer',
        'GET',
        { sysSn: systemSn },
        context.userConfig,
        context.userId
      );
      if (summaryResult.errno !== 0) return this.normalizeProviderError(summaryResult);

      const summary = extractEnergyObject(summaryResult.result) || {};
      const currentMonthIndex = now.getMonth();
      const currentYear = now.getFullYear();
      const sameYear = targetYear === currentYear;

      const generationYear = toFiniteNumber(
        summary.epvyear ?? summary.epvYear ?? summary.epvtotal,
        0
      );
      const feedinYear = toFiniteNumber(summary.eoutputyear ?? summary.eoutputYear ?? summary.eoutput, 0);
      const gridYear = toFiniteNumber(summary.einputyear ?? summary.einputYear ?? summary.einput, 0);
      const chargeYear = toFiniteNumber(summary.echargeyear ?? summary.echargeYear ?? summary.echarge, 0);
      const dischargeYear = toFiniteNumber(summary.edischargeyear ?? summary.edischargeYear ?? summary.edischarge, 0);

      for (let idx = 0; idx < 12; idx++) {
        const valueFactor = sameYear && idx === currentMonthIndex ? 1 : 0;
        variables.generation.push(Number((generationYear * valueFactor).toFixed(3)));
        variables.feedin.push(Number((feedinYear * valueFactor).toFixed(3)));
        variables.gridConsumption.push(Number((gridYear * valueFactor).toFixed(3)));
        variables.chargeEnergyToTal.push(Number((chargeYear * valueFactor).toFixed(3)));
        variables.dischargeEnergyToTal.push(Number((dischargeYear * valueFactor).toFixed(3)));
      }

      return {
        errno: 0,
        result: [
          buildItem('generation', variables.generation),
          buildItem('feedin', variables.feedin),
          buildItem('gridConsumption', variables.gridConsumption),
          buildItem('chargeEnergyToTal', variables.chargeEnergyToTal),
          buildItem('dischargeEnergyToTal', variables.dischargeEnergyToTal)
        ],
        estimated: true
      };
    }

    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const energyResult = await this.alphaEssAPI.callAlphaESSAPI(
        '/api/getOneDateEnergyBySn',
        'GET',
        { sysSn: systemSn, queryDate: dateStr },
        context.userConfig,
        context.userId
      );

      if (energyResult.errno !== 0) {
        // Keep shape stable for charts; missing days are represented as 0.
        variables.generation.push(0);
        variables.feedin.push(0);
        variables.gridConsumption.push(0);
        variables.chargeEnergyToTal.push(0);
        variables.dischargeEnergyToTal.push(0);
        continue;
      }

      const energy = extractEnergyObject(energyResult.result) || {};
      variables.generation.push(toFiniteNumber(energy.epv, 0));
      variables.feedin.push(toFiniteNumber(energy.eOutput, 0));
      variables.gridConsumption.push(toFiniteNumber(energy.eInput, 0));
      variables.chargeEnergyToTal.push(toFiniteNumber(energy.eCharge, 0));
      variables.dischargeEnergyToTal.push(toFiniteNumber(energy.eDischarge, 0));
    }

    return {
      errno: 0,
      result: [
        buildItem('generation', variables.generation),
        buildItem('feedin', variables.feedin),
        buildItem('gridConsumption', variables.gridConsumption),
        buildItem('chargeEnergyToTal', variables.chargeEnergyToTal),
        buildItem('dischargeEnergyToTal', variables.dischargeEnergyToTal)
      ]
    };
  }

  async getGeneration(context = {}) {
    const systemSn = resolveSystemSn(context);
    if (!systemSn) {
      throw new Error('AlphaEssDeviceAdapter.getGeneration requires systemSn');
    }

    const result = await this.alphaEssAPI.callAlphaESSAPI(
      '/api/getSumDataForCustomer',
      'GET',
      { sysSn: systemSn },
      context.userConfig,
      context.userId
    );
    if (result.errno !== 0) return this.normalizeProviderError(result);

    const summary = extractEnergyObject(result.result) || {};

    const today = toFiniteNumber(summary.epvtoday ?? summary.epvToday, 0);
    const month = toFiniteNumber(summary.epvmonth ?? summary.epvMonth ?? today, today);
    const year = toFiniteNumber(summary.epvyear ?? summary.epvYear ?? summary.epvtotal ?? month, month);
    const cumulative = toFiniteNumber(summary.epvtotal ?? summary.epvTotal ?? year, year);

    const round3 = (value) => Number((toFiniteNumber(value, 0)).toFixed(3));
    return {
      errno: 0,
      result: {
        today: round3(today),
        month: round3(month),
        year: round3(year),
        cumulative: round3(cumulative),
        yearGeneration: round3(year)
      }
    };
  }

  normalizeProviderError(error) {
    const providerErrno = Number(error?.errno || error?.status || 0);
    switch (providerErrno) {
      case 3501:
        return { errno: 3501, error: error?.error || 'AlphaESS signature/token validation failed' };
      case 3502:
        return { errno: 3502, error: error?.error || 'AlphaESS authentication failed' };
      case 3503:
        return { errno: 3503, error: error?.error || 'AlphaESS rate limited' };
      case 3504:
        return { errno: 3504, error: error?.error || 'AlphaESS upstream server error' };
      case 3505:
        return { errno: 3505, error: error?.error || 'AlphaESS request timeout' };
      default:
        return {
          errno: 3500,
          error: error?.error || error?.message || 'AlphaESS device command failed'
        };
    }
  }
}

function createAlphaEssDeviceAdapter(options = {}) {
  return new AlphaEssDeviceAdapter(options);
}

module.exports = {
  DEFAULT_CAPABILITIES,
  AlphaEssDeviceAdapter,
  createAlphaEssDeviceAdapter,
  resolveSystemSn,
  normalizeStatus,
  alphaTimeToDisplay
};

