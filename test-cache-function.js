const admin = require('firebase-admin');

// Use emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const db = admin.initializeApp({ projectId: 'inverter-automation-firebase' }).firestore();

// Mock logger
const logger = { error: (ctx, msg) => console.error(`[${ctx}] ${msg}`) };

// Copy the function from amber.js
function getAmberCacheTTL(userConfig) {
  // For this test, no config object, so use default
  console.log('getAmberCacheTTL called with userConfig:', userConfig);
  return (userConfig?.cache?.amber) || 60000;
}

async function getCachedAmberPricesCurrent(siteId, userId, userConfig) {
  console.log('\n=== getCachedAmberPricesCurrent called ===');
  console.log('siteId:', siteId);
  console.log('userId:', userId);
  console.log('userConfig.cache.amber:', userConfig?.cache?.amber);
  
  try {
    if (!userId || !siteId) {
      console.log('Returning null: userId or siteId missing');
      return null;
    }
    
    const cacheDoc = db.collection('users').doc(userId).collection('cache').doc('amber_current_' + siteId);
    console.log('Reading doc: users/' + userId + '/cache/amber_current_' + siteId);
    const snap = await cacheDoc.get();
    
    console.log('Doc exists:', snap.exists);
    if (!snap.exists) {
      console.log('Returning null: doc does not exist');
      return null;
    }
    
    const cached = snap.data();
    console.log('Cached data keys:', Object.keys(cached));
    console.log('Cached prices length:', cached.prices?.length);
    
    const cacheAge = Date.now() - (cached.cachedAt?.toMillis?.() || 0);
    const cacheTTL = getAmberCacheTTL(userConfig);
    
    console.log('Cache age (ms):', cacheAge);
    console.log('Cache TTL (ms):', cacheTTL);
    console.log('Cache is fresh:', cacheAge <= cacheTTL);
    
    if (cacheAge > cacheTTL) {
      console.log('Returning null: cache expired');
      return null;
    }
    
    console.log('Returning cached prices array:', cached.prices?.length, 'items');
    return cached.prices || null;
  } catch (error) {
    console.error(`Error reading current prices for user ${userId}, site ${siteId}:`, error.message);
    return null;
  }
}

(async () => {
  try {
    // Get user config
    const configDoc = await db.collection('users').doc('seed-admin-foxess').collection('config').doc('main').get();
    const userConfig = configDoc.data();
    
    // Call the cache function
    const result = await getCachedAmberPricesCurrent('seed-site-foxess', 'seed-admin-foxess', userConfig);
    
    console.log('\n=== FINAL RESULT ===');
    console.log('Result type:', typeof result);
    console.log('Is array:', Array.isArray(result));
    console.log('Result length:', result?.length);
    if (Array.isArray(result) && result.length > 0) {
      console.log('First price:', result[0]);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
