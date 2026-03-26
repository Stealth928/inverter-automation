'use strict';

// ---------------------------------------------------------------------------
// EV Adapter contract
// ---------------------------------------------------------------------------
// All EV vehicle adapters (Tesla Fleet API, Rivian, etc.) must implement this
// interface. The adapter is responsible for vehicle-specific authentication
// and status normalisation.
// ---------------------------------------------------------------------------

const EV_ADAPTER_REQUIRED_METHODS = Object.freeze([
  'getVehicleStatus',
  'normalizeProviderError'
]);

// Canonical charging states emitted by all EV adapters after normalisation.
const EV_CHARGING_STATES = Object.freeze([
  'charging',        // actively charging
  'complete',        // session ended, charge limit reached
  'stopped',         // stopped by user or automation
  'disconnected',    // cable not plugged in
  'unknown'          // state indeterminate (e.g. vehicle asleep / API unavailable)
]);

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeChargingState(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (EV_CHARGING_STATES.includes(raw)) {
    return raw;
  }
  // common vendor aliases
  if (raw === 'not_charging' || raw === 'idle') return 'stopped';
  if (raw === 'fully_charged') return 'complete';
  if (raw === 'unplugged') return 'disconnected';
  return 'unknown';
}

/**
 * Normalise a raw vehicle status object from any EV adapter into the
 * canonical shape consumed by the rest of the application.
 *
 * @param {object} raw  - Raw status from vendor API (or partial overrides).
 * @param {string|null} observedAtIso - ISO timestamp for when data was read.
 * @returns {object} Canonical vehicle status envelope.
 */
function normalizeVehicleStatus(raw = {}, observedAtIso = null) {
  const asOfIso = observedAtIso || new Date().toISOString();
  return {
    socPct: toFiniteNumber(raw.socPct ?? raw.battery_level ?? raw.soc, null),
    chargingState: normalizeChargingState(raw.chargingState ?? raw.charging_state ?? raw.chargeState),
    chargeLimitPct: toFiniteNumber(raw.chargeLimitPct ?? raw.charge_limit_soc, null),
    isPluggedIn: raw.isPluggedIn ?? raw.plugged_in ?? null,
    isHome: raw.isHome ?? raw.at_home ?? null,
    rangeKm: toFiniteNumber(raw.rangeKm ?? raw.est_battery_range_km ?? raw.battery_range, null),
    ratedRangeKm: toFiniteNumber(raw.ratedRangeKm ?? raw.battery_range_km ?? raw.ideal_battery_range_km, null),
    timeToFullChargeHours: toFiniteNumber(raw.timeToFullChargeHours ?? raw.time_to_full_charge, null),
    chargeEnergyAddedKwh: toFiniteNumber(raw.chargeEnergyAddedKwh ?? raw.charge_energy_added, null),
    rangeAddedKm: toFiniteNumber(raw.rangeAddedKm ?? raw.charge_miles_added_rated_km ?? raw.charge_miles_added_ideal_km, null),
    chargingPowerKw: toFiniteNumber(raw.chargingPowerKw ?? raw.charger_power_kw ?? raw.charger_power, null),
    chargingAmps: toFiniteNumber(raw.chargingAmps ?? raw.charger_actual_current ?? raw.charge_amps, null),
    asOfIso
  };
}

function normalizeCommandResult(raw = {}, observedAtIso = null) {
  const asOfIso = observedAtIso || raw.asOfIso || new Date().toISOString();
  const accepted = raw.accepted !== false;
  return {
    accepted,
    command: String(raw.command || '').trim(),
    status: String(raw.status || (accepted ? 'confirmed' : 'failed')).trim() || (accepted ? 'confirmed' : 'failed'),
    provider: String(raw.provider || 'ev').trim() || 'ev',
    transport: String(raw.transport || 'direct').trim() || 'direct',
    noop: raw.noop === true,
    asOfIso,
    ...(raw.providerRef ? { providerRef: String(raw.providerRef) } : {}),
    ...(raw.reasonCode ? { reasonCode: String(raw.reasonCode) } : {}),
    ...(raw.readinessState ? { readinessState: String(raw.readinessState) } : {}),
    ...(typeof raw.vehicleCommandProtocolRequired === 'boolean'
      ? { vehicleCommandProtocolRequired: raw.vehicleCommandProtocolRequired }
      : {})
  };
}

/**
 * Validate that an adapter object implements all required EVAdapter methods.
 * Throws if any method is missing; returns true on success.
 *
 * @param {object} adapter
 * @returns {true}
 */
function validateEVAdapter(adapter) {
  const missing = EV_ADAPTER_REQUIRED_METHODS.filter(
    (methodName) => !adapter || typeof adapter[methodName] !== 'function'
  );
  if (missing.length > 0) {
    throw new Error(`EV adapter is missing required methods: ${missing.join(', ')}`);
  }
  return true;
}

/**
 * Abstract base class for EV adapters.  Concrete adapters extend this class
 * and override each method.  Direct instantiation throws.
 */
class EVAdapter {
  supportsCommands() {
    return false;
  }

  supportsChargingCommands() {
    return false;
  }

  supportsWake() {
    return false;
  }

  /**
   * Retrieve the current status of the vehicle.
   * @param {string} vehicleId
   * @param {object} context - { userId, credentials }
   * @returns {Promise<object>} Normalised via normalizeVehicleStatus()
   */
  async getVehicleStatus(_vehicleId, _context) {
    throw new Error('EVAdapter.getVehicleStatus not implemented');
  }

  /**
   * Normalise a vendor-specific error into the canonical error envelope.
   * @param {Error|object} error
   * @returns {{ errno: number, error: string, provider: string }}
   */
  normalizeProviderError(error) {
    return {
      errno: 3800,
      error: error && error.message ? error.message : 'EV provider error',
      provider: 'ev'
    };
  }

  async getCommandReadiness(_vehicleId, _context) {
    return {
      state: 'read_only',
      transport: 'none',
      source: 'unsupported',
      vehicleCommandProtocolRequired: null
    };
  }

  async getCommandReadinessBatch(requests = [], context = {}) {
    const output = {};
    for (const request of Array.isArray(requests) ? requests : []) {
      const requestKey = String(request?.key || request?.vehicleId || '').trim();
      if (!requestKey) continue;
      output[requestKey] = await this.getCommandReadiness(
        request?.vehicleId,
        {
          ...(context || {}),
          ...(request?.context || {})
        }
      );
    }
    return output;
  }

  async startCharging(_vehicleId, _context) {
    throw new Error('EVAdapter.startCharging not implemented');
  }

  async stopCharging(_vehicleId, _context) {
    throw new Error('EVAdapter.stopCharging not implemented');
  }

  async setChargeLimit(_vehicleId, _limitPct, _context) {
    throw new Error('EVAdapter.setChargeLimit not implemented');
  }

  async setChargingAmps(_vehicleId, _chargingAmps, _context) {
    throw new Error('EVAdapter.setChargingAmps not implemented');
  }

  async wakeVehicle(_vehicleId, _context) {
    throw new Error('EVAdapter.wakeVehicle not implemented');
  }
}

module.exports = {
  EVAdapter,
  EV_ADAPTER_REQUIRED_METHODS,
  EV_CHARGING_STATES,
  normalizeCommandResult,
  normalizeVehicleStatus,
  normalizeChargingState,
  validateEVAdapter
};
