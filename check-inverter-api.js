const admin = require('firebase-admin');
const fetch = global.fetch || require('node-fetch');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({ projectId: 'inverter-automation-firebase' });

(async () => {
  try {
    const auth = admin.auth();
    const uid = 'seed-admin-foxess';
    
    // Create ID token
    const customToken = await auth.createCustomToken(uid);
    const tokenResp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test', {
      method: 'POST',
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    const tokenData = await tokenResp.json();
    const idToken = tokenData.idToken;
    
    // Test inverter real-time endpoint
    console.log('🔌 /api/inverter/real-time response:\n');
    const invResp = await fetch('http://127.0.0.1:5000/api/inverter/real-time?sn=FOX-SEED-1001', {
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const invData = await invResp.json();
    console.log('Status:', invResp.status);
    console.log('Errno:', invData.errno);
    
    if (invData.result && invData.result.length > 0) {
      const frame = invData.result[0];
      const datas = frame.datas || [];
      
      console.log('\nRaw variables returned:');
      for (const item of datas) {
        if (['loadsPower', 'gridConsumptionPower', 'feedinPower', 'pvPower'].includes(item.variable)) {
          console.log(`  ${item.variable}: ${item.value} (${item.unit || 'no unit'})`);
        }
      }
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();
