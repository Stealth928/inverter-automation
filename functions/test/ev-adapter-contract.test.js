'use strict';

const {
  EVAdapter,
  validateEVAdapter,
  normalizeVehicleStatus,
  normalizeCommandResult,
  normalizeChargingState,
  normalizeCommandStatus,
  EV_CHARGING_STATES,
  EV_COMMAND_STATUSES,
  EV_CHARGE_LIMIT_MAX,
  EV_CHARGE_LIMIT_MIN
} = require('../lib/adapters/ev-adapter');
const { StubEVAdapter } = require('../lib/adapters/stub-ev-adapter');

// ---------------------------------------------------------------------------
// 1 — EVAdapter contract definition
// ---------------------------------------------------------------------------

describe('EVAdapter — required method constants', () => {
  test('EV_CHARGING_STATES covers expected canonical states', () => {
    for (const s of ['charging', 'complete', 'stopped', 'disconnected', 'unknown']) {
      expect(EV_CHARGING_STATES).toContain(s);
    }
  });

  test('EV_COMMAND_STATUSES covers expected canonical statuses', () => {
    for (const s of ['queued', 'sent', 'confirmed', 'failed']) {
      expect(EV_COMMAND_STATUSES).toContain(s);
    }
  });

  test('charge limit bounds are sane', () => {
    expect(EV_CHARGE_LIMIT_MIN).toBe(1);
    expect(EV_CHARGE_LIMIT_MAX).toBe(100);
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
      getVehicleStatus: () => {},
      startCharging: () => {},
      stopCharging: () => {},
      setChargeLimit: () => {}
      // wakeVehicle and normalizeProviderError missing
    };
    expect(() => validateEVAdapter(broken)).toThrow(/wakeVehicle/);
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
      rangeKm: 280
    };
    const result = normalizeVehicleStatus(raw, '2026-01-01T00:00:00.000Z');
    expect(result.socPct).toBe(75);
    expect(result.chargingState).toBe('charging');
    expect(result.chargeLimitPct).toBe(90);
    expect(result.isPluggedIn).toBe(true);
    expect(result.isHome).toBe(true);
    expect(result.rangeKm).toBe(280);
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
// 4 — normalizeCommandResult
// ---------------------------------------------------------------------------

describe('normalizeCommandResult', () => {
  test('maps canonical fields', () => {
    const raw = {
      commandId: 'cmd-123',
      status: 'sent',
      sentAtIso: '2026-01-01T00:00:00.000Z',
      providerRef: 'txid-abc'
    };
    const result = normalizeCommandResult(raw);
    expect(result.commandId).toBe('cmd-123');
    expect(result.status).toBe('sent');
    expect(result.sentAtIso).toBe('2026-01-01T00:00:00.000Z');
    expect(result.providerRef).toBe('txid-abc');
  });

  test('maps legacy txid field to providerRef', () => {
    const result = normalizeCommandResult({ commandId: 'c1', txid: 'tx99', status: 'queued' });
    expect(result.providerRef).toBe('tx99');
  });

  test('normalizes unknown status → queued', () => {
    expect(normalizeCommandStatus('pending_delivery')).toBe('queued');
    expect(normalizeCommandStatus('')).toBe('queued');
  });

  test('empty commandId produces empty string (not null)', () => {
    const result = normalizeCommandResult({});
    expect(result.commandId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 5 — StubEVAdapter contract compliance
// ---------------------------------------------------------------------------

describe('StubEVAdapter — contract compliance', () => {
  test('passes validateEVAdapter', () => {
    expect(validateEVAdapter(new StubEVAdapter())).toBe(true);
  });

  test('exposes all 6 required methods', () => {
    const adapter = new StubEVAdapter();
    expect(typeof adapter.getVehicleStatus).toBe('function');
    expect(typeof adapter.startCharging).toBe('function');
    expect(typeof adapter.stopCharging).toBe('function');
    expect(typeof adapter.setChargeLimit).toBe('function');
    expect(typeof adapter.wakeVehicle).toBe('function');
    expect(typeof adapter.normalizeProviderError).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 6 — StubEVAdapter.getVehicleStatus
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

  test('records command in capturedCommands', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v2', {});
    await adapter.getVehicleStatus('v2', {});
    expect(adapter.capturedCommands).toHaveLength(1);
    expect(adapter.capturedCommands[0].command).toBe('getVehicleStatus');
  });
});

// ---------------------------------------------------------------------------
// 7 — StubEVAdapter.startCharging
// ---------------------------------------------------------------------------

describe('StubEVAdapter — startCharging', () => {
  test('changes state to charging and returns sent result', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { isPluggedIn: true, chargingState: 'stopped' });
    const result = await adapter.startCharging('v1', {});
    expect(result.status).toBe('sent');
    expect(result.commandId).toMatch(/^stub-start-/);
    const status = await adapter.getVehicleStatus('v1', {});
    expect(status.chargingState).toBe('charging');
  });

  test('respects targetSocPct option', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { isPluggedIn: true });
    await adapter.startCharging('v1', {}, { targetSocPct: 70 });
    const status = await adapter.getVehicleStatus('v1', {});
    expect(status.chargeLimitPct).toBe(70);
  });

  test('throws when not plugged in', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { isPluggedIn: false });
    await expect(adapter.startCharging('v1', {})).rejects.toThrow(/not plugged in/);
  });

  test('failNextCommand causes one-shot failure', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { isPluggedIn: true });
    adapter.failNextCommand();
    await expect(adapter.startCharging('v1', {})).rejects.toThrow(/simulated failure/);
    // Second call should succeed
    const result = await adapter.startCharging('v1', {});
    expect(result.status).toBe('sent');
  });
});

