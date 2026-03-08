'use strict';

const { DeviceAdapter } = require('./device-adapter');

/**
 * Canonical work-mode identifiers the generic adapter accepts.
 * Callers use these names; the adapter maps them to whatever the
 * underlying device expects (here they are stored as-is, since there
 * is no real external API).
 */
const GENERIC_WORK_MODES = Object.freeze(['SelfUse', 'ForceCharge', 'ForceDischarge', 'Backup']);

const DEFAULT_CAPABILITIES = Object.freeze({
  scheduler: false,       // Static/readonly device: scheduling not supported
  workMode: false,        // Work-mode switching not supported
  minSoc: false,
  forceChargeWindow: false
});

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GenericReadonlyDeviceAdapter
 *
 * A second device-vendor implementation that satisfies the DeviceAdapter
 * contract using user-supplied static configuration instead of a live vendor
 * API.  Designed to prove G4 exit criterion #2: "Two device vendors work
 * through the same contract (DeviceAdapter) and are selectable at run-time via
 * the adapter registry."
 *
 * The adapter is intentionally read-heavy:
 *   - `getStatus()` returns normalised data built from the supplied config.
 *   - `getCapabilities()` returns a fixed capability matrix (no scheduling).
 *   - `getSchedule()` returns an empty schedule (no stored slots).
 *   - `setSchedule()` / `clearSchedule()` are acknowledged no-ops.
 *   - `getWorkMode()` tracks a mutable in-process work-mode value.
 *   - `setWorkMode()` validates and stores the new mode in memory.
 *
 * This is intentionally useful as a stand-in for any device vendor whose
 * full API integration has not yet been implemented (e.g. GoodWe, Sungrow,
 * SolarEdge).  A real GoodWeDeviceAdapter would extend/replace this class
 * without any changes to the registration or consumption code.
 *
 * Usage:
 *   const adapter = createGenericDeviceAdapter({ socPct: 75, pvPowerW: 4200 });
 *   adapterRegistry.registerDeviceProvider('goodwe', adapter);
 */
class GenericReadonlyDeviceAdapter extends DeviceAdapter {
  constructor(config = {}) {
    super();

    // Telemetry snapshot passed at construction time
    this._status = {
      socPct:        toFiniteNumber(config.socPct,        null),
      batteryTempC:  toFiniteNumber(config.batteryTempC,  null),
      ambientTempC:  toFiniteNumber(config.ambientTempC,  null),
      pvPowerW:      toFiniteNumber(config.pvPowerW,      null),
      loadPowerW:    toFiniteNumber(config.loadPowerW,    null),
      gridPowerW:    toFiniteNumber(config.gridPowerW,    null),
      feedInPowerW:  toFiniteNumber(config.feedInPowerW,  null)
    };

    // In-memory mutable work mode
    this._workMode = typeof config.workMode === 'string' ? config.workMode : 'SelfUse';

    // Capability matrix — defaults are no-scheduling; callers may override
    this._capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(config.capabilities || {})
    };

    // Optional vendor label for diagnostics
    this.vendorLabel = String(config.vendorLabel || 'generic');
  }

  // ──── DeviceAdapter formal contract ───────────────────────────────────────

  async getStatus(_context = {}) {
    return {
      ...this._status,
      observedAtIso: new Date().toISOString()
    };
  }

  async getCapabilities(_context = {}) {
    return { ...this._capabilities };
  }

  async getSchedule(_context = {}) {
    // No persisted schedule on a readonly device
    return { groups: [], slots: [] };
  }

  async setSchedule(_context = {}, _groups = []) {
    // No-op acknowledged — a real vendor adapter would push to the device API
    return { acknowledged: true, slots: 0 };
  }

  async clearSchedule(_context = {}) {
    // No-op acknowledged
    return { acknowledged: true };
  }

  async getWorkMode(_context = {}) {
    return { workMode: this._workMode };
  }

  async setWorkMode(_context = {}, mode) {
    const normalized = String(mode || '').trim();
    if (!normalized) {
      throw new Error('GenericReadonlyDeviceAdapter.setWorkMode: mode is required');
    }
    this._workMode = normalized;
    return { workMode: this._workMode, acknowledged: true };
  }

  normalizeProviderError(error) {
    return {
      errno: 3420,
      error: error && error.message ? error.message : 'Generic device adapter error'
    };
  }

  // ──── Status update helper (for testing / simulation) ─────────────────────

  /**
   * Update the in-memory telemetry snapshot.
   * Useful for test scenarios that need to simulate changing device state.
   */
  updateStatus(patch = {}) {
    for (const [key, value] of Object.entries(patch)) {
      if (Object.prototype.hasOwnProperty.call(this._status, key)) {
        this._status[key] = toFiniteNumber(value, null);
      }
    }
  }
}

function createGenericDeviceAdapter(config = {}) {
  return new GenericReadonlyDeviceAdapter(config);
}

module.exports = {
  GenericReadonlyDeviceAdapter,
  createGenericDeviceAdapter,
  GENERIC_WORK_MODES
};
