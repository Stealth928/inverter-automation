#!/usr/bin/env node
/**
 * End-to-End Test Script for Firebase Functions Emulator
 * 
 * This script tests the complete flow:
 * 1. Health check (no auth required)
 * 2. Password reset endpoint
 * 3. Protected health endpoint (requires token)
 * 
 * Usage:
 *   node test-emulator.js
 * 
 * Prerequisites:
 *   - Firebase emulator running: firebase emulators:start --only functions --project inverter-automation-firebase
 *   - Functions available at http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api';

let passed = 0;
let failed = 0;

/**
 * Make HTTP request
 */
function httpRequest(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            rawBody: data
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: null,
            rawBody: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Test result logger
 */
function logTest(name, passed, details = '') {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';
  console.log(`${color}${icon}${reset} ${name}${details ? ' - ' + details : ''}`);
  if (passed) {
    global.passed++;
  } else {
    global.failed++;
  }
}

/**
 * Run tests
 */
async function runTests() {
  console.log('\n=== Firebase Functions Emulator E2E Tests ===\n');

  // Test 1: Unauthenticated health endpoint
  console.log('Test 1: Unauthenticated Health Endpoint');
  try {
    const res = await httpRequest(`${BASE_URL}/api/health`);
    const ok = res.statusCode === 200 && res.body?.ok === true;
    logTest('GET /api/health', ok, `Status: ${res.statusCode}`);
  } catch (e) {
    logTest('GET /api/health', false, `Error: ${e.message}`);
  }

  // Test 2: Password reset endpoint
  console.log('\nTest 2: Password Reset Endpoint');
  try {
    const res = await httpRequest(`${BASE_URL}/api/auth/forgot-password`, 'POST', {
      email: 'test@example.com'
    });
    const ok = res.statusCode === 200 && res.body?.errno === 0;
    logTest('POST /api/auth/forgot-password', ok, `Status: ${res.statusCode}`);
  } catch (e) {
    logTest('POST /api/auth/forgot-password', false, `Error: ${e.message}`);
  }

  // Test 3: Password reset with missing email
  console.log('\nTest 3: Password Reset Validation');
  try {
    const res = await httpRequest(`${BASE_URL}/api/auth/forgot-password`, 'POST', {});
    const ok = res.statusCode === 400 && res.body?.errno === 400;
    logTest('POST /api/auth/forgot-password (empty email)', ok, `Status: ${res.statusCode}`);
  } catch (e) {
    logTest('POST /api/auth/forgot-password (empty email)', false, `Error: ${e.message}`);
  }

  // Test 4: Protected health endpoint without token
  console.log('\nTest 4: Protected Endpoint (No Token)');
  try {
    const res = await httpRequest(`${BASE_URL}/api/health/auth`);
    const ok = res.statusCode === 401 && res.body?.errno === 401;
    logTest('GET /api/health/auth (no token)', ok, `Status: ${res.statusCode}, Error: ${res.body?.error}`);
  } catch (e) {
    logTest('GET /api/health/auth (no token)', false, `Error: ${e.message}`);
  }

  // Test 5: Protected health endpoint with invalid token
  console.log('\nTest 5: Protected Endpoint (Invalid Token)');
  try {
    const res = await httpRequest(`${BASE_URL}/api/health/auth`, 'GET', null, {
      'Authorization': 'Bearer invalid-token-12345'
    });
    const ok = res.statusCode === 401 && res.body?.errno === 401;
    logTest('GET /api/health/auth (invalid token)', ok, `Status: ${res.statusCode}`);
  } catch (e) {
    logTest('GET /api/health/auth (invalid token)', false, `Error: ${e.message}`);
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log('\n✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log(`\n✗ ${failed} test(s) failed\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
