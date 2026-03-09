'use strict';

/**
 * SigenEnergy Device Adapter
 *
 * Implements the DeviceAdapter contract for SigenEnergy hybrid inverter / battery systems
 * (SigenStor AC/DC series with SigenEnergy gateway).
 *
 * Canonical work mode mapping (FoxESS names → SigenEnergy NBMode integers):
 *   SelfUse        → 0  (Maximum Self-Consumption / MSC)
 *   Feedin         → 5  (Fully Feed-in to Grid / FFG)
 *   ForceCharge    → TODO: verify against SigenEnergy API (may need Northbound API or custom profile)
 *   ForceDischarge → TODO: verify against SigenEnergy API
 *   Backup         → TODO: no direct equivalent in standard modes
 *
 * Real-time energy flow fields returned by GET device/sigen/station/energyflow:
 *   TODO: Field names are unconfirmed — verify against your SigenEnergy API response.
 *         Canonical renames like pvPowerW, socPct etc. will need to be updated
 *         once you have a real response payload to check against.
 *
 * TOU / Schedule support:
 *   SigenEnergy TOU scheduling requires the Northbound API (separate auth flow).
 *   This is NOT implemented in this skeleton — getSchedule/setSchedule/clearSchedule
 *   return stubs. Implement once the Northbound API has been tested.
 *
 * History / Report / Generation:
 *   These return null in the skeleton, causing the route layer to fall through
 *   to the FoxESS path gracefully. Implement once the energy statistics API
 *   endpoints have been validated.
 *
 * SigenEnergy API reference:
 *   https://api-apac.sigencloud.com/ (regional — see sigenergy.js for all regions)
 *   Energy flow: GET device/sigen/station/energyflow?id={stationId}
 *   Modes:       GET device/energy-profile/mode/current/{stationId}
 *                GET device/energy-profile/mode/all/{stationId}
 *                PUT device/energy-profile/mode
 */

const { DeviceAdapter } = require('./device-adapter');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * SigenEnergy operational mode integers.
 * From SigenEnergy Python SDK constants (NBMode class).
 * These are the default "working mode" integers used in the public API.
 */
const SIGENERGY_MODES = Object.freeze({
  MSC: 0,   // Maximum Self-Consumption  → canonical: SelfUse
  FFG: 5,   // Fully Feed-in to Grid     → canonical: Feedin
  VPP: 6,   // Virtual Power Plant       → no canonical equivalent
  NBI: 8    // North Bound Interface     → required for Northbound API control
  // TODO: ForceCharge and ForceDischarge require Northbound API or custom energy profiles
});

/** Canonical work mode name → SigenEnergy mode integer */
const WORK_MODE_TO_SIGENERGY = Object.freeze({
  SelfUse:        0,   // MSC
  Feedin:         5,   // FFG
  // TODO: Investigate ForceCharge / ForceDischarge equivalents
  ForceCharge:    null,
  ForceDischarge: null,
  Backup:         null
});

/** SigenEnergy mode integer → canonical work mode name */
const SIGENERGY_TO_WORK_MODE = Object.freeze({
  0: 'SelfUse',
  5: 'Feedin',
  6: 'Feedin'   // VPP treated as Feedin for canonical purposes
});

