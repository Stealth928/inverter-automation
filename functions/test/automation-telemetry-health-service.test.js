'use strict';

const {
  DEFAULT_FRESHNESS_MAX_AGE_MS,
  DEFAULT_FROZEN_MAX_AGE_MS,
  buildTelemetryFingerprint,
  evaluateTelemetryHealth,
  extractTelemetryTimestampMs,
  parseFoxessCloudTimeToMs,
  parseTimestampMs
} = require('../lib/services/automation-telemetry-health-service');

function buildPayload(frameOverrides = {}) {
  return {
    errno: 0,
    result: [{
      time: '2026-03-12T08:00:00.000Z',
      datas: [
        { variable: 'SoC', value: 52.4 },
        { variable: 'pvPower', value: 1800 },
        { variable: 'loadsPower', value: 950 },
        { variable: 'gridConsumptionPower', value: 210 },
        { variable: 'feedinPower', value: 0 }
      ],
      ...frameOverrides
    }]
  };
}

describe('automation telemetry health service', () => {
  test('parseTimestampMs supports numeric and Firestore timestamp-like values', () => {
    expect(parseTimestampMs(1710000000000)).toBe(1710000000000);
    expect(parseTimestampMs(1710000000)).toBe(1710000000000);
    expect(parseTimestampMs({ _seconds: 1710000000, _nanoseconds: 0 })).toBe(1710000000000);
  });

  test('parseFoxessCloudTimeToMs parses cloud time string with timezone suffix', () => {
    const parsed = parseFoxessCloudTimeToMs('2025-11-29 19:01:57 AEDT+1100');
    expect(Number.isFinite(parsed)).toBe(true);
  });

  test('extractTelemetryTimestampMs reads frame time first', () => {
    const payload = buildPayload({ time: '2026-03-12T09:30:00.000Z' });
    const timestampMs = extractTelemetryTimestampMs(payload);
    expect(timestampMs).toBe(Date.parse('2026-03-12T09:30:00.000Z'));
  });

  test('buildTelemetryFingerprint normalizes key power/soc fields', () => {
    const fingerprint = buildTelemetryFingerprint(buildPayload());
    expect(fingerprint).toBe(
      JSON.stringify({
        socPct: 52.4,
        pvPowerW: 1800,
        loadPowerW: 950,
        gridPowerW: 210,
        feedInPowerW: 0
      })
    );
  });

  test('evaluateTelemetryHealth pauses when telemetry is older than freshness threshold', () => {
    const nowMs = Date.parse('2026-03-12T09:00:00.000Z');
    const staleTimestamp = new Date(nowMs - (DEFAULT_FRESHNESS_MAX_AGE_MS + 60000)).toISOString();
    const payload = buildPayload({ time: staleTimestamp });

    const result = evaluateTelemetryHealth({
      inverterData: payload,
      nowMs
    });

    expect(result.shouldPauseAutomation).toBe(true);
    expect(result.pauseReason).toBe('stale_telemetry');
    expect(result.telemetryAgeMs).toBeGreaterThan(DEFAULT_FRESHNESS_MAX_AGE_MS);
    expect(result.statePatch.telemetryFailsafePaused).toBe(true);
  });

  test('evaluateTelemetryHealth pauses when timestamp is missing', () => {
    const payload = buildPayload({ time: null });
    const result = evaluateTelemetryHealth({
      inverterData: payload,
      nowMs: Date.parse('2026-03-12T09:00:00.000Z')
    });

    expect(result.shouldPauseAutomation).toBe(true);
    expect(result.pauseReason).toBe('stale_telemetry_missing_timestamp');
    expect(result.telemetryAgeMs).toBeNull();
  });

  test('evaluateTelemetryHealth pauses when fingerprint is unchanged for over frozen threshold', () => {
    const nowMs = Date.parse('2026-03-12T10:00:00.000Z');
    const payload = {
      ...buildPayload({ time: new Date(nowMs).toISOString() }),
      telemetryTimestampTrust: 'synthetic'
    };
    const fingerprint = buildTelemetryFingerprint(payload);

    const result = evaluateTelemetryHealth({
      inverterData: payload,
      nowMs,
      previousState: {
        telemetryFingerprint: fingerprint,
        telemetryFingerprintSinceMs: nowMs - (DEFAULT_FROZEN_MAX_AGE_MS + 60000)
      }
    });

    expect(result.shouldPauseAutomation).toBe(true);
    expect(result.pauseReason).toBe('frozen_telemetry');
    expect(result.frozen).toBe(true);
    expect(result.telemetryTimestampTrust).toBe('synthetic');
  });

  test('evaluateTelemetryHealth does not pause steady telemetry when source timestamp is trusted', () => {
    const nowMs = Date.parse('2026-03-12T10:00:00.000Z');
    const payload = buildPayload({ time: new Date(nowMs).toISOString() });
    const fingerprint = buildTelemetryFingerprint(payload);

    const result = evaluateTelemetryHealth({
      inverterData: payload,
      nowMs,
      previousState: {
        telemetryFingerprint: fingerprint,
        telemetryFingerprintSinceMs: nowMs - (DEFAULT_FROZEN_MAX_AGE_MS + 60000)
      }
    });

    expect(result.shouldPauseAutomation).toBe(false);
    expect(result.pauseReason).toBeNull();
    expect(result.frozenCandidate).toBe(true);
    expect(result.frozen).toBe(false);
    expect(result.telemetryTimestampTrust).toBe('source');
  });

  test('evaluateTelemetryHealth remains healthy when fingerprint changes', () => {
    const nowMs = Date.parse('2026-03-12T10:00:00.000Z');
    const payload = buildPayload({ time: new Date(nowMs).toISOString(), datas: [{ variable: 'SoC', value: 61 }] });

    const result = evaluateTelemetryHealth({
      inverterData: payload,
      nowMs,
      previousState: {
        telemetryFingerprint: JSON.stringify({
          socPct: 52.4,
          pvPowerW: 1800,
          loadPowerW: 950,
          gridPowerW: 210,
          feedInPowerW: 0
        }),
        telemetryFingerprintSinceMs: nowMs - (DEFAULT_FROZEN_MAX_AGE_MS + 120000)
      }
    });

    expect(result.shouldPauseAutomation).toBe(false);
    expect(result.pauseReason).toBeNull();
    expect(result.statePatch.telemetryFailsafePaused).toBe(false);
  });
});
