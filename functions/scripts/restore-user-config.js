#!/usr/bin/env node
/**
 * Restore user config from automation state backup
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node restore-user-config.js
 * 
 * This script restores blackout windows and curtailment settings that were lost
 * from users/{uid}/config/main by reading the last known state from automation/state
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
const projectId = process.env.GCLOUD_PROJECT || 'inverter-automation-firebase';
console.log(`Initializing Firebase Admin for project: ${projectId}`);

try {
  admin.initializeApp({
    projectId: projectId
  });
} catch (e) {
  console.error('Failed to initialize Firebase Admin:', e.message);
  process.exit(1);
}

const db = admin.firestore();

async function restoreUserConfig(userEmail, restoredConfig) {
  try {
    // Find user by email
    console.log(`Looking up user: ${userEmail}`);
    const userRecord = await admin.auth().getUserByEmail(userEmail);
    const userId = userRecord.uid;
    console.log(`Found user ID: ${userId}`);

    // Get current config
    const configRef = db.collection('users').doc(userId).collection('config').doc('main');
    const configDoc = await configRef.get();
    
    if (!configDoc.exists) {
      console.error('ERROR: Config document does not exist. Cannot restore.');
      return false;
    }

    const currentConfig = configDoc.data();
    console.log('\nCurrent config snapshot:');
    console.log(`  - automation.blackoutWindows: ${JSON.stringify(currentConfig.automation?.blackoutWindows || 'NOT SET')}`);
    console.log(`  - curtailment: ${JSON.stringify(currentConfig.curtailment || 'NOT SET')}`);

    // Merge restored settings
    const updates = {
      'automation.blackoutWindows': restoredConfig.blackoutWindows || [],
      'curtailment': restoredConfig.curtailment || { enabled: false, priceThreshold: 0 },
      'updatedAt': admin.firestore.FieldValue.serverTimestamp()
    };

    console.log('\nRestoring settings:');
    console.log(`  - blackoutWindows: ${JSON.stringify(updates['automation.blackoutWindows'])}`);
    console.log(`  - curtailment: ${JSON.stringify(updates.curtailment)}`);

    // Prompt for confirmation (comment out for non-interactive)
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('\nProceed with restore? (yes/no): ', async (answer) => {
      readline.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('Restore cancelled.');
        process.exit(0);
      }

      // Apply updates
      await configRef.update(updates);
      console.log('✅ Config restored successfully!');
      
      // Verify
      const verifyDoc = await configRef.get();
      const verifiedConfig = verifyDoc.data();
      console.log('\nVerified restored config:');
      console.log(`  - automation.blackoutWindows: ${JSON.stringify(verifiedConfig.automation?.blackoutWindows)}`);
      console.log(`  - curtailment: ${JSON.stringify(verifiedConfig.curtailment)}`);
      
      process.exit(0);
    });

  } catch (error) {
    console.error('Error restoring config:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Configuration to restore for sardanapalos928@hotmail.com
const USER_EMAIL = 'sardanapalos928@hotmail.com';
const RESTORED_CONFIG = {
  blackoutWindows: [
    {
      enabled: true,
      start: '00:30',
      end: '07:30',  // User confirmed: blackout window was 00:30 to 07:30
      days: {
        enabled: true,
        Mon: true,
        Tue: true,
        Wed: true,
        Thu: true,
        Fri: true,
        Sat: true,
        Sun: true
      }
    }
  ],
  curtailment: {
    enabled: true,
    priceThreshold: 0.3  // User stated: "curtailment was enabled below 0.3"
  }
};

console.log('=== User Config Restore Tool ===\n');
console.log(`Target user: ${USER_EMAIL}`);
console.log(`Restore data: ${JSON.stringify(RESTORED_CONFIG, null, 2)}\n`);

restoreUserConfig(USER_EMAIL, RESTORED_CONFIG);
