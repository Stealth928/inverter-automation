'use strict';

const {
  TariffProviderAdapter,
  normalizeTariffInterval,
  normalizeTariffSnapshot,
  validateTariffProviderAdapter
} = require('../lib/adapters/tariff-provider');

describe('tariff provider adapter contract helpers', () => {
  test('normalizeTariffInterval coerces values into contract shape', () => {
    expect(
      normalizeTariffInterval({
        startTime: '2026-03-07T00:00:00.000Z',
        endTime: '2026-03-07T00:30:00.000Z',
        buyCentsPerKwh: '25.3',
        feedInCentsPerKwh: '-7.2',
        renewablePct: '41.5',
        source: 'actual'
      })
    ).toEqual({
      startIso: '2026-03-07T00:00:00.000Z',
      endIso: '2026-03-07T00:30:00.000Z',
      buyCentsPerKwh: 25.3,
      feedInCentsPerKwh: -7.2,
      renewablePct: 41.5,
      source: 'actual'
    });
  });

  test('normalizeTariffSnapshot normalizes intervals and default asOfIso', () => {
    const snapshot = normalizeTariffSnapshot({
      intervals: [
        {
          startIso: '2026-03-07T01:00:00.000Z',
          endIso: '2026-03-07T01:30:00.000Z',
          buyCentsPerKwh: 30,
          source: 'forecast'
        }
      ]
    });

    expect(snapshot.buyCentsPerKwh).toBeNull();
    expect(snapshot.feedInCentsPerKwh).toBeNull();
    expect(snapshot.asOfIso).toEqual(expect.any(String));
    expect(snapshot.intervals).toEqual([
      {
        startIso: '2026-03-07T01:00:00.000Z',
        endIso: '2026-03-07T01:30:00.000Z',
        buyCentsPerKwh: 30,
        feedInCentsPerKwh: null,
        renewablePct: null,
        source: 'forecast'
      }
    ]);
  });

  test('validateTariffProviderAdapter enforces required methods', () => {
    expect(() => validateTariffProviderAdapter({ getCurrentPrices() {} })).toThrow(/missing required methods/i);

    class DemoTariffAdapter extends TariffProviderAdapter {
      async getCurrentPrices() { return {}; }
      async getHistoricalPrices() { return []; }
      normalizeProviderError(error) { return { errno: 3200, error: error.message }; }
    }

    expect(validateTariffProviderAdapter(new DemoTariffAdapter())).toBe(true);
  });

  test('base TariffProviderAdapter normalizeProviderError returns provider errno', () => {
    const adapter = new TariffProviderAdapter();
    expect(adapter.normalizeProviderError(new Error('Rate limit'))).toEqual({
      errno: 3200,
      error: 'Rate limit'
    });
  });
});
