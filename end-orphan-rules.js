/**
 * Direct script to end orphan rule using Firebase Admin SDK
 * No authentication needed - runs with service account permissions
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, 'functions', '.env.local');
// Try to load from environment or default service account
let serviceAccount;
try {
  // For deployed functions, admin is pre-initialized
  if (!admin.apps.length) {
    // Load from file if running locally
    require('dotenv').config({ path: serviceAccountPath });
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath) {
      serviceAccount = require(keyPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'inverter-automation-firebase'
      });
    } else {
      // Use default credential chain
      admin.initializeApp({
        projectId: 'inverter-automation-firebase'
      });
    }
  }
} catch (e) {
  console.log('Using default credential chain...');
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'inverter-automation-firebase'
    });
  }
}

const db = admin.firestore();

async function endOrphanRule() {
  try {
    console.log('🔍 Searching for users with orphan active rules...\n');

    // Get all users
    const usersSnapshot = await db.collection('users').get();
    let fixedCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      
      // Get automation state
      const stateDoc = await db.collection('users').doc(userId).collection('automation').doc('state').get();
      const state = stateDoc.data() || {};
      
      if (state.activeRule) {
        console.log(`👤 User: ${userId}`);
        console.log(`   Active Rule: ${state.activeRuleName || state.activeRule}`);
        console.log(`   Since: ${new Date(state.lastTriggered || Date.now()).toISOString()}`);
        
        // Get audit logs to find the activation event
        const auditSnapshot = await db.collection('users').doc(userId)
          .collection('automation')
          .doc('audit')
          .collection('logs')
          .orderBy('epochMs', 'desc')
          .limit(500)
          .get();

        let startEvent = null;
        let startTimestamp = null;

        for (const logDoc of auditSnapshot.docs) {
          const log = logDoc.data();
          if (log.activeRuleAfter === state.activeRule && log.triggered) {
            startTimestamp = log.epochMs;
            startEvent = {
              ruleName: log.ruleName,
              ruleId: state.activeRule,
              conditions: log.evaluationResults,
              allRuleEvaluations: log.allRuleEvaluations,
              action: log.actionTaken
            };
            break;
          }
        }

        if (startEvent) {
          const endTimestamp = Date.now();
          const durationMs = endTimestamp - startTimestamp;

          console.log(`   ✅ Found activation event at ${new Date(startTimestamp).toISOString()}`);
          console.log(`   📝 Creating deactivation entry...`);

          // Create the deactivation audit entry
          await db.collection('users').doc(userId)
            .collection('automation')
            .doc('audit')
            .collection('logs')
            .add({
              cycleId: `cycle_manual_end_${Date.now()}`,
              triggered: false,
              ruleName: startEvent.ruleName,
              ruleId: state.activeRule,
              evaluationResults: [],
              allRuleEvaluations: [{
                name: startEvent.ruleName,
                ruleId: state.activeRule,
                triggered: false,
                conditions: [],
                feedInPrice: null,
                buyPrice: null
              }],
              actionTaken: null,
              activeRuleBefore: state.activeRule,
              activeRuleAfter: null,
              rulesEvaluated: 0,
              cycleDurationMs: durationMs,
              manualEnd: true,
              epochMs: endTimestamp,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

          // Clear the active rule from state
          await db.collection('users').doc(userId)
            .collection('automation')
            .doc('state')
            .set({
              activeRule: null,
              activeRuleName: null,
              activeSegment: null,
              activeSegmentEnabled: false
            }, { merge: true });

          console.log(`   ⏹️  Deactivation entry created`);
          console.log(`   🕐 Duration: ${Math.round(durationMs / 1000)}s (${Math.round(durationMs / 1000 / 60)}m)`);
          console.log(`   ✅ Active rule state cleared\n`);
          fixedCount++;
        } else {
          console.log(`   ⚠️  No activation event found in audit logs\n`);
        }
      }
    }

    if (fixedCount > 0) {
      console.log(`\n🎉 FIXED: ${fixedCount} orphan rule(s) successfully ended!`);
      console.log('The ROI calculator will now show these rules as "✓ Done" instead of "🟢 Running"');
    } else {
      console.log('\n✅ No orphan active rules found.');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

endOrphanRule();
