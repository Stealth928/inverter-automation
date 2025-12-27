#!/usr/bin/env node

/**
 * Simple key generator - just generates and saves to files
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

// Save private key to a secure location (you'll need to copy this to Firestore manually)
const privateKeyPath = path.join(__dirname, '..', 'tesla-private-key.pem');
fs.writeFileSync(privateKeyPath, privateKey, 'utf8');
console.log('✅ Private key saved to:', privateKeyPath);
console.log('   ⚠️  IMPORTANT: This file contains sensitive data!');
console.log('   ⚠️  Copy the content to Firestore: system/tesla-signing-key\n');

// Save public key to .well-known path
const wellKnownPath = path.join(__dirname, '..', 'frontend', '.well-known', 'appspecific', 'com.tesla.3p.public-key.pem');
const wellKnownDir = path.dirname(wellKnownPath);

if (!fs.existsSync(wellKnownDir)) {
  fs.mkdirSync(wellKnownDir, { recursive: true });
}
fs.writeFileSync(wellKnownPath, publicKey, 'utf8');
console.log('✅ Public key saved to:', wellKnownPath, '\n');

// Display public key
console.log('📋 Public Key (for verification):');
console.log('─'.repeat(70));
console.log(publicKey);
console.log('─'.repeat(70));
console.log('\n✅ Key generation complete!\n');
console.log('Next steps:');
console.log('1. Copy private key from tesla-private-key.pem to Firestore:');
console.log('   Collection: system');
console.log('   Document: tesla-signing-key');
console.log('   Field: privateKey (string)');
console.log('2. Deploy hosting: firebase deploy --only hosting');
console.log('3. Delete tesla-private-key.pem after copying to Firestore\n');
