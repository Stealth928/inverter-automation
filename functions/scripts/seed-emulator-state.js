// seed-emulator-state.js
// Seeds Auth/Firestore emulators with a deterministic local test user and baseline data.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node seed-emulator-state.js

const admin = require('firebase-admin');
const {
  TEST_USER,
  TEST_CONFIG,
  getProjectId,
  assertEmulatorEnvironment
} = require('./emulator-test-user');

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

async function ensureTestAuthUser(auth) {
  const byUid = await getUserByUidOrNull(auth, TEST_USER.uid);
  const byEmail = await getUserByEmailOrNull(auth, TEST_USER.email);

  // If same email exists under a different uid, replace it with deterministic uid.
  if (byEmail && byEmail.uid !== TEST_USER.uid) {
    await auth.deleteUser(byEmail.uid);
    console.log('Deleted legacy auth user with same email:', byEmail.uid);
  }

  if (!byUid) {
    const created = await auth.createUser({
      uid: TEST_USER.uid,
      email: TEST_USER.email,
      password: TEST_USER.password,
      displayName: TEST_USER.displayName,
      emailVerified: true
    });
    console.log('Created auth user:', created.uid);
    return created;
  }

  const updated = await auth.updateUser(TEST_USER.uid, {
    email: TEST_USER.email,
    password: TEST_USER.password,
    displayName: TEST_USER.displayName,
    emailVerified: true,
    disabled: false
  });
  console.log('Updated auth user:', updated.uid);
  return updated;
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

    const userRecord = await ensureTestAuthUser(auth);
    const uid = userRecord.uid;
    const ts = admin.firestore.FieldValue.serverTimestamp();

    // Root user profile doc used by multiple admin/user APIs.
    await db.collection('users').doc(uid).set({
      uid,
      email: TEST_USER.email,
      displayName: TEST_USER.displayName,
      role: TEST_USER.role || 'user',
      automationEnabled: false,
      createdAt: ts,
      lastUpdated: ts,
      updatedAt: ts
    }, { merge: true });

    await db.collection('users').doc(uid).collection('config').doc('main').set({
      ...TEST_CONFIG,
      setupComplete: true,
      setupCompletedAt: ts,
      createdAt: ts,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote users/%s/config/main', uid);

    await db.collection('users').doc(uid).collection('automation').doc('state').set({
      enabled: false,
      lastCheck: null,
      lastTriggered: null,
      activeRule: null,
      segmentsCleared: false,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote users/%s/automation/state', uid);

    const ruleId = 'test_high_feed_in';
    await db.collection('users').doc(uid).collection('rules').doc(ruleId).set({
      name: 'Test: High Feed-in',
      enabled: true,
      priority: 2,
      cooldownMinutes: 5,
      conditions: {
        feedInPrice: { enabled: true, operator: '>', value: 30 }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 5000,
        fdSoc: 20,
        minSocOnGrid: 20,
        maxSoc: 100
      },
      createdAt: ts,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote users/%s/rules/%s', uid, ruleId);

    await db.collection('users').doc(uid).collection('history').doc('seed_entry').set({
      type: 'seed',
      message: 'Local emulator seed entry',
      ruleId,
      timestamp: ts
    }, { merge: true });
    console.log('Wrote users/%s/history/seed_entry', uid);

    await db.collection('shared').doc('serverConfig').set({
      ...TEST_CONFIG,
      setupComplete: true,
      updatedAt: ts
    }, { merge: true });
    console.log('Wrote shared/serverConfig');

    // Verify seeded state explicitly so callers can trust readiness.
    const verifyAuth = await auth.getUser(TEST_USER.uid);
    const verifyConfig = await db.collection('users').doc(uid).collection('config').doc('main').get();
    if (!verifyConfig.exists) {
      throw new Error(`Missing users/${uid}/config/main after seed`);
    }

    const cfg = verifyConfig.data() || {};
    if (!cfg.deviceSn || !cfg.foxessToken) {
      throw new Error('Seeded config is missing required credentials');
    }

    console.log('Seed verification passed.');
    console.log('Test user ready:');
    console.log(`  uid: ${verifyAuth.uid}`);
    console.log(`  email: ${verifyAuth.email}`);
    console.log(`  password: ${TEST_USER.password}`);
    console.log(`  role: ${TEST_USER.role || 'user'}`);
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
