'use strict';

/**
 * EV-specific automation condition evaluators.
 *
 * All evaluators follow the same contract as the existing condition helpers
 * (evaluateTemperatureCondition, evaluateTimeCondition):
 *   evaluateXxx(condition, context) => { met: bool, ...diagnostics }
 *
 * Condition shapes:
 *   evVehicleSoC:       { enabled, vehicleId?, operator, value, value2? }
 *   evVehicleLocation:  { enabled, vehicleId?, requireHome: bool }
 *   evChargingState:    { enabled, vehicleId?, state: string }
 */

const { EV_CHARGING_STATES } = require('./adapters/ev-adapter');

/**
 * Resolve the vehicle status to use for a condition.
 * Supports:
 *   - evVehicleStatusMap[vehicleId]  — specific vehicle
 *   - first entry in the map         — implicit single-vehicle setup
 * Returns null when no status is available.
 *
 * @param {Record<string, object>} evVehicleStatusMap
 * @param {string|undefined} vehicleId
 * @returns {{ vehicleId: string, status: object }|null}
 */
function resolveVehicleStatus(evVehicleStatusMap, vehicleId) {
  if (!evVehicleStatusMap || typeof evVehicleStatusMap !== 'object') return null;
  const ids = Object.keys(evVehicleStatusMap);
  if (ids.length === 0) return null;

  if (vehicleId) {
    const status = evVehicleStatusMap[vehicleId];
    if (!status) return null;
    return { vehicleId, status };
  }

  // Implicit: use the first (and typically only) registered vehicle
  const firstId = ids[0];
  return { vehicleId: firstId, status: evVehicleStatusMap[firstId] };
}

/**
 * Compare a numeric actual value against operator + target(s).
 * Mirrors the compareValue helper inside automation-rule-evaluation-service.js.
 */
function compareValue(actual, operator, target, target2) {
  if (actual === null || actual === undefined) return false;
  switch (operator) {
    case '>':  return actual > target;
    case '>=': return actual >= target;
    case '<':  return actual < target;
    case '<=': return actual <= target;
    case '==': return actual == target;
    case '!=': return actual != target;
    case 'between': {
      if (target2 != null) return actual >= Math.min(target, target2) && actual <= Math.max(target, target2);
      if (Array.isArray(target)) return actual >= target[0] && actual <= target[1];
      return false;
    }
    default: return false;
  }
}

// ── 1. Vehicle State of Charge ─────────────────────────────────────────────

/**
 * Evaluate an EV vehicle SoC condition.
 *
 * condition: { enabled, vehicleId?, operator, value, value2? }
 * context:   { evVehicleStatusMap: Record<vehicleId, normalizedVehicleStatus> }
 *
 * Returns: { met, actual, operator, target, vehicleId } | { met: false, reason }
 */
function evaluateEVSoCCondition(condition, context = {}) {
  const resolved = resolveVehicleStatus(context.evVehicleStatusMap, condition.vehicleId);
  if (!resolved) {
    return { met: false, reason: 'No EV vehicle status available' };
  }

  const { vehicleId, status } = resolved;
  const soc = status.socPct;

  if (soc === null || soc === undefined) {
    return { met: false, reason: 'Vehicle SoC not reported', vehicleId };
  }

  const operator = condition.op || condition.operator;
  const value = condition.value;
  const value2 = condition.value2;

  let met;
  if (operator === 'between' && value2 != null) {
    met = compareValue(soc, 'between', value, value2);
  } else {
    met = compareValue(soc, operator, value);
  }

  return { met, actual: soc, operator, target: value, target2: value2, vehicleId };
}

// ── 2. Vehicle Location ────────────────────────────────────────────────────

/**
 * Evaluate an EV vehicle home/away location condition.
 *
 * condition: { enabled, vehicleId?, requireHome: bool }
 *   requireHome=true  → vehicle must be home
 *   requireHome=false → vehicle must NOT be home (away)
 *
 * Returns: { met, actual, required, vehicleId } | { met: false, reason }
 */
function evaluateEVLocationCondition(condition, context = {}) {
  const resolved = resolveVehicleStatus(context.evVehicleStatusMap, condition.vehicleId);
  if (!resolved) {
    return { met: false, reason: 'No EV vehicle status available' };
  }

  const { vehicleId, status } = resolved;
  const isHome = status.isHome;

  if (isHome === null || isHome === undefined) {
    return { met: false, reason: 'Vehicle location not reported', vehicleId };
  }

  const requireHome = condition.requireHome !== false; // default: require home
  const met = requireHome ? isHome === true : isHome === false;

  return {
    met,
    actual: isHome ? 'home' : 'away',
    required: requireHome ? 'home' : 'away',
    vehicleId
  };
}

// ── 3. Charging State ──────────────────────────────────────────────────────

/**
 * Evaluate an EV charging state condition.
 *
 * condition: { enabled, vehicleId?, state: string | string[] }
 *   state can be a single state string or an array of accepted states.
 *   Valid values: 'charging', 'complete', 'stopped', 'disconnected', 'unknown'
 *
 * Returns: { met, actual, required, vehicleId } | { met: false, reason }
 */
function evaluateEVChargingStateCondition(condition, context = {}) {
  const resolved = resolveVehicleStatus(context.evVehicleStatusMap, condition.vehicleId);
  if (!resolved) {
    return { met: false, reason: 'No EV vehicle status available' };
  }

  const { vehicleId, status } = resolved;
  const chargingState = status.chargingState;

  if (!chargingState) {
    return { met: false, reason: 'Vehicle charging state not reported', vehicleId };
  }

  const requiredState = condition.state;
  if (!requiredState) {
    return { met: false, reason: 'No required state specified' };
  }

  const requiredStates = Array.isArray(requiredState) ? requiredState : [requiredState];
  const met = requiredStates.includes(chargingState);

  return {
    met,
    actual: chargingState,
    required: requiredStates,
    vehicleId
  };
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  evaluateEVSoCCondition,
  evaluateEVLocationCondition,
  evaluateEVChargingStateCondition,
  resolveVehicleStatus,
  /* re-export for test convenience */
  EV_CHARGING_STATES
};
