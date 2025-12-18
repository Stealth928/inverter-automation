#!/bin/bash
# Script to manually end orphan rules using Firebase REST API
# Requires: GOOGLE_APPLICATION_CREDENTIALS environment variable set to service account key path

PROJECT_ID="inverter-automation-firebase"
API_URL="https://api-etjmk6bmtq-uc.a.run.app"

echo "🔍 Getting list of users with orphan active rules..."

# This script would need Firebase credentials
# For now, we'll document the manual process

cat << 'EOF'

To manually end an orphan rule, use one of these methods:

METHOD 1: Using Firebase Console
================================
1. Go to Firebase Console: https://console.firebase.google.com/project/inverter-automation-firebase
2. Navigate to Firestore Database
3. Find the user document in /users/{userId}
4. Find /automation/state document
5. Edit activeRule and set it to empty/null
6. This will stop showing the rule as active

METHOD 2: Using Firebase CLI (local development)
=================================================
firebase firestore:delete users/{userId}/automation/state/activeRule

METHOD 3: Using the deployed API endpoint
==========================================
POST https://api-etjmk6bmtq-uc.a.run.app/api/automation/rule/end
Headers:
  Authorization: Bearer {ID_TOKEN}
  Content-Type: application/json
Body:
  {
    "ruleId": "empty_some_more_good_sun_tomorrow"
  }

To get your ID token from the browser console:
  firebase.auth().currentUser.getIdToken().then(t => console.log(t))

EOF
