'use strict';

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function wattsToKw(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) return null;
  return roundNumber(numeric / 1000, 4);
}

function heuristicPowerToKw(value) {
  const numeric = toFiniteNumber(value, null);
  if (numeric === null) return null;
  if (Math.abs(numeric) > 100) return roundNumber(numeric / 1000, 4);
  return roundNumber(numeric, 4);
}

function nonNegative(value) {
  return Math.max(0, toFiniteNumber(value, 0));
}

function normalizeCouplingValue(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'ac' || raw === 'ac-coupled' || raw === 'ac_coupled') return 'ac';
  if (raw === 'dc' || raw === 'dc-coupled' || raw === 'dc_coupled') return 'dc';
  return 'unknown';
}

function buildFlowBalance(status = {}, batteryPowerOverrideW = null) {
  const pvPowerW = toFiniteNumber(status.pvPowerW, null);
  const loadPowerW = toFiniteNumber(status.loadPowerW, null);
  const gridPowerW = toFiniteNumber(status.gridPowerW, null);
  const feedInPowerW = toFiniteNumber(status.feedInPowerW, null);
  const batteryPowerW = batteryPowerOverrideW === null
    ? toFiniteNumber(status.batteryPowerW, null)
    : toFiniteNumber(batteryPowerOverrideW, null);

  if (
    pvPowerW === null ||
    loadPowerW === null ||
    gridPowerW === null ||
    feedInPowerW === null ||
    batteryPowerW === null
  ) {
    return null;
  }

  const batteryChargePowerW = batteryPowerW > 0 ? batteryPowerW : 0;
  const batteryDischargePowerW = batteryPowerW < 0 ? Math.abs(batteryPowerW) : 0;
  const sourcePowerW = nonNegative(pvPowerW) + nonNegative(gridPowerW) + batteryDischargePowerW;
  const sinkPowerW = nonNegative(loadPowerW) + nonNegative(feedInPowerW) + batteryChargePowerW;
  const residualW = sourcePowerW - sinkPowerW;

  return {
    sourcePowerW: roundNumber(sourcePowerW, 1),
    sinkPowerW: roundNumber(sinkPowerW, 1),
    residualW: roundNumber(residualW, 1),
    residualKw: roundNumber(residualW / 1000, 4),
    derivedLoadW: roundNumber(sourcePowerW - nonNegative(feedInPowerW) - batteryChargePowerW, 1),
    batteryChargePowerW: roundNumber(batteryChargePowerW, 1),
    batteryDischargePowerW: roundNumber(batteryDischargePowerW, 1)
  };
}

function summarizeRawStatus(status = {}) {
  return {
    socPct: toFiniteNumber(status.socPct, null),
    batteryTempC: toFiniteNumber(status.batteryTempC, null),
    ambientTempC: toFiniteNumber(status.ambientTempC, null),
    pvPowerW: toFiniteNumber(status.pvPowerW, null),
    loadPowerW: toFiniteNumber(status.loadPowerW, null),
    gridPowerW: toFiniteNumber(status.gridPowerW, null),
    feedInPowerW: toFiniteNumber(status.feedInPowerW, null),
    batteryPowerW: toFiniteNumber(status.batteryPowerW, null),
    observedAtIso: status.observedAtIso || null,
    deviceSN: status.deviceSN || null
  };
}

function summarizeSelectedKw(status = {}, invertBatteryPowerSign) {
  const batteryPowerW = toFiniteNumber(status.batteryPowerW, null);
  const canonicalBatteryPowerW = batteryPowerW === null
    ? null
    : (invertBatteryPowerSign ? -batteryPowerW : batteryPowerW);

  return {
    pvPowerKw: wattsToKw(status.pvPowerW),
    loadPowerKw: wattsToKw(status.loadPowerW),
    gridPowerKw: wattsToKw(status.gridPowerW),
    feedInPowerKw: wattsToKw(status.feedInPowerW),
    batteryPowerKw: canonicalBatteryPowerW === null ? null : wattsToKw(canonicalBatteryPowerW),
    heuristicLoadPowerKw: heuristicPowerToKw(status.loadPowerW),
    heuristicGridPowerKw: heuristicPowerToKw(status.gridPowerW),
    heuristicFeedInPowerKw: heuristicPowerToKw(status.feedInPowerW)
  };
}

function hasMaterialNormalizationGap(strictValue, heuristicValue) {
  if (!Number.isFinite(strictValue) || !Number.isFinite(heuristicValue)) return false;
  return Math.abs(strictValue - heuristicValue) >= 0.5;
}

