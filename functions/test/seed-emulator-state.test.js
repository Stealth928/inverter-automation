'use strict';

const path = require('path');

const {
  TEST_PASSWORD,
  TEST_USERS,
  buildOptionalLiveFoxessSeedUid,
  buildOptionalLiveFoxessSeedUser,
  buildOptionalLiveFoxessSeedUsers
} = require('../scripts/emulator-test-user');
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

describe('optional live FoxESS seed user', () => {
  test('builds a local-only live user with sane defaults', () => {
    const seedUser = buildOptionalLiveFoxessSeedUser({
      email: 'live.test@example.com',
      deviceSn: 'LIVE-SN-001',
      foxessToken: 'LIVE-TOKEN-001',
      amberApiKey: 'amber-live-001',
      location: 'Roselands, Australia',
      inverterCapacityW: 10000,
      batteryCapacityKWh: 41.93
    });

    expect(seedUser).toEqual(expect.objectContaining({
      uid: 'seed-live-live-test-example-com',
      email: 'live.test@example.com',
      password: TEST_PASSWORD,
      provider: 'foxess',
      role: 'user'
    }));
    expect(seedUser.seedOptions).toEqual(expect.objectContaining({
      skipRuntimeCache: true
    }));
    expect(seedUser.config).toEqual(expect.objectContaining({
      deviceProvider: 'foxess',
      deviceSn: 'LIVE-SN-001',
      foxessToken: 'LIVE-TOKEN-001',
      amberApiKey: 'amber-live-001',
      weatherPlace: 'Roselands',
      location: 'Roselands, Australia',
      timezone: 'Australia/Sydney',
      inverterCapacityW: 10000,
      batteryCapacityKWh: 41.93,
      setupComplete: true,
      tourComplete: true
    }));
    expect(seedUser.config).not.toHaveProperty('amberSiteId');
    expect(seedUser.config).not.toHaveProperty('siteIdOrRegion');
  });

  test('requires the live seed credentials when a local seed file is configured', () => {
    expect(() => buildOptionalLiveFoxessSeedUser({
      email: 'live.test@example.com',
      deviceSn: 'LIVE-SN-001',
      location: 'Roselands, Australia'
    })).toThrow(/missing "foxessToken"/i);
  });

  test('builds multiple live users from shared credentials and preserves admin behavior', () => {
    const seedUsers = buildOptionalLiveFoxessSeedUsers({
      deviceSn: 'LIVE-SN-001',
      foxessToken: 'LIVE-TOKEN-001',
      amberApiKey: 'amber-live-001',
      location: 'Roselands, Australia',
      timezone: 'Australia/Sydney',
      inverterCapacityW: 10000,
      batteryCapacityKWh: 41.93,
      users: [
        {
          email: 'live.test@example.com',
          displayName: 'Live Test FoxESS',
          role: 'user'
        },
        {
          email: 'live.test.admin@example.com',
          displayName: 'Live Test FoxESS Admin',
          role: 'admin'
        }
      ]
    });

    expect(seedUsers).toHaveLength(2);
    expect(seedUsers[0]).toEqual(expect.objectContaining({
      email: 'live.test@example.com',
      role: 'user'
    }));
    expect(seedUsers[1]).toEqual(expect.objectContaining({
      email: 'live.test.admin@example.com',
      role: 'admin'
    }));
    expect(seedUsers[1].seedOptions).toEqual(expect.objectContaining({
      skipRuntimeCache: true
    }));
  });

  test('derives a stable admin uid for the admin live user email', () => {
    expect(buildOptionalLiveFoxessSeedUid('live.test.admin@gmail.com', 'admin')).toBe('seed-live-foxess-admin');
  });

  test('fails fast when live users are required but the local config file is missing', () => {
    const originalRequireFlag = process.env.EMULATOR_REQUIRE_LIVE_USERS;
    const originalConfigPath = process.env.EMULATOR_LIVE_USER_CONFIG_PATH;
    const missingConfigPath = path.join(__dirname, '__missing-live-user-config__.json');

    try {
      process.env.EMULATOR_REQUIRE_LIVE_USERS = '1';
      process.env.EMULATOR_LIVE_USER_CONFIG_PATH = missingConfigPath;

      expect(() => {
        jest.isolateModules(() => {
          require('../scripts/emulator-test-user');
        });
      }).toThrow(/Required local live-user seed file is missing/i);
    } finally {
      if (originalRequireFlag === undefined) {
        delete process.env.EMULATOR_REQUIRE_LIVE_USERS;
      } else {
        process.env.EMULATOR_REQUIRE_LIVE_USERS = originalRequireFlag;
      }

      if (originalConfigPath === undefined) {
        delete process.env.EMULATOR_LIVE_USER_CONFIG_PATH;
      } else {
        process.env.EMULATOR_LIVE_USER_CONFIG_PATH = originalConfigPath;
      }

      jest.resetModules();
    }
  });
});
