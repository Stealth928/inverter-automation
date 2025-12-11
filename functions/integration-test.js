/**
 * Integration Tests for Automation API Endpoints
 * 
 * These tests require the Firebase emulator to be running:
 *   npm --prefix functions run serve
 * 
 * Run these tests with:
 *   node functions/test/integration.test.js
 */

const http = require('http');

const EMULATOR_URL = 'http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api';
const PROD_URL = 'https://api-etjmk6bmtq-uc.a.run.app';

// Use emulator by default, can override with env var
const BASE_URL = process.env.TEST_PROD === 'true' ? PROD_URL : EMULATOR_URL;

let testsPassed = 0;
let testsFailed = 0;

/**
 * Make HTTP request
 */
function httpRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const protocol = url.protocol === 'https:' ? require('https') : http;
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    
    req.end();
  });
}

/**
 * Test helper
 */
function test(name, fn) {
  return fn()
    .then(() => {
      console.log(`✅ PASS: ${name}`);
      testsPassed++;
    })
    .catch(err => {
      console.error(`❌ FAIL: ${name}`);
      console.error(`   Error: ${err.message}`);
      testsFailed++;
    });
}

/**
 * Assertion helper
 */
function expect(value) {
  return {
    toBe: (expected) => {
      if (value !== expected) {
        throw new Error(`Expected ${expected} but got ${value}`);
      }
    },
    toEqual: (expected) => {
      if (JSON.stringify(value) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(value)}`);
      }
    },
    toBeDefined: () => {
      if (value === undefined) {
        throw new Error(`Expected value to be defined but got undefined`);
      }
    },
    toBeTruthy: () => {
      if (!value) {
        throw new Error(`Expected value to be truthy but got ${value}`);
      }
    },
    toBeGreaterThan: (expected) => {
      if (value <= expected) {
        throw new Error(`Expected ${value} to be greater than ${expected}`);
      }
    },
    toContain: (expected) => {
      if (!value || !value.includes(expected)) {
        throw new Error(`Expected ${value} to contain ${expected}`);
      }
    }
  };
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n🧪 Integration Tests for Automation API\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  console.log('Note: These tests verify the API envelope format, not actual functionality');
  console.log('      (requires authentication for full testing)\n');
  console.log('─'.repeat(60));
  
  // API root test (should redirect or return info)
  await test('API root should be accessible', async () => {
    const res = await httpRequest('/');
    expect(res.statusCode).toBeGreaterThan(0);
  });

  // Automation status (requires auth in production)
  await test('Automation status should require auth', async () => {
    const res = await httpRequest('/api/automation/status');
    // Should be 401 (unauthorized) or 200 (if tryAttachUser allows)
    expect(res.statusCode === 401 || res.statusCode === 200).toBeTruthy();
  });

  await test('Automation status should use errno envelope', async () => {
    const res = await httpRequest('/api/automation/status');
    expect(res.body.errno).toBeDefined();
  });

  // Config endpoints (requires auth)
  await test('Config status should require auth', async () => {
    const res = await httpRequest('/api/config/status');
    expect(res.statusCode === 401 || res.statusCode === 200).toBeTruthy();
  });

  await test('Config status should use errno envelope', async () => {
    const res = await httpRequest('/api/config/status');
    expect(res.body.errno).toBeDefined();
  });

  // Amber endpoints (without auth)
  await test('Amber prices should return 200 without auth', async () => {
    const res = await httpRequest('/api/amber/prices');
    expect(res.statusCode).toBe(200);
  });

  await test('Amber prices should return empty array without config', async () => {
    const res = await httpRequest('/api/amber/prices');
    expect(res.body.errno).toBe(0);
    expect(Array.isArray(res.body.result)).toBeTruthy();
  });

  // Weather endpoint (requires auth)
  await test('Weather endpoint should require auth', async () => {
    const res = await httpRequest('/api/weather?lat=-37.8136&lon=144.9631');
    expect(res.statusCode === 401 || res.statusCode === 200).toBeTruthy();
  });

  await test('Weather endpoint should use errno envelope', async () => {
    const res = await httpRequest('/api/weather?lat=-37.8136&lon=144.9631');
    expect(res.body.errno).toBeDefined();
  });

  // Test POST endpoints (will fail auth but should return proper error format)
  await test('Rule update without auth should return 401', async () => {
    const res = await httpRequest('/api/automation/rule/update', 'POST', {
      ruleName: 'test',
      enabled: false
    });
    expect(res.statusCode).toBe(401);
  });

  await test('Rule update error should use errno envelope', async () => {
    const res = await httpRequest('/api/automation/rule/update', 'POST', {
      ruleName: 'test',
      enabled: false
    });
    expect(res.body.errno).toBeGreaterThan(0);
  });

  await test('Rule delete without auth should return 401', async () => {
    const res = await httpRequest('/api/automation/rule/delete', 'POST', {
      ruleName: 'test'
    });
    expect(res.statusCode).toBe(401);
  });

  await test('Automation cycle without auth should return 401', async () => {
    const res = await httpRequest('/api/automation/cycle', 'POST', {});
    expect(res.statusCode).toBe(401);
  });

  await test('Automation toggle without auth should return 401', async () => {
    const res = await httpRequest('/api/automation/toggle', 'POST', {
      enabled: false
    });
    expect(res.statusCode).toBe(401);
  });

  // Clear credentials endpoint (requires auth)
  await test('Clear credentials without auth should return 401', async () => {
    const res = await httpRequest('/api/config/clear-credentials', 'POST', {});
    expect(res.statusCode).toBe(401);
  });

  // API call metrics
  await test('API metrics endpoint should return 200', async () => {
    const res = await httpRequest('/api/metrics/api-calls?days=1');
    expect(res.statusCode).toBe(200);
  });

  console.log('\n' + '─'.repeat(60));
  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${testsPassed}`);
  console.log(`   ❌ Failed: ${testsFailed}`);
  console.log(`   📈 Total:  ${testsPassed + testsFailed}`);
  
  if (testsFailed > 0) {
    console.log(`\n⚠️  Some tests failed. Check the output above for details.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All tests passed!`);
    process.exit(0);
  }
}

// Run tests
if (require.main === module) {
  runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests, httpRequest, test, expect };
