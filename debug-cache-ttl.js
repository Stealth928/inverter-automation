const admin = require('firebase-admin');

// Use emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const db = admin.initializeApp({ projectId: 'inverter-automation-firebase' }).firestore();

(async () => {
  try {
    // Get user config
    const configDoc = await db.collection('users').doc('seed-admin-foxess').collection('config').doc('main').get();
    const userConfig = configDoc.data();
    console.log('User config cache.amber:', userConfig?.cache?.amber);
    
    // Get cache document
    const cacheDoc = await db.collection('users').doc('seed-admin-foxess').collection('cache').doc('amber_current_seed-site-foxess').get();
    if (cacheDoc.exists) {
      const cached = cacheDoc.data();
      const cachedAt = cached.cachedAt;
      const cacheAge = Date.now() - (cachedAt?.toMillis?.() || 0);
      const cacheTTL = userConfig?.cache?.amber || 60000; // Default 60 seconds
      
      console.log('\nCache document info:');
      console.log('cachedAt timestamp:', cachedAt);
      console.log('cachedAt.toMillis():', cachedAt?.toMillis?.());
      console.log('Current time (Date.now()):', Date.now());
      console.log('Cache age (ms):', cacheAge);
      console.log('Cache TTL (ms):', cacheTTL);
      console.log('Cache TTL (hours):', cacheTTL / 1000 / 60 / 60);
      console.log('Is cache fresh?', cacheAge <= cacheTTL);
      console.log('Prices count:', cached.prices?.length || 0);
    } else {
      console.log('Cache document does not exist');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
