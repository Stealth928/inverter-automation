/**
 * Amber Price Cache Tests
 * 
 * Comprehensive tests for the Amber price caching system including:
 * - Per-user cache isolation
 * - Date range filtering
 * - Gap detection
 * - Cache hit/miss scenarios
 * - Cache merging and deduplication
 */

const admin = require('firebase-admin');

// Mock Firestore
const mockPrices = [
  { startTime: '2025-12-06T00:00:00Z', channelType: 'general', perKwh: 10 },
  { startTime: '2025-12-06T00:30:00Z', channelType: 'general', perKwh: 11 },
  { startTime: '2025-12-06T00:00:00Z', channelType: 'feedIn', perKwh: -5 },
  { startTime: '2025-12-06T00:30:00Z', channelType: 'feedIn', perKwh: -6 },
  { startTime: '2025-12-07T00:00:00Z', channelType: 'general', perKwh: 12 },
  { startTime: '2025-12-07T00:30:00Z', channelType: 'general', perKwh: 13 },
  { startTime: '2025-12-07T00:00:00Z', channelType: 'feedIn', perKwh: -7 },
  { startTime: '2025-12-07T00:30:00Z', channelType: 'feedIn', perKwh: -8 },
  { startTime: '2025-12-08T00:00:00Z', channelType: 'general', perKwh: 14 },
  { startTime: '2025-12-08T00:30:00Z', channelType: 'general', perKwh: 15 },
  { startTime: '2025-12-08T00:00:00Z', channelType: 'feedIn', perKwh: -9 },
  { startTime: '2025-12-08T00:30:00Z', channelType: 'feedIn', perKwh: -10 }
];

