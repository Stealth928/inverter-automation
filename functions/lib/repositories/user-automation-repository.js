'use strict';

function createUserAutomationRepository(deps = {}) {
  const db = deps.db;
  const logger = deps.logger || { debug: () => {} };
  const serverTimestamp = deps.serverTimestamp || (() => new Date());

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createUserAutomationRepository requires a Firestore db dependency');
  }

  function getUserDocRef(userId) {
    return db.collection('users').doc(userId);
  }

  function forEachSnapshotDoc(snapshot, callback) {
    if (!snapshot) return;
    if (typeof snapshot.forEach === 'function') {
      snapshot.forEach(callback);
      return;
    }
    if (Array.isArray(snapshot.docs)) {
      snapshot.docs.forEach(callback);
    }
  }

  function getSnapshotSize(snapshot) {
    if (!snapshot) return 0;
    if (Number.isFinite(snapshot.size)) return snapshot.size;
    if (Array.isArray(snapshot.docs)) return snapshot.docs.length;
    return 0;
  }

  async function getUserConfigPublic(userId) {
    try {
      logger.debug('Config', `Loading public config for user: ${userId}`);

      const userRef = getUserDocRef(userId);
      const configDoc = await userRef.collection('config').doc('main').get();

      if (configDoc.exists) {
        const data = configDoc.data() || {};
        logger.debug(
          'Config',
          `Found config at users/${userId}/config/main: { hasDeviceSn: ${!!data.deviceSn}, hasFoxessToken: ${!!data.foxessToken} }`
        );
        return { ...data, _source: 'config-main' };
      }

      // Backward compatibility: older deployments stored credentials directly on users/{uid}.credentials
      const userDoc = await getUserDocRef(userId).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};

        // If the older 'credentials' object exists, map its snake_case fields to the config shape
        if (data.credentials && (data.credentials.device_sn || data.credentials.foxess_token || data.credentials.amber_api_key)) {
          return {
            deviceSn: data.credentials.device_sn || '',
            foxessToken: data.credentials.foxess_token || '',
            amberApiKey: data.credentials.amber_api_key || '',
            // No explicit setupComplete flag in old storage; presence of tokens implies complete.
            setupComplete: !!(data.credentials.device_sn && data.credentials.foxess_token),
            _source: 'legacy-credentials'
          };
        }

        // If top-level config keys exist directly on the user doc, use them too
        if (data.deviceSn || data.foxessToken || data.amberApiKey) {
          return {
            deviceSn: data.deviceSn || '',
            foxessToken: data.foxessToken || '',
            amberApiKey: data.amberApiKey || '',
            setupComplete: !!(data.deviceSn && data.foxessToken),
            _source: 'user-top-level'
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting user public config:', error);
      return null;
    }
  }

  async function getUserConfigWithSecrets(userId) {
    try {
      const publicConfig = await getUserConfigPublic(userId);
      if (!publicConfig) {
        return null;
      }
      if (publicConfig._source !== 'config-main') {
        return publicConfig;
      }

      // Password-like credentials are stored separately so clients cannot read them via Firestore SDK.
      const secretsDoc = await getUserDocRef(userId)
        .collection('secrets')
        .doc('credentials')
        .get()
        .catch(() => ({ exists: false, data: () => ({}) }));
      const secrets = secretsDoc.exists ? (secretsDoc.data() || {}) : {};
      return { ...publicConfig, ...secrets };
    } catch (error) {
      console.error('Error getting user config with secrets:', error);
      return null;
    }
  }

  async function getUserConfig(userId) {
    return getUserConfigWithSecrets(userId);
  }

  async function getUserRules(userId, options = {}) {
    try {
      const enabledOnly = options && options.enabledOnly === true;
      const rulesCollection = getUserDocRef(userId).collection('rules');
      const rulesQuery = enabledOnly && typeof rulesCollection.where === 'function'
        ? rulesCollection.where('enabled', '==', true)
        : rulesCollection;
      const rulesSnapshot = await rulesQuery.get();
      const rules = {};
      forEachSnapshotDoc(rulesSnapshot, (doc) => {
        rules[doc.id] = doc.data();
      });
      return rules;
    } catch (error) {
      console.error('Error getting user rules:', error);
      return {};
    }
  }

  async function addHistoryEntry(userId, entry) {
    try {
      const historyPayload = {
        ...entry,
        timestamp: serverTimestamp()
      };
      const historyCollection = getUserDocRef(userId).collection('history');

      if (typeof historyCollection.add === 'function') {
        await historyCollection.add(historyPayload);
      } else if (typeof historyCollection.doc === 'function') {
        await historyCollection.doc().set(historyPayload);
      } else {
        throw new Error('history collection does not support add() or doc().set()');
      }
      return true;
    } catch (error) {
      console.error('Error adding history entry:', error);
      return false;
    }
  }

  async function setUserConfig(userId, config, options = { merge: true }) {
    await getUserDocRef(userId).collection('config').doc('main').set(config, options);
    return true;
  }

  async function updateUserConfig(userId, updates) {
    await getUserDocRef(userId).collection('config').doc('main').update(updates);
    return true;
  }

  async function getUserRule(userId, ruleId) {
    const ruleDoc = await getUserDocRef(userId).collection('rules').doc(ruleId).get();
    if (!ruleDoc.exists) {
      return null;
    }
    return {
      id: ruleDoc.id,
      data: ruleDoc.data() || {}
    };
  }

  async function setUserRule(userId, ruleId, rule, options) {
    if (options && typeof options === 'object') {
      await getUserDocRef(userId).collection('rules').doc(ruleId).set(rule, options);
    } else {
      await getUserDocRef(userId).collection('rules').doc(ruleId).set(rule);
    }
    return true;
  }

  async function deleteUserRule(userId, ruleId) {
    await getUserDocRef(userId).collection('rules').doc(ruleId).delete();
    return true;
  }

  async function clearRulesLastTriggered(userId) {
    const rulesSnapshot = await getUserDocRef(userId).collection('rules').get();
    const snapshotSize = getSnapshotSize(rulesSnapshot);
    if (!rulesSnapshot || snapshotSize === 0) {
      return 0;
    }

    const batch = db.batch();
    forEachSnapshotDoc(rulesSnapshot, (doc) => {
      batch.update(doc.ref, { lastTriggered: null });
    });
    await batch.commit();
    return snapshotSize;
  }

  async function getHistoryEntries(userId, limit = 50) {
    const parsedLimit = Number(limit);
    const normalizedLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.floor(parsedLimit)
      : 50;
    const historySnapshot = await getUserDocRef(userId)
      .collection('history')
      .orderBy('timestamp', 'desc')
      .limit(normalizedLimit)
      .get();

    const history = [];
    forEachSnapshotDoc(historySnapshot, (doc) => {
      history.push({ id: doc.id, ...(doc.data() || {}) });
    });

    return history;
  }

  return {
    addHistoryEntry,
    clearRulesLastTriggered,
    deleteUserRule,
    getHistoryEntries,
    getUserConfig,
    getUserConfigPublic,
    getUserConfigWithSecrets,
    getUserRule,
    getUserRules,
    setUserConfig,
    setUserRule,
    updateUserConfig
  };
}

module.exports = {
  createUserAutomationRepository
};
