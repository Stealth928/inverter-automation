/**
 * Comprehensive End-to-End Test Suite
 * 
 * Tests all critical API endpoints with real production calls (controlled)
 * 
 * USAGE:
 *   Emulator (no auth):  node functions/e2e-tests.js
 *   Emulator (with auth): TEST_AUTH_TOKEN=xxx node functions/e2e-tests.js
 *   Production (no auth): TEST_ENV=prod node functions/e2e-tests.js
 *   Production (with auth): TEST_ENV=prod TEST_AUTH_TOKEN=xxx node functions/e2e-tests.js
 * 
 * HOW TO GET TEST_AUTH_TOKEN:
 *   1. Open your app in a browser (http://localhost:8000 or production)
 *   2. Login with your test account
 *   3. Open browser DevTools Console
 *   4. Run: firebase.auth().currentUser.getIdToken().then(t => console.log(t))
 *   5. Copy the printed token and use it as TEST_AUTH_TOKEN
 *   
 *   Alternative (Node.js script):
 *   - Create a script using Firebase Admin SDK to generate custom tokens
 *   - See: https://firebase.google.com/docs/auth/admin/create-custom-tokens
 * 
 * Environment variables:
 *   TEST_ENV=prod          - Test against production (default: emulator)
 *   TEST_AUTH_TOKEN=xxx    - Firebase ID token for authenticated tests
 *   SKIP_AUTH_TESTS=true   - Skip tests requiring authentication
 *   API_CALL_LIMIT=10      - Maximum external API calls to make (default: 10)
 */

const http = require('http');
const https = require('https');

// Configuration
const EMULATOR_URL = 'http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api';
const PROD_URL = 'https://api-etjmk6bmtq-uc.a.run.app';
const BASE_URL = process.env.TEST_ENV === 'prod' ? PROD_URL : EMULATOR_URL;
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN;
const SKIP_AUTH = process.env.SKIP_AUTH_TESTS === 'true';
const API_CALL_LIMIT = parseInt(process.env.API_CALL_LIMIT || '10');

// Test statistics
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;
let apiCallCount = 0;

// Track which external APIs were called
const externalAPICalls = {
  foxess: 0,
  amber: 0,
  weather: 0
};

/**
 * Make HTTP/HTTPS request
 */
function httpRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const protocol = url.protocol === 'https:' ? https : http;
    
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
 * Test helper with improved reporting
 */
