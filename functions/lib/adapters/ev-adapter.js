'use strict';

// ---------------------------------------------------------------------------
// EV Adapter contract
// ---------------------------------------------------------------------------
// All EV vehicle adapters (Tesla Fleet API, Rivian, etc.) must implement this
// interface. The adapter is responsible for vehicle-specific authentication,
// command execution, and status normalisation.  Shared orchestration logic
// (wake-before-command, cooldowns, idempotency) lives in the EV command
// orchestration service — adapters are thin wrappers over vendor APIs only.
// ---------------------------------------------------------------------------

const EV_ADAPTER_REQUIRED_METHODS = Object.freeze([
  'getVehicleStatus',
  'startCharging',
  'stopCharging',
  'setChargeLimit',
  'wakeVehicle',
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

// Canonical command result statuses.
const EV_COMMAND_STATUSES = Object.freeze([
  'queued',      // accepted, vehicle may need waking
  'sent',        // delivered to vehicle
  'confirmed',   // vehicle acknowledged
  'failed'       // terminal failure
]);

// Maximum charge limit percentage value.
const EV_CHARGE_LIMIT_MAX = 100;
const EV_CHARGE_LIMIT_MIN = 1;

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

function normalizeCommandStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (EV_COMMAND_STATUSES.includes(raw)) {
    return raw;
  }
  return 'queued';
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
    asOfIso
  };
}

/**
 * Normalise a raw command result from any EV adapter into the canonical shape.
 *
 * @param {object} raw  - Raw result from vendor API.
 * @returns {object} Canonical command result envelope.
 */
function normalizeCommandResult(raw = {}) {
  return {
    commandId: String(raw.commandId || raw.command_id || ''),
    status: normalizeCommandStatus(raw.status),
    sentAtIso: String(raw.sentAtIso || raw.sent_at || new Date().toISOString()),
    providerRef: String(raw.providerRef || raw.txid || raw.id || '')
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
   * Start charging the vehicle.
   * @param {string} vehicleId
   * @param {object} context - { userId, credentials }
   * @param {object} [options] - e.g. { targetSocPct }
   * @returns {Promise<object>} Normalised via normalizeCommandResult()
   */
  async startCharging(_vehicleId, _context, _options) {
    throw new Error('EVAdapter.startCharging not implemented');
  }

  /**
   * Stop charging the vehicle.
   * @param {string} vehicleId
   * @param {object} context - { userId, credentials }
   * @returns {Promise<object>} Normalised via normalizeCommandResult()
   */
  async stopCharging(_vehicleId, _context) {
    throw new Error('EVAdapter.stopCharging not implemented');
  }

  /**
   * Set the charge limit on the vehicle.
   * @param {string} vehicleId
   * @param {object} context - { userId, credentials }
   * @param {number} limitPct - Integer percentage (1-100)
   * @returns {Promise<object>} Normalised via normalizeCommandResult()
   */
  async setChargeLimit(_vehicleId, _context, _limitPct) {
    throw new Error('EVAdapter.setChargeLimit not implemented');
  }

  /**
   * Wake the vehicle so it can receive commands.
   * @param {string} vehicleId
   * @param {object} context - { userId, credentials }
   * @returns {Promise<object>} { woken: boolean, vehicleId }
   */
  async wakeVehicle(_vehicleId, _context) {
    throw new Error('EVAdapter.wakeVehicle not implemented');
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
}

module.exports = {
  EVAdapter,
  EV_ADAPTER_REQUIRED_METHODS,
  EV_CHARGING_STATES,
  EV_COMMAND_STATUSES,
  EV_CHARGE_LIMIT_MAX,
  EV_CHARGE_LIMIT_MIN,
  normalizeVehicleStatus,
  normalizeCommandResult,
  normalizeChargingState,
  normalizeCommandStatus,
  validateEVAdapter
};
