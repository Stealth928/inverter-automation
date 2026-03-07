'use strict';

const {
  GenericFlatRateTariffAdapter,
  buildAmberStyleIntervals,
  createFlatRateTariffAdapter
} = require('../lib/adapters/flat-rate-adapter');
const { TariffProviderAdapter, validateTariffProviderAdapter } = require('../lib/adapters/tariff-provider');
const { createAdapterRegistry } = require('../lib/adapters/adapter-registry');

describe('flat-rate tariff adapter', () => {
  describe('buildAmberStyleIntervals', () => {
    test('returns general and feedIn intervals for both rates', () => {
      const nowIso = '2024-06-01T10:15:00.000Z'; // 10:15 → snaps to 10:00 window
      const intervals = buildAmberStyleIntervals(nowIso, 28, 6);

      expect(intervals).toHaveLength(2);

      const general = intervals.find((i) => i.channelType === 'general');
      expect(general).toMatchObject({
        type: 'CurrentInterval',
        channelType: 'general',
        perKwh: 28
      });

      const feedIn = intervals.find((i) => i.channelType === 'feedIn');
      expect(feedIn).toMatchObject({
        type: 'CurrentInterval',
        channelType: 'feedIn',
        perKwh: -6  // Amber convention: feedIn stored negative
      });
    });

    test('omits general interval when buyCentsPerKwh is null', () => {
      const intervals = buildAmberStyleIntervals('2024-06-01T10:00:00.000Z', null, 7);
      expect(intervals).toHaveLength(1);
      expect(intervals[0].channelType).toBe('feedIn');
    });

    test('omits feedIn interval when feedInCentsPerKwh is null', () => {
      const intervals = buildAmberStyleIntervals('2024-06-01T10:00:00.000Z', 30, null);
      expect(intervals).toHaveLength(1);
      expect(intervals[0].channelType).toBe('general');
    });

    test('interval times snap to 30-minute window boundary', () => {
      const nowIso = '2024-06-01T10:47:33.000Z'; // inside 10:30 window
      const intervals = buildAmberStyleIntervals(nowIso, 25, null);
      expect(intervals[0].startTime).toBe('2024-06-01T10:30:00.000Z');
      expect(intervals[0].endTime).toBe('2024-06-01T11:00:00.000Z');
    });

    test('feedIn perKwh is always stored as negative regardless of input sign', () => {
      const intervals = buildAmberStyleIntervals('2024-06-01T10:00:00.000Z', null, -8);
      expect(intervals[0].perKwh).toBe(-8); // abs then negate
    });
  });

  describe('GenericFlatRateTariffAdapter constructor', () => {
    test('creates adapter with buy and feed-in rates', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 25, feedInCentsPerKwh: 5 });
      expect(adapter.buyCentsPerKwh).toBe(25);
      expect(adapter.feedInCentsPerKwh).toBe(5);
      expect(adapter.providerType).toBe('flat-rate');
    });

    test('throws when neither rate is supplied', () => {
      expect(() => new GenericFlatRateTariffAdapter({})).toThrow(
        'GenericFlatRateTariffAdapter: buyCentsPerKwh or feedInCentsPerKwh must be supplied'
      );
    });

    test('accepts buy-only rate', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 30 });
      expect(adapter.buyCentsPerKwh).toBe(30);
      expect(adapter.feedInCentsPerKwh).toBeNull();
    });

    test('accepts feed-in-only rate', () => {
      const adapter = new GenericFlatRateTariffAdapter({ feedInCentsPerKwh: 8 });
      expect(adapter.buyCentsPerKwh).toBeNull();
      expect(adapter.feedInCentsPerKwh).toBe(8);
    });

    test('accepts custom providerType label', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 22, providerType: 'custom-tariff' });
      expect(adapter.providerType).toBe('custom-tariff');
    });

    test('ignores non-finite rate values', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 20, feedInCentsPerKwh: NaN });
      expect(adapter.feedInCentsPerKwh).toBeNull();
    });

    test('extends TariffProviderAdapter base class', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 20 });
      expect(adapter).toBeInstanceOf(TariffProviderAdapter);
    });
  });

  describe('TariffProviderAdapter contract compliance', () => {
    test('passes validateTariffProviderAdapter check', () => {
      const adapter = createFlatRateTariffAdapter({ buyCentsPerKwh: 25, feedInCentsPerKwh: 5 });
      expect(() => validateTariffProviderAdapter(adapter)).not.toThrow();
    });

    test('getCurrentPrices returns normalized snapshot', async () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 25, feedInCentsPerKwh: 5 });
      const snapshot = await adapter.getCurrentPrices({});

      expect(snapshot).toMatchObject({
        buyCentsPerKwh: 25,
        feedInCentsPerKwh: 5,
        intervals: []
      });
      expect(typeof snapshot.asOfIso).toBe('string');
    });

    test('getHistoricalPrices returns empty-interval snapshot', async () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 25, feedInCentsPerKwh: 5 });
      const snapshot = await adapter.getHistoricalPrices({}, '2024-01-01', '2024-01-07', 30);

      expect(snapshot.intervals).toEqual([]);
      expect(snapshot.buyCentsPerKwh).toBe(25);
    });

    test('normalizeProviderError returns shaped error object', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 25 });
      const norm = adapter.normalizeProviderError(new Error('test failure'));

      expect(norm.errno).toBe(3210);
      expect(norm.error).toBe('test failure');
    });

    test('normalizeProviderError handles null error gracefully', () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 25 });
      const norm = adapter.normalizeProviderError(null);

      expect(norm.errno).toBe(3210);
      expect(typeof norm.error).toBe('string');
    });
  });

  describe('getCurrentPriceData (automation-cycle interface)', () => {
    test('returns siteId and synthetic Amber-style data', async () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 28, feedInCentsPerKwh: 6 });
      const result = await adapter.getCurrentPriceData({ userId: 'u-1', userConfig: {} });

      expect(result.siteId).toBe('flat-rate');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(2);
    });

    test('data intervals contain current-interval type entries', async () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 28, feedInCentsPerKwh: 6 });
      const { data } = await adapter.getCurrentPriceData({});

      expect(data.every((d) => d.type === 'CurrentInterval')).toBe(true);
    });

    test('buy-only adapter returns only general interval', async () => {
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 30 });
      const { data } = await adapter.getCurrentPriceData({});

      expect(data).toHaveLength(1);
      expect(data[0].channelType).toBe('general');
      expect(data[0].perKwh).toBe(30);
    });

    test('is compatible with pricing-normalization getCurrentAmberPrices', async () => {
      const { getCurrentAmberPrices } = require('../lib/pricing-normalization');
      const adapter = new GenericFlatRateTariffAdapter({ buyCentsPerKwh: 28, feedInCentsPerKwh: 6 });
      const { data } = await adapter.getCurrentPriceData({});

      const prices = getCurrentAmberPrices(data);
      expect(prices.buyPrice).toBe(28);
      expect(prices.feedInPrice).toBe(6);
    });
  });

  describe('adapter registry integration', () => {
    test('can be registered under flat-rate key', () => {
      const registry = createAdapterRegistry();
      const adapter = createFlatRateTariffAdapter({ buyCentsPerKwh: 25, feedInCentsPerKwh: 5 });

      registry.registerTariffProvider('flat-rate', adapter);

      expect(registry.getTariffProvider('flat-rate')).toBe(adapter);
      expect(registry.listTariffProviders()).toContain('flat-rate');
    });

    test('two providers registered through the same contract', () => {
      // This test directly validates G4 exit criterion #1
      const { createAmberTariffAdapter } = require('../lib/adapters/amber-adapter');

      const amberAPI = {
        callAmberAPI: jest.fn(),
        getCachedAmberSites: jest.fn(),
        getCachedAmberPricesCurrent: jest.fn(),
        cacheAmberSites: jest.fn(),
        cacheAmberPricesCurrent: jest.fn()
      };

      const registry = createAdapterRegistry();
      const amber = createAmberTariffAdapter({ amberAPI, amberPricesInFlight: new Map() });
      const flatRate = createFlatRateTariffAdapter({ buyCentsPerKwh: 22, feedInCentsPerKwh: 4 });

      registry.registerTariffProvider('amber', amber);
      registry.registerTariffProvider('flat-rate', flatRate);

      const providers = registry.listTariffProviders();
      expect(providers).toContain('amber');
      expect(providers).toContain('flat-rate');

      // Both pass the same contract validation
      expect(() => validateTariffProviderAdapter(amber)).not.toThrow();
      expect(() => validateTariffProviderAdapter(flatRate)).not.toThrow();

      // Both are selectable at runtime via registry
      expect(registry.getTariffProvider('amber')).toBe(amber);
      expect(registry.getTariffProvider('flat-rate')).toBe(flatRate);
    });
  });
});
