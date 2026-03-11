'use strict';

function normalizeProvider(value) {
  return String(value || 'foxess').toLowerCase().trim() || 'foxess';
}

function resolveProviderDeviceId(userConfig = {}, explicitDeviceId) {
  const provider = normalizeProvider(userConfig?.deviceProvider);

  if (explicitDeviceId !== undefined && explicitDeviceId !== null && String(explicitDeviceId).trim()) {
    return { provider, deviceId: String(explicitDeviceId).trim(), source: 'explicit' };
  }

  if (provider === 'sigenergy') {
    const stationId = userConfig?.sigenStationId || userConfig?.sigenDeviceSn || userConfig?.deviceSn;
    return {
      provider,
      deviceId: stationId ? String(stationId).trim() : null,
      source: userConfig?.sigenStationId ? 'sigenStationId' : (userConfig?.sigenDeviceSn ? 'sigenDeviceSn' : 'deviceSn')
    };
  }

  if (provider === 'alphaess') {
    const systemSn = userConfig?.alphaessSystemSn || userConfig?.alphaessSysSn || userConfig?.deviceSn;
    return {
      provider,
      deviceId: systemSn ? String(systemSn).trim() : null,
      source: userConfig?.alphaessSystemSn ? 'alphaessSystemSn' : (userConfig?.alphaessSysSn ? 'alphaessSysSn' : 'deviceSn')
    };
  }

  if (provider === 'sungrow') {
    const deviceSn = userConfig?.sungrowDeviceSn || userConfig?.deviceSn;
    return {
      provider,
      deviceId: deviceSn ? String(deviceSn).trim() : null,
      source: userConfig?.sungrowDeviceSn ? 'sungrowDeviceSn' : 'deviceSn'
    };
  }

  const deviceSn = userConfig?.deviceSn;
  return {
    provider,
    deviceId: deviceSn ? String(deviceSn).trim() : null,
    source: 'deviceSn'
  };
}

module.exports = {
  normalizeProvider,
  resolveProviderDeviceId
};
