'use strict';

/**
 * G4 exit criterion #4 — Device variable names normalized regardless of firmware/vendor.
 *
 * These tests prove that a consumer of the adapter layer always receives canonical
 * field names (socPct, batteryTempC, ambientTempC, pvPowerW, loadPowerW, gridPowerW,
 * feedInPowerW) regardless of which firmware alias the device actually sent.
 */

const {
  DEVICE_VARIABLE_ALIASES,
  normalizeDeviceStatusPayload
} = require('../lib/adapters/device-adapter');

const {
  FoxessDeviceAdapter
} = require('../lib/adapters/foxess-adapter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFoxessPayload(datas) {
  return { errno: 0, result: [{ datas }] };
}

function buildFoxessApiStub(payload) {
  return {
    callFoxESSAPI: jest.fn(async () => payload)
  };
}

// ---------------------------------------------------------------------------
// 1 — DEVICE_VARIABLE_ALIASES structure
// ---------------------------------------------------------------------------

describe('DEVICE_VARIABLE_ALIASES — canonical field definitions', () => {
  test('defines all 7 canonical fields', () => {
    const expected = ['socPct', 'batteryTempC', 'ambientTempC', 'pvPowerW', 'loadPowerW', 'gridPowerW', 'feedInPowerW'];
    expect(Object.keys(DEVICE_VARIABLE_ALIASES)).toEqual(expect.arrayContaining(expected));
    expect(Object.keys(DEVICE_VARIABLE_ALIASES)).toHaveLength(7);
  });

  test('each entry is a non-empty frozen array', () => {
    for (const [field, aliases] of Object.entries(DEVICE_VARIABLE_ALIASES)) {
      expect(Array.isArray(aliases)).toBe(true);
      expect(aliases.length).toBeGreaterThan(0);
      expect(() => aliases.push('x')).toThrow();
      expect(field).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 2 — normalizeDeviceStatusPayload: every alias for every field
// ---------------------------------------------------------------------------

describe('normalizeDeviceStatusPayload — firmware alias coverage', () => {
  function payloadFor(alias, value) {
    return buildFoxessPayload([{ variable: alias, value }]);
  }

  test.each(DEVICE_VARIABLE_ALIASES.socPct.map(a => [a]))(
    'socPct resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 85));
      expect(result.socPct).toBe(85);
    }
  );

  test.each(DEVICE_VARIABLE_ALIASES.batteryTempC.map(a => [a]))(
    'batteryTempC resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 32.5));
      expect(result.batteryTempC).toBe(32.5);
    }
  );

  test.each(DEVICE_VARIABLE_ALIASES.ambientTempC.map(a => [a]))(
    'ambientTempC resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 22.1));
      expect(result.ambientTempC).toBe(22.1);
    }
  );

  test.each(DEVICE_VARIABLE_ALIASES.pvPowerW.map(a => [a]))(
    'pvPowerW resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 2400));
      expect(result.pvPowerW).toBe(2400);
    }
  );

  test.each(DEVICE_VARIABLE_ALIASES.loadPowerW.map(a => [a]))(
    'loadPowerW resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 1100));
      expect(result.loadPowerW).toBe(1100);
    }
  );

  test.each(DEVICE_VARIABLE_ALIASES.gridPowerW.map(a => [a]))(
    'gridPowerW resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 500));
      expect(result.gridPowerW).toBe(500);
    }
  );

  test.each(DEVICE_VARIABLE_ALIASES.feedInPowerW.map(a => [a]))(
    'feedInPowerW resolved from alias "%s"',
    (alias) => {
      const result = normalizeDeviceStatusPayload(payloadFor(alias, 300));
      expect(result.feedInPowerW).toBe(300);
    }
  );

  test('unknown alias returns null for that field, not an error', () => {
    const result = normalizeDeviceStatusPayload(
      buildFoxessPayload([{ variable: 'unknownField', value: 99 }])
    );
    expect(result.socPct).toBeNull();
    expect(result.pvPowerW).toBeNull();
    expect(typeof result.observedAtIso).toBe('string');
  });

  test('zero is a valid value (not treated as falsy)', () => {
    const result = normalizeDeviceStatusPayload(
      buildFoxessPayload([{ variable: 'feedinPower', value: 0 }])
    );
    expect(result.feedInPowerW).toBe(0);
  });

  test('non-finite string value falls back to null', () => {
    const result = normalizeDeviceStatusPayload(
      buildFoxessPayload([{ variable: 'SoC', value: 'N/A' }])
    );
    expect(result.socPct).toBeNull();
  });

  test('returns all 7 canonical fields + observedAtIso regardless of input', () => {
    const result = normalizeDeviceStatusPayload(buildFoxessPayload([]));
    expect(Object.keys(result)).toEqual(expect.arrayContaining([
      'socPct', 'batteryTempC', 'ambientTempC',
      'pvPowerW', 'loadPowerW', 'gridPowerW', 'feedInPowerW',
      'observedAtIso'
    ]));
  });
});

