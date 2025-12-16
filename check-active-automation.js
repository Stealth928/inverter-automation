const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '.', 'service-account-key.json');

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://inverter-automation.firebaseio.com'
  });
} catch (err) {
  console.error('Service account key not found. Using default credentials.');
  admin.initializeApp({
    databaseURL: 'https://inverter-automation.firebaseio.com'
  });
}

const db = admin.firestore();

async function checkActiveAutomation() {
  try {
    console.log('\n📊 Querying active automation cycles...\n');

    const usersSnapshot = await db.collection('users').get();
    const activeUsers = [];

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      
      // Check automation state
      const stateDoc = await db.collection(`users/${uid}/automation`).doc('state').get();
      const stateData = stateDoc.exists ? stateDoc.data() : null;

      // Check config
      const configDoc = await db.collection(`users/${uid}/config`).doc('main').get();
      const configData = configDoc.exists ? configDoc.data() : null;

      if (stateData && (stateData.enabled || stateData.activeRule)) {
        const lastCheck = stateData.lastCheck ? new Date(stateData.lastCheck.toDate()).toISOString() : 'Never';
        const deviceSN = configData?.deviceSN || 'Not configured';
        
        activeUsers.push({
          uid,
          enabled: stateData.enabled,
          activeRule: stateData.activeRule || 'None',
          inBlackout: stateData.inBlackout || false,
          lastCheck,
          deviceSN
        });
      }
    }

    if (activeUsers.length === 0) {
      console.log('❌ No users with active automation found.');
    } else {
      console.log(`✅ Found ${activeUsers.length} user(s) with active automation:\n`);
      activeUsers.forEach((user, idx) => {
        console.log(`${idx + 1}. UID: ${user.uid}`);
        console.log(`   Enabled: ${user.enabled}`);
        console.log(`   Active Rule: ${user.activeRule}`);
        console.log(`   In Blackout: ${user.inBlackout}`);
        console.log(`   Last Check: ${user.lastCheck}`);
        console.log(`   Device SN: ${user.deviceSN}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error querying automation state:', error);
    process.exit(1);
  }
}

checkActiveAutomation();
