'use strict';

/**
 * Sungrow iSolarCloud Device Adapter
 *
 * Implements the DeviceAdapter contract for Sungrow hybrid inverters (SH/SE/RS/RX series)
 * paired with SBR or SBH battery modules.
 *
 * Canonical work mode mapping (FoxESS names → Sungrow EMS mode parameter values):
 *   SelfUse        → 2001  (Self-consumption priority)
 *   ForceCharge    → 2002  (Forced battery charging)
 *   ForceDischarge → 2003  (Forced battery discharging)
 *   Backup         → 2028  (Backup/emergency power reserve)
 *   Feedin         → 2003  (treated as ForceDischarge at max power — closest Sungrow equivalent)
 *
 * Real-time data point IDs (SH series hybrids with SBR/SBH battery):
 *   p187   = Battery SOC (%)
 *   p190   = Battery temperature (°C)
 *   p83    = PV generation total power (W) — DC side
 *   p86    = Battery charge/discharge power (W) — positive = charging, negative = discharging
 *   p27    = Load/consumption power (W)
 *   p10994 = Grid import power (W) — positive = importing, negative = exporting
 *   p9     = Inverter output power (W) [optional diagnostic]
 *
 * EMS mode parameter code: p27085 (varies by model — see Sungrow Open API param list)
 *
 * TOU charging time slots (up to 4 periods):
 *   p27243 / p27244 = Period 1 start/end time (HHMM format)
 *   p27245 / p27246 = Period 2 start/end time
 *   p27247 / p27248 = Period 3 start/end time
 *   p27249 / p27250 = Period 4 start/end time
 *   p27251          = TOU enable flag (1 = enabled)
 *
 * NOTE: Parameter codes are model-dependent. Verify against the official Sungrow Open API
 * parameter list for the specific inverter model. The SH-RT hybrid series may use
 * different codes than the SH-K series.
 *
 * iSolarCloud API version: Open API v1
 * Australian gateway: https://augateway.isolarcloud.com
 */

const { DeviceAdapter } = require('./device-adapter');
const { buildClearedSchedulerGroups } = require('../automation-actions');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Real-time data point IDs to request for battery/inverter status */
const DEFAULT_REALTIME_POINTS = Object.freeze([
  'p187',   // Battery SOC (%)
  'p190',   // Battery temperature (°C)
  'p83',    // PV generation power (W)
  'p86',    // Battery power (W, +charge/-discharge)
  'p27',    // Load power (W)
  'p10994', // Grid import/export power (W)
  'p9'      // Inverter output (W) — ambient temperature proxy
]);

/** Sungrow EMS work mode parameter code (model-dependent, verify per Sungrow API docs) */
const EMS_MODE_PARAM_CODE = 'p27085';

/** Canonical work mode name → Sungrow EMS mode integer value */
const WORK_MODE_TO_SUNGROW = Object.freeze({
  SelfUse:        2001,
  ForceCharge:    2002,
  ForceDischarge: 2003,
  Backup:         2028,
  Feedin:         2003  // No direct Sungrow equivalent; map to ForceDischarge
});

/** Sungrow EMS mode value → canonical work mode name */
const SUNGROW_TO_WORK_MODE = Object.freeze({
  2001: 'SelfUse',
  2002: 'ForceCharge',
  2003: 'ForceDischarge',
  2028: 'Backup'
});

const DEFAULT_CAPABILITIES = Object.freeze({
  scheduler: true,     // TOU charging time slots supported
  workMode: true,      // EMS mode switching supported
  minSoc: false,       // minSoc set via device param (not directly mapped — out of scope for v1)
  forceChargeWindow: true  // Forced charge window via TOU slots
});

