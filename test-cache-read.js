const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'inverter-automation-firebase' });

(async () => {
  const db = admin.firestore();
  const uid = 'seed-admin-foxess';
  const siteId = 'seed-site-foxess';
  
  // Simulate getCachedAmberPricesCurrent logic
  console.log('🔍 Simulating getCachedAmberPricesCurrent:\n');
  
  try {
    if (!uid || !siteId) {
      console.log('✗ Missing userId or siteId');
      process.exit(1);
    }
    
    const cacheDoc = db.collection('users').doc(uid).collection('cache').doc('amber_current_' + siteId);
    console.log('️ Reading from:', `users/${uid}/cache/amber_current_${siteId}`);
    
    const snap = await cacheDoc.get();
    
    if (!snap.exists) {
      console.log('✗ Document does not exist');
      process.exit(1);
    }
    
    console.log('✓ Document exists');
    
    const cached = snap.data();
    console.log('✓ gotData:', { siteId: cached.siteId, pricesCount: cached.prices?.length });
    
    const cacheAge = Date.now() - (cached.cachedAt?.toMillis?.() || 0);
    console.log('  cache age (ms):', cacheAge);
    
    // Simulate default TTL since we don't have userConfig in this test
    const cacheTTL = 7 * 24 * 60 * 60 * 1000; // 7 days
    console.log('  cache TTL (ms):', cacheTTL);
    
    if (cacheAge > cacheTTL) {
      console.log('✗ Cache expired!');
      process.exit(1);
    }
    
    console.log('✓ Cache is fresh');
    
    const prices = cached.prices || null;
    console.log('✓ Returning', prices ? prices.length : 0, 'prices');
    
    if (prices && prices.length > 0) {
      console.log('\n✓✓✓ SUCCESS: Cache reading would work!');
      console.log('First price:', prices[0]);
    } else {
      console.log('✗ No prices in cache');
    }
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
})();
