const admin = require('firebase-admin');
const fetch = global.fetch || require('node-fetch');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({ projectId: 'inverter-automation-firebase' });

(async () => {
  try {
    const auth = admin.auth();
    const db = admin.firestore();
    const uid = 'seed-admin-foxess';
    
    // Get user config
    const cfgSnap = await db.collection('users').doc(uid).collection('config').doc('main').get();
    const cfg = cfgSnap.data();
    
    console.log('📋 User Config:');
    console.log('  - amberApiKey:', cfg?.amberApiKey);
    console.log('  - amberSiteId:', cfg?.amberSiteId);
    console.log('  - cache.amber:', cfg?.cache?.amber);
    
    // Get cache directly
    const cacheSnap = await db.collection('users').doc(uid).collection('cache').doc('amber_current_seed-site-foxess').get();
    console.log('\n💾 Cache Document:');
    console.log('  - exists:', cacheSnap.exists);
    console.log('  - siteId:', cacheSnap.data()?.siteId);
    console.log('  - prices count:', cacheSnap.data()?.prices?.length);
    console.log('  - cachedAt:', cacheSnap.data()?.cachedAt);
    
    // Create ID token
    const customToken = await auth.createCustomToken(uid);
    const tokenResp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test', {
      method: 'POST',
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    const tokenData = await tokenResp.json();
    const idToken = tokenData.idToken;
    
    // Test with debug flag
    console.log('\n🔍 API Test with debug:');
    const apiResp = await fetch('http://127.0.0.1:5000/api/pricing/current?siteId=seed-site-foxess&debug=true', {
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const apiData = await apiResp.json();
    console.log('  - errno:', apiData.errno);
    console.log('  - error:', apiData.error);
    console.log('  - result count:', apiData.result?.length);
    console.log('  - debug:', apiData._debug);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
