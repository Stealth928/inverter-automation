// clear-firestore.js
// Deletes seeded emulator test data from Auth and Firestore.
const admin = require('firebase-admin');
const {
  TEST_USERS,
  TEST_USER,
  LEGACY_TEST_USERS,
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

    const cleanupUsers = [
      ...(Array.isArray(TEST_USERS) ? TEST_USERS : []),
      ...(Array.isArray(LEGACY_TEST_USERS) ? LEGACY_TEST_USERS : []),
      TEST_USER
    ].filter(Boolean);
    const seenUids = new Set();
    const seenEmails = new Set();

    for (const user of cleanupUsers) {
      const uid = String(user.uid || '').trim();
      const email = String(user.email || '').trim();
      if (!uid && !email) continue;

      if (uid && !seenUids.has(uid)) {
        seenUids.add(uid);
        console.log(`Deleting Firestore user tree for uid=${uid}...`);
        await deleteDocumentTree(db.collection('users').doc(uid));
        console.log(`Deleting auth user by uid=${uid}...`);
        await auth.deleteUser(uid).catch(() => {});
      }

      if (email && !seenEmails.has(email)) {
        seenEmails.add(email);
        const byEmail = await getUserByEmailOrNull(auth, email);
        if (byEmail) {
          console.log(`Deleting auth user by duplicate email for uid=${byEmail.uid}...`);
          await auth.deleteUser(byEmail.uid).catch(() => {});
        }
      }
    }

    console.log(`Cleanup complete. Removed/checked ${seenUids.size} UID(s), ${seenEmails.size} email(s).`);
    process.exit(0);
  } catch (err) {
    console.error('Error clearing emulator data:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
