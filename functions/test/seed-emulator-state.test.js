'use strict';

const { TEST_USERS } = require('../scripts/emulator-test-user');
const { hasNonSeedCredentialOverride } = require('../scripts/seed-emulator-state');

describe('seed-emulator-state overwrite protection', () => {
  test('does not preserve when credentials still match the seed profile', () => {
    const seedUser = TEST_USERS.find((entry) => entry.provider === 'foxess');

    expect(hasNonSeedCredentialOverride(seedUser, {
      deviceProvider: 'foxess',
      deviceSn: 'FOX-SEED-1001',
      foxessToken: 'FOX_SEED_TOKEN_1001',
      setupComplete: true
    }, {})).toBe(false);
  });

  test('preserves FoxESS user when live credentials replace the seeded ones', () => {
    const seedUser = TEST_USERS.find((entry) => entry.provider === 'foxess');

    expect(hasNonSeedCredentialOverride(seedUser, {
      deviceProvider: 'foxess',
      deviceSn: 'LIVE-SN-9001',
      foxessToken: 'LIVE_TOKEN_9001',
      setupComplete: true
    }, {})).toBe(true);
  });

  test('preserves when a seeded account has been repurposed to another provider', () => {
    const seedUser = TEST_USERS.find((entry) => entry.provider === 'foxess');

    expect(hasNonSeedCredentialOverride(seedUser, {
      deviceProvider: 'sungrow',
      sungrowDeviceSn: 'SG-LIVE-1',
      sungrowUsername: 'live@example.com',
      setupComplete: true
    }, {
      sungrowPassword: 'secret'
    })).toBe(true);
  });
});
