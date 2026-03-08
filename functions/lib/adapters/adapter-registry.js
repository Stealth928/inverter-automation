'use strict';

const { validateDeviceAdapter } = require('./device-adapter');
const { validateTariffProviderAdapter } = require('./tariff-provider');
const { validateEVAdapter } = require('./ev-adapter');

function normalizeAdapterKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Adapter key is required');
  }
  return normalized;
}

function registerMapEntries(map, entries, validateAdapter) {
  if (!entries || typeof entries !== 'object') {
    return;
  }

  for (const [key, adapter] of Object.entries(entries)) {
    validateAdapter(adapter);
    map.set(normalizeAdapterKey(key), adapter);
  }
}

function createAdapterRegistry(options = {}) {
  const tariffProviderMap = new Map();
  const deviceProviderMap = new Map();
  const evProviderMap = new Map();

  registerMapEntries(tariffProviderMap, options.tariffProviders, validateTariffProviderAdapter);
  registerMapEntries(deviceProviderMap, options.deviceProviders, validateDeviceAdapter);
  registerMapEntries(evProviderMap, options.evProviders, validateEVAdapter);

  function registerTariffProvider(providerType, adapter) {
    const key = normalizeAdapterKey(providerType);
    validateTariffProviderAdapter(adapter);
    tariffProviderMap.set(key, adapter);
    return adapter;
  }

  function getTariffProvider(providerType) {
    if (!providerType) {
      return null;
    }
    return tariffProviderMap.get(normalizeAdapterKey(providerType)) || null;
  }

  function listTariffProviders() {
    return Array.from(tariffProviderMap.keys()).sort();
  }

  function registerDeviceProvider(providerType, adapter) {
    const key = normalizeAdapterKey(providerType);
    validateDeviceAdapter(adapter);
    deviceProviderMap.set(key, adapter);
    return adapter;
  }

  function getDeviceProvider(providerType) {
    if (!providerType) {
      return null;
    }
    return deviceProviderMap.get(normalizeAdapterKey(providerType)) || null;
  }

  function listDeviceProviders() {
    return Array.from(deviceProviderMap.keys()).sort();
  }

  function registerEVProvider(providerType, adapter) {
    const key = normalizeAdapterKey(providerType);
    validateEVAdapter(adapter);
    evProviderMap.set(key, adapter);
    return adapter;
  }

  function getEVProvider(providerType) {
    if (!providerType) {
      return null;
    }
    return evProviderMap.get(normalizeAdapterKey(providerType)) || null;
  }

  function listEVProviders() {
    return Array.from(evProviderMap.keys()).sort();
  }

  return {
    getDeviceProvider,
    getTariffProvider,
    listDeviceProviders,
    listTariffProviders,
    registerDeviceProvider,
    registerTariffProvider,
    getEVProvider,
    listEVProviders,
    registerEVProvider
  };
}

/**
 * Resolve the device adapter for a given user based on their config.
 *
 * Falls back to 'foxess' when userConfig.deviceProvider is absent (backward compatibility).
 *
 * @param {Object} adapterRegistry - Registry created by createAdapterRegistry()
 * @param {Object} userConfig      - User configuration document
 * @returns {Object|null} The resolved DeviceAdapter, or null if not registered
 */
function resolveDeviceAdapter(adapterRegistry, userConfig) {
  if (!adapterRegistry || typeof adapterRegistry.getDeviceProvider !== 'function') {
    return null;
  }
  const provider = String(userConfig?.deviceProvider || 'foxess').toLowerCase().trim();
  return adapterRegistry.getDeviceProvider(provider) || null;
}

module.exports = {
  createAdapterRegistry,
  normalizeAdapterKey,
  resolveDeviceAdapter
};