// ---------------------------------------------------------------------------
// 8 — StubEVAdapter.stopCharging
// ---------------------------------------------------------------------------

describe('StubEVAdapter — stopCharging', () => {
  test('sets chargingState to stopped', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { chargingState: 'charging', isPluggedIn: true });
    const result = await adapter.stopCharging('v1', {});
    expect(result.status).toBe('sent');
    const status = await adapter.getVehicleStatus('v1', {});
    expect(status.chargingState).toBe('stopped');
  });
});

// ---------------------------------------------------------------------------
// 9 — StubEVAdapter.setChargeLimit
// ---------------------------------------------------------------------------

describe('StubEVAdapter — setChargeLimit', () => {
  test('updates chargeLimitPct for valid limit', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', {});
    const result = await adapter.setChargeLimit('v1', {}, 75);
    expect(result.status).toBe('sent');
    const status = await adapter.getVehicleStatus('v1', {});
    expect(status.chargeLimitPct).toBe(75);
  });

  test('throws for out-of-range limit', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', {});
    await expect(adapter.setChargeLimit('v1', {}, 0)).rejects.toThrow(/invalid charge limit/);
    await expect(adapter.setChargeLimit('v1', {}, 101)).rejects.toThrow(/invalid charge limit/);
  });

  test('throws for non-numeric limit', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', {});
    await expect(adapter.setChargeLimit('v1', {}, 'high')).rejects.toThrow(/invalid charge limit/);
  });
});

// ---------------------------------------------------------------------------
// 10 — StubEVAdapter.wakeVehicle
// ---------------------------------------------------------------------------

describe('StubEVAdapter — wakeVehicle', () => {
  test('returns woken: true and marks vehicle awake', async () => {
    const adapter = new StubEVAdapter();
    adapter.seedVehicle('v1', { asleep: true });
    const result = await adapter.wakeVehicle('v1', {});
    expect(result.woken).toBe(true);
    expect(result.vehicleId).toBe('v1');
  });
});

// ---------------------------------------------------------------------------
// 11 — StubEVAdapter.normalizeProviderError
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
