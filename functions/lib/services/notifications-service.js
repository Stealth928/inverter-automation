'use strict';

const crypto = require('crypto');

let webPush = null;
try {
  webPush = require('web-push');
} catch (_error) {
  webPush = null;
}

const NOTIFICATION_PREF_DEFAULTS = Object.freeze({
  inboxEnabled: false,
  broadcastsEnabled: false,
  highSignalAutomationEnabled: false,
  curtailmentEnabled: false
});

const NOTIFICATION_SEVERITIES = new Set(['info', 'success', 'warning', 'danger']);
const NOTIFICATION_CHANNELS = new Set(['inbox', 'push']);
const DEFAULT_NOTIFICATION_PAGE_LIMIT = 20;
const MAX_NOTIFICATION_PAGE_LIMIT = 100;
const DEFAULT_NOTIFICATION_RETENTION = 200;
const NOTIFICATION_RUNTIME_DOC_ID = 'state';

function trimString(value) {
  const text = String(value || '').trim();
  return text || '';
}

function toNullableString(value, maxLength = 2000) {
  const text = trimString(value);
  if (!text) return null;
  return text.slice(0, maxLength);
}

function toFiniteMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date && typeof date.getTime === 'function' ? date.getTime() : null;
  }
  if (Number.isFinite(value._seconds)) return value._seconds * 1000;
  if (Number.isFinite(value.seconds)) return value.seconds * 1000;
  return null;
}

function parseBoundedInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeNotificationSeverity(value) {
  const severity = trimString(value).toLowerCase();
  return NOTIFICATION_SEVERITIES.has(severity) ? severity : 'info';
}

function normalizeNotificationChannels(value) {
  const source = Array.isArray(value) ? value : [value];
  const channels = Array.from(new Set(source
    .map((entry) => trimString(entry).toLowerCase())
    .filter((entry) => NOTIFICATION_CHANNELS.has(entry))));
  return channels.length ? channels : ['inbox'];
}

function normalizeNotificationPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    inboxEnabled: source.inboxEnabled === true,
    broadcastsEnabled: source.broadcastsEnabled === true,
    highSignalAutomationEnabled: source.highSignalAutomationEnabled === true,
    curtailmentEnabled: source.curtailmentEnabled === true
  };
}

function buildStableId(input) {
  return crypto
    .createHash('sha256')
    .update(String(input || ''), 'utf8')
    .digest('hex')
    .slice(0, 40);
}

function encodeCursor(payload) {
  try {
    const json = JSON.stringify(payload || {});
    return Buffer.from(json, 'utf8').toString('base64url');
  } catch (_error) {
    return null;
  }
}

function decodeCursor(value) {
  const cursor = trimString(value);
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const createdAtMs = Number(parsed.createdAtMs);
    const id = trimString(parsed.id);
    if (!Number.isFinite(createdAtMs) || !id) return null;
    return { createdAtMs: Math.floor(createdAtMs), id };
  } catch (_error) {
    return null;
  }
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function isEmulatorRuntime() {
  return toBoolean(process.env.FUNCTIONS_EMULATOR, false)
    || Boolean(trimString(process.env.FIREBASE_EMULATOR_HUB))
    || Boolean(trimString(process.env.FIRESTORE_EMULATOR_HOST));
}

function normalizeAudienceShape(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalizeList = (list, max = 500) => {
    const values = Array.isArray(list)
      ? list
      : String(list || '').split(/[\n,]+/);
    const seen = new Set();
    const normalized = [];
    values.forEach((entry) => {
      const uid = trimString(entry);
      if (!uid || seen.has(uid)) return;
      seen.add(uid);
      normalized.push(uid);
    });
    return normalized.slice(0, max);
  };
  const ageRaw = Number(source.minAccountAgeDays);
  return {
    requireTourComplete: source.requireTourComplete !== false,
    requireSetupComplete: source.requireSetupComplete !== false,
    requireAutomationEnabled: source.requireAutomationEnabled === true,
    minAccountAgeDays: Number.isFinite(ageRaw) && ageRaw > 0
      ? Math.min(3650, Math.round(ageRaw))
      : null,
    onlyIncludeUids: normalizeList(source.onlyIncludeUids),
    includeUids: normalizeList(source.includeUids),
    excludeUids: normalizeList(source.excludeUids)
  };
}

