const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'inverter-automation-firebase' });

(async () => {
  const db = admin.firestore();
  const uid = 'seed-admin-foxess';
  
  console.log('\n📊 INVERTER CACHE CHECK');
  const inverterDoc = await db.collection('users').doc(uid).collection('cache').doc('inverter').get();
  if (inverterDoc.exists) {
    const data = inverterDoc.data();
    console.log('✓ inverter doc exists');
    console.log('  - has "data" wrapper:', !!data.data);
    console.log('  - has "timestamp":', !!data.timestamp);
    console.log('  - data.errno:', data.data?.errno);
    console.log('  - result count:', Array.isArray(data.data?.result) ? data.data.result.length : 'N/A');
  } else {
    console.log('✗ inverter doc missing');
  }

  console.log('\n📊 INVERTER-REALTIME CACHE CHECK');
  const realtimeDoc = await db.collection('users').doc(uid).collection('cache').doc('inverter-realtime').get();
  if (realtimeDoc.exists) {
    const data = realtimeDoc.data();
    console.log('✓ inverter-realtime doc exists');
    console.log('  - has "data" wrapper:', !!data.data);
    console.log('  - has "timestamp":', !!data.timestamp);
    console.log('  - data.errno:', data.data?.errno);
    console.log('  - variables count:', data.data?.result?.[0]?.datas?.length || 0);
  } else {
    console.log('✗ inverter-realtime doc missing');
  }

  console.log('\n💰 AMBER PRICES CACHE CHECK');
  const amberDoc = await db.collection('users').doc(uid).collection('cache').doc('amber_current_seed-site-foxess').get();
  if (amberDoc.exists) {
    const data = amberDoc.data();
    console.log('✓ amber prices doc exists');
    console.log('  - siteId:', data.siteId);
    console.log('  - prices count:', Array.isArray(data.prices) ? data.prices.length : 'N/A');
    console.log('  - sample price:', data.prices?.[0] ? {
      type: data.prices[0].type,
      channelType: data.prices[0].channelType,
      perKwh: data.prices[0].perKwh,
      renewables: data.prices[0].renewables
    } : 'N/A');
    console.log('  - cachedAt exists:', !!data.cachedAt);
  } else {
    console.log('✗ amber prices doc missing');
  }

  console.log('\n🌐 AMBER SITES CACHE CHECK');
  const sitesDoc = await db.collection('users').doc(uid).collection('cache').doc('amber_sites').get();
  if (sitesDoc.exists) {
    const data = sitesDoc.data();
    console.log('✓ amber sites doc exists');
    console.log('  - sites count:', Array.isArray(data.sites) ? data.sites.length : 0);
    console.log('  - first site:', data.sites?.[0] || 'N/A');
  } else {
    console.log('✗ amber sites doc missing');
  }

  console.log('\n⚙️ USER CONFIG CHECK');
  const cfgDoc = await db.collection('users').doc(uid).collection('config').doc('main').get();
  if (cfgDoc.exists) {
    const cfg = cfgDoc.data();
    console.log('✓ config doc exists');
    console.log('  - deviceProvider:', cfg.deviceProvider);
    console.log('  - amberApiKey:', cfg.amberApiKey);
    console.log('  - amberSiteId:', cfg.amberSiteId);
    console.log('  - setupComplete:', cfg.setupComplete);
  } else {
    console.log('✗ config doc missing');
  }

  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
