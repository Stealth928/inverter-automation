'use strict';

// ---------------------------------------------------------------------------
// EV Command Orchestration Service
// ---------------------------------------------------------------------------
// Implements all orchestration concerns that sit above the raw EVAdapter:
//
//   1. Idempotency    — duplicate commandId is rejected with 409-style error
//   2. Wake sequencing — ensure vehicle is online before sending commands
//   3. Cooldown        — minimum gap between commands per vehicle
//   4. Conflict detection — block charge_start if automation is discharging
//
// This service wraps an EVAdapter and a VehiclesRepository.  It is
// adapter-vendor-agnostic; the adapter handles the vendor-specific HTTP.
// ---------------------------------------------------------------------------

// Default configuration constants
const DEFAULT_COMMAND_COOLDOWN_MS = 10000;     // 10 s between any two commands
const _DEFAULT_WAKE_TIMEOUT_MS = 30000;        // match adapter wake timeout (unused here; adapter manages internally)
const IDEMPOTENCY_WINDOW_SECS = 300;           // 5-minute dedup window

function nowIso() {
  return new Date().toISOString();
}

function generateCommandId(commandType) {
  return `ev-${commandType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create the EV command orchestration service.
 *
 * @param {object} deps
 * @param {object} deps.evAdapter         - Object implementing EVAdapter interface
 * @param {object} deps.vehiclesRepo      - Object implementing VehiclesRepository interface
 * @param {object} [deps.logger]          - { debug, warn, error }
 * @param {number} [deps.commandCooldownMs] - Minimum ms between commands (default 10s)
 * @param {boolean} [deps.skipWake]       - Disable wake step (useful for tests/stub adapters)
 * @returns {object} Orchestration service
 */
function createEVCommandService(deps = {}) {
  const { evAdapter, vehiclesRepo } = deps;
  const logger = deps.logger || { debug: () => {}, warn: () => {}, error: () => {} };
  const commandCooldownMs = typeof deps.commandCooldownMs === 'number'
    ? deps.commandCooldownMs
    : DEFAULT_COMMAND_COOLDOWN_MS;
  const skipWake = Boolean(deps.skipWake);

  if (!evAdapter || typeof evAdapter.getVehicleStatus !== 'function') {
    throw new Error('createEVCommandService requires a valid evAdapter dependency');
  }
  if (!vehiclesRepo || typeof vehiclesRepo.appendCommand !== 'function') {
    throw new Error('createEVCommandService requires a valid vehiclesRepo dependency');
  }

  // In-memory last-command timestamp per vehicle for cooldown enforcement
  // (supplemented by Firestore audit log for cross-instance safety)
  const _lastCommandAt = new Map();

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Enforce per-vehicle command cooldown.  Throws if too soon.
   */
  function _checkCooldown(vehicleId) {
    const lastAt = _lastCommandAt.get(String(vehicleId));
    if (!lastAt) return;
    const elapsed = Date.now() - lastAt;
    if (elapsed < commandCooldownMs) {
      const remainingMs = commandCooldownMs - elapsed;
      throw new Error(
        `EV command cooldown: vehicle ${vehicleId} — wait ${remainingMs}ms before next command`
      );
    }
  }

  function _recordCommandAt(vehicleId) {
    _lastCommandAt.set(String(vehicleId), Date.now());
  }

  /**
   * Check Firestore audit log for recent duplicate commandId.
   * Returns true if the command was already issued within the idempotency window.
   */
  async function _isDuplicateCommand(userId, vehicleId, commandId) {
    const existing = await vehiclesRepo.getCommand(userId, vehicleId, commandId);
    if (!existing) return false;
    const ageSecs = (Date.now() - new Date(existing.requestedAtIso || 0).getTime()) / 1000;
    return ageSecs < IDEMPOTENCY_WINDOW_SECS;
  }

  /**
   * Wake the vehicle if not already online (skipped when skipWake=true).
   */
  async function _ensureVehicleOnline(vehicleId, context) {
    if (skipWake) return;

    // Check current status first; if already online, skip wake
    try {
      const status = await evAdapter.getVehicleStatus(vehicleId, context);
      // If we got a status response with a known charging state, vehicle is online
      if (status && status.chargingState && status.chargingState !== 'unknown') {
        logger.debug('EVCommandService', `Vehicle ${vehicleId} already online`);
        return;
      }
    } catch {
      // Status check failed → proceed to wake attempt
    }

    logger.debug('EVCommandService', `Waking vehicle ${vehicleId}`);
    await evAdapter.wakeVehicle(vehicleId, context);
  }

  // ---------------------------------------------------------------------------
  // Public command methods
  // ---------------------------------------------------------------------------

  /**
   * Start charging a vehicle with full orchestration.
   *
   * @param {string} userId
   * @param {string} vehicleId
   * @param {object} context         - { credentials }
   * @param {object} [options]       - { commandId?, targetSocPct?, automationState? }
   * @returns {Promise<object>} { commandId, status, sentAtIso, providerRef }
   */
  async function startCharging(userId, vehicleId, context, options = {}) {
    const commandId = options.commandId || generateCommandId('startCharging');

    // 1. Idempotency check
    if (await _isDuplicateCommand(userId, vehicleId, commandId)) {
      const existing = await vehiclesRepo.getCommand(userId, vehicleId, commandId);
      logger.warn('EVCommandService', `Duplicate startCharging commandId ${commandId} — returning cached result`);
      return existing;
    }

    // 2. Conflict detection: don't charge while automation is forcing discharge
    const automationState = options.automationState || {};
    if (automationState.ruleActive && automationState.ruleType === 'force_discharge') {
      throw new Error('EV conflict: cannot start charging while automation force-discharge rule is active');
    }

    // 3. Cooldown check
    _checkCooldown(vehicleId);

    // 4. Log command intent
    const entry = {
      commandId,
      commandType: 'startCharging',
      status: 'queued',
      requestedAtIso: nowIso(),
      params: { targetSocPct: options.targetSocPct ?? null }
    };
    await vehiclesRepo.appendCommand(userId, vehicleId, entry);

    try {
      // 5. Wake vehicle
      await _ensureVehicleOnline(vehicleId, context);

      // 6. Issue command
      const result = await evAdapter.startCharging(vehicleId, context, {
        targetSocPct: options.targetSocPct
      });

      // 7. Record cooldown timestamp
      _recordCommandAt(vehicleId);

      // 8. Update audit log
      await vehiclesRepo.updateCommand(userId, vehicleId, commandId, {
        status: result.status,
        sentAtIso: result.sentAtIso,
        providerRef: result.providerRef,
        completedAtIso: nowIso()
      });

      return { ...result, commandId };
    } catch (err) {
      await vehiclesRepo.updateCommand(userId, vehicleId, commandId, {
        status: 'failed',
        errorMsg: err.message,
        completedAtIso: nowIso()
      });
      throw err;
    }
  }

  /**
   * Stop charging a vehicle with full orchestration.
   */
  async function stopCharging(userId, vehicleId, context, options = {}) {
    const commandId = options.commandId || generateCommandId('stopCharging');

    if (await _isDuplicateCommand(userId, vehicleId, commandId)) {
      logger.warn('EVCommandService', `Duplicate stopCharging commandId ${commandId}`);
      return await vehiclesRepo.getCommand(userId, vehicleId, commandId);
    }

    _checkCooldown(vehicleId);

    const entry = {
      commandId,
      commandType: 'stopCharging',
      status: 'queued',
      requestedAtIso: nowIso()
    };
    await vehiclesRepo.appendCommand(userId, vehicleId, entry);

    try {
      await _ensureVehicleOnline(vehicleId, context);
      const result = await evAdapter.stopCharging(vehicleId, context);
      _recordCommandAt(vehicleId);
      await vehiclesRepo.updateCommand(userId, vehicleId, commandId, {
        status: result.status,
        sentAtIso: result.sentAtIso,
        providerRef: result.providerRef,
        completedAtIso: nowIso()
      });
      return { ...result, commandId };
    } catch (err) {
      await vehiclesRepo.updateCommand(userId, vehicleId, commandId, {
        status: 'failed',
        errorMsg: err.message,
        completedAtIso: nowIso()
      });
      throw err;
    }
  }

  /**
   * Set the charge limit with full orchestration.
   */
  async function setChargeLimit(userId, vehicleId, context, limitPct, options = {}) {
    const commandId = options.commandId || generateCommandId('setChargeLimit');

    if (await _isDuplicateCommand(userId, vehicleId, commandId)) {
      logger.warn('EVCommandService', `Duplicate setChargeLimit commandId ${commandId}`);
      return await vehiclesRepo.getCommand(userId, vehicleId, commandId);
    }

    _checkCooldown(vehicleId);

    const entry = {
      commandId,
      commandType: 'setChargeLimit',
      status: 'queued',
      requestedAtIso: nowIso(),
      params: { limitPct }
    };
    await vehiclesRepo.appendCommand(userId, vehicleId, entry);

    try {
      await _ensureVehicleOnline(vehicleId, context);
      const result = await evAdapter.setChargeLimit(vehicleId, context, limitPct);
      _recordCommandAt(vehicleId);
      await vehiclesRepo.updateCommand(userId, vehicleId, commandId, {
        status: result.status,
        sentAtIso: result.sentAtIso,
        providerRef: result.providerRef,
        completedAtIso: nowIso()
      });
      return { ...result, commandId };
    } catch (err) {
      await vehiclesRepo.updateCommand(userId, vehicleId, commandId, {
        status: 'failed',
        errorMsg: err.message,
        completedAtIso: nowIso()
      });
      throw err;
    }
  }

  /**
   * Retrieve current vehicle status (passthrough, no orchestration needed).
   */
  async function getVehicleStatus(userId, vehicleId, context) {
    const status = await evAdapter.getVehicleStatus(vehicleId, context);
    // Persist status cache in vehicles repo
    await vehiclesRepo.saveVehicleState(userId, vehicleId, status);
    return status;
  }

  return {
    startCharging,
    stopCharging,
    setChargeLimit,
    getVehicleStatus
  };
}

module.exports = {
  createEVCommandService,
  DEFAULT_COMMAND_COOLDOWN_MS,
  IDEMPOTENCY_WINDOW_SECS
};
