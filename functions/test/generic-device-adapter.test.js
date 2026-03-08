'use strict';

const {
  GenericReadonlyDeviceAdapter,
  createGenericDeviceAdapter,
  GENERIC_WORK_MODES
} = require('../lib/adapters/generic-device-adapter');
const { DeviceAdapter, validateDeviceAdapter } = require('../lib/adapters/device-adapter');
const { createAdapterRegistry } = require('../lib/adapters/adapter-registry');

describe('generic device adapter', () => {
  describe('constructor', () => {
    test('creates adapter with telemetry config', () => {
      const adapter = new GenericReadonlyDeviceAdapter({
        socPct: 75,
        pvPowerW: 4200,
        feedInPowerW: 1800,
        vendorLabel: 'goodwe-mock'
      });
      expect(adapter._status.socPct).toBe(75);
      expect(adapter._status.pvPowerW).toBe(4200);
      expect(adapter._status.feedInPowerW).toBe(1800);
      expect(adapter.vendorLabel).toBe('goodwe-mock');
    });

    test('defaults vendorLabel to generic', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 50 });
      expect(adapter.vendorLabel).toBe('generic');
    });

    test('defaults workMode to SelfUse', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 50 });
      expect(adapter._workMode).toBe('SelfUse');
    });

    test('accepts custom initial workMode', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 50, workMode: 'ForceCharge' });
      expect(adapter._workMode).toBe('ForceCharge');
    });

    test('ignores non-finite values and stores null', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: NaN, pvPowerW: 'oops' });
      expect(adapter._status.socPct).toBeNull();
      expect(adapter._status.pvPowerW).toBeNull();
    });

    test('extends DeviceAdapter base class', () => {
      const adapter = createGenericDeviceAdapter({ socPct: 80 });
      expect(adapter).toBeInstanceOf(DeviceAdapter);
    });
  });

  describe('DeviceAdapter contract compliance', () => {
    test('passes validateDeviceAdapter check', () => {
      const adapter = createGenericDeviceAdapter({ socPct: 75 });
      expect(() => validateDeviceAdapter(adapter)).not.toThrow();
    });

    test('getStatus returns normalized telemetry with observedAtIso', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({
        socPct: 82,
        batteryTempC: 28,
        ambientTempC: 22,
        pvPowerW: 3500,
        loadPowerW: 1200,
        gridPowerW: -200,
        feedInPowerW: 2100
      });
      const status = await adapter.getStatus({});

      expect(status).toMatchObject({
        socPct: 82,
        batteryTempC: 28,
        ambientTempC: 22,
        pvPowerW: 3500,
        loadPowerW: 1200,
        gridPowerW: -200,
        feedInPowerW: 2100
      });
      expect(typeof status.observedAtIso).toBe('string');
    });

    test('getStatus returns null fields when not configured', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({});
      const status = await adapter.getStatus({});
      expect(status.socPct).toBeNull();
      expect(status.pvPowerW).toBeNull();
    });

    test('getCapabilities returns no-schedule default matrix', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const caps = await adapter.getCapabilities({});
      expect(caps.scheduler).toBe(false);
      expect(caps.workMode).toBe(false);
    });

    test('getCapabilities respects capability overrides', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({
        socPct: 70,
        capabilities: { scheduler: true, workMode: true }
      });
      const caps = await adapter.getCapabilities({});
      expect(caps.scheduler).toBe(true);
      expect(caps.workMode).toBe(true);
    });

    test('getSchedule returns empty schedule', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const schedule = await adapter.getSchedule({});
      expect(schedule.groups).toEqual([]);
      expect(schedule.slots).toEqual([]);
    });

    test('setSchedule returns acknowledged no-op', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const result = await adapter.setSchedule({}, [{ startTime: '10:00', endTime: '12:00' }]);
      expect(result.acknowledged).toBe(true);
      expect(result.slots).toBe(0); // still zero — no real writes
    });

    test('clearSchedule returns acknowledged no-op', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const result = await adapter.clearSchedule({});
      expect(result.acknowledged).toBe(true);
    });

    test('getWorkMode returns current in-memory mode', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70, workMode: 'ForceDischarge' });
      const { workMode } = await adapter.getWorkMode({});
      expect(workMode).toBe('ForceDischarge');
    });

    test('setWorkMode updates and returns new mode', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const result = await adapter.setWorkMode({}, 'ForceCharge');
      expect(result.workMode).toBe('ForceCharge');
      expect(result.acknowledged).toBe(true);

      const { workMode } = await adapter.getWorkMode({});
      expect(workMode).toBe('ForceCharge');
    });

    test('setWorkMode throws when mode is empty', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      await expect(adapter.setWorkMode({}, '')).rejects.toThrow('mode is required');
    });

    test('normalizeProviderError returns shaped error object', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const norm = adapter.normalizeProviderError(new Error('test fail'));
      expect(norm.errno).toBe(3420);
      expect(norm.error).toBe('test fail');
    });

    test('normalizeProviderError handles null error', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      const norm = adapter.normalizeProviderError(null);
      expect(norm.errno).toBe(3420);
      expect(typeof norm.error).toBe('string');
    });
  });

  describe('updateStatus helper', () => {
    test('updates known status fields in place', async () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70, pvPowerW: 1000 });
      adapter.updateStatus({ socPct: 85, pvPowerW: 3800 });

      const status = await adapter.getStatus({});
      expect(status.socPct).toBe(85);
      expect(status.pvPowerW).toBe(3800);
    });

    test('ignores unknown keys silently', () => {
      const adapter = new GenericReadonlyDeviceAdapter({ socPct: 70 });
      expect(() => adapter.updateStatus({ unknownField: 999 })).not.toThrow();
      expect(adapter._status.unknownField).toBeUndefined();
    });
  });

  describe('adapter registry integration', () => {
    test('can be registered under a second key alongside FoxESS', () => {
      const { createFoxessDeviceAdapter } = require('../lib/adapters/foxess-adapter');
      const foxessAPI = {
        callFoxESSAPI: jest.fn()
      };

      const registry = createAdapterRegistry();
      const foxess = createFoxessDeviceAdapter({ foxessAPI });
      const generic = createGenericDeviceAdapter({ socPct: 75, vendorLabel: 'goodwe-mock' });

      registry.registerDeviceProvider('foxess', foxess);
      registry.registerDeviceProvider('goodwe', generic);

      // Both registered and retrievable
      expect(registry.getDeviceProvider('foxess')).toBe(foxess);
      expect(registry.getDeviceProvider('goodwe')).toBe(generic);

      const providers = registry.listDeviceProviders();
      expect(providers).toContain('foxess');
      expect(providers).toContain('goodwe');
    });

    test('G4 exit criterion #2: two device vendors through the same contract', () => {
      const { createFoxessDeviceAdapter } = require('../lib/adapters/foxess-adapter');
      const foxessAPI = { callFoxESSAPI: jest.fn() };

      const foxess = createFoxessDeviceAdapter({ foxessAPI });
      const generic = createGenericDeviceAdapter({ socPct: 75 });

      // Both pass the same contract validation
      expect(() => validateDeviceAdapter(foxess)).not.toThrow();
      expect(() => validateDeviceAdapter(generic)).not.toThrow();

      // Both expose the same interface
      const METHOD_NAMES = [
        'getStatus', 'getCapabilities', 'getSchedule', 'setSchedule',
        'clearSchedule', 'getWorkMode', 'setWorkMode', 'normalizeProviderError'
      ];
      METHOD_NAMES.forEach((method) => {
        expect(typeof foxess[method]).toBe('function');
        expect(typeof generic[method]).toBe('function');
      });

      const registry = createAdapterRegistry();
      registry.registerDeviceProvider('foxess', foxess);
      registry.registerDeviceProvider('goodwe', generic);

      // Selectable at runtime via registry
      expect(registry.getDeviceProvider('foxess')).toBe(foxess);
      expect(registry.getDeviceProvider('goodwe')).toBe(generic);
    });
  });
});