const DEFAULT_CAPABILITIES = Object.freeze({
  scheduler:        false,  // TOU via Northbound API — not yet implemented
  workMode:         true,   // Mode switching via standard API
  minSoc:           false,
  forceChargeWindow: false  // Deferred pending Northbound API validation
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDeviceSN(context = {}) {
  const fromContext = context.deviceSN || context.deviceSn;
  if (fromContext) return String(fromContext);
  const fromConfig = context.userConfig?.sigenDeviceSn || context.userConfig?.deviceSn;
  if (fromConfig) return String(fromConfig);
  return null;
}

function resolveStationId(context = {}) {
  const fromContext = context.stationId;
  if (fromContext) return String(fromContext);
  const fromConfig = context.userConfig?.sigenStationId;
  if (fromConfig) return String(fromConfig);
  return null;
}

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Map SigenEnergy energy flow response to canonical device status shape.
 *
 * TODO: Field names below (e.g. pvPower, batterySoc, batteryPower, gridPower, loadPower,
 * feedPower) are PLACEHOLDERS. Replace with actual field names from a live
 * GET device/sigen/station/energyflow response once tested.
 *
 * The energy flow endpoint returns a flat object with energy values in Watts (or kW?).
 * Positive gridPower = importing; negative = exporting (feedIn).
 *
 * @param {Object} flow - Raw energy flow response body (.data field)
 * @param {string} [observedAtIso]
 * @param {string} [deviceSN]
 * @returns {Object} Canonical status shape
 */
function normalizeEnergyFlow(flow, observedAtIso, deviceSN) {
  if (!flow || typeof flow !== 'object') {
    return {
      socPct:        null,
      batteryTempC:  null,
      ambientTempC:  null,
      pvPowerW:      null,
      loadPowerW:    null,
      gridPowerW:    null,
      feedInPowerW:  null,
      batteryPowerW: null,
      observedAtIso: observedAtIso || new Date().toISOString(),
      deviceSN:      deviceSN || null
    };
  }

  // TODO: Replace these field names with actual ones from a live API response.
  // Common patterns seen in energy management APIs:
  //   pvPower / pv_power / pvOutputPower
  //   batterySoc / soc / battSoc
  //   batteryPower / batPower / battPower (+ = charging, - = discharging)
  //   gridPower / gridActivePower (+ = import, - = export)
  //   loadPower / housePower / loadActivePower
  //   feedPower / feedInPower (separate field if not derived from gridPower)
  const pvPowerRaw    = toFiniteNumber(flow.pvPower    ?? flow.pv_power    ?? flow.pvOutputPower, null);
  const socRaw        = toFiniteNumber(flow.batterySoc ?? flow.soc         ?? flow.battSoc,       null);
  const battPowerRaw  = toFiniteNumber(flow.battPower  ?? flow.batteryPower ?? flow.batPower,      null);
  const gridPowerRaw  = toFiniteNumber(flow.gridPower  ?? flow.gridActivePower, null);
  const loadPowerRaw  = toFiniteNumber(flow.loadPower  ?? flow.housePower  ?? flow.loadActivePower, null);

  // Derive grid import vs feed-in from signed gridPower
  const gridPowerW   = gridPowerRaw !== null && gridPowerRaw > 0 ? gridPowerRaw : 0;
  const feedInPowerW = gridPowerRaw !== null && gridPowerRaw < 0 ? -gridPowerRaw : 0;

  return {
    socPct:        socRaw,
    batteryTempC:  null,  // TODO: not available in energy flow — may need a separate endpoint
    ambientTempC:  null,
    pvPowerW:      pvPowerRaw,
    loadPowerW:    loadPowerRaw,
    gridPowerW,
    feedInPowerW,
    batteryPowerW: battPowerRaw,
    observedAtIso: observedAtIso || new Date().toISOString(),
    deviceSN:      deviceSN || null
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

class SigenEnergyDeviceAdapter extends DeviceAdapter {
  /**
   * @param {Object} options
   * @param {Object} options.sigenEnergyAPI           - Result of sigenergy.js init() call
   * @param {Object} [options.logger]                 - Logger instance
   * @param {Object} [options.defaultCapabilities]    - Capability overrides
   */
  constructor(options = {}) {
    super();

    if (!options.sigenEnergyAPI || typeof options.sigenEnergyAPI.callSigenEnergyAPI !== 'function') {
      throw new Error('SigenEnergyDeviceAdapter requires sigenEnergyAPI.callSigenEnergyAPI()');
    }

    this.sigenEnergyAPI = options.sigenEnergyAPI;
    this.logger = options.logger || console;
    this.defaultCapabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(options.defaultCapabilities || {})
    };
  }

  /**
   * Fetch real-time telemetry (energy flow) from the SigenEnergy cloud API.
   * GET device/sigen/station/energyflow?id={stationId}
   *
   * NOTE: stationId is stored in userConfig.sigenStationId (resolved during setup/login).
   * The energy flow endpoint is keyed on stationId, not deviceSN.
   */
  async getStatus(context = {}) {
    const stationId = resolveStationId(context);
    const deviceSN  = resolveDeviceSN(context);

    if (!stationId) {
      throw new Error('SigenEnergyDeviceAdapter.getStatus requires stationId in userConfig.sigenStationId');
    }

    const result = await this.sigenEnergyAPI.callSigenEnergyAPI(
      'GET',
      `device/sigen/station/energyflow`,
      { id: stationId },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    return normalizeEnergyFlow(result.result, context.observedAtIso, deviceSN || stationId);
  }

  async getCapabilities(_context = {}) {
    return { ...this.defaultCapabilities };
  }

  /**
   * Retrieve the current operational mode from the SigenEnergy API.
   * GET device/energy-profile/mode/current/{stationId}
   *
   * Returns { errno: 0, result: { workMode: 'SelfUse' | 'Feedin' | ..., raw: number } }
   */
  async getWorkMode(context = {}) {
    const stationId = resolveStationId(context);
    if (!stationId) {
      throw new Error('SigenEnergyDeviceAdapter.getWorkMode requires stationId');
    }

    const result = await this.sigenEnergyAPI.callSigenEnergyAPI(
      'GET',
      `device/energy-profile/mode/current/${stationId}`,
      null,
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    // TODO: Confirm the exact field name for current mode integer in the response.
    // Based on sigen-api Python SDK: response_data["currentMode"] is the integer.
    const data = result.result || {};
    const rawMode  = toFiniteNumber(data.currentMode ?? data.operationMode ?? data.mode, null);
    const workMode = SIGENERGY_TO_WORK_MODE[rawMode] || 'SelfUse';

    return { errno: 0, result: { workMode, raw: rawMode } };
  }

  /**
   * Set the operational mode on the SigenEnergy station.
   * PUT device/energy-profile/mode
   *
   * Body: { stationId, operationMode, profileId }
   *
   * @param {Object} context
   * @param {string} mode - Canonical mode name (e.g. 'SelfUse', 'Feedin')
   */
  async setWorkMode(context = {}, mode) {
    const stationId = resolveStationId(context);
    if (!stationId) {
      throw new Error('SigenEnergyDeviceAdapter.setWorkMode requires stationId');
    }

    const modeInt = WORK_MODE_TO_SIGENERGY[mode];
    if (modeInt === null || modeInt === undefined) {
      throw new Error(
        `SigenEnergyDeviceAdapter.setWorkMode: mode "${mode}" is not yet supported. ` +
        `Supported: SelfUse (0), Feedin (5). ForceCharge/ForceDischarge require Northbound API.`
      );
    }

    const result = await this.sigenEnergyAPI.callSigenEnergyAPI(
      'PUT',
      'device/energy-profile/mode',
      { stationId, operationMode: modeInt, profileId: -1 },
      context.userConfig,
      context.userId
    );

    if (result.errno !== 0) {
      return this.normalizeProviderError(result);
    }

    return { errno: 0, result: result.result };
  }

  /**
   * TOU schedule retrieval — NOT YET IMPLEMENTED.
   * SigenEnergy scheduling requires the Northbound API (separate auth).
   * Returns an empty schedule so rule evaluation degrades gracefully.
   */
  async getSchedule(_context = {}) {
    this.logger.info('[SigenEnergyAdapter] getSchedule: TOU via Northbound API not yet implemented — returning empty stub');
    return { errno: 0, result: { groups: [], enable: false, _stub: true } };
  }

  /**
   * TOU schedule write — NOT YET IMPLEMENTED (Northbound API required).
   * Returns a no-op success so automation rule application doesn't hard-fail.
   */
  async setSchedule(_context = {}, _groups = []) {
    this.logger.warn('[SigenEnergyAdapter] setSchedule: TOU via Northbound API not yet implemented — no-op');
    return { errno: 0, result: { _stub: true, msg: 'SigenEnergy TOU scheduling not yet implemented' } };
  }

  async clearSchedule(_context = {}) {
    return this.setSchedule(_context, []);
  }

  /**
   * History, report, and generation all return null so the route layer
   * skips them and falls back to the FoxESS path (which will return 404
   * for non-FoxESS users — acceptable for the skeleton release).
   *
   * TODO: Implement once SigenEnergy history API endpoints are validated.
   */
  async getHistory(_context = {}) {
    return null;
  }

  async getReport(_context = {}) {
    return null;
  }

  async getGeneration(_context = {}) {
    return null;
  }

  /**
   * Map a SigenEnergy API error response to the standard errno envelope.
   * SigenEnergy errors occupy errno range 3400–3499.
   */
  normalizeProviderError(error) {
    const providerErrno = Number(error?.errno || error?.status || 0);
    switch (providerErrno) {
      case 3401: return { errno: 3401, error: error?.error || 'SigenEnergy token invalid or expired' };
      case 3402: return { errno: 3402, error: error?.error || 'SigenEnergy authentication failed' };
      case 3403: return { errno: 3403, error: error?.error || 'SigenEnergy rate limited' };
      case 3404: return { errno: 3404, error: error?.error || 'SigenEnergy upstream server error' };
      case 3405: return { errno: 3405, error: error?.error || 'SigenEnergy request timeout' };
      default:   return { errno: 3400, error: error?.error || error?.message || 'SigenEnergy device command failed' };
    }
  }
}

function createSigenEnergyDeviceAdapter(options = {}) {
  return new SigenEnergyDeviceAdapter(options);
}

module.exports = {
  DEFAULT_CAPABILITIES,
  SIGENERGY_MODES,
  WORK_MODE_TO_SIGENERGY,
  SIGENERGY_TO_WORK_MODE,
  SigenEnergyDeviceAdapter,
  createSigenEnergyDeviceAdapter,
  resolveDeviceSN,
  resolveStationId,
  normalizeEnergyFlow
};