/** Maximum TOU time-slot periods Sungrow supports */
const MAX_TOU_SLOTS = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDeviceSN(context = {}) {
  const fromContext = context.deviceSN || context.deviceSn;
  if (fromContext) return String(fromContext);
  const fromConfig = context.userConfig?.sungrowDeviceSn || context.userConfig?.deviceSn;
  if (fromConfig) return String(fromConfig);
  return null;
}

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Convert a map of { pointId: rawValue } (Sungrow real-time response) to the
 * canonical device status shape.
 *
 * Sungrow grid meter: positive p10994 = importing from grid, negative = exporting.
 * Canonical: gridPowerW = import (positive), feedInPowerW = export (positive when feeding in).
 */
function normalizeRealtimePoints(pointMap, observedAtIso, deviceSN) {
  const get = (id) => toFiniteNumber(pointMap[id], null);

  const gridNet = get('p10994'); // + = import, − = export
  const gridPowerW = gridNet !== null && gridNet > 0 ? gridNet : 0;
  const feedInPowerW = gridNet !== null && gridNet < 0 ? -gridNet : 0;

  const battPower = get('p86'); // + = charging, − = discharging

  return {
    socPct:        get('p187'),
    batteryTempC:  get('p190'),
    ambientTempC:  null,         // Not available in standard realtime points
    pvPowerW:      get('p83'),
    loadPowerW:    get('p27'),
    gridPowerW,
    feedInPowerW,
    batteryPowerW: battPower,    // Bonus field — useful for diagnostics
    observedAtIso: observedAtIso || new Date().toISOString(),
    deviceSN:      deviceSN || null
  };
}

/**
 * Parse Sungrow real-time data into a flat { pointId: value } map.
 * Handles both array-of-{point_id,value} and object shapes.
 */
function parseRealtimeData(resultData) {
  if (!resultData) return {};
  // Shape: { device_point_list: [{ point_id: "p187", point_value: "75" }, ...] }
  if (Array.isArray(resultData.device_point_list)) {
    return Object.fromEntries(
      resultData.device_point_list.map((p) => [p.point_id, toFiniteNumber(p.point_value, null)])
    );
  }
  // Flat shape: { p187: 75, p190: 28, ... }
  if (typeof resultData === 'object') {
    return Object.fromEntries(
      Object.entries(resultData).map(([k, v]) => [k, toFiniteNumber(v, null)])
    );
  }
  return {};
}

/**
 * Convert FoxESS-style scheduler groups to up to MAX_TOU_SLOTS Sungrow TOU time-slot parameters.
 *
 * Only enabled groups with ForceCharge, ForceDischarge, or Feedin work modes are included
 * (SelfUse/Backup don't map cleanly to TOU charging slots).
 *
 * Returns a flat parameter map: { p27243: 600, p27244: 800, ..., p27251: 1 }
 * where times are encoded as HHMM integers (e.g. 06:00 → 600).
 */
function groupsToTouParams(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    // All TOU slots cleared + TOU disabled
    const params = {};
    for (let i = 0; i < MAX_TOU_SLOTS; i++) {
      const startCode = `p2724${3 + i * 2}`;     // p27243, p27245, p27247, p27249
      const endCode   = `p2724${4 + i * 2}`;     // p27244, p27246, p27248, p27250
      params[startCode] = 0;
      params[endCode]   = 0;
    }
    params.p27251 = 0; // TOU disabled
    return params;
  }

  const CHARGE_MODES = new Set(['ForceCharge', 'ForceDischarge', 'Feedin']);
  const active = groups
    .filter((g) => Number(g.enable) === 1 && CHARGE_MODES.has(g.workMode))
    .slice(0, MAX_TOU_SLOTS);

  const params = {};
  let slotIndex = 0;

  for (const g of active) {
    const startCode = `p2724${3 + slotIndex * 2}`;
    const endCode   = `p2724${4 + slotIndex * 2}`;
    params[startCode] = g.startHour * 100 + (g.startMinute || 0);
    params[endCode]   = g.endHour   * 100 + (g.endMinute   || 0);
    slotIndex++;
  }

  // Zero-fill remaining slots
  for (let i = slotIndex; i < MAX_TOU_SLOTS; i++) {
    const startCode = `p2724${3 + i * 2}`;
    const endCode   = `p2724${4 + i * 2}`;
    params[startCode] = 0;
    params[endCode]   = 0;
  }

  params.p27251 = slotIndex > 0 ? 1 : 0;
  return params;
}

