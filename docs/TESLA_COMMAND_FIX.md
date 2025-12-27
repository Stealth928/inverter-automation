# Tesla Command Fix - "routable_message empty" Error

## The Problem

After implementing signed commands, charging commands fail with:
```
✗ Failed to start charging: routable_message empty
```

## Root Cause

**You likely need to pair your app with your vehicle.** This is called "Virtual Key Pairing" and is a security requirement Tesla added.

The "routable_message empty" error suggests Tesla's servers cannot deliver commands to the vehicle. The most common cause is missing virtual key pairing, though other issues (wrong regional URL, missing OAuth scopes, vehicle asleep, or signing errors) could also cause this.

## The Solution: Virtual Key Pairing

### Why This Is Required

Tesla Fleet API requires TWO levels of authentication:
1. **OAuth tokens** - Proves you own the Tesla account ✓ (you have this)
2. **Virtual key pairing** - Proves the app is authorized to control your specific vehicle ❌ (likely missing)

### How to Pair Your Vehicle

**Use Tesla's documented pairing flow:**

1. **Complete backend setup** (automated button in UI):
   - Generates cryptographic keys
   - Saves to backend
   - Hosts public key at `/.well-known/appspecific/com.tesla.3p.public-key.pem`
   - Registers with Tesla Fleet API

2. **Click "🔑 Pair Virtual Key" button**:
   - Opens `https://tesla.com/_ak/<your-domain>`
   - Tesla app launches automatically
   - Follow prompts to complete pairing
   - No menu hunting required!

3. **Test commands**:
   - After pairing, charging commands should work
   - "routable_message empty" errors should be resolved (if pairing was the issue)

**Note:** Don't try to navigate through Tesla app menus manually. Always use the `tesla.com/_ak/` link flow.

## Technical Details

### What Tesla Checks

When you send a signed command:

1. **OAuth token valid?** ✓ (works - you can list vehicles)
2. **Command signed with registered key?** ✓ (works - no signature errors)
3. **Virtual key paired with vehicle?** ❌ **THIS IS MISSING**

Without #3, Tesla's backend receives the command but refuses to route it to the vehicle for security.

### Public Key Hosting

Tesla requires your public key at:
```
https://inverter-automation-firebase.web.app/.well-known/appspecific/com.tesla.3p.public-key.pem
```

**Current status:** File exists but needs to be updated with YOUR generated key (not the old one).

### Register Endpoint

The "register" endpoint must be called to tell Tesla where to find your public key:

```bash
POST https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/partner_accounts/register
Authorization: Bearer <partner-token>

Body:
{
  "domain": "inverter-automation-firebase.web.app"
}
```

This is what the automated setup button does.

## Implementation Status

✅ **Completed:**
- Cryptographic key generation (browser-based)
- Private key storage (Firestore)
- Command signing logic
- Signed command endpoints

⏳ **In Progress:**
- Public key deployment to `.well-known` path
- Automated register endpoint call
- Virtual key pairing instructions in UI

❌ **Missing (causes "routable_message empty"):**
- Virtual key pairing between your app and vehicle
- This MUST be done via Tesla mobile app
- Cannot be automated - requires physical confirmation

## Next Steps

1. **Click "🚀 Complete Setup (Auto)" button** in Tesla Integration page
   - Generates keys
   - Saves backend config
   - Hosts/validates public key at `/.well-known/appspecific/com.tesla.3p.public-key.pem`
   - Calls `/register` endpoint

2. **Click "🔑 Pair Virtual Key" button**
   - Opens `https://tesla.com/_ak/inverter-automation-firebase.web.app`
   - Or shows QR code
   - Complete pairing in Tesla app (automatic flow)

3. **Test commands**
   - After pairing, commands should work
   - If "routable_message empty" persists, check:
     - Regional base URL (NA vs EU vs CN)
     - OAuth scopes (vehicle_device_data, vehicle_cmds, vehicle_charging_cmds)
     - Vehicle is online (not asleep)
     - Commands are using signed command endpoints

## Why This Wasn't Clear

Tesla's documentation is scattered:
- The "Vehicle Command Protocol required" error suggests you need signed commands
- But it doesn't explicitly connect "routable_message empty" to missing pairing
- The pairing step is in a separate virtual keys section
- The `tesla.com/_ak/` flow isn't prominently featured
- Most third-party apps handle this during onboarding

## References

- [Tesla Fleet API - Virtual Keys](https://developer.tesla.com/docs/fleet-api/virtual-keys/overview)
- [Tesla Fleet API - Getting Started](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api)
- [Vehicle Command Endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands)

---

**Status:** Automated setup ready, waiting for manual virtual key pairing via mobile app.

**Date:** December 25, 2024
