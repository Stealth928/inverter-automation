'use strict';

const {
  evaluateEVSoCCondition,
  evaluateEVLocationCondition,
  evaluateEVChargingStateCondition,
  resolveVehicleStatus
} = require('../lib/ev-conditions');

// ─── helpers ───────────────────────────────────────────────────────────────

function makeStatusMap(vehicleId, overrides = {}) {
  return {
    [vehicleId]: {
      socPct: 75,
      chargingState: 'stopped',
      chargeLimitPct: 90,
      isPluggedIn: true,
      isHome: true,
      rangeKm: 300,
      asOfIso: new Date().toISOString(),
      ...overrides
    }
  };
}

// ─── resolveVehicleStatus ──────────────────────────────────────────────────

describe('resolveVehicleStatus', () => {
  test('returns null for falsy map', () => {
    expect(resolveVehicleStatus(null, 'v1')).toBeNull();
    expect(resolveVehicleStatus(undefined, 'v1')).toBeNull();
    expect(resolveVehicleStatus({}, 'v1')).toBeNull();
  });

  test('resolves explicit vehicleId', () => {
    const map = makeStatusMap('vehicle-1');
    const result = resolveVehicleStatus(map, 'vehicle-1');
    expect(result).toMatchObject({ vehicleId: 'vehicle-1', status: map['vehicle-1'] });
  });

  test('returns null when explicit vehicleId missing from map', () => {
    const map = makeStatusMap('vehicle-1');
    expect(resolveVehicleStatus(map, 'vehicle-99')).toBeNull();
  });

  test('falls back to first entry when vehicleId omitted', () => {
    const map = makeStatusMap('vehicle-1');
    const result = resolveVehicleStatus(map, undefined);
    expect(result.vehicleId).toBe('vehicle-1');
  });
});

// ─── evaluateEVSoCCondition ────────────────────────────────────────────────

describe('evaluateEVSoCCondition', () => {
  const condition = { enabled: true, operator: '<', value: 80 };

  test('met: true when SoC satisfies operator', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: 60 }) };
    const r = evaluateEVSoCCondition({ ...condition, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(true);
    expect(r.actual).toBe(60);
    expect(r.operator).toBe('<');
    expect(r.target).toBe(80);
    expect(r.vehicleId).toBe('v1');
  });

  test('met: false when SoC does not satisfy operator', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: 85 }) };
    const r = evaluateEVSoCCondition({ ...condition, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
    expect(r.actual).toBe(85);
  });

  test('supports >= operator', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: 80 }) };
    const r = evaluateEVSoCCondition({ enabled: true, operator: '>=', value: 80 }, ctx);
    expect(r.met).toBe(true);
  });

  test('supports between operator with value2', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: 55 }) };
    const r = evaluateEVSoCCondition({ enabled: true, operator: 'between', value: 40, value2: 70 }, ctx);
    expect(r.met).toBe(true);
  });

  test('between: false when outside range', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: 20 }) };
    const r = evaluateEVSoCCondition({ enabled: true, operator: 'between', value: 40, value2: 70 }, ctx);
    expect(r.met).toBe(false);
  });

  test('supports op field alias', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: 30 }) };
    const r = evaluateEVSoCCondition({ enabled: true, op: '<', value: 50 }, ctx);
    expect(r.met).toBe(true);
  });

  test('no status map → met:false with reason', () => {
    const r = evaluateEVSoCCondition(condition, {});
    expect(r.met).toBe(false);
    expect(r.reason).toMatch(/no ev vehicle/i);
  });

  test('missing SoC on vehicle → met:false with reason', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { socPct: undefined }) };
    const r = evaluateEVSoCCondition({ ...condition, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  test('implicit vehicle resolution (no vehicleId field)', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('auto-vehicle', { socPct: 50 }) };
    const r = evaluateEVSoCCondition({ enabled: true, operator: '<', value: 60 }, ctx);
    expect(r.met).toBe(true);
    expect(r.vehicleId).toBe('auto-vehicle');
  });
});

// ─── evaluateEVLocationCondition ──────────────────────────────────────────

