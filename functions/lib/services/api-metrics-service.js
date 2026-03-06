'use strict';

function createApiMetricsService(deps = {}) {
  const admin = deps.admin;
  const db = deps.db;
  const defaultTimezone = deps.defaultTimezone || 'Australia/Sydney';
  const serverTimestamp = deps.serverTimestamp || (() => new Date());
  const logger = deps.logger || console;

  if (!admin || typeof admin !== 'object') {
    throw new Error('createApiMetricsService requires Firebase admin');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('createApiMetricsService requires Firestore db');
  }

  function getDateKey(date = new Date(), timezone = defaultTimezone) {
    return date.toLocaleDateString('en-CA', { timeZone: timezone || defaultTimezone });
  }

  function getAusDateKey(date = new Date()) {
    return getDateKey(date, defaultTimezone);
  }

  async function incrementGlobalApiCount(apiType) {
    try {
      const today = getAusDateKey();
      const docRef = db.collection('metrics').doc(today);

      const fieldValue =
        admin && admin.firestore && admin.firestore.FieldValue &&
        typeof admin.firestore.FieldValue.increment === 'function'
          ? admin.firestore.FieldValue.increment(1)
          : 1;

      await docRef.set({
        [apiType]: fieldValue,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error('[Metrics] Failed to increment global count:', error && error.message ? error.message : error);
    }
  }

  async function incrementApiCount(userId, apiType) {
    const today = getAusDateKey();

    if (userId) {
      if (typeof logger.debug === 'function') {
        logger.debug('Metrics', `Incrementing ${apiType} counter for user ${userId} on ${today}`);
      }

      const docRef = db.collection('users').doc(userId).collection('metrics').doc(today);
      try {
        await db.runTransaction(async (transaction) => {
          const doc = await transaction.get(docRef);
          const data = doc.exists ? doc.data() : { foxess: 0, amber: 0, weather: 0 };
          data[apiType] = (data[apiType] || 0) + 1;
          data.updatedAt = serverTimestamp();
          transaction.set(docRef, data, { merge: true });
          console.log(`[Metrics] -> Incremented ${apiType} to ${data[apiType]}`);
        });
      } catch (error) {
        console.error('Error incrementing API count:', error);
      }
    }

    try {
      await incrementGlobalApiCount(apiType);
    } catch (error) {
      console.error('[Metrics] incrementGlobalApiCount error:', error && error.message ? error.message : error);
    }
  }

  return {
    getDateKey,
    getAusDateKey,
    incrementApiCount,
    incrementGlobalApiCount
  };
}

module.exports = {
  createApiMetricsService
};
