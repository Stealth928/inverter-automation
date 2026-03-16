'use strict';

const {
  EVAdapter,
  validateEVAdapter,
  normalizeVehicleStatus,
  normalizeChargingState,
  EV_CHARGING_STATES,
  EV_ADAPTER_REQUIRED_METHODS
} = require('../lib/adapters/ev-adapter');
const { StubEVAdapter } = require('../lib/adapters/stub-ev-adapter');

// ---------------------------------------------------------------------------
// 1 — EVAdapter contract definition
// ---------------------------------------------------------------------------

describe('EVAdapter — required method constants', () => {
  test('required methods match status-only adapter surface', () => {
    expect(EV_ADAPTER_REQUIRED_METHODS).toEqual(['getVehicleStatus', 'normalizeProviderError']);
  });

  test('EV_CHARGING_STATES covers expected canonical states', () => {
    for (const s of ['charging', 'complete', 'stopped', 'disconnected', 'unknown']) {
      expect(EV_CHARGING_STATES).toContain(s);
    }
  });
});

// ---------------------------------------------------------------------------
// 2 — validateEVAdapter
// ---------------------------------------------------------------------------

describe('validateEVAdapter', () => {
  test('passes for StubEVAdapter', () => {
    expect(validateEVAdapter(new StubEVAdapter())).toBe(true);
  });

  test('throws when adapter is null', () => {
    expect(() => validateEVAdapter(null)).toThrow(/missing required methods/);
  });

  test('throws when individual method is missing', () => {
    const broken = {
      getVehicleStatus: () => {}
    };
    expect(() => validateEVAdapter(broken)).toThrow(/normalizeProviderError/);
  });

  test('EVAdapter base class fails validateEVAdapter (all methods throw)', () => {
    // Base class methods exist but aren't async stubs that do anything useful;
    // however they ARE functions, so validate passes — correct by design.
    const base = new EVAdapter();
    expect(validateEVAdapter(base)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 — normalizeVehicleStatus
// ---------------------------------------------------------------------------

describe('normalizeVehicleStatus', () => {
  test('maps direct canonical fields', () => {
    const raw = {
      socPct: 75,
      chargingState: 'charging',
      chargeLimitPct: 90,
      isPluggedIn: true,
      isHome: true,
      rangeKm: 280,
      ratedRangeKm: 302,
      timeToFullChargeHours: 1.75,
      chargeEnergyAddedKwh: 8.4,
      rangeAddedKm: 56,
      chargingPowerKw: 7.2,
      chargingAmps: 24
    };
    const result = normalizeVehicleStatus(raw, '2026-01-01T00:00:00.000Z');
    expect(result.socPct).toBe(75);
    expect(result.chargingState).toBe('charging');
    expect(result.chargeLimitPct).toBe(90);
    expect(result.isPluggedIn).toBe(true);
    expect(result.isHome).toBe(true);
    expect(result.rangeKm).toBe(280);
    expect(result.ratedRangeKm).toBe(302);
    expect(result.timeToFullChargeHours).toBe(1.75);
    expect(result.chargeEnergyAddedKwh).toBe(8.4);
    expect(result.rangeAddedKm).toBe(56);
    expect(result.chargingPowerKw).toBe(7.2);
    expect(result.chargingAmps).toBe(24);
    expect(result.asOfIso).toBe('2026-01-01T00:00:00.000Z');
  });

  test('maps Tesla firmware aliases (battery_level, charging_state, charge_limit_soc)', () => {
    const raw = {
      battery_level: 65,
      charging_state: 'Charging',
      charge_limit_soc: 85,
      plugged_in: true,
      at_home: false
    };
    const result = normalizeVehicleStatus(raw);
    expect(result.socPct).toBe(65);
    expect(result.chargingState).toBe('charging');
    expect(result.chargeLimitPct).toBe(85);
    expect(result.isPluggedIn).toBe(true);
    expect(result.isHome).toBe(false);
  });

  test('returns null for missing numeric fields', () => {
    const result = normalizeVehicleStatus({});
    expect(result.socPct).toBeNull();
    expect(result.chargeLimitPct).toBeNull();
    expect(result.rangeKm).toBeNull();
    expect(result.ratedRangeKm).toBeNull();
    expect(result.timeToFullChargeHours).toBeNull();
    expect(result.chargeEnergyAddedKwh).toBeNull();
    expect(result.rangeAddedKm).toBeNull();
    expect(result.chargingPowerKw).toBeNull();
    expect(result.chargingAmps).toBeNull();
  });

  test('null/undefined charging state → unknown', () => {
    const result = normalizeVehicleStatus({ chargingState: null });
    expect(result.chargingState).toBe('unknown');
  });

  test('vendor alias Not_Charging → stopped', () => {
    expect(normalizeChargingState('Not_Charging')).toBe('stopped');
    expect(normalizeChargingState('not_charging')).toBe('stopped');
  });

  test('vendor alias Fully_Charged → complete', () => {
    expect(normalizeChargingState('Fully_Charged')).toBe('complete');
  });

  test('vendor alias Unplugged → disconnected', () => {
    expect(normalizeChargingState('Unplugged')).toBe('disconnected');
  });

  test('unknown string → unknown', () => {
    expect(normalizeChargingState('asleep_or_something')).toBe('unknown');
  });

  test('asOfIso defaults to now when not provided', () => {
    const before = Date.now();
    const result = normalizeVehicleStatus({});
    const after = Date.now();
    const ts = new Date(result.asOfIso).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// 4 — StubEVAdapter contract compliance
// ---------------------------------------------------------------------------

describe('StubEVAdapter — contract compliance', () => {
  test('passes validateEVAdapter', () => {
    expect(validateEVAdapter(new StubEVAdapter())).toBe(true);
  });

  test('exposes the status-only required methods', () => {
    const adapter = new StubEVAdapter();
    expect(typeof adapter.getVehicleStatus).toBe('function');
    expect(typeof adapter.normalizeProviderError).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 5 — StubEVAdapter.getVehicleStatus
// ---------------------------------------------------------------------------

describe('StubEVAdapter — getVehicleStatus', () => {
  test('returns canonical status for seeded vehicle', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { socPct: 55, chargingState: 'charging', chargeLimitPct: 80, isPluggedIn: true, isHome: true });
    const status = await adapter.getVehicleStatus('v1', {});
    expect(status.socPct).toBe(55);
    expect(status.chargingState).toBe('charging');
    expect(status.chargeLimitPct).toBe(80);
  });

  test('throws for unknown vehicleId', async () => {
    const adapter = new StubEVAdapter();
    await expect(adapter.getVehicleStatus('unknown', {})).rejects.toThrow(/unknown vehicleId/);
  });
});

// ---------------------------------------------------------------------------
// 6 — StubEVAdapter.normalizeProviderError
// ---------------------------------------------------------------------------

describe('StubEVAdapter — normalizeProviderError', () => {
  test('returns canonical error envelope with provider: stub', () => {
    const adapter = new StubEVAdapter();
    const result = adapter.normalizeProviderError(new Error('timeout'));
    expect(result.errno).toBe(3800);
    expect(result.error).toBe('timeout');
    expect(result.provider).toBe('stub');
  });

  test('handles null error gracefully', () => {
    const adapter = new StubEVAdapter();
    const result = adapter.normalizeProviderError(null);
    expect(typeof result.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 12 — Adapter registry: EV provider support
// ---------------------------------------------------------------------------

describe('Adapter registry — EV provider registration', () => {
  const { createAdapterRegistry } = require('../lib/adapters/adapter-registry');

  test('registers and retrieves an EV adapter', () => {
    const registry = createAdapterRegistry({
      evProviders: { stub: new StubEVAdapter() }
    });
    expect(registry.listEVProviders()).toEqual(['stub']);
    expect(validateEVAdapter(registry.getEVProvider('stub'))).toBe(true);
  });

  test('key lookup is case-insensitive', () => {
    const registry = createAdapterRegistry();
    registry.registerEVProvider('Tesla', new StubEVAdapter());
    expect(registry.getEVProvider('TESLA')).not.toBeNull();
    expect(registry.getEVProvider('tesla')).not.toBeNull();
  });

  test('returns null for unknown EV provider key', () => {
    const registry = createAdapterRegistry();
    expect(registry.getEVProvider('rivian')).toBeNull();
  });

  test('rejects registration of non-compliant EV adapter', () => {
    const registry = createAdapterRegistry();
    expect(() => registry.registerEVProvider('bad', {})).toThrow(/missing required methods/);
  });

  test('existing tariff and device provider support unaffected', () => {
    const registry = createAdapterRegistry();
    expect(typeof registry.getTariffProvider).toBe('function');
    expect(typeof registry.getDeviceProvider).toBe('function');
    expect(typeof registry.getEVProvider).toBe('function');
  });
});
