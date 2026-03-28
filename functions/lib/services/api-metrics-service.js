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
    const resolvedDate = (date instanceof Date) ? date : new Date(date);
    const resolvedTimezone = timezone || defaultTimezone;

    try {
      // Build date keys from typed parts so we never depend on locale separators/order.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: resolvedTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(resolvedDate);

      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch (_error) {
      // Fall through to the UTC fallback below.
    }

    // Last resort: stable UTC ISO date key.
    return resolvedDate.toISOString().slice(0, 10);
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
    const fieldValue =
      admin && admin.firestore && admin.firestore.FieldValue &&
      typeof admin.firestore.FieldValue.increment === 'function'
        ? admin.firestore.FieldValue.increment(1)
        : 1;
    const payload = {
      [apiType]: fieldValue,
      updatedAt: serverTimestamp()
    };

    if (userId) {
      if (typeof logger.debug === 'function') {
        logger.debug('Metrics', `Incrementing ${apiType} counter for user ${userId} on ${today}`);
      }

      const userDocRef = db.collection('users').doc(userId).collection('metrics').doc(today);
      const globalDocRef = db.collection('metrics').doc(today);
      try {
        if (typeof db.batch === 'function') {
          const batch = db.batch();
          batch.set(userDocRef, payload, { merge: true });
          batch.set(globalDocRef, payload, { merge: true });
          await batch.commit();
        } else {
          await Promise.all([
            userDocRef.set(payload, { merge: true }),
            globalDocRef.set(payload, { merge: true })
          ]);
        }
        return;
      } catch (error) {
        console.error('Error incrementing API count:', error);
      }

      return;
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
