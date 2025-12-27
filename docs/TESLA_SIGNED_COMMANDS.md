# Tesla Vehicle Command Protocol - Signed Commands

## Overview

As of October 2023, Tesla deprecated direct REST API commands for vehicle control. All commands now require cryptographic signatures using the **Tesla Vehicle Command Protocol**. This document explains the implementation in the Inverter Automation system.

## Background

Previously, commands like `charge_start`, `charge_stop`, and `set_charging_amps` could be sent directly to Tesla's REST API endpoints:
```
POST /api/1/vehicles/{id}/command/charge_start
```

These endpoints now return:
```json
{
  "response": null,
  "error": "Tesla Vehicle Command Protocol required, please refer to the documentation",
  "error_description": ""
}
```

## Solution: Signed Commands

Commands must now be sent to the signed command endpoint with cryptographic signatures:
```
POST /api/1/vehicles/{id}/signed_command
```

**Payload format:**
```json
{
  "command": "charge_start",
  "parameters": { ... },
  "signature": "base64-encoded-ecdsa-signature"
}
```

## Implementation

### 1. Key Generation

Generate an ECDSA P-256 (prime256v1) key pair:

```bash
# Generate private key
openssl ecparam -name prime256v1 -genkey -noout -out tesla-private-key.pem

# Derive public key
openssl ec -in tesla-private-key.pem -pubout -out tesla-public-key.pem
```

### 2. Key Storage

Private keys are stored per-user in Firestore:
```
users/{userId}/config/tesla
```

**Security notes:**
- Keys are stored in PEM format
- Only accessible to the authenticated user
- Never transmitted to frontend
- Used only server-side for signing

### 3. Public Key Registration

Register the public key with Tesla Fleet API:

1. Visit https://developer.tesla.com
2. Navigate to your application
3. Add the public key to "Vehicle Command Keys"
4. Tesla validates the key format and stores it

**API endpoint to retrieve public key:**
```
GET /api/tesla/public-key
Authorization: Bearer <firebase-id-token>

Response:
{
  "errno": 0,
  "result": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}
```

### 4. Command Signing Process

When sending a command:

1. **Create canonical payload:**
   ```json
   {
     "command": "charge_start",
     "parameters": { ... }
   }
   ```

2. **Sign with ECDSA SHA-256:**
   ```javascript
   const sign = crypto.createSign('SHA256');
   sign.update(JSON.stringify(payload));
   const signature = sign.sign(privateKey, 'base64');
   ```

3. **Send to Tesla:**
   ```json
   {
     "command": "charge_start",
     "parameters": { ... },
     "signature": "MEUCIQDxxxxx..."
   }
   ```

### 5. Supported Commands

All charging commands now use signed protocol:

- `charge_start` - Start charging
- `charge_stop` - Stop charging
- `set_charging_amps` - Set charging current limit
- `set_charge_limit` - Set battery charge limit

## API Endpoints

### Save Private Key
```
POST /api/tesla/save-private-key
Authorization: Bearer <firebase-id-token>

Body:
{
  "privateKey": "-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
}

Response:
{
  "errno": 0,
  "result": { "success": true },
  "msg": "Private key saved successfully"
}
```

### Get Public Key
```
GET /api/tesla/public-key
Authorization: Bearer <firebase-id-token>

Response:
{
  "errno": 0,
  "result": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  },
  "msg": "Use this public key to register with Tesla Fleet API at https://developer.tesla.com"
}
```

### Send Commands (Internal)

Commands are sent automatically when using the existing endpoints:

```
POST /api/tesla/vehicles/{vehicleTag}/charge/start
POST /api/tesla/vehicles/{vehicleTag}/charge/stop
POST /api/tesla/vehicles/{vehicleTag}/charge/set-amps
POST /api/tesla/vehicles/{vehicleTag}/charge/set-limit
```

The backend now handles signing transparently.

## Setup Instructions

### For New Users

1. **Generate key pair:**
   ```bash
   openssl ecparam -name prime256v1 -genkey -noout -out tesla-private-key.pem
   openssl ec -in tesla-private-key.pem -pubout -out tesla-public-key.pem
   ```

2. **Save private key via API:**
   ```bash
   curl -X POST https://your-domain.com/api/tesla/save-private-key \
     -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"privateKey": "-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"}'
   ```

3. **Get public key:**
   ```bash
   curl https://your-domain.com/api/tesla/public-key \
     -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
   ```

4. **Register with Tesla:**
   - Visit https://developer.tesla.com
   - Navigate to your application
   - Add the public key under "Vehicle Command Keys"

5. **Test commands:**
   Commands will now use signed protocol automatically.

### For Existing Users

If you were using the old REST API endpoints, you'll see:
```
Tesla Vehicle Command Protocol required, please refer to the documentation
```

Follow the setup instructions above to migrate to signed commands.

## Security Considerations

- **Private key protection:** Keys stored in Firestore with user-level security rules
- **No key exposure:** Private keys never sent to frontend
- **Signature verification:** Tesla validates signatures server-side
- **Key rotation:** Users can generate new keys and re-register at any time

## Troubleshooting

### Error: "No private key found"
Generate and save a key pair using the setup instructions.

### Error: "Invalid signature"
- Ensure public key is registered with Tesla Fleet API
- Verify private key is valid PEM format
- Check key matches registered public key

### Error: "Unauthorized"
- Verify Firebase authentication token is valid
- Ensure user has Tesla integration enabled

## Implementation Details

**Code locations:**
- Key management: [functions/api/tesla.js](../functions/api/tesla.js) lines 250-370
- Command signing: `signCommand()` function
- Signed command sender: `sendSignedCommand()` function
- API endpoints: [functions/index.js](../functions/index.js) lines 4938-5008

**Algorithm:** ECDSA with P-256 curve and SHA-256 hash

**Payload format:** Canonical JSON (no whitespace, sorted keys not required)

**Signature encoding:** Base64

## References

- [Tesla Fleet API Documentation](https://developer.tesla.com/docs/fleet-api)
- [Tesla Vehicle Command Protocol](https://developer.tesla.com/docs/fleet-api#vehicle-commands)
- [OpenSSL ECDSA Documentation](https://www.openssl.org/docs/man1.1.1/man1/openssl-ec.html)

---

**Implementation Date:** December 25, 2024  
**Last Updated:** December 25, 2024
