/**
 * Local test for Cloud Functions
 * Tests that functions load and basic API structure works
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const pkgFunctions = require('firebase-functions');
const pkgAdmin = require('firebase-admin');

console.log('Firebase Functions available');
console.log('Firebase Admin SDK available');

// Test 1: Check if schedule API is available
console.log('\n=== TEST 1: Schedule API ===');
if (functions.pubsub && typeof functions.pubsub.schedule === 'function') {
  console.log('✓ functions.pubsub.schedule() is available');
} else {
  console.log('✗ functions.pubsub.schedule() is NOT available');
}

// Test 2: Check auth API
console.log('\n=== TEST 2: Auth API ===');
if (functions.auth && typeof functions.auth.user === 'function') {
  console.log('✓ functions.auth.user() is available');
} else {
  console.log('✗ functions.auth.user() is NOT available');
}

// Test 3: Try loading the index.js file
console.log('\n=== TEST 3: Loading index.js ===');
try {
  // Don't actually require it (it will try to initialize), but check syntax
  const { execSync } = require('child_process');
  execSync('node -c index.js', { stdio: 'pipe', cwd: __dirname });
  console.log('✓ index.js syntax is valid');
} catch (e) {
  console.log('✗ index.js has syntax errors:', e.message);
}

console.log('\n=== All tests complete ===');
