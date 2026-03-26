const admin = require('firebase-admin');
const fetch = global.fetch || require('node-fetch');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({ projectId: 'inverter-automation-firebase' });

(async () => {
  try {
    // Create ID token directly from auth emulator
    const auth = admin.auth();
    const uid = 'seed-admin-foxess';
    
    // Use createCustomToken and then exchange for ID token
    const customToken = await auth.createCustomToken(uid);
    
    // Exchange custom token for ID token using the emulator's REST API
    const tokenResp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test', {
      method: 'POST',
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    const tokenData = await tokenResp.json();
    const idToken = tokenData.idToken;
    
    if (!idToken) {
      console.log('Failed to get ID token:', tokenData);
      process.exit(1);
    }
    
    console.log('✓ Got ID token, testing endpoints...\n');
    
    // Test as authenticated user
    const response = await fetch('http://127.0.0.1:5000/api/pricing/sites', {
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    console.log('🌐 /api/pricing/sites response:');
    console.log('  status:', response.status);
    console.log('  errno:', data.errno);
    console.log('  sites count:', data.result?.length || 0);
    console.log('  first site:', data.result?.[0]);

    // Test current prices endpoint
    const currentResp = await fetch('http://127.0.0.1:5000/api/pricing/current?siteId=seed-site-foxess', {
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });

    const currentData = await currentResp.json();
    console.log('\n💰 /api/pricing/current response:');
    console.log('  status:', currentResp.status);
    console.log('  errno:', currentData.errno);
    console.log('  error:', currentData.error);
    console.log('  prices count:', currentData.result?.length || 0);
    console.log('  first price (general):', currentData.result?.find(p => p.channelType === 'general'));
    console.log('  first price (feedIn):', currentData.result?.find(p => p.channelType === 'feedIn'));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