/**
 * Convert Sungrow TOU params back to FoxESS-style scheduler groups (for getSchedule).
 * Best-effort reverse mapping — work mode defaults to ForceCharge for active TOU slots.
 */
function touParamsToGroups(touData) {
  const groups = [];
  const get = (code) => toFiniteNumber(touData?.[code], 0);

  for (let i = 0; i < MAX_TOU_SLOTS; i++) {
    const startCode = `p2724${3 + i * 2}`;
    const endCode   = `p2724${4 + i * 2}`;
    const startHhmm = get(startCode);
    const endHhmm   = get(endCode);
    const enable = startHhmm !== 0 || endHhmm !== 0 ? 1 : 0;
    groups.push({
      enable,
      workMode: 'ForceCharge', // conservative default
      startHour:   Math.floor(startHhmm / 100),
      startMinute: startHhmm % 100,
      endHour:     Math.floor(endHhmm / 100),
      endMinute:   endHhmm % 100,
      minSocOnGrid: 10,
      fdSoc:        10,
      fdPwr:        0,
      maxSoc:       100
    });
  }
  return groups;
}

// ─── Reporting / History constants ───────────────────────────────────────────

/**
 * Energy statistics point IDs for iSolarCloud daily/monthly aggregations (kWh).
 * These are the Sungrow equivalents of the FoxESS report variables.
 * NOTE: Point codes are model-dependent (SH-series hybrid with SBR/SBH battery).
 *   p58  = Daily PV yield (kWh)
 *   p91  = Daily feed-in to grid (kWh)
 *   p89  = Daily grid import energy (kWh)
 *   p90  = Daily battery charge energy (kWh)
 *   p93  = Daily battery discharge energy (kWh)
 */
const ENERGY_STAT_POINTS = Object.freeze({
  generation:           'p58',
  feedin:               'p91',
  gridConsumption:      'p89',
  chargeEnergyToTal:    'p90',
  dischargeEnergyToTal: 'p93'
});

// ─── Timestamp helpers ────────────────────────────────────────────────────────

/** Convert millisecond epoch → iSolarCloud "YYYYMMDDHHMMSS" string (UTC) */
function msToSungrowTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

