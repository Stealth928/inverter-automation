'use strict';

const { createCacheMetricsService } = require('../lib/services/cache-metrics-service');

describe('cache metrics service', () => {
  test('aggregates hits, misses, writes, and errors by source', () => {
    const service = createCacheMetricsService({ now: () => 1711324800000 });

    service.record({ source: 'weather', outcome: 'hit' });
    service.record({ source: 'weather', outcome: 'hit' });
    service.record({ source: 'weather', outcome: 'miss' });
    service.record({ source: 'weather', outcome: 'write', operation: 'write' });
    service.record({ source: 'inverter', outcome: 'error' });

    const snapshot = service.getSnapshot();

    expect(snapshot.totals).toEqual({
      reads: 4,
      hits: 2,
      misses: 1,
      errors: 1,
      writes: 1,
      hitRatePct: 50,
      missRatePct: 25
    });
    expect(snapshot.sources).toEqual([
      expect.objectContaining({
        source: 'weather',
        reads: 3,
        hits: 2,
        misses: 1,
        errors: 0,
        writes: 1,
        hitRatePct: 66.7,
        missRatePct: 33.3
      }),
      expect.objectContaining({
        source: 'inverter',
        reads: 1,
        hits: 0,
        misses: 0,
        errors: 1,
        writes: 0,
        hitRatePct: 0,
        missRatePct: 0
      })
    ]);
  });
});
