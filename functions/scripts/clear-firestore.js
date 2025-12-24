// clear-firestore.js
// Deletes shared/serverConfig and specified user documents from Firestore using the Admin SDK.
const admin = require('firebase-admin');

async function main() {
  try {
    // Initialize admin with explicit projectId so emulator is targeted
    admin.initializeApp({ projectId: 'inverter-automation-firebase' });
    const db = admin.firestore();

    console.log('Deleting shared/serverConfig doc...');
    await db.collection('shared').doc('serverConfig').delete().catch(e => console.error('shared delete error:', e.message || e));

    // Attempt to delete test user from Auth emulator (if present)
    try {
      const userRecord = await admin.auth().getUserByEmail('test@gmail.com');
      console.log(`Found auth user ${userRecord.uid}, deleting...`);
      await admin.auth().deleteUser(userRecord.uid);
      console.log('Auth user deleted');
    } catch (e) {
      console.log('Auth user not found or deletion error (OK):', e.message || e);
    }

    const uid = 'x1jvTN3mc3UcdApiQfQcS7ajWhES';
    console.log(`Deleting user docs for ${uid}...`);
    await db.collection('users').doc(uid).collection('config').doc('main').delete().catch(e => console.error('user config delete error:', e.message || e));
    await db.collection('users').doc(uid).delete().catch(e => console.error('user doc delete error:', e.message || e));

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error clearing firestore:', err);
    process.exit(1);
  }
}

main();