'use strict';

/**
 * Provider Accounts Repository
 *
 * Manages provider account data at the v2 canonical path:
 *   users/{uid}/providerAccounts/{accountId}
 *   users/{uid}/sites/{siteId}
 *
 * Provides dual-read fallback: if no v2 providerAccounts documents exist,
 * derives virtual accounts from the legacy flat config fields
 * (amberApiKey, amberSiteId, foxessToken, deviceSn).
 *
 * Write operations always target the v2 path.
 */

const PROVIDER_TYPES = Object.freeze({
  AMBER: 'amber',
  FOXESS: 'foxess',
  SUNGROW: 'sungrow'
});

function toSafeString(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

function deriveAmberAccountId() {
  return 'amber_default';
}

function deriveFoxessAccountId() {
  return 'foxess_default';
}

function deriveSungrowAccountId() {
  return 'sungrow_default';
}

/**
 * Build a virtual amber providerAccount document from legacy flat config fields.
 * This is a read-only compatibility shim — it carries no Firestore path.
 */
function buildLegacyAmberAccount(userConfig) {
  const amberApiKey = toSafeString(userConfig?.amberApiKey);
  const amberSiteId = toSafeString(userConfig?.amberSiteId);
  if (!amberApiKey) return null;
  return {
    id: deriveAmberAccountId(),
    providerType: PROVIDER_TYPES.AMBER,
    credentials: { apiKey: amberApiKey },
    defaultSiteId: amberSiteId || null,
    _source: 'legacy-config'
  };
}

/**
 * Build a virtual foxess providerAccount document from legacy flat config fields.
 */
function buildLegacyFoxessAccount(userConfig) {
  const foxessToken = toSafeString(userConfig?.foxessToken);
  const deviceSn = toSafeString(userConfig?.deviceSn || userConfig?.deviceSN);
  if (!foxessToken) return null;
  return {
    id: deriveFoxessAccountId(),
    providerType: PROVIDER_TYPES.FOXESS,
    credentials: { token: foxessToken },
    defaultDeviceSn: deviceSn || null,
    _source: 'legacy-config'
  };
}

/**
 * Build a virtual sungrow providerAccount document from legacy flat config fields.
 * Used for users who configured Sungrow before the v2 providerAccounts model was adopted.
 */
function buildLegacySungrowAccount(userConfig) {
  const username = toSafeString(userConfig?.sungrowUsername);
  if (!username) return null;
  return {
    id: deriveSungrowAccountId(),
    providerType: PROVIDER_TYPES.SUNGROW,
    credentials: { username },
    defaultDeviceSn: toSafeString(userConfig?.sungrowDeviceSn) || null,
    _source: 'legacy-config'
  };
}

function createProviderAccountsRepository(deps = {}) {
  const db = deps.db;
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createProviderAccountsRepository requires a Firestore db dependency');
  }

  function userDocRef(userId) {
    return db.collection('users').doc(userId);
  }

  function providerAccountsRef(userId) {
    return userDocRef(userId).collection('providerAccounts');
  }

  function sitesRef(userId) {
    return userDocRef(userId).collection('sites');
  }

  function docDataWithId(doc) {
    if (!doc || !doc.exists) return null;
    return { id: doc.id, ...(doc.data() || {}) };
  }

  /**
   * Read all v2 provider accounts for a user.
   * Returns an empty array if none exist.
   */
  async function getProviderAccounts(userId) {
    try {
      const snapshot = await providerAccountsRef(userId).get();
      const accounts = [];
      (snapshot.docs || []).forEach((doc) => {
        if (doc.exists) accounts.push(docDataWithId(doc));
      });
      return accounts;
    } catch (error) {
      console.error('Error reading providerAccounts:', error);
      return [];
    }
  }

  /**
   * Read a single provider account by its document ID.
   */
  async function getProviderAccountById(userId, accountId) {
    if (!accountId) return null;
    try {
      const doc = await providerAccountsRef(userId).doc(accountId).get();
      return docDataWithId(doc);
    } catch (error) {
      console.error('Error reading providerAccount by id:', error);
      return null;
    }
  }

  /**
   * Return the first provider account matching the given providerType.
   * Searches only v2 documents (no legacy fallback).
   */
  async function getProviderAccountByType(userId, providerType) {
    if (!providerType) return null;
    try {
      const snapshot = await providerAccountsRef(userId)
        .where('providerType', '==', String(providerType).toLowerCase())
        .limit(1)
        .get();
      const docs = snapshot.docs || [];
      if (docs.length === 0) return null;
      return docDataWithId(docs[0]);
    } catch (error) {
      console.error('Error querying providerAccount by type:', error);
      return null;
    }
  }

  /**
   * Write/update a provider account at the v2 canonical path.
   * If accountId is omitted, Firestore auto-generates one.
   * Returns the saved document data including the resolved id.
   */
  async function saveProviderAccount(userId, accountData = {}) {
    const accountId = toSafeString(accountData.id) || null;
    const payload = {
      ...accountData,
      updatedAt: serverTimestamp()
    };
    delete payload.id;

    const ref = accountId
      ? providerAccountsRef(userId).doc(accountId)
      : providerAccountsRef(userId).doc();

    await ref.set(payload, { merge: true });
    return { id: ref.id, ...payload };
  }

  /**
   * Delete a provider account by document ID.
   */
  async function deleteProviderAccount(userId, accountId) {
    if (!accountId) return false;
    try {
      await providerAccountsRef(userId).doc(accountId).delete();
      return true;
    } catch (error) {
      console.error('Error deleting providerAccount:', error);
      return false;
    }
  }

  /**
   * Read all v2 sites for a user.
   */
  async function getSites(userId) {
    try {
      const snapshot = await sitesRef(userId).get();
      const siteList = [];
      (snapshot.docs || []).forEach((doc) => {
        if (doc.exists) siteList.push(docDataWithId(doc));
      });
      return siteList;
    } catch (error) {
      console.error('Error reading sites:', error);
      return [];
    }
  }

  /**
   * Read a single site by document ID.
   */
  async function getSiteById(userId, siteId) {
    if (!siteId) return null;
    try {
      const doc = await sitesRef(userId).doc(siteId).get();
      return docDataWithId(doc);
    } catch (error) {
      console.error('Error reading site by id:', error);
      return null;
    }
  }

  /**
   * Write/update a site at the v2 canonical path.
   */
  async function saveSite(userId, siteId, siteData = {}) {
    const ref = siteId ? sitesRef(userId).doc(siteId) : sitesRef(userId).doc();
    const payload = {
      ...siteData,
      updatedAt: serverTimestamp()
    };
    delete payload.id;
    await ref.set(payload, { merge: true });
    return { id: ref.id, ...payload };
  }

  /**
   * Dual-read: returns v2 providerAccounts if present, otherwise derives virtual
   * account records from legacy flat config fields. Result is always an array
   * (possibly empty) of normalised account objects.
   *
   * This is the primary helper for code that needs to locate the active Amber/FoxESS
   * credentials during an automation cycle.
   */
  async function getProviderAccountsWithLegacyFallback(userId, userConfig) {
    try {
      const v2Accounts = await getProviderAccounts(userId);
      if (v2Accounts.length > 0) {
        return v2Accounts;
      }
    } catch (_err) {
      // fallthrough to legacy
    }

    const legacyAccounts = [];
    const amberAccount = buildLegacyAmberAccount(userConfig);
    if (amberAccount) legacyAccounts.push(amberAccount);
    const foxessAccount = buildLegacyFoxessAccount(userConfig);
    if (foxessAccount) legacyAccounts.push(foxessAccount);
    const sungrowAccount = buildLegacySungrowAccount(userConfig);
    if (sungrowAccount) legacyAccounts.push(sungrowAccount);
    return legacyAccounts;
  }

  /**
   * Convenience helper: return the first amber account from v2 or legacy fallback.
   */
  async function getEffectiveAmberAccount(userId, userConfig) {
    const accounts = await getProviderAccountsWithLegacyFallback(userId, userConfig);
    return accounts.find((a) => a.providerType === PROVIDER_TYPES.AMBER) || null;
  }

  /**
   * Convenience helper: return the first foxess account from v2 or legacy fallback.
   */
  async function getEffectiveFoxessAccount(userId, userConfig) {
    const accounts = await getProviderAccountsWithLegacyFallback(userId, userConfig);
    return accounts.find((a) => a.providerType === PROVIDER_TYPES.FOXESS) || null;
  }

  /**
   * One-shot migration: write legacy flat config fields to the v2 provider accounts
   * collection. Idempotent — if v2 documents already exist, this is a no-op.
   *
   * Returns { migrated: true/false, accounts: [] } where accounts is the final
   * set of v2 documents after the migration attempt.
   */
  async function migrateUserToProviderAccounts(userId, userConfig) {
    try {
      const existingV2 = await getProviderAccounts(userId);
      if (existingV2.length > 0) {
        return { migrated: false, accounts: existingV2 };
      }

      const written = [];
      const amberAccount = buildLegacyAmberAccount(userConfig);
      if (amberAccount) {
        const saved = await saveProviderAccount(userId, {
          id: amberAccount.id,
          providerType: amberAccount.providerType,
          credentials: amberAccount.credentials,
          defaultSiteId: amberAccount.defaultSiteId
        });
        written.push(saved);
      }

      const foxessAccount = buildLegacyFoxessAccount(userConfig);
      if (foxessAccount) {
        const saved = await saveProviderAccount(userId, {
          id: foxessAccount.id,
          providerType: foxessAccount.providerType,
          credentials: foxessAccount.credentials,
          defaultDeviceSn: foxessAccount.defaultDeviceSn
        });
        written.push(saved);
      }

      return { migrated: written.length > 0, accounts: written };
    } catch (error) {
      console.error('Error migrating user to provider accounts:', error);
      return { migrated: false, accounts: [] };
    }
  }

  return {
    deleteProviderAccount,
    getEffectiveAmberAccount,
    getEffectiveFoxessAccount,
    getProviderAccountById,
    getProviderAccountByType,
    getProviderAccounts,
    getProviderAccountsWithLegacyFallback,
    getSiteById,
    getSites,
    migrateUserToProviderAccounts,
    saveProviderAccount,
    saveSite
  };
}

module.exports = {
  PROVIDER_TYPES,
  buildLegacyAmberAccount,
  buildLegacyFoxessAccount,
  buildLegacySungrowAccount,
  createProviderAccountsRepository
};
