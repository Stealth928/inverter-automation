'use strict';

const {
  buildRoiProviderCapabilities,
  calculateEventImpact,
  escHtml,
  formatPriceBasis
} = require('../../frontend/js/roi-impact');

describe('ROI impact helpers', () => {
  test('buildRoiProviderCapabilities returns exact profile for FoxESS', () => {
    const capabilities = buildRoiProviderCapabilities('foxess', {
      supportsSchedulerControl: true
    });

    expect(capabilities).toEqual(expect.objectContaining({
      provider: 'foxess',
      label: 'FoxESS',
      roiAccuracy: 'exact',
      roiAccuracyLabel: 'Exact',
      supportsExactPowerControl: true,
      supportsSchedulerControl: true
    }));
  });

  test('buildRoiProviderCapabilities uses conservative defaults for unknown providers', () => {
    const capabilities = buildRoiProviderCapabilities('mystery-oem');

    expect(capabilities).toEqual(expect.objectContaining({
      provider: 'mystery-oem',
      label: 'Unknown provider',
      roiAccuracy: 'provisional',
      roiAccuracyLabel: 'Provisional',
      supportsExactPowerControl: false
    }));
  });

  test('calculateEventImpact uses requested charge power only, not house load', () => {
    const impact = calculateEventImpact({
      classification: { isChargeRule: true },
      buyPrice: 30,
      event: {
        durationMs: 30 * 60 * 1000,
        action: { fdPwr: 2000 },
        roiSnapshot: { houseLoadW: 1000 }
      }
    });

    expect(impact.chargeKw).toBe(2);
    expect(impact.houseLoadKw).toBe(1);
    expect(impact.impactAud).toBeCloseTo(-0.3, 6);
    expect(formatPriceBasis(impact)).toBe('buy 30.00c');
  });

  test('calculateEventImpact splits discharge value into import avoidance and export capture', () => {
    const impact = calculateEventImpact({
      classification: { isDischargeRule: true, isExportMode: false },
      buyPrice: 40,
      feedInPrice: 20,
      event: {
        durationMs: 30 * 60 * 1000,
        action: { fdPwr: 3000 },
        roiSnapshot: { houseLoadW: 1200 }
      }
    });

    expect(impact.importAvoidanceKw).toBeCloseTo(1.2, 6);
    expect(impact.exportKw).toBeCloseTo(1.8, 6);
    expect(impact.importAvoidanceAud).toBeCloseTo(0.24, 6);
    expect(impact.exportCaptureAud).toBeCloseTo(0.18, 6);
    expect(impact.impactAud).toBeCloseTo(0.42, 6);
    expect(formatPriceBasis(impact)).toBe('buy 40.00c + feed-in 20.00c');
  });

  test('calculateEventImpact falls back to export-only valuation for Feedin without house load', () => {
    const impact = calculateEventImpact({
      classification: { isDischargeRule: true, isExportMode: true, isFeedinRule: true },
      feedInPrice: 12,
      event: {
        durationMs: 15 * 60 * 1000,
        action: { fdPwr: 4000 },
        roiSnapshot: { houseLoadW: null }
      }
    });

    expect(impact.importAvoidanceKw).toBe(0);
    expect(impact.exportKw).toBe(4);
    expect(impact.exportCaptureAud).toBeCloseTo(0.12, 6);
    expect(impact.impactAud).toBeCloseTo(0.12, 6);
    expect(formatPriceBasis(impact)).toBe('feed-in 12.00c');
  });

  test('escHtml escapes dangerous HTML characters', () => {
    expect(escHtml(`<img src=x onerror="alert('xss')">`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;');
  });
});
