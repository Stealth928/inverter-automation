#!/usr/bin/env node
/**
 * Clean up stale runtime state subcollections
 * These were created before the config/main fix and can be safely deleted
 * The automation cycle will recreate them as needed with correct values
 */

const admin = require('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || 'inverter-automation-firebase';
console.log(`Initializing Firebase Admin for project: ${projectId}`);

try {
  admin.initializeApp({ projectId });
} catch (e) {
  console.error('Failed to initialize Firebase Admin:', e.message);
  process.exit(1);
}

const db = admin.firestore();

async function cleanupStaleState(userEmail) {
  try {
    // Find user by email
    console.log(`Looking up user: ${userEmail}`);
    const userRecord = await admin.auth().getUserByEmail(userEmail);
    const userId = userRecord.uid;
    console.log(`Found user ID: ${userId}\n`);

    const userRef = db.collection('users').doc(userId);

    // Stale subcollections to clean
    const subcollectionsToClean = [
      { name: 'automation', doc: 'state', reason: 'Runtime automation state (will be recreated)' },
      { name: 'curtailment', doc: 'state', reason: 'Runtime curtailment state (will be recreated)' }
    ];

    console.log('Subcollections to clean:');
    for (const item of subcollectionsToClean) {
      const docRef = userRef.collection(item.name).doc(item.doc);
      const docSnapshot = await docRef.get();
      
      if (docSnapshot.exists) {
        console.log(`  ✓ ${item.name}/${item.doc} exists - ${item.reason}`);
      } else {
        console.log(`  - ${item.name}/${item.doc} does not exist (already clean)`);
      }
    }

    console.log('\nPrompt for confirmation:');
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Delete stale state documents? (yes/no): ', async (answer) => {
      readline.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('Cleanup cancelled.');
        process.exit(0);
      }

      console.log('\nDeleting stale state documents...');
      
      for (const item of subcollectionsToClean) {
        try {
          const docRef = userRef.collection(item.name).doc(item.doc);
          const docSnapshot = await docRef.get();
          
          if (docSnapshot.exists) {
            await docRef.delete();
            console.log(`  ✓ Deleted ${item.name}/${item.doc}`);
          } else {
            console.log(`  - Skipped ${item.name}/${item.doc} (not found)`);
          }
        } catch (err) {
          console.error(`  ✗ Failed to delete ${item.name}/${item.doc}: ${err.message}`);
        }
      }

      console.log('\n✅ Cleanup complete!');
      console.log('Note: These documents will be automatically recreated by the automation cycle');
      console.log('with the correct values from config/main.');
      
      process.exit(0);
    });

  } catch (error) {
    console.error('Error during cleanup:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const USER_EMAIL = 'sardanapalos928@hotmail.com';
console.log('=== Firestore Stale State Cleanup ===\n');
console.log(`Target user: ${USER_EMAIL}\n`);

cleanupStaleState(USER_EMAIL);
