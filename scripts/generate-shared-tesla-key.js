#!/usr/bin/env node

/**
 * Generate a shared ECDSA P-256 keypair for Tesla Vehicle Command Protocol
 * This key is used by ALL users of the application.
 * 
 * Usage: node scripts/generate-shared-tesla-key.js
 * 
 * This will:
 * 1. Generate ECDSA P-256 keypair
 * 2. Save private key to Firestore (system/tesla-signing-key)
 * 3. Save public key to frontend/.well-known/appspecific/com.tesla.3p.public-key.pem
 * 4. Display verification info
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = process.env.GOOGLE_APPLICATION_CREDENTIALS 
  ? require(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : null;

if (!serviceAccount && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('❌ Error: Set GOOGLE_APPLICATION_CREDENTIALS environment variable');
  console.error('   or run with Firebase emulator (FIRESTORE_EMULATOR_HOST)');
  process.exit(1);
}

admin.initializeApp({
  credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault()
});

const db = admin.firestore();

async function generateSharedKey() {
  console.log('🔐 Generating shared Tesla signing key...\n');

  // Generate ECDSA P-256 keypair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // P-256
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  console.log('✅ Keypair generated\n');

  // Save private key to Firestore
  try {
    await db.collection('system').doc('tesla-signing-key').set({
      privateKey,
      algorithm: 'ECDSA P-256',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      purpose: 'Shared signing key for all users Tesla Vehicle Command Protocol',
      domain: 'inverter-automation-firebase.web.app'
    });
    console.log('✅ Private key saved to Firestore (system/tesla-signing-key)\n');
  } catch (error) {
    console.error('❌ Failed to save private key to Firestore:', error.message);
    process.exit(1);
  }

  // Save public key to .well-known path
  const wellKnownPath = path.join(__dirname, '..', 'frontend', '.well-known', 'appspecific', 'com.tesla.3p.public-key.pem');
  const wellKnownDir = path.dirname(wellKnownPath);

  try {
    if (!fs.existsSync(wellKnownDir)) {
      fs.mkdirSync(wellKnownDir, { recursive: true });
    }
    fs.writeFileSync(wellKnownPath, publicKey, 'utf8');
    console.log('✅ Public key saved to:', wellKnownPath, '\n');
  } catch (error) {
    console.error('❌ Failed to save public key:', error.message);
    process.exit(1);
  }

  // Display public key
  console.log('📋 Public Key (for verification):');
  console.log('─'.repeat(70));
  console.log(publicKey);
  console.log('─'.repeat(70));
  console.log('\n✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Deploy hosting: firebase deploy --only hosting');
  console.log('2. Verify public key is accessible at:');
  console.log('   https://inverter-automation-firebase.web.app/.well-known/appspecific/com.tesla.3p.public-key.pem');
  console.log('3. Users can now complete Tesla setup (OAuth + virtual key pairing)');
  console.log('   No per-user key generation required!\n');
}

generateSharedKey()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