describe('evaluateEVLocationCondition', () => {
  test('met: true when vehicle is home and requireHome=true', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { isHome: true }) };
    const r = evaluateEVLocationCondition({ enabled: true, requireHome: true, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(true);
    expect(r.actual).toBe('home');
    expect(r.required).toBe('home');
  });

  test('met: false when vehicle is away and requireHome=true', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { isHome: false }) };
    const r = evaluateEVLocationCondition({ enabled: true, requireHome: true, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
    expect(r.actual).toBe('away');
  });

  test('met: true when vehicle is away and requireHome=false', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { isHome: false }) };
    const r = evaluateEVLocationCondition({ enabled: true, requireHome: false, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(true);
    expect(r.actual).toBe('away');
    expect(r.required).toBe('away');
  });

  test('met: false when vehicle is home and requireHome=false', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { isHome: true }) };
    const r = evaluateEVLocationCondition({ enabled: true, requireHome: false, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
  });

  test('requireHome defaults true when omitted', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { isHome: true }) };
    const r = evaluateEVLocationCondition({ enabled: true, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(true);
  });

  test('no status map → met:false', () => {
    const r = evaluateEVLocationCondition({ enabled: true, requireHome: true }, {});
    expect(r.met).toBe(false);
    expect(r.reason).toMatch(/no ev vehicle/i);
  });

  test('isHome undefined → met:false with reason', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { isHome: undefined }) };
    const r = evaluateEVLocationCondition({ enabled: true, requireHome: true, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

// ─── evaluateEVChargingStateCondition ────────────────────────────────────

describe('evaluateEVChargingStateCondition', () => {
  test('met: true for single matching state', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { chargingState: 'charging' }) };
    const r = evaluateEVChargingStateCondition({ enabled: true, state: 'charging', vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(true);
    expect(r.actual).toBe('charging');
  });

  test('met: false for non-matching single state', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { chargingState: 'stopped' }) };
    const r = evaluateEVChargingStateCondition({ enabled: true, state: 'charging', vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
  });

  test('met: true for array of states when current matches one', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { chargingState: 'complete' }) };
    const r = evaluateEVChargingStateCondition({ enabled: true, state: ['stopped', 'complete'], vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(true);
    expect(r.required).toEqual(['stopped', 'complete']);
  });

  test('met: false when none of the required states match', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { chargingState: 'charging' }) };
    const r = evaluateEVChargingStateCondition({ enabled: true, state: ['stopped', 'disconnected'], vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
  });

  test('no status map → met:false', () => {
    const r = evaluateEVChargingStateCondition({ enabled: true, state: 'charging' }, {});
    expect(r.met).toBe(false);
  });

  test('missing state on vehicle → met:false with reason', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1', { chargingState: undefined }) };
    const r = evaluateEVChargingStateCondition({ enabled: true, state: 'charging', vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  test('missing state in condition → met:false with reason', () => {
    const ctx = { evVehicleStatusMap: makeStatusMap('v1') };
    const r = evaluateEVChargingStateCondition({ enabled: true, vehicleId: 'v1' }, ctx);
    expect(r.met).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

// ─── Integration: evaluateRule with EV conditions ─────────────────────────

describe('automation-rule-evaluation-service EV conditions', () => {
  const { createAutomationRuleEvaluationService } = require('../lib/services/automation-rule-evaluation-service');

  function makeService(overrides = {}) {
    return createAutomationRuleEvaluationService({
      evaluateTemperatureCondition: () => ({ met: true }),
      evaluateTimeCondition: () => ({ met: true }),
      getCurrentAmberPrices: () => ({ feedInPrice: 5, buyPrice: 10 }),
      getUserTime: () => ({ hour: 12, minute: 0 }),
      parseAutomationTelemetry: () => ({ soc: 80, batTemp: 25, ambientTemp: 20 }),
      resolveAutomationTimezone: () => 'UTC',
      ...overrides
    });
  }

  async function evalRule(service, conditions, statusMap) {
    const rule = { name: 'Test', conditions };
    const cache = { evVehicleStatusMap: statusMap };
    return service.evaluateRule('uid1', 'rule1', rule, cache, {}, {});
  }

  test('evVehicleSoC condition met when threshold satisfied', async () => {
    const svc = makeService();
    const statusMap = makeStatusMap('v1', { socPct: 40 });
    const result = await evalRule(svc, { evVehicleSoC: { enabled: true, operator: '<', value: 80, vehicleId: 'v1' } }, statusMap);
    expect(result.triggered).toBe(true);
  });

  test('evVehicleSoC condition not met when threshold not satisfied', async () => {
    const svc = makeService();
    const statusMap = makeStatusMap('v1', { socPct: 90 });
    const result = await evalRule(svc, { evVehicleSoC: { enabled: true, operator: '<', value: 80, vehicleId: 'v1' } }, statusMap);
    expect(result.triggered).toBe(false);
    expect(result.results[0].condition).toBe('evVehicleSoC');
  });

  test('evVehicleLocation condition met when vehicle is home', async () => {
    const svc = makeService();
    const statusMap = makeStatusMap('v1', { isHome: true });
    const result = await evalRule(svc, { evVehicleLocation: { enabled: true, requireHome: true, vehicleId: 'v1' } }, statusMap);
    expect(result.triggered).toBe(true);
  });

  test('evChargingState condition met for matching state', async () => {
    const svc = makeService();
    const statusMap = makeStatusMap('v1', { chargingState: 'stopped' });
    const result = await evalRule(svc, { evChargingState: { enabled: true, state: 'stopped', vehicleId: 'v1' } }, statusMap);
    expect(result.triggered).toBe(true);
  });

  test('all three EV conditions combined — all met', async () => {
    const svc = makeService();
    const statusMap = makeStatusMap('v1', { socPct: 30, isHome: true, chargingState: 'stopped' });
    const result = await evalRule(svc, {
      evVehicleSoC:        { enabled: true, operator: '<', value: 50, vehicleId: 'v1' },
      evVehicleLocation:   { enabled: true, requireHome: true, vehicleId: 'v1' },
      evChargingState:     { enabled: true, state: ['stopped', 'disconnected'], vehicleId: 'v1' }
    }, statusMap);
    expect(result.triggered).toBe(true);
    expect(result.results).toHaveLength(3);
  });

  test('all three EV conditions combined — one fails triggers false', async () => {
    const svc = makeService();
    // isHome: false will fail evVehicleLocation
    const statusMap = makeStatusMap('v1', { socPct: 30, isHome: false, chargingState: 'stopped' });
    const result = await evalRule(svc, {
      evVehicleSoC:        { enabled: true, operator: '<', value: 50, vehicleId: 'v1' },
      evVehicleLocation:   { enabled: true, requireHome: true, vehicleId: 'v1' },
      evChargingState:     { enabled: true, state: 'stopped', vehicleId: 'v1' }
    }, statusMap);
    expect(result.triggered).toBe(false);
  });

  test('getEVVehicleStatusMap is called when cache lacks EV status', async () => {
    const statusMap = makeStatusMap('v1', { socPct: 20 });
    const getEVVehicleStatusMap = jest.fn().mockResolvedValue(statusMap);
    const svc = makeService({ getEVVehicleStatusMap });
    const rule = { name: 'Test', conditions: { evVehicleSoC: { enabled: true, operator: '<', value: 50, vehicleId: 'v1' } } };
    const cache = {}; // no pre-populated status
    const result = await svc.evaluateRule('uid1', 'rule1', rule, cache, {}, {});
    expect(getEVVehicleStatusMap).toHaveBeenCalledWith('uid1');
    expect(result.triggered).toBe(true);
  });

  test('getEVVehicleStatusMap fetch failure → condition met:false', async () => {
    const getEVVehicleStatusMap = jest.fn().mockRejectedValue(new Error('network error'));
    const svc = makeService({ getEVVehicleStatusMap });
    const rule = { name: 'Test', conditions: { evVehicleSoC: { enabled: true, operator: '<', value: 50, vehicleId: 'v1' } } };
    const cache = {};
    const result = await svc.evaluateRule('uid1', 'rule1', rule, cache, {}, {});
    expect(result.triggered).toBe(false);
    expect(result.results[0].condition).toBe('evVehicleSoC');
  });

  test('EV conditions are NOT fetched when no EV condition present on rule', async () => {
    const getEVVehicleStatusMap = jest.fn().mockResolvedValue({});
    const svc = makeService({ getEVVehicleStatusMap });
    const rule = { name: 'Test', conditions: { soc: { enabled: true, operator: '>=', value: 20 } } };
    const cache = {};
    await svc.evaluateRule('uid1', 'rule1', rule, cache, {}, {});
    expect(getEVVehicleStatusMap).not.toHaveBeenCalled();
  });
});
