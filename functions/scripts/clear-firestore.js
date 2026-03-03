// clear-firestore.js
// Deletes seeded emulator test data from Auth and Firestore.
const admin = require('firebase-admin');
const {
  TEST_USER,
  getProjectId,
  assertEmulatorEnvironment
} = require('./emulator-test-user');

async function getUserByEmailOrNull(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
}

async function deleteDocumentTree(docRef) {
  const subcollections = await docRef.listCollections();
  for (const subcollection of subcollections) {
    const snapshot = await subcollection.get();
    for (const doc of snapshot.docs) {
      await deleteDocumentTree(doc.ref);
    }
  }

  await docRef.delete().catch(() => {
    // Best-effort delete for cleanup scripts.
  });
}

async function main() {
  try {
    assertEmulatorEnvironment();

    const projectId = getProjectId();
    if (!admin.apps.length) {
      admin.initializeApp({ projectId });
    }

    const db = admin.firestore();
    const auth = admin.auth();

    console.log('Deleting shared/serverConfig...');
    await db.collection('shared').doc('serverConfig').delete().catch(() => {});

    console.log(`Deleting Firestore user tree for uid=${TEST_USER.uid}...`);
    await deleteDocumentTree(db.collection('users').doc(TEST_USER.uid));

    console.log(`Deleting auth user by uid=${TEST_USER.uid}...`);
    await auth.deleteUser(TEST_USER.uid).catch(() => {});

    // Handle any legacy user with same email but different uid.
    const byEmail = await getUserByEmailOrNull(auth, TEST_USER.email);
    if (byEmail) {
      console.log(`Deleting legacy auth user by email: ${byEmail.uid}`);
      await auth.deleteUser(byEmail.uid).catch(() => {});
    }

    console.log('Cleanup complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error clearing emulator data:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
