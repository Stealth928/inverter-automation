'use strict';

function createCacheMetricsService(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const startedAtMs = now();
  const sourceStats = new Map();

  function normalizeSource(source) {
    const normalized = String(source || '').trim().toLowerCase();
    return normalized || 'unknown';
  }

  function normalizeOutcome(outcome) {
    const normalized = String(outcome || '').trim().toLowerCase();
    if (normalized === 'hit' || normalized === 'miss' || normalized === 'write' || normalized === 'error') {
      return normalized;
    }
    return 'error';
  }

  function getSourceStat(source) {
    const normalizedSource = normalizeSource(source);
    if (!sourceStats.has(normalizedSource)) {
      sourceStats.set(normalizedSource, {
        source: normalizedSource,
        errors: 0,
        hits: 0,
        lastSeenAtMs: null,
        misses: 0,
        reads: 0,
        writes: 0
      });
    }
    return sourceStats.get(normalizedSource);
  }

  function record(event = {}) {
    const source = normalizeSource(event.source);
    const outcome = normalizeOutcome(event.outcome);
    const operation = String(event.operation || (outcome === 'write' ? 'write' : 'read')).trim().toLowerCase();
    const stat = getSourceStat(source);
    stat.lastSeenAtMs = now();

    if (operation === 'write' || outcome === 'write') {
      stat.writes += 1;
      return;
    }

    stat.reads += 1;
    if (outcome === 'hit') {
      stat.hits += 1;
      return;
    }
    if (outcome === 'miss') {
      stat.misses += 1;
      return;
    }
    stat.errors += 1;
  }

  function buildSourceSnapshot(stat) {
    const reads = Number(stat.reads || 0);
    const hits = Number(stat.hits || 0);
    const misses = Number(stat.misses || 0);
    const errors = Number(stat.errors || 0);
    const writes = Number(stat.writes || 0);
    return {
      source: stat.source,
      reads,
      hits,
      misses,
      errors,
      writes,
      hitRatePct: reads > 0 ? Number(((hits / reads) * 100).toFixed(1)) : null,
      missRatePct: reads > 0 ? Number(((misses / reads) * 100).toFixed(1)) : null,
      lastSeenAtMs: stat.lastSeenAtMs
    };
  }

  function getSnapshot() {
    const sources = Array.from(sourceStats.values())
      .map(buildSourceSnapshot)
      .sort((a, b) => {
        const readDelta = (b.reads + b.writes) - (a.reads + a.writes);
        if (readDelta !== 0) return readDelta;
        return a.source.localeCompare(b.source);
      });

    const totals = sources.reduce((acc, entry) => ({
      reads: acc.reads + entry.reads,
      hits: acc.hits + entry.hits,
      misses: acc.misses + entry.misses,
      errors: acc.errors + entry.errors,
      writes: acc.writes + entry.writes
    }), {
      reads: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      writes: 0
    });

    return {
      startedAtMs,
      totals: {
        ...totals,
        hitRatePct: totals.reads > 0 ? Number(((totals.hits / totals.reads) * 100).toFixed(1)) : null,
        missRatePct: totals.reads > 0 ? Number(((totals.misses / totals.reads) * 100).toFixed(1)) : null
      },
      sources
    };
  }

  function reset() {
    sourceStats.clear();
  }

  return {
    getSnapshot,
    record,
    reset
  };
}

module.exports = {
  createCacheMetricsService
};