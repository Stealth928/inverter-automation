# Tesla Integration Security & Credential Storage

## Overview

This document clarifies the per-user OAuth flow for Tesla integration in Inverter Automation.

## Architecture: Per-User OAuth

Each user brings their own Tesla OAuth app credentials:
1. User registers a Tesla OAuth app with their own client_id and client_secret
2. User provides these credentials to the Inverter Automation app
3. App uses the user's credentials to authorize access to their Tesla vehicles
4. Tokens and credentials are stored per-user, never on server

## Credential Types & Storage

### 1. Tesla OAuth App Credentials (Per-User)
- **Client ID**: Identifier for the user's Tesla OAuth app registration
- **Client Secret**: Secret for the user's OAuth app
- **Storage Location**: `users/{userId}/config/tesla` (Firestore, per-user)
- **Access Level**: Only the owning user and Cloud Functions can read/write
- **Firestore Rules**: Protected by per-user collection rules (`isOwner(userId)`)
- **Purpose**: Used during OAuth flow to exchange authorization codes for access tokens

### 2. Tesla User Tokens (Per-User)
- **Access Token**: JWT that authorizes API calls to Tesla Fleet API
- **Refresh Token**: Used to obtain new access tokens when they expire
- **Storage Location**: `users/{userId}/config/tesla` (Firestore, per-user, same doc as credentials)
- **Access Level**: Only the owning user and Cloud Functions can read/write
- **Firestore Rules**: Protected by per-user collection rules

## Flow Diagrams

