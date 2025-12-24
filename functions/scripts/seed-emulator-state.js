// seed-emulator-state.js
// Seeds the Auth and Firestore emulators with a test user, sample config, a sample rule and history entry.
// Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node seed-emulator-state.js

const admin = require('firebase-admin');

async function main() {
  try {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || 'inverter-automation-firebase';
    console.log('Initializing admin for project', projectId);
    admin.initializeApp({ projectId });
    const db = admin.firestore();

    // Create auth user (id will be returned)
    const email = 'test@gmail.com';
    const password = '123456';
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({ email, password });
      console.log('Created auth user:', userRecord.uid);
    } catch (e) {
      // If user exists, look them up
      if (e.code === 'auth/email-already-exists') {
        userRecord = await admin.auth().getUserByEmail(email);
        console.log('Auth user already exists:', userRecord.uid);
      } else {
        throw e;
      }
    }

    const uid = userRecord.uid;

    // Create basic profile and config
    const configData = {
      deviceSn: 'TEST-SN-0001',
      foxessToken: 'FAKE_TOKEN',
      amberApiKey: 'FAKE_AMBER',
      location: 'Sydney, Australia',
      setupComplete: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(uid).collection('config').doc('main').set(configData, { merge: true });
    console.log('Wrote config for user:', uid);

    // Add a sample rule
    const ruleId = 'test_high_feed_in';
    const rule = {
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
        fdPwr: 5000
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(uid).collection('rules').doc(ruleId).set(rule);
    console.log('Added sample rule:', ruleId);

    // Add a sample history entry
    await db.collection('users').doc(uid).collection('history').add({
      type: 'rule_trigger',
      message: 'Sample rule trigger entry created during seed',
      ruleId,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('Added sample history entry');

    // Optionally set shared server config for unauthenticated setup testing
    const serverConfig = {
      deviceSn: 'TEST-SN-0001',
      foxessToken: 'FAKE_TOKEN',
      amberApiKey: 'FAKE_AMBER',
      location: 'Sydney, Australia',
      setupComplete: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('shared').doc('serverConfig').set(serverConfig, { merge: true });
    console.log('Wrote shared/serverConfig');

    console.log('\nSeed complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();