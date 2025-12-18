/**
 * Script to manually end an orphan ongoing rule in the audit trail
 * 
 * Usage:
 *   node fix-orphan-rule.js <ruleNameOrId> [endTimeMs]
 * 
 * Examples:
 *   node fix-orphan-rule.js "empty_some_more_good_sun_tomorrow"
 *   node fix-orphan-rule.js "empty_some_more_good_sun_tomorrow" 1734556992000
 * 
 * This script makes a POST request to /api/automation/rule/end which:
 * 1. Finds the audit entry where the rule was activated
 * 2. Creates a corresponding "deactivation" entry to mark the rule as ended
 * 3. Clears the active rule from the automation state if needed
 * 4. Ensures the ROI calculator shows proper "ended" status instead of "ongoing"
 */

const https = require('https');

// Configuration
const projectId = 'inverter-automation-firebase';
const functionUrl = `https://api-etjmk6bmtq-uc.a.run.app`;

// Get arguments
const ruleId = process.argv[2];
const endTimeMs = process.argv[3] ? parseInt(process.argv[3], 10) : Date.now();
const idToken = process.argv[4] || process.env.ID_TOKEN;

if (!ruleId) {
  console.error('❌ Usage: node fix-orphan-rule.js <ruleName> [endTimeMs] [idToken]');
  console.error('');
  console.error('Arguments:');
  console.error('  ruleName     - The name or ID of the orphan rule (e.g., "empty_some_more_good_sun_tomorrow")');
  console.error('  endTimeMs    - Optional: timestamp in milliseconds (default: now)');
  console.error('  idToken      - Optional: Firebase ID token (default: from ID_TOKEN env var)');
  process.exit(1);
}

if (!idToken) {
  console.error('❌ ID token required!');
  console.error('');
  console.error('Provide it as:');
  console.error('  1. Third argument: node fix-orphan-rule.js <ruleName> <endTime> <idToken>');
  console.error('  2. Environment variable: export ID_TOKEN="your-token" && node fix-orphan-rule.js <ruleName>');
  console.error('');
  console.error('To get your ID token from browser console:');
  console.error('  firebase.auth().currentUser.getIdToken().then(token => console.log(token))');
  process.exit(1);
}

const payload = JSON.stringify({
  ruleId: ruleId,
  endTime: endTimeMs
});

const options = {
  hostname: new URL(functionUrl).hostname,
  path: '/api/automation/rule/end',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Authorization': `Bearer ${idToken}`
  }
};

console.log(`🔍 Fixing orphan rule: "${ruleId}"`);
console.log(`📅 End timestamp: ${new Date(endTimeMs).toISOString()}`);
console.log(`🚀 Calling API: POST /api/automation/rule/end`);
console.log('');

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (response.errno === 0 && response.result) {
        console.log('✅ SUCCESS! Orphan rule has been ended.');
        console.log('');
        console.log('Details:');
        console.log(`  Rule Name: ${response.result.ruleName}`);
        console.log(`  Rule ID: ${response.result.ruleId}`);
        console.log(`  Started: ${new Date(response.result.startTime).toISOString()}`);
        console.log(`  Ended: ${new Date(response.result.endTime).toISOString()}`);
        console.log(`  Duration: ${Math.round(response.result.durationMs / 1000)} seconds`);
        console.log('');
        console.log('The ROI calculator will now show this rule as "✓ Done" instead of "🟢 Running"');
      } else {
        console.error('❌ ERROR:', response.error || response.msg);
      }
    } catch (e) {
      console.error('❌ Parse error:', e.message);
      console.error('Response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
  process.exit(1);
});

req.write(payload);
req.end();
