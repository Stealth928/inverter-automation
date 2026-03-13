'use strict';

const {
  EVAdapter,
  normalizeVehicleStatus
} = require('./ev-adapter');

// ---------------------------------------------------------------------------
// StubEVAdapter — in-memory EV adapter for tests and local dev
// ---------------------------------------------------------------------------
// Simulates a single vehicle with controllable state.
// Use seedVehicle() to inject an initial state.
// ---------------------------------------------------------------------------

class StubEVAdapter extends EVAdapter {
  constructor() {
    super();
    // Map<vehicleId, vehicleState>
    this._vehicles = new Map();
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
    return normalizeVehicleStatus(state);
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
