/**
 * BROWSER CONSOLE SCRIPT
 * 
 * Paste this into the browser console on https://inverter-automation-firebase.web.app
 * to manually end the orphan rule
 */

// Get the current user's ID token
firebase.auth().currentUser.getIdToken().then(idToken => {
  // End the orphan rule
  fetch('/api/automation/rule/end', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({
      ruleId: 'empty_some_more_good_sun_tomorrow',
      endTime: Date.now()
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.errno === 0) {
      console.log('✅ SUCCESS! Orphan rule ended:');
      console.log(`   Rule: ${data.result.ruleName}`);
      console.log(`   Duration: ${Math.round(data.result.durationMs / 1000)}s`);
      console.log('   The ROI calculator will now show this as "✓ Done"');
    } else {
      console.error('❌ Error:', data.error);
    }
  })
  .catch(err => console.error('❌ Request error:', err));
});
