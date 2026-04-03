(function initRoiImpact(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RoiImpact = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildRoiImpact() {
  'use strict';

  const KNOWN_PROVIDER_PROFILES = Object.freeze({
    foxess: Object.freeze({
      label: 'FoxESS',
      roiAccuracy: 'exact',
      roiAccuracyLabel: 'Exact',
      supportsExactPowerControl: true,
      roiExplanation: 'Uses actual settled prices, requested power, and actual runtime. Treat as an estimate, not invoice-grade billing.'
    }),
    alphaess: Object.freeze({
      label: 'AlphaESS',
      roiAccuracy: 'indicative',
      roiAccuracyLabel: 'Indicative',
      supportsExactPowerControl: false,
      roiExplanation: 'Uses actual settled prices, requested power, and actual runtime. On AlphaESS, requested power is advisory, so actual battery rate can differ from the rule setting.'
    }),
    sungrow: Object.freeze({
      label: 'Sungrow',
      roiAccuracy: 'indicative',
      roiAccuracyLabel: 'Indicative',
      supportsExactPowerControl: false,
      roiExplanation: 'Uses actual settled prices, requested power, and actual runtime. On Sungrow, the current integration applies TOU windows rather than exact power targets.'
    }),
    sigenergy: Object.freeze({
      label: 'SigenEnergy',
      roiAccuracy: 'provisional',
      roiAccuracyLabel: 'Provisional',
      supportsExactPowerControl: false,
      roiExplanation: 'Uses actual settled prices with conservative assumptions. Scheduler-backed rule execution is not fully implemented for SigenEnergy in the current integration.'
    })
  });

  function normalizeProvider(provider) {
    return String(provider || '').trim().toLowerCase() || 'unknown';
  }

  function getProviderProfile(provider) {
    const normalized = normalizeProvider(provider);
    return KNOWN_PROVIDER_PROFILES[normalized] || null;
  }

  function buildRoiProviderCapabilities(provider, baseCapabilities) {
    const normalized = normalizeProvider(provider);
    const profile = getProviderProfile(normalized);
    const base = baseCapabilities && typeof baseCapabilities === 'object'
      ? { ...baseCapabilities }
      : {};

    if (!profile) {
      return {
        ...base,
        provider: normalized,
        label: base.label || 'Unknown provider',
        supportsExactPowerControl: false,
        roiAccuracy: 'provisional',
        roiAccuracyLabel: 'Provisional',
        roiExplanation: 'This provider is not in the current ROI capability map, so values are shown conservatively and should be treated as provisional.'
      };
    }

    return {
      ...base,
      provider: normalized,
      label: profile.label,
      supportsExactPowerControl: profile.supportsExactPowerControl,
      roiAccuracy: profile.roiAccuracy,
      roiAccuracyLabel: profile.roiAccuracyLabel,
      roiExplanation: profile.roiExplanation
    };
  }

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toAudFromCentsPerKwh(priceCentsPerKwh, powerKw, durationHours) {
    const centsPerKwh = toFiniteNumber(priceCentsPerKwh);
    const kw = toFiniteNumber(powerKw);
    const hours = toFiniteNumber(durationHours);
    if (centsPerKwh === null || kw === null || hours === null) return null;
    return kw * hours * (centsPerKwh / 100);
  }

  function calculateEventImpact(options) {
    const event = options && typeof options === 'object' ? (options.event || {}) : {};
    const classification = options && typeof options === 'object' ? (options.classification || {}) : {};

    const durationHours = Math.max(0, toFiniteNumber(event.durationMs) || 0) / (1000 * 60 * 60);
    const rulePowerKw = Math.max(0, toFiniteNumber(event?.action?.fdPwr) || 0) / 1000 || null;
    const houseLoadKw = event?.roiSnapshot?.houseLoadW === null || event?.roiSnapshot?.houseLoadW === undefined
      ? null
      : Math.max(0, (toFiniteNumber(event.roiSnapshot.houseLoadW) || 0) / 1000);
    const buyPrice = toFiniteNumber(options && options.buyPrice);
    const feedInPrice = toFiniteNumber(options && options.feedInPrice);

    const impact = {
      buyPrice,
      chargeImpactAud: null,
      chargeKw: null,
      durationHours,
      exportCaptureAud: null,
      exportKw: null,
      feedInPrice,
      houseLoadKw,
      importAvoidanceAud: null,
      importAvoidanceKw: null,
      impactAud: null,
      isChargeRule: classification.isChargeRule === true,
      isDischargeRule: classification.isDischargeRule === true,
      isExportMode: classification.isExportMode === true || classification.isFeedinRule === true,
      rulePowerKw
    };

    if (!rulePowerKw || durationHours <= 0) {
      return impact;
    }

    if (impact.isChargeRule) {
      impact.chargeKw = rulePowerKw;
      impact.chargeImpactAud = toAudFromCentsPerKwh(buyPrice, impact.chargeKw, durationHours);
      if (impact.chargeImpactAud !== null) {
        impact.chargeImpactAud *= -1;
        impact.impactAud = impact.chargeImpactAud;
      }
      return impact;
    }

    if (!impact.isDischargeRule) {
      return impact;
    }

    if (houseLoadKw !== null) {
      impact.importAvoidanceKw = Math.min(rulePowerKw, houseLoadKw);
      impact.exportKw = Math.max(0, rulePowerKw - houseLoadKw);
    } else if (impact.isExportMode) {
      impact.importAvoidanceKw = 0;
      impact.exportKw = rulePowerKw;
    } else {
      impact.importAvoidanceKw = rulePowerKw;
      impact.exportKw = 0;
    }

    impact.importAvoidanceAud = toAudFromCentsPerKwh(buyPrice, impact.importAvoidanceKw, durationHours);
    impact.exportCaptureAud = toAudFromCentsPerKwh(feedInPrice, impact.exportKw, durationHours);

    const audParts = [impact.importAvoidanceAud, impact.exportCaptureAud].filter((value) => value !== null);
    if (audParts.length > 0) {
      impact.impactAud = audParts.reduce((sum, value) => sum + value, 0);
    }

    return impact;
  }

  function formatPriceBasis(impact) {
    if (!impact || typeof impact !== 'object') return '-';

    const parts = [];
    const buyPrice = toFiniteNumber(impact.buyPrice);
    const feedInPrice = toFiniteNumber(impact.feedInPrice);

    if (impact.isChargeRule && buyPrice !== null) {
      parts.push(`buy ${buyPrice.toFixed(2)}c`);
    } else if (impact.isDischargeRule) {
      if ((toFiniteNumber(impact.importAvoidanceKw) || 0) > 0 && buyPrice !== null) {
        parts.push(`buy ${buyPrice.toFixed(2)}c`);
      }
      if ((toFiniteNumber(impact.exportKw) || 0) > 0 && feedInPrice !== null) {
        parts.push(`feed-in ${feedInPrice.toFixed(2)}c`);
      }
      if (parts.length === 0) {
        if (impact.isExportMode && feedInPrice !== null) {
          parts.push(`feed-in ${feedInPrice.toFixed(2)}c`);
        } else if (buyPrice !== null) {
          parts.push(`buy ${buyPrice.toFixed(2)}c`);
        }
      }
    }

    return parts.length ? parts.join(' + ') : '-';
  }

  return {
    KNOWN_PROVIDER_PROFILES,
    buildRoiProviderCapabilities,
    calculateEventImpact,
    escHtml,
    formatPriceBasis,
    normalizeProvider
  };
});