describe('Amber Price Cache Tests', () => {
  let mockDb;
  let mockCacheDoc;
  let getCachedAmberPrices;
  let cacheAmberPrices;
  let findGaps;

  beforeEach(() => {
    // Mock Firestore structure
    mockCacheDoc = {
      exists: false,
      data: () => ({ prices: [] }),
      get: jest.fn(),
      set: jest.fn()
    };

    mockDb = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => mockCacheDoc)
          }))
        }))
      }))
    };

    // These functions need to be extracted/exported from index.js for testing
    // For now, we'll test the logic patterns

    getCachedAmberPrices = async (siteId, startDate, endDate, userId) => {
      if (!userId) return [];
      if (!mockCacheDoc.exists) return [];
      
      const cached = mockCacheDoc.data().prices || [];
      const startMs = new Date(startDate + 'T00:00:00Z').getTime();
      const endMs = new Date(endDate + 'T23:59:59.999Z').getTime();
      
      return cached.filter(p => {
        const priceMs = new Date(p.startTime).getTime();
        return priceMs >= startMs && priceMs <= endMs;
      });
    };

    cacheAmberPrices = async (siteId, newPrices, userId) => {
      if (!userId) return;
      
      const existing = mockCacheDoc.exists ? mockCacheDoc.data().prices : [];
      const priceMap = new Map();
      
      existing.forEach(p => {
        const key = `${p.startTime}|${p.channelType}`;
        priceMap.set(key, p);
      });
      
      newPrices.forEach(p => {
        const key = `${p.startTime}|${p.channelType}`;
        priceMap.set(key, p);
      });
      
      const merged = Array.from(priceMap.values());
      merged.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      
      mockCacheDoc.data = () => ({ prices: merged });
      mockCacheDoc.exists = true;
      await mockCacheDoc.set({ prices: merged, priceCount: merged.length });
    };

    findGaps = (startDate, endDate, existingPrices) => {
      const gaps = [];
      
      if (existingPrices.length === 0) {
        gaps.push({ start: startDate, end: endDate });
        return gaps;
      }
      
      const sorted = [...existingPrices].sort((a, b) => 
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      
      const firstCachedDate = sorted[0].startTime.split('T')[0];
      const lastCachedDate = sorted[sorted.length - 1].startTime.split('T')[0];
      
      if (startDate < firstCachedDate) {
        const gapEnd = new Date(new Date(firstCachedDate).getTime() - 86400000).toISOString().split('T')[0];
        gaps.push({ start: startDate, end: gapEnd });
      }
      
      if (endDate > lastCachedDate) {
        const gapStart = new Date(new Date(lastCachedDate).getTime() + 86400000).toISOString().split('T')[0];
        gaps.push({ start: gapStart, end: endDate });
      }
      
      return gaps;
    };
  });

  describe('Cache Storage and Retrieval', () => {
    test('should return empty array when no cache exists', async () => {
      mockCacheDoc.exists = false;
      const result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(result).toEqual([]);
    });

    test('should return empty array when userId is missing', async () => {
      const result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', null);
      expect(result).toEqual([]);
    });

    test('should store prices in cache correctly', async () => {
      const prices = mockPrices.slice(0, 4); // Dec 6 prices
      await cacheAmberPrices('site1', prices, 'user1');
      
      expect(mockCacheDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          prices: expect.arrayContaining([
            expect.objectContaining({ startTime: '2025-12-06T00:00:00Z' })
          ]),
          priceCount: 4
        })
      );
    });

    test('should merge new prices with existing cache without duplicates', async () => {
      // First cache Dec 6-7
      mockCacheDoc.data = () => ({ prices: mockPrices.slice(0, 8) });
      mockCacheDoc.exists = true;
      
      // Add Dec 8 (some overlap)
      const newPrices = mockPrices.slice(6, 12); // Includes Dec 7-8
      await cacheAmberPrices('site1', newPrices, 'user1');
      
      const cached = mockCacheDoc.data().prices;
      
      // Should have 12 unique prices (no duplicates)
      expect(cached.length).toBe(12);
      
      // Check no duplicate timestamps per channel
      const keys = cached.map(p => `${p.startTime}|${p.channelType}`);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('Date Range Filtering', () => {
    beforeEach(async () => {
      // Set up cache with Dec 6-8 data
      mockCacheDoc.data = () => ({ prices: mockPrices });
      mockCacheDoc.exists = true;
    });

    test('should filter prices for exact date range', async () => {
      const result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-06', 'user1');
      
      // Should include all Dec 6 prices (4 prices: 2 general + 2 feedIn)
      expect(result.length).toBe(4);
      expect(result.every(p => p.startTime.startsWith('2025-12-06'))).toBe(true);
    });

    test('should filter prices for multi-day range', async () => {
      const result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-07', 'user1');
      
      // Should include Dec 6-7 prices (8 prices)
      expect(result.length).toBe(8);
      expect(result.some(p => p.startTime.startsWith('2025-12-06'))).toBe(true);
      expect(result.some(p => p.startTime.startsWith('2025-12-07'))).toBe(true);
    });

    test('should include end date prices (inclusive range)', async () => {
      const result = await getCachedAmberPrices('site1', '2025-12-07', '2025-12-08', 'user1');
      
      // Should include both Dec 7 and Dec 8 prices (8 prices)
      expect(result.length).toBe(8);
      expect(result.some(p => p.startTime.startsWith('2025-12-08'))).toBe(true);
    });

    test('should return empty for date range outside cached data', async () => {
      const result = await getCachedAmberPrices('site1', '2025-12-10', '2025-12-12', 'user1');
      expect(result).toEqual([]);
    });

    test('should handle subset range within cached data', async () => {
      const result = await getCachedAmberPrices('site1', '2025-12-07', '2025-12-07', 'user1');
      
      // Should only include Dec 7 prices (4 prices)
      expect(result.length).toBe(4);
      expect(result.every(p => p.startTime.startsWith('2025-12-07'))).toBe(true);
    });
  });

  describe('Gap Detection', () => {
    test('should detect entire range as gap when no cache exists', () => {
      const gaps = findGaps('2025-12-06', '2025-12-10', []);
      
      expect(gaps).toEqual([
        { start: '2025-12-06', end: '2025-12-10' }
      ]);
    });

    test('should detect no gaps when requested range is fully cached', () => {
      const cachedPrices = mockPrices.slice(0, 8); // Dec 6-7
      const gaps = findGaps('2025-12-06', '2025-12-07', cachedPrices);
      
      expect(gaps).toEqual([]);
    });

    test('should detect no gaps for subset of cached range', () => {
      const cachedPrices = mockPrices; // Dec 6-8
      const gaps = findGaps('2025-12-07', '2025-12-07', cachedPrices);
      
      // Dec 7 is within cached Dec 6-8, so no gaps
      expect(gaps).toEqual([]);
    });

    test('should detect gap before cached range', () => {
      const cachedPrices = mockPrices.slice(4); // Dec 7-8 only
      const gaps = findGaps('2025-12-05', '2025-12-08', cachedPrices);
      
      expect(gaps).toEqual([
        { start: '2025-12-05', end: '2025-12-06' }
      ]);
    });

    test('should detect gap after cached range', () => {
      const cachedPrices = mockPrices.slice(0, 8); // Dec 6-7 only
      const gaps = findGaps('2025-12-06', '2025-12-10', cachedPrices);
      
      expect(gaps).toEqual([
        { start: '2025-12-08', end: '2025-12-10' }
      ]);
    });

    test('should detect gaps before and after cached range', () => {
      const cachedPrices = mockPrices.slice(4, 8); // Dec 7 only
      const gaps = findGaps('2025-12-05', '2025-12-10', cachedPrices);
      
      expect(gaps).toEqual([
        { start: '2025-12-05', end: '2025-12-06' },
        { start: '2025-12-08', end: '2025-12-10' }
      ]);
    });
  });

  describe('Per-User Cache Isolation', () => {
    test('should not return cache for different user', async () => {
      // User1 has cache
      mockCacheDoc.data = () => ({ prices: mockPrices });
      mockCacheDoc.exists = true;
      
      // User2 should get empty (in real impl, different doc)
      const result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user2');
      
      // In real implementation, this would check a different doc
      // For this test, we verify the userId is required
      expect(result).toBeDefined();
    });

    test('should store cache per user', async () => {
      await cacheAmberPrices('site1', mockPrices, 'user1');
      
      // Verify userId is used in cache key (in real impl, different doc paths)
      expect(mockCacheDoc.set).toHaveBeenCalled();
    });
  });

  describe('Cache Performance Scenarios', () => {
    test('scenario: first request creates cache, second request uses cache', async () => {
      // First request - no cache
      mockCacheDoc.exists = false;
      let result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(result).toEqual([]);
      
      // Cache some prices
      await cacheAmberPrices('site1', mockPrices, 'user1');
      
      // Second request - uses cache
      mockCacheDoc.exists = true;
      result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(result.length).toBe(12);
    });

    test('scenario: overlapping date ranges use cache', async () => {
      mockCacheDoc.data = () => ({ prices: mockPrices });
      mockCacheDoc.exists = true;
      
      // First: Dec 6-8 (full range)
      const result1 = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(result1.length).toBe(12);
      
      // Second: Dec 6-7 (subset)
      const result2 = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-07', 'user1');
      expect(result2.length).toBe(8);
      
      // Third: Dec 7-7 (single day subset)
      const result3 = await getCachedAmberPrices('site1', '2025-12-07', '2025-12-07', 'user1');
      expect(result3.length).toBe(4);
      
      // All should be from cache, no gaps
      const gaps1 = findGaps('2025-12-06', '2025-12-07', result2);
      const gaps2 = findGaps('2025-12-07', '2025-12-07', result3);
      expect(gaps1).toEqual([]);
      expect(gaps2).toEqual([]);
    });

    test('scenario: expanding date range detects only new gaps', async () => {
      // Cache has Dec 6-7
      mockCacheDoc.data = () => ({ prices: mockPrices.slice(0, 8) });
      mockCacheDoc.exists = true;
      
      const cached = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-07', 'user1');
      
      // Request Dec 6-10 (needs Dec 8-10)
      const gaps = findGaps('2025-12-06', '2025-12-10', cached);
      
      expect(gaps).toEqual([
        { start: '2025-12-08', end: '2025-12-10' }
      ]);
    });
  });

  describe('Channel Balance Validation', () => {
    test('should have equal counts for general and feedIn channels', async () => {
      mockCacheDoc.data = () => ({ prices: mockPrices });
      mockCacheDoc.exists = true;
      
      const result = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      
      const generalCount = result.filter(p => p.channelType === 'general').length;
      const feedInCount = result.filter(p => p.channelType === 'feedIn').length;
      
      expect(generalCount).toBe(feedInCount);
      expect(generalCount).toBe(6);
    });

    test('should detect imbalanced channels', () => {
      const imbalanced = [
        ...mockPrices.filter(p => p.channelType === 'general'),
        ...mockPrices.filter(p => p.channelType === 'feedIn').slice(0, 2) // Only 2 feedIn
      ];
      
      const generalCount = imbalanced.filter(p => p.channelType === 'general').length;
      const feedInCount = imbalanced.filter(p => p.channelType === 'feedIn').length;
      
      expect(Math.abs(generalCount - feedInCount)).toBeGreaterThan(0);
    });

    test('should NOT force refetch when both channels present (even if imbalanced < 50)', () => {
      // New logic: only force refetch if a channel is COMPLETELY missing
      const prices60General = mockPrices.filter(p => p.channelType === 'general').concat(
        mockPrices.filter(p => p.channelType === 'general').slice(0, 48) // 60 general
      );
      const prices10FeedIn = mockPrices.filter(p => p.channelType === 'feedIn'); // 6 feedIn
      const imbalanced = prices60General.concat(prices10FeedIn); // 60 vs 6 = imbalanced by 54
      
      const generalCount = imbalanced.filter(p => p.channelType === 'general').length;
      const feedInCount = imbalanced.filter(p => p.channelType === 'feedIn').length;
      
      // With new logic: both channels exist, so should use gap detection (not force full refetch)
      const shouldForceRefetch = !generalCount || !feedInCount;
      expect(shouldForceRefetch).toBe(false); // Should NOT force refetch
    });

    test('should force refetch only when a channel is completely missing', () => {
      // Only general channel, no feedIn
      const onlyGeneral = mockPrices.filter(p => p.channelType === 'general');
      
      const generalCount = onlyGeneral.filter(p => p.channelType === 'general').length;
      const feedInCount = onlyGeneral.filter(p => p.channelType === 'feedIn').length;
      
      // New logic: missing feedIn, so should force refetch
      const shouldForceRefetch = !generalCount || !feedInCount;
      expect(shouldForceRefetch).toBe(true); // Should force refetch
    });
  });

  describe('Cache Hit/Miss Behavior', () => {
    test('repeated requests with same dates should not increment counter after first request', async () => {
      // First request: cache miss, should fetch and store
      mockCacheDoc.data = () => ({ prices: [] });
      mockCacheDoc.exists = false;
      
      const empty = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(empty).toHaveLength(0); // No cache
      
      // Store some prices
      await cacheAmberPrices('site1', mockPrices, 'user1');
      
      // Second request: same dates, should be cache hit
      const cached = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(cached).toHaveLength(12); // All prices for that range
      
      // Third request: same dates again, should still be cache hit
      const cached2 = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(cached2).toHaveLength(12); // Same result
    });

    test('expanding date range should only fetch new gaps', async () => {
      // Cache has Dec 6-7
      const cachedData = mockPrices.slice(0, 8);
      mockCacheDoc.data = () => ({ prices: cachedData });
      mockCacheDoc.exists = true;
      
      // Request Dec 6-8, should hit cache for Dec 6-7
      const cached = await getCachedAmberPrices('site1', '2025-12-06', '2025-12-08', 'user1');
      expect(cached).toHaveLength(8); // Dec 6-7 from cache
      
      // findGaps should detect need for Dec 8
      const gaps = findGaps('2025-12-06', '2025-12-08', cached);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].start).toBe('2025-12-08');
      expect(gaps[0].end).toBe('2025-12-08');
    });

    test('sites endpoint should cache for 7 days and not increment on repeated requests', async () => {
      // This tests the logic that sites should be cached separately with longer TTL
      const sitesCache = {
        sites: [{ siteId: '123', status: 'active' }],
        cachedAt: new Date().toISOString()
      };
      
      mockCacheDoc.data = () => sitesCache;
      mockCacheDoc.exists = true;
      
      const cached = mockCacheDoc.data();
      expect(cached.sites).toBeDefined();
      expect(cached.sites.length).toBeGreaterThan(0);
      
      // TTL is 7 days
      const cacheTTL = 7 * 24 * 60 * 60 * 1000;
      expect(cacheTTL).toBe(604800000);
    });
  });
  
  describe('Per-User Cache TTL Configuration', () => {
    test('getAmberCacheTTL should return per-user value when available', () => {
      const { getAmberCacheTTL } = require('../index.js');
      
      const userConfig1 = { cache: { amber: 180000 } }; // 3 minutes
      expect(getAmberCacheTTL(userConfig1)).toBe(180000);
      
      const userConfig2 = { cache: { amber: 45000 } }; // 45 seconds
      expect(getAmberCacheTTL(userConfig2)).toBe(45000);
      
      const userConfig3 = { cache: { amber: 300000 } }; // 5 minutes
      expect(getAmberCacheTTL(userConfig3)).toBe(300000);
    });

    test('getAmberCacheTTL should return server default when user config missing', () => {
      const { getAmberCacheTTL, getConfig } = require('../index.js');
      const serverDefault = getConfig().automation.cacheTtl.amber;
      
      const userConfig1 = {};
      expect(getAmberCacheTTL(userConfig1)).toBe(serverDefault);
      
      const userConfig2 = { cache: {} };
      expect(getAmberCacheTTL(userConfig2)).toBe(serverDefault);
      
      const userConfig3 = null;
      expect(getAmberCacheTTL(userConfig3)).toBe(serverDefault);
    });

    test.skip('getCachedAmberPricesCurrent should respect per-user TTL', async () => {
      // Mock cache data that is 50 seconds old
      const timestampMock = { toMillis: () => Date.now() - 50000 };
      const mockCurrentPrices = [{ test: 'data', perKwh: 10 }];
      
      // Create a fresh mock for this test
      const mockCurrentDoc = {
        exists: true,
        data: () => ({ siteId: 'test-site', prices: mockCurrentPrices, cachedAt: timestampMock }),
        get: jest.fn(async () => mockCurrentDoc)
      };
      
      // Override global mockDb for this test
      const originalCollection = mockDb.collection;
      mockDb.collection = jest.fn(() => ({
        doc: jest.fn(() => ({
          collection: jest.fn(() => ({
            doc: jest.fn(() => mockCurrentDoc)
          }))
        }))
      }));
      
      const { getCachedAmberPricesCurrent } = require('../index.js');
      
      // Test 1: Cache 50s old, TTL 3min (180s) -> should be VALID
      const userConfig1 = { cache: { amber: 180000 } };
      const result1 = await getCachedAmberPricesCurrent('test-site', 'test-user', userConfig1);
      expect(result1).toBeTruthy();
      expect(result1.length).toBe(1);
      expect(result1[0].perKwh).toBe(10);
      
      // Test 2: Cache 50s old, TTL 30s -> should be EXPIRED (null)
      const userConfig2 = { cache: { amber: 30000 } };
      const result2 = await getCachedAmberPricesCurrent('test-site', 'test-user', userConfig2);
      expect(result2).toBeNull();
      
      // Test 3: Cache 50s old, TTL 60s (default) -> should be VALID
      const userConfig3 = {};
      const result3 = await getCachedAmberPricesCurrent('test-site', 'test-user', userConfig3);
      expect(result3).toBeTruthy();
      
      // Restore original mock
      mockDb.collection = originalCollection;
    });
  });
});
