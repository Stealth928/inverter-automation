'use strict';

/**
 * Asset Registry Repository
 *
 * Manages physical device asset data at the v2 canonical path:
 *   users/{uid}/assets/{assetId}
 *
 * Provides dual-read fallback: if no v2 asset documents exist,
 * derives virtual asset records from legacy flat config fields
 * (deviceSn, deviceSN) allowing existing users to continue
 * functioning without any manual migration step.
 *
 * Write operations always target the v2 path.
 */

const ASSET_TYPES = Object.freeze({
  FOXESS: 'foxess',
  GENERIC: 'generic'
});

function toSafeString(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

function deriveFoxessAssetId() {
  return 'foxess_device_default';
}

/**
 * Build a virtual asset document from legacy flat config fields.
 * This is a read-only compatibility shim — it carries no Firestore path.
 */
function buildLegacyFoxessAsset(userConfig) {
  const deviceSn = toSafeString(userConfig?.deviceSn || userConfig?.deviceSN);
  const foxessToken = toSafeString(userConfig?.foxessToken);
  if (!deviceSn && !foxessToken) return null;
  return {
    id: deriveFoxessAssetId(),
    assetType: ASSET_TYPES.FOXESS,
    serialNumber: deviceSn || null,
    label: deviceSn ? `FoxESS Inverter (${deviceSn})` : 'FoxESS Inverter',
    _source: 'legacy-config'
  };
}

function createAssetRegistryRepository(deps = {}) {
  const db = deps.db;
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createAssetRegistryRepository requires a Firestore db dependency');
  }

  function assetsRef(userId) {
    return db.collection('users').doc(userId).collection('assets');
  }

  function docDataWithId(doc) {
    if (!doc || !doc.exists) return null;
    return { id: doc.id, ...(doc.data() || {}) };
  }

  /**
   * Read all v2 assets for a user.
   * Returns an empty array if none exist.
   */
  async function getAssets(userId) {
    try {
      const snapshot = await assetsRef(userId).get();
      const results = [];
      (snapshot.docs || []).forEach((doc) => {
        if (doc.exists) results.push(docDataWithId(doc));
      });
      return results;
    } catch (error) {
      console.error('Error reading assets:', error);
      return [];
    }
  }

  /**
   * Read a single asset by its document ID.
   */
  async function getAssetById(userId, assetId) {
    if (!assetId) return null;
    try {
      const doc = await assetsRef(userId).doc(assetId).get();
      return docDataWithId(doc);
    } catch (error) {
      console.error('Error reading asset by id:', error);
      return null;
    }
  }

  /**
   * Return all assets matching the given assetType.
   */
  async function getAssetsByType(userId, assetType) {
    if (!assetType) return [];
    try {
      const snapshot = await assetsRef(userId)
        .where('assetType', '==', String(assetType).toLowerCase())
        .get();
      return (snapshot.docs || [])
        .filter((d) => d.exists)
        .map(docDataWithId);
    } catch (error) {
      console.error('Error querying assets by type:', error);
      return [];
    }
  }

  /**
   * Write/update an asset at the v2 canonical path.
   * If assetId is omitted, Firestore auto-generates one.
   * Returns the saved document data including the resolved id.
   */
  async function saveAsset(userId, assetData = {}) {
    const assetId = toSafeString(assetData.id) || null;
    const payload = {
      ...assetData,
      updatedAt: serverTimestamp()
    };
    delete payload.id;

    const ref = assetId
      ? assetsRef(userId).doc(assetId)
      : assetsRef(userId).doc();

    await ref.set(payload, { merge: true });
    return { id: ref.id, ...payload };
  }

  /**
   * Delete an asset by document ID.
   */
  async function deleteAsset(userId, assetId) {
    if (!assetId) return false;
    try {
      await assetsRef(userId).doc(assetId).delete();
      return true;
    } catch (error) {
      console.error('Error deleting asset:', error);
      return false;
    }
  }

  /**
   * Dual-read: returns v2 assets if present, otherwise derives virtual asset
   * records from legacy flat config fields. Result is always an array
   * (possibly empty) of normalised asset objects.
   *
   * This is the primary helper for code that needs to locate the active device
   * assets during an automation cycle without requiring migration.
   */
  async function getAssetsWithLegacyFallback(userId, userConfig) {
    try {
      const v2Assets = await getAssets(userId);
      if (v2Assets.length > 0) {
        return v2Assets;
      }
    } catch (_err) {
      // fallthrough to legacy
    }

    const legacyAssets = [];
    const foxessAsset = buildLegacyFoxessAsset(userConfig);
    if (foxessAsset) legacyAssets.push(foxessAsset);
    return legacyAssets;
  }

  /**
   * Convenience helper: return the first FoxESS asset from v2 or legacy fallback.
   */
  async function getEffectiveFoxessAsset(userId, userConfig) {
    const assets = await getAssetsWithLegacyFallback(userId, userConfig);
    return assets.find((a) => a.assetType === ASSET_TYPES.FOXESS) || null;
  }

  /**
   * One-shot migration: write legacy flat config fields to the v2 assets collection.
   * Idempotent — if v2 documents already exist, this is a no-op.
   *
   * Returns { migrated: true/false, assets: [] } where assets is the final
   * set of v2 documents after the migration attempt.
   */
  async function migrateUserToAssets(userId, userConfig) {
    try {
      const existingV2 = await getAssets(userId);
      if (existingV2.length > 0) {
        return { migrated: false, assets: existingV2 };
      }

      const written = [];
      const foxessAsset = buildLegacyFoxessAsset(userConfig);
      if (foxessAsset) {
        const saved = await saveAsset(userId, {
          id: foxessAsset.id,
          assetType: foxessAsset.assetType,
          serialNumber: foxessAsset.serialNumber,
          label: foxessAsset.label
        });
        written.push(saved);
      }

      return { migrated: written.length > 0, assets: written };
    } catch (error) {
      console.error('Error migrating user to assets:', error);
      return { migrated: false, assets: [] };
    }
  }

  return {
    deleteAsset,
    getAssetById,
    getAssets,
    getAssetsByType,
    getAssetsWithLegacyFallback,
    getEffectiveFoxessAsset,
    migrateUserToAssets,
    saveAsset
  };
}

module.exports = {
  ASSET_TYPES,
  buildLegacyFoxessAsset,
  createAssetRegistryRepository
};
