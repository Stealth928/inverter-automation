/**
 * Test: Master automation switch toggle now clears segments even without activeRule
 * Scenario: Disable automation when there's NO activeRule, verify segments are cleared
 */

const API_URL = 'http://127.0.0.1:5001/inverter-automation-firebase/us-central1/api';
const TEST_USER_ID = 'test-user-123';

// Helper to make authenticated fetch requests
async function apiFetch(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEST_USER_ID}`
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const resp = await fetch(`${API_URL}${path}`, options);
  const data = await resp.json();
  return { status: resp.status, data };
}

async function runTest() {
  try {
    console.log('\n🧪 TEST: Master switch toggle clears segments even with NO activeRule\n');
    
    // Step 1: Check current automation status
    console.log('1️⃣  Checking current automation status...');
    const { data: statusData } = await apiFetch('/automation/status');
    console.log('   Status response:', JSON.stringify(statusData, null, 2));
    
    // Step 2: Disable automation (simulate user toggling master switch OFF)
    console.log('\n2️⃣  Disabling automation (master switch OFF)...');
    const { data: enableData } = await apiFetch('/automation/enable', 'POST', { enabled: false });
    console.log('   Enable response:', JSON.stringify(enableData, null, 2));
    
    // Step 3: Run automation cycle (this should clear segments even with NO activeRule)
    console.log('\n3️⃣  Running automation cycle (should clear segments even with NO activeRule)...');
    const { data: cycleData } = await apiFetch('/automation/cycle', 'POST', {});
    console.log('   Cycle response:', JSON.stringify(cycleData, null, 2));
    
    // Step 4: Verify result
    console.log('\n4️⃣  Verification:');
    if (cycleData.result && cycleData.result.segmentsCleared) {
      console.log('   ✅ PASS: Segments were cleared (segmentsCleared=true)');
    } else {
      console.log('   ❌ FAIL: segmentsCleared was not true');
      console.log('   Full result:', JSON.stringify(cycleData.result, null, 2));
    }
    
    console.log('\n✅ Test completed!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTest();