// ---------------------------------------------------------------------------
// 3 — FoxessDeviceAdapter.getStatus: end-to-end canonical normalization
// ---------------------------------------------------------------------------

describe('FoxessDeviceAdapter.getStatus — canonical output via real adapter', () => {
  test('maps old firmware aliases through adapter to canonical fields', async () => {
    const rawPayload = buildFoxessPayload([
      { variable: 'SoC_1', value: 72 },
      { variable: 'batTemperature_1', value: 30.5 },
      { variable: 'ambientTemperation', value: 24.0 },
      { variable: 'pvPower', value: 1800 },
      { variable: 'loadsPower', value: 900 },
      { variable: 'gridConsumptionPower', value: 200 },
      { variable: 'feedinPower', value: 0 }
    ]);

    const adapter = new FoxessDeviceAdapter({ foxessAPI: buildFoxessApiStub(rawPayload) });
    const status = await adapter.getStatus({ deviceSN: 'SN-001', userConfig: {}, userId: 'u1' });

    expect(status.socPct).toBe(72);
    expect(status.batteryTempC).toBe(30.5);
    expect(status.ambientTempC).toBe(24.0);
    expect(status.pvPowerW).toBe(1800);
    expect(status.loadPowerW).toBe(900);
    expect(status.gridPowerW).toBe(200);
    expect(status.feedInPowerW).toBe(0);
    expect(typeof status.observedAtIso).toBe('string');
  });

  test('maps new/corrected firmware aliases equally well', async () => {
    const rawPayload = buildFoxessPayload([
      { variable: 'SoC', value: 55 },
      { variable: 'batTemperature', value: 28.0 },
      { variable: 'ambientTemperature', value: 21.5 },
      { variable: 'pv_power', value: 3200 },
      { variable: 'loadPower', value: 1400 },
      { variable: 'gridPower', value: 0 },
      { variable: 'feedInPower', value: 1800 }
    ]);

    const adapter = new FoxessDeviceAdapter({ foxessAPI: buildFoxessApiStub(rawPayload) });
    const status = await adapter.getStatus({ deviceSN: 'SN-002', userConfig: {}, userId: 'u1' });

    expect(status.socPct).toBe(55);
    expect(status.batteryTempC).toBe(28.0);
    expect(status.ambientTempC).toBe(21.5);
    expect(status.pvPowerW).toBe(3200);
    expect(status.loadPowerW).toBe(1400);
    expect(status.gridPowerW).toBe(0);
    expect(status.feedInPowerW).toBe(1800);
  });
});

// ---------------------------------------------------------------------------
// 4 — G4 criterion #4 explicit proof
// ---------------------------------------------------------------------------

describe('G4 criterion #4 — vendor-agnostic consumer reads canonical names only', () => {
  test('consumer reading canonical names works for FoxESS old-firmware payload', async () => {
    const oldFirmware = buildFoxessPayload([
      { variable: 'SoC1', value: 60 },
      { variable: 'batTemperature_1', value: 33 },
      { variable: 'pvPower', value: 2000 }
    ]);

    const adapter = new FoxessDeviceAdapter({ foxessAPI: buildFoxessApiStub(oldFirmware) });
    const status = await adapter.getStatus({ deviceSN: 'SN-X', userConfig: {}, userId: 'u1' });

    // A vendor-agnostic consumer ONLY uses canonical names:
    const soc = status.socPct;
    const battTemp = status.batteryTempC;
    const pv = status.pvPowerW;

    expect(soc).toBe(60);
    expect(battTemp).toBe(33);
    expect(pv).toBe(2000);

    // The consumer NEVER needs to know about 'SoC1', 'batTemperature_1', 'pvPower'
    // — those are internal firmware details, transparent to the caller.
  });

  test('normalizeDeviceStatusPayload is idempotent across both alias sets', () => {
    const oldAliasPayload = buildFoxessPayload([
      { variable: 'SoC', value: 50 },
      { variable: 'feedinPower', value: 400 }
    ]);
    const newAliasPayload = buildFoxessPayload([
      { variable: 'SoC', value: 50 },
      { variable: 'feedInPower', value: 400 }
    ]);

    const resultOld = normalizeDeviceStatusPayload(oldAliasPayload);
    const resultNew = normalizeDeviceStatusPayload(newAliasPayload);

    expect(resultOld.feedInPowerW).toBe(resultNew.feedInPowerW);
    expect(resultOld.socPct).toBe(resultNew.socPct);
  });
});
