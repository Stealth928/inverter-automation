'use strict';

const {
  EVAdapter,
  normalizeVehicleStatus,
  normalizeCommandResult,
  normalizeChargingState,
  EV_CHARGE_LIMIT_MAX,
  EV_CHARGE_LIMIT_MIN
} = require('./ev-adapter');

// ---------------------------------------------------------------------------
// StubEVAdapter — in-memory EV adapter for tests and local dev
// ---------------------------------------------------------------------------
// Simulates a single vehicle with controllable state.
// Use seedVehicle() to inject an initial state; read capturedCommands[] to
// inspect what commands were sent.
// ---------------------------------------------------------------------------

const STUB_WAKE_DELAY_MS = 0; // override in tests via options

class StubEVAdapter extends EVAdapter {
  constructor(options = {}) {
    super();
    // Map<vehicleId, vehicleState>
    this._vehicles = new Map();
    // Array of { vehicleId, command, argsJson, issuedAtIso }
    this.capturedCommands = [];
    this._wakeDelayMs = typeof options.wakeDelayMs === 'number' ? options.wakeDelayMs : STUB_WAKE_DELAY_MS;
    this._shouldFailNextCommand = false;
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /**
   * Seed or replace vehicle state for testing.
   * @param {string} vehicleId
   * @param {object} state - Partial vehicle state; defaults applied for missing keys.
   */
  seedVehicle(vehicleId, state = {}) {
    this._vehicles.set(String(vehicleId), {
      socPct: 80,
      chargingState: 'stopped',
      chargeLimitPct: 90,
      isPluggedIn: true,
      isHome: true,
      rangeKm: 320,
      asleep: false,
      ...state
    });
  }

  /**
   * Instruct the adapter to fail the next command (one-time).
   */
  failNextCommand() {
    this._shouldFailNextCommand = true;
  }

  _recordCommand(vehicleId, command, args = {}) {
    this.capturedCommands.push({
      vehicleId: String(vehicleId),
      command,
      argsJson: JSON.stringify(args),
      issuedAtIso: new Date().toISOString()
    });
  }

  _maybeThrow(vehicleId, command) {
    if (this._shouldFailNextCommand) {
      this._shouldFailNextCommand = false;
      throw new Error(`StubEVAdapter: simulated failure for ${command} on ${vehicleId}`);
    }
  }

  _getVehicle(vehicleId) {
    const state = this._vehicles.get(String(vehicleId));
    if (!state) {
      throw new Error(`StubEVAdapter: unknown vehicleId ${vehicleId}`);
    }
    return state;
  }

  // ---------------------------------------------------------------------------
  // EVAdapter interface implementation
  // ---------------------------------------------------------------------------

  async getVehicleStatus(vehicleId, _context) {
    const state = this._getVehicle(vehicleId);
    this._recordCommand(vehicleId, 'getVehicleStatus');
    return normalizeVehicleStatus(state);
  }

  async startCharging(vehicleId, _context, options = {}) {
    this._maybeThrow(vehicleId, 'startCharging');
    const state = this._getVehicle(vehicleId);
    this._recordCommand(vehicleId, 'startCharging', options);

    if (!state.isPluggedIn) {
      throw new Error(`StubEVAdapter: vehicle ${vehicleId} is not plugged in`);
    }

    state.chargingState = 'charging';
    if (options.targetSocPct != null) {
      state.chargeLimitPct = Math.min(EV_CHARGE_LIMIT_MAX, Math.max(EV_CHARGE_LIMIT_MIN, Number(options.targetSocPct)));
    }

    return normalizeCommandResult({
      commandId: `stub-start-${Date.now()}`,
      status: 'sent',
      sentAtIso: new Date().toISOString()
    });
  }

  async stopCharging(vehicleId, _context) {
    this._maybeThrow(vehicleId, 'stopCharging');
    const state = this._getVehicle(vehicleId);
    this._recordCommand(vehicleId, 'stopCharging');

    state.chargingState = normalizeChargingState('stopped');

    return normalizeCommandResult({
      commandId: `stub-stop-${Date.now()}`,
      status: 'sent',
      sentAtIso: new Date().toISOString()
    });
  }

  async setChargeLimit(vehicleId, _context, limitPct) {
    this._maybeThrow(vehicleId, 'setChargeLimit');
    const state = this._getVehicle(vehicleId);

    const limit = Number(limitPct);
    if (!Number.isFinite(limit) || limit < EV_CHARGE_LIMIT_MIN || limit > EV_CHARGE_LIMIT_MAX) {
      throw new Error(`StubEVAdapter: invalid charge limit ${limitPct}`);
    }

    this._recordCommand(vehicleId, 'setChargeLimit', { limitPct: limit });
    state.chargeLimitPct = limit;

    return normalizeCommandResult({
      commandId: `stub-limit-${Date.now()}`,
      status: 'sent',
      sentAtIso: new Date().toISOString()
    });
  }

  async wakeVehicle(vehicleId, _context) {
    this._maybeThrow(vehicleId, 'wakeVehicle');
    const state = this._getVehicle(vehicleId);
    this._recordCommand(vehicleId, 'wakeVehicle');

    if (this._wakeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this._wakeDelayMs));
    }

    state.asleep = false;
    return { woken: true, vehicleId: String(vehicleId) };
  }

  normalizeProviderError(error) {
    return {
      errno: 3800,
      error: error && error.message ? error.message : 'Stub EV adapter error',
      provider: 'stub'
    };
  }
}

module.exports = { StubEVAdapter };