/** Convert iSolarCloud "YYYYMMDDHHMMSS" → history.js-compatible "YYYY-MM-DD HH:MM:SS" */
function sungrowTsToDisplay(ts) {
  const s = String(ts || '');
  if (s.length < 14) return s;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

/** Extract point data list from a Sungrow history/stats API result object */
function extractPointList(result) {
  if (!result) return [];
  if (Array.isArray(result.device_point_list)) return result.device_point_list;
  if (Array.isArray(result)) return result;
  return [];
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

class SungrowDeviceAdapter extends DeviceAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.sungrowAPI          - Result of sungrow.js init() call
   * @param {Object} [options.logger]             - Logger instance
   * @param {Object} [options.defaultCapabilities] - Capability overrides
   */
  constructor(options = {}) {
    super();

    if (!options.sungrowAPI || typeof options.sungrowAPI.callSungrowAPI !== 'function') {
      throw new Error('SungrowDeviceAdapter requires sungrowAPI.callSungrowAPI()');
    }

    this.sungrowAPI = options.sungrowAPI;
    this.logger = options.logger || console;
    this.defaultCapabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(options.defaultCapabilities || {})
    };
  }

  /**
   * Fetch real-time telemetry from the device.
   * Returns the canonical status shape { socPct, batteryTempC, pvPowerW, ... }.
   */
  async getStatus(context = {}) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('SungrowDeviceAdapter.getStatus requires deviceSN');
    }

    const result = await this.sungrowAPI.callSungrowAPI(
      'queryRealTimeDataByTokenAndType',
      {
        device_type: '22', // 22 = Hybrid Inverter
        device_sn: deviceSN,
        points_id: context.variables || Array.from(DEFAULT_REALTIME_POINTS)
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    const pointMap = parseRealtimeData(result.result);
    const observedAtIso = context.observedAtIso || new Date().toISOString();
    return {
      ...normalizeRealtimePoints(pointMap, observedAtIso, deviceSN),
      telemetryTimestampTrust: context.observedAtIso ? 'source' : 'synthetic'
    };
  }

  async getCapabilities(_context = {}) {
    return { ...this.defaultCapabilities };
  }

  /**
   * Retrieve the current TOU (time-of-use) charging schedule from the device.
   * Returns FoxESS-style scheduler groups for UI compatibility.
   */
  async getSchedule(context = {}) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('SungrowDeviceAdapter.getSchedule requires deviceSN');
    }

    const result = await this.sungrowAPI.callSungrowAPI(
      'queryDevicePointByToken',
      {
        device_type: '22',
        device_sn: deviceSN,
        points_id: [
          'p27243', 'p27244', 'p27245', 'p27246',
          'p27247', 'p27248', 'p27249', 'p27250',
          'p27251', EMS_MODE_PARAM_CODE
        ]
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    const pointMap = parseRealtimeData(result.result);
    const groups = touParamsToGroups(pointMap);
    const enabled = Number(pointMap.p27251 || 0) === 1;
    return { errno: 0, result: { groups, enable: enabled } };
  }

  /**
   * Write a FoxESS-style scheduler groups array to Sungrow as TOU time slots.
   * The adapter translates the format and also activates the TOU schedule on the device.
   */
  async setSchedule(context = {}, groups = []) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('SungrowDeviceAdapter.setSchedule requires deviceSN');
    }
    if (!Array.isArray(groups)) {
      throw new Error('SungrowDeviceAdapter.setSchedule requires groups array');
    }

    const touParams = groupsToTouParams(groups);

    // Determine work mode from the first active enabled group
    const firstActive = groups.find((g) => Number(g.enable) === 1);
    const workMode = firstActive?.workMode || 'SelfUse';
    const emsMode = WORK_MODE_TO_SUNGROW[workMode] || 2001;

    // Build flat list of parameter points to set
    const devicePoints = Object.entries({ ...touParams, [EMS_MODE_PARAM_CODE]: emsMode })
      .map(([point_id, point_value]) => ({ point_id, point_value: String(point_value) }));

    const result = await this.sungrowAPI.callSungrowAPI(
      'setDevicePoint',
      {
        device_type: '22',
        device_sn: deviceSN,
        device_point_list: devicePoints
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      return this.normalizeProviderError(result);
    }

    return { errno: 0, result: result.result };
  }

  async clearSchedule(context = {}) {
    const cleared = buildClearedSchedulerGroups();
    return this.setSchedule(context, cleared);
  }

  /**
   * Retrieve current EMS work mode from the device.
   * Returns { errno, result: { workMode: 'SelfUse' | ... , raw: number } }
   */
  async getWorkMode(context = {}) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('SungrowDeviceAdapter.getWorkMode requires deviceSN');
    }

    const result = await this.sungrowAPI.callSungrowAPI(
      'queryDevicePointByToken',
      {
        device_type: '22',
        device_sn: deviceSN,
        points_id: [EMS_MODE_PARAM_CODE]
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    const pointMap = parseRealtimeData(result.result);
    const rawMode = toFiniteNumber(pointMap[EMS_MODE_PARAM_CODE], null);
    const workMode = SUNGROW_TO_WORK_MODE[rawMode] || 'SelfUse';
    return { errno: 0, result: { workMode, raw: rawMode } };
  }

  /**
   * Set EMS work mode on the device.
   * @param {Object} context
   * @param {string} mode - Canonical mode name (e.g. 'SelfUse', 'ForceCharge')
   */
  async setWorkMode(context = {}, mode) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('SungrowDeviceAdapter.setWorkMode requires deviceSN');
    }

    const emsMode = WORK_MODE_TO_SUNGROW[mode];
    if (emsMode === undefined) {
      throw new Error(`SungrowDeviceAdapter.setWorkMode: unknown mode "${mode}"`);
    }

    const result = await this.sungrowAPI.callSungrowAPI(
      'setDevicePoint',
      {
        device_type: '22',
        device_sn: deviceSN,
        device_point_list: [{ point_id: EMS_MODE_PARAM_CODE, point_value: String(emsMode) }]
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      return this.normalizeProviderError(result);
    }

    return { errno: 0, result: result.result };
  }

  /**
   * Get time-series power history from iSolarCloud.
   * Returns FoxESS-compatible history shape for the history/chart page.
   *
   * iSolarCloud service: queryDeviceHistData
   * Points requested: p83 (PV W), p27 (load W), p10994 (grid net W signed), p86 (battery W)
   *
   * p10994 is split into two separate FoxESS variables:
   *   positive → gridConsumptionPower (importing from grid)
   *   negative → feedinPower (exporting to grid)
   */
  async getHistory(context = {}, begin, end, _variables) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) throw new Error('SungrowDeviceAdapter.getHistory requires deviceSN');

    const startTs = msToSungrowTimestamp(begin || Date.now() - 86400000);
    const endTs   = msToSungrowTimestamp(end   || Date.now());

    const result = await this.sungrowAPI.callSungrowAPI(
      'queryDeviceHistData',
      {
        device_type: '22',
        device_sn: deviceSN,
        points_id: ['p83', 'p27', 'p10994', 'p86'],
        start_time_stamp: startTs,
        end_time_stamp:   endTs
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) return this.normalizeProviderError(result);

    const pointList = extractPointList(result.result);
    const datasMap = {}; // variable → {variable, name, unit, data:[]}

    const ensureVar = (name, unit) => {
      if (!datasMap[name]) datasMap[name] = { variable: name, name, unit, data: [] };
    };

    for (const pt of pointList) {
      const pid = pt.point_id;
      const rawPoints = Array.isArray(pt.point_data) ? pt.point_data : [];
      const unit = pt.data_unit || 'W';
      const scale = unit === 'W' ? 0.001 : 1;
      const outUnit = scale === 0.001 ? 'kW' : unit;

      if (pid === 'p83') {
        ensureVar('generationPower', outUnit);
        ensureVar('pvPower', outUnit);
        for (const dp of rawPoints) {
          const val = toFiniteNumber(dp.point_value, null);
          if (val === null) continue;
          const time = sungrowTsToDisplay(dp.time_stamp);
          const kw = parseFloat((val * scale).toFixed(4));
          datasMap.generationPower.data.push({ time, value: kw });
          datasMap.pvPower.data.push({ time, value: kw });
        }
      } else if (pid === 'p27') {
        ensureVar('loadsPower', outUnit);
        for (const dp of rawPoints) {
          const val = toFiniteNumber(dp.point_value, null);
          if (val === null) continue;
          datasMap.loadsPower.data.push({
            time: sungrowTsToDisplay(dp.time_stamp),
            value: parseFloat((val * scale).toFixed(4))
          });
        }
      } else if (pid === 'p10994') {
        ensureVar('gridConsumptionPower', outUnit);
        ensureVar('feedinPower', outUnit);
        for (const dp of rawPoints) {
          const val = toFiniteNumber(dp.point_value, null);
          if (val === null) continue;
          const kw = val * scale;
          const time = sungrowTsToDisplay(dp.time_stamp);
          datasMap.gridConsumptionPower.data.push({ time, value: parseFloat(Math.max(0, kw).toFixed(4)) });
          datasMap.feedinPower.data.push({ time, value: parseFloat(Math.max(0, -kw).toFixed(4)) });
        }
      } else if (pid === 'p86') {
        ensureVar('batteryPower', outUnit);
        for (const dp of rawPoints) {
          const val = toFiniteNumber(dp.point_value, null);
          if (val === null) continue;
          datasMap.batteryPower.data.push({
            time: sungrowTsToDisplay(dp.time_stamp),
            value: parseFloat((val * scale).toFixed(4))
          });
        }
      }
    }

    return { errno: 0, result: [{ datas: Object.values(datasMap), deviceSN }] };
  }

  /**
   * Get energy report (daily totals for a month, or monthly totals for a year).
   * Returns FoxESS-compatible report shape for the history/report charts.
   *
   * iSolarCloud service: queryDeviceStatPoints
   *   stat_type 'day'   → one value per day in the month
   *   stat_type 'month' → one value per month in the year
   *
   * Response shape: { errno:0, result:[{ variable, unit:'kWh', values:[...] }] }
   */
  async getReport(context = {}, dimension = 'month', year, month) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) throw new Error('SungrowDeviceAdapter.getReport requires deviceSN');

    const nowUtc = new Date();
    const y = year || nowUtc.getUTCFullYear();
    const m = month || (nowUtc.getUTCMonth() + 1);
    const pad = (n) => String(n).padStart(2, '0');

    let startDate, endDate, statType;
    if (dimension === 'year') {
      startDate = `${y}0101`;
      endDate   = `${y}1231`;
      statType  = 'month';
    } else {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      startDate = `${y}${pad(m)}01`;
      endDate   = `${y}${pad(m)}${pad(lastDay)}`;
      statType  = 'day';
    }

    const result = await this.sungrowAPI.callSungrowAPI(
      'queryDeviceStatPoints',
      {
        device_type:      '22',
        device_sn:        deviceSN,
        point_ids:        Object.values(ENERGY_STAT_POINTS),
        start_time_stamp: startDate,
        end_time_stamp:   endDate,
        stat_type:        statType
      },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) return this.normalizeProviderError(result);

    const pointList = extractPointList(result.result);
    const reportItems = Object.entries(ENERGY_STAT_POINTS).map(([varName, pointId]) => {
      const pt = pointList.find((p) => p.point_id === pointId);
      const raw = Array.isArray(pt?.point_data) ? pt.point_data : [];
      const values = raw.map((dp) => toFiniteNumber(dp.point_value, 0));
      return { variable: varName, unit: 'kWh', values };
    });

    return { errno: 0, result: reportItems };
  }

  /**
   * Get generation summary for today, this month, this year, and cumulative.
   * Makes two iSolarCloud calls:
   *   1. Daily stats for the current month → today value + month total
   *   2. Monthly stats for the current year → year total
   *
   * Response shape: { errno:0, result:{ today, month, year, cumulative, yearGeneration } }
   */
  async getGeneration(context = {}) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) throw new Error('SungrowDeviceAdapter.getGeneration requires deviceSN');

    const nowUtc  = new Date();
    const y  = nowUtc.getUTCFullYear();
    const mo = nowUtc.getUTCMonth() + 1;
    const dy = nowUtc.getUTCDate();
    const pad = (n) => String(n).padStart(2, '0');

    const todayStr   = `${y}${pad(mo)}${pad(dy)}`;
    const monthStart = `${y}${pad(mo)}01`;
    const lastDay    = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const monthEnd   = `${y}${pad(mo)}${pad(lastDay)}`;

    // Call 1: daily stats for current month
    const monthResult = await this.sungrowAPI.callSungrowAPI(
      'queryDeviceStatPoints',
      {
        device_type:      '22',
        device_sn:        deviceSN,
        point_ids:        [ENERGY_STAT_POINTS.generation],
        start_time_stamp: monthStart,
        end_time_stamp:   monthEnd,
        stat_type:        'day'
      },
      context.userConfig,
      context.userId
    );

    if (monthResult.errno !== 0) return this.normalizeProviderError(monthResult);

    const monthPtList = extractPointList(monthResult.result);
    const genPt       = monthPtList.find((p) => p.point_id === ENERGY_STAT_POINTS.generation);
    const dailyData   = Array.isArray(genPt?.point_data) ? genPt.point_data : [];

    let todayKwh = 0;
    let monthKwh = 0;
    for (const dp of dailyData) {
      const v = toFiniteNumber(dp.point_value, 0);
      monthKwh += v;
      if (String(dp.time_stamp || '').slice(0, 8) === todayStr) todayKwh = v;
    }

    // Call 2: monthly stats for current year → year total
    const yearResult = await this.sungrowAPI.callSungrowAPI(
      'queryDeviceStatPoints',
      {
        device_type:      '22',
        device_sn:        deviceSN,
        point_ids:        [ENERGY_STAT_POINTS.generation],
        start_time_stamp: `${y}0101`,
        end_time_stamp:   `${y}1231`,
        stat_type:        'month'
      },
      context.userConfig,
      context.userId
    );

    let yearKwh = monthKwh; // fall back to this-month if year call fails
    if (yearResult.errno === 0) {
      const yearPtList  = extractPointList(yearResult.result);
      const yearPt      = yearPtList.find((p) => p.point_id === ENERGY_STAT_POINTS.generation);
      const monthlyData = Array.isArray(yearPt?.point_data) ? yearPt.point_data : [];
      if (monthlyData.length > 0) {
        yearKwh = monthlyData.reduce((s, dp) => s + toFiniteNumber(dp.point_value, 0), 0);
      }
    }

    const round3 = (n) => parseFloat(n.toFixed(3));
    return {
      errno: 0,
      result: {
        today:          round3(todayKwh),
        month:          round3(monthKwh),
        year:           round3(yearKwh),
        cumulative:     round3(yearKwh), // best approximation without lifetime stat point
        yearGeneration: round3(yearKwh)
      }
    };
  }

  /**
   * Map a Sungrow API error response to the standard errno envelope.
   * Sungrow errors occupy errno range 3300–3399.
   */
  normalizeProviderError(error) {
    const providerErrno = Number(error?.errno || error?.status || 0);
    if (providerErrno === 3301) {
      return { errno: 3301, error: error?.error || 'Sungrow session token invalid or expired' };
    }
    if (providerErrno === 3302) {
      return { errno: 3302, error: error?.error || 'Sungrow authentication failed' };
    }
    if (providerErrno === 3303) {
      return { errno: 3303, error: error?.error || 'Sungrow rate limited' };
    }
    if (providerErrno === 3304) {
      return { errno: 3304, error: error?.error || 'Sungrow upstream server error' };
    }
    if (providerErrno === 408) {
      return { errno: 3305, error: error?.error || 'Sungrow request timeout' };
    }
    return {
      errno: 3300,
      error: error?.error || error?.message || 'Sungrow device command failed'
    };
  }
}

function createSungrowDeviceAdapter(options = {}) {
  return new SungrowDeviceAdapter(options);
}

module.exports = {
  DEFAULT_CAPABILITIES,
  DEFAULT_REALTIME_POINTS,
  ENERGY_STAT_POINTS,
  EMS_MODE_PARAM_CODE,
  WORK_MODE_TO_SUNGROW,
  SUNGROW_TO_WORK_MODE,
  SungrowDeviceAdapter,
  createSungrowDeviceAdapter,
  resolveDeviceSN,
  groupsToTouParams,
  touParamsToGroups,
  normalizeRealtimePoints,
  parseRealtimeData,
  msToSungrowTimestamp,
  sungrowTsToDisplay
};
