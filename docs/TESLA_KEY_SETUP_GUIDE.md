# Tesla Command Signing - Quick Setup Guide

## Problem
When trying to start/stop charging, you see:
```
✗ Failed to start charging: Private key not configured. Please add your Tesla command signing key in Settings.
```

## Solution: Generate and Upload Your Signing Key

### Step 1: Generate Key Pair (One-Time Setup)

Open PowerShell or Terminal and run:

```bash
# Generate private key
openssl ecparam -name prime256v1 -genkey -noout -out tesla-private-key.pem

# Derive public key  
openssl ec -in tesla-private-key.pem -pubout -out tesla-public-key.pem
```

This creates two files:
- `tesla-private-key.pem` - Keep this secret! Never share it.
- `tesla-public-key.pem` - You'll register this with Tesla.

### Step 2: Upload Private Key to Your Account

1. Go to **Tesla Integration** page in the app
2. Scroll to **"🔐 Vehicle Command Signing"** section
3. Open `tesla-private-key.pem` in a text editor
4. Copy the entire contents (including `-----BEGIN EC PRIVATE KEY-----` and `-----END EC PRIVATE KEY-----`)
5. Paste into the textarea
6. Click **"Save Private Key"**

You should see: ✓ Private key saved successfully!

### Step 3: Register Public Key with Tesla

1. Click **"Get Public Key"** button
2. Your public key will appear in a text box
3. Click **"📋 Copy to Clipboard"**
4. Click **"Open Tesla Developer Portal"** (or visit https://developer.tesla.com)
5. Sign in and navigate to your application
6. Go to **"Vehicle Command Keys"** section
7. Click **"Add Key"** and paste your public key
8. Save

### Step 4: Test Commands

Now try your charging commands again:
- Start Charging
- Stop Charging
- Set Charging Amps
- Set Charge Limit

They should work! ✓

## Troubleshooting

### "No private key found"
- You haven't uploaded your private key yet (Step 2)
- Re-upload if you deleted it

### "Invalid signature"
- Public key not registered with Tesla (Step 3)
- Wrong public key registered (regenerate and re-register)
- Key mismatch (private and public don't match - regenerate both)

### "Unauthorized"
- Firebase authentication expired - refresh the page
- Tesla credentials not configured - check OAuth connection

## Security Notes

- **Private key** = stays on your machine and in Firestore (encrypted at rest)
- **Public key** = registered with Tesla (safe to share with Tesla only)
- Keys are per-user - each account needs their own key pair
- Private key never transmitted to frontend JavaScript
- All signing happens server-side

## Technical Details

**Algorithm:** ECDSA with P-256 curve and SHA-256 hash  
**Format:** PEM (Privacy-Enhanced Mail)  
**Storage:** Firestore at `users/{your-uid}/config/tesla`  
**Security:** Firestore rules restrict access to authenticated user only

## Links

- [Full Documentation](TESLA_SIGNED_COMMANDS.md)
- [Implementation Summary](TESLA_SIGNED_COMMANDS_IMPLEMENTATION.md)
- [API Reference](API.md#tesla-integration)
- [Tesla Developer Portal](https://developer.tesla.com)

---

**Last Updated:** December 25, 2024