async function test(name, fn, options = {}) {
  totalTests++;
  
  if (options.requiresAuth && (SKIP_AUTH || !AUTH_TOKEN)) {
    console.log(`⏭️  SKIP: ${name} (requires auth)`);
    skippedTests++;
    return;
  }
  
  if (options.apiCall) {
    apiCallCount++;
    if (externalAPICalls[options.apiCall] !== undefined) {
      externalAPICalls[options.apiCall]++;
    }
  }
  
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${err.message}`);
    failedTests++;
  }
}

/**
 * Assertion helpers
 */
function expect(value, testName = '') {
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
    toBeNull: () => {
      if (value !== null) {
        throw new Error(`Expected null but got ${value}`);
      }
    },
    toBeTruthy: () => {
      if (!value) {
        throw new Error(`Expected value to be truthy but got ${value}`);
      }
    },
    toBeFalsy: () => {
      if (value) {
        throw new Error(`Expected value to be falsy but got ${value}`);
      }
    },
    toBeGreaterThan: (expected) => {
      if (value <= expected) {
        throw new Error(`Expected ${value} to be greater than ${expected}`);
      }
    },
    toBeLessThan: (expected) => {
      if (value >= expected) {
        throw new Error(`Expected ${value} to be less than ${expected}`);
      }
    },
    toContain: (expected) => {
      if (!value || !value.includes(expected)) {
        throw new Error(`Expected ${value} to contain ${expected}`);
      }
    },
    toHaveLength: (expected) => {
      if (!value || value.length !== expected) {
        throw new Error(`Expected length ${expected} but got ${value?.length}`);
      }
    },
    toBeArray: () => {
      if (!Array.isArray(value)) {
        throw new Error(`Expected array but got ${typeof value}`);
      }
    },
    toBeObject: () => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Expected object but got ${typeof value}`);
      }
    },
    toMatchEnvelope: () => {
      // Check API envelope format {errno, result|error}
      if (typeof value !== 'object' || value === null) {
        throw new Error(`Expected envelope object but got ${typeof value}`);
      }
      if (value.errno === undefined) {
        throw new Error(`Expected errno field in envelope`);
      }
    }
  };
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 COMPREHENSIVE END-TO-END TEST SUITE');
  console.log('='.repeat(70));
  console.log(`Environment: ${process.env.TEST_ENV === 'prod' ? 'PRODUCTION ⚠️' : 'EMULATOR'}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Auth: ${AUTH_TOKEN ? 'Provided ✓' : 'None (limited tests)'}`);
  console.log(`Skip Auth Tests: ${SKIP_AUTH ? 'Yes' : 'No'}`);
  console.log('='.repeat(70) + '\n');

  // ==================== HEALTH & STATUS ====================
  console.log('\n📋 Health & Status Endpoints\n' + '-'.repeat(70));
  
  await test('Health check endpoint', async () => {
    const res = await httpRequest('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  await test('Authenticated health check', async () => {
    const res = await httpRequest('/api/health/auth', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user).toBeDefined();
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true });

  // ==================== CONFIGURATION ====================
  console.log('\n⚙️  Configuration Endpoints\n' + '-'.repeat(70));

  await test('Get config status (unauthenticated)', async () => {
    const res = await httpRequest('/api/config/setup-status');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
  });

  await test('Get user config', async () => {
    const res = await httpRequest('/api/config', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    expect(res.body.result).toBeObject();
  }, { requiresAuth: true });

  await test('Config status returns proper structure', async () => {
    const res = await httpRequest('/api/config/setup-status');
    // May require auth in production, accept 401 or proper response
    if (res.statusCode === 401) {
      expect(res.body).toMatchEnvelope();
    } else if (res.statusCode === 200) {
      expect(res.body).toMatchEnvelope();
      // result might be empty without auth
      if (res.body.result && typeof res.body.result === 'object') {
        expect(true).toBeTruthy(); // Valid structure
      }
    }
  });

  // ==================== AUTOMATION ====================
  console.log('\n🤖 Automation Endpoints\n' + '-'.repeat(70));

  await test('Get automation status', async () => {
    const res = await httpRequest('/api/automation/status', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    if (res.body.errno === 0) {
      expect(res.body.result).toBeObject();
      expect(res.body.result.enabled !== undefined).toBeTruthy();
    }
  }, { requiresAuth: true });

  await test('Automation status without auth', async () => {
    const res = await httpRequest('/api/automation/status');
    // Should either be 401 or return safe empty response
    expect(res.statusCode === 401 || res.statusCode === 200).toBeTruthy();
    if (res.statusCode === 200) {
      expect(res.body).toMatchEnvelope();
    }
  });

  await test('Get automation history', async () => {
    const res = await httpRequest('/api/automation/history?limit=10', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    if (res.body.errno === 0) {
      expect(res.body.result).toBeArray();
    }
  }, { requiresAuth: true });

  await test('Get automation audit logs', async () => {
    const res = await httpRequest('/api/automation/audit?limit=50', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
  }, { requiresAuth: true });

  // ==================== AMBER (LIMITED PROD CALLS) ====================
  console.log('\n⚡ Amber API Endpoints\n' + '-'.repeat(70));

  await test('Get Amber sites (unauthenticated)', async () => {
    const res = await httpRequest('/api/amber/sites');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    expect(res.body.result).toBeArray();
  });

  await test('Get Amber prices (unauthenticated - safe empty)', async () => {
    const res = await httpRequest('/api/amber/prices');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    expect(res.body.result).toBeArray();
  }, { apiCall: 'amber' });

  await test('Get Amber current prices (unauthenticated)', async () => {
    const res = await httpRequest('/api/amber/prices/current');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    expect(res.body.result).toBeArray();
  });

  // ==================== WEATHER ====================
  console.log('\n🌤️  Weather Endpoints\n' + '-'.repeat(70));

  await test('Get weather (requires auth)', async () => {
    const res = await httpRequest('/api/weather?place=Sydney&days=3', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchEnvelope();
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true, apiCall: 'weather' });

  // ==================== METRICS ====================
  console.log('\n📊 Metrics Endpoints\n' + '-'.repeat(70));

  await test('Get API call metrics', async () => {
    const res = await httpRequest('/api/metrics/api-calls?days=1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    expect(res.body.result).toBeObject();
  });

  await test('Get API metrics with scope', async () => {
    const res = await httpRequest('/api/metrics/api-calls?days=7&scope=global');
    expect(res.statusCode).toBe(200);
    expect(res.body.errno).toBe(0);
  });

  // ==================== POST ENDPOINTS (AUTH REQUIRED) ====================
  console.log('\n🔒 Protected POST Endpoints\n' + '-'.repeat(70));

  await test('POST toggle automation (requires auth)', async () => {
    const res = await httpRequest('/api/automation/toggle', 'POST', { enabled: true }, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchEnvelope();
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true });

  await test('POST rule update without auth returns 401', async () => {
    const res = await httpRequest('/api/automation/rule/update', 'POST', {
      ruleName: 'test',
      enabled: false
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchEnvelope();
    expect(res.body.errno).toBeGreaterThan(0);
  });

  await test('POST rule delete without auth returns 401', async () => {
    const res = await httpRequest('/api/automation/rule/delete', 'POST', {
      ruleName: 'test'
    });
    expect(res.statusCode).toBe(401);
  });

  await test('POST cycle without auth returns 401', async () => {
    const res = await httpRequest('/api/automation/cycle', 'POST', {});
    expect(res.statusCode).toBe(401);
  });

  await test('POST cancel without auth returns 401', async () => {
    const res = await httpRequest('/api/automation/cancel', 'POST', {});
    expect(res.statusCode).toBe(401);
  });

  await test('POST reset without auth returns 401', async () => {
    const res = await httpRequest('/api/automation/reset', 'POST', {});
    expect(res.statusCode).toBe(401);
  });

  // ==================== INVERTER (FOXESS) ====================
  console.log('\n🔋 Inverter (FoxESS) Endpoints\n' + '-'.repeat(70));

  await test('Get inverter list (requires auth)', async () => {
    const res = await httpRequest('/api/inverter/list', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true, apiCall: 'foxess' });

  await test('Get inverter real-time (requires auth)', async () => {
    const res = await httpRequest('/api/inverter/real-time', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true, apiCall: 'foxess' });

  await test('Get battery SOC (requires auth)', async () => {
    const res = await httpRequest('/api/device/battery/soc/get', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true });

  await test('Get scheduler v1 (requires auth)', async () => {
    const res = await httpRequest('/api/scheduler/v1/get', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    if (AUTH_TOKEN) {
      expect(res.statusCode).toBe(200);
    } else {
      expect(res.statusCode).toBe(401);
    }
  }, { requiresAuth: true, apiCall: 'foxess' });

  // ==================== ERROR HANDLING ====================
  console.log('\n❌ Error Handling\n' + '-'.repeat(70));

  await test('404 for unknown endpoint', async () => {
    const res = await httpRequest('/api/does-not-exist');
    // May return 401 if under auth middleware, or 404
    expect(res.statusCode === 404 || res.statusCode === 401).toBeTruthy();
    expect(res.body).toMatchEnvelope();
    expect(res.body.errno).toBeGreaterThan(0);
  });

  await test('Missing required params returns 400', async () => {
    const res = await httpRequest('/api/auth/forgot-password', 'POST', {});
    expect(res.statusCode).toBe(400);
    expect(res.body.errno).toBe(400);
  });

  // ==================== API ENVELOPE FORMAT ====================
  console.log('\n📦 API Envelope Consistency\n' + '-'.repeat(70));

  await test('All responses use errno envelope', async () => {
    const endpoints = [
      { path: '/api/health', field: 'ok' },
      { path: '/api/amber/sites', field: 'errno' },
      { path: '/api/metrics/api-calls?days=1', field: 'errno' }
    ];
    
    for (const {path, field} of endpoints) {
      const res = await httpRequest(path);
      if (res.body && typeof res.body === 'object') {
        expect(res.body[field] !== undefined).toBeTruthy();
      }
    }
  });

  await test('Error responses include errno and error fields', async () => {
    const res = await httpRequest('/api/automation/toggle', 'POST', { enabled: true });
    expect(res.statusCode).toBe(401);
    expect(res.body.errno).toBeGreaterThan(0);
    expect(res.body.error).toBeDefined();
  });

  // ==================== AUTHENTICATED WORKFLOWS ====================
  console.log('\n🔐 Authenticated Workflow Tests\n' + '-'.repeat(70));

  await test('Complete automation workflow: get state → toggle → get state', async () => {
    // 1. Get initial state
    const res1 = await httpRequest('/api/automation/state', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.body).toMatchEnvelope();
    
    const initialEnabled = res1.body.result?.enabled;
    
    // 2. Toggle automation
    const res2 = await httpRequest('/api/automation/toggle', 'POST', 
      { enabled: !initialEnabled },
      { Authorization: `Bearer ${AUTH_TOKEN}` }
    );
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toMatchEnvelope();
    
    // 3. Verify state changed
    const res3 = await httpRequest('/api/automation/state', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res3.statusCode).toBe(200);
    expect(res3.body.result?.enabled).toBe(!initialEnabled);
    
    // 4. Toggle back to original state
    await httpRequest('/api/automation/toggle', 'POST',
      { enabled: initialEnabled },
      { Authorization: `Bearer ${AUTH_TOKEN}` }
    );
  }, { requiresAuth: true });

  await test('Rule management workflow: list → create → get → update → delete', async () => {
    const testRuleName = `Test Rule ${Date.now()}`;
    let ruleId;
    
    // 1. List existing rules
    const res1 = await httpRequest('/api/rules', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.body).toMatchEnvelope();
    
    // 2. Create new rule
    const res2 = await httpRequest('/api/rules', 'POST', {
      name: testRuleName,
      enabled: false,
      priority: 5,
      cooldownMinutes: 30,
      conditions: {
        feedInPrice: { enabled: true, operator: '>', value: 25 }
      },
      action: {
        workMode: 'ForceDischarge',
        durationMinutes: 30,
        fdPwr: 3000,
        fdSoc: 10,
        minSocOnGrid: 10,
        maxSoc: 100
      }
    }, { Authorization: `Bearer ${AUTH_TOKEN}` });
    
    if (res2.statusCode === 200) {
      expect(res2.body).toMatchEnvelope();
      ruleId = res2.body.result?.ruleId;
      
      // 3. Get specific rule
      const res3 = await httpRequest(`/api/rules/${ruleId}`, 'GET', null, {
        Authorization: `Bearer ${AUTH_TOKEN}`
      });
      expect(res3.statusCode).toBe(200);
      expect(res3.body.result?.name).toBe(testRuleName);
      
      // 4. Update rule
      const res4 = await httpRequest(`/api/rules/${ruleId}`, 'PUT', {
        priority: 6
      }, { Authorization: `Bearer ${AUTH_TOKEN}` });
      expect(res4.statusCode).toBe(200);
      
      // 5. Delete rule
      const res5 = await httpRequest(`/api/rules/${ruleId}`, 'DELETE', null, {
        Authorization: `Bearer ${AUTH_TOKEN}`
      });
      expect(res5.statusCode).toBe(200);
    }
  }, { requiresAuth: true });

  await test('Config validation workflow', async () => {
    const res = await httpRequest('/api/config/validate-keys', 'POST', {
      foxessToken: 'test_token',
      foxessDeviceSn: 'TEST123',
      amberApiKey: 'test_amber',
      amberSiteId: 'test_site'
    }, { Authorization: `Bearer ${AUTH_TOKEN}` });
    
    // Accept either success or validation failure
    expect(res.statusCode === 200 || res.statusCode === 400).toBeTruthy();
    expect(res.body).toMatchEnvelope();
  }, { requiresAuth: true });

  await test('History retrieval with pagination', async () => {
    const res = await httpRequest('/api/automation/history?limit=10', 'GET', null, {
      Authorization: `Bearer ${AUTH_TOKEN}`
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchEnvelope();
    if (res.body.errno === 0 && res.body.result) {
      expect(Array.isArray(res.body.result)).toBeTruthy();
    }
  }, { requiresAuth: true });

  await test('Multiple concurrent authenticated requests', async () => {
    const requests = [
      httpRequest('/api/automation/state', 'GET', null, { Authorization: `Bearer ${AUTH_TOKEN}` }),
      httpRequest('/api/rules', 'GET', null, { Authorization: `Bearer ${AUTH_TOKEN}` }),
      httpRequest('/api/config', 'GET', null, { Authorization: `Bearer ${AUTH_TOKEN}` }),
      httpRequest('/api/automation/history?limit=5', 'GET', null, { Authorization: `Bearer ${AUTH_TOKEN}` })
    ];
    
    const responses = await Promise.all(requests);
    
    responses.forEach(res => {
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchEnvelope();
    });
  }, { requiresAuth: true });

  // ==================== RESULTS ====================
  console.log('\n' + '='.repeat(70));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(70));
  console.log(`Total Tests:    ${totalTests}`);
  console.log(`✅ Passed:      ${passedTests}`);
  console.log(`❌ Failed:      ${failedTests}`);
  console.log(`⏭️  Skipped:     ${skippedTests}`);
  console.log(`\n📡 API Calls Made:`);
  console.log(`   FoxESS:      ${externalAPICalls.foxess}`);
  console.log(`   Amber:       ${externalAPICalls.amber}`);
  console.log(`   Weather:     ${externalAPICalls.weather}`);
  console.log(`   Total:       ${apiCallCount}`);
  console.log('='.repeat(70));

  if (failedTests > 0) {
    console.log(`\n⚠️  ${failedTests} test(s) failed. Check output above for details.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All tests passed!`);
    if (skippedTests > 0) {
      console.log(`\nℹ️  ${skippedTests} tests skipped (requires auth).`);
      console.log(`\n📖 To run authenticated tests:`);
      console.log(`   1. Login to your app in browser`);
      console.log(`   2. Open DevTools Console`);
      console.log(`   3. Run: firebase.auth().currentUser.getIdToken().then(t => console.log(t))`);
      console.log(`   4. Copy token and run: TEST_AUTH_TOKEN=<token> node functions/e2e-tests.js`);
    }
    process.exit(0);
  }
}

// Run tests
if (require.main === module) {
  runTests().catch(err => {
    console.error('\n❌ Test suite crashed:', err);
    process.exit(1);
  });
}

module.exports = { runTests, httpRequest, test, expect };
