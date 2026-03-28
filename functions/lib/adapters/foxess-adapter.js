'use strict';

const { buildClearedSchedulerGroups } = require('../automation-actions');
const {
  DeviceAdapter,
  normalizeDeviceStatusPayload
} = require('./device-adapter');

const DEFAULT_STATUS_VARIABLES = Object.freeze([
  'SoC',
  'SoC1',
  'SoC_1',
  'batTemperature',
  'batTemperature_1',
  'ambientTemperation',
  'ambientTemperature',
  'pvPower',
  'pv_power',
  'loadsPower',
  'loadPower',
  'load_power',
  'gridConsumptionPower',
  'gridPower',
  'feedinPower',
  'feedInPower'
]);

const DEFAULT_DEVICE_CAPABILITIES = Object.freeze({
  scheduler: true,
  workMode: true,
  minSoc: true,
  forceChargeWindow: true
});

function resolveDeviceSN(context = {}) {
  const fromContext = context.deviceSN || context.deviceSn || context.serialNumber;
  if (fromContext) {
    return String(fromContext);
  }
  const fromConfig = context.userConfig?.deviceSn || context.userConfig?.deviceSN;
  if (fromConfig) {
    return String(fromConfig);
  }
  return null;
}

class FoxessDeviceAdapter extends DeviceAdapter {
  constructor(options = {}) {
    super();

    if (!options.foxessAPI || typeof options.foxessAPI.callFoxESSAPI !== 'function') {
      throw new Error('FoxessDeviceAdapter requires foxessAPI.callFoxESSAPI()');
    }

    this.foxessAPI = options.foxessAPI;
    this.logger = options.logger || console;
    this.defaultStatusVariables = Array.isArray(options.defaultStatusVariables)
      ? options.defaultStatusVariables
      : DEFAULT_STATUS_VARIABLES;
    this.defaultCapabilities = {
      ...DEFAULT_DEVICE_CAPABILITIES,
      ...(options.defaultCapabilities || {})
    };
  }

  async getStatus(context = {}) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('FoxessDeviceAdapter.getStatus requires deviceSN');
    }

    const result = await this.foxessAPI.callFoxESSAPI(
      '/op/v0/device/real/query',
      'POST',
      {
        sn: deviceSN,
        variables: context.variables || this.defaultStatusVariables
      },
      context.userConfig,
      context.userId
    );

    if (result?.errno && result.errno !== 0) {
      throw this.normalizeProviderError(result);
    }

    const observedAtIso = context.observedAtIso || new Date().toISOString();
    return {
      ...normalizeDeviceStatusPayload(result, observedAtIso),
      telemetryTimestampTrust: 'source',
      deviceSN,
      raw: result
    };
  }

  async getCapabilities(_context = {}) {
    return { ...this.defaultCapabilities };
  }

  async getSchedule(context = {}) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('FoxessDeviceAdapter.getSchedule requires deviceSN');
    }
    return this.foxessAPI.callFoxESSAPI(
      '/op/v1/device/scheduler/get',
      'POST',
      { deviceSN },
      context.userConfig,
      context.userId
    );
  }

  async setSchedule(context = {}, groups = []) {
    const deviceSN = resolveDeviceSN(context);
    if (!deviceSN) {
      throw new Error('FoxessDeviceAdapter.setSchedule requires deviceSN');
    }
    if (!Array.isArray(groups)) {
      throw new Error('FoxessDeviceAdapter.setSchedule requires groups array');
    }
    return this.foxessAPI.callFoxESSAPI(
      '/op/v1/device/scheduler/enable',
      'POST',
      { deviceSN, groups },
      context.userConfig,
      context.userId
    );
  }

  async clearSchedule(context = {}) {
    const groupCount = Number.isFinite(Number(context.groupCount))
      ? Math.floor(Number(context.groupCount))
      : undefined;
    return this.setSchedule(context, buildClearedSchedulerGroups(groupCount));
  }

  async getWorkMode(context = {}) {
    const sn = resolveDeviceSN(context);
    if (!sn) {
      throw new Error('FoxessDeviceAdapter.getWorkMode requires deviceSN');
    }
    return this.foxessAPI.callFoxESSAPI(
      '/op/v0/device/setting/get',
      'POST',
      { sn, key: 'WorkMode' },
      context.userConfig,
      context.userId
    );
  }

  async setWorkMode(context = {}, mode) {
    const sn = resolveDeviceSN(context);
    if (!sn) {
      throw new Error('FoxessDeviceAdapter.setWorkMode requires deviceSN');
    }
    return this.foxessAPI.callFoxESSAPI(
      '/op/v0/device/setting/set',
      'POST',
      { sn, key: 'WorkMode', value: mode },
      context.userConfig,
      context.userId
    );
  }

  normalizeProviderError(error) {
    const providerErrno = Number(error?.errno || error?.status || 0);
    if (providerErrno === 40402) {
      return { errno: 3201, error: error?.error || error?.msg || 'FoxESS rate limited' };
    }
    if (providerErrno === 401 || providerErrno === 403) {
      return { errno: 3202, error: error?.error || error?.msg || 'FoxESS authentication failed' };
    }
    if (providerErrno === 408) {
      return { errno: 3203, error: error?.error || error?.msg || 'FoxESS timeout' };
    }
    if (providerErrno >= 500) {
      return { errno: 3204, error: error?.error || error?.msg || 'FoxESS upstream failure' };
    }
    return {
      errno: 3400,
      error: error?.error || error?.msg || error?.message || 'FoxESS device command failed'
    };
  }
}

function createFoxessDeviceAdapter(options = {}) {
  return new FoxessDeviceAdapter(options);
}

module.exports = {
  DEFAULT_DEVICE_CAPABILITIES,
  DEFAULT_STATUS_VARIABLES,
  FoxessDeviceAdapter,
  createFoxessDeviceAdapter,
  resolveDeviceSN
};
