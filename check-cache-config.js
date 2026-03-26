const admin = require('firebase-admin');

// Use emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const db = admin.initializeApp({ projectId: 'inverter-automation-firebase' }).firestore();

(async () => {
  try {
    const configDoc = await db.collection('users').doc('seed-admin-foxess').collection('config').doc('main').get();
    if (configDoc.exists) {
      const data = configDoc.data();
      console.log('Full config data:');
      console.log(JSON.stringify(data, null, 2));
      
      console.log('\nCache field specifically:');
      console.log('cache:', data.cache);
      console.log('cache.amber:', data.cache?.amber);
    } else {
      console.log('Config doc does not exist');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
