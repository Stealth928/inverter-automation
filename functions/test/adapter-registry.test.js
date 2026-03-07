'use strict';

const { createAdapterRegistry, normalizeAdapterKey } = require('../lib/adapters/adapter-registry');
const { TariffProviderAdapter } = require('../lib/adapters/tariff-provider');
const { DeviceAdapter } = require('../lib/adapters/device-adapter');

class DemoTariffAdapter extends TariffProviderAdapter {
  async getCurrentPrices() { return {}; }
  async getHistoricalPrices() { return []; }
  normalizeProviderError(error) { return { errno: 3200, error: error.message }; }
}

class DemoDeviceAdapter extends DeviceAdapter {
  async getStatus() { return {}; }
  async getCapabilities() { return {}; }
  async getSchedule() { return {}; }
  async setSchedule() { return {}; }
  async clearSchedule() { return {}; }
  async getWorkMode() { return {}; }
  async setWorkMode() { return {}; }
  normalizeProviderError(error) { return { errno: 3400, error: error.message }; }
}

describe('adapter registry', () => {
  test('normalizeAdapterKey trims and lowercases keys', () => {
    expect(normalizeAdapterKey(' Amber ')).toBe('amber');
    expect(() => normalizeAdapterKey('')).toThrow(/required/i);
  });

  test('register/get/list tariff and device providers', () => {
    const registry = createAdapterRegistry();

    registry.registerTariffProvider('Amber', new DemoTariffAdapter());
    registry.registerDeviceProvider('FOXESS', new DemoDeviceAdapter());

    expect(registry.getTariffProvider('amber')).toBeInstanceOf(DemoTariffAdapter);
    expect(registry.getDeviceProvider('foxess')).toBeInstanceOf(DemoDeviceAdapter);
    expect(registry.listTariffProviders()).toEqual(['amber']);
    expect(registry.listDeviceProviders()).toEqual(['foxess']);
  });

  test('registry constructor accepts initial provider maps', () => {
    const registry = createAdapterRegistry({
      tariffProviders: { amber: new DemoTariffAdapter() },
      deviceProviders: { foxess: new DemoDeviceAdapter() }
    });

    expect(registry.getTariffProvider('amber')).toBeInstanceOf(DemoTariffAdapter);
    expect(registry.getDeviceProvider('foxess')).toBeInstanceOf(DemoDeviceAdapter);
  });
});