### User Setup Flow
1. User creates a Tesla OAuth app at [Tesla Developer Console](https://developer.tesla.com)
2. User obtains their `client_id` and `client_secret` from their app registration
3. User navigates to "Connect Tesla" in the app
4. Frontend calls POST `/api/tesla/save-credentials` with clientId and clientSecret
5. Backend saves both to `users/{userId}/config/tesla`
6. User clicks "Authorize" → continues with OAuth flow

### OAuth Authorization Flow
1. User clicks "Authorize with Tesla"
2. Frontend calls GET `/api/tesla/oauth-authorize?idToken=<token>&clientId=<id>`
3. Backend verifies idToken and reads user's clientId from request
4. Backend redirects user to Tesla OAuth with the user's clientId
5. Tesla redirects back to `/api/tesla/oauth-callback` with `code` + `state`
6. Backend extracts clientId from state, reads clientSecret from `users/{userId}/config/tesla`
7. Backend exchanges code for tokens using user's clientId + clientSecret
8. Backend calls `saveUserTokens(userId, accessToken, refreshToken)`
9. Tokens are saved to `users/{userId}/config/tesla` ✅ **Per-user storage**
10. User is redirected to success page

### Token Usage Flow
1. Frontend needs to list vehicles → calls authenticated endpoint
2. Backend retrieves both credentials and tokens from `users/{userId}/config/tesla`
3. Backend calls Tesla Fleet API with the access token
4. If token expired, backend refreshes using the refresh token
5. Updated tokens are saved back to `users/{userId}/config/tesla`

## API Endpoints

### Save Tesla OAuth Credentials
```
POST /api/tesla/save-credentials
```
Save user's Tesla OAuth app credentials (client_id, client_secret).

**Auth**: Required

**Request Body:**
```json
{
  "clientId": "1234567890abcdef",
  "clientSecret": "abcdef1234567890"
}
```

**Response:**
```json
{
  "errno": 0,
  "msg": "Credentials saved successfully",
  "result": { "success": true }
}
```

### Check User Credentials
```
GET /api/tesla/check-config
```
Check if the current user has saved their Tesla OAuth credentials.

**Auth**: Required

**Response:**
```json
{
  "errno": 0,
  "result": {
    "configured": true,
    "hasClientId": true,
    "hasClientSecret": true
  }
}
```

### Authorize with Tesla
```
GET /api/tesla/oauth-authorize?idToken=<token>&clientId=<clientId>
```
Initiate OAuth authorization flow with user's client_id.

**Auth**: Required (via idToken query param)

**Query Parameters:**
- `idToken`: Firebase ID token (base64 encoded)
- `clientId`: User's Tesla OAuth app client ID

**Response**: Redirects to Tesla OAuth authorize page

### OAuth Callback
```
GET /api/tesla/oauth-callback?code=<code>&state=<state>
```
Handles redirect from Tesla OAuth (no auth required on this endpoint).

**Response**: Redirects to `/tesla-integration.html?oauth_success=true` or `?oauth_error=...`

### Check Connection Status
```
GET /api/tesla/status
```
Check if the current user has valid Tesla tokens.

**Auth**: Required

**Response:**
```json
{
  "errno": 0,
  "result": {
    "connected": true,
    "connectedAt": "2025-12-15T10:30:00Z",
    "expiresAt": "2025-12-22T10:30:00Z"
  }
}
```

### Disconnect Tesla
```
POST /api/tesla/disconnect
```
Remove stored Tesla tokens and credentials for the current user.

**Auth**: Required

**Response:**
```json
{
  "errno": 0,
  "result": { "success": true }
}
```

## Code References

### Saving Credentials (Always Per-User)
**File**: [`functions/api/tesla.js`](../functions/api/tesla.js#L77)

```javascript
async function saveUserCredentials(userId, clientId, clientSecret) {
  try {
    await db.collection('users').doc(userId).collection('config').doc('tesla').set({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      credentialsUpdatedAt: new Date()
    }, { merge: true });
    
    logger.info(`[TeslaAPI] OAuth credentials saved for user ${userId}`);
  } catch (error) {
    logger.error(`[TeslaAPI] Error saving credentials for user ${userId}:`, error.message);
    throw error;
  }
}
```

### OAuth Authorize (Accepts clientId from Request)
**File**: [`functions/index.js:1012`](../functions/index.js#L1012)

```javascript
app.get('/api/tesla/oauth-authorize', async (req, res) => {
  const { idToken, clientId } = req.query;  // clientId from user
  // ... state includes clientId for callback ...
  const state = Buffer.from(JSON.stringify({ 
    userId: user.uid, 
    clientId: clientId.trim(),  // Stored in state token
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64');
```

### OAuth Callback (Uses clientId from State + clientSecret from User Config)
**File**: [`functions/index.js:1098`](../functions/index.js#L1098)

```javascript
const userId = stateData.userId;
const clientId = stateData.clientId;  // Retrieved from state token

// Get user's client secret from Firestore
let clientSecret = '';
const userTeslaConfig = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
if (userTeslaConfig.exists) {
  clientSecret = userTeslaConfig.data().clientSecret;
}

// Exchange code for tokens
const tokenResponse = await fetch(tokenUrl, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,  // User's clientId
    client_secret: clientSecret,  // User's clientSecret
    redirect_uri: redirectUri
  })
});
```

### Reading Tokens (Always Per-User)
**File**: [`functions/api/tesla.js#L51`](../functions/api/tesla.js#L51)

```javascript
async function getUserTokens(userId) {
  try {
    const doc = await db.collection('users').doc(userId).collection('config').doc('tesla').get();
    if (!doc.exists) {
      throw new Error('Tesla tokens not configured');
    }
    
    const data = doc.data();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken
    };
  } catch (error) {
    logger.error(`[TeslaAPI] Error fetching tokens for user ${userId}:`, error.message);
    throw error;
  }
}
```

## Security Guarantees

✅ **Tesla credentials are strictly per-user**
- Each user stores their own clientId and clientSecret
- Every function that saves credentials accepts `userId` as a parameter
- Credentials are never stored in `shared/*` collection
- Firestore rules prevent unauthorized access to user configs

✅ **No server-side secrets**
- The app does not maintain its own Tesla OAuth registration
- No shared client credentials in environment variables or Firestore
- Each user's OAuth app credentials are isolated

✅ **Token refresh is seamless and secure**
- Refresh tokens are stored alongside access tokens (per-user)
- When tokens expire, backend refreshes automatically using stored clientSecret
- Updated tokens are saved back to per-user storage

✅ **OAuth state protection**
- State tokens include userId, clientId, timestamp, and nonce
- State tokens expire after 15 minutes
- Prevents CSRF attacks on OAuth flow

## Deployment Checklist

- [ ] Firestore rules protect `/users/{userId}/config/tesla` (per-user only)
- [ ] No Tesla OAuth app credentials in environment variables
- [ ] All calls to `saveUserCredentials()` pass valid `userId`
- [ ] Frontend calls POST `/api/tesla/save-credentials` before OAuth flow
- [ ] OAuth endpoints accept `clientId` from client request
- [ ] Firestore TTL policies enabled for automatic cache cleanup

## Troubleshooting

**Q: How do I set up Tesla integration?**
A: 
1. Go to [Tesla Developer Console](https://developer.tesla.com) and create an OAuth app
2. Copy your app's `client_id` and `client_secret`
3. In Inverter Automation, go to "Settings" → "Tesla Integration" → "Add Credentials"
4. Paste your client_id and client_secret
5. Click "Authorize" to complete OAuth flow

**Q: Where are my Tesla credentials and tokens stored?**
A: In `users/{your-user-id}/config/tesla` in Firestore. You can view this in the Firebase Console → Firestore under your user's collection.

**Q: Can I read another user's Tesla credentials?**
A: No. Firestore security rules prevent it. Only your account can access your Tesla config.

**Q: What if I want to use a different Tesla OAuth app?**
A: Update your credentials in Settings → Tesla Integration. The new credentials will be saved to your per-user config.

**Q: Are credentials synced across devices?**
A: Yes. Since credentials are stored in Firestore, any device with your Firebase credentials can access them (subject to Firestore rules).

**Q: What happens if I disconnect Tesla?**
A: All Tesla tokens and credentials are deleted from your per-user config. You'll need to re-authorize to reconnect.
