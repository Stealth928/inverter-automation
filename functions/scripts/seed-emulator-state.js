// seed-emulator-state.js
// Seeds Auth/Firestore emulators with deterministic local test admins across inverter providers.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node seed-emulator-state.js

const admin = require('firebase-admin');
const {
  TEST_USERS,
  TEST_USER,
  TEST_CONFIG,
  getProjectId,
  assertEmulatorEnvironment
} = require('./emulator-test-user');

const METRICS_TIMEZONE = 'Australia/Sydney';

async function getUserByUidOrNull(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
}

async function getUserByEmailOrNull(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
}

function getDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: METRICS_TIMEZONE });
}

async function ensureSeedAuthUser(auth, seedUser) {
  const byUid = await getUserByUidOrNull(auth, seedUser.uid);
  const byEmail = await getUserByEmailOrNull(auth, seedUser.email);

  if (byEmail && byEmail.uid !== seedUser.uid) {
    await auth.deleteUser(byEmail.uid);
    console.log('Deleted legacy auth user with same email:', byEmail.uid);
  }

  let userRecord;
  if (!byUid) {
    userRecord = await auth.createUser({
      uid: seedUser.uid,
      email: seedUser.email,
      password: seedUser.password,
      displayName: seedUser.displayName,
      emailVerified: true
    });
    console.log('Created auth user:', userRecord.uid);
  } else {
    userRecord = await auth.updateUser(seedUser.uid, {
      email: seedUser.email,
      password: seedUser.password,
      displayName: seedUser.displayName,
      emailVerified: true,
      disabled: false
    });
    console.log('Updated auth user:', userRecord.uid);
  }

  await auth.setCustomUserClaims(seedUser.uid, {
    admin: seedUser.role === 'admin'
  });

  return userRecord;
}

function validateRequiredConfig(seedUser, config) {
  const provider = String(seedUser.provider || '').toLowerCase().trim();
  if (!provider) {
    throw new Error(`Seed user "${seedUser.uid}" is missing provider`);
  }

  const requiredByProvider = {
    foxess: ['deviceSn', 'foxessToken'],
    sungrow: ['sungrowDeviceSn', 'sungrowUsername'],
    sigenergy: ['sigenUsername'],
    alphaess: ['alphaessSystemSn', 'alphaessAppId', 'alphaessAppSecret']
  };

  const requiredFields = requiredByProvider[provider];
  if (!requiredFields) {
    throw new Error(`Unsupported provider "${provider}" for seed user "${seedUser.uid}"`);
  }

  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(`Seed user "${seedUser.uid}" missing required config field "${field}"`);
    }
  }
}

async function seedSingleUser({ db, auth, seedUser, ts }) {
  const userRecord = await ensureSeedAuthUser(auth, seedUser);
  const uid = userRecord.uid;

  await db.collection('users').doc(uid).set({
    uid,
    email: seedUser.email,
    displayName: seedUser.displayName,
    role: seedUser.role || 'user',
    automationEnabled: true,
    createdAt: ts,
    lastUpdated: ts,
    updatedAt: ts
  }, { merge: true });

  const configPayload = {
    ...(seedUser.config || {}),
    deviceProvider: seedUser.provider,
    setupComplete: true,
    setupCompletedAt: ts,
    createdAt: ts,
    updatedAt: ts
  };

  await db.collection('users').doc(uid).collection('config').doc('main').set(configPayload, { merge: true });
  console.log('Wrote users/%s/config/main', uid);

  const secretsPayload = seedUser.secrets || {};
  if (Object.keys(secretsPayload).length > 0) {
    await db.collection('users').doc(uid).collection('secrets').doc('credentials').set({
      ...secretsPayload,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote users/%s/secrets/credentials', uid);
  }

  await db.collection('users').doc(uid).collection('automation').doc('state').set({
    enabled: true,
    lastCheck: ts,
    lastTriggered: ts,
    activeRule: seedUser.rule?.name || null,
    segmentsCleared: false,
    updatedAt: ts
  }, { merge: true });
  console.log('Wrote users/%s/automation/state', uid);

  const rule = seedUser.rule || {};
  const ruleId = rule.id || `seed_rule_${seedUser.provider}`;
  await db.collection('users').doc(uid).collection('rules').doc(ruleId).set({
    ...rule,
    enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
    createdAt: ts,
    updatedAt: ts
  }, { merge: true });
  console.log('Wrote users/%s/rules/%s', uid, ruleId);

  await db.collection('users').doc(uid).collection('history').doc(`seed_entry_${seedUser.provider}`).set({
    type: 'seed',
    provider: seedUser.provider,
    message: `Local emulator seed entry for ${seedUser.provider}`,
    ruleId,
    timestamp: ts
  }, { merge: true });
  console.log('Wrote users/%s/history/seed_entry_%s', uid, seedUser.provider);

  const todayKey = getDateKey(0);
  const yesterdayKey = getDateKey(1);
  const todayMetrics = seedUser.metrics?.today || {};
  const yesterdayMetrics = seedUser.metrics?.yesterday || {};
  await db.collection('users').doc(uid).collection('metrics').doc(todayKey).set({
    ...todayMetrics,
    updatedAt: ts
  }, { merge: true });
  await db.collection('users').doc(uid).collection('metrics').doc(yesterdayKey).set({
    ...yesterdayMetrics,
    updatedAt: ts
  }, { merge: true });
  console.log('Wrote users/%s/metrics/%s + %s', uid, todayKey, yesterdayKey);

  return userRecord;
}

async function main() {
  try {
    assertEmulatorEnvironment();

    const projectId = getProjectId();
    console.log('Initializing admin for project', projectId);
    if (!admin.apps.length) {
      admin.initializeApp({ projectId });
    }

    const db = admin.firestore();
    const auth = admin.auth();
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const seededUsers = [];
    for (const seedUser of TEST_USERS) {
      const userRecord = await seedSingleUser({ db, auth, seedUser, ts });
      seededUsers.push({ seedUser, userRecord });
    }

    await db.collection('shared').doc('serverConfig').set({
      ...TEST_CONFIG,
      deviceProvider: 'foxess',
      setupComplete: true,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote shared/serverConfig');

    for (const item of seededUsers) {
      const { seedUser, userRecord } = item;
      const verifyAuth = await auth.getUser(seedUser.uid);
      const verifyConfigSnap = await db.collection('users').doc(userRecord.uid).collection('config').doc('main').get();
      if (!verifyConfigSnap.exists) {
        throw new Error(`Missing users/${userRecord.uid}/config/main after seed`);
      }

      const cfg = verifyConfigSnap.data() || {};
      validateRequiredConfig(seedUser, cfg);

      if (!verifyAuth.customClaims || verifyAuth.customClaims.admin !== true) {
        throw new Error(`Missing admin custom claim for seeded user "${seedUser.uid}"`);
      }
    }

    console.log('Seed verification passed.');
    console.log('Seeded users:');
    for (const { seedUser } of seededUsers) {
      console.log(`  ${seedUser.provider}: ${seedUser.email} / ${seedUser.password} / role=${seedUser.role}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
