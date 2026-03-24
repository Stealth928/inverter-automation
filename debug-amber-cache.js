const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'inverter-automation-firebase' });

(async () => {
  const db = admin.firestore();
  const uid = 'seed-admin-foxess';
  
  const doc = await db.collection('users').doc(uid).collection('cache').doc('amber_current_seed-site-foxess').get();
  if (doc.exists) {
    const data = doc.data();
    console.log('💰 Amber cache document analysis:');
    console.log('  siteId:', data.siteId);
    console.log('  prices count:', data.prices?.length);
    console.log('  cachedAt type:', typeof data.cachedAt);
    console.log('  cachedAt value:', data.cachedAt);
    console.log('  cachedAt.toMillis:', typeof data.cachedAt?.toMillis);
    
    if (data.cachedAt && typeof data.cachedAt.toMillis === 'function') {
      const cacheAgeMs = Date.now() - data.cachedAt.toMillis();
      console.log('  cache age (ms):', cacheAgeMs);
      console.log('  cache would expire at (ms):', 7 * 24 * 60 * 60 * 1000);
      console.log('  cache is fresh:', cacheAgeMs < 7 * 24 * 60 * 60 * 1000);
    } else {
      console.log('  ✗ cachedAt is not a Firestore Timestamp!');
    }
  }
  
  process.exit(0);
})();
