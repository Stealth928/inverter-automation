'use strict';

// ---------------------------------------------------------------------------
// Feature Flag Service
// ---------------------------------------------------------------------------
// Firestore-backed lightweight feature-flag system.
//
// Data model:
//   featureFlags/{flagName}                 — flag definition
//   featureFlags/{flagName}/cohorts/{cohortId} — user cohort lists
//
// Flag document shape:
//   {
//     enabled: boolean,         // global on/off
//     rolloutPct: number,       // 0-100 percentage rollout (hash-based)
//     allowlist: string[],      // explicit user IDs always included
//     denylist: string[],       // explicit user IDs always excluded
//     description: string,
//     updatedAt: Timestamp
//   }
//
// Evaluation order (first match wins):
//   1. denylist  → false
//   2. allowlist → true
//   3. !enabled  → false
//   4. rolloutPct === 100 → true
//   5. rolloutPct === 0   → false
//   6. deterministic hash(userId + flagName) % 100 < rolloutPct → true
// ---------------------------------------------------------------------------

// Simple deterministic hash: djb2 variant suitable for cohort assignment.
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Unsigned 32-bit so result is always non-negative
  return hash >>> 0;
}

function isUserInRollout(userId, flagName, rolloutPct) {
  if (rolloutPct >= 100) return true;
  if (rolloutPct <= 0) return false;
  const bucket = hashString(`${userId}:${flagName}`) % 100;
  return bucket < rolloutPct;
}

function createFeatureFlagService(deps = {}) {
  const db = deps.db;
  const logger = deps.logger || { debug: () => {}, warn: () => {} };
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createFeatureFlagService requires a Firestore db dependency');
  }

  function flagRef(flagName) {
    return db.collection('featureFlags').doc(String(flagName));
  }

  // ---------------------------------------------------------------------------
  // Flag management
  // ---------------------------------------------------------------------------

  /**
   * Create or replace a feature flag definition.
   * @param {string} flagName
   * @param {object} definition - { enabled, rolloutPct?, allowlist?, denylist?, description? }
   * @returns {Promise<void>}
   */
  async function setFlag(flagName, definition) {
    const {
      enabled = false,
      rolloutPct = 0,
      allowlist = [],
      denylist = [],
      description = ''
    } = definition;

    await flagRef(flagName).set({
      enabled: Boolean(enabled),
      rolloutPct: Math.min(100, Math.max(0, Number(rolloutPct) || 0)),
      allowlist: Array.isArray(allowlist) ? allowlist : [],
      denylist: Array.isArray(denylist) ? denylist : [],
      description: String(description),
      updatedAt: serverTimestamp()
    });
    logger.debug('FeatureFlags', `setFlag: ${flagName} enabled=${enabled} rollout=${rolloutPct}%`);
  }

  /**
   * Retrieve a flag definition document.
   * @param {string} flagName
   * @returns {Promise<object|null>}
   */
  async function getFlag(flagName) {
    const doc = await flagRef(flagName).get();
    if (!doc.exists) return null;
    return { flagName, ...doc.data() };
  }

  /**
   * List all defined feature flags.
   * @returns {Promise<object[]>}
   */
  async function listFlags() {
    const snapshot = await db.collection('featureFlags').get();
    const flags = [];
    snapshot.forEach((doc) => {
      if (doc.exists) flags.push({ flagName: doc.id, ...doc.data() });
    });
    return flags;
  }

  /**
   * Delete a flag definition.
   * @param {string} flagName
   * @returns {Promise<void>}
   */
  async function deleteFlag(flagName) {
    await flagRef(flagName).delete();
  }

  // ---------------------------------------------------------------------------
  // Flag evaluation
  // ---------------------------------------------------------------------------

  /**
   * Evaluate whether a feature flag is enabled for a given user.
   * Returns false for unknown flags (safe default).
   *
   * @param {string} userId - The user ID to evaluate against.
   * @param {string} flagName - The flag to evaluate.
   * @returns {Promise<boolean>}
   */
  async function isEnabled(userId, flagName) {
    const doc = await flagRef(flagName).get();
    if (!doc.exists) {
      logger.debug('FeatureFlags', `isEnabled: flag ${flagName} not found → false`);
      return false;
    }

    const {
      enabled = false,
      rolloutPct = 0,
      allowlist = [],
      denylist = []
    } = doc.data();

    const uid = String(userId || '');

    // Denylist takes priority
    if (Array.isArray(denylist) && denylist.includes(uid)) {
      return false;
    }

    // Allowlist overrides general enabled/rollout
    if (Array.isArray(allowlist) && allowlist.includes(uid)) {
      return true;
    }

    if (!enabled) {
      return false;
    }

    return isUserInRollout(uid, flagName, Number(rolloutPct) || 0);
  }

  /**
   * Evaluate a flag synchronously from a pre-fetched definition object.
   * Useful for batched flag checks where the definition was loaded once.
   *
   * @param {string} userId
   * @param {string} flagName
   * @param {object|null} definition - Output of getFlag(), or null.
   * @returns {boolean}
   */
  function isEnabledSync(userId, flagName, definition) {
    if (!definition) return false;

    const {
      enabled = false,
      rolloutPct = 0,
      allowlist = [],
      denylist = []
    } = definition;

    const uid = String(userId || '');

    if (Array.isArray(denylist) && denylist.includes(uid)) return false;
    if (Array.isArray(allowlist) && allowlist.includes(uid)) return true;
    if (!enabled) return false;
    return isUserInRollout(uid, flagName, Number(rolloutPct) || 0);
  }

  return {
    setFlag,
    getFlag,
    listFlags,
    deleteFlag,
    isEnabled,
    isEnabledSync
  };
}

// Export helpers for testing
module.exports = {
  createFeatureFlagService,
  isUserInRollout,
  hashString
};
