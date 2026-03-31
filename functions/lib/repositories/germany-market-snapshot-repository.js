'use strict';

const { DEFAULT_GERMANY_MARKET_ID } = require('../pricing-market');

const GERMANY_MARKET_SNAPSHOT_COLLECTION = 'germanyMarketSnapshots';

function normalizeMarketId(marketId) {
  const normalized = String(marketId || DEFAULT_GERMANY_MARKET_ID).trim().toUpperCase();
  if (normalized === 'GERMANY') {
    return DEFAULT_GERMANY_MARKET_ID;
  }
  return normalized || DEFAULT_GERMANY_MARKET_ID;
}

function createEmptySnapshot(marketId = DEFAULT_GERMANY_MARKET_ID) {
  return {
    marketId: normalizeMarketId(marketId),
    data: [],
    metadata: {
      asOf: null,
      forecastHorizonMinutes: 0,
      isForecastComplete: false,
      source: 'entsoe'
    }
  };
}

function createGermanyMarketSnapshotRepository(deps = {}) {
  const db = deps.db;
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createGermanyMarketSnapshotRepository requires a Firestore db dependency');
  }

  function getSnapshotDocRef(marketId) {
    const normalized = normalizeMarketId(marketId);
    return db.collection(GERMANY_MARKET_SNAPSHOT_COLLECTION).doc(normalized);
  }

  async function getCurrentSnapshot(marketId) {
    const normalized = normalizeMarketId(marketId);
    const snapshotDoc = await getSnapshotDocRef(normalized).get();
    if (!snapshotDoc.exists) {
      return createEmptySnapshot(normalized);
    }

    const data = snapshotDoc.data() || {};
    return {
      marketId: normalized,
      data: Array.isArray(data.data) ? data.data : [],
      metadata: data.metadata && typeof data.metadata === 'object'
        ? data.metadata
        : createEmptySnapshot(normalized).metadata
    };
  }

  async function saveCurrentSnapshot(snapshot = {}, options = {}) {
    const normalized = normalizeMarketId(snapshot.marketId);
    const metadata = snapshot.metadata && typeof snapshot.metadata === 'object'
      ? snapshot.metadata
      : createEmptySnapshot(normalized).metadata;
    const payload = {
      marketId: normalized,
      data: Array.isArray(snapshot.data) ? snapshot.data : [],
      metadata,
      storedAt: serverTimestamp(),
      storedAtIso: String(options.storedAtIso || new Date().toISOString()),
      schedule: {
        cadenceMinutes: Number.isFinite(Number(options.cadenceMinutes))
          ? Number(options.cadenceMinutes)
          : 15,
        lagMinutes: Number.isFinite(Number(options.lagMinutes))
          ? Number(options.lagMinutes)
          : 5,
        source: 'scheduler'
      }
    };

    await getSnapshotDocRef(normalized).set(payload, { merge: true });
    return {
      marketId: normalized,
      data: payload.data,
      metadata: payload.metadata
    };
  }

  return {
    GERMANY_MARKET_SNAPSHOT_COLLECTION,
    createEmptySnapshot,
    getCurrentSnapshot,
    normalizeMarketId,
    saveCurrentSnapshot
  };
}

module.exports = {
  GERMANY_MARKET_SNAPSHOT_COLLECTION,
  createGermanyMarketSnapshotRepository,
  createEmptySnapshot,
  normalizeMarketId
};