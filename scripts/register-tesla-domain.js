#!/usr/bin/env node
/**
 * One-time script: register socratesautomation.com as a Tesla Fleet API partner.
 *
 * This must be run once by the app owner before virtual-key pairing
 * (tesla.com/_ak/socratesautomation.com) will succeed for any user.
 * After a successful run it never needs to be run again.
 *
 * Usage:
 *   TESLA_CLIENT_ID=<id> TESLA_CLIENT_SECRET=<secret> node scripts/register-tesla-domain.js
 *
 * Or pass inline:
 *   node scripts/register-tesla-domain.js <clientId> <clientSecret> [region]
 */
'use strict';

const { registerTeslaPartnerDomain, createTeslaHttpClient } = require('../functions/lib/adapters/tesla-fleet-adapter');

async function main() {
  const clientId     = process.argv[2] || process.env.TESLA_CLIENT_ID;
  const clientSecret = process.argv[3] || process.env.TESLA_CLIENT_SECRET;
  const region       = process.argv[4] || process.env.TESLA_REGION || 'na';
  const domain       = 'socratesautomation.com';

  if (!clientId || !clientSecret) {
    console.error('Usage: TESLA_CLIENT_ID=<id> TESLA_CLIENT_SECRET=<secret> node scripts/register-tesla-domain.js');
    process.exit(1);
  }

  console.log(`Registering ${domain} with Tesla Fleet API (region: ${region})…`);

  const httpClient = createTeslaHttpClient({ fetchImpl: fetch });
  const result = await registerTeslaPartnerDomain({ clientId, clientSecret, domain, region }, httpClient);

  console.log('✓ Domain registration succeeded:', result);
}

main().catch((err) => {
  console.error('✗ Domain registration failed:', err.message || err);
  process.exit(1);
});
