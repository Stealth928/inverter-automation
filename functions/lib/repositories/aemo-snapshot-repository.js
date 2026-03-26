'use strict';

const AEMO_SNAPSHOT_COLLECTION = 'aemoSnapshots';

function normalizeRegionId(regionId) {
  return String(regionId || '').trim().toUpperCase() || null;
}

function createEmptySnapshot(regionId = null) {
  return {
    regionId: normalizeRegionId(regionId),
    data: [],
    metadata: {
      asOf: null,
      forecastHorizonMinutes: 0,
      isForecastComplete: false,
      source: 'aemo'
    }
  };
}

function createAemoSnapshotRepository(deps = {}) {
  const db = deps.db;
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createAemoSnapshotRepository requires a Firestore db dependency');
  }

  function getSnapshotDocRef(regionId) {
    const normalized = normalizeRegionId(regionId);
    if (!normalized) {
      throw new Error('AEMO regionId is required');
    }
    return db.collection(AEMO_SNAPSHOT_COLLECTION).doc(normalized);
  }

  async function getCurrentSnapshot(regionId) {
    const normalized = normalizeRegionId(regionId);
    if (!normalized) {
      return createEmptySnapshot(null);
    }

    const snapshotDoc = await getSnapshotDocRef(normalized).get();
    if (!snapshotDoc.exists) {
      return createEmptySnapshot(normalized);
    }

    const data = snapshotDoc.data() || {};
    return {
      regionId: normalized,
      data: Array.isArray(data.data) ? data.data : [],
      metadata: data.metadata && typeof data.metadata === 'object'
        ? data.metadata
        : createEmptySnapshot(normalized).metadata
    };
  }

  async function saveCurrentSnapshot(snapshot = {}, options = {}) {
    const normalized = normalizeRegionId(snapshot.regionId);
    if (!normalized) {
      throw new Error('AEMO snapshot regionId is required');
    }

    const metadata = snapshot.metadata && typeof snapshot.metadata === 'object'
      ? snapshot.metadata
      : createEmptySnapshot(normalized).metadata;
    const payload = {
      regionId: normalized,
      data: Array.isArray(snapshot.data) ? snapshot.data : [],
      metadata,
      storedAt: serverTimestamp(),
      storedAtIso: String(options.storedAtIso || new Date().toISOString()),
      schedule: {
        cadenceMinutes: Number.isFinite(Number(options.cadenceMinutes))
          ? Number(options.cadenceMinutes)
          : 5,
        lagMinutes: Number.isFinite(Number(options.lagMinutes))
          ? Number(options.lagMinutes)
          : 1,
        source: 'scheduler'
      }
    };

    await getSnapshotDocRef(normalized).set(payload, { merge: true });
    return {
      regionId: normalized,
      data: payload.data,
      metadata: payload.metadata
    };
  }

  return {
    AEMO_SNAPSHOT_COLLECTION,
    createEmptySnapshot,
    getCurrentSnapshot,
    normalizeRegionId,
    saveCurrentSnapshot
  };
}

module.exports = {
  AEMO_SNAPSHOT_COLLECTION,
  createAemoSnapshotRepository,
  createEmptySnapshot,
  normalizeRegionId
};