function toArrayChunked(values, chunkSize = 300) {
  const rows = Array.isArray(values) ? values : [];
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function isMissingFirestoreIndexError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('index') && message.includes('create');
}

function normalizeNotificationDoc(id, data = {}) {
  return {
    id,
    type: toNullableString(data.type, 80) || 'generic',
    source: toNullableString(data.source, 80) || 'system',
    title: toNullableString(data.title, 160) || '',
    body: toNullableString(data.body, 4000) || '',
    severity: normalizeNotificationSeverity(data.severity),
    deepLink: toNullableString(data.deepLink, 300),
    createdAt: data.createdAt || null,
    createdAtMs: Number.isFinite(Number(data.createdAtMs)) ? Number(data.createdAtMs) : null,
    readAt: data.readAt || null,
    read: data.read === true,
    campaignId: toNullableString(data.campaignId, 120),
    eventKey: toNullableString(data.eventKey, 240)
  };
}

function resolvePreferenceGate(preferences, scope) {
  const normalized = normalizeNotificationPreferences(preferences);
  const key = trimString(scope).toLowerCase();
  if (!key || key === 'all') return true;
  if (key === 'broadcasts') return normalized.broadcastsEnabled === true;
  if (key === 'highsignalautomation' || key === 'high_signal_automation') {
    return normalized.highSignalAutomationEnabled === true;
  }
  if (key === 'curtailment') return normalized.curtailmentEnabled === true;
  return true;
}

