'use strict';

const {
  evaluateActiveRuleEnergyCap,
  getEnergyCapDirectionForWorkMode,
  normalizeStopOnEnergyKwh,
  validateActionEnergyCap
} = require('../lib/services/automation-energy-cap-service');

function buildTelemetryPayload({ time = '2026-03-26T00:00:00.000Z', gridConsumptionPower = 0, feedinPower = 0, unit } = {}) {
  const unitPatch = unit ? { unit } : {};
  return {
    errno: 0,
    result: [{
      time,
      datas: [
        { variable: 'gridConsumptionPower', value: gridConsumptionPower, ...unitPatch },
        { variable: 'feedinPower', value: feedinPower, ...unitPatch }
      ]
    }]
  };
}

describe('automation energy cap service', () => {
  test('normalizes action config and supported directions', () => {
    expect(getEnergyCapDirectionForWorkMode('ForceCharge')).toBe('import');
    expect(getEnergyCapDirectionForWorkMode('ForceDischarge')).toBe('export');
    expect(getEnergyCapDirectionForWorkMode('Feedin')).toBe('export');
    expect(getEnergyCapDirectionForWorkMode('SelfUse')).toBeNull();
    expect(normalizeStopOnEnergyKwh('15.2349')).toBe(15.235);
    expect(validateActionEnergyCap({ workMode: 'SelfUse', stopOnEnergyKwh: 5 })).toContain('only supported for workMode');
  });

  test('uses provider daily report totals when available', async () => {
    const result = await evaluateActiveRuleEnergyCap({
      action: { workMode: 'ForceDischarge', stopOnEnergyKwh: 15 },
      deviceSN: 'SN-REPORT-1',
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({
          errno: 0,
          result: [{ variable: 'feedin', unit: 'kWh', values: new Array(31).fill(0).map((value, index) => (index === 25 ? 25.1 : value)) }]
        }))
      },
      inverterData: buildTelemetryPayload({ feedinPower: 4500, time: '2026-03-26T00:30:00.000Z' }),
      nowMs: Date.parse('2026-03-26T00:30:00.000Z'),
      provider: 'foxess',
      ruleId: 'rule-report',
      state: {
        activeEnergyTracking: {
          baselineTotalKwh: 10,
          direction: 'export',
          dayKey: '2026-03-26',
          progressKwh: 4,
          ruleId: 'rule-report',
          targetKwh: 15
        }
      },
      timeZone: 'UTC',
      userConfig: { deviceSn: 'SN-REPORT-1' },
      userId: 'u-energy-report'
    });

    expect(result.applicable).toBe(true);
    expect(result.progressKwh).toBe(15.1);
    expect(result.reached).toBe(true);
    expect(result.condition).toEqual(expect.objectContaining({
      condition: 'energyCap',
      direction: 'export',
      met: false,
      source: 'report',
      target: 15
    }));
    expect(result.statePatch.activeEnergyTracking).toEqual(expect.objectContaining({
      baselineTotalKwh: 10,
      lastReportTotalKwh: 25.1,
      measurementSource: 'report',
      progressKwh: 15.1
    }));
  });

  test('falls back to timestamp-deduped telemetry integration when provider reports are unavailable', async () => {
    const baseOptions = {
      action: { workMode: 'ForceCharge', stopOnEnergyKwh: 10 },
      deviceSN: 'SN-TELEMETRY-1',
      foxessAPI: {
        callFoxESSAPI: jest.fn(async () => ({ errno: 503, error: 'unavailable' }))
      },
      provider: 'foxess',
      ruleId: 'rule-telemetry',
      timeZone: 'UTC',
      userConfig: { deviceSn: 'SN-TELEMETRY-1' },
      userId: 'u-energy-telemetry'
    };

    const first = await evaluateActiveRuleEnergyCap({
      ...baseOptions,
      inverterData: buildTelemetryPayload({ gridConsumptionPower: 3000, time: '2026-03-26T00:00:00.000Z' }),
      nowMs: Date.parse('2026-03-26T00:00:00.000Z'),
      state: { activeEnergyTracking: null }
    });

    expect(first.progressKwh).toBe(0);
    expect(first.statePatch.activeEnergyTracking).toEqual(expect.objectContaining({
      lastTelemetryPowerW: 3000,
      lastTelemetryTimestampMs: Date.parse('2026-03-26T00:00:00.000Z'),
      measurementSource: 'telemetry',
      progressKwh: 0
    }));

    const second = await evaluateActiveRuleEnergyCap({
      ...baseOptions,
      inverterData: buildTelemetryPayload({ gridConsumptionPower: 5000, time: '2026-03-26T00:30:00.000Z' }),
      nowMs: Date.parse('2026-03-26T00:30:00.000Z'),
      state: first.statePatch
    });

    expect(second.progressKwh).toBe(2);
    expect(second.reached).toBe(false);

    const repeatedTimestamp = await evaluateActiveRuleEnergyCap({
      ...baseOptions,
      inverterData: buildTelemetryPayload({ gridConsumptionPower: 5000, time: '2026-03-26T00:30:00.000Z' }),
      nowMs: Date.parse('2026-03-26T00:30:00.000Z'),
      state: second.statePatch
    });

    expect(repeatedTimestamp.progressKwh).toBe(2);
    expect(repeatedTimestamp.statePatch.activeEnergyTracking.lastTelemetryPowerW).toBe(5000);
  });
});