function buildAlphaEssDiagnostics(input = {}) {
  const status = input.status || {};
  const userConfig = input.userConfig || {};
  const rawStatus = summarizeRawStatus(status);
  const invertBatteryPowerSign = input.invertBatteryPowerSign === true;
  const selectedKw = summarizeSelectedKw(status, invertBatteryPowerSign);
  const nativeBalance = buildFlowBalance(status, rawStatus.batteryPowerW);
  const invertedBalance = rawStatus.batteryPowerW === null ? null : buildFlowBalance(status, -rawStatus.batteryPowerW);
  const selectedBalance = rawStatus.batteryPowerW === null
    ? null
    : buildFlowBalance(status, invertBatteryPowerSign ? -rawStatus.batteryPowerW : rawStatus.batteryPowerW);
  const anomalies = [];

  if (rawStatus.loadPowerW !== null && rawStatus.loadPowerW < 0) anomalies.push('negative-load-power');
  if (rawStatus.feedInPowerW !== null && rawStatus.feedInPowerW < 0) anomalies.push('negative-feed-in-power');
  if (rawStatus.gridPowerW !== null && rawStatus.gridPowerW < 0) anomalies.push('negative-grid-import-power');
  if (selectedBalance && Math.abs(selectedBalance.residualW) > 500) anomalies.push('energy-flow-imbalance');
  if (
    rawStatus.feedInPowerW !== null &&
    rawStatus.feedInPowerW > 0 &&
    Math.abs(rawStatus.feedInPowerW) <= 100
  ) {
    anomalies.push('small-feed-in-value-may-be-watts');
  }
  if (
    rawStatus.gridPowerW !== null &&
    rawStatus.gridPowerW > 0 &&
    Math.abs(rawStatus.gridPowerW) <= 100
  ) {
    anomalies.push('small-grid-import-value-may-be-watts');
  }
  if (
    rawStatus.batteryTempC === 0 &&
    rawStatus.ambientTempC === 0
  ) {
    anomalies.push('temperature-sensors-not-reporting');
  }
  if (
    hasMaterialNormalizationGap(selectedKw.feedInPowerKw, selectedKw.heuristicFeedInPowerKw) ||
    hasMaterialNormalizationGap(selectedKw.gridPowerKw, selectedKw.heuristicGridPowerKw) ||
    hasMaterialNormalizationGap(selectedKw.loadPowerKw, selectedKw.heuristicLoadPowerKw)
  ) {
    anomalies.push('power-unit-normalization-ambiguity');
  }

  return {
    provider: 'alphaess',
    route: String(input.route || 'unknown'),
    userId: input.userId || null,
    userEmail: input.userEmail || null,
    deviceSN: String(input.deviceSN || rawStatus.deviceSN || ''),
    observedAtIso: rawStatus.observedAtIso,
    systemTopology: {
      configuredCoupling: normalizeCouplingValue(userConfig.systemTopology && userConfig.systemTopology.coupling),
      topologySource: userConfig.systemTopology && userConfig.systemTopology.source
        ? String(userConfig.systemTopology.source)
        : null
    },
    batterySign: {
      invertApplied: invertBatteryPowerSign,
      policy: userConfig.alphaessBatteryPowerSign || null,
      explicitInvertFlag: typeof userConfig.alphaessInvertBatteryPower === 'boolean'
        ? userConfig.alphaessInvertBatteryPower
        : null
    },
    rawStatus,
    selectedKw,
    flowBalance: {
      native: nativeBalance,
      inverted: invertedBalance,
      selected: selectedBalance
    },
    anomalies,
    suspicious: anomalies.some((code) => code !== 'temperature-sensors-not-reporting')
  };
}

function logAlphaEssDiagnostics(logger, diagnostics, options = {}) {
  if (!diagnostics) return;

  const mode = String(options.mode || 'suspicious-only').toLowerCase();
  if (mode === 'never') return;
  if (mode === 'suspicious-only' && !diagnostics.suspicious) return;

  const prefix = '[AlphaESSDiagnostics]';
  const payload = JSON.stringify({
    route: diagnostics.route,
    userId: diagnostics.userId,
    userEmail: diagnostics.userEmail,
    deviceSN: diagnostics.deviceSN,
    observedAtIso: diagnostics.observedAtIso,
    anomalies: diagnostics.anomalies,
    selectedKw: diagnostics.selectedKw,
    flowBalance: diagnostics.flowBalance,
    batterySign: diagnostics.batterySign,
    systemTopology: diagnostics.systemTopology
  });

  if (diagnostics.suspicious) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`${prefix} ${payload}`);
      return;
    }
    console.warn(`${prefix} ${payload}`);
    return;
  }

  if (logger && typeof logger.info === 'function') {
    logger.info(prefix, payload, true);
    return;
  }
  if (logger && typeof logger.log === 'function') {
    logger.log(`${prefix} ${payload}`);
    return;
  }
  console.info(`${prefix} ${payload}`);
}

module.exports = {
  buildAlphaEssDiagnostics,
  logAlphaEssDiagnostics
};