function createNotificationsService(deps = {}) {
  const db = deps.db;
  const serverTimestamp = deps.serverTimestamp;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const logger = deps.logger || console;
  const pushConfig = deps.pushConfig && typeof deps.pushConfig === 'object'
    ? deps.pushConfig
    : {};

  if (!db || typeof db.collection !== 'function') {
    throw new Error('createNotificationsService requires Firestore db');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('createNotificationsService requires serverTimestamp()');
  }

  const emulatedRuntime = isEmulatorRuntime();
  let vapidPublicKey = trimString(pushConfig.vapidPublicKey || process.env.WEB_PUSH_VAPID_PUBLIC_KEY);
  let vapidPrivateKey = trimString(pushConfig.vapidPrivateKey || process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  let vapidSubject = trimString(pushConfig.vapidSubject || process.env.WEB_PUSH_VAPID_SUBJECT);

  if (webPush && emulatedRuntime && (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)) {
    try {
      const generated = typeof webPush.generateVAPIDKeys === 'function'
        ? webPush.generateVAPIDKeys()
        : null;
      vapidPublicKey = vapidPublicKey || trimString(generated?.publicKey);
      vapidPrivateKey = vapidPrivateKey || trimString(generated?.privateKey);
      vapidSubject = vapidSubject || 'mailto:emulator-notifications@local.invalid';
      if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
        logger.info('[Notifications] Using generated VAPID keys for emulator runtime');
      }
    } catch (error) {
      logger.warn('[Notifications] Failed to generate emulator VAPID keys:', error?.message || error);
    }
  }

  const pushSupported = Boolean(webPush && vapidPublicKey && vapidPrivateKey && vapidSubject);

  if (pushSupported) {
    try {
      webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    } catch (error) {
      logger.warn('[Notifications] Failed to configure web-push VAPID details:', error?.message || error);
    }
  }

  function userDocRef(userId) {
    return db.collection('users').doc(userId);
  }

  function userConfigDocRef(userId) {
    return userDocRef(userId).collection('config').doc('main');
  }

  function userNotificationsRef(userId) {
    return userDocRef(userId).collection('notifications');
  }

  function userPushSubscriptionsRef(userId) {
    return userDocRef(userId).collection('pushSubscriptions');
  }

  function userRuntimeRef(userId) {
    return userDocRef(userId).collection('notificationRuntime').doc(NOTIFICATION_RUNTIME_DOC_ID);
  }

  function notificationCampaignsRef() {
    return db.collection('notificationCampaigns');
  }

  async function readUserConfig(userId) {
    const snapshot = await userConfigDocRef(userId).get();
    return snapshot.exists ? (snapshot.data() || {}) : {};
  }

  async function readUserPreferences(userId) {
    const userConfig = await readUserConfig(userId);
    return normalizeNotificationPreferences(userConfig.notificationPreferences);
  }

  async function saveUserPreferences(userId, preferencesInput) {
    const notificationPreferences = normalizeNotificationPreferences(preferencesInput);
    await userConfigDocRef(userId).set({
      notificationPreferences,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return notificationPreferences;
  }

  async function countUnreadNotifications(userId) {
    try {
      const aggregate = await userNotificationsRef(userId)
        .where('read', '==', false)
        .count()
        .get();
      return Number(aggregate?.data()?.count || 0);
    } catch (_error) {
      const fallback = await userNotificationsRef(userId)
        .where('read', '==', false)
        .limit(300)
        .get();
      return Number(fallback?.size || 0);
    }
  }

  async function listNotifications(userId, options = {}) {
    const limit = parseBoundedInt(
      options.limit,
      DEFAULT_NOTIFICATION_PAGE_LIMIT,
      { min: 1, max: MAX_NOTIFICATION_PAGE_LIMIT }
    );
    const unreadOnly = toBoolean(options.unreadOnly, false);
    const cursor = decodeCursor(options.cursor);

    let query = userNotificationsRef(userId)
      .orderBy('createdAtMs', 'desc');

    if (!unreadOnly) {
      if (cursor) {
        query = query.startAfter(cursor.createdAtMs);
      }
      const snapshot = await query.limit(limit + 1).get();
      const docs = snapshot.docs || [];
      const hasMore = docs.length > limit;
      const visibleDocs = hasMore ? docs.slice(0, limit) : docs;
      const notifications = visibleDocs.map((doc) => normalizeNotificationDoc(doc.id, doc.data() || {}));
      const nextCursor = hasMore
        ? encodeCursor({
            createdAtMs: Number(visibleDocs[visibleDocs.length - 1].data()?.createdAtMs || 0),
            id: visibleDocs[visibleDocs.length - 1].id
          })
        : null;

      return {
        notifications,
        unreadCount: await countUnreadNotifications(userId),
        nextCursor,
        limit
      };
    }

    // unreadOnly=true can require a composite index with orderBy in some projects.
    // Prefer index-backed query, then gracefully fall back to in-memory filter.
    let unreadDocs = [];
    try {
      let unreadQuery = userNotificationsRef(userId)
        .where('read', '==', false)
        .orderBy('createdAtMs', 'desc');
      if (cursor) {
        unreadQuery = unreadQuery.startAfter(cursor.createdAtMs);
      }
      const unreadSnapshot = await unreadQuery.limit(limit + 1).get();
      unreadDocs = unreadSnapshot.docs || [];
    } catch (error) {
      if (!isMissingFirestoreIndexError(error)) {
        throw error;
      }
      const fallbackPageLimit = Math.max(limit * 4, 60);
      const fallbackSnapshot = await query.limit(fallbackPageLimit).get();
      unreadDocs = (fallbackSnapshot.docs || []).filter((doc) => doc.data()?.read !== true);
    }

    const hasMore = unreadDocs.length > limit;
    const visibleDocs = hasMore ? unreadDocs.slice(0, limit) : unreadDocs;
    const notifications = visibleDocs.map((doc) => normalizeNotificationDoc(doc.id, doc.data() || {}));
    const nextCursor = hasMore
      ? encodeCursor({
          createdAtMs: Number(visibleDocs[visibleDocs.length - 1].data()?.createdAtMs || 0),
          id: visibleDocs[visibleDocs.length - 1].id
        })
      : null;

    return {
      notifications,
      unreadCount: await countUnreadNotifications(userId),
      nextCursor,
      limit
    };
  }

  async function listActiveSubscriptions(userId) {
    const snapshot = await userPushSubscriptionsRef(userId)
      .where('active', '==', true)
      .limit(50)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() || {})
    })).sort((left, right) => Number(right.lastSeenAtMs || 0) - Number(left.lastSeenAtMs || 0));
  }

  async function getBootstrap(userId) {
    const [preferences, subscriptions, unreadCount] = await Promise.all([
      readUserPreferences(userId),
      listActiveSubscriptions(userId),
      countUnreadNotifications(userId)
    ]);

    return {
      preferences,
      unreadCount,
      push: {
        configured: pushSupported,
        vapidPublicKey: pushSupported ? vapidPublicKey : null
      },
      subscriptions: subscriptions.map((entry) => ({
        id: entry.id,
        endpoint: toNullableString(entry.endpoint, 1200),
        active: entry.active === true,
        isStandalone: entry.isStandalone === true,
        createdAt: entry.createdAt || null,
        lastSeenAt: entry.lastSeenAt || null,
        userAgentMeta: entry.userAgentMeta && typeof entry.userAgentMeta === 'object'
          ? entry.userAgentMeta
          : null
      }))
    };
  }

  function normalizePushSubscriptionInput(input) {
    const source = input && typeof input === 'object' ? input : {};
    const endpoint = toNullableString(source.endpoint, 2000);
    const p256dh = toNullableString(source?.keys?.p256dh, 1000);
    const auth = toNullableString(source?.keys?.auth, 1000);
    if (!endpoint || !p256dh || !auth) {
      const error = new Error('Push subscription requires endpoint, p256dh, and auth keys');
      error.statusCode = 400;
      throw error;
    }

    const userAgentMeta = source.userAgentMeta && typeof source.userAgentMeta === 'object'
      ? source.userAgentMeta
      : null;

    return {
      endpoint,
      keys: { p256dh, auth },
      userAgentMeta,
      isStandalone: source.isStandalone === true
    };
  }

  async function upsertSubscription(userId, payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const subscription = normalizePushSubscriptionInput(source.subscription || source);
    const subscriptionId = buildStableId(subscription.endpoint);
    const docRef = userPushSubscriptionsRef(userId).doc(subscriptionId);
    const existing = await docRef.get();
    const nowMs = now();

    const updatePayload = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgentMeta: subscription.userAgentMeta,
      isStandalone: subscription.isStandalone === true,
      active: true,
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      lastSeenAtMs: nowMs
    };

    if (!existing.exists) {
      updatePayload.createdAt = serverTimestamp();
      updatePayload.createdAtMs = nowMs;
    }

    await docRef.set(updatePayload, { merge: true });
    return { subscriptionId, active: true };
  }

  async function deactivateSubscription(userId, subscriptionIdInput) {
    const subscriptionId = trimString(subscriptionIdInput);
    if (!subscriptionId) {
      const error = new Error('Subscription ID is required');
      error.statusCode = 400;
      throw error;
    }
    await userPushSubscriptionsRef(userId).doc(subscriptionId).set({
      active: false,
      updatedAt: serverTimestamp(),
      deactivatedAt: serverTimestamp(),
      deactivatedAtMs: now()
    }, { merge: true });
    return { subscriptionId, active: false };
  }

  async function markRead(userId, payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const markAsRead = source.read !== false;
    const markAll = source.all === true;
    const ids = Array.isArray(source.ids)
      ? source.ids.map((value) => trimString(value)).filter(Boolean).slice(0, 300)
      : [];

    let targets = [];
    if (markAll) {
      const query = userNotificationsRef(userId)
        .where('read', '==', markAsRead ? false : true)
        .limit(300);
      const snapshot = await query.get();
      targets = snapshot.docs.map((doc) => doc.id);
    } else {
      targets = ids;
    }

    if (!targets.length) {
      return { updatedCount: 0 };
    }

    const batch = db.batch();
    targets.forEach((id) => {
      const patch = markAsRead
        ? { read: true, readAt: serverTimestamp(), updatedAt: serverTimestamp() }
        : { read: false, readAt: null, updatedAt: serverTimestamp() };
      batch.set(userNotificationsRef(userId).doc(id), patch, { merge: true });
    });
    await batch.commit();
    return { updatedCount: targets.length };
  }

  function normalizeNotificationInput(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const title = toNullableString(source.title, 160) || '';
    const body = toNullableString(source.body, 4000) || '';
    if (!title && !body) {
      const error = new Error('Notification title or body is required');
      error.statusCode = 400;
      throw error;
    }
    return {
      type: toNullableString(source.type, 80) || 'generic',
      source: toNullableString(source.source, 80) || 'system',
      title,
      body,
      severity: normalizeNotificationSeverity(source.severity),
      deepLink: toNullableString(source.deepLink, 300),
      campaignId: toNullableString(source.campaignId, 120),
      eventKey: toNullableString(source.eventKey, 240)
    };
  }

  async function pruneNotificationBacklog(userId, keepMax = DEFAULT_NOTIFICATION_RETENTION) {
    const safeKeep = parseBoundedInt(keepMax, DEFAULT_NOTIFICATION_RETENTION, { min: 20, max: 2000 });
    const maxDeletePerPass = 250;
    const staleSnapshot = await userNotificationsRef(userId)
      .orderBy('createdAtMs', 'desc')
      .limit(safeKeep + maxDeletePerPass)
      .get();
    if (staleSnapshot.size <= safeKeep) return;
    const staleDocs = staleSnapshot.docs.slice(safeKeep, safeKeep + maxDeletePerPass);
    if (!staleDocs.length) return;
    const batch = db.batch();
    staleDocs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  async function createInboxNotification(userId, notificationInput, options = {}) {
    const notification = normalizeNotificationInput(notificationInput);
    const nowMs = now();
    const ref = userNotificationsRef(userId).doc();
    await ref.set({
      ...notification,
      createdAt: serverTimestamp(),
      createdAtMs: nowMs,
      read: false,
      readAt: null
    });
    if (options.prune !== false) {
      await pruneNotificationBacklog(userId, options.keepMax || DEFAULT_NOTIFICATION_RETENTION);
    }
    return {
      id: ref.id,
      ...notification,
      createdAtMs: nowMs,
      read: false,
      readAt: null
    };
  }

  async function sendPushToUser(userId, notificationPayload, options = {}) {
    const payload = normalizeNotificationInput(notificationPayload);
    const result = {
      attempted: 0,
      success: 0,
      failure: 0,
      pruned: 0,
      skipped: false
    };

    if (!pushSupported || !webPush) {
      result.skipped = true;
      return result;
    }

    const subscriptions = await listActiveSubscriptions(userId);
    if (!subscriptions.length) {
      result.skipped = true;
      return result;
    }

    const serializedPayload = JSON.stringify({
      ...payload,
      notificationId: toNullableString(options.notificationId, 120),
      campaignId: payload.campaignId,
      eventKey: payload.eventKey,
      createdAtMs: now()
    });

    await Promise.all(subscriptions.map(async (entry) => {
      result.attempted += 1;
      try {
        await webPush.sendNotification(
          {
            endpoint: entry.endpoint,
            keys: entry.keys
          },
          serializedPayload,
          { TTL: parseBoundedInt(options.ttlSeconds, 120, { min: 30, max: 86400 }) }
        );
        result.success += 1;
        await userPushSubscriptionsRef(userId).doc(entry.id).set({
          lastSeenAt: serverTimestamp(),
          lastSeenAtMs: now(),
          active: true
        }, { merge: true });
      } catch (error) {
        result.failure += 1;
        const statusCode = Number(error?.statusCode || error?.statusCode || error?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          result.pruned += 1;
          await userPushSubscriptionsRef(userId).doc(entry.id).set({
            active: false,
            updatedAt: serverTimestamp(),
            deactivatedAt: serverTimestamp(),
            deactivatedAtMs: now(),
            lastErrorStatusCode: statusCode
          }, { merge: true });
        }
      }
    }));

    return result;
  }

  async function readAdminConfig() {
    const sharedDoc = await db.collection('shared').doc('serverConfig').get();
    const payload = sharedDoc.exists ? (sharedDoc.data() || {}) : {};
    const source = payload.notifications && typeof payload.notifications === 'object'
      ? payload.notifications
      : {};
    return {
      enabled: source.enabled !== false,
      defaultChannels: normalizeNotificationChannels(source.defaultChannels || ['inbox', 'push']),
      audienceDefaults: normalizeAudienceShape(source.audienceDefaults || {}),
      updatedAt: source.updatedAt || null,
      updatedByUid: toNullableString(source.updatedByUid, 128),
      updatedByEmail: toNullableString(source.updatedByEmail, 240)
    };
  }

  async function saveAdminConfig(configInput, actor = {}) {
    const source = configInput && typeof configInput === 'object' ? configInput : {};
    const normalized = {
      enabled: source.enabled !== false,
      defaultChannels: normalizeNotificationChannels(source.defaultChannels || source.channels || ['inbox', 'push']),
      audienceDefaults: normalizeAudienceShape(source.audienceDefaults || source.audience || {}),
      updatedAt: serverTimestamp(),
      updatedByUid: trimString(actor.uid),
      updatedByEmail: trimString(actor.email)
    };
    await db.collection('shared').doc('serverConfig').set({
      notifications: normalized
    }, { merge: true });
    return readAdminConfig();
  }

  async function resolveBroadcastAudienceUsers(audienceInput) {
    const audience = normalizeAudienceShape(audienceInput);
    const usersSnapshot = await db.collection('users').get();
    if (!usersSnapshot.size) {
      return [];
    }

    const onlyInclude = new Set(audience.onlyIncludeUids || []);
    const include = new Set(audience.includeUids || []);
    const exclude = new Set(audience.excludeUids || []);
    const minAgeDays = Number(audience.minAccountAgeDays || 0);
    const nowMs = now();

    const userProfiles = usersSnapshot.docs.map((doc) => ({
      uid: doc.id,
      ...(doc.data() || {})
    }));

    const initialCandidates = userProfiles.filter((profile) => {
      const uid = profile.uid;
      if (!uid) return false;
      if (exclude.has(uid)) return false;
      if (onlyInclude.size && !onlyInclude.has(uid)) return false;

      if (include.has(uid)) {
        return true;
      }

      if (audience.requireAutomationEnabled && profile.automationEnabled !== true) {
        return false;
      }

      if (minAgeDays > 0) {
        const createdAtMs = toFiniteMillis(profile.createdAt);
        if (!createdAtMs) return false;
        const ageMs = nowMs - createdAtMs;
        if (ageMs < (minAgeDays * 24 * 60 * 60 * 1000)) {
          return false;
        }
      }

      return true;
    });

    if (!initialCandidates.length) return [];

    const configByUid = new Map();
    const uidChunks = toArrayChunked(initialCandidates.map((entry) => entry.uid), 300);
    for (const chunk of uidChunks) {
      const refs = chunk.map((uid) => userConfigDocRef(uid));
      const snapshots = await db.getAll(...refs);
      snapshots.forEach((snap, index) => {
        const uid = chunk[index];
        configByUid.set(uid, snap && snap.exists ? (snap.data() || {}) : {});
      });
    }

    return initialCandidates.filter((profile) => {
      const uid = profile.uid;
      if (include.has(uid)) return true;
      const userConfig = configByUid.get(uid) || {};
      if (audience.requireTourComplete && userConfig.tourComplete !== true) return false;
      if (audience.requireSetupComplete && userConfig.setupComplete !== true) return false;
      return true;
    }).map((profile) => ({
      profile,
      userConfig: configByUid.get(profile.uid) || {}
    }));
  }

  function normalizeBroadcastPayload(payload = {}) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const title = toNullableString(source.title, 160) || '';
    const body = toNullableString(source.body, 4000) || '';
    if (!title && !body) {
      const error = new Error('Broadcast requires a title or body');
      error.statusCode = 400;
      throw error;
    }

    return {
      title,
      body,
      severity: normalizeNotificationSeverity(source.severity),
      deepLink: toNullableString(source.deepLink, 300),
      channels: Array.isArray(source.channels)
        ? normalizeNotificationChannels(source.channels)
        : null,
      audience: source.audience && typeof source.audience === 'object'
        ? source.audience
        : null
    };
  }

  async function sendAdminBroadcast(payloadInput, actor = {}) {
    const payload = normalizeBroadcastPayload(payloadInput);
    const adminConfig = await readAdminConfig();
    if (adminConfig.enabled !== true) {
      const error = new Error('Notifications are disabled by admin policy');
      error.statusCode = 400;
      throw error;
    }
    const channels = payload.channels && payload.channels.length
      ? payload.channels
      : normalizeNotificationChannels(adminConfig.defaultChannels || ['inbox', 'push']);
    const audience = normalizeAudienceShape({
      ...(adminConfig.audienceDefaults || {}),
      ...(payload.audience || {})
    });
    const campaignId = `campaign_${Date.now()}_${buildStableId(Math.random()).slice(0, 8)}`;
    const createdAtMs = now();
    const audienceUsers = await resolveBroadcastAudienceUsers(audience);

    const summary = {
      campaignId,
      targetedUsers: audienceUsers.length,
      inboxCreated: 0,
      pushAttempted: 0,
      pushSuccess: 0,
      pushFailure: 0,
      pushPruned: 0,
      preferenceSkipped: 0
    };

    await notificationCampaignsRef().doc(campaignId).set({
      campaignId,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
      deepLink: payload.deepLink,
      channels,
      audience,
      status: 'sending',
      createdAt: serverTimestamp(),
      createdAtMs,
      createdByUid: trimString(actor.uid),
      createdByEmail: trimString(actor.email),
      targetedUsers: summary.targetedUsers
    }, { merge: true });

    for (const userEntry of audienceUsers) {
      const userId = userEntry.profile.uid;
      const preferences = normalizeNotificationPreferences(userEntry.userConfig.notificationPreferences);
      if (!preferences.broadcastsEnabled) {
        summary.preferenceSkipped += 1;
        continue;
      }

      let inboxRecord = null;
      if (channels.includes('inbox') && preferences.inboxEnabled) {
        inboxRecord = await createInboxNotification(userId, {
          type: 'broadcast',
          source: 'admin',
          title: payload.title,
          body: payload.body,
          severity: payload.severity,
          deepLink: payload.deepLink,
          campaignId,
          eventKey: campaignId
        }, { keepMax: DEFAULT_NOTIFICATION_RETENTION });
        summary.inboxCreated += 1;
      }

      if (channels.includes('push')) {
        const pushResult = await sendPushToUser(userId, {
          type: 'broadcast',
          source: 'admin',
          title: payload.title,
          body: payload.body,
          severity: payload.severity,
          deepLink: payload.deepLink,
          campaignId,
          eventKey: campaignId
        }, {
          notificationId: inboxRecord?.id || null
        });
        summary.pushAttempted += pushResult.attempted;
        summary.pushSuccess += pushResult.success;
        summary.pushFailure += pushResult.failure;
        summary.pushPruned += pushResult.pruned;
      }
    }

    await notificationCampaignsRef().doc(campaignId).set({
      status: 'completed',
      completedAt: serverTimestamp(),
      completedAtMs: now(),
      targetedUsers: summary.targetedUsers,
      inboxCreated: summary.inboxCreated,
      pushAttempted: summary.pushAttempted,
      pushSuccess: summary.pushSuccess,
      pushFailure: summary.pushFailure,
      pushPruned: summary.pushPruned,
      preferenceSkipped: summary.preferenceSkipped
    }, { merge: true });

    return summary;
  }

  async function getOverview(options = {}) {
    const campaignLimit = parseBoundedInt(options.campaignLimit, 20, { min: 1, max: 100 });
    const [config, campaignsSnapshot] = await Promise.all([
      readAdminConfig(),
      notificationCampaignsRef().orderBy('createdAtMs', 'desc').limit(campaignLimit).get()
    ]);

    let activeSubscriptionCount = 0;
    try {
      const aggregate = await db.collectionGroup('pushSubscriptions')
        .where('active', '==', true)
        .count()
        .get();
      activeSubscriptionCount = Number(aggregate?.data()?.count || 0);
    } catch (_error) {
      activeSubscriptionCount = 0;
    }

    return {
      config,
      pushConfigured: pushSupported,
      activeSubscriptionCount,
      campaigns: campaignsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() || {})
      }))
    };
  }

  async function emitEventNotification(userId, eventInput = {}) {
    const event = eventInput && typeof eventInput === 'object' ? eventInput : {};
    const eventType = toNullableString(event.eventType, 80);
    const stateSignature = toNullableString(event.stateSignature, 220);
    if (!eventType || !stateSignature) {
      return { sent: false, reason: 'invalid_event' };
    }

    const userPreferences = await readUserPreferences(userId);
    const preferenceScope = toNullableString(event.preferenceScope, 80);
    if (!resolvePreferenceGate(userPreferences, preferenceScope)) {
      return { sent: false, reason: 'preference_disabled' };
    }

    const cooldownMs = parseBoundedInt(event.cooldownMs, 15 * 60 * 1000, { min: 1000, max: 7 * 24 * 60 * 60 * 1000 });
    const dedupeKey = buildStableId(`${userId}:${eventType}:${stateSignature}`);
    const runtimeDoc = userRuntimeRef(userId);
    const nowMs = now();
    let shouldSend = false;

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(runtimeDoc);
      const runtimeData = snapshot.exists ? (snapshot.data() || {}) : {};
      const events = runtimeData.events && typeof runtimeData.events === 'object'
        ? runtimeData.events
        : {};
      const lastSentAtMs = Number(events?.[dedupeKey]?.lastSentAtMs || 0);
      if (lastSentAtMs && (nowMs - lastSentAtMs) < cooldownMs) {
        shouldSend = false;
        return;
      }
      shouldSend = true;
      tx.set(runtimeDoc, {
        events: {
          [dedupeKey]: {
            eventType,
            stateSignature,
            lastSentAtMs: nowMs,
            cooldownMs,
            updatedAt: serverTimestamp(),
            updatedAtMs: nowMs
          }
        },
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs
      }, { merge: true });
    });

    if (!shouldSend) {
      return { sent: false, reason: 'cooldown' };
    }

    const channels = normalizeNotificationChannels(event.channels || ['inbox', 'push']);
    let inboxRecord = null;
    if (channels.includes('inbox') && userPreferences.inboxEnabled) {
      inboxRecord = await createInboxNotification(userId, {
        type: eventType,
        source: toNullableString(event.source, 80) || 'automation',
        title: toNullableString(event.title, 160) || 'Automation alert',
        body: toNullableString(event.body, 4000) || '',
        severity: normalizeNotificationSeverity(event.severity || 'warning'),
        deepLink: toNullableString(event.deepLink, 300),
        eventKey: `${eventType}:${stateSignature}`
      });
    }

    let pushResult = { attempted: 0, success: 0, failure: 0, pruned: 0, skipped: true };
    if (channels.includes('push')) {
      pushResult = await sendPushToUser(userId, {
        type: eventType,
        source: toNullableString(event.source, 80) || 'automation',
        title: toNullableString(event.title, 160) || 'Automation alert',
        body: toNullableString(event.body, 4000) || '',
        severity: normalizeNotificationSeverity(event.severity || 'warning'),
        deepLink: toNullableString(event.deepLink, 300),
        eventKey: `${eventType}:${stateSignature}`
      }, {
        notificationId: inboxRecord?.id || null
      });
    }

    return {
      sent: Boolean(inboxRecord || pushResult.success || pushResult.attempted),
      notificationId: inboxRecord?.id || null,
      push: pushResult
    };
  }

  return {
    NOTIFICATION_PREF_DEFAULTS,
    normalizeNotificationPreferences,
    getBootstrap,
    listNotifications,
    saveUserPreferences,
    upsertSubscription,
    deactivateSubscription,
    markRead,
    createInboxNotification,
    sendPushToUser,
    emitEventNotification,
    readAdminConfig,
    saveAdminConfig,
    sendAdminBroadcast,
    getOverview,
    normalizeAudienceShape,
    normalizeNotificationChannels
  };
}

module.exports = {
  NOTIFICATION_PREF_DEFAULTS,
  normalizeNotificationPreferences,
  createNotificationsService
};
