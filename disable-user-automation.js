#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PROJECT_ID = 'inverter-automation-firebase';
const OAUTH_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';

function printUsage() {
  console.log([
    'Usage:',
    '  node disable-user-automation.js <email>',
    '',
    'Example:',
    '  node disable-user-automation.js gavinhborla@gmail.com',
    '',
    'Prerequisites:',
    '  - firebase CLI logged in (firebase login)',
    '  - Access to the target Firebase project'
  ].join('\n'));
}

function resolveFirebaseToolsConfigPath() {
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'firebase', 'firebase-tools.json'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'firebase', 'firebase-tools.json')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function refreshAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId || OAUTH_CLIENT_ID
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to refresh Firebase CLI token: ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + (Number(data.expires_in || 3600) * 1000)
  };
}

async function getGoogleAccessToken() {
  const configPath = resolveFirebaseToolsConfigPath();
  if (!configPath) {
    throw new Error('firebase-tools.json not found. Run `firebase login` first.');
  }

  const cfg = readJson(configPath);
  const tokens = cfg.tokens || {};
  const now = Date.now();
  const expiresAt = Number(tokens.expires_at || 0);
  const accessToken = String(tokens.access_token || '').trim();
  const refreshToken = String(tokens.refresh_token || '').trim();
  const clientId = String((cfg.user && cfg.user.aud) || OAUTH_CLIENT_ID);

  if (accessToken && expiresAt > now + 60 * 1000) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error('Firebase CLI refresh token not found. Run `firebase login` again.');
  }

  const refreshed = await refreshAccessToken(refreshToken, clientId);
  return refreshed.accessToken;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    body = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status} ${response.statusText}`);
    err.response = body;
    throw err;
  }

  return body;
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

function firestoreBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function findUserByEmail(accessToken, projectId, email) {
  console.log(`\n🔍 Finding user by email: ${email}`);
  
  const normalized = String(email || '').toLowerCase().trim();
  let nextPageToken = null;
  let uid = null;
  let scannedUsers = 0;
  const foundEmails = [];

  do {
    const payload = {
      targetProjectId: projectId,
      maxResults: 1000
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    const page = await httpJson('https://www.googleapis.com/identitytoolkit/v3/relyingparty/downloadAccount', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(payload)
    });

    const users = Array.isArray(page.users) ? page.users : [];
    scannedUsers += users.length;
    console.log(`  Scanned ${scannedUsers} users...`);

    for (const user of users) {
      const userEmail = String(user.email || '').toLowerCase().trim();
      if (userEmail) {
        foundEmails.push(userEmail);
        if (userEmail === normalized || userEmail.includes('gavin') || userEmail.includes('borla')) {
          console.log(`    Found candidate: ${userEmail} (uid: ${user.localId})`);
        }
      }
      if (userEmail && userEmail === normalized) {
        uid = user.localId;
        break;
      }
    }

    if (uid) break;
    nextPageToken = page.nextPageToken || null;
  } while (nextPageToken);

  if (!uid) {
    console.log(`\n⚠️  User not found with email: ${email}`);
    console.log(`\n📋 Here are all users in the system (first 20):`);
    for (let i = 0; i < Math.min(20, foundEmails.length); i++) {
      console.log(`   ${i + 1}. ${foundEmails[i]}`);
    }
    if (foundEmails.length > 20) {
      console.log(`   ... and ${foundEmails.length - 20} more`);
    }
    throw new Error(`User not found with email: ${email}`);
  }

  console.log(`✓ Found user UID: ${uid}`);
  return uid;
}

async function getAutomationState(accessToken, projectId, uid) {
  const docPath = `${firestoreBase(projectId)}/users/${uid}/automation/state`;
  
  try {
    const response = await httpJson(docPath, {
      method: 'GET',
      headers: authHeaders(accessToken)
    });
    
    return response.fields || null;
  } catch (error) {
    if (error.response?.error?.code === 5) {
      // Document not found
      return null;
    }
    throw error;
  }
}

async function disableAutomation(accessToken, projectId, uid) {
  const docPath = `${firestoreBase(projectId)}/users/${uid}/automation/state`;
  
  const updateData = {
    fields: {
      enabled: { booleanValue: false },
      disabledAt: { timestampValue: new Date().toISOString() },
      disabledReason: { stringValue: 'No credentials available - admin action' }
    }
  };

  console.log('\n🔴 Disabling automation...');
  await httpJson(docPath, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
    body: JSON.stringify(updateData)
  });
  console.log('✓ Automation state updated');
}

async function updateUserProfile(accessToken, projectId, uid) {
  const docPath = `${firestoreBase(projectId)}/users/${uid}`;
  
  const updateData = {
    fields: {
      automationEnabled: { booleanValue: false }
    }
  };

  await httpJson(docPath, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
    body: JSON.stringify(updateData)
  });
  console.log('✓ User profile updated');
}

async function main() {
  const email = process.argv[2];
  
  if (!email) {
    printUsage();
    process.exit(1);
  }

  try {
    const accessToken = await getGoogleAccessToken();
    const projectId = DEFAULT_PROJECT_ID;
    
    // Find user by email
    const uid = await findUserByEmail(accessToken, projectId, email);
    
    // Get current automation state
    const currentState = await getAutomationState(accessToken, projectId, uid);
    
    if (!currentState) {
      console.log('⚠️  No automation state found for this user');
      return;
    }
    
    const enabled = currentState.enabled?.booleanValue || false;
    console.log(`\n📊 Current automation state: enabled=${enabled}`);
    
    if (!enabled) {
      console.log('✓ Automation is already disabled');
      return;
    }
    
    // Disable automation
    await disableAutomation(accessToken, projectId, uid);
    await updateUserProfile(accessToken, projectId, uid);
    
    console.log('\n✅ Automation disabled successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response);
    }
    process.exit(1);
  }
}

main